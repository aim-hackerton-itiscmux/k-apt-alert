/** TEMPORARY diagnostic — OAuth access token 발급 + FCM v1 호출 동작 확인. 검증 후 삭제. */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

const PROJECT_ID    = Deno.env.get("FIREBASE_PROJECT_ID")    ?? "";
const CLIENT_EMAIL  = Deno.env.get("FIREBASE_CLIENT_EMAIL")  ?? "";
const PRIVATE_KEY   = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const result: Record<string, unknown> = {
    project_id_set:   !!PROJECT_ID,
    client_email_set: !!CLIENT_EMAIL,
    private_key_set:  !!PRIVATE_KEY,
    private_key_length: PRIVATE_KEY.length,
    private_key_starts_with: PRIVATE_KEY.slice(0, 50),
    private_key_ends_with:   PRIVATE_KEY.slice(-50),
    contains_begin_marker:  PRIVATE_KEY.includes("-----BEGIN"),
    contains_end_marker:    PRIVATE_KEY.includes("-----END"),
    contains_real_newline:  PRIVATE_KEY.includes("\n"),
    contains_escaped_newline: PRIVATE_KEY.includes("\\n"),
  };

  // 1. Private key 임포트 시도
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    result.key_import = "ok";
  } catch (e) {
    result.key_import_error = String(e);
    return jsonResponse(result, 500);
  }

  // 2. JWT 생성 + OAuth access token 발급
  const now     = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = { iss: CLIENT_EMAIL, scope: FCM_SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 };
  const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;

  let accessToken = "";
  try {
    const resp = await fetch(TOKEN_URI, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:  jwt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      result.oauth_status = resp.status;
      result.oauth_error  = data;
      return jsonResponse(result, 500);
    }
    accessToken = data.access_token;
    result.oauth_status     = "ok";
    result.token_prefix     = accessToken.slice(0, 20) + "...";
    result.token_expires_in = data.expires_in;
  } catch (e) {
    result.oauth_exception = String(e);
    return jsonResponse(result, 500);
  }

  // 3. FCM v1 호출 (가짜 토큰으로 — 401/404 받으면 OAuth는 OK라는 증거)
  try {
    const fcmResp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
      {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          message: {
            token: "fake_invalid_fcm_token_for_diagnostic",
            notification: { title: "Test", body: "FCM diagnostic" },
          },
        }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const fcmData = await fcmResp.json();
    result.fcm_status   = fcmResp.status;
    result.fcm_response = fcmData;
  } catch (e) {
    result.fcm_exception = String(e);
  }

  return jsonResponse(result);
});
