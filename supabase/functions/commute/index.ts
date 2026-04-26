/** GET /v1/apt/commute — 도보/대중교통 출퇴근 시간 분석 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { geocodeAddress, searchCategory } from "../_shared/kakao.ts";
import { calcWalkMinutes, calcTransitMinutes, MAJOR_HUBS } from "../_shared/mobility.ts";

const KAKAO_API_KEY  = Deno.env.get("KAKAO_API_KEY") ?? "";
const CACHE_TTL_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (!KAKAO_API_KEY) return jsonResponse({ error: "KAKAO_API_KEY not configured" }, 503);

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const address        = url.searchParams.get("address") ?? "";
  const latParam       = url.searchParams.get("lat");
  const lngParam       = url.searchParams.get("lng");
  const adClaim        = url.searchParams.get("ad_claim") ?? ""; // 예: "역세권 도보 5분"

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  const { data: cached } = await db
    .from("commute_cache")
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

  // 최근접 지하철역
  const stations = await searchCategory("SW8", lat, lng, 2000, KAKAO_API_KEY);
  const nearestStation = stations[0];
  const stationDistM   = nearestStation ? parseFloat(nearestStation.distance || "0") : null;
  const walkToStation  = stationDistM !== null ? Math.round(stationDistM / 80) : null; // 80m/min

  // 주요 업무지구 출퇴근 시간 (병렬)
  const hubEntries = Object.entries(MAJOR_HUBS);
  const [transitResults, walkResults] = await Promise.all([
    Promise.all(hubEntries.map(([, h]) => calcTransitMinutes(lat, lng, h.lat, h.lng, KAKAO_API_KEY))),
    Promise.all(hubEntries.map(([, h]) => calcWalkMinutes(lat, lng, h.lat, h.lng, KAKAO_API_KEY))),
  ]);

  const commute: Record<string, { transit_min: number | null; walk_min: number | null }> = {};
  hubEntries.forEach(([key], i) => {
    commute[key] = { transit_min: transitResults[i], walk_min: walkResults[i] };
  });

  // 광고 vs 실제 비교
  let adVsReality: string | null = null;
  if (adClaim && walkToStation !== null) {
    const match = adClaim.match(/(\d+)\s*분/);
    if (match) {
      const claimed = parseInt(match[1], 10);
      const diff    = walkToStation - claimed;
      adVsReality   = diff > 0
        ? `광고 도보 ${claimed}분 → 실제 도보 ${walkToStation}분 (+${diff}분)`
        : `광고 도보 ${claimed}분 → 실제 도보 ${walkToStation}분`;
    }
  }

  const result = {
    announcement_id: announcementId,
    nearest_station: nearestStation?.place_name ?? null,
    walk_to_nearest_station_min: walkToStation,
    commute,
    ad_claim_vs_reality: adVsReality,
  };

  await db.from("commute_cache").upsert({
    announcement_id: announcementId,
    result,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
