/** GET /v1/apt/development-news — 호재 신뢰도 검증 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { extractKeywords, searchNews, calcReliabilityScore } from "../_shared/news.ts";

const NAVER_CLIENT_ID     = Deno.env.get("NAVER_CLIENT_ID")     ?? "";
const NAVER_CLIENT_SECRET = Deno.env.get("NAVER_CLIENT_SECRET") ?? "";
const CACHE_TTL_HOURS     = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return jsonResponse({ error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not configured" }, 503);
  }

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";
  const name           = url.searchParams.get("name")     ?? "";
  const district       = url.searchParams.get("district") ?? "";
  const adText         = url.searchParams.get("ad_text")  ?? "";

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);
  if (!district)       return jsonResponse({ error: "district required" }, 400);

  const db = getSupabaseClient();

  const { data: cached } = await db
    .from("development_news_cache")
    .select("result, created_at")
    .eq("announcement_id", announcementId)
    .single();

  if (cached) {
    const ageHours = (Date.now() - new Date(cached.created_at).getTime()) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) return jsonResponse(cached.result);
  }

  // 호재 키워드 추출
  const searchText = [name, district, adText].filter(Boolean).join(" ");
  const keywords   = extractKeywords(searchText);

  if (keywords.length === 0) {
    const result = {
      announcement_id: announcementId,
      claimed_developments: [],
      verified_developments: [],
      marketing_only: [],
      reliability_score: 0,
      news_summary: [],
    };
    return jsonResponse(result);
  }

  // 네이버 뉴스 병렬 검색
  const newsSummary = await Promise.all(
    keywords.map((kw) => searchNews(kw, district, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)),
  );

  // 기사 10건 이상 = 검증된 호재, 미만 = 마케팅 가능성
  const verified  = newsSummary.filter((n) => n.article_count >= 10).map((n) => n.keyword);
  const marketing = newsSummary.filter((n) => n.article_count < 10).map((n) => n.keyword);

  const result = {
    announcement_id: announcementId,
    claimed_developments: keywords,
    verified_developments: verified,
    marketing_only: marketing,
    reliability_score: calcReliabilityScore(newsSummary),
    news_summary: newsSummary,
  };

  await db.from("development_news_cache").upsert({
    announcement_id: announcementId,
    result,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(result);
});
