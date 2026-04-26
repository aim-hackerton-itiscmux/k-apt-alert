/** SH 서울공공주택 크롤러. proxy/crawlers/sh.py 포팅. deno-dom 사용. */

import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.48/deno-dom-wasm.ts";
import { upsertAnnouncements, jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

const SH_LIST_LEASE = "https://www.i-sh.co.kr/app/lay2/program/S48T1581C563/www/brd/m_247/list.do?multi_itm_seq=2";
const SH_LIST_SALE = "https://www.i-sh.co.kr/app/lay2/program/S48T1581C563/www/brd/m_247/list.do?multi_itm_seq=1";
const SH_DETAIL_TEMPLATE = "https://www.i-sh.co.kr/app/lay2/program/S48T1581C563/www/brd/m_247/view.do?seq={seq}&multi_itm_seq={board}";

const INCLUDE_KEYWORDS = ["모집공고", "분양공고", "입주자 모집", "공급공고", "청약공고", "본청약"];
const EXCLUDE_KEYWORDS = ["당첨자", "발표", "계약", "선정", "취소", "변경", "안내문", "결과", "명단"];

const SEOUL_DISTRICTS = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구",
  "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구",
  "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
];

const DISTRICT_KEYWORDS: Record<string, string> = {
  "마곡": "강서구", "고덕": "강동구", "위례": "송파구", "강일": "강동구",
  "성수": "성동구", "구의": "광진구", "가양": "강서구", "반포": "서초구",
};

function parseShRow(cells: Element[], boardId: number): Announcement | null {
  if (cells.length < 5) return null;

  const titleCell = cells[1];
  const title = titleCell.textContent?.trim() ?? "";
  const link = titleCell.querySelector("a");
  if (!link) return null;

  if (!INCLUDE_KEYWORDS.some((kw) => title.includes(kw))) return null;
  if (EXCLUDE_KEYWORDS.some((kw) => title.includes(kw))) return null;

  const onclick = link.getAttribute("onclick") ?? "";
  const m = onclick.match(/getDetailView\(['"](\d+)['"]/);
  if (!m) return null;
  const seq = m[1];

  const regRaw = cells[3].textContent?.trim() ?? "";
  const regMatch = regRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!regMatch) return null;

  const regDate = new Date(`${regMatch[1]}-${regMatch[2]}-${regMatch[3]}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if ((today.getTime() - regDate.getTime()) / 86_400_000 > 60) return null;

  let district = "";
  for (const d of SEOUL_DISTRICTS) {
    if (title.includes(d)) { district = d; break; }
  }
  if (!district) {
    for (const [kw, d] of Object.entries(DISTRICT_KEYWORDS)) {
      if (title.includes(kw)) { district = d; break; }
    }
  }

  return {
    id: `sh_${seq}`,
    name: title,
    region: "서울",
    district,
    address: "",
    period: "",
    rcept_end: "",
    rcept_bgn: "",
    notice_date: `${regMatch[1]}-${regMatch[2]}-${regMatch[3]}`,
    total_units: "",
    house_type: boardId === 1 ? "공공분양" : "공공임대",
    constructor: "서울주택도시공사",
    url: SH_DETAIL_TEMPLATE.replace("{seq}", seq).replace("{board}", String(boardId)),
    speculative_zone: "",
    price_controlled: "",
    house_category: "SH 공공주택",
    size: "",
    schedule_source: "unavailable",
  };
}

async function fetchBoard(listUrl: string, boardId: number): Promise<Announcement[]> {
  const results: Announcement[] = [];
  try {
    const resp = await fetch(listUrl, {
      headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/2.7" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return results;

    const table = doc.querySelector("table");
    if (!table) return results;

    for (const row of table.querySelectorAll("tr")) {
      try {
        const cells = [...row.querySelectorAll("td")];
        const ann = parseShRow(cells, boardId);
        if (ann) results.push(ann);
      } catch (e) {
        console.debug(`SH row parse skipped: ${e}`);
      }
    }
  } catch (e) {
    console.warn(`SH board ${boardId} fetch failed: ${e}`);
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    const monthsBack = parseInt(url.searchParams.get("months_back") ?? "2", 10);

    const [sale, lease] = await Promise.all([
      fetchBoard(SH_LIST_SALE, 1),
      fetchBoard(SH_LIST_LEASE, 2),
    ]);

    const results = [...sale, ...lease];
    const { inserted, errors } = await upsertAnnouncements(results, "sh", monthsBack);

    console.log(`SH: ${inserted} 공고 추출 (분양+임대)`);
    return jsonResponse({ category: "sh", inserted, total_fetched: results.length, errors: errors.length ? errors : null });
  } catch (e) {
    console.error(`crawl-sh error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
