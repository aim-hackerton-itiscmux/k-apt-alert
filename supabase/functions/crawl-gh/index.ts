/** GH 경기공공주택 크롤러. proxy/crawlers/gh.py 포팅. deno-dom 사용. */

import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.48/deno-dom-wasm.ts";
import { upsertAnnouncements, jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

const GH_LIST_URL = "https://www.gh.or.kr/gh/announcement-of-salerental001.do";
const GH_DETAIL_TEMPLATE = "https://www.gh.or.kr/gh/announcement-of-salerental001.do?mode=view&articleNo={article_no}";

const INCLUDE_KEYWORDS = ["모집공고", "분양공고", "공급공고", "입주자모집", "청약공고"];
const EXCLUDE_KEYWORDS = ["결과", "발표", "당첨자", "계약대상", "선정", "취소", "변경안내"];

const GG_DISTRICTS = [
  "수원", "성남", "고양", "용인", "부천", "안산", "남양주", "안양", "화성", "평택",
  "의정부", "시흥", "파주", "김포", "광명", "광주", "군포", "오산", "이천", "양주",
  "구리", "안성", "포천", "의왕", "하남", "여주", "동두천", "과천", "가평", "양평",
];

function parseGhRow(cells: Element[], today: Date): Announcement | null {
  if (cells.length < 6) return null;

  const category = cells[1].textContent?.trim() ?? "";
  if (category !== "주택") return null;

  const titleCell = cells[2];
  const title = titleCell.textContent?.trim() ?? "";
  const link = titleCell.querySelector("a[href]");
  if (!link) return null;

  if (!INCLUDE_KEYWORDS.some((kw) => title.includes(kw))) return null;
  if (EXCLUDE_KEYWORDS.some((kw) => title.includes(kw))) return null;

  const href = link.getAttribute("href") ?? "";
  const m = href.match(/articleNo=(\d+)/);
  if (!m) return null;
  const articleNo = m[1];

  // 등록일 YY.MM.DD
  const regRaw = cells[4].textContent?.trim() ?? "";
  const regM = regRaw.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (!regM) return null;
  const regYear = 2000 + parseInt(regM[1], 10);
  const regMonth = parseInt(regM[2], 10);
  const regDay = parseInt(regM[3], 10);

  let regDate: Date;
  try {
    regDate = new Date(regYear, regMonth - 1, regDay);
  } catch {
    return null;
  }

  if ((today.getTime() - regDate.getTime()) / 86_400_000 > 60) return null;

  let district = "";
  for (const d of GG_DISTRICTS) {
    if (title.includes(d)) {
      district = `${d}시`;
      break;
    }
  }

  const regDateStr = `${regYear}-${String(regMonth).padStart(2, "0")}-${String(regDay).padStart(2, "0")}`;

  return {
    id: `gh_${articleNo}`,
    name: title,
    region: "경기",
    district,
    address: "",
    period: "",
    rcept_end: "",
    rcept_bgn: "",
    notice_date: regDateStr,
    total_units: "",
    house_type: "공공임대/분양",
    constructor: "경기주택도시공사",
    url: GH_DETAIL_TEMPLATE.replace("{article_no}", articleNo),
    speculative_zone: "",
    price_controlled: "",
    house_category: "GH 공공주택",
    size: "",
    schedule_source: "unavailable",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    const monthsBack = parseInt(url.searchParams.get("months_back") ?? "2", 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results: Announcement[] = [];

    for (let page = 1; page <= 3; page++) {
      const listUrl = `${GH_LIST_URL}?pageIndex=${page}&article.offset=${(page - 1) * 10}&articleLimit=10`;
      try {
        const resp = await fetch(listUrl, {
          headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/2.7" },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();

        const doc = new DOMParser().parseFromString(html, "text/html");
        if (!doc) break;

        const table = doc.querySelector("table");
        if (!table) break;

        let pageCount = 0;
        for (const row of table.querySelectorAll("tr")) {
          try {
            const cells = [...row.querySelectorAll("td")];
            const ann = parseGhRow(cells, today);
            if (ann) {
              results.push(ann);
              pageCount++;
            }
          } catch (e) {
            console.debug(`GH row parse skipped: ${e}`);
          }
        }

        if (pageCount === 0 && page > 1) break;
      } catch (e) {
        console.warn(`GH list page ${page} fetch failed: ${e}`);
        break;
      }
    }

    // 중복 제거
    const seen = new Set<string>();
    const unique = results.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    const { inserted, errors } = await upsertAnnouncements(unique, "gh", monthsBack);

    console.log(`GH: ${inserted} 주택 공고 추출`);
    return jsonResponse({ category: "gh", inserted, total_fetched: unique.length, errors: errors.length ? errors : null });
  } catch (e) {
    console.error(`crawl-gh error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
