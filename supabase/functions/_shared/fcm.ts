/** FCM HTTP v1 API — service account JWT → OAuth access token → /v1/projects/{id}/messages:send
 *
 * Legacy /fcm/send API는 2024년 6월 deprecation, 2024년 7월 22일 차단됨.
 * Service account 기반 v1 API로 마이그레이션.
 *
 * 필요 환경변수:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY (PEM 형식, 줄바꿈은 실제 \n 또는 escape \\n 모두 지원)
 */

const PROJECT_ID    = Deno.env.get("FIREBASE_PROJECT_ID")    ?? "";
const CLIENT_EMAIL  = Deno.env.get("FIREBASE_CLIENT_EMAIL")  ?? "";
const PRIVATE_KEY   = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");

const TOKEN_URI    = "https://oauth2.googleapis.com/token";
const FCM_SCOPE    = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

let _cachedToken: { token: string; expiresAt: number } | null = null;
let _cachedKey:   CryptoKey | null = null;

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

async function importPrivateKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;
  if (!PRIVATE_KEY) throw new Error("FIREBASE_PRIVATE_KEY not set");
  _cachedKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return _cachedKey;
}

async function getAccessToken(): Promise<string> {
  // 60초 여유 두고 캐시 사용
  if (_cachedToken && _cachedToken.expiresAt - 60_000 > Date.now()) {
    return _cachedToken.token;
  }
  if (!CLIENT_EMAIL) throw new Error("FIREBASE_CLIENT_EMAIL not set");

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss:   CLIENT_EMAIL,
    scope: FCM_SCOPE,
    aud:   TOKEN_URI,
    iat:   now,
    exp:   now + 3600,
  };
  const signingInput = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;

  const key = await importPrivateKey();
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;

  const resp = await fetch(TOKEN_URI, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:  jwt,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token fetch failed (${resp.status}): ${text}`);
  }
  const data = await resp.json();
  _cachedToken = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };
  return _cachedToken.token;
}

/** FCM v1 API로 단일 디바이스 푸시 전송. 실패 시 console.warn만. */
export async function sendFCM(fcmToken: string, title: string, body: string): Promise<void> {
  if (!PROJECT_ID || !fcmToken) return;
  try {
    const token = await getAccessToken();
    const resp = await fetch(FCM_ENDPOINT, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          data: { type: "score_update" },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.warn(`FCM send failed (${resp.status}): ${text}`);
    }
  } catch (e) {
    console.warn("FCM send failed:", e);
  }
}
