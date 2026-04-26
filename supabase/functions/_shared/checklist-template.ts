/** preparation_checklist 디폴트 템플릿.
 *
 * POST /v1/preparation/init?announcement_id=X 호출 시 사용.
 * 일반공급 base 12개 + 특별공급(supply_type)별 추가 항목.
 *
 * Stitch screen fb84342a 분석 기반 (카테고리·type 분류 반영).
 *
 * linked_doc_type 채워진 항목은 documents 도메인(016)과 연동되어
 * 응답 시 자동 ✅ 표시 (DB 저장 X, JOIN 시 계산).
 */

export interface ChecklistTemplateItem {
  category: "기본준비" | "서류및결정" | "접수당일";
  type: "자금" | "자격" | "서류" | "결정" | "접수";
  title: string;
  description: string;
  due_offset_days: number;          // D-day 기준 (-14 = D-14, 0 = D-day)
  is_auto_checkable: boolean;       // 서버가 user_profiles로 자동 판정 가능
  linked_doc_type?: string;         // documents.doc_type 매칭 시 자동 ✅
  sort_order: number;
}

/** 일반공급 + 모든 공급 공통 base 12개. */
export const BASE_TEMPLATE: ChecklistTemplateItem[] = [
  // ── 기본 준비 (D-14 ~ D-7) ──────────────────────────────
  {
    category: "기본준비",
    type: "자금",
    title: "청약 통장 예치금 확인",
    description: "지역·전용면적별 최저 예치금 충족 여부 확인 (예: 서울 85㎡ 이하 300만원)",
    due_offset_days: -14,
    is_auto_checkable: true,
    sort_order: 10,
  },
  {
    category: "기본준비",
    type: "자격",
    title: "무주택 세대구성원 확인",
    description: "본인·배우자·세대원 모두 주택 미보유 (무주택 기간 산정)",
    due_offset_days: -14,
    is_auto_checkable: true,
    sort_order: 20,
  },
  {
    category: "기본준비",
    type: "자금",
    title: "분양가 + 중도금·잔금 자금 계획",
    description: "분양가 확인 후 자기자본·대출 한도(60%)·중도금 일정 계획",
    due_offset_days: -14,
    is_auto_checkable: false,
    sort_order: 30,
  },
  {
    category: "기본준비",
    type: "자격",
    title: "공동인증서/금융인증서 준비",
    description: "청약홈 로그인 + 본인 인증용 — 만료 여부 미리 확인",
    due_offset_days: -7,
    is_auto_checkable: false,
    sort_order: 40,
  },

  // ── 서류 및 결정 (D-3) ─────────────────────────────────
  {
    category: "서류및결정",
    type: "서류",
    title: "주민등록등본 발급",
    description: "공고일 이후 발급분 (3개월 이내) — 세대원 전원 표시",
    due_offset_days: -3,
    is_auto_checkable: false,
    linked_doc_type: "resident_register",
    sort_order: 50,
  },
  {
    category: "서류및결정",
    type: "서류",
    title: "가족관계증명서 발급",
    description: "상세본 + 주민번호 뒷자리 포함",
    due_offset_days: -3,
    is_auto_checkable: false,
    linked_doc_type: "family_relation",
    sort_order: 60,
  },
  {
    category: "서류및결정",
    type: "서류",
    title: "청약통장 가입확인서 발급",
    description: "은행 영업점 또는 인터넷뱅킹에서 발급",
    due_offset_days: -3,
    is_auto_checkable: false,
    linked_doc_type: "savings_account",
    sort_order: 70,
  },
  {
    category: "서류및결정",
    type: "결정",
    title: "신청 주택형(평형) 결정",
    description: "59A / 84B 등 — 가점/추첨 비율과 경쟁률 고려",
    due_offset_days: -2,
    is_auto_checkable: false,
    sort_order: 80,
  },
  {
    category: "서류및결정",
    type: "결정",
    title: "공급 유형 결정 (특공 vs 일반)",
    description: "신혼부부·생애최초 등 특공 자격이 있다면 특공 우선",
    due_offset_days: -2,
    is_auto_checkable: true,
    sort_order: 90,
  },

  // ── 접수 당일 (D-day) ─────────────────────────────────
  {
    category: "접수당일",
    type: "접수",
    title: "청약홈 접속 (오전 9시 ~ 오후 5시 30분)",
    description: "접수 시간 내 미접속 시 신청 불가",
    due_offset_days: 0,
    is_auto_checkable: false,
    sort_order: 100,
  },
  {
    category: "접수당일",
    type: "접수",
    title: "청약 신청 진행 + 신청 완료 확인",
    description: "신청 후 '접수증' 출력·저장 — 분쟁 시 증빙",
    due_offset_days: 0,
    is_auto_checkable: false,
    sort_order: 110,
  },
  {
    category: "접수당일",
    type: "접수",
    title: "당첨자 발표일 확인 (D+7~10)",
    description: "당첨 시 계약 일정·서류 안내 알림",
    due_offset_days: 7,
    is_auto_checkable: false,
    sort_order: 120,
  },
];

/** 특별공급 유형별 추가 항목. */
export const SPECIAL_SUPPLY_EXTRAS: Record<string, ChecklistTemplateItem[]> = {
  신혼부부: [
    {
      category: "서류및결정",
      type: "서류",
      title: "혼인관계증명서 발급",
      description: "상세본 — 혼인신고일 명시",
      due_offset_days: -3,
      is_auto_checkable: false,
      linked_doc_type: "marriage_proof",
      sort_order: 65,
    },
    {
      category: "서류및결정",
      type: "자격",
      title: "혼인 7년 이내 확인",
      description: "신혼부부 특공 핵심 요건",
      due_offset_days: -7,
      is_auto_checkable: true,
      sort_order: 25,
    },
  ],
  생애최초: [
    {
      category: "서류및결정",
      type: "서류",
      title: "주택 소유 이력 없음 확인서",
      description: "본인·배우자 모두 생애 최초 (주택 소유 이력 0회)",
      due_offset_days: -3,
      is_auto_checkable: false,
      linked_doc_type: "homeless_proof",
      sort_order: 55,
    },
    {
      category: "서류및결정",
      type: "자격",
      title: "혼인/자녀 또는 1인가구 자격 확인",
      description: "생애최초는 혼인/자녀 있어야 (또는 1인가구 30%)",
      due_offset_days: -7,
      is_auto_checkable: true,
      sort_order: 26,
    },
  ],
  다자녀: [
    {
      category: "서류및결정",
      type: "서류",
      title: "자녀 증빙 (3명 이상)",
      description: "가족관계증명서로 미성년 자녀 3명 이상 입증",
      due_offset_days: -3,
      is_auto_checkable: false,
      linked_doc_type: "children_proof",
      sort_order: 56,
    },
  ],
  노부모부양: [
    {
      category: "서류및결정",
      type: "자격",
      title: "직계존속 3년 이상 동일세대 등재",
      description: "주민등록상 만 65세 이상 직계존속 3년+ 부양",
      due_offset_days: -3,
      is_auto_checkable: true,
      sort_order: 27,
    },
  ],
};

/** announcement_id + supply_type 기반으로 템플릿 항목 합성. */
export function buildChecklistTemplate(
  supplyTypes: string[] = [],
): ChecklistTemplateItem[] {
  const items: ChecklistTemplateItem[] = [...BASE_TEMPLATE];
  for (const st of supplyTypes) {
    const extras = SPECIAL_SUPPLY_EXTRAS[st];
    if (extras) items.push(...extras);
  }
  // sort_order 안정 정렬
  return items.sort((a, b) => a.sort_order - b.sort_order);
}
