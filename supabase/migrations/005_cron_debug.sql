-- TEMPORARY diagnostic helpers — drop after investigation
CREATE OR REPLACE FUNCTION get_cron_jobs()
RETURNS TABLE(jobid BIGINT, jobname TEXT, schedule TEXT, command TEXT, active BOOLEAN, database TEXT, username TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jobid, jobname, schedule, command, active, database, username FROM cron.job ORDER BY jobid;
$$;

CREATE OR REPLACE FUNCTION get_cron_runs()
RETURNS TABLE(jobid BIGINT, runid BIGINT, status TEXT, return_message TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT jobid, runid, status, return_message, start_time, end_time
  FROM cron.job_run_details ORDER BY start_time DESC LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION get_cron_settings()
RETURNS TABLE(name TEXT, setting TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT name, setting FROM pg_settings
  WHERE name IN ('app.settings.supabase_url', 'app.settings.service_role_key', 'cron.database_name');
$$;
