/** /v1/profile — GET (본인 프로필 + derived) / PATCH (JSONB 부분 머지)
 *
 * 운영 main DB의 `user_profiles` 테이블 사용 (my-score Edge Function과 호환):
 *   user_profiles ( user_id TEXT PK, profile JSONB, score JSONB, updated_at )
 *
 * 동작:
 * - GET — profile JSONB + score JSONB + derived fields(age, homeless_years 등) 반환
 * - PATCH — body의 화이트리스트 필드만 받아 profile JSONB에 부분 머지
 *
 * Phase 1 미구현: 가점 자동 재계산 — my-score가 담당하므로 본 라우트는 score 갱신 X.
 *   (mypage에서 "확정 계산" 버튼 누르면 my-score POST 호출하면 됨)
 *
 * 인증 필수 — _shared/auth.ts 사용 (--no-verify-jwt 배포 가정).
 * RLS 정책 `auth.uid()::text = user_id` 가 본인 row만 격리.
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { requireUser, authErrorResponse } from "../_shared/auth.ts";
import {
  deriveFields,
  mergeProfile,
  sanitizeProfileUpdate,
  validateProfileUpdate,
  type FullProfile,
} from "../_shared/profile.ts";

interface UserProfileRow {
  user_id: string;
  profile: FullProfile;
  score: Record<string, unknown> | null;
  updated_at: string;
}

async function readProfile(userId: string): Promise<UserProfileRow | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("user_profiles")
    .select("user_id,profile,score,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`db read failed: ${error.message}`);
  return (data as UserProfileRow | null) ?? null;
}

async function writeProfile(userId: string, profile: FullProfile): Promise<UserProfileRow> {
  const db = getSupabaseClient();
  // upsert로 row 없으면 신규 생성, 있으면 profile만 갱신 (score는 my-score가 관리)
  const { data, error } = await db
    .from("user_profiles")
    .upsert(
      {
        user_id: userId,
        profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("user_id,profile,score,updated_at")
    .single();
  if (error) throw new Error(`db upsert failed: ${error.message}`);
  return data as UserProfileRow;
}

function buildResponse(row: UserProfileRow) {
  return {
    user_id: row.user_id,
    profile: row.profile ?? {},
    derived: deriveFields(row.profile ?? {}),
    score: row.score,
    updated_at: row.updated_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const user = await requireUser(req);
    const userIdText = user.id;  // UUID string — user_profiles는 TEXT 컬럼

    if (req.method === "GET") {
      const row = await readProfile(userIdText);
      if (!row) {
        // 빈 row 자동 생성 후 반환 (mypage 첫 진입)
        const created = await writeProfile(userIdText, {});
        return jsonResponse(buildResponse(created));
      }
      return jsonResponse(buildResponse(row));
    }

    if (req.method === "PATCH") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ error: "invalid JSON body" }, 400);
      }
      const update = sanitizeProfileUpdate(body);
      if (Object.keys(update).length === 0) {
        return jsonResponse({ error: "no updatable fields in body" }, 400);
      }
      const validationError = validateProfileUpdate(update);
      if (validationError) {
        return jsonResponse({ error: validationError }, 400);
      }

      const existing = await readProfile(userIdText);
      const merged = mergeProfile(existing?.profile ?? {}, update);
      const written = await writeProfile(userIdText, merged);
      return jsonResponse(buildResponse(written));
    }

    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    console.error(`profile error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
