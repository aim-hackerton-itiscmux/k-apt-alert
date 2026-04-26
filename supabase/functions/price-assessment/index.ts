/** GET /v1/apt/price-assessment — 국토부 실거래가 기반 분양가 평가 */
import { DATA_GO_KR_API_KEY } from "../_shared/config.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { extractLawdCd, fetchTradeData, calcPriceAssessment } from "../_shared/realestate.ts";

const CACHE_TTL_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const url = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const address       = url.searchParams.get("address") ?? "";
  const areaSqm       = parseFloat(url.searchParams.get("area_sqm") ?? "0");
  const priceWon      = parseInt(url.searchParams.get("price_won") ?? "0", 10);

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);
  if (!address)        return jsonResponse({ error: "address required" }, 400);
  if (areaSqm <= 0)    return jsonResponse({ error: "area_sqm required (㎡)" }, 400);
  if (priceWon <= 0)   return jsonResponse({ error: "price_won required (만원)" }, 400);

  const db = getSupabaseClient();

  // 캐시 확인 (24h TTL)
  const { data: cached } = await db
    .from("price_assessment_cache")
    .select("result, created_at")
    .eq("announcement_id", announcementId)
    .single();

  if (cached) {
    const ageHours = (Date.now() - new Date(cached.created_at).getTime()) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) return jsonResponse(cached.result);
  }

  const lawdCd = extractLawdCd(address);
  if (!lawdCd) {
    return jsonResponse(
      { error: `주소에서 법정동 코드를 추출할 수 없습니다: ${address}` },
      400,
    );
  }

  const trades = await fetchTradeData(lawdCd, DATA_GO_KR_API_KEY);
  const result = calcPriceAssessment(trades, areaSqm, priceWon, announcementId);

  await db.from("price_assessment_cache").upsert({
    announcement_id: announcementId,
    result,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
