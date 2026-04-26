-- 015: notifications에 본인 INSERT 정책 추가 (수동 알림 생성)
-- 006_notifications.sql에서 INSERT는 service_role만 가능했으나,
-- POST /v1/notifications (본인이 본인에게 임의 알림 생성) 활성화 필요.

-- 기존 정책 멱등 처리
DROP POLICY IF EXISTS "self_insert" ON public.notifications;

-- 본인 user_id로만 INSERT 가능
CREATE POLICY "self_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- service_role은 모든 row 작업 가능 (cron의 notify-cron, notifications/refresh)
DROP POLICY IF EXISTS "service_all" ON public.notifications;
CREATE POLICY "service_all" ON public.notifications
  TO service_role USING (true) WITH CHECK (true);
