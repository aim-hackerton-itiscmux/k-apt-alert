/** GET /v1/apt/similar-listings — 유사 공고 매칭 + 과거 경쟁률/당첨가점 예측 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { fetchCompetition, CompetitionResult } from "../_shared/competition.ts";

const CACHE_TTL_SEC = 86400; // 24h — 경쟁률 데이터 하루 단위 갱신

// 유사도 가중치
const W = {
  region:          0.30,
  district:        0.20,
  size:            0.15,
  price:           0.15,
  price_controlled: 0.10,
  brand:           0.05,
  scale:           0.05,
} as const;

// 분양가 레인지 (만원/㎡) — 퍼센타일 근사용
const PRICE_RANGES = [200, 400, 600, 800, 1000, 1500, 2000, 3000] as const;

function extractSido(region: string): string {
  return region.split(" ")[0] ?? region;
}

/** 주력 브랜드 추출 (삼성→삼성, GS건설→GS, 현대E&C→현대). */
function normalizeBrand(constructor: string): string {
  const brand = constructor.replace(/건설|주택|산업|엔지니어링|E&C|ENC/g, "").trim();
  return brand.length > 1 ? brand : constructor;
}

/** "59㎡/84㎡/99㎡" → 최대 면적(㎡) 숫자. */
function parseMaxSize(size: string): number | null {
  const nums = [...size.matchAll(/(\d+(?:\.\d+)?)\s*㎡/g)].map((m) => parseFloat(m[1]));
  return nums.length > 0 ? Math.max(...nums) : null;
}

/** 세대수 문자열 → 숫자. "1,200세대" → 1200 */
function parseUnits(total: string): number | null {
  const n = parseInt(total.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

/** 0~1 유사도 점수 계산. */
function calcSimilarity(
  target: Record<string, unknown>,
  candidate: Record<string, unknown>,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};

  // region (시도 일치)
  const tSido = extractSido(String(target.region ?? ""));
  const cSido = extractSido(String(candidate.region ?? ""));
  breakdown.region = tSido && cSido && tSido === cSido ? W.region : 0;

  // district (구/군 일치)
  const tDist = String(target.district ?? "");
  const cDist = String(candidate.district ?? "");
  breakdown.district = tDist && cDist && tDist === cDist ? W.district : 0;

  // size (최대 평형 ±15㎡ 이내)
  const tSize = parseMaxSize(String(target.size ?? ""));
  const cSize = parseMaxSize(String(candidate.size ?? ""));
  if (tSize !== null && cSize !== null) {
    const diff = Math.abs(tSize - cSize);
    breakdown.size = diff <= 5 ? W.size : diff <= 15 ? W.size * 0.6 : diff <= 30 ? W.size * 0.2 : 0;
  } else {
    breakdown.size = 0;
  }

  // price (분상제 대리 — 분양가상한제 적용 여부로 가격대 유사도 추정)
  // price_assessment_cache 없으면 분상제 필드로 대체 계산
  breakdown.price = 0; // placeholder — 아래 price_controlled로 보완

  // price_controlled (분상제 Y/N 일치)
  const tPc = String(target.price_controlled ?? "");
  const cPc = String(candidate.price_controlled ?? "");
  breakdown.price_controlled = tPc && cPc && tPc === cPc ? W.price_controlled + W.price : W.price_controlled * 0.2;

  // brand (건설사 브랜드 일치)
  const tBrand = normalizeBrand(String(target.constructor ?? ""));
  const cBrand = normalizeBrand(String(candidate.constructor ?? ""));
  breakdown.brand = tBrand && cBrand && (tBrand === cBrand || cBrand.includes(tBrand) || tBrand.includes(cBrand))
    ? W.brand
    : 0;

  // scale (세대수 ±50% 이내)
  const tUnits = parseUnits(String(target.total_units ?? ""));
  const cUnits = parseUnits(String(candidate.total_units ?? ""));
  if (tUnits !== null && cUnits !== null && tUnits > 0) {
    const ratio = Math.min(tUnits, cUnits) / Math.max(tUnits, cUnits);
    breakdown.scale = ratio >= 0.7 ? W.scale : ratio >= 0.5 ? W.scale * 0.5 : 0;
  } else {
    breakdown.scale = 0;
  }

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.round(score * 100) / 100, breakdown };
}

/** competition_rate 가중평균 예측. */
function predictFromSimilar(
  items: Array<{ similarity_score: number; competition?: CompetitionResult | null }>,
): { expected_competition_rate: number | null; expected_winning_score: number | null; confidence: string } {
  const withComp = items.filter((i) => i.competition?.competition_rate != null);

  if (withComp.length === 0) {
    return { expected_competition_rate: null, expected_winning_score: null, confidence: "insufficient_data" };
  }

  const totalW = withComp.reduce((s, i) => s + i.similarity_score, 0);
  const avgRate = withComp.reduce((s, i) => s + i.similarity_score * (i.competition!.competition_rate!), 0) / totalW;

  const withScore = withComp.filter((i) => i.competition?.winning_avg_score != null);
  let avgScore: number | null = null;
  if (withScore.length > 0) {
    const tw = withScore.reduce((s, i) => s + i.similarity_score, 0);
    avgScore = withScore.reduce((s, i) => s + i.similarity_score * (i.competition!.winning_avg_score!), 0) / tw;
  }

  const confidence = withComp.length >= 3 ? "high" : withComp.length === 2 ? "medium" : "low";

  return {
    expected_competition_rate: Math.round(avgRate * 10) / 10,
    expected_winning_score: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
    confidence,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const maxResults     = Math.min(parseInt(url.searchParams.get("max_results") ?? "5"), 10);

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  // 캐시 확인
  const cacheKey = `similar:${announcementId}:${maxResults}`;
  const { data: cached } = await db
    .from("similar_listings_cache")
    .select("result,cached_at")
    .eq("cache_key", cacheKey)
    .single();

  if (cached) {
    const age = (Date.now() - new Date(cached.cached_at).getTime()) / 1000;
    if (age < CACHE_TTL_SEC) {
      return jsonResponse({ ...cached.result, cached: true });
    }
  }

  // 대상 공고 조회
  const { data: target, error: tErr } = await db
    .from("announcements")
    .select("id,name,region,district,size,total_units,constructor,price_controlled,category,rcept_end")
    .eq("id", announcementId)
    .single();

  if (tErr || !target) return jsonResponse({ error: "announcement not found" }, 404);

  // 과거 18개월 + 같은 카테고리 공고 조회 (최대 200건)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 18);
  const { data: candidates } = await db
    .from("announcements")
    .select("id,name,region,district,size,total_units,constructor,price_controlled,rcept_end")
    .eq("category", target.category)
    .neq("id", announcementId)
    .gte("rcept_end", cutoff.toISOString().slice(0, 10))
    .lte("rcept_end", new Date().toISOString().slice(0, 10))
    .order("rcept_end", { ascending: false })
    .limit(200);

  if (!candidates || candidates.length === 0) {
    return jsonResponse({
      announcement_id: announcementId,
      target: { name: target.name, region: target.region, size: target.size },
      similar_count: 0,
      items: [],
      predicted: { expected_competition_rate: null, expected_winning_score: null, confidence: "insufficient_data" },
      llm_analysis: null,
    });
  }

  // 유사도 계산 + 정렬
  const scored = candidates.map((c) => {
    const { score, breakdown } = calcSimilarity(target, c);
    return { ...c, similarity_score: score, score_breakdown: breakdown };
  });

  scored.sort((a, b) => b.similarity_score - a.similarity_score);
  const topN = scored.slice(0, maxResults);

  // 상위 N개 경쟁률 조회 (병렬)
  const compResults = await Promise.allSettled(
    topN.map((c) => fetchCompetition(c.id)),
  );

  const items = topN.map((c, i) => {
    const comp = compResults[i].status === "fulfilled" ? compResults[i].value : null;
    return {
      announcement_id: c.id,
      name: c.name,
      region: `${c.region} ${c.district}`.trim(),
      size: c.size,
      total_units: c.total_units,
      constructor: c.constructor,
      similarity_score: c.similarity_score,
      score_breakdown: c.score_breakdown,
      rcept_end: c.rcept_end,
      competition_rate: comp?.competition_rate ?? null,
      winning_min_score: comp?.winning_min_score ?? null,
      winning_avg_score: comp?.winning_avg_score ?? null,
      competition: comp,
    };
  });

  const predicted = predictFromSimilar(items);

  const result = {
    announcement_id: announcementId,
    target: {
      name: target.name,
      region: `${target.region} ${target.district}`.trim(),
      size: target.size,
      constructor: target.constructor,
    },
    similar_count: items.length,
    items: items.map(({ competition: _c, ...rest }) => rest), // competition 중복 제거
    predicted,
    llm_analysis: null,
  };

  // 캐시 저장 (upsert)
  await db.from("similar_listings_cache").upsert({
    cache_key: cacheKey,
    announcement_id: announcementId,
    result,
    cached_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
