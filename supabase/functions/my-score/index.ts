/** GET/POST /v1/apt/my-score — 가점 트래커. */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { calcScore, UserProfile } from "../_shared/eligibility.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const db   = getSupabaseClient();

    // ── GET ────────────────────────────────────────────────
    if (req.method === "GET") {
      const { data, error } = await db
        .from("user_profiles")
        .select("profile,score,updated_at")
        .eq("user_id", user.id)
        .single();

      if (error || !data) {
        return jsonResponse({
          user_id: user.id,
          profile: null,
          score: null,
          message: "프로필 없음 — POST로 저장하세요",
        });
      }

      const stale = (Date.now() - new Date(data.updated_at).getTime()) > 30 * 24 * 3600 * 1000;
      let score = data.score;
      if (stale && data.profile) {
        score = calcScore(data.profile as UserProfile);
        await db.from("user_profiles")
          .update({ score, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }

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
        user_id: user.id,
        profile: data.profile,
        score,
        upcoming_alert: upcomingAlert,
        updated_at: data.updated_at,
        recalculated: stale,
      });
    }

    // ── POST ───────────────────────────────────────────────
    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }

      // DB에 저장된 기존 profile을 먼저 읽어서 base로 사용.
      // body에 있는 필드만 override → partial update 안전.
      const { data: existing } = await db
        .from("user_profiles")
        .select("profile")
        .eq("user_id", user.id)
        .maybeSingle();

      const base = (existing?.profile ?? {}) as Record<string, unknown>;

      // body 필드가 undefined가 아닌 것만 override (null도 명시적 값으로 허용)
      const merged: Record<string, unknown> = { ...base };
      for (const key of Object.keys(body)) {
        if (key !== "fcm_token" && body[key] !== undefined) {
          merged[key] = body[key];
        }
      }

      // 필수 필드 보정: DB에도 없고 body에도 없으면 의미있는 기본값 대신 오류 반환
      if (!merged.birth_date) {
        return jsonResponse({ error: "birth_date 필드가 필요합니다. 프로필을 먼저 저장하세요." }, 400);
      }
      if (!merged.savings_start) {
        return jsonResponse({ error: "savings_start 필드가 필요합니다. 프로필을 먼저 저장하세요." }, 400);
      }

      const profile = merged as unknown as UserProfile;
      const score   = calcScore(profile);

      const fcmToken = body.fcm_token ? String(body.fcm_token) : undefined;
      const upsertData: Record<string, unknown> = {
        user_id: user.id,
        profile,
        score,
        updated_at: new Date().toISOString(),
      };
      if (fcmToken) upsertData.fcm_token = fcmToken;

      const { error } = await db.from("user_profiles").upsert(upsertData);
      if (error) return jsonResponse({ error: error.message }, 500);

      const nextUpgrade   = score.next_upgrade;
      const upcomingAlert = nextUpgrade && nextUpgrade.days_until <= 35
        ? {
            message: `${nextUpgrade.days_until}일 후 가점 +${nextUpgrade.score_gain}점 예정. 반영하시겠습니까?`,
            days_until: nextUpgrade.days_until,
            field: nextUpgrade.field,
            confirm_required: true,
          }
        : null;

      return jsonResponse({ user_id: user.id, score, upcoming_alert: upcomingAlert, saved: true });
    }

    return jsonResponse({ error: "GET or POST only" }, 405);

  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error("my-score error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
