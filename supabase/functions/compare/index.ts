/** GET /v1/apt/compare — 여러 공고 동시 비교 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const url  = new URL(req.url);
  const ids  = (url.searchParams.get("ids") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);

  if (ids.length < 2) return jsonResponse({ error: "ids에 공고 ID 2개 이상 필요 (최대 5개)" }, 400);

  const db = getSupabaseClient();

  // 공고 기본정보 + 캐시 병렬 조회
  const [annRes, priceRes, locationRes, schoolRes, commuteRes] = await Promise.all([
    db.from("announcements").select("id,name,region,district,total_units,speculative_zone,price_controlled").in("id", ids),
    db.from("price_assessment_cache").select("announcement_id,result").in("announcement_id", ids),
    db.from("location_score_cache").select("announcement_id,result").in("announcement_id", ids),
    db.from("school_zone_cache").select("announcement_id,result").in("announcement_id", ids),
    db.from("commute_cache").select("announcement_id,result").in("announcement_id", ids),
  ]);

  const annMap     = Object.fromEntries((annRes.data ?? []).map((r) => [r.id, r]));
  const priceMap   = Object.fromEntries((priceRes.data ?? []).map((r) => [r.announcement_id, r.result]));
  const locMap     = Object.fromEntries((locationRes.data ?? []).map((r) => [r.announcement_id, r.result]));
  const schoolMap  = Object.fromEntries((schoolRes.data ?? []).map((r) => [r.announcement_id, r.result]));
  const commuteMap = Object.fromEntries((commuteRes.data ?? []).map((r) => [r.announcement_id, r.result]));

  const items = ids.map((id) => {
    const ann     = annMap[id];
    const price   = priceMap[id];
    const loc     = locMap[id];
    const school  = schoolMap[id];
    const commute = commuteMap[id];

    const locationScore  = loc?.location_score ?? null;
    const pricePercentile = price?.percentile ?? null;

    // 종합 점수: location + (100 - price percentile)
    const overallScore =
      locationScore !== null && pricePercentile !== null
        ? locationScore + (100 - pricePercentile)
        : null;

    return {
      announcement_id: id,
      name: ann?.name ?? null,
      region: ann ? `${ann.region} ${ann.district}`.trim() : null,
      total_units: ann?.total_units ?? null,
      price_assessment: price
        ? { assessment: price.assessment, percentile: price.percentile, price_per_pyeong: price.price_per_pyeong }
        : null,
      location_score: locationScore,
      has_elementary_within_300m: school?.has_elementary_within_300m ?? null,
      nearest_elementary_m: school?.nearest_elementary_m ?? null,
      walk_to_nearest_station_min: commute?.walk_to_nearest_station_min ?? null,
      nearest_station: commute?.nearest_station ?? null,
      overall_score: overallScore,
    };
  });

  // overall_rank 계산
  const sorted = [...items].sort((a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1));
  const rankMap = Object.fromEntries(sorted.map((item, i) => [item.announcement_id, i + 1]));
  const ranked  = items.map((item) => ({ ...item, overall_rank: rankMap[item.announcement_id] }));

  const winner = sorted[0]?.overall_score !== null ? sorted[0].announcement_id : null;

  return jsonResponse({ count: ranked.length, items: ranked, winner });
});
