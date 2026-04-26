/** /v1/notifications — 인앱 알림 목록·읽음 처리
 *
 * 라우트:
 *   GET  /v1/notifications?unread_only=true&limit=20
 *     → 본인 알림 목록 + unread_count
 *
 *   PATCH /v1/notifications/{id}/read
 *     → 단일 알림 읽음 처리
 *
 *   PATCH /v1/notifications/read-all
 *     → 본인 전체 미읽음 알림 일괄 읽음
 *
 * 인증 필수. INSERT는 service_role만 (cron이 생성).
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

async function handleList(req: Request, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread_only") === "true";
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? "20", 10)));

  const db = getSupabaseClient();

  let query = db
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);

  // 미읽음 카운트는 별도 쿼리 (목록과 무관하게 항상 정확)
  const unreadCountResp = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  return jsonResponse({
    notifications: data ?? [],
    unread_count: unreadCountResp.count ?? 0,
  });
}

async function handleMarkRead(notificationId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id,read_at")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) {
    return jsonResponse(
      { error: "notification not found, already read, or not yours" },
      404,
    );
  }
  return jsonResponse({ id: data.id, read_at: data.read_at });
}

async function handleMarkAllRead(userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("notifications")
    .update({ read_at: now })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  return jsonResponse({ marked_read: data?.length ?? 0, read_at: now });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET") {
      return await handleList(req, user.id);
    }

    if (req.method === "PATCH") {
      // /functions/v1/notifications/read-all 또는 /functions/v1/notifications/{id}/read
      const last = pathParts[pathParts.length - 1];
      const secondLast = pathParts[pathParts.length - 2];

      if (last === "read-all") {
        return await handleMarkAllRead(user.id);
      }
      if (last === "read" && secondLast && secondLast !== "notifications") {
        return await handleMarkRead(secondLast, user.id);
      }
      return jsonResponse(
        { error: "expected /notifications/{id}/read or /notifications/read-all" },
        400,
      );
    }

    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`notifications error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
