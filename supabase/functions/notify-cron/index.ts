/** POST /v1/apt/notify-cron — 사용자 프로필 매칭 인앱 알림 자동 생성 (cron 전용)
 *
 * 모드:
 *   ?mode=dday_alert        — D-day ≤ 3 임박 공고 × 관심 지역 사용자 (기본)
 *   ?mode=announcement_new  — 최근 24h 내 신규 공고 × 관심 지역 사용자
 *
 * 인증: service_role 토큰 필수 (cron만 호출).
 * 사용자 본인용 즉시 매칭은 POST /v1/notifications/refresh (인증 토큰).
 *
 * 매칭·dedup·FCM 로직은 _shared/notify-match.ts 사용 (notifications/refresh와 공유).
 *
 * 014_notify_cron_schedule.sql이 매일 06시(dday) / 08시(new) cron 등록.
 */

import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { runNotifyMatch, type NotifyMode } from "../_shared/notify-match.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  }

  // service_role 토큰 검증 (cron만 호출 가능)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && !authHeader.includes(serviceKey.slice(-8))) {
    return jsonResponse({ error: "Unauthorized — service_role required" }, 401);
  }

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "dday_alert") as NotifyMode;
  if (mode !== "dday_alert" && mode !== "announcement_new") {
    return jsonResponse({ error: "mode must be dday_alert or announcement_new" }, 400);
  }
  const dryRun = url.searchParams.get("dry_run") === "true";

  try {
    const db = getSupabaseClient();
    const stats = await runNotifyMatch(db, mode, { dryRun });
    return jsonResponse({
      mode,
      dry_run: dryRun,
      ...stats,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("notify-cron error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
