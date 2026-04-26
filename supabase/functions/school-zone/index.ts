/** GET /v1/apt/school-zone — 학군 정보 + 초품아 판정 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { geocodeAddress, searchCategory } from "../_shared/kakao.ts";
import { fetchSchoolDetails } from "../_shared/neis.ts";

const KAKAO_API_KEY = Deno.env.get("KAKAO_API_KEY") ?? "";
const NEIS_API_KEY  = Deno.env.get("NEIS_API_KEY")  ?? "";
const CACHE_TTL_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (!KAKAO_API_KEY) return jsonResponse({ error: "KAKAO_API_KEY not configured" }, 503);

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const address        = url.searchParams.get("address") ?? "";
  const latParam       = url.searchParams.get("lat");
  const lngParam       = url.searchParams.get("lng");

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  const { data: cached } = await db
    .from("school_zone_cache")
    .select("result, created_at")
    .eq("announcement_id", announcementId)
    .single();

  if (cached) {
    const ageDays = (Date.now() - new Date(cached.created_at).getTime()) / 86_400_000;
    if (ageDays < CACHE_TTL_DAYS) return jsonResponse(cached.result);
  }

  let lat = latParam ? parseFloat(latParam) : 0;
  let lng = lngParam ? parseFloat(lngParam) : 0;

  if ((lat === 0 || lng === 0) && address) {
    const coords = await geocodeAddress(address, KAKAO_API_KEY);
    if (!coords) return jsonResponse({ error: `지오코딩 실패: ${address}` }, 400);
    lat = coords.lat;
    lng = coords.lng;
  }
  if (lat === 0 || lng === 0) return jsonResponse({ error: "lat/lng 또는 address 필요" }, 400);

  // 반경 1km 학교 조회
  const places = await searchCategory("SC4", lat, lng, 1000, KAKAO_API_KEY);

  // 초품아 판정: 반경 300m 내 초등학교
  const elementaryNearby = places.filter((p) => {
    const d = parseFloat(p.distance || "9999");
    return d <= 300 && (p.place_name.includes("초등") || p.place_name.includes("초교"));
  });

  const nearestElementary = places
    .filter((p) => p.place_name.includes("초등") || p.place_name.includes("초교"))
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance))[0];

  const schools = await fetchSchoolDetails(places, NEIS_API_KEY);

  const result = {
    announcement_id: announcementId,
    is_elementary_nearby: elementaryNearby.length > 0,
    nearest_elementary_m: nearestElementary
      ? Math.floor(parseFloat(nearestElementary.distance))
      : null,
    schools,
  };

  await db.from("school_zone_cache").upsert({
    announcement_id: announcementId,
    result,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
