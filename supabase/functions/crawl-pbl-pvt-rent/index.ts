/** 공공지원민간임대 크롤러. proxy/crawlers/pbl_pvt_rent.py 포팅. */

import { PBL_PVT_RENT_API_URL, PBL_PVT_RENT_MDL_API_URL } from "../_shared/config.ts";
import { fetchAllPages, fetchSizeMap } from "../_shared/http.ts";
import { normalizeApplyhome } from "../_shared/normalize.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { upsertAnnouncements, jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    if (await isRateLimited()) {
      return jsonResponse({ error: "Daily API rate limit exceeded" }, 429);
    }

    const url = new URL(req.url);
    const monthsBack = Math.min(parseInt(url.searchParams.get("months_back") ?? "1", 10), 1);

    const now = new Date();
    const start = new Date(now.getTime() - 30 * monthsBack * 86_400_000);
    const startmonth = `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
    const endmonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    const [allItems, sizeMap] = await Promise.all([
      fetchAllPages(PBL_PVT_RENT_API_URL, startmonth, endmonth),
      fetchSizeMap(PBL_PVT_RENT_MDL_API_URL, startmonth, endmonth),
    ]);

    const seenIds = new Set<string>();
    const results: Announcement[] = [];

    for (const item of allItems) {
      if (typeof item !== "object" || item === null) continue;
      const ann = normalizeApplyhome(item, "ppr", "공공지원민간임대");
      if (!ann || seenIds.has(ann.id)) continue;
      const rawId = ann.id.replace("ppr_", "");
      ann.size = sizeMap[rawId] ?? "";
      seenIds.add(ann.id);
      results.push(ann);
    }

    const { inserted, errors } = await upsertAnnouncements(results, "pbl_pvt_rent", monthsBack);

    console.log(`공공지원민간임대: ${inserted} announcements (${startmonth}~${endmonth})`);
    return jsonResponse({ category: "pbl_pvt_rent", inserted, total_fetched: results.length, errors: errors.length ? errors : null });
  } catch (e) {
    console.error(`crawl-pbl-pvt-rent error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
