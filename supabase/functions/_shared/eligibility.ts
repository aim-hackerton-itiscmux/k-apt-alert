/** 청약 가점 계산 + 부적격 위험 사전검증 공통 로직. */

export interface UserProfile {
  birth_date: string;           // "1990-01-15"
  is_married: boolean;
  marriage_date?: string;       // "2020-03-20"
  dependents_count: number;     // 부양가족 수 (본인 제외)
  is_homeless: boolean;         // 현재 무주택 여부
  homeless_since?: string;      // "2015-06-01" — 무주택 시작일
  savings_start: string;        // "2010-03-15" — 청약통장 가입일
  savings_balance_wan: number;  // 예치금 (만원)
  resident_region: string;      // "서울" — 현재 거주 시도
  has_house: boolean;           // 주택 소유 여부
  parents_registered: boolean;  // 직계존속 주민등록 동일세대 등재 여부
  parents_registered_since?: string; // 등재 시작일
}

export interface ScoreBreakdown {
  homeless_years: number;
  homeless_score: number;       // max 32
  dependents_score: number;     // max 35
  savings_months: number;
  savings_score: number;        // max 17
  total: number;                // max 84
  next_upgrade?: {
    field: "homeless" | "savings";
    days_until: number;
    score_gain: number;
  };
}

export interface EligibilityWarning {
  field: string;
  severity: "critical" | "warning" | "info";
  message: string;
  detail: string;
}

// ── 점수 테이블 ──────────────────────────────────────────────

function homelessScore(years: number): number {
  if (years < 1) return 2;
  return Math.min(2 + Math.floor(years) * 2, 32);
}

function dependentsScore(count: number): number {
  return Math.min(5 + count * 5, 35);
}

function savingsScore(months: number): number {
  if (months < 6) return 1;
  if (months < 12) return 2;
  return Math.min(2 + Math.floor(months / 12), 17);
}

// ── 날짜 유틸 ────────────────────────────────────────────────

function yearsBetween(from: string, to = new Date().toISOString().slice(0, 10)): number {
  const d1 = new Date(from);
  const d2 = new Date(to);
  return (d2.getTime() - d1.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function monthsBetween(from: string, to = new Date().toISOString().slice(0, 10)): number {
  const d1 = new Date(from);
  const d2 = new Date(to);
  return (d2.getTime() - d1.getTime()) / (30.44 * 24 * 3600 * 1000);
}

function daysUntilNextYear(from: string): number {
  const now = new Date();
  const start = new Date(from);
  const years = Math.floor((now.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000));
  const nextMilestone = new Date(start);
  nextMilestone.setFullYear(start.getFullYear() + years + 1);
  return Math.ceil((nextMilestone.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

function daysUntilNextSavingsMilestone(savingsMonths: number, from: string): number {
  const now = new Date();
  const start = new Date(from);
  // 다음 월 경계까지의 일수
  const nextMs = Math.ceil(savingsMonths / 6) * 6; // 6개월 단위로 점프
  const nextDate = new Date(start);
  nextDate.setMonth(start.getMonth() + nextMs);
  return Math.ceil((nextDate.getTime() - now.getTime()) / (24 * 3600 * 1000));
}

/** 무주택 기간 기산일 계산 (30세/혼인신고일 중 늦은 날 vs homeless_since). */
function homelessStartDate(profile: UserProfile): string | null {
  if (!profile.is_homeless) return null;

  const birth = new Date(profile.birth_date);
  const thirtiethBirthday = new Date(birth);
  thirtiethBirthday.setFullYear(birth.getFullYear() + 30);

  const candidates: Date[] = [thirtiethBirthday];

  if (profile.is_married && profile.marriage_date) {
    candidates.push(new Date(profile.marriage_date));
  }
  if (profile.homeless_since) {
    candidates.push(new Date(profile.homeless_since));
  }

  // 기산일 = 가장 늦은 날짜 (가장 불리한 기산)
  // but homeless_since가 있으면 그것도 고려 — 실제론 MAX(법적기준일, homeless_since)
  const legalStart = candidates.slice(0, candidates.length - (profile.homeless_since ? 1 : 0))
    .reduce((a, b) => (a > b ? a : b));
  const effective = profile.homeless_since
    ? new Date(Math.max(legalStart.getTime(), new Date(profile.homeless_since).getTime()))
    : legalStart;

  return effective.toISOString().slice(0, 10);
}

// ── 공개 API ─────────────────────────────────────────────────

/** 가점 계산. */
export function calcScore(profile: UserProfile): ScoreBreakdown {
  const startDate = homelessStartDate(profile);
  const homelessYears = startDate ? Math.max(0, yearsBetween(startDate)) : 0;
  const savingsMonths = Math.max(0, monthsBetween(profile.savings_start));

  const hScore = profile.is_homeless ? homelessScore(homelessYears) : 0;
  const dScore = dependentsScore(profile.dependents_count);
  const sScore = savingsScore(savingsMonths);

  // 다음 업그레이드 계산
  let nextUpgrade: ScoreBreakdown["next_upgrade"];
  const nextHScore = profile.is_homeless ? homelessScore(homelessYears + 1) : 0;
  const nextSScore = savingsScore(savingsMonths + 6);
  const hDays = startDate ? daysUntilNextYear(startDate) : Infinity;
  const sDays = daysUntilNextSavingsMilestone(savingsMonths, profile.savings_start);

  if (hScore < 32 && profile.is_homeless && nextHScore > hScore) {
    nextUpgrade = { field: "homeless", days_until: hDays, score_gain: nextHScore - hScore };
  }
  if (sScore < 17 && nextSScore > sScore && sDays < hDays) {
    nextUpgrade = { field: "savings", days_until: sDays, score_gain: nextSScore - sScore };
  }

  return {
    homeless_years: Math.round(homelessYears * 10) / 10,
    homeless_score: hScore,
    dependents_score: dScore,
    savings_months: Math.round(savingsMonths),
    savings_score: sScore,
    total: hScore + dScore + sScore,
    next_upgrade: nextUpgrade,
  };
}

/** 부적격 위험 경고 목록 생성. announcement는 announcements 테이블 row. */
export function checkEligibility(
  profile: UserProfile,
  ann: Record<string, unknown>,
): EligibilityWarning[] {
  const warnings: EligibilityWarning[] = [];
  const today = new Date();
  const birthDate = new Date(profile.birth_date);
  const ageYears = (today.getTime() - birthDate.getTime()) / (365.25 * 24 * 3600 * 1000);

  const speculativeZone = String(ann.speculative_zone ?? "N") === "Y";
  const priceControlled = String(ann.price_controlled ?? "N") === "Y";
  const maxSizeM2 = parseMaxSize(String(ann.size ?? ""));

  // 1. 직계존속 부양가족 3년 미만
  if (profile.parents_registered && profile.parents_registered_since) {
    const months = monthsBetween(profile.parents_registered_since);
    if (months < 36) {
      warnings.push({
        field: "parents_registered",
        severity: "critical",
        message: `직계존속 등재 ${Math.round(months)}개월 → 36개월 미만이라 부양가족 인정 안 됨`,
        detail: "부양가족 조건: 직계존속은 최근 3년 이상 동일 세대 주민등록 유지 필요. 부양가족 점수 미인정 시 최대 -5점",
      });
    }
  }

  // 2. 30세 미만 미혼 → 무주택 기간 0 + 일반공급 1순위 가점제 사실상 불가
  //    (단독세대주 예외는 정보 부족이라 보수적으로 critical 처리)
  if (!profile.is_married && ageYears < 30) {
    warnings.push({
      field: "homeless_period",
      severity: "critical",
      message: `30세 미만 미혼 → 무주택 기간 0년, 일반공급 1순위 가점제 사실상 부적격`,
      detail: `무주택 기간은 만 30세 또는 혼인신고일부터 산정. 현재 만 ${Math.floor(ageYears)}세이라 가점이 매우 낮아 가점제 당첨 어려움. 추첨제(소형 평수) 또는 특별공급(생애최초 등) 검토 권장`,
    });
  }

  // 3. 투기과열지구 1순위 청약통장 가입기간 2년 미달
  if (speculativeZone) {
    const savingsMonths = monthsBetween(profile.savings_start);
    if (savingsMonths < 24) {
      warnings.push({
        field: "savings_period",
        severity: "critical",
        message: `투기과열지구 1순위 요건: 청약통장 24개월 이상 — 현재 ${Math.round(savingsMonths)}개월`,
        detail: "투기과열지구 아파트는 청약통장 가입 후 2년이 지나야 1순위 자격 발생",
      });
    }
  }

  // 4. 청약통장 예치금 부족
  if (maxSizeM2 !== null) {
    const minDeposit = getMinDeposit(profile.resident_region, maxSizeM2, speculativeZone);
    if (profile.savings_balance_wan < minDeposit) {
      warnings.push({
        field: "savings_balance",
        severity: "critical",
        message: `예치금 ${profile.savings_balance_wan.toLocaleString()}만원 — 해당 면적 기준 ${minDeposit.toLocaleString()}만원 미달`,
        detail: `${profile.resident_region} 지역 ${Math.round(maxSizeM2)}㎡ 이하 아파트 신청 시 최소 예치금 ${minDeposit.toLocaleString()}만원 필요`,
      });
    }
  }

  // 5. 투기과열지구 실거주 의무 안내
  if (speculativeZone) {
    warnings.push({
      field: "residence_obligation",
      severity: "info",
      message: "투기과열지구 당첨 시 전매 제한 + 실거주 의무 발생",
      detail: "투기과열지구 아파트는 당첨 후 입주일로부터 최대 5년 실거주 의무 + 전매 제한 적용",
    });
  }

  // 6. 분상제 + 투기과열 → 장기 전매제한
  if (priceControlled && speculativeZone) {
    warnings.push({
      field: "resale_restriction",
      severity: "warning",
      message: "분양가상한제 + 투기과열지구 → 전매제한 최대 10년",
      detail: "분양가상한제 적용 + 투기과열지구 아파트는 최장 10년 전매제한. 투자 목적이라면 유동성 리스크 주의",
    });
  }

  // 7. 유주택자 일반공급 1순위 부적격 (전국 공통)
  if (profile.has_house) {
    warnings.push({
      field: "house_ownership",
      severity: "critical",
      message: "주택 보유자 → 일반공급 1순위 청약 부적격",
      detail: speculativeZone
        ? "투기과열지구는 유주택자 1순위 신청 불가 — 2순위(추첨제)로만 청약 가능"
        : "일반공급 1순위는 세대원 전원 무주택 필요. 유주택자는 2순위로만 신청 가능 (대부분 추첨제 한정). 다주택자라면 특별공급도 부적격",
    });
  }

  // 8. 비투기과열 1순위 청약통장 12개월 미달
  if (!speculativeZone) {
    const savingsMonths = monthsBetween(profile.savings_start);
    if (savingsMonths < 12) {
      warnings.push({
        field: "savings_period",
        severity: "critical",
        message: `1순위 자격 미달: 청약통장 12개월 이상 필요 — 현재 ${Math.round(savingsMonths)}개월`,
        detail: "수도권/지방 비조정지역 일반공급 1순위는 청약통장 가입 후 12개월 경과 필요. 미달 시 2순위로만 신청 가능",
      });
    }
  }

  return warnings;
}

/** 지역 + 면적으로 최소 예치금(만원) 계산. */
function getMinDeposit(region: string, maxSizeM2: number, speculativeZone: boolean): number {
  if (speculativeZone || region === "서울" || region === "부산") {
    if (maxSizeM2 <= 85) return 300;
    if (maxSizeM2 <= 102) return 600;
    if (maxSizeM2 <= 135) return 1000;
    return 1500;
  }
  if (["인천", "경기", "대구", "광주", "대전", "울산", "세종"].includes(region)) {
    if (maxSizeM2 <= 85) return 250;
    if (maxSizeM2 <= 102) return 400;
    if (maxSizeM2 <= 135) return 700;
    return 1000;
  }
  // 기타
  if (maxSizeM2 <= 85) return 200;
  if (maxSizeM2 <= 102) return 300;
  if (maxSizeM2 <= 135) return 400;
  return 500;
}

function parseMaxSize(size: string): number | null {
  const nums = [...size.matchAll(/(\d+(?:\.\d+)?)\s*㎡/g)].map((m) => parseFloat(m[1]));
  return nums.length > 0 ? Math.max(...nums) : null;
}
