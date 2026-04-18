"""청약홈 공고 상세 페이지에서 접수 일정 파싱.

공공데이터포털 오피스텔·잔여세대·임의공급 API는 rcept_bgnde/rcept_endde를
자주 공란으로 반환한다. 이 모듈은 각 공고의 PBLANC_URL(청약홈 상세 페이지)을
직접 fetch해서 실제 일정을 추출한다.

페이지 구조:
- SSR 정적 HTML (JavaScript 렌더링 불필요)
- 날짜 포맷: YYYY-MM-DD 단일
- 필드 4종: 모집공고일 / 청약접수 / 당첨자 발표일 / 계약일
"""

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# 페이지별 schedule enrichment 캐시 (공고는 거의 변경 없으므로 24시간 TTL)
SCHEDULE_CACHE_TTL = 86400
_schedule_cache: dict = {}
_schedule_cache_lock = Lock()

# 병렬 fetch 제한 (Render free tier + 공공데이터 서버 부하 고려)
MAX_PARALLEL_ENRICH = 8
HTTP_TIMEOUT = 10

# 정규식 폴백 패턴 — HTML 구조 변경에도 견고
_PATTERNS = {
    "rcept_begin_end": re.compile(
        r"청약\s*접수[^\d]*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})",
    ),
    "notice_date": re.compile(
        r"(?:모집)?\s*공고일[^\d]*(\d{4}-\d{2}-\d{2})",
    ),
    "winner_date": re.compile(
        r"당첨자\s*발표일?[^\d]*(\d{4}-\d{2}-\d{2})",
    ),
    "contract_start_end": re.compile(
        r"계약(?:일|기간)[^\d]*(\d{4}-\d{2}-\d{2})(?:\s*~\s*(\d{4}-\d{2}-\d{2}))?",
    ),
}


def _parse_html(html: str) -> dict:
    """HTML에서 일정 4종 추출. 정규식 기반으로 class 변경에 강인."""
    # script/style 제거 후 텍스트만 추출
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)

    result = {
        "rcept_bgn": "",
        "rcept_end": "",
        "period": "",
        "notice_date": "",
        "winner_date": "",
        "contract_start": "",
        "contract_end": "",
    }

    m = _PATTERNS["rcept_begin_end"].search(text)
    if m:
        result["rcept_bgn"] = m.group(1).replace("-", "")
        result["rcept_end"] = m.group(2).replace("-", "")
        result["period"] = f"{m.group(1)} ~ {m.group(2)}"

    m = _PATTERNS["notice_date"].search(text)
    if m:
        result["notice_date"] = m.group(1)

    m = _PATTERNS["winner_date"].search(text)
    if m:
        result["winner_date"] = m.group(1)

    m = _PATTERNS["contract_start_end"].search(text)
    if m:
        result["contract_start"] = m.group(1)
        result["contract_end"] = m.group(2) or m.group(1)

    return result


def _fetch_one(ann_id: str, url: str) -> dict | None:
    """단일 공고 상세 페이지 fetch + 파싱. 24시간 캐시."""
    now = time.time()
    with _schedule_cache_lock:
        entry = _schedule_cache.get(ann_id)
        if entry and now - entry["ts"] < SCHEDULE_CACHE_TTL:
            return entry["schedule"]

    try:
        resp = requests.get(
            url,
            timeout=HTTP_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0 k-apt-alert/2.4"},
        )
        resp.raise_for_status()
        schedule = _parse_html(resp.text)

        with _schedule_cache_lock:
            _schedule_cache[ann_id] = {"ts": now, "schedule": schedule}
        return schedule
    except Exception as e:
        logger.warning(f"enrich fail {ann_id}: {e}")
        return None


def enrich_schedules(announcements: list[dict]) -> list[dict]:
    """rcept_end가 빈 공고만 선택적으로 HTML enrichment.

    - 병렬 fetch (최대 8개)
    - 응답에 schedule_source 태그 추가: 'api' | 'html_scraped' | 'unavailable'
    - 성공 시 rcept_end/period/winner_date/contract_date 갱신
    - 실패해도 원본 공고는 보존
    """
    targets = []
    for ann in announcements:
        if ann.get("rcept_end"):
            ann["schedule_source"] = "api"
            continue
        url = ann.get("url", "")
        if not url or "applyhome.co.kr" not in url:
            ann["schedule_source"] = "unavailable"
            continue
        targets.append(ann)

    if not targets:
        return announcements

    logger.info(f"Enriching {len(targets)} announcements from applyhome.co.kr")

    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_ENRICH, len(targets))) as ex:
        futures = {ex.submit(_fetch_one, ann["id"], ann["url"]): ann for ann in targets}
        for fut in as_completed(futures):
            ann = futures[fut]
            try:
                sched = fut.result()
            except Exception as e:
                logger.warning(f"enrich exception {ann['id']}: {e}")
                sched = None

            if not sched or not sched.get("rcept_end"):
                ann["schedule_source"] = "unavailable"
                continue

            ann["rcept_end"] = sched["rcept_end"]
            ann["period"] = sched["period"]
            if sched.get("winner_date"):
                ann["winner_date"] = sched["winner_date"]
            if sched.get("contract_start"):
                ann["contract_start"] = sched["contract_start"]
                ann["contract_end"] = sched["contract_end"]
            if sched.get("notice_date"):
                ann["notice_date"] = sched["notice_date"]
            ann["schedule_source"] = "html_scraped"

    return announcements


def cache_status() -> dict:
    """디버그용."""
    now = time.time()
    with _schedule_cache_lock:
        return {
            "count": len(_schedule_cache),
            "ttl_seconds": SCHEDULE_CACHE_TTL,
            "samples": [
                {"id": k, "age_seconds": int(now - v["ts"])}
                for k, v in list(_schedule_cache.items())[:5]
            ],
        }
