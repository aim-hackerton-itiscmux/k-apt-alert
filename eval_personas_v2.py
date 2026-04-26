#!/usr/bin/env python3
"""20명 페르소나 v2 — eligibility-precheck + simulate 일괄 호출 + expected 대조.

사용법:
    python3 eval_personas_v2.py [JSON 경로]

JWT 불필요. announcement_id는 DB에서 활성 APT 공고 1개를 자동 선택.
503은 burst 호출 영향이라 재시도.
"""
import json
import sys
import time
from pathlib import Path
import urllib.request
import urllib.error

BASE = "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1"
DEFAULT_JSON = "/mnt/c/Users/alstj/Downloads/test_personas_v2.json"
SLEEP_BETWEEN = 0.3
RETRIES = 2


def http_post(url: str, body: dict, timeout: int = 30) -> tuple[int, dict | str]:
    for attempt in range(RETRIES + 1):
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            try:
                data = json.loads(e.read())
            except Exception:
                data = str(e)
            if e.code == 503 and attempt < RETRIES:
                time.sleep(1.0 + attempt)  # backoff
                continue
            return e.code, data
        except Exception as e:
            if attempt < RETRIES:
                time.sleep(1.0)
                continue
            return 0, str(e)
    return 0, "max retries exhausted"


def http_get(url: str, timeout: int = 30) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def pick_announcement_id() -> str:
    data = http_get(f"{BASE}/announcements?category=apt&active_only=false")
    anns = data.get("announcements", [])
    if not anns:
        raise RuntimeError("No announcements in DB")
    return anns[0]["id"]


def call_eligibility(persona: dict, ann_id: str) -> dict:
    body = {"announcement_id": ann_id, **persona["profile"]}
    status, resp = http_post(f"{BASE}/eligibility-precheck", body)
    return {"status": status, "resp": resp}


def call_simulate(persona: dict, ann_id: str) -> dict:
    body = {
        "announcement_id": ann_id,
        "supply_type": "일반공급",
        "user_profile": persona["profile"],
    }
    status, resp = http_post(f"{BASE}/simulate", body)
    return {"status": status, "resp": resp}


def summarize_eligibility(result: dict) -> str:
    if result["status"] != 200:
        return f"❌ HTTP {result['status']}: {str(result['resp'])[:60]}"
    r = result["resp"]
    score = r.get("score", {})
    total = score.get("total", "?")
    homeless = score.get("homeless_score", "?")
    deps = score.get("dependents_score", "?")
    savings = score.get("savings_score", "?")
    eligible = "✅" if r.get("eligible") else "❌"
    crit = r.get("critical_count", 0)
    warn = len(r.get("warnings", []))
    return f"가점={total:>3}({homeless}+{deps}+{savings}) | 1순위={eligible} crit={crit} warn={warn}"


def summarize_simulate(result: dict) -> str:
    if result["status"] != 200:
        return f"❌ HTTP {result['status']}: {str(result['resp'])[:60]}"
    r = result["resp"]
    steps = r.get("steps", [])
    elig_warns = len(r.get("eligibility_warnings", []))
    step_warns = sum(len(s.get("warnings", [])) for s in steps)
    return f"steps={len(steps)} | eligibility_warnings={elig_warns} step_warnings={step_warns}"


def main():
    json_path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON)
    if not json_path.exists():
        sys.exit(f"파일 없음: {json_path}")

    data = json.loads(json_path.read_text(encoding="utf-8"))
    personas = data["personas"]
    print(f"=== 페르소나 {len(personas)}명, base_date={data['_meta']['base_date']} ===\n")

    ann_id = pick_announcement_id()
    print(f"테스트 공고 ID: {ann_id}\n")

    pass_count = 0
    fail_count = 0

    for p in personas:
        elig = call_eligibility(p, ann_id)
        time.sleep(SLEEP_BETWEEN)
        sim  = call_simulate(p, ann_id)
        time.sleep(SLEEP_BETWEEN)

        elig_ok = elig["status"] == 200
        sim_ok  = sim["status"] == 200
        if elig_ok and sim_ok:
            pass_count += 1
        else:
            fail_count += 1

        expected = p.get("expected", {}).get("note", "")
        print(f"[{p['id']}] {p['name']:6} ({p.get('age','?')}세, {','.join(p.get('tags',[]))})")
        print(f"   eligibility: {summarize_eligibility(elig)}")
        print(f"   simulate:    {summarize_simulate(sim)}")
        print(f"   expected:    {expected}")
        print()

    print(f"=== 결과: 정상 {pass_count}명 / 실패 {fail_count}명 ===")


if __name__ == "__main__":
    main()
