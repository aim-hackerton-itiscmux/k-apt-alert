/** 크롤러 공통 DB 저장 + 메타데이터 업데이트 헬퍼. */

import { getSupabaseClient } from "./db.ts";
import type { Announcement } from "./types.ts";
import { CACHE_TTLS } from "./config.ts";

/** announcements 테이블에 UPSERT + crawl_metadata 업데이트. */
export async function upsertAnnouncements(
  items: Announcement[],
  categoryKey: string,
  monthsBack: number,
): Promise<{ inserted: number; errors: string[] }> {
  const db = getSupabaseClient();
  const errors: string[] = [];
  let inserted = 0;
  const now = new Date().toISOString();

  // 50건씩 배치 UPSERT
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50).map((a) => ({
      id: a.id,
      category: categoryKey,
      name: a.name,
      region: a.region ?? "",
      district: a.district ?? "",
      address: a.address ?? "",
      period: a.period ?? "",
      rcept_end: a.rcept_end ?? "",
      rcept_bgn: a.rcept_bgn ?? "",
      total_units: a.total_units ?? "",
      house_type: a.house_type ?? "",
      house_category: a.house_category ?? "",
      constructor: a.constructor ?? "",
      url: a.url ?? "",
      size: a.size ?? "",
      speculative_zone: a.speculative_zone ?? "",
      price_controlled: a.price_controlled ?? "",
      schedule_source: a.schedule_source ?? "api",
      notice_date: a.notice_date ?? null,
      winner_date: a.winner_date ?? null,
      contract_start: a.contract_start ?? null,
      contract_end: a.contract_end ?? null,
      crawled_at: now,
      updated_at: now,
    }));

    const { error } = await db
      .from("announcements")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      errors.push(`batch ${i}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  // crawl_metadata 업데이트
  const ttl = CACHE_TTLS[categoryKey] ?? 600;
  const cacheKey = `${categoryKey}:${monthsBack}`;
  await db.from("crawl_metadata").upsert(
    {
      cache_key: cacheKey,
      category: categoryKey,
      months_back: monthsBack,
      item_count: inserted,
      crawled_at: now,
      ttl_seconds: ttl,
    },
    { onConflict: "cache_key" },
  );

  return { inserted, errors };
}

/** CORS 헤더 포함 JSON 응답 생성 헬퍼. */
export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** OPTIONS preflight 응답. */
export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
