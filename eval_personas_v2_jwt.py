#!/usr/bin/env python3
"""20명 페르소나 v2 — JWT 트랙 (my-score, recommendations, notifications).

흐름:
  1. .env에서 SUPABASE_ANON_KEY 로드
  2. 페르소나 20명을 가짜 이메일(p01@kapt.test 형식)로 signup
     - 이미 존재하면 signin으로 fallback
     - email confirmation이 켜진 프로젝트면 access_token이 안 나올 수 있음
       → 이 경우 Dashboard → Authentication → Email auth → "Confirm email" 끄기 필요
  3. user_profiles UPSERT (각 페르소나의 profile JSONB 저장)
  4. JWT로 my-score (GET) + recommendations (GET) + notifications (GET) 호출
  5. 결과 요약 출력

사용법:
    python3 eval_personas_v2_jwt.py [JSON 경로]
"""
import json
import os
import sys
import time
from pathlib import Path
import urllib.request
import urllib.error
import urllib.parse

PROJECT_REF = "xnyhzyvigazofjoozuub"
SUPA_URL    = f"https://{PROJECT_REF}.supabase.co"
BASE_FN     = f"{SUPA_URL}/functions/v1"
BASE_AUTH   = f"{SUPA_URL}/auth/v1"
BASE_REST   = f"{SUPA_URL}/rest/v1"

DEFAULT_JSON = "/mnt/c/Users/alstj/Downloads/test_personas_v2.json"
EMAIL_DOMAIN = "kapt.test"  # 가짜 이메일 도메인
PASSWORD     = "Kapt!Eval-2026"  # 페르소나 공통 비밀번호 (가짜)

SLEEP = 0.3
RETRIES = 2


# ── .env 로더 (외부 의존성 없이) ─────────────────────────────────────────
def load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv(Path(__file__).parent / ".env")
ANON_KEY    = os.environ.get("SUPABASE_ANON_KEY", "")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")  # 있으면 admin signup 사용
if not ANON_KEY:
    sys.exit("SUPABASE_ANON_KEY이 .env에 없습니다 (또는 환경변수로 export)")


# ── HTTP 헬퍼 ────────────────────────────────────────────────────────────
def http(method: str, url: str, headers: dict | None = None,
         body: dict | None = None, timeout: int = 30) -> tuple[int, dict | str]:
    h = {"Content-Type": "application/json", "apikey": ANON_KEY, **(headers or {})}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    for attempt in range(RETRIES + 1):
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                txt = resp.read()
                return resp.status, (json.loads(txt) if txt else {})
        except urllib.error.HTTPError as e:
            try: payload = json.loads(e.read())
            except Exception: payload = str(e)
            if e.code in (429, 503) and attempt < RETRIES:
                time.sleep(1.0 + attempt)
                continue
            return e.code, payload
        except Exception as e:
            if attempt < RETRIES:
                time.sleep(1.0)
                continue
            return 0, str(e)
    return 0, "max retries"


# ── Auth: admin signup (service_role) → 일반 signup → signin ─────────────
def admin_create_user(email: str) -> str | None:
    """SERVICE_ROLE_KEY로 즉시 confirmed 사용자 생성. user_id 반환 (이미 있으면 None)."""
    code, resp = http(
        "POST", f"{BASE_AUTH}/admin/users",
        headers={"Authorization": f"Bearer {SERVICE_KEY}", "apikey": SERVICE_KEY},
        body={"email": email, "password": PASSWORD, "email_confirm": True},
    )
    if code in (200, 201) and isinstance(resp, dict):
        return resp.get("id")
    # 이미 존재 시 422 — 무시 (signin으로 진행)
    return None


def get_jwt_for_persona(persona_id: str) -> tuple[str, str] | None:
    """returns (access_token, user_id) or None on failure."""
    email = f"{persona_id.lower()}@{EMAIL_DOMAIN}"

    # service_role이 있으면 admin API로 사용자 보장 (이메일 발송 0)
    if SERVICE_KEY:
        admin_create_user(email)  # 결과 무시 — signin이 진실
    else:
        # signup 시도 (confirm OFF면 즉시 access_token)
        code, resp = http("POST", f"{BASE_AUTH}/signup",
                          body={"email": email, "password": PASSWORD})
        if code == 200 and isinstance(resp, dict) and resp.get("access_token"):
            return resp["access_token"], resp["user"]["id"]

    # signin (admin signup 후 또는 일반 signup 후 모두 적용)
    code, resp = http("POST", f"{BASE_AUTH}/token?grant_type=password",
                      body={"email": email, "password": PASSWORD})
    if code == 200 and isinstance(resp, dict) and resp.get("access_token"):
        return resp["access_token"], resp["user"]["id"]

    print(f"  ⚠️ {persona_id}: auth 실패 (code={code}, msg={str(resp)[:80]})")
    return None


# ── user_profiles UPSERT (PostgREST + JWT) ───────────────────────────────
def upsert_profile(jwt: str, user_id: str, profile: dict) -> tuple[int, str]:
    code, resp = http(
        "POST", f"{BASE_REST}/user_profiles",
        headers={
            "Authorization": f"Bearer {jwt}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body={"user_id": user_id, "profile": profile, "score": None},
    )
    return code, str(resp)[:80]


# ── 함수 호출 ────────────────────────────────────────────────────────────
def call_my_score(jwt: str) -> dict:
    code, resp = http("GET", f"{BASE_FN}/my-score",
                      headers={"Authorization": f"Bearer {jwt}"})
    return {"status": code, "resp": resp}


def call_recommendations(jwt: str) -> dict:
    code, resp = http("GET", f"{BASE_FN}/recommendations?limit=5",
                      headers={"Authorization": f"Bearer {jwt}"})
    return {"status": code, "resp": resp}


def call_notifications(jwt: str) -> dict:
    code, resp = http("GET", f"{BASE_FN}/notifications?unread_only=false&limit=10",
                      headers={"Authorization": f"Bearer {jwt}"})
    return {"status": code, "resp": resp}


# ── 요약 ────────────────────────────────────────────────────────────────
def sum_my_score(r: dict) -> str:
    if r["status"] != 200:
        return f"❌ HTTP {r['status']}: {str(r['resp'])[:60]}"
    s = r["resp"].get("score", {}) or {}
    total = s.get("total", "?")
    return f"가점={total} updated_at={r['resp'].get('updated_at','?')[:10]}"


def sum_recommendations(r: dict) -> str:
    if r["status"] != 200:
        return f"❌ HTTP {r['status']}: {str(r['resp'])[:60]}"
    items = r["resp"].get("recommendations", []) or r["resp"].get("items", [])
    return f"items={len(items)}"


def sum_notifications(r: dict) -> str:
    if r["status"] != 200:
        return f"❌ HTTP {r['status']}: {str(r['resp'])[:60]}"
    items = r["resp"].get("notifications", []) or r["resp"].get("items", [])
    return f"items={len(items)}"


def main():
    json_path = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON)
    if not json_path.exists():
        sys.exit(f"파일 없음: {json_path}")

    data = json.loads(json_path.read_text(encoding="utf-8"))
    personas = data["personas"]
    print(f"=== JWT 트랙: 페르소나 {len(personas)}명 ===")
    print(f"이메일 패턴: pNN@{EMAIL_DOMAIN}, 비밀번호: {PASSWORD}\n")

    auth_ok = score_ok = rec_ok = notif_ok = 0

    for p in personas:
        print(f"[{p['id']}] {p['name']:6}", end=" ")
        auth = get_jwt_for_persona(p["id"])
        if not auth:
            print()
            continue
        jwt, user_id = auth
        auth_ok += 1
        print(f"auth=✅", end=" ")

        # profile UPSERT
        up_code, up_msg = upsert_profile(jwt, user_id, p["profile"])
        time.sleep(SLEEP)
        if up_code not in (200, 201, 204):
            print(f"upsert=❌({up_code} {up_msg[:30]})")
            continue
        print("upsert=✅", end=" ")

        # 3개 함수 호출
        ms = call_my_score(jwt);             time.sleep(SLEEP)
        rc = call_recommendations(jwt);      time.sleep(SLEEP)
        nf = call_notifications(jwt);        time.sleep(SLEEP)

        if ms["status"] == 200: score_ok += 1
        if rc["status"] == 200: rec_ok   += 1
        if nf["status"] == 200: notif_ok += 1

        print()
        print(f"   my-score:        {sum_my_score(ms)}")
        print(f"   recommendations: {sum_recommendations(rc)}")
        print(f"   notifications:   {sum_notifications(nf)}")

    n = len(personas)
    print(f"\n=== 결과: auth {auth_ok}/{n} | my-score {score_ok}/{n} | "
          f"recommendations {rec_ok}/{n} | notifications {notif_ok}/{n} ===")


if __name__ == "__main__":
    main()
