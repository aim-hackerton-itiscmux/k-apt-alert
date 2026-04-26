/** /v1/recommendations — 프로필 기반 Top N 추천 (앱 홈 탭)
 *
 * 운영 main DB의 `user_profiles.profile` JSONB에서 매칭에 필요한 필드 추출:
 * - preferred_regions (UI extras, 다중 선호지역)
 * - resident_region (UserProfile, 단수 거주지) — preferred_regions 없을 때 폴백
 * - preferred_size_sqm
 * - is_homeless / has_house (둘 다 보고 무주택 여부 판정)
 * - special_supply_interests
 *
 * 매칭 점수 (max ~85점):
 * - 선호지역 일치 +30
 * - 선호평형(±25㎡) 일치 +20
 * - 무주택 + 민영 → 일반공급 1순위 추정 +15
 * - 특공 관심 카테고리 매칭 +10
 * - 분양가 상한제 +5
 * - 1군 시공사 +5
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { addDDay } from "../_shared/d-day.ts";
import type { Announcement } from "../_shared/types.ts";
import type { FullProfile } from "../_shared/profile.ts";

interface Recommendation {
  announcement: Announcement;
  match_score: number;
  match_reasons: string[];
}

const TIER1_CONSTRUCTORS = ["삼성", "현대", "GS", "대우", "롯데", "포스코", "DL", "HDC"];

/** size 문자열에서 평형 추정 — '소형/중형' → 50, '대형' → 100. 가중치용 휴리스틱. */
function estimateSizeSqm(sizeStr: string): number {
  if (!sizeStr) return 0;
  const last = sizeStr.split("/").pop() ?? "";
  if (last.includes("대형")) return 100;
  if (last.includes("중형")) return 75;
  if (last.includes("소형")) return 50;
  return 0;
}

/** profile JSONB에서 매칭용 필드 추출. UI extras 우선, 없으면 UserProfile 폴백. */
function extractMatchFields(profile: FullProfile) {
  const regions: string[] = profile.preferred_regions && profile.preferred_regions.length > 0
    ? profile.preferred_regions
    : profile.resident_region
      ? [profile.resident_region]
      : [];

  const isHomeless = profile.is_homeless === true ||
    (profile.has_house === false && profile.is_homeless !== false);

  return {
    regions,
    preferredSize: profile.preferred_size_sqm ?? 0,
    isHomeless,
    interests: profile.special_supply_interests ?? [],
  };
}

function scoreAnnouncement(
  ann: Announcement,
  match: ReturnType<typeof extractMatchFields>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 지역 매칭
  if (match.regions.length > 0 && ann.region) {
    const hit = match.regions.find(
      (r) => ann.region === r || r.includes(ann.region) || ann.region.includes(r.split(" ")[0]),
    );
    if (hit) {
      score += 30;
      reasons.push(`선호지역(${ann.region}) 일치`);
    }
  }

  // 평형 매칭
  if (match.preferredSize > 0) {
    const annSize = estimateSizeSqm(ann.size);
    if (annSize > 0 && Math.abs(annSize - match.preferredSize) <= 25) {
      score += 20;
      reasons.push(`선호평형(${match.preferredSize}㎡대) 일치`);
    }
  }

  // 무주택 + 민영 → 1순위 추정
  if (match.isHomeless && ann.house_type?.includes("민영")) {
    score += 15;
    reasons.push("일반공급 1순위 추정 자격");
  }

  // 특공 관심 (공고가 어떤 특공인지 정확히 파싱은 어려우므로 generic +10)
  if (match.interests.length > 0 && ann.house_type) {
    score += 10;
    reasons.push(`특별공급 관심 매칭 (${match.interests.join(",")})`);
  }

  // 분양가 상한제
  if (ann.price_controlled === "Y") {
    score += 5;
    reasons.push("분양가 상한제 단지");
  }

  // 1군 시공사
  if (ann.constructor && TIER1_CONSTRUCTORS.some((c) => ann.constructor.includes(c))) {
    score += 5;
    reasons.push(`1군 시공사 (${ann.constructor})`);
  }

  return { score, reasons };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  }

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get("limit") ?? "3", 10)));

    const db = getSupabaseClient();

    // user_profiles.profile JSONB 조회
    const profileResp = await db
      .from("user_profiles")
      .select("profile")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileResp.error) {
      return jsonResponse({ error: `profile read failed: ${profileResp.error.message}` }, 500);
    }
    const profile = (profileResp.data?.profile ?? null) as FullProfile | null;
    if (!profile || Object.keys(profile).length === 0) {
      return jsonResponse(
        {
          error: "profile not found or empty — initialize via PATCH /v1/profile first",
          recommendations: [],
        },
        404,
      );
    }

    const match = extractMatchFields(profile);

    // active 공고
    const today = new Date().toISOString().slice(0, 10);
    const annResp = await db
      .from("announcements")
      .select("*")
      .gte("rcept_end", today)
      .order("rcept_end", { ascending: true })
      .limit(200);
    if (annResp.error) {
      return jsonResponse({ error: `ann read failed: ${annResp.error.message}` }, 500);
    }
    const announcements = (annResp.data ?? []) as Announcement[];

    // 점수 계산 + 정렬 + Top N
    const scored: Recommendation[] = announcements
      .map((ann) => {
        const { score, reasons } = scoreAnnouncement(ann, match);
        return { announcement: addDDay(ann), match_score: score, match_reasons: reasons };
      })
      .filter((r) => r.match_score > 0)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit);

    return jsonResponse({
      recommendations: scored,
      profile_used: true,
      match_fields_used: {
        regions: match.regions,
        preferred_size_sqm: match.preferredSize || null,
        is_homeless: match.isHomeless,
        interests: match.interests,
      },
      total_active: announcements.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`recommendations error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
