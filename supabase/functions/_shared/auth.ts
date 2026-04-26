/** Supabase Auth — JWT 검증 및 인증된 사용자 식별.
 *
 * 사용 패턴:
 *   const user = await requireUser(req);  // 401 시 throw
 *   // user.id로 RLS 검증된 쿼리
 *
 * 또는 옵셔널 인증:
 *   const user = await getUserOrNull(req);
 *   if (user) { ... } else { /* 익명 흐름 */ }
 *
 * 설계:
 * - service_role 클라이언트로 토큰 검증 (auth.getUser는 anon key로도 동작하지만 일관성)
 * - 인증 실패는 AuthError를 throw, 라우트가 401 응답
 * - RLS는 DB 레벨에서 처리하므로 user_id만 신뢰하면 충분
 */

import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

let _authClient: SupabaseClient | null = null;

function getAuthClient(): SupabaseClient {
  if (_authClient) return _authClient;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }
  _authClient = createClient(url, anon);
  return _authClient;
}

/** Authorization 헤더에서 Bearer 토큰 추출. 없으면 null. */
function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** JWT를 검증하고 사용자 정보 반환. 토큰 없거나 invalid면 null. */
export async function getUserOrNull(req: Request): Promise<User | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const client = getAuthClient();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/** 인증 필수 — 토큰 없거나 invalid면 AuthError throw (라우트는 401 응답). */
export async function requireUser(req: Request): Promise<User> {
  const user = await getUserOrNull(req);
  if (!user) {
    throw new AuthError("Authentication required — provide Authorization: Bearer <jwt>");
  }
  return user;
}

/** 라우트 핸들러에서 AuthError를 자동으로 401 응답으로 변환하는 헬퍼. */
export function authErrorResponse(e: unknown): Response | null {
  if (e instanceof AuthError) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
