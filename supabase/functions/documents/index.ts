/** /v1/documents — 사용자 청약 준비 서류함 (앱 '준비' 탭 / '내 서류함' 화면)
 *
 * 라우트:
 *   GET    /v1/documents
 *     → { documents: [...], summary: { required, ready, missing, expiring, expired } }
 *
 *   POST   /v1/documents
 *     body: { doc_type, doc_type_label_ko, description?, is_required?,
 *             issued_date?, validity_months?, file_url?, file_storage_path?,
 *             file_byte_size?, file_mime?, notes? }
 *     → { document: {...} }  (status는 트리거가 자동 계산)
 *
 *   POST   /v1/documents/upload-url
 *     body: { filename, mime }
 *     → { storage_path, upload_url }  (Supabase Storage signed upload URL)
 *
 *   PATCH  /v1/documents/{id}
 *     body: 위 INSERT 필드 일부 (doc_type 변경 불가)
 *     → { document: {...} }
 *
 *   DELETE /v1/documents/{id}
 *     → { deleted: id }  (Storage 파일도 같이 삭제 시도)
 *
 * 인증 필수. RLS로 본인 row만 격리.
 * Storage bucket 'user-documents' 폴더 구조: {user_id}/{filename}
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";

const STORAGE_BUCKET = "user-documents";

const ALLOWED_DOC_TYPES = new Set([
  "resident_register",   // 주민등록등본
  "family_relation",     // 가족관계증명서
  "savings_account",     // 청약통장 가입확인서
  "income_proof",        // 소득증빙
  "homeless_proof",      // 무주택증명
  "marriage_proof",      // 혼인관계증명
  "children_proof",      // 자녀(다자녀) 증명
  "other",
]);
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;  // 10MB
const MAX_TITLE_CHARS = 200;
const MAX_NOTES_CHARS = 1000;

// 화이트리스트 — POST/PATCH에서 받을 수 있는 필드
const ALLOWED_FIELDS_CREATE = [
  "doc_type",
  "doc_type_label_ko",
  "description",
  "is_required",
  "issued_date",
  "expires_date",
  "validity_months",
  "file_url",
  "file_storage_path",
  "file_byte_size",
  "file_mime",
  "notes",
] as const;

const ALLOWED_FIELDS_UPDATE = [
  "doc_type_label_ko",  // doc_type 자체는 immutable (status compute에 영향)
  "description",
  "is_required",
  "issued_date",
  "expires_date",
  "validity_months",
  "file_url",
  "file_storage_path",
  "file_byte_size",
  "file_mime",
  "notes",
] as const;

interface DocumentInput {
  [k: string]: unknown;
}

function sanitize(body: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    if (key in (body as Record<string, unknown>)) {
      const v = (body as Record<string, unknown>)[key];
      if (v !== undefined) result[key] = v;
    }
  }
  return result;
}

function validate(body: DocumentInput, isCreate: boolean): string | null {
  if (isCreate) {
    if (typeof body.doc_type !== "string" || !ALLOWED_DOC_TYPES.has(body.doc_type)) {
      return `doc_type must be one of ${[...ALLOWED_DOC_TYPES].join(", ")}`;
    }
    if (typeof body.doc_type_label_ko !== "string" || !body.doc_type_label_ko.trim()) {
      return "doc_type_label_ko (non-empty string) required";
    }
  } else if (body.doc_type_label_ko !== undefined) {
    if (typeof body.doc_type_label_ko !== "string" || !body.doc_type_label_ko.trim()) {
      return "doc_type_label_ko must be non-empty string";
    }
  }

  if (body.doc_type_label_ko && (body.doc_type_label_ko as string).length > MAX_TITLE_CHARS) {
    return `doc_type_label_ko too long (max ${MAX_TITLE_CHARS})`;
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== "string") return "notes must be string";
    if (body.notes.length > MAX_NOTES_CHARS) return `notes too long (max ${MAX_NOTES_CHARS})`;
  }
  if (body.validity_months !== undefined && body.validity_months !== null) {
    const n = Number(body.validity_months);
    if (!Number.isInteger(n) || n < 0 || n > 120) return "validity_months must be 0..120";
  }
  if (body.file_byte_size !== undefined && body.file_byte_size !== null) {
    const n = Number(body.file_byte_size);
    if (!Number.isFinite(n) || n < 0 || n > MAX_FILE_BYTES) {
      return `file_byte_size must be 0..${MAX_FILE_BYTES}`;
    }
  }
  if (body.file_mime !== undefined && body.file_mime !== null) {
    if (typeof body.file_mime !== "string" || !ALLOWED_MIMES.has(body.file_mime)) {
      return `file_mime must be one of ${[...ALLOWED_MIMES].join(", ")}`;
    }
  }
  if (body.issued_date !== undefined && body.issued_date !== null) {
    if (typeof body.issued_date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(body.issued_date)) {
      return "issued_date must be YYYY-MM-DD";
    }
  }
  if (body.expires_date !== undefined && body.expires_date !== null) {
    if (typeof body.expires_date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(body.expires_date)) {
      return "expires_date must be YYYY-MM-DD";
    }
  }
  return null;
}

async function handleList(userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);

  const docs = data ?? [];
  const summary = {
    total: docs.length,
    required: docs.filter((d) => d.is_required).length,
    ready: docs.filter((d) => d.status === "ready").length,
    missing: docs.filter((d) => d.status === "missing").length,
    expiring: docs.filter((d) => d.status === "expiring").length,
    expired: docs.filter((d) => d.status === "expired").length,
  };
  return jsonResponse({ documents: docs, summary });
}

async function handleCreate(req: Request, userId: string): Promise<Response> {
  let raw: DocumentInput;
  try {
    raw = (await req.json()) as DocumentInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validate(raw, true);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const fields = sanitize(raw, ALLOWED_FIELDS_CREATE);
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("documents")
    .insert({ user_id: userId, ...fields })
    .select("*")
    .single();
  if (error) return jsonResponse({ error: `db insert failed: ${error.message}` }, 500);
  return jsonResponse({ document: data }, 201);
}

async function handleUploadUrl(req: Request, userId: string): Promise<Response> {
  let body: { filename?: string; mime?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (!body.filename || typeof body.filename !== "string") {
    return jsonResponse({ error: "filename required" }, 400);
  }
  if (body.mime && !ALLOWED_MIMES.has(body.mime)) {
    return jsonResponse({ error: `mime must be one of ${[...ALLOWED_MIMES].join(", ")}` }, 400);
  }
  // 파일명 sanitize — path traversal 방지
  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const timestamp = Date.now();
  const storagePath = `${userId}/${timestamp}_${safeName}`;

  const db = getSupabaseClient();
  const { data, error } = await db.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) return jsonResponse({ error: `signed url failed: ${error.message}` }, 500);

  return jsonResponse({
    storage_path: storagePath,
    upload_url: data.signedUrl,
    token: data.token,
    bucket: STORAGE_BUCKET,
    public_url_template: null,  // 비공개 bucket — 다운로드는 별도 signed URL 발급 필요
  });
}

async function handleGet(docId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("documents")
    .select("*")
    .eq("id", docId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "document not found or not yours" }, 404);
  return jsonResponse({ document: data });
}

async function handleUpdate(req: Request, docId: string, userId: string): Promise<Response> {
  let raw: DocumentInput;
  try {
    raw = (await req.json()) as DocumentInput;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const validationError = validate(raw, false);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const fields = sanitize(raw, ALLOWED_FIELDS_UPDATE);
  if (Object.keys(fields).length === 0) {
    return jsonResponse({ error: "no updatable fields in body" }, 400);
  }

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("documents")
    .update(fields)
    .eq("id", docId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);
  if (!data) return jsonResponse({ error: "document not found or not yours" }, 404);
  return jsonResponse({ document: data });
}

async function handleDelete(docId: string, userId: string): Promise<Response> {
  const db = getSupabaseClient();
  // 1. row 조회 (storage_path 확인용)
  const { data: row, error: readErr } = await db
    .from("documents")
    .select("file_storage_path")
    .eq("id", docId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) return jsonResponse({ error: `db error: ${readErr.message}` }, 500);
  if (!row) return jsonResponse({ error: "document not found or not yours" }, 404);

  // 2. row 삭제
  const { error: delErr } = await db
    .from("documents")
    .delete()
    .eq("id", docId)
    .eq("user_id", userId);
  if (delErr) return jsonResponse({ error: `db delete failed: ${delErr.message}` }, 500);

  // 3. storage 파일 삭제 시도 (실패해도 row 삭제는 성공으로 간주)
  if (row.file_storage_path) {
    try {
      await db.storage.from(STORAGE_BUCKET).remove([row.file_storage_path]);
    } catch (e) {
      console.warn(`storage delete failed for ${row.file_storage_path}:`, e);
    }
  }
  return jsonResponse({ deleted: docId });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const last = pathParts[pathParts.length - 1];

    // Collection: /functions/v1/documents
    // Resource:   /functions/v1/documents/{id}
    // Upload URL: /functions/v1/documents/upload-url
    const isCollection = last === "documents";
    const isUploadUrl = last === "upload-url";
    const docId = (!isCollection && !isUploadUrl) ? last : null;

    if (isCollection) {
      if (req.method === "GET") return await handleList(user.id);
      if (req.method === "POST") return await handleCreate(req, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on collection` }, 405);
    }

    if (isUploadUrl) {
      if (req.method === "POST") return await handleUploadUrl(req, user.id);
      return jsonResponse({ error: `method ${req.method} not allowed on upload-url` }, 405);
    }

    // 단일 리소스
    if (!docId || docId.length < 8) {
      return jsonResponse({ error: "invalid document id" }, 400);
    }
    if (req.method === "GET") return await handleGet(docId, user.id);
    if (req.method === "PATCH") return await handleUpdate(req, docId, user.id);
    if (req.method === "DELETE") return await handleDelete(docId, user.id);
    return jsonResponse({ error: `method ${req.method} not allowed on resource` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`documents error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
