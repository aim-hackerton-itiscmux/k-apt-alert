/** /v1/notifications — 인앱 알림 목록·읽음·수동 생성·즉시 매칭
 *
 * 라우트:
 *   GET  /v1/notifications?unread_only=true&limit=20
 *     → 본인 알림 목록 + unread_count
 *
 *   POST /v1/notifications
 *     body: { type, title, body?, link?, related_announcement_id? }
 *     → 본인이 본인에게 임의 알림 생성 (favorite D-day, 메모, 테스트 등)
 *
 *   POST /v1/notifications/refresh?mode=dday_alert|announcement_new
 *     → 본인 프로필 매칭 즉시 실행 — notify-cron의 1인 버전.
 *       cron 시간(KST 06/08시) 기다리지 않고 사용자가 "지금 새로고침" 가능.
 *
 *   PATCH /v1/notifications/{id}/read
 *     → 단일 알림 읽음 처리
 *
 *   PATCH /v1/notifications/read-all
 *     → 본인 전체 미읽음 알림 일괄 읽음
 *
 * 인증 필수. INSERT는 RLS 정책으로 본인 user_id만 가능 (또는 service_role).
 *
 * NOTE: 006_notifications.sql RLS는 SELECT/UPDATE만 self_* 정책 있음.
 *       POST가 동작하려면 INSERT 정책 추가 필요 — 015 마이그레이션이 보충.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import { runNotifyMatch, type NotifyMode } from "../_shared/notify-match.ts";

const ALLOWED_MANUAL_TYPES = new Set([
  "user_memo",       // 사용자 메모 알림
  "favorite_dday",   // 즐겨찾기 공고 D-day 알림
  "test",            // 테스트
]);

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 1000;

interface ManualNotificationInput {
  type?: unknown;
  title?: unknown;
  body?: unknown;
  link?: unknown;
  related_announcement_id?: unknown;
}

function validateManual(body: ManualNotificationInput): string | null {
  if (typeof body.type !== "string" || !ALLOWED_MANUAL_TYPES.has(body.type)) {
    return `type must be one of ${[...ALLOWED_MANUAL_TYPES].join(", ")}`;
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return "title (string, non-empty) required";
  }
  if (body.title.length > MAX_TITLE_CHARS) {
    return `title too long (max ${MAX_TITLE_CHARS} chars)`;
  }
  if (body.body !== undefined && body.body !== null) {
    if (typeof body.body !== "string") return "body must be string";
    if (body.body.length > MAX_BODY_CHARS) return `body too long (max ${MAX_BODY_CHARS} chars)`;
  }
  if (body.link !== undefined && body.link !== null && typeof body.link !== "string") {
    return "link must be string";
  }
  if (
    body.related_announcement_id !== undefined &&
    body.related_announcement_id !== null &&
    typeof body.related_announcement_id !== "string"
  ) {
    return "related_announcement_id must be string";
  }
  return null;
}

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

async function handleCreate(req: Request, userId: string): Promise<Response> {
  let raw: ManualNotificationInput;
  try {
    raw = (await req.json()) as ManualNotificationInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validateManual(raw);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("notifications")
    .insert({
      user_id: userId,
      type: raw.type as string,
      title: (raw.title as string).trim(),
      body: ((raw.body as string) ?? "").trim(),
      link: (raw.link as string) ?? null,
      related_announcement_id: (raw.related_announcement_id as string) ?? null,
    })
    .select("*")
    .single();
  if (error) return jsonResponse({ error: `db insert failed: ${error.message}` }, 500);
  return jsonResponse({ notification: data }, 201);
}

async function handleRefresh(req: Request, userId: string): Promise<Response> {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "dday_alert") as NotifyMode;
  if (mode !== "dday_alert" && mode !== "announcement_new") {
    return jsonResponse({ error: "mode must be dday_alert or announcement_new" }, 400);
  }
  const dryRun = url.searchParams.get("dry_run") === "true";

  const db = getSupabaseClient() as SupabaseClient;
  const stats = await runNotifyMatch(db, mode, { dryRun, targetUserId: userId });
  return jsonResponse({
    mode,
    user_id: userId,
    dry_run: dryRun,
    ...stats,
    generated_at: new Date().toISOString(),
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
    const last = pathParts[pathParts.length - 1];
    const secondLast = pathParts[pathParts.length - 2];

    if (req.method === "GET") {
      return await handleList(req, user.id);
    }

    if (req.method === "POST") {
      if (last === "refresh") {
        return await handleRefresh(req, user.id);
      }
      if (last === "notifications") {
        return await handleCreate(req, user.id);
      }
      return jsonResponse(
        { error: "expected POST /notifications or /notifications/refresh" },
        400,
      );
    }

    if (req.method === "PATCH") {
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
