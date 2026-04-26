/** /v1/reports — AI 분석 리포트 저장·이력 (앱 'AI 리포트' 탭)
 *
 * 라우트:
 *   POST /v1/reports
 *     body: { notice_id, notice_url?, title?, summary_markdown, raw_excerpt?, matched_profile_snapshot?, match_score? }
 *     → 신규 저장. 클라이언트(LLM 호출 측)가 분석 완료 후 호출.
 *
 *   GET /v1/reports?limit=20
 *     → 본인 리포트 목록 (요약 포함, 최신순)
 *
 *   GET /v1/reports/{id}
 *     → 단일 리포트 상세
 *
 *   DELETE /v1/reports/{id}
 *     → 본인 리포트 삭제
 *
 * 인증 필수. RLS로 본인 row만 격리.
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

interface ReportInput {
  notice_id?: unknown;
  notice_url?: unknown;
  title?: unknown;
  summary_markdown?: unknown;
  raw_excerpt?: unknown;
  matched_profile_snapshot?: unknown;
  match_score?: unknown;
  // 020 추가 — AI 리포트 화면 풍부화
  verdict?: unknown;
  confidence_score?: unknown;
  key_points?: unknown;
  evidence?: unknown;
  charts_data?: unknown;
}

const MAX_SUMMARY_CHARS = 50000;
const MAX_EXCERPT_CHARS = 30000;
const ALLOWED_VERDICTS = new Set([
  "strong_recommend",
  "conditional_recommend",
  "caution",
  "not_recommend",
]);

function validateCreate(body: ReportInput): string | null {
  if (typeof body.notice_id !== "string" || !body.notice_id.trim()) {
    return "notice_id (string) required";
  }
  if (typeof body.summary_markdown !== "string" || !body.summary_markdown.trim()) {
    return "summary_markdown (string) required";
  }
  if (body.summary_markdown.length > MAX_SUMMARY_CHARS) {
    return `summary_markdown too long (max ${MAX_SUMMARY_CHARS} chars)`;
  }
  if (body.raw_excerpt !== undefined && body.raw_excerpt !== null) {
    if (typeof body.raw_excerpt !== "string") return "raw_excerpt must be string";
    if (body.raw_excerpt.length > MAX_EXCERPT_CHARS) {
      return `raw_excerpt too long (max ${MAX_EXCERPT_CHARS} chars)`;
    }
  }
  if (body.notice_url !== undefined && body.notice_url !== null && typeof body.notice_url !== "string") {
    return "notice_url must be string";
  }
  if (body.title !== undefined && body.title !== null && typeof body.title !== "string") {
    return "title must be string";
  }
  if (body.match_score !== undefined && body.match_score !== null) {
    const n = Number(body.match_score);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return "match_score must be 0..1000";
    }
  }
  // 020 추가 필드 검증
  if (body.verdict !== undefined && body.verdict !== null) {
    if (typeof body.verdict !== "string" || !ALLOWED_VERDICTS.has(body.verdict)) {
      return `verdict must be one of ${[...ALLOWED_VERDICTS].join(", ")}`;
    }
  }
  if (body.confidence_score !== undefined && body.confidence_score !== null) {
    const n = Number(body.confidence_score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return "confidence_score must be 0..100";
    }
  }
  if (body.key_points !== undefined && body.key_points !== null) {
    if (!Array.isArray(body.key_points)) return "key_points must be array";
    if (body.key_points.length > 20) return "key_points too long (max 20)";
  }
  if (body.evidence !== undefined && body.evidence !== null) {
    if (!Array.isArray(body.evidence)) return "evidence must be array";
    if (body.evidence.length > 30) return "evidence too long (max 30)";
  }
  if (body.charts_data !== undefined && body.charts_data !== null) {
    if (typeof body.charts_data !== "object" || Array.isArray(body.charts_data)) {
      return "charts_data must be object";
    }
  }
  return null;
}

async function handleCreate(req: Request, userId: string): Promise<Response> {
  let body: ReportInput;
  try {
    body = (await req.json()) as ReportInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validateCreate(body);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("reports")
    .insert({
      user_id: userId,
      notice_id: (body.notice_id as string).trim(),
      notice_url: ((body.notice_url as string) ?? "").trim(),
      title: ((body.title as string) ?? "").trim(),
      summary_markdown: body.summary_markdown,
      raw_excerpt: body.raw_excerpt ?? null,
      matched_profile_snapshot: body.matched_profile_snapshot ?? null,
      match_score: body.match_score !== undefined ? Number(body.match_score) : null,
      // 020 추가 필드
      verdict: (body.verdict as string) ?? null,
      confidence_score: body.confidence_score !== undefined && body.confidence_score !== null
        ? Number(body.confidence_score)
        : null,
      key_points: body.key_points ?? null,
      evidence: body.evidence ?? null,
      charts_data: body.charts_data ?? null,
    })
    .select("*")
    .single();
  if (error) return jsonResponse({ error: `db insert failed: ${error.message}` }, 500);
  return jsonResponse({ report: data }, 201);
}

async function handleList(req: Request, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const noticeIdFilter = url.searchParams.get("notice_id") ?? "";

  const db = getSupabaseClient();
  let query = db
    .from("reports")
    .select("id,notice_id,notice_url,title,match_score,verdict,confidence_score,created_at")  // 목록은 본문 제외, verdict/confidence는 카드 표시용
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (noticeIdFilter) {
    query = query.eq("notice_id", noticeIdFilter);
  }
  const { data, error } = await query;
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  return jsonResponse({ reports: data ?? [], count: data?.length ?? 0 });
}

async function handleGet(reportId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "report not found or not yours" }, 404);
  return jsonResponse({ report: data });
}

async function handleDelete(reportId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("reports")
    .delete()
    .eq("id", reportId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "report not found or not yours" }, 404);
  return jsonResponse({ deleted: data.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // /functions/v1/reports 또는 /functions/v1/reports/{id}
    const lastPart = pathParts[pathParts.length - 1];
    const isCollection = lastPart === "reports";
    const reportId = isCollection ? null : lastPart;

    if (isCollection) {
      if (req.method === "POST") return await handleCreate(req, user.id);
      if (req.method === "GET") return await handleList(req, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on collection` }, 405);
    }

    // 단일 리소스
    if (!reportId || reportId.length < 8) {
      return jsonResponse({ error: "invalid report id" }, 400);
    }
    if (req.method === "GET") return await handleGet(reportId, user.id);
    if (req.method === "DELETE") return await handleDelete(reportId, user.id);
    return jsonResponse({ error: `method ${req.method} not allowed on resource` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`reports error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
