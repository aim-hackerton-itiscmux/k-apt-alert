-- Phase 2: 인앱 알림 (모바일 앱 🔔 아이콘)
-- 사용자별 격리, INSERT는 service_role(cron)만, SELECT/UPDATE는 본인만

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- 'announcement_new' | 'dday_alert' | 'report_complete' | 'system'
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,                            -- 앱 내 딥링크 (선택, /app/notice/123 등)
  related_announcement_id TEXT,         -- 연관 공고 ID (선택)
  read_at TIMESTAMPTZ,                  -- NULL = 미읽음
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 본인 미읽음 우선 조회용 인덱스
CREATE INDEX idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- 본인 전체 이력 조회용
CREATE INDEX idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_select" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "self_update_read" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- INSERT는 service_role만 (cron이 생성). 사용자가 자신의 알림을 만들 수 없도록 정책 없음.
-- DELETE는 auth.users CASCADE로 자동
