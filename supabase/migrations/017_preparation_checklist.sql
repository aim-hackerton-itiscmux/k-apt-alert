-- 017: 사용자 청약 준비 체크리스트 (앱 '준비' 탭의 '준비 체크리스트' 화면)
--
-- 화면 디자인 (Stitch project 16062927818472003315 / screen fb84342a):
-- - 헤더: 전체 준비율 N% + D-day
-- - 카테고리 3개: 기본 준비 / 서류 및 결정 / 접수 당일
-- - 항목 type 5종: 자금 / 자격 / 서류 / 결정 / 접수
-- - is_auto_checkable 플래그: 서버가 자동 체크 가능한 항목
--
-- documents 도메인(016)과 연동:
-- - linked_doc_type 컬럼이 채워진 항목은
--   documents 테이블에 같은 doc_type의 status='ready' row가 있으면
--   응답 시점에 effective_is_done=true로 자동 표시 (DB 저장 X, JOIN 시 계산)

CREATE TABLE public.preparation_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 어떤 공고 준비인지 (NULL이면 일반 준비 — 공고 무관)
  related_announcement_id TEXT,

  -- 카테고리 + type
  category TEXT NOT NULL,                  -- '기본준비' | '서류및결정' | '접수당일'
  type TEXT NOT NULL,                      -- '자금' | '자격' | '서류' | '결정' | '접수'

  -- 항목 내용
  title TEXT NOT NULL,
  description TEXT,
  due_offset_days INT,                     -- D-day 기준 offset (-3 = D-3, 0 = D-day)

  -- 자동 체크 연동
  is_auto_checkable BOOLEAN NOT NULL DEFAULT false,
  linked_doc_type TEXT,                    -- documents.doc_type과 매칭 — ready 상태면 자동 체크
                                           -- 'resident_register' | 'family_relation' | ...

  -- 사용자 체크 상태 (수동)
  is_done BOOLEAN NOT NULL DEFAULT false,
  done_at TIMESTAMPTZ,

  -- 정렬 힌트
  sort_order INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prep_category_chk CHECK (category IN ('기본준비', '서류및결정', '접수당일')),
  CONSTRAINT prep_type_chk CHECK (type IN ('자금', '자격', '서류', '결정', '접수'))
);

CREATE INDEX idx_prep_user_ann ON public.preparation_checklist(user_id, related_announcement_id);
CREATE INDEX idx_prep_user_done ON public.preparation_checklist(user_id, is_done);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_preparation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  -- is_done이 false → true로 바뀌면 done_at 기록
  IF NEW.is_done = true AND (OLD.is_done IS NULL OR OLD.is_done = false) THEN
    NEW.done_at = NOW();
  END IF;
  -- true → false로 되돌리면 done_at 비움
  IF NEW.is_done = false AND OLD.is_done = true THEN
    NEW.done_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_preparation_updated_at
  BEFORE UPDATE ON public.preparation_checklist
  FOR EACH ROW
  EXECUTE FUNCTION public.set_preparation_updated_at();

-- RLS
ALTER TABLE public.preparation_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preparation_self_select" ON public.preparation_checklist
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "preparation_self_insert" ON public.preparation_checklist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "preparation_self_update" ON public.preparation_checklist
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "preparation_self_delete" ON public.preparation_checklist
  FOR DELETE USING (auth.uid() = user_id);

-- service_role 우회 (cron 만료 알림, 자동 init 등)
CREATE POLICY "preparation_service_all" ON public.preparation_checklist
  FOR ALL TO service_role USING (true) WITH CHECK (true);
