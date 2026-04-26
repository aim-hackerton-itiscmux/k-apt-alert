-- pg_cron이 vault에서 secret을 읽도록 변경 (DB GUC 평문 저장 회피)
-- 사전 조건: Dashboard SQL Editor에서 아래 2개 vault secret이 미리 등록되어 있어야 함
--   SELECT vault.create_secret('https://xnyhzyvigazofjoozuub.supabase.co', 'project_url');
--   SELECT vault.create_secret('eyJ...service_role_key...', 'service_role_key');

-- 003_cron.sql로 등록한 9개 잡(GUC 미설정으로 모두 실패 중) 제거
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN SELECT jobname FROM cron.job
           WHERE jobname IN ('crawl-apt','crawl-officetell','crawl-lh','crawl-remndr',
                             'crawl-pbl-pvt-rent','crawl-opt','crawl-sh','crawl-gh','crawl-enrich')
  LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

-- vault에서 키 읽어 재등록
SELECT cron.schedule('crawl-apt', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-apt',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-officetell', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-officetell',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-lh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-lh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-remndr', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-remndr',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-pbl-pvt-rent', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-pbl-pvt-rent',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-opt', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-opt',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-sh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-sh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-gh', '*/10 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-gh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);

SELECT cron.schedule('crawl-enrich', '*/30 * * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url') || '/functions/v1/crawl-enrich',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) $$
);
