-- 020: reports 테이블 확장 — AI 리포트 화면(Stitch 3587a9f0) 풍부화
--
-- 화면이 요구하는 추가 데이터:
-- - verdict: '조건부 추천' / '강력 추천' / '주의' / '비추천' (1줄 결정)
-- - confidence_score: 0~100 (분석 신뢰도)
-- - key_points: 5점 핵심 요약 (icon badges 화면)
-- - evidence: 3개 카테고리 근거 (공식문서/공식DB/AI계산) — 근거 상세 패널(2d69b5eb)
-- - charts_data: 분양가 vs 시세 표 등 구조화 데이터
--
-- 010_reports.sql의 summary_markdown은 그대로 유지 (하위 호환)

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS verdict TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score INT,
  ADD COLUMN IF NOT EXISTS key_points JSONB,
  ADD COLUMN IF NOT EXISTS evidence JSONB,
  ADD COLUMN IF NOT EXISTS charts_data JSONB;

-- verdict 화이트리스트
ALTER TABLE public.reports
  ADD CONSTRAINT IF NOT EXISTS reports_verdict_chk CHECK (
    verdict IS NULL OR verdict IN ('strong_recommend', 'conditional_recommend', 'caution', 'not_recommend')
  );

-- confidence_score 0..100
ALTER TABLE public.reports
  ADD CONSTRAINT IF NOT EXISTS reports_confidence_chk CHECK (
    confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
  );

-- ────────────────────────────────────────────────────────────────
-- key_points JSONB 구조 (참고):
--   [{ "icon": "savings", "label": "분양가 우위", "value": "주변 대비 -15%", "tone": "positive" }, ...]
--   tone: 'positive' | 'neutral' | 'caution' | 'negative'
--
-- evidence JSONB 구조 (참고, 근거 상세 패널 2d69b5eb 매핑):
--   [
--     { "category": "official_source", "icon": "format_quote",
--       "title": "모집공고 원문", "citation": "...", "link": "..." },
--     { "category": "official_db", "icon": "account_balance",
--       "title": "청약홈 자격요건", "citation": "...", "link": "..." },
--     { "category": "market_data", "icon": "monitoring",
--       "title": "인근 실거래가", "citation": "...", "link": "..." }
--   ]
--   category: 'official_source' | 'official_db' | 'market_data' | 'ai_inference'
--
-- charts_data JSONB 구조 (참고):
--   {
--     "price_vs_market": {
--       "target": { "size_sqm": 84, "price_eok": 9.5 },
--       "comparable": { "avg_eok": 11.2, "samples": 5 },
--       "margin_eok": 1.7
--     },
--     "competition_estimate": { "tier1_required_score": 60, "user_score": 54 },
--     "cash_flow": { "deposit_eok": 1.8, "monthly_payment_man": 350 }
--   }
-- ────────────────────────────────────────────────────────────────

-- evidence/charts_data 자주 조회용 GIN 인덱스 (선택)
CREATE INDEX IF NOT EXISTS idx_reports_evidence ON public.reports USING GIN (evidence);
