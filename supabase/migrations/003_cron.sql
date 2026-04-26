-- pg_cron 스케줄: GitHub Actions warmup 워크플로우 대체
-- pg_net으로 Edge Function 주기 호출

-- rate_limit UPSERT 함수 (rate-limit.ts에서 사용)
CREATE OR REPLACE FUNCTION increment_rate_limit(p_date DATE, p_limit INT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO rate_limit (date, call_count, daily_limit)
  VALUES (p_date, 1, p_limit)
  ON CONFLICT (date)
  DO UPDATE SET call_count = rate_limit.call_count + 1
  RETURNING call_count INTO v_count;
  RETURN v_count;
END;
$$;

-- 각 크롤러 10분마다 독립 실행
SELECT cron.schedule('crawl-apt', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-apt',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-officetell', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-officetell',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-lh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-lh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-remndr', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-remndr',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-pbl-pvt-rent', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-pbl-pvt-rent',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-opt', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-opt',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-sh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-sh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-gh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-gh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

-- 일정 보강 30분마다
SELECT cron.schedule('crawl-enrich', '*/30 * * * *',
  $$ SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/crawl-enrich',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

-- 오래된 데이터 정리 (매일 자정 UTC)
SELECT cron.schedule('cleanup-old-data', '0 0 * * *',
  $$ DELETE FROM announcements WHERE crawled_at < NOW() - INTERVAL '6 months' $$
);

-- 오래된 rate_limit 행 정리 (매일)
SELECT cron.schedule('cleanup-rate-limit', '0 1 * * *',
  $$ DELETE FROM rate_limit WHERE date < CURRENT_DATE - INTERVAL '7 days' $$
);
