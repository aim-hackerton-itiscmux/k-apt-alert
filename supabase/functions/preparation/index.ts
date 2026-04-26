/** /v1/preparation — 사용자 청약 준비 체크리스트 (앱 '준비' 탭)
 *
 * 라우트:
 *   POST /v1/preparation/init?announcement_id=X&supply_types=신혼부부,생애최초
 *     → 디폴트 체크리스트 12~15개 자동 생성 (이미 있으면 conflict 회피)
 *     · supply_types 미지정 시 user_profiles.special_supply_interests 사용
 *
 *   GET /v1/preparation?announcement_id=X
 *     → 본인 체크리스트 + summary { total, done, auto_done, manual_pending, percent }
 *     · documents 도메인(016)과 자동 연동:
 *       linked_doc_type 매칭되는 document.status='ready'면 effective_is_done=true
 *       (DB 저장 X — 응답 시 계산)
 *
 *   PATCH /v1/preparation/{id}/done
 *     body: { is_done: boolean }
 *     → 단일 항목 체크/언체크
 *
 *   DELETE /v1/preparation/{id}
 *     → 단일 항목 삭제 (사용자가 불필요한 항목 제거)
 *
 * 인증 필수. RLS로 본인 row만 격리.
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { buildChecklistTemplate, type ChecklistTemplateItem } from "../_shared/checklist-template.ts";

interface ChecklistRow {
  id: string;
  user_id: string;
  related_announcement_id: string | null;
  category: string;
  type: string;
  title: string;
  description: string | null;
  due_offset_days: number | null;
  is_auto_checkable: boolean;
  linked_doc_type: string | null;
  is_done: boolean;
  done_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface DocumentLite {
  doc_type: string;
  status: string;
}

/** documents 매핑 → linked_doc_type별 status 조회 */
async function readUserDocuments(userId: string): Promise<DocumentLite[]> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("documents")
    .select("doc_type, status")
    .eq("user_id", userId);
  if (error) {
    console.warn(`documents read failed (continuing without auto-check): ${error.message}`);
    return [];
  }
  return (data ?? []) as DocumentLite[];
}

/** 응답 row에 effective_is_done + linked_document_status 부여. */
function decorateWithDocuments(rows: ChecklistRow[], docs: DocumentLite[]) {
  const docMap = new Map<string, string>();  // doc_type → status
  for (const d of docs) {
    // 같은 doc_type이 여러 row면 가장 좋은 status 우선 (ready > expiring > expired > missing)
    const order: Record<string, number> = { ready: 4, expiring: 3, expired: 2, missing: 1 };
    const prev = docMap.get(d.doc_type);
    if (!prev || (order[d.status] ?? 0) > (order[prev] ?? 0)) {
      docMap.set(d.doc_type, d.status);
    }
  }

  return rows.map((row) => {
    const linkedStatus = row.linked_doc_type ? docMap.get(row.linked_doc_type) ?? null : null;
    const auto_done_by_doc = linkedStatus === "ready";
    const effective_is_done = row.is_done || auto_done_by_doc;
    return {
      ...row,
      linked_document_status: linkedStatus,
      auto_done_by_doc,
      effective_is_done,
    };
  });
}

function summarize(decorated: ReturnType<typeof decorateWithDocuments>) {
  const total = decorated.length;
  const done = decorated.filter((r) => r.effective_is_done).length;
  const auto_done = decorated.filter((r) => r.auto_done_by_doc).length;
  const manual_done = decorated.filter((r) => r.is_done && !r.auto_done_by_doc).length;
  const pending = total - done;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, auto_done, manual_done, pending, percent };
}

async function handleList(req: Request, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id");

  const db = getSupabaseClient();
  let query = db
    .from("preparation_checklist")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  if (announcementId) {
    query = query.eq("related_announcement_id", announcementId);
  }
  const { data, error } = await query;
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);

  const rows = (data ?? []) as ChecklistRow[];
  const docs = await readUserDocuments(userId);
  const decorated = decorateWithDocuments(rows, docs);
  return jsonResponse({
    items: decorated,
    summary: summarize(decorated),
  });
}

async function handleInit(req: Request, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id");
  const supplyTypesParam = url.searchParams.get("supply_types") ?? "";
  let supplyTypes = supplyTypesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // supply_types 미지정 시 user_profiles에서 자동 추출
  if (supplyTypes.length === 0) {
    const db = getSupabaseClient();
    const { data: profileRow } = await db
      .from("user_profiles")
      .select("profile")
      .eq("user_id", userId)
      .maybeSingle();
    const interests = (profileRow?.profile as Record<string, unknown> | null)
      ?.special_supply_interests;
    if (Array.isArray(interests)) supplyTypes = interests.map(String);
  }

  // 이미 init된 (user × announcement) 조합이면 conflict 회피 — 기존 row 반환
  const db = getSupabaseClient();
  const { data: existing } = await db
    .from("preparation_checklist")
    .select("id")
    .eq("user_id", userId)
    .eq("related_announcement_id", announcementId ?? "")
    .limit(1);
  if (existing && existing.length > 0) {
    // 이미 있으면 list로 리다이렉트
    return await handleList(req, userId);
  }

  const template = buildChecklistTemplate(supplyTypes);
  const rows = template.map((t: ChecklistTemplateItem) => ({
    user_id: userId,
    related_announcement_id: announcementId,
    category: t.category,
    type: t.type,
    title: t.title,
    description: t.description,
    due_offset_days: t.due_offset_days,
    is_auto_checkable: t.is_auto_checkable,
    linked_doc_type: t.linked_doc_type ?? null,
    sort_order: t.sort_order,
  }));

  const { data, error } = await db
    .from("preparation_checklist")
    .insert(rows)
    .select("*");
  if (error) return jsonResponse({ error: `db insert failed: ${error.message}` }, 500);

  const docs = await readUserDocuments(userId);
  const decorated = decorateWithDocuments((data ?? []) as ChecklistRow[], docs);
  return jsonResponse(
    {
      items: decorated,
      summary: summarize(decorated),
      initialized: rows.length,
      supply_types_used: supplyTypes,
    },
    201,
  );
}

async function handleToggle(req: Request, itemId: string, userId: string): Promise<Response> {
  let body: { is_done?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (typeof body.is_done !== "boolean") {
    return jsonResponse({ error: "is_done (boolean) required" }, 400);
  }

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("preparation_checklist")
    .update({ is_done: body.is_done })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "checklist item not found or not yours" }, 404);
  return jsonResponse({ item: data });
}

async function handleDelete(itemId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("preparation_checklist")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "checklist item not found or not yours" }, 404);
  return jsonResponse({ deleted: data.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    const secondLast = pathParts[pathParts.length - 2];

    // 라우트 패턴:
    // - /functions/v1/preparation               (GET / POST 의도 X — collection)
    // - /functions/v1/preparation/init          (POST)
    // - /functions/v1/preparation/{id}/done     (PATCH)
    // - /functions/v1/preparation/{id}          (DELETE)

    const isCollection = last === "preparation";
    const isInit = last === "init";
    const isDone = last === "done" && secondLast && secondLast !== "preparation";
    const itemId = (!isCollection && !isInit && !isDone) ? last : secondLast;

    if (isCollection) {
      if (req.method === "GET") return await handleList(req, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on collection` }, 405);
    }

    if (isInit) {
      if (req.method === "POST") return await handleInit(req, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on /init` }, 405);
    }

    if (isDone) {
      if (req.method === "PATCH") return await handleToggle(req, secondLast, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on /{id}/done` }, 405);
    }

    // 단일 리소스 (DELETE)
    if (!itemId || itemId.length < 8) {
      return jsonResponse({ error: "invalid item id" }, 400);
    }
    if (req.method === "DELETE") return await handleDelete(itemId, user.id);
    return jsonResponse({ error: `method ${req.method} not allowed on resource` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`preparation error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
