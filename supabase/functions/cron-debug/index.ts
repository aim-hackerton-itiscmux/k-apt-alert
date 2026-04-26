/** TEMPORARY diagnostic — pg_cron status check. Delete after investigation. */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const db = getSupabaseClient();

  // cron.job and cron.job_run_details are in `cron` schema — need RPC or service-role
  const { data: jobs, error: jobsErr } = await db.rpc("get_cron_jobs");
  const { data: runs, error: runsErr } = await db.rpc("get_cron_runs");
  const { data: settings, error: settingsErr } = await db.rpc("get_cron_settings");

  return jsonResponse({
    jobs: jobs ?? null,
    jobs_error: jobsErr?.message ?? null,
    recent_runs: runs ?? null,
    runs_error: runsErr?.message ?? null,
    settings: settings ?? null,
    settings_error: settingsErr?.message ?? null,
  });
});
