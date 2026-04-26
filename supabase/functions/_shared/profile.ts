/** Profile JSONB — main의 UserProfile (가점 계산용) + mypage UI 필드 (디스플레이용) 통합.
 *
 * 운영 main DB (김상원, 2026-04-26)에 user_profiles 테이블이 이미 적용됨:
 *   user_id TEXT PK | profile JSONB | score JSONB | updated_at
 *
 * 본 모듈은:
 * - profile JSONB 안에 UserProfile 13개 + mypage UI 12개 필드를 모두 보관
 * - GET 응답 시 derived fields 계산 (age = NOW - birth_date 등)
 * - PATCH 시 부분 머지 + 필드별 검증
 *
 * my-score Edge Function은 UserProfile 부분만 참조 (호환 유지).
 * profile/recommendations Edge Function은 UI 필드 우선, 없으면 UserProfile에서 derive.
 */

import type { UserProfile } from "./eligibility.ts";

/** mypage UI 표시용 추가 필드 — UserProfile에 없는 것들 */
export interface UIProfileExtras {
  nickname?: string;                    // '김청약'
  preferred_regions?: string[];         // ['서울', '경기 남부'] — resident_region(단수)와 별개
  preferred_size_sqm?: number;          // 84
  income_bracket?: string;              // '도시근로자 100% 이하' | '120%' | '140%' | '160%'
  household_type?: string;              // '무주택세대구성원' | '세대주' | '세대원'
  special_supply_interests?: string[];  // ['신혼부부','생애최초','다자녀','노부모부양']
  // 온보딩 진행 추적 (Stitch screen 550553a6 — Step N/5)
  onboarding_step?: number;             // 1..5 (현재 진행 중인 step). 5 도달 시 완료
  onboarding_completed_at?: string;     // ISO datetime — Step 5 완료 시 set
  // 청약통장 납입 횟수 (디자인 필드, savings_start와 별도)
  subscription_contributions?: number;  // 0+, 누적 납입 회차
}

/** user_profiles.profile JSONB 통합 타입 — UserProfile + UIProfileExtras */
export type FullProfile = Partial<UserProfile> & UIProfileExtras;

/** GET 응답에 포함되는 derived fields (저장 안 됨, 매번 계산). */
export interface DerivedFields {
  age?: number;                         // birth_date 기반
  homeless_years?: number;              // homeless_since 기반
  account_join_date?: string;           // savings_start alias (UI용)
  account_balance_won?: number;         // savings_balance_wan * 10000
  marriage_years?: number;              // marriage_date 기반
}

const ALLOWED_FIELDS = new Set<keyof FullProfile>([
  // UserProfile (가점 계산용)
  "birth_date",
  "is_married",
  "marriage_date",
  "dependents_count",
  "is_homeless",
  "homeless_since",
  "savings_start",
  "savings_balance_wan",
  "resident_region",
  "has_house",
  "parents_registered",
  "parents_registered_since",
  // UI extras
  "nickname",
  "preferred_regions",
  "preferred_size_sqm",
  "income_bracket",
  "household_type",
  "special_supply_interests",
  // 온보딩 진행 + 청약통장 납입 횟수 (020 추가)
  "onboarding_step",
  "onboarding_completed_at",
  "subscription_contributions",
]);

/** YYYY-MM-DD 또는 ISO 날짜 문자열 → 경과 년수 (소수 버림). 잘못된 입력은 undefined. */
export function yearsSince(dateStr: string | undefined | null): number | undefined {
  if (!dateStr) return undefined;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return undefined;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
}

/** profile JSONB → derived fields 계산. */
export function deriveFields(profile: FullProfile): DerivedFields {
  const result: DerivedFields = {};
  if (profile.birth_date) {
    const age = yearsSince(profile.birth_date);
    if (age !== undefined) result.age = age;
  }
  if (profile.homeless_since) {
    const years = yearsSince(profile.homeless_since);
    if (years !== undefined) result.homeless_years = years;
  }
  if (profile.marriage_date) {
    const years = yearsSince(profile.marriage_date);
    if (years !== undefined) result.marriage_years = years;
  }
  if (profile.savings_start) {
    result.account_join_date = profile.savings_start;
  }
  if (typeof profile.savings_balance_wan === "number") {
    result.account_balance_won = profile.savings_balance_wan * 10000;
  }
  return result;
}

/** PATCH body에서 ALLOWED_FIELDS만 추출 (알 수 없는 키 무시, undefined 무시). */
export function sanitizeProfileUpdate(body: unknown): FullProfile {
  if (!body || typeof body !== "object") return {};
  const result: FullProfile = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in (body as Record<string, unknown>)) {
      const v = (body as Record<string, unknown>)[key];
      if (v !== undefined) {
        // deno-lint-ignore no-explicit-any
        (result as any)[key] = v;
      }
    }
  }
  return result;
}

/** 간단 검증 — 명백한 invalid만 거부. 누락은 허용 (PATCH는 부분). */
export function validateProfileUpdate(update: FullProfile): string | null {
  if (update.birth_date !== undefined && update.birth_date !== null) {
    if (typeof update.birth_date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(update.birth_date)) {
      return "birth_date must be YYYY-MM-DD";
    }
  }
  if (update.dependents_count !== undefined && update.dependents_count !== null) {
    const n = Number(update.dependents_count);
    if (!Number.isInteger(n) || n < 0 || n > 20) return "dependents_count must be 0..20";
  }
  if (update.savings_balance_wan !== undefined && update.savings_balance_wan !== null) {
    const n = Number(update.savings_balance_wan);
    if (!Number.isFinite(n) || n < 0) return "savings_balance_wan must be >= 0";
  }
  if (update.preferred_size_sqm !== undefined && update.preferred_size_sqm !== null) {
    const n = Number(update.preferred_size_sqm);
    if (!Number.isInteger(n) || n < 10 || n > 500) return "preferred_size_sqm must be 10..500";
  }
  if (update.preferred_regions !== undefined && !Array.isArray(update.preferred_regions)) {
    return "preferred_regions must be array";
  }
  if (
    update.special_supply_interests !== undefined &&
    !Array.isArray(update.special_supply_interests)
  ) {
    return "special_supply_interests must be array";
  }
  // 온보딩
  if (update.onboarding_step !== undefined && update.onboarding_step !== null) {
    const n = Number(update.onboarding_step);
    if (!Number.isInteger(n) || n < 1 || n > 10) return "onboarding_step must be 1..10";
  }
  if (update.onboarding_completed_at !== undefined && update.onboarding_completed_at !== null) {
    if (typeof update.onboarding_completed_at !== "string") {
      return "onboarding_completed_at must be ISO datetime string";
    }
    if (Number.isNaN(new Date(update.onboarding_completed_at).getTime())) {
      return "onboarding_completed_at must be valid ISO datetime";
    }
  }
  if (update.subscription_contributions !== undefined && update.subscription_contributions !== null) {
    const n = Number(update.subscription_contributions);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      return "subscription_contributions must be 0..10000";
    }
  }
  return null;
}

/** 부분 업데이트 머지 — 기존 profile JSONB + update를 얕게 병합. update의 명시 값이 우선. */
export function mergeProfile(existing: FullProfile, update: FullProfile): FullProfile {
  return { ...existing, ...update };
}
