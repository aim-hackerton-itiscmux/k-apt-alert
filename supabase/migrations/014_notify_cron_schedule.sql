-- 014: notify-cron Edge Function 스케줄
-- 매일 06시: D-day ≤3 임박 공고 → 관심 지역 사용자 인앱 알림
-- 매일 08시: 신규 공고 (24h 내) → 관심 지역 사용자 인앱 알림
--
-- 003_cron.sql / 007_vault_cron.sql 패턴 따라감 (vault에서 service_role_key 읽기)
-- 중복 방지는 notify-cron 코드에서 24h 내 (user × type × announcement) 조합 검사

-- 기존 schedule이 있으면 unschedule (멱등성)
DO $$
BEGIN
  PERFORM cron.unschedule('notify-cron-dday-alert')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-cron-dday-alert');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('notify-cron-announcement-new')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-cron-announcement-new');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 매일 21시 UTC = KST 06시
SELECT cron.schedule(
  'notify-cron-dday-alert',
  '0 21 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.settings.supabase_url') || '/functions/v1/notify-cron?mode=dday_alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb
    )
  $$
);

-- 매일 23시 UTC = KST 08시
SELECT cron.schedule(
  'notify-cron-announcement-new',
  '0 23 * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.settings.supabase_url') || '/functions/v1/notify-cron?mode=announcement_new',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
        'Content-Type',  'application/json'
      ),
      body := '{}'::jsonb
    )
  $$
);

-- 중복 방지 인덱스 — (user_id, type, related_announcement_id, created_at) 조회 가속
CREATE INDEX IF NOT EXISTS idx_notifications_dedup_lookup
  ON notifications (user_id, type, related_announcement_id, created_at DESC)
  WHERE related_announcement_id IS NOT NULL;
