"""applyhome_page.py — 청약홈 상세 페이지 일정 보강 테스트."""

from unittest import mock

import pytest

from crawlers import applyhome_page
from crawlers.applyhome_page import (
    _extract_rcept_dates,
    _parse_html,
    enrich_schedules,
)


@pytest.fixture(autouse=True)
def clear_schedule_cache():
    applyhome_page._schedule_cache.clear()
    yield
    applyhome_page._schedule_cache.clear()


# ─── _extract_rcept_dates ─────────────────────────────────────────────


def test_rcept_dates_range_format():
    text = "기타 정보 청약접수 2026-04-15 ~ 2026-04-20 당첨자 발표 2026-04-27"
    bgn, end = _extract_rcept_dates(text)
    assert bgn == "2026-04-15"
    assert end == "2026-04-20"


def test_rcept_dates_listed_format():
    """범위가 아니라 나열로 표기된 경우 첫·마지막 날짜."""
    text = "청약접수 특별공급 2026-04-15 1순위 2026-04-16 2순위 2026-04-17 당첨자 발표 2026-04-27"
    bgn, end = _extract_rcept_dates(text)
    assert bgn == "2026-04-15"
    assert end == "2026-04-17"


def test_rcept_dates_single_date():
    text = "청약접수 2026-05-01 당첨자 발표일 2026-05-13"
    bgn, end = _extract_rcept_dates(text)
    assert bgn == "2026-05-01"
    assert end == "2026-05-01"


def test_rcept_dates_no_section_returns_empty():
    text = "이 페이지에는 청약 키워드가 없습니다 2026-01-01"
    bgn, end = _extract_rcept_dates(text)
    assert bgn == "" and end == ""


def test_rcept_dates_section_terminator_blocks_contract_date():
    """계약일은 청약접수 섹션 밖으로 간주돼야 — 섞여 들어가지 않음."""
    text = "청약접수 2026-05-01 계약기간 2026-06-01 ~ 2026-06-03"
    bgn, end = _extract_rcept_dates(text)
    # 계약일 (2026-06-01) 이 접수일로 잘못 잡히지 않아야
    assert bgn == "2026-05-01"
    assert end == "2026-05-01"


def test_rcept_dates_terminator_winner():
    text = "청약접수 2026-05-01 당첨자 발표 2026-05-13 계약 2026-05-20"
    bgn, end = _extract_rcept_dates(text)
    assert bgn == "2026-05-01" and end == "2026-05-01"


# ─── _parse_html ──────────────────────────────────────────────────────


def test_parse_html_full_page():
    html = """
    <html><body>
    <p>모집공고일 2026-04-10</p>
    <p>청약접수 2026-04-15 ~ 2026-04-20</p>
    <p>당첨자 발표일 2026-04-27</p>
    <p>계약기간 2026-05-11 ~ 2026-05-13</p>
    </body></html>
    """
    result = _parse_html(html)
    assert result["notice_date"] == "2026-04-10"
    assert result["rcept_bgn"] == "20260415"
    assert result["rcept_end"] == "20260420"
    assert result["period"] == "2026-04-15 ~ 2026-04-20"
    assert result["winner_date"] == "2026-04-27"
    assert result["contract_start"] == "2026-05-11"
    assert result["contract_end"] == "2026-05-13"


def test_parse_html_strips_script_style():
    """script/style 태그 안의 날짜는 무시돼야."""
    html = """
    <html><body>
    <script>var x = "2099-12-31";</script>
    <style>.x { color: red; }</style>
    <p>청약접수 2026-04-15 당첨자 발표 2026-04-27</p>
    </body></html>
    """
    result = _parse_html(html)
    assert result["rcept_bgn"] == "20260415"
    # script 안의 2099 날짜는 추출되면 안 됨
    assert "2099" not in result["period"]


def test_parse_html_partial_data():
    """일부 필드만 있는 페이지도 빈 문자열로 채워서 정상 dict 반환."""
    html = "<html><body><p>청약접수 2026-04-15 ~ 2026-04-20</p></body></html>"
    result = _parse_html(html)
    assert result["rcept_bgn"] == "20260415"
    assert result["rcept_end"] == "20260420"
    assert result["winner_date"] == ""
    assert result["contract_start"] == ""


def test_parse_html_empty_returns_blank_skeleton():
    result = _parse_html("<html><body></body></html>")
    assert result == {
        "rcept_bgn": "",
        "rcept_end": "",
        "period": "",
        "notice_date": "",
        "winner_date": "",
        "contract_start": "",
        "contract_end": "",
    }


def test_parse_html_period_format_when_single_day():
    """동일 날짜면 '...~...' 대신 단일 날짜만."""
    html = "<html><body><p>청약접수 2026-04-15</p></body></html>"
    result = _parse_html(html)
    assert result["period"] == "2026-04-15"


# ─── enrich_schedules ────────────────────────────────────────────────


def test_enrich_skips_when_already_has_rcept_end():
    """rcept_end 있으면 fetch 안 함 — schedule_source='api' 자동 태그."""
    anns = [{"id": "x", "rcept_end": "20260420", "url": "https://www.applyhome.co.kr/x"}]
    with mock.patch.object(applyhome_page.requests, "get") as mocked_get:
        result = enrich_schedules(anns)
    assert mocked_get.call_count == 0
    assert result[0]["schedule_source"] == "api"


def test_enrich_marks_unavailable_when_no_url():
    anns = [{"id": "x", "rcept_end": "", "url": ""}]
    result = enrich_schedules(anns)
    assert result[0]["schedule_source"] == "unavailable"


def test_enrich_marks_unavailable_when_non_applyhome_url():
    """LH 등 비-applyhome URL은 enrichment 대상 아님."""
    anns = [{"id": "x", "rcept_end": "", "url": "https://apply.lh.or.kr/abc"}]
    with mock.patch.object(applyhome_page.requests, "get") as mocked_get:
        result = enrich_schedules(anns)
    assert mocked_get.call_count == 0
    assert result[0]["schedule_source"] == "unavailable"


def test_enrich_successful_fetch_updates_fields():
    """청약홈 fetch 성공 시 rcept_end·period·winner·contract 갱신 + html_scraped."""
    html = """
    <html><body>
    <p>청약접수 2026-05-01 ~ 2026-05-05</p>
    <p>당첨자 발표 2026-05-13</p>
    <p>계약기간 2026-05-20 ~ 2026-05-22</p>
    </body></html>
    """
    resp = mock.Mock(text=html)
    resp.raise_for_status = mock.Mock()
    anns = [{"id": "ot_1", "rcept_end": "", "url": "https://www.applyhome.co.kr/ot1"}]
    with mock.patch.object(applyhome_page.requests, "get", return_value=resp):
        result = enrich_schedules(anns)
    a = result[0]
    assert a["rcept_end"] == "20260505"
    assert a["period"] == "2026-05-01 ~ 2026-05-05"
    assert a["winner_date"] == "2026-05-13"
    assert a["contract_start"] == "2026-05-20"
    assert a["contract_end"] == "2026-05-22"
    assert a["schedule_source"] == "html_scraped"


def test_enrich_fetch_failure_marks_unavailable():
    """HTTP 실패 시 unavailable + 원본 보존."""
    import requests as rq

    anns = [{"id": "ot_x", "rcept_end": "", "url": "https://www.applyhome.co.kr/x"}]
    with mock.patch.object(applyhome_page.requests, "get", side_effect=rq.RequestException("net")):
        result = enrich_schedules(anns)
    assert result[0]["schedule_source"] == "unavailable"
    assert result[0]["id"] == "ot_x"  # 원본 dict 보존


def test_enrich_partial_success_marks_unavailable_when_no_rcept_end():
    """fetch는 성공했으나 페이지에서 rcept_end 못 뽑으면 unavailable."""
    html = "<html><body><p>일정 표시 안됨</p></body></html>"
    resp = mock.Mock(text=html)
    resp.raise_for_status = mock.Mock()
    anns = [{"id": "ot_y", "rcept_end": "", "url": "https://www.applyhome.co.kr/y"}]
    with mock.patch.object(applyhome_page.requests, "get", return_value=resp):
        result = enrich_schedules(anns)
    assert result[0]["schedule_source"] == "unavailable"


def test_enrich_caches_per_id():
    """같은 id는 두 번 fetch 안 함 (24h 캐시)."""
    html = "<html><body><p>청약접수 2026-05-01 ~ 2026-05-05</p></body></html>"
    resp = mock.Mock(text=html)
    resp.raise_for_status = mock.Mock()
    anns_run1 = [{"id": "ot_cached", "rcept_end": "", "url": "https://www.applyhome.co.kr/c"}]
    anns_run2 = [{"id": "ot_cached", "rcept_end": "", "url": "https://www.applyhome.co.kr/c"}]
    with mock.patch.object(applyhome_page.requests, "get", return_value=resp) as mocked:
        enrich_schedules(anns_run1)
        enrich_schedules(anns_run2)
    assert mocked.call_count == 1


def test_enrich_empty_input():
    assert enrich_schedules([]) == []


def test_enrich_mixed_batch():
    """rcept_end 있는 거 + 없는 거 + non-applyhome 섞인 배치 처리."""
    html = "<html><body><p>청약접수 2026-05-01 ~ 2026-05-05</p></body></html>"
    resp = mock.Mock(text=html)
    resp.raise_for_status = mock.Mock()
    anns = [
        {"id": "a", "rcept_end": "20260420", "url": "https://www.applyhome.co.kr/a"},
        {"id": "b", "rcept_end": "", "url": "https://www.applyhome.co.kr/b"},
        {"id": "c", "rcept_end": "", "url": ""},
        {"id": "d", "rcept_end": "", "url": "https://apply.lh.or.kr/d"},
    ]
    with mock.patch.object(applyhome_page.requests, "get", return_value=resp) as mocked:
        result = enrich_schedules(anns)
    assert mocked.call_count == 1  # b만 fetch
    sources = {a["id"]: a["schedule_source"] for a in result}
    assert sources == {
        "a": "api",
        "b": "html_scraped",
        "c": "unavailable",
        "d": "unavailable",
    }
