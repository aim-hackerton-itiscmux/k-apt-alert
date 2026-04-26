-- 019: 즐겨찾기 공고 (앱 '공고 상세' 화면의 favorite 액션)
--
-- 화면 디자인 (Stitch project 16062927818472003315 / screen 9d762970):
-- - "관심" CTA (favorite_border 아이콘) → 즐겨찾기 토글
--
-- 통합:
-- - announcement_changes(018)와 자동 연동: 즐겨찾기 공고 변경 발생 시
--   notify-cron이 mode='change_alert'로 본인에게 우선 알림 (별도 후속 PR로
--   notify-match.ts 수정)

CREATE TABLE public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,

  notes TEXT,                              -- 사용자 메모 (선택)
  notify_on_change BOOLEAN NOT NULL DEFAULT true,  -- 정정공고 알림 받기 (기본 ON)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT favorites_unique UNIQUE (user_id, announcement_id)
);

CREATE INDEX idx_favorites_user ON public.favorites(user_id, created_at DESC);
CREATE INDEX idx_favorites_ann ON public.favorites(announcement_id);

-- RLS
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_self_select" ON public.favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "favorites_self_insert" ON public.favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorites_self_update" ON public.favorites
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "favorites_self_delete" ON public.favorites
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "favorites_service_all" ON public.favorites
  FOR ALL TO service_role USING (true) WITH CHECK (true);
