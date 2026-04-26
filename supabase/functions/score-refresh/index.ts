/** POST /v1/apt/score-refresh — pg_cron 월별 가점 일괄 재계산 + FCM 푸시 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { calcScore, UserProfile } from "../_shared/eligibility.ts";

const FIREBASE_SERVER_KEY = Deno.env.get("FIREBASE_SERVER_KEY") ?? "";

async function sendFCM(fcmToken: string, title: string, body: string): Promise<void> {
  if (!FIREBASE_SERVER_KEY || !fcmToken) return;
  try {
    await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Authorization": `key=${FIREBASE_SERVER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: { title, body },
        data: { type: "score_update" },
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    console.warn("FCM send failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  // pg_cron은 service role로 호출 — 간단한 secret 헤더 검증
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && !authHeader.includes(serviceKey.slice(-8))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const db = getSupabaseClient();

  // 전체 user_profiles 조회
  const { data: profiles, error } = await db
    .from("user_profiles")
    .select("user_id,profile,score,fcm_token,updated_at");

  if (error) return jsonResponse({ error: error.message }, 500);
  if (!profiles || profiles.length === 0) return jsonResponse({ refreshed: 0 });

  let refreshed = 0;
  let notified  = 0;

  for (const row of profiles) {
    if (!row.profile) continue;

    const newScore = calcScore(row.profile as UserProfile);
    const oldTotal = (row.score as Record<string, unknown>)?.total as number ?? -1;
    const changed  = newScore.total !== oldTotal;

    const nextUpgrade = newScore.next_upgrade;
    const alertDue    = nextUpgrade && nextUpgrade.days_until <= 35;

    // 점수 변동 시 업데이트
    if (changed) {
      await db.from("user_profiles").update({
        score: newScore,
        updated_at: new Date().toISOString(),
      }).eq("user_id", row.user_id);
      refreshed++;

      // 가점 올랐으면 FCM 알림
      if (newScore.total > oldTotal && row.fcm_token) {
        const diff = newScore.total - oldTotal;
        await sendFCM(
          row.fcm_token,
          `청약 가점 +${diff}점 🎉`,
          `이번 달 가점이 ${oldTotal}점 → ${newScore.total}점으로 올랐습니다. 확인해보세요.`,
        );
        notified++;
      }
    }

    // 가점 업그레이드 임박 알림 (D-35 이내, 아직 미변동)
    if (!changed && alertDue && row.fcm_token && nextUpgrade) {
      const fieldLabel = nextUpgrade.field === "homeless" ? "무주택 기간" : "청약통장 가입기간";
      await sendFCM(
        row.fcm_token,
        `${nextUpgrade.days_until}일 후 가점 +${nextUpgrade.score_gain}점 예정`,
        `${fieldLabel} 증가로 ${nextUpgrade.days_until}일 후 가점이 오릅니다. 앱에서 확인해보세요.`,
      );
      notified++;
    }
  }

  return jsonResponse({
    total: profiles.length,
    refreshed,
    notified,
    ran_at: new Date().toISOString(),
  });
});
