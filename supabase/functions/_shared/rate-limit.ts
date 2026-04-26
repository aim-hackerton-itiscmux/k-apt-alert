/** DB 기반 일일 API 호출 카운터. main.py _check_rate_limit 포팅. */

import { getSupabaseClient } from "./db.ts";
import { DAILY_CALL_LIMIT } from "./config.ts";

/** 일일 호출 카운터 증가 + 현재 값 반환. 한도 초과 시 에러. */
export async function checkRateLimit(): Promise<{
  count: number;
  limit: number;
}> {
  const db = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  // UPSERT: 오늘 행이 없으면 생성, 있으면 +1
  const { data, error } = await db.rpc("increment_rate_limit", {
    p_date: today,
    p_limit: DAILY_CALL_LIMIT,
  });

  if (error) {
    // RPC가 없으면 폴백: 직접 upsert
    console.warn("increment_rate_limit RPC not found, using fallback");
    return await fallbackRateLimit(today);
  }

  return { count: data as number, limit: DAILY_CALL_LIMIT };
}

async function fallbackRateLimit(
  today: string,
): Promise<{ count: number; limit: number }> {
  const db = getSupabaseClient();

  // 먼저 현재 값 조회
  const { data: existing } = await db
    .from("rate_limit")
    .select("call_count")
    .eq("date", today)
    .single();

  if (existing) {
    const newCount = existing.call_count + 1;
    await db
      .from("rate_limit")
      .update({ call_count: newCount })
      .eq("date", today);
    return { count: newCount, limit: DAILY_CALL_LIMIT };
  }

  // 행이 없으면 생성
  await db.from("rate_limit").insert({
    date: today,
    call_count: 1,
    daily_limit: DAILY_CALL_LIMIT,
  });
  return { count: 1, limit: DAILY_CALL_LIMIT };
}

/** 한도 초과 확인. 초과 시 true. */
export async function isRateLimited(): Promise<boolean> {
  const { count, limit } = await checkRateLimit();
  return count > limit;
}
