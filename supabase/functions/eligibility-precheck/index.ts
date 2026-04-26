/** POST /v1/apt/eligibility-precheck — 부적격 위험 사전 검증 + 가점 계산 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { calcScore, checkEligibility, UserProfile } from "../_shared/eligibility.ts";
import { generateText } from "../_shared/gemini.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const announcementId = String(body.announcement_id ?? "");
  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  // profile 파싱 + 기본값 적용
  const profile: UserProfile = {
    birth_date:              String(body.birth_date ?? "1990-01-01"),
    is_married:              Boolean(body.is_married ?? false),
    marriage_date:           body.marriage_date ? String(body.marriage_date) : undefined,
    dependents_count:        Number(body.dependents_count ?? 0),
    is_homeless:             Boolean(body.is_homeless ?? true),
    homeless_since:          body.homeless_since ? String(body.homeless_since) : undefined,
    savings_start:           String(body.savings_start ?? "2020-01-01"),
    savings_balance_wan:     Number(body.savings_balance_wan ?? 0),
    resident_region:         String(body.resident_region ?? "서울"),
    has_house:               Boolean(body.has_house ?? false),
    parents_registered:      Boolean(body.parents_registered ?? false),
    parents_registered_since: body.parents_registered_since
      ? String(body.parents_registered_since)
      : undefined,
  };

  const db = getSupabaseClient();

  // 공고 조회
  const { data: ann, error } = await db
    .from("announcements")
    .select("id,name,region,district,size,speculative_zone,price_controlled,house_type,house_category")
    .eq("id", announcementId)
    .single();

  if (error || !ann) return jsonResponse({ error: "announcement not found" }, 404);

  // 가점 계산 + 부적격 체크
  const score    = calcScore(profile);
  const warnings = checkEligibility(profile, ann as Record<string, unknown>);

  const criticals = warnings.filter((w) => w.severity === "critical");
  const eligible  = criticals.length === 0;

  // Gemini 분석 (있으면)
  let llm_summary: string | null = null;
  if (warnings.length > 0) {
    const prompt = [
      `청약 공고: ${ann.name} (${ann.region} ${ann.district})`,
      `가점 합계: ${score.total}점 / 84점`,
      `위험 항목 ${warnings.length}건:`,
      ...warnings.map((w, i) => `${i + 1}. [${w.severity}] ${w.message}`),
      "",
      "위 청약 신청자의 부적격 위험과 주의사항을 한국어 3문장으로 요약해줘. 핵심 위험만 명확하게.",
    ].join("\n");
    llm_summary = await generateText(prompt, 300);
  }

  return jsonResponse({
    announcement_id: announcementId,
    announcement: { name: ann.name, region: `${ann.region} ${ann.district}`.trim() },
    eligible,
    critical_count: criticals.length,
    warnings,
    score,
    llm_summary,
  });
});
