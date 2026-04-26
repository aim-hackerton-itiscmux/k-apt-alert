/** GET/POST /v1/apt/my-score — 가점 트래커. Supabase Auth JWT 인증 필요. */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { calcScore, UserProfile } from "../_shared/eligibility.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Authorization: Bearer <token> 에서 user_id 추출. */
async function getUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url) return null;

  // anon 클라이언트로 토큰 검증 — service role은 getUser(token) 지원
  const client = createClient(url, key);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const userId = await getUserId(req.headers.get("Authorization"));
  if (!userId) return jsonResponse({ error: "인증 필요 — Authorization: Bearer <token>" }, 401);

  const db = getSupabaseClient();

  // ── GET: 현재 프로필 + 가점 조회 ─────────────────────────
  if (req.method === "GET") {
    const { data, error } = await db
      .from("user_profiles")
      .select("profile,score,updated_at")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return jsonResponse({ user_id: userId, profile: null, score: null, message: "프로필 없음 — POST로 저장하세요" });
    }

    // 저장된 점수가 오래됐으면 재계산 (30일 기준)
    const updatedAt = new Date(data.updated_at);
    const stale = (Date.now() - updatedAt.getTime()) > 30 * 24 * 3600 * 1000;

    let score = data.score;
    if (stale && data.profile) {
      score = calcScore(data.profile as UserProfile);
      await db.from("user_profiles").update({ score, updated_at: new Date().toISOString() }).eq("user_id", userId);
    }

    // 이번 달 +N점 변동 감지 (next_upgrade 기반)
    const nextUpgrade = (score as Record<string, unknown>)?.next_upgrade as Record<string, unknown> | undefined;
    const upcomingAlert = nextUpgrade && Number(nextUpgrade.days_until) <= 35
      ? {
          message: `이번 달 가점 +${nextUpgrade.score_gain}점 예정 (${nextUpgrade.field === "homeless" ? "무주택 기간" : "청약통장 가입기간"} 증가)`,
          days_until: nextUpgrade.days_until,
          field: nextUpgrade.field,
          confirm_required: true,
        }
      : null;

    return jsonResponse({
      user_id: userId,
      profile: data.profile,
      score,
      upcoming_alert: upcomingAlert,
      updated_at: data.updated_at,
      recalculated: stale,
    });
  }

  // ── POST: 프로필 저장 + 즉시 가점 계산 ──────────────────
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const profile: UserProfile = {
      birth_date:              String(body.birth_date ?? "1990-01-01"),
      is_married:              Boolean(body.is_married ?? false),
      marriage_date:           body.marriage_date ? String(body.marriage_date) : undefined,
      dependents_count:        Number(body.dependents_count ?? 0),
      is_homeless:             Boolean(body.is_homeless ?? true),
      homeless_since:          body.homeless_since ? String(body.homeless_since) : undefined,
      savings_start:           String(body.savings_start ?? "2020-01-01"),
      savings_balance_wan:     Number(body.savings_balance_wan ?? 0),
      resident_region:         String(body.resident_region ?? "서울"),
      has_house:               Boolean(body.has_house ?? false),
      parents_registered:      Boolean(body.parents_registered ?? false),
      parents_registered_since: body.parents_registered_since
        ? String(body.parents_registered_since)
        : undefined,
    };

    const score = calcScore(profile);

    const { error } = await db.from("user_profiles").upsert({
      user_id: userId,
      profile,
      score,
      updated_at: new Date().toISOString(),
    });

    if (error) return jsonResponse({ error: error.message }, 500);

    // 이번 달 업그레이드 알림
    const nextUpgrade = score.next_upgrade;
    const upcomingAlert = nextUpgrade && nextUpgrade.days_until <= 35
      ? {
          message: `${nextUpgrade.days_until}일 후 가점 +${nextUpgrade.score_gain}점 예정 (${nextUpgrade.field === "homeless" ? "무주택 기간" : "청약통장 가입기간"} 증가). 반영하시겠습니까?`,
          days_until: nextUpgrade.days_until,
          field: nextUpgrade.field,
          confirm_required: true,
        }
      : null;

    return jsonResponse({
      user_id: userId,
      score,
      upcoming_alert: upcomingAlert,
      saved: true,
    });
  }

  return jsonResponse({ error: "GET or POST only" }, 405);
});
