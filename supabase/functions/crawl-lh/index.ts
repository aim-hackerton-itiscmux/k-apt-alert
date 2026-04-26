/** LH 청약플러스 크롤러 (HTML 파싱). apply.lh.or.kr — API 대신 SSR 테이블 파싱. */

import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.48/deno-dom-wasm.ts";
import { upsertAnnouncements, jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

const LH_BASE = "https://apply.lh.or.kr";
const LH_LIST_SALE = `${LH_BASE}/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1027`; // 분양주택
const LH_LIST_RENT = `${LH_BASE}/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1026`; // 임대주택
const LH_DETAIL_URL = `${LH_BASE}/lhapply/apply/wt/wrtanc/selectWrtancInfo.do`;

const SIDO_TO_REGION: Record<string, string> = {
  "서울특별시": "서울",
  "경기도": "경기",
  "인천광역시": "인천",
  "대구광역시": "대구",
  "부산광역시": "부산",
  "광주광역시": "광주",
  "대전광역시": "대전",
  "울산광역시": "울산",
  "세종특별자치시": "세종",
  "충청남도": "충남",
  "충청북도": "충북",
  "전라남도": "전남",
  "전북특별자치도": "전북",
  "경상남도": "경남",
  "경상북도": "경북",
  "강원특별자치도": "강원",
  "강원도": "강원",
  "제주특별자치도": "제주",
  "전국": "전국",
};

/** "2026.04.24" → "2026-04-24". 빈값·비정규 → "" */
function parseDate(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const converted = s.replace(/\./g, "-").replace(/-+$/, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(converted) ? converted : "";
}

/**
 * LH 목록 테이블 행 파싱.
 *
 * 컬럼 순서 (HTML 기준):
 * 0=번호  1=유형(house_type)  2=공고명(bbs_tit)  3=지역  4=첨부  5=게시일  6=마감일  7=상태  8=조회수
 */
function parseLhRow(cells: Element[], mi: string): Announcement | null {
  if (cells.length < 8) return null;

  // 공고명 셀 (data-id 속성으로 ID 추출)
  const titleCell = cells[2];
  const anchor = titleCell.querySelector("a.wrtancInfoBtn");
  if (!anchor) return null;

  const panId = anchor.getAttribute("data-id1") ?? "";
  const id2   = anchor.getAttribute("data-id2") ?? "";
  const id3   = anchor.getAttribute("data-id3") ?? "";
  const id4   = anchor.getAttribute("data-id4") ?? "";
  if (!panId) return null;

  // 제목: <span> 안의 텍스트, <em class="day">N일전</em> 제거
  const span = anchor.querySelector("span");
  const emText = span?.querySelector("em")?.textContent?.trim() ?? "";
  const title = (span?.textContent ?? titleCell.textContent ?? "")
    .replace(emText, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;

  const houseType = cells[1].textContent?.trim() ?? "LH분양";
  const rawRegion = cells[3].textContent?.trim() ?? "";
  const region = SIDO_TO_REGION[rawRegion] ?? rawRegion;
  const rceptBgn = parseDate(cells[5].textContent?.trim() ?? "");
  const rceptEnd = parseDate(cells[6].textContent?.trim() ?? "");

  // 상태: 접수마감/공고중/정정공고중/접수중 → 흘려보내고 active_only는 d-day.ts에서 처리

  const detailUrl =
    `${LH_DETAIL_URL}?mi=${mi}&panId=${panId}&ccrCnntSysDsCd=${id2}&uppAisTpCd=${id3}&aisTpCd=${id4}`;

  const houseCategory =
    houseType.includes("임대") || houseType.includes("행복주택") || houseType.includes("전세임대")
      ? "LH임대"
      : "LH분양";

  return {
    id: `lh_${panId}`,
    name: title,
    region,
    district: "",
    address: "",
    period: rceptBgn ? `${rceptBgn} ~ ${rceptEnd}` : "",
    rcept_bgn: rceptBgn,
    rcept_end: rceptEnd,
    total_units: "",
    house_type: houseType,
    constructor: "LH 한국토지주택공사",
    url: detailUrl,
    speculative_zone: "",
    price_controlled: "",
    house_category: houseCategory,
    size: "",
    schedule_source: "html",
  };
}

async function fetchBoard(listUrl: string, mi: string, cutoffDate: string): Promise<Announcement[]> {
  const results: Announcement[] = [];
  try {
    const resp = await fetch(listUrl, {
      headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/2.7" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return results;

    const tbody = doc.querySelector("table tbody");
    if (!tbody) {
      console.warn(`LH mi=${mi}: tbody not found`);
      return results;
    }

    for (const row of tbody.querySelectorAll("tr")) {
      try {
        const cells = [...row.querySelectorAll("td")];
        const ann = parseLhRow(cells, mi);
        if (!ann) continue;
        // 게시일이 있고 cutoff 이전이면 스킵
        if (ann.rcept_bgn && ann.rcept_bgn < cutoffDate) continue;
        results.push(ann);
      } catch (e) {
        console.debug(`LH row parse skipped: ${e}`);
      }
    }
  } catch (e) {
    console.warn(`LH board mi=${mi} fetch failed: ${e}`);
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    const monthsBack = parseInt(url.searchParams.get("months_back") ?? "2", 10);
    const cutoffDate = new Date(Date.now() - monthsBack * 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [saleItems, rentItems] = await Promise.all([
      fetchBoard(LH_LIST_SALE, "1027", cutoffDate),
      fetchBoard(LH_LIST_RENT, "1026", cutoffDate),
    ]);

    const seenIds = new Set<string>();
    const results: Announcement[] = [];
    for (const ann of [...saleItems, ...rentItems]) {
      if (!seenIds.has(ann.id)) {
        seenIds.add(ann.id);
        results.push(ann);
      }
    }

    const { inserted, errors } = await upsertAnnouncements(results, "lh", monthsBack);

    console.log(`LH: ${inserted} upserted from ${results.length} fetched (cutoff: ${cutoffDate})`);
    return jsonResponse({
      category: "lh",
      inserted,
      total_fetched: results.length,
      errors: errors.length ? errors : null,
    });
  } catch (e) {
    console.error(`crawl-lh error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
