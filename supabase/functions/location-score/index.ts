/** GET /v1/apt/location-score — 카카오 로컬 API 기반 입지 점수 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { geocodeAddress, calcLocationScore } from "../_shared/kakao.ts";

const KAKAO_API_KEY  = Deno.env.get("KAKAO_API_KEY") ?? "";
const CACHE_TTL_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  if (!KAKAO_API_KEY) {
    return jsonResponse({ error: "KAKAO_API_KEY not configured" }, 503);
  }

  const url          = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const address      = url.searchParams.get("address") ?? "";
  const latParam     = url.searchParams.get("lat");
  const lngParam     = url.searchParams.get("lng");

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  // 캐시 확인 (7일 TTL)
  const { data: cached } = await db
    .from("location_score_cache")
    .select("result, created_at")
    .eq("announcement_id", announcementId)
    .single();

  if (cached) {
    const ageDays = (Date.now() - new Date(cached.created_at).getTime()) / 86_400_000;
    if (ageDays < CACHE_TTL_DAYS) return jsonResponse(cached.result);
  }

  let lat = latParam ? parseFloat(latParam) : 0;
  let lng = lngParam ? parseFloat(lngParam) : 0;

  // lat/lng 없으면 address로 지오코딩
  if ((lat === 0 || lng === 0) && address) {
    const coords = await geocodeAddress(address, KAKAO_API_KEY);
    if (!coords) {
      return jsonResponse({ error: `주소 지오코딩 실패: ${address}` }, 400);
    }
    lat = coords.lat;
    lng = coords.lng;
  }

  if (lat === 0 || lng === 0) {
    return jsonResponse({ error: "lat/lng 또는 address 중 하나 필요" }, 400);
  }

  const scoreData = await calcLocationScore(lat, lng, KAKAO_API_KEY);
  const result    = { announcement_id: announcementId, ...scoreData };

  await db.from("location_score_cache").upsert({
    announcement_id: announcementId,
    result,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
