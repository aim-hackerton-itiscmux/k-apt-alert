/** LH 공공분양 크롤러. proxy/crawlers/lh.py 포팅. */

import { DATA_GO_KR_API_KEY, LH_NOTICE_API_URL } from "../_shared/config.ts";
import { fetchPage } from "../_shared/http.ts";
import { REGION_KEYWORDS } from "../_shared/normalize.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { upsertAnnouncements, jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

const SUBSCRIPTION_KEYWORDS = ["분양", "청약", "공급", "뉴홈", "행복주택", "공공주택", "입주자"];
const EXCLUDE_KEYWORDS = ["낙찰", "계약", "하자", "입찰", "용역", "공사", "물품"];

const CITY_TO_REGION: Record<string, string> = {
  "수원": "경기", "성남": "경기", "고양": "경기", "용인": "경기", "화성": "경기",
  "파주": "경기", "김포": "경기", "평택": "경기", "하남": "경기", "광명": "경기",
  "시흥": "경기", "남양주": "경기", "양주": "경기", "의왕": "경기", "과천": "경기",
  "구리": "경기", "안산": "경기", "안양": "경기", "부천": "경기", "의정부": "경기",
  "오산": "경기", "군포": "경기", "이천": "경기", "양평": "경기", "여주": "경기",
  "동탄": "경기", "광교": "경기", "판교": "경기", "위례": "경기", "별내": "경기",
  "창원": "경남", "김해": "경남", "양산": "경남", "진주": "경남", "거제": "경남", "통영": "경남",
  "천안": "충남", "아산": "충남", "서산": "충남", "당진": "충남", "논산": "충남",
  "청주": "충북", "충주": "충북", "제천": "충북",
  "전주": "전북", "익산": "전북", "군산": "전북",
  "목포": "전남", "여수": "전남", "순천": "전남", "광양": "전남", "나주": "전남",
  "포항": "경북", "구미": "경북", "경산": "경북", "안동": "경북", "김천": "경북",
  "춘천": "강원", "원주": "강원", "강릉": "강원", "속초": "강원",
  "서귀포": "제주",
};

const BROAD_REGION_KEYWORDS = ["수도권", "전국", "전 지역", "전지역"];

function inferRegion(title: string): string {
  for (const kw of BROAD_REGION_KEYWORDS) {
    if (title.includes(kw)) return "전국";
  }
  for (const [keyword, r] of Object.entries(REGION_KEYWORDS)) {
    if (title.includes(keyword)) return r;
  }
  for (const [city, r] of Object.entries(CITY_TO_REGION)) {
    if (title.includes(city)) return r;
  }
  return "전국";
}

function normalize(notice: Record<string, unknown>): Announcement | null {
  try {
    const title = String(notice.BBS_TL ?? "");
    if (!title) return null;
    if (!SUBSCRIPTION_KEYWORDS.some((kw) => title.includes(kw))) return null;
    if (EXCLUDE_KEYWORDS.some((kw) => title.includes(kw))) return null;

    const noticeId = String(notice.BBS_SN ?? "");
    if (!noticeId) return null;

    const regDate = String(notice.BBS_WOU_DTTM ?? "").slice(0, 10);

    return {
      id: `lh_${noticeId}`,
      name: title,
      region: inferRegion(title),
      district: "",
      address: "",
      period: regDate,
      rcept_end: "",
      rcept_bgn: "",
      total_units: "",
      house_type: String(notice.AIS_TP_CD_NM ?? "") || "공공분양",
      constructor: "LH 한국토지주택공사",
      url: String(notice.LINK_URL ?? "https://apply.lh.or.kr"),
      speculative_zone: "",
      price_controlled: "",
      house_category: "LH공공분양",
      size: "",
      schedule_source: "api",
    };
  } catch (e) {
    console.warn(`LH normalize failed: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    if (await isRateLimited()) {
      return jsonResponse({ error: "Daily API rate limit exceeded" }, 429);
    }

    const url = new URL(req.url);
    const monthsBack = parseInt(url.searchParams.get("months_back") ?? "2", 10);
    const daysBack = 30 * monthsBack;
    const cutoff = new Date(Date.now() - daysBack * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const allNotices: Record<string, unknown>[] = [];
    let page = 1;

    while (true) {
      const params: Record<string, string> = {
        serviceKey: DATA_GO_KR_API_KEY,
        pageNo: String(page),
        numOfRows: "50",
      };

      const body = await fetchPage(LH_NOTICE_API_URL, params);
      if (!body) break;

      const items = (body.data as Record<string, unknown>[]) ?? [];
      if (items.length === 0) break;

      let hasOld = false;
      for (const item of items) {
        const regDate = String((item as Record<string, unknown>).BBS_WOU_DTTM ?? "").slice(0, 10);
        if (regDate < cutoff) {
          hasOld = true;
          continue;
        }
        allNotices.push(item as Record<string, unknown>);
      }

      if (hasOld) break;

      const total = (body.totalCount as number) ?? items.length;
      if (page * 50 >= total) break;
      page++;
    }

    const seenIds = new Set<string>();
    const results: Announcement[] = [];

    for (const notice of allNotices) {
      const ann = normalize(notice);
      if (ann && !seenIds.has(ann.id)) {
        seenIds.add(ann.id);
        results.push(ann);
      }
    }

    const { inserted, errors } = await upsertAnnouncements(results, "lh", monthsBack);

    console.log(`LH: ${inserted} announcements (last ${daysBack} days)`);
    return jsonResponse({ category: "lh", inserted, total_fetched: results.length, errors: errors.length ? errors : null });
  } catch (e) {
    console.error(`crawl-lh error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
