/** /v1/announcement-detail — 단일 공고 상세 (앱 '공고 상세' 화면)
 *
 * Stitch screen 9d762970 분석 기반:
 * - 공고 메타 (위치/규모/일정/분양가)
 * - 사용자 맞춤 진단 (가점 + 특공 자격) — 인증 시 inline
 * - 최근 변경 내역 (정정공고) 메타
 *
 * 설계:
 * - 인증 옵셔널 — 비회원도 공고 메타·변경 내역 조회 가능
 * - 인증 시 user_profiles에서 UserProfile 추출 → calcScore + checkEligibility 통합
 * - 변경 내역은 최근 5건만 (전체는 /announcement-changes endpoint)
 *
 * 라우트:
 *   GET /v1/announcement-detail?announcement_id=X
 *     → { announcement, recent_changes, diagnosis (인증 시) }
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getUserOrNull } from "../_shared/auth.ts";
import { calcScore, checkEligibility, type UserProfile } from "../_shared/eligibility.ts";
import { addDDay } from "../_shared/d-day.ts";
import type { Announcement } from "../_shared/types.ts";

interface DiagnosisBlock {
  score: ReturnType<typeof calcScore>;
  warnings: ReturnType<typeof checkEligibility>;
  warning_summary: { critical: number; warning: number; info: number };
  profile_used: boolean;
}

async function loadAnnouncement(
  db: ReturnType<typeof getSupabaseClient>,
  announcementId: string,
): Promise<Announcement | null> {
  const { data, error } = await db
    .from("announcements")
    .select("*")
    .eq("id", announcementId)
    .maybeSingle();
  if (error) throw new Error(`announcement read failed: ${error.message}`);
  return data ? addDDay(data as Announcement) : null;
}

async function loadRecentChanges(
  db: ReturnType<typeof getSupabaseClient>,
  announcementId: string,
  limit = 5,
) {
  const { data, error } = await db
    .from("announcement_changes")
    .select("id,detected_at,field,field_label_ko,change_type,old_value,new_value")
    .eq("announcement_id", announcementId)
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) {
    // 018 마이그레이션 미적용 시 부드럽게 빈 배열
    console.warn(`announcement_changes read failed: ${error.message}`);
    return [];
  }
  return data ?? [];
}

async function loadUserProfile(
  db: ReturnType<typeof getSupabaseClient>,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await db
    .from("user_profiles")
    .select("profile")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn(`user_profile read failed: ${error.message}`);
    return null;
  }
  if (!data?.profile) return null;
  // FullProfile은 UserProfile + UI extras 합집합 — UserProfile 부분만 추출 (남는 키는 무시)
  return data.profile as UserProfile;
}

function summarizeWarnings(warnings: ReturnType<typeof checkEligibility>) {
  return {
    critical: warnings.filter((w) => w.severity === "critical").length,
    warning: warnings.filter((w) => w.severity === "warning").length,
    info: warnings.filter((w) => w.severity === "info").length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  }

  try {
    const url = new URL(req.url);
    const announcementId = url.searchParams.get("announcement_id");
    if (!announcementId) {
      return jsonResponse({ error: "announcement_id query param required" }, 400);
    }

    const db = getSupabaseClient();

    // 1. 공고 + 변경 내역 병렬 조회 (공개)
    const [announcement, recentChanges] = await Promise.all([
      loadAnnouncement(db, announcementId),
      loadRecentChanges(db, announcementId, 5),
    ]);

    if (!announcement) {
      return jsonResponse({ error: `announcement '${announcementId}' not found` }, 404);
    }

    // 2. 사용자 인증 옵셔널 — 있으면 진단 추가
    let diagnosis: DiagnosisBlock | null = null;
    const user = await getUserOrNull(req);
    if (user) {
      const profile = await loadUserProfile(db, user.id);
      if (profile && profile.birth_date) {
        try {
          const score = calcScore(profile);
          const warnings = checkEligibility(profile, announcement as unknown as Record<string, unknown>);
          diagnosis = {
            score,
            warnings,
            warning_summary: summarizeWarnings(warnings),
            profile_used: true,
          };
        } catch (e) {
          // calcScore/checkEligibility 실패해도 본문은 정상 반환
          console.warn(`diagnosis failed for user ${user.id}: ${e}`);
        }
      } else {
        // 토큰은 있는데 프로필 없거나 birth_date 누락
        diagnosis = {
          score: { homeless_years: 0, homeless_score: 0, dependents_score: 0, savings_months: 0, savings_score: 0, total: 0 },
          warnings: [],
          warning_summary: { critical: 0, warning: 0, info: 0 },
          profile_used: false,
        };
      }
    }

    return jsonResponse({
      announcement,
      recent_changes: recentChanges,
      change_count: recentChanges.length,
      has_changes: recentChanges.length > 0,
      diagnosis,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`announcement-detail error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
