/** 사용자 프로필 ↔ 공고 매칭 + notifications 생성 공통 로직.
 *
 * 사용처:
 * - notify-cron Edge Function (전체 사용자 자동 매칭, 매일 06/08시)
 * - notifications/refresh 라우트 (인증된 본인 1인 매칭, 사용자 트리거)
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Announcement } from "./types.ts";
import { sendFCM } from "./fcm.ts";

export type NotifyMode = "dday_alert" | "announcement_new";

export interface ProfileRow {
  user_id: string;  // UUID
  profile: Record<string, unknown> | null;
  fcm_token: string | null;
}

export interface MatchStats {
  scanned_announcements: number;
  scanned_users: number;
  notifications_created: number;
  skipped_duplicates: number;
  fcm_sent: number;
}

const NOTIFICATION_DEDUP_HOURS = 24;
const ANNOUNCEMENT_FETCH_LIMIT = 500;

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** profile JSONB에서 매칭에 쓸 지역 목록 추출. preferred_regions 우선, resident_region 폴백. */
export function preferredRegions(profile: Record<string, unknown> | null): string[] {
  if (!profile) return [];
  const explicit = profile.preferred_regions;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit.map(String);
  const resident = profile.resident_region;
  return typeof resident === "string" && resident ? [resident] : [];
}

/** 공고 region이 사용자 선호 지역과 매칭되는지 검사. */
export function announcementMatchesRegions(ann: Announcement, regions: string[]): boolean {
  if (regions.length === 0) return false;
  const annRegion = ann.region ?? "";
  if (!annRegion) return false;
  return regions.some(
    (r) => annRegion === r || r.includes(annRegion) || annRegion.includes(r.split(" ")[0]),
  );
}

/** mode별 active/relevant 공고 페치. */
export async function fetchAnnouncementsForMode(
  db: SupabaseClient,
  mode: NotifyMode,
): Promise<Announcement[]> {
  if (mode === "dday_alert") {
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
  // announcement_new — 최근 24h crawled
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

/** rcept_end YYYYMMDD/YYYY-MM-DD → d_day 채워넣기 (in-place). */
export function decorateDDay(announcements: Announcement[]): void {
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
}

/** 24h 내 (user × type × announcement) 알림 존재 여부. */
export async function isDuplicate(
  db: SupabaseClient,
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
}

function buildPlan(mode: NotifyMode, userId: string, ann: Announcement): NotificationPlan {
  const dDay = ann.d_day ?? null;
  const dDayText = typeof dDay === "number"
    ? (dDay === 0 ? "오늘 마감" : dDay > 0 ? `D-${dDay}` : "마감")
    : "";
  const region = `${ann.region ?? ""} ${ann.district ?? ""}`.trim();

  if (mode === "dday_alert") {
    return {
      user_id: userId,
      type: "dday_alert",
      title: `[${dDayText}] ${ann.name ?? "공고"}`,
      body: `${region} · ${ann.house_type ?? ""} · ${ann.total_units ?? ""}세대 — 마감 임박`,
      link: `/app/notice/${ann.id}`,
      related_announcement_id: ann.id,
    };
  }
  return {
    user_id: userId,
    type: "announcement_new",
    title: `관심 지역 신규 공고: ${ann.name ?? "공고"}`,
    body: `${region} · ${ann.house_type ?? ""} · 마감 ${dDayText || "미정"}`,
    link: `/app/notice/${ann.id}`,
    related_announcement_id: ann.id,
  };
}

export interface MatchOptions {
  dryRun?: boolean;
  /** undefined면 모든 user_profiles 순회, 명시되면 그 사용자만 */
  targetUserId?: string;
}

/** mode별 공고 × 사용자 매칭 → notifications insert + (옵셔널) FCM. */
export async function runNotifyMatch(
  db: SupabaseClient,
  mode: NotifyMode,
  options: MatchOptions = {},
): Promise<MatchStats> {
  const announcements = await fetchAnnouncementsForMode(db, mode);
  decorateDDay(announcements);

  const stats: MatchStats = {
    scanned_announcements: announcements.length,
    scanned_users: 0,
    notifications_created: 0,
    skipped_duplicates: 0,
    fcm_sent: 0,
  };

  if (announcements.length === 0) return stats;

  // 프로필 페치 — 단일 또는 전체
  let profiles: ProfileRow[];
  if (options.targetUserId) {
    const { data, error } = await db
      .from("user_profiles")
      .select("user_id,profile,fcm_token")
      .eq("user_id", options.targetUserId)
      .maybeSingle();
    if (error) throw new Error(`user_profiles query failed: ${error.message}`);
    profiles = data ? [data as ProfileRow] : [];
  } else {
    const { data, error } = await db
      .from("user_profiles")
      .select("user_id,profile,fcm_token");
    if (error) throw new Error(`user_profiles query failed: ${error.message}`);
    profiles = (data ?? []) as ProfileRow[];
  }

  stats.scanned_users = profiles.length;

  for (const user of profiles) {
    const regions = preferredRegions(user.profile);
    if (regions.length === 0) continue;

    for (const ann of announcements) {
      if (!announcementMatchesRegions(ann, regions)) continue;

      if (await isDuplicate(db, user.user_id, mode, ann.id)) {
        stats.skipped_duplicates++;
        continue;
      }

      const plan = buildPlan(mode, user.user_id, ann);

      if (options.dryRun) {
        stats.notifications_created++;
        continue;
      }

      const { error: insertErr } = await db.from("notifications").insert(plan);
      if (insertErr) {
        console.warn(`notify insert failed for ${user.user_id}:`, insertErr.message);
        continue;
      }
      stats.notifications_created++;

      if (user.fcm_token) {
        // _shared/fcm.ts (HTTP v1, OAuth Service Account) 사용.
        // data payload는 현재 _shared/fcm.ts 시그니처가 미지원 — title/body만 발송.
        await sendFCM(user.fcm_token, plan.title, plan.body);
        stats.fcm_sent++;
      }
    }
  }

  return stats;
}
