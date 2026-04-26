/** GET /v1/apt/similar-listings — 유사 공고 매칭 + 과거 경쟁률/당첨가점 예측 + Gemini 분석 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { fetchCompetition, CompetitionResult } from "../_shared/competition.ts";
import { generateText } from "../_shared/gemini.ts";

const CACHE_TTL_SEC = 86400; // 24h

const W = { region: 0.30, district: 0.20, size: 0.15, price: 0.15, price_controlled: 0.10, brand: 0.05, scale: 0.05 } as const;

function extractSido(region: string): string { return region.split(" ")[0] ?? region; }

function normalizeBrand(c: string): string {
  const b = c.replace(/건설|주택|산업|엔지니어링|E&C|ENC/g, "").trim();
  return b.length > 1 ? b : c;
}

function parseMaxSize(size: string): number | null {
  const nums = [...size.matchAll(/(\d+(?:\.\d+)?)\s*㎡/g)].map((m) => parseFloat(m[1]));
  return nums.length > 0 ? Math.max(...nums) : null;
}

function parseUnits(total: string): number | null {
  const n = parseInt(total.replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function calcSimilarity(
  target: Record<string, unknown>,
  candidate: Record<string, unknown>,
): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};

  const tSido = extractSido(String(target.region ?? ""));
  const cSido = extractSido(String(candidate.region ?? ""));
  breakdown.region = tSido && cSido && tSido === cSido ? W.region : 0;

  const tDist = String(target.district ?? "");
  const cDist = String(candidate.district ?? "");
  breakdown.district = tDist && cDist && tDist === cDist ? W.district : 0;

  const tSize = parseMaxSize(String(target.size ?? ""));
  const cSize = parseMaxSize(String(candidate.size ?? ""));
  if (tSize !== null && cSize !== null) {
    const diff = Math.abs(tSize - cSize);
    breakdown.size = diff <= 5 ? W.size : diff <= 15 ? W.size * 0.6 : diff <= 30 ? W.size * 0.2 : 0;
  } else { breakdown.size = 0; }

  // price_controlled로 가격대 유사도 대리 측정
  const tPc = String(target.price_controlled ?? "");
  const cPc = String(candidate.price_controlled ?? "");
  breakdown.price = tPc && cPc && tPc === cPc ? W.price : 0;
  breakdown.price_controlled = tPc && cPc && tPc === cPc ? W.price_controlled : W.price_controlled * 0.2;

  const tBrand = normalizeBrand(String(target.constructor ?? ""));
  const cBrand = normalizeBrand(String(candidate.constructor ?? ""));
  breakdown.brand = tBrand && cBrand && (tBrand === cBrand || cBrand.includes(tBrand) || tBrand.includes(cBrand)) ? W.brand : 0;

  const tUnits = parseUnits(String(target.total_units ?? ""));
  const cUnits = parseUnits(String(candidate.total_units ?? ""));
  if (tUnits !== null && cUnits !== null && tUnits > 0) {
    const ratio = Math.min(tUnits, cUnits) / Math.max(tUnits, cUnits);
    breakdown.scale = ratio >= 0.7 ? W.scale : ratio >= 0.5 ? W.scale * 0.5 : 0;
  } else { breakdown.scale = 0; }

  return { score: Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0) * 100) / 100, breakdown };
}

function predictFromSimilar(
  items: Array<{ similarity_score: number; competition?: CompetitionResult | null }>,
): { expected_competition_rate: number | null; expected_winning_score: number | null; confidence: string } {
  const withComp = items.filter((i) => i.competition?.competition_rate != null);
  if (withComp.length === 0) return { expected_competition_rate: null, expected_winning_score: null, confidence: "insufficient_data" };

  const totalW = withComp.reduce((s, i) => s + i.similarity_score, 0);
  const avgRate = withComp.reduce((s, i) => s + i.similarity_score * i.competition!.competition_rate!, 0) / totalW;

  const withScore = withComp.filter((i) => i.competition?.winning_avg_score != null);
  let avgScore: number | null = null;
  if (withScore.length > 0) {
    const tw = withScore.reduce((s, i) => s + i.similarity_score, 0);
    avgScore = withScore.reduce((s, i) => s + i.similarity_score * i.competition!.winning_avg_score!, 0) / tw;
  }

  return {
    expected_competition_rate: Math.round(avgRate * 10) / 10,
    expected_winning_score: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
    confidence: withComp.length >= 3 ? "high" : withComp.length === 2 ? "medium" : "low",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const maxResults     = Math.min(parseInt(url.searchParams.get("max_results") ?? "5"), 10);
  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  const cacheKey = `similar:${announcementId}:${maxResults}`;
  const { data: cached } = await db.from("similar_listings_cache").select("result,cached_at").eq("cache_key", cacheKey).single();
  if (cached) {
    const age = (Date.now() - new Date(cached.cached_at).getTime()) / 1000;
    if (age < CACHE_TTL_SEC) return jsonResponse({ ...cached.result, cached: true });
  }

  const { data: target, error: tErr } = await db
    .from("announcements")
    .select("id,name,region,district,size,total_units,constructor,price_controlled,category,rcept_end")
    .eq("id", announcementId).single();

  if (tErr || !target) return jsonResponse({ error: "announcement not found" }, 404);

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
      similar_count: 0, items: [],
      predicted: { expected_competition_rate: null, expected_winning_score: null, confidence: "insufficient_data" },
      llm_analysis: null,
    });
  }

  const scored = candidates
    .map((c) => { const { score, breakdown } = calcSimilarity(target, c); return { ...c, similarity_score: score, score_breakdown: breakdown }; })
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, maxResults);

  const compResults = await Promise.allSettled(scored.map((c) => fetchCompetition(c.id)));

  const items = scored.map((c, i) => {
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

  // Gemini 자연어 분석
  let llm_analysis: string | null = null;
  const withData = items.filter((i) => i.competition_rate !== null);
  if (withData.length > 0) {
    const prompt = [
      `청약 공고 "${target.name}" (${target.region} ${target.district}, ${target.size})의 유사 과거 사례 분석:`,
      "",
      ...withData.slice(0, 3).map((i) =>
        `- ${i.name}: 경쟁률 ${i.competition_rate}:1, 평균 당첨가점 ${i.winning_avg_score ?? "데이터없음"}점 (유사도 ${Math.round(i.similarity_score * 100)}%)`
      ),
      "",
      predicted.expected_competition_rate
        ? `예상 경쟁률: ${predicted.expected_competition_rate}:1 (신뢰도: ${predicted.confidence})`
        : "",
      predicted.expected_winning_score
        ? `예상 당첨가점: ${predicted.expected_winning_score}점`
        : "",
      "",
      "위 데이터를 바탕으로 청약 전략을 한국어 3문장으로 조언해줘. 수치 근거 포함, 간결하게.",
    ].filter(Boolean).join("\n");
    llm_analysis = await generateText(prompt, 400);
  }

  const result = {
    announcement_id: announcementId,
    target: { name: target.name, region: `${target.region} ${target.district}`.trim(), size: target.size, constructor: target.constructor },
    similar_count: items.length,
    items: items.map(({ competition: _c, ...rest }) => rest),
    predicted,
    llm_analysis,
  };

  await db.from("similar_listings_cache").upsert({ cache_key: cacheKey, announcement_id: announcementId, result, cached_at: new Date().toISOString() });

  return jsonResponse(result);
});
