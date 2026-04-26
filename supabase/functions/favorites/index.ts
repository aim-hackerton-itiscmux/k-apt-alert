/** /v1/favorites — 즐겨찾기 공고 (앱 '공고 상세' 화면의 favorite 액션)
 *
 * 라우트:
 *   GET    /v1/favorites
 *     → 본인 즐겨찾기 + announcement 메타 JOIN + summary
 *
 *   POST   /v1/favorites
 *     body: { announcement_id, notes?, notify_on_change? }
 *     → 즐겨찾기 추가 (UNIQUE 제약 — 이미 있으면 409)
 *
 *   PATCH  /v1/favorites/{id}
 *     body: { notes?, notify_on_change? }
 *     → 메모/알림 설정 변경
 *
 *   DELETE /v1/favorites/{id}
 *     또는 DELETE /v1/favorites?announcement_id=X (id 모를 때)
 *     → 즐겨찾기 해제
 *
 * 인증 필수. RLS로 본인만 격리. UNIQUE(user_id, announcement_id).
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

const MAX_NOTES_CHARS = 1000;

interface FavoriteInput {
  announcement_id?: unknown;
  notes?: unknown;
  notify_on_change?: unknown;
}

function validateCreate(body: FavoriteInput): string | null {
  if (typeof body.announcement_id !== "string" || !body.announcement_id.trim()) {
    return "announcement_id (string) required";
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") return "notes must be string";
    if (body.notes.length > MAX_NOTES_CHARS) return `notes too long (max ${MAX_NOTES_CHARS})`;
  }
  if (body.notify_on_change !== undefined && typeof body.notify_on_change !== "boolean") {
    return "notify_on_change must be boolean";
  }
  return null;
}

function validateUpdate(body: FavoriteInput): string | null {
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") return "notes must be string";
    if (body.notes.length > MAX_NOTES_CHARS) return `notes too long (max ${MAX_NOTES_CHARS})`;
  }
  if (body.notify_on_change !== undefined && typeof body.notify_on_change !== "boolean") {
    return "notify_on_change must be boolean";
  }
  return null;
}

async function handleList(userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("favorites")
    .select(`
      *,
      announcement:announcements (
        id, name, region, district, period, rcept_end, total_units,
        house_type, house_category, url, speculative_zone, price_controlled
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);

  const favorites = data ?? [];
  return jsonResponse({
    favorites,
    summary: {
      total: favorites.length,
      notify_on_change_count: favorites.filter((f) => f.notify_on_change).length,
    },
  });
}

async function handleCreate(req: Request, userId: string): Promise<Response> {
  let raw: FavoriteInput;
  try {
    raw = (await req.json()) as FavoriteInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validateCreate(raw);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("favorites")
    .insert({
      user_id: userId,
      announcement_id: (raw.announcement_id as string).trim(),
      notes: (raw.notes as string) ?? null,
      notify_on_change: (raw.notify_on_change as boolean) ?? true,
    })
    .select("*")
    .single();
  if (error) {
    // UNIQUE 위반 (23505)
    if (error.code === "23505") {
      return jsonResponse({ error: "already favorited", code: "ALREADY_EXISTS" }, 409);
    }
    // FK 위반 (23503) — announcement_id가 announcements에 없음
    if (error.code === "23503") {
      return jsonResponse({ error: "announcement_id not found", code: "ANNOUNCEMENT_NOT_FOUND" }, 404);
    }
    return jsonResponse({ error: `db insert failed: ${error.message}` }, 500);
  }
  return jsonResponse({ favorite: data }, 201);
}

async function handleUpdate(req: Request, favId: string, userId: string): Promise<Response> {
  let raw: FavoriteInput;
  try {
    raw = (await req.json()) as FavoriteInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validateUpdate(raw);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const update: Record<string, unknown> = {};
  if (raw.notes !== undefined) update.notes = raw.notes;
  if (raw.notify_on_change !== undefined) update.notify_on_change = raw.notify_on_change;
  if (Object.keys(update).length === 0) {
    return jsonResponse({ error: "no updatable fields" }, 400);
  }

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("favorites")
    .update(update)
    .eq("id", favId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "favorite not found or not yours" }, 404);
  return jsonResponse({ favorite: data });
}

async function handleDelete(req: Request, favId: string | null, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  let query = db.from("favorites").delete().eq("user_id", userId);
  if (favId) {
    query = query.eq("id", favId);
  } else {
    // ?announcement_id=X 폴백 (id 모를 때 토글 UX)
    const url = new URL(req.url);
    const annId = url.searchParams.get("announcement_id");
    if (!annId) {
      return jsonResponse({ error: "favorite id (path) or announcement_id (query) required" }, 400);
    }
    query = query.eq("announcement_id", annId);
  }
  const { data, error } = await query.select("id");
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data || data.length === 0) {
    return jsonResponse({ error: "favorite not found or not yours" }, 404);
  }
  return jsonResponse({ deleted: data.map((d) => d.id), count: data.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const last = pathParts[pathParts.length - 1];

    const isCollection = last === "favorites";
    const favId = !isCollection ? last : null;

    if (isCollection) {
      if (req.method === "GET") return await handleList(user.id);
      if (req.method === "POST") return await handleCreate(req, user.id);
      if (req.method === "DELETE") return await handleDelete(req, null, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on collection` }, 405);
    }

    if (!favId || favId.length < 8) {
      return jsonResponse({ error: "invalid favorite id" }, 400);
    }
    if (req.method === "PATCH") return await handleUpdate(req, favId, user.id);
    if (req.method === "DELETE") return await handleDelete(req, favId, user.id);
    return jsonResponse({ error: `method ${req.method} not allowed on resource` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`favorites error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
