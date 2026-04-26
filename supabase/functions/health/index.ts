/** GET /health — 서버 상태 체크. */

import { DATA_GO_KR_API_KEY } from "../_shared/config.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  return jsonResponse({
    status: "ok",
    api_key_configured: !!DATA_GO_KR_API_KEY,
    runtime: "supabase-edge",
  });
});
