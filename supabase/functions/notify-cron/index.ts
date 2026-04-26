/** POST /v1/apt/notify-cron — 사용자 프로필 매칭 인앱 알림 자동 생성 (cron)
 *
 * 모드:
 *   ?mode=dday_alert        — D-day ≤ 3 임박 공고 × 관심 지역 사용자 (기본)
 *   ?mode=announcement_new  — 최근 24h 내 신규 공고 × 관심 지역 사용자
 *
 * 동작:
 * 1. service_role 토큰 검증 (cron만 호출)
 * 2. 모드별 공고 필터링
 * 3. user_profiles 전체 조회, profile JSONB에서 preferred_regions / resident_region 추출
 * 4. 사용자 × 공고 매칭 → notifications insert (24h 내 중복 방지)
 * 5. fcm_token 있으면 FCM 푸시 동시 발송 (옵션)
 *
 * 014_notify_cron_schedule.sql이 매일 06시(dday) / 08시(new) cron 등록.
 */

import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import type { Announcement } from "../_shared/types.ts";

interface ProfileRow {
  user_id: string;  // UUID
  profile: Record<string, unknown> | null;
  fcm_token: string | null;
}

const FIREBASE_SERVER_KEY = Deno.env.get("FIREBASE_SERVER_KEY") ?? "";
const ANNOUNCEMENT_FETCH_LIMIT = 500;
const NOTIFICATION_DEDUP_HOURS = 24;

async function sendFCM(fcmToken: string, title: string, body: string, data: Record<string, string>): Promise<void> {
  if (!FIREBASE_SERVER_KEY || !fcmToken) return;
  try {
    await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Authorization": `key=${FIREBASE_SERVER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: fcmToken, notification: { title, body }, data }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    console.warn("FCM send failed:", e);
  }
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function preferredRegions(profile: Record<string, unknown> | null): string[] {
  if (!profile) return [];
  const explicit = profile.preferred_regions;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit.map(String);
  }
  const resident = profile.resident_region;
  return typeof resident === "string" && resident ? [resident] : [];
}

function announcementMatchesProfile(ann: Announcement, regions: string[]): boolean {
  if (regions.length === 0) return false;
  const annRegion = ann.region ?? "";
  if (!annRegion) return false;
  return regions.some(
    (r) => annRegion === r || r.includes(annRegion) || annRegion.includes(r.split(" ")[0]),
  );
}

async function fetchDDayAnnouncements(db: ReturnType<typeof getSupabaseClient>): Promise<Announcement[]> {
  const today = todayDateString();
  const dPlus3 = new Date();
  dPlus3.setDate(dPlus3.getDate() + 3);
  const upper = dPlus3.toISOString().slice(0, 10).replace(/-/g, "");
  const { data, error } = await db
    .from("announcements")
    .select("*")
    .gte("rcept_end", today)
    .lte("rcept_end", upper)
    .order("rcept_end", { ascending: true })
    .limit(ANNOUNCEMENT_FETCH_LIMIT);
  if (error) throw new Error(`announcements query failed: ${error.message}`);
  return (data ?? []) as Announcement[];
}

async function fetchNewAnnouncements(db: ReturnType<typeof getSupabaseClient>): Promise<Announcement[]> {
  // 최근 24시간 내 crawled_at 기준
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("announcements")
    .select("*")
    .gte("crawled_at", since)
    .order("crawled_at", { ascending: false })
    .limit(ANNOUNCEMENT_FETCH_LIMIT);
  if (error) throw new Error(`new announcements query failed: ${error.message}`);
  return (data ?? []) as Announcement[];
}

async function fetchAllProfiles(db: ReturnType<typeof getSupabaseClient>): Promise<ProfileRow[]> {
  const { data, error } = await db
    .from("user_profiles")
    .select("user_id,profile,fcm_token");
  if (error) throw new Error(`user_profiles query failed: ${error.message}`);
  return (data ?? []) as ProfileRow[];
}

/** 같은 user × announcement × type 조합으로 24h 내 알림이 있으면 skip */
async function isDuplicate(
  db: ReturnType<typeof getSupabaseClient>,
  userId: string,
  type: string,
  announcementId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - NOTIFICATION_DEDUP_HOURS * 3600 * 1000).toISOString();
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", type)
    .eq("related_announcement_id", announcementId)
    .gte("created_at", since);
  if (error) {
    console.warn("dedup check failed (allowing):", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

interface NotificationPlan {
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  related_announcement_id: string;
  fcm_token: string | null;
}

function buildNotificationPlan(
  mode: "dday_alert" | "announcement_new",
  user: ProfileRow,
  ann: Announcement,
): NotificationPlan {
  const dDay = ann.d_day ?? null;
  const dDayText = typeof dDay === "number"
    ? (dDay === 0 ? "오늘 마감" : dDay > 0 ? `D-${dDay}` : "마감")
    : "";
  const region = `${ann.region ?? ""} ${ann.district ?? ""}`.trim();

  if (mode === "dday_alert") {
    return {
      user_id: user.user_id,
      type: "dday_alert",
      title: `[${dDayText}] ${ann.name ?? "공고"}`,
      body: `${region} · ${ann.house_type ?? ""} · ${ann.total_units ?? ""}세대 — 마감 임박`,
      link: `/app/notice/${ann.id}`,
      related_announcement_id: ann.id,
      fcm_token: user.fcm_token,
    };
  }
  // announcement_new
  return {
    user_id: user.user_id,
    type: "announcement_new",
    title: `관심 지역 신규 공고: ${ann.name ?? "공고"}`,
    body: `${region} · ${ann.house_type ?? ""} · 마감 ${dDayText || "미정"}`,
    link: `/app/notice/${ann.id}`,
    related_announcement_id: ann.id,
    fcm_token: user.fcm_token,
  };
}

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
  const mode = (url.searchParams.get("mode") ?? "dday_alert") as
    | "dday_alert"
    | "announcement_new";
  if (mode !== "dday_alert" && mode !== "announcement_new") {
    return jsonResponse({ error: "mode must be dday_alert or announcement_new" }, 400);
  }

  const dryRun = url.searchParams.get("dry_run") === "true";

  try {
    const db = getSupabaseClient();

    const announcements = mode === "dday_alert"
      ? await fetchDDayAnnouncements(db)
      : await fetchNewAnnouncements(db);

    if (announcements.length === 0) {
      return jsonResponse({ mode, scanned_announcements: 0, notifications_created: 0 });
    }

    // d_day 계산 (dday_alert 모드에서 title에 사용)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const ann of announcements) {
      const rcept = ann.rcept_end ?? "";
      if (rcept.length >= 8) {
        const fmt = rcept.includes("-")
          ? rcept.slice(0, 10)
          : `${rcept.slice(0, 4)}-${rcept.slice(4, 6)}-${rcept.slice(6, 8)}`;
        const end = new Date(fmt + "T00:00:00");
        ann.d_day = Math.floor((end.getTime() - today.getTime()) / 86_400_000);
      }
    }

    const profiles = await fetchAllProfiles(db);
    let created = 0;
    let skippedDup = 0;
    let fcmSent = 0;

    for (const user of profiles) {
      const regions = preferredRegions(user.profile);
      if (regions.length === 0) continue;

      for (const ann of announcements) {
        if (!announcementMatchesProfile(ann, regions)) continue;

        if (await isDuplicate(db, user.user_id, mode, ann.id)) {
          skippedDup++;
          continue;
        }

        const plan = buildNotificationPlan(mode, user, ann);

        if (dryRun) {
          created++;
          continue;
        }

        const { error: insertErr } = await db.from("notifications").insert({
          user_id: plan.user_id,
          type: plan.type,
          title: plan.title,
          body: plan.body,
          link: plan.link,
          related_announcement_id: plan.related_announcement_id,
        });
        if (insertErr) {
          console.warn(`notify insert failed for ${user.user_id}:`, insertErr.message);
          continue;
        }
        created++;

        if (plan.fcm_token) {
          await sendFCM(plan.fcm_token, plan.title, plan.body, {
            type: plan.type,
            announcement_id: plan.related_announcement_id,
          });
          fcmSent++;
        }
      }
    }

    return jsonResponse({
      mode,
      scanned_announcements: announcements.length,
      scanned_users: profiles.length,
      notifications_created: created,
      skipped_duplicates: skippedDup,
      fcm_sent: fcmSent,
      dry_run: dryRun,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("notify-cron error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
