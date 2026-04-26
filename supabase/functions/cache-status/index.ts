/** GET /v1/apt/cache — 카테고리별 캐시(크롤) 상태 + 일일 호출 카운터. */

import { getSupabaseClient } from "../_shared/db.ts";
import { DAILY_CALL_LIMIT } from "../_shared/config.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const db = getSupabaseClient();
    const now = new Date();

    // crawl_metadata 조회
    const { data: metadata } = await db
      .from("crawl_metadata")
      .select("*")
      .order("crawled_at", { ascending: false });

    const entries = (metadata ?? []).map((m) => {
      const crawledAt = new Date(m.crawled_at);
      const ageSeconds = Math.floor((now.getTime() - crawledAt.getTime()) / 1000);
      return {
        key: m.cache_key,
        items: m.item_count,
        age_seconds: ageSeconds,
        ttl_remaining: Math.max(0, m.ttl_seconds - ageSeconds),
      };
    });

    // 오늘 rate_limit 조회
    const today = now.toISOString().slice(0, 10);
    const { data: rateData } = await db
      .from("rate_limit")
      .select("*")
      .eq("date", today)
      .single();

    const rate = {
      date: today,
      count: rateData?.call_count ?? 0,
      limit: DAILY_CALL_LIMIT,
    };

    // schedule_enrichment_cache 요약
    const { count: enrichCount } = await db
      .from("schedule_enrichment_cache")
      .select("*", { count: "exact", head: true });

    return jsonResponse({
      entries,
      rate_limit: rate,
      schedule_enrichment: {
        count: enrichCount ?? 0,
      },
    });
  } catch (e) {
    console.error(`cache-status error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
