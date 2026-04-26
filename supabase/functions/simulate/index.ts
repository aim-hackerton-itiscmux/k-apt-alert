/** POST /v1/apt/simulate — 청약 프로세스 단계별 시뮬레이션 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { calcScore, checkEligibility, UserProfile } from "../_shared/eligibility.ts";
import { generateText } from "../_shared/gemini.ts";

export type SupplyType = "일반공급" | "특별공급_신혼부부" | "특별공급_생애최초" | "특별공급_다자녀" | "특별공급_노부모";

interface SimStep {
  order: number;
  phase: string;           // 타임라인 레이블 ("D-60 이전" 등)
  title: string;
  checklist: string[];     // 해야 할 일 목록
  warnings: string[];      // 이 단계 주의사항
  tips: string[];          // 실용 팁
}

// 청약 프로세스 5단계 템플릿
function buildSteps(
  ann: Record<string, unknown>,
  supplyType: SupplyType,
  profile: UserProfile | null,
  warnings: Array<{ severity: string; message: string; field: string }>,
): SimStep[] {
  const isSpecial = supplyType.startsWith("특별공급");
  const isSpeculative = String(ann.speculative_zone ?? "N") === "Y";
  const isPriceControlled = String(ann.price_controlled ?? "N") === "Y";

  const criticals = warnings.filter((w) => w.severity === "critical").map((w) => w.message);
  const cautions  = warnings.filter((w) => w.severity === "warning").map((w) => w.message);

  const steps: SimStep[] = [
    {
      order: 1,
      phase: "청약 전 (D-60 이전)",
      title: "자격 요건 확인",
      checklist: [
        "무주택 세대구성원 여부 확인 (세대원 전원 무주택)",
        isSpeculative ? "투기과열지구 — 청약통장 24개월 이상 납입 확인" : "청약통장 가입 기간 확인 (1순위: 12개월 이상)",
        "주민등록등본 확인 (세대원 현황)",
        profile ? `현재 가점: ${calcScore(profile).total}점 / 84점` : "가점제 해당 여부 확인",
      ],
      warnings: criticals,
      tips: [
        "청약홈(applyhome.co.kr) 공인인증서 미리 등록",
        "청약통장 잔액·납입 횟수 은행 앱에서 확인",
      ],
    },
    {
      order: 2,
      phase: "청약 준비 (D-30)",
      title: `공급 유형 확인 — ${supplyType}`,
      checklist: isSpecial ? [
        `${supplyType} 자격 서류 준비 (혼인관계증명서 / 출생증명서 등)`,
        "소득 기준 충족 여부 확인 (도시근로자 월평균 소득 기준)",
        "특별공급 접수 일정 확인 (일반공급보다 1~2일 빠름)",
      ] : [
        "가점제 vs 추첨제 비율 확인 (공고문 내 주택형별 공급 방법)",
        isPriceControlled ? "분양가상한제 적용 — 전매제한 기간 확인" : "전매제한 조건 공고문 확인",
        isSpeculative ? "투기과열지구 — 재당첨 제한 5년 확인" : "재당첨 제한 여부 확인",
      ],
      warnings: cautions,
      tips: [
        "공고문 PDF 다운로드 후 '주택형', '공급 방법', '당첨자 선정' 섹션 반드시 확인",
        "가점 계산기 앱으로 최종 가점 재확인",
      ],
    },
    {
      order: 3,
      phase: "청약 신청 (청약 기간 중)",
      title: "청약홈 온라인 신청",
      checklist: [
        "청약홈(applyhome.co.kr) 로그인 → 아파트 청약 → 해당 공고 검색",
        "희망 주택형 선택 후 청약통장 정보 입력",
        "신청자 정보 확인 (세대구성원 명단 자동 조회)",
        "신청 완료 후 접수증 캡처 저장",
      ],
      warnings: [
        "청약 신청은 1인 1건만 가능 — 중복 신청 시 전부 무효",
        "청약 기간 마지막 날 서버 폭주 — 가능한 첫날 신청 권장",
      ],
      tips: [
        "청약 기간: " + String(ann.period ?? "공고문 확인"),
        "청약홈 앱(모바일)으로도 신청 가능",
        "신청 후 '나의 청약' 메뉴에서 접수 확인",
      ],
    },
    {
      order: 4,
      phase: "당첨자 발표 후",
      title: "당첨 확인 및 서류 제출",
      checklist: [
        "청약홈 → 나의 청약 → 당첨 여부 확인",
        ann.winner_date ? `당첨자 발표일: ${ann.winner_date}` : "당첨자 발표일 공고문 확인",
        "당첨 시 주민등록등본 (3개월 이내 발급)",
        "무주택확인서, 청약통장 해지 여부 확인",
        isSpecial ? "특별공급 증빙서류 추가 제출" : "가점 계산 근거 서류 준비",
      ],
      warnings: [
        "서류 미제출 또는 허위 서류 → 당첨 취소 + 재당첨 제한",
        "부적격 당첨 확인 시 즉시 시행사에 연락 (자진 포기 처리)",
      ],
      tips: [
        "서류 제출 기간 보통 3~5일 — 일정 꼭 확인",
        "공고문의 '당첨자 서류' 항목 체크리스트 인쇄 권장",
      ],
    },
    {
      order: 5,
      phase: "계약 (당첨 후 1~2주)",
      title: "계약 체결 및 향후 일정",
      checklist: [
        ann.contract_start ? `계약 기간: ${ann.contract_start} ~ ${ann.contract_end ?? ""}` : "계약 기간 공고문 확인",
        "계약금 납부 준비 (통상 분양가의 10%)",
        "계약서 서명 시 옵션 항목 꼼꼼히 확인",
        isPriceControlled ? "분양가상한제 — 실거주 의무 기간 계약서 확인" : "전매제한 조항 계약서 확인",
        isSpeculative ? "투기과열지구 — 실거주 의무 서약서 포함" : "",
      ].filter(Boolean),
      warnings: [
        isSpeculative && isPriceControlled ? "투기과열 + 분상제 → 전매 최대 10년, 실거주 5년 의무" : "",
        "계약 포기 시 청약통장 부활 불가 (해지 처리됨)",
      ].filter(Boolean),
      tips: [
        "계약 당일 인감도장 + 신분증 필참",
        "중도금 대출 일정 미리 은행과 상담 (입주 2~3년 전부터)",
      ],
    },
  ];

  return steps;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const announcementId = String(body.announcement_id ?? "");
  const supplyType = (body.supply_type as SupplyType) ?? "일반공급";
  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  const { data: ann, error } = await db
    .from("announcements")
    .select("id,name,region,district,size,speculative_zone,price_controlled,period,winner_date,contract_start,contract_end")
    .eq("id", announcementId)
    .single();

  if (error || !ann) return jsonResponse({ error: "announcement not found" }, 404);

  // 프로필이 있으면 부적격 체크도 수행
  let profile: UserProfile | null = null;
  let eligibilityWarnings: ReturnType<typeof checkEligibility> = [];

  if (body.user_profile) {
    const p = body.user_profile as Record<string, unknown>;
    profile = {
      birth_date:              String(p.birth_date ?? "1990-01-01"),
      is_married:              Boolean(p.is_married ?? false),
      marriage_date:           p.marriage_date ? String(p.marriage_date) : undefined,
      dependents_count:        Number(p.dependents_count ?? 0),
      is_homeless:             Boolean(p.is_homeless ?? true),
      homeless_since:          p.homeless_since ? String(p.homeless_since) : undefined,
      savings_start:           String(p.savings_start ?? "2020-01-01"),
      savings_balance_wan:     Number(p.savings_balance_wan ?? 0),
      resident_region:         String(p.resident_region ?? "서울"),
      has_house:               Boolean(p.has_house ?? false),
      parents_registered:      Boolean(p.parents_registered ?? false),
      parents_registered_since: p.parents_registered_since ? String(p.parents_registered_since) : undefined,
    };
    eligibilityWarnings = checkEligibility(profile, ann as Record<string, unknown>);
  }

  const steps = buildSteps(ann as Record<string, unknown>, supplyType, profile, eligibilityWarnings);

  // Gemini 개인화 가이드
  let llm_guide: string | null = null;
  const score = profile ? calcScore(profile) : null;
  const prompt = [
    `청약 공고: ${ann.name} (${ann.region} ${ann.district})`,
    `신청 유형: ${supplyType}`,
    score ? `지원자 가점: ${score.total}점 / 84점` : "",
    eligibilityWarnings.length > 0
      ? `주의 항목: ${eligibilityWarnings.map((w) => w.message).join(" / ")}`
      : "부적격 위험 없음",
    "",
    "위 청약 신청자를 위한 핵심 전략 조언을 3문장으로 작성해줘. 구체적인 수치와 일정 포함. 한국어.",
  ].filter(Boolean).join("\n");

  llm_guide = await generateText(prompt, 350);

  return jsonResponse({
    announcement_id: announcementId,
    announcement: {
      name: ann.name,
      region: `${ann.region} ${ann.district}`.trim(),
      period: ann.period,
    },
    supply_type: supplyType,
    score: score ?? null,
    eligibility_warnings: eligibilityWarnings,
    total_steps: steps.length,
    steps,
    llm_guide,
  });
});
