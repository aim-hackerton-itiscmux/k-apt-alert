-- Phase 2: AI 리포트 저장 (앱 'AI 리포트' 탭의 이력)
-- 클라이언트가 LLM 분석 후 명시 저장. 서버는 raw 추출만 담당하므로 자동 생성 안 함.

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_id TEXT NOT NULL,                  -- 공고 ID (apt_xxx, lh_xxx 등)
  notice_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  summary_markdown TEXT NOT NULL,           -- LLM이 생성한 분석 요약 (마크다운)
  raw_excerpt TEXT,                         -- notice_raw에서 추출한 원문 발췌 (선택, 일부만)
  matched_profile_snapshot JSONB,           -- 분석 시점의 프로필 스냅샷 (변경 추적용)
  match_score INT,                          -- recommendations에서 받은 점수 (선택)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_user_created ON public.reports(user_id, created_at DESC);
CREATE INDEX idx_reports_notice ON public.reports(notice_id);
-- 같은 사용자가 같은 공고를 여러 번 분석하는 경우 허용 (UNIQUE 제약 X)

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_select" ON public.reports
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "self_insert" ON public.reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "self_delete" ON public.reports
  FOR DELETE USING (auth.uid() = user_id);

-- UPDATE는 의도적으로 정책 없음 — 리포트는 시점 기록이므로 수정 불가
