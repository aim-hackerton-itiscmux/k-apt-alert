# 기능 개발 계획 — 청약 코파일럿 (모집공고 해석자 #1 + Phase 2 확장)

> 작성일: 2026-04-26 (Phase 2 추가: 2026-04-26)
> 브랜치: `feat/notice-interpreter`
> 상태: Phase 1 완료 (notice/raw API + 162 tests) → Phase 2 진행 중 (Auth/Profile/Recommendations/Notifications/Reports)
> **브랜드: 청약 코파일럿** (CLI 스킬·앱 통합 명칭)
> **프론트엔드: 별도 팀·별도 레포** — 본 plan은 API 표면 정의에만 집중

## 0. 한 줄 요약
청약 정보 통합·분석을 위한 백엔드 API. **Phase 1**은 모집공고문 raw 텍스트 추출 + LLM 해석 (`/v1/apt/notice/{id}/raw`). **Phase 2**는 모바일 앱 ("청약 코파일럿")의 4-탭 IA(홈/공고/AI 리포트/내 정보)를 지원하는 사용자 인증 + 프로필 + 추천 + 알림 + 리포트 저장 API 표면 (§9 참조).

**원칙**: 프록시는 데이터만, 해석은 클라이언트(LLM) 측. UI 렌더링은 별도 프론트.

---

## 1. 이 기능이 해결하는 것

청약 모집공고문은 평균 30~150페이지 PDF/HWP로, 사용자가 다음 같은 질문에 직접 답을 찾기 어렵다:

- "내 가구 구성에서 신청 가능한 평형이 뭐야?"
- "특별공급 자격 충족돼? 어떤 서류가 필요해?"
- "재당첨 제한 걸리나? 분양가는 시세 대비?"
- "유의사항 중 나한테 해당되는 거 있어?"

**룰 기반으로는 영원히 못 한다** — 공고마다 표 구조·표현이 다르고, 자격 조건이 자유 서술로 들어감. LLM만이 프로필 컨텍스트와 결합해서 한 줄로 답할 수 있다.

### 왜 이 기능을 #1로 잡았나
- 다른 청약 도구가 못 하는 영역 (차별화)
- 룰 기반으로는 영원히 못 함
- 사용자 시간 절감이 즉시 체감됨
- Phase 1 사전 알리미와 자연스럽게 결합 — "곧 공고 떠 → 발표 즉시 AI가 요약 자동 발송"

---

## 2. 아키텍처

```
┌──────────────┐        ┌──────────────────────┐        ┌───────────────────┐
│  사용자       │  →    │  SKILL (LLM)          │   →   │  프록시            │
│  "이 공고     │        │  - id/url 추출        │        │  /v1/apt/notice/  │
│   분석해줘"   │        │  - notice/raw 호출    │        │  {id}/raw         │
└──────────────┘        │  - 프로필+raw로 요약  │        │  - HTML/PDF 추출  │
                        └──────────────────────┘        │  - 클린업·캐싱    │
                                                        └───────────────────┘
```

핵심 분리: **프록시는 텍스트만 추출** (룰), **요약·해석은 LLM** (프로필 맥락 반영). 프록시에 OpenAI 키 등을 넣지 않으므로 비용·인증 부담 없음.

---

## 3. 프록시 변경 (Phase 1 — MVP)

### 3.1 신규 엔드포인트
`GET /v1/apt/notice/{id}/raw` (또는 `?url=...` 폴백)

| 파라미터 | 위치 | 설명 |
|---------|------|------|
| `id` | path | 공고 ID (`apt_2024000123`, `lh_...` 등). 캐시에서 매칭 실패 시 `?url=` 필수 |
| `url` | query | id로 조회 실패 시 폴백. SKILL이 직전 announcements 응답의 `url` 직접 전달 |
| `source` | query | `auto` (기본) / `html` / `pdf` — 첨부 PDF는 Phase 2 |
| `max_chars` | query | 응답 텍스트 상한. 무료 30000(기본), 유료 50000~80000 (티어 검증 후 적용) |
| `tier` | query | `free` (기본) / `paid`. 인증 토큰과 교차 검증 (§3.8) |

### 3.2 응답 스키마
```json
{
  "id": "apt_2024000123",
  "url": "https://www.applyhome.co.kr/...",
  "source": "html",
  "title": "OO지구 OO블록 입주자 모집공고",
  "extracted_at": "2026-04-26T11:00:00",
  "char_count": 18234,
  "truncated": false,
  "sections": {
    "자격": "...",
    "공급일정": "...",
    "공급금액": "...",
    "유의사항": "..."
  },
  "text": "전체 클린업된 텍스트..."
}
```

### 3.3 ID → URL 해석 전략 ✅ **확정: A + C 폴백**

```python
def resolve_url(id: str, url: str | None) -> str:
    # 1차: 인메모리 _cache 전체 카테고리 순회 → id 매칭
    for cache_entry in _cache.values():
        for ann in cache_entry["items"]:
            if ann["id"] == id:
                return ann["url"]
    # 2차: 사용자 url 폴백
    if url and ("applyhome.co.kr" in url or "lh.or.kr" in url):
        return url
    # 3차: 실패
    raise HTTPException(404, "id not in cache; provide ?url=")
```

- DB 의존 회피 (마이그레이션 0건)
- SKILL은 우선 id로 호출 → 404면 직전 응답의 `url`로 재호출 (재시도 1회만)
- 호스트 화이트리스트(`applyhome.co.kr`, `lh.or.kr`)로 SSRF 방지

### 3.4 추출 로직 (`crawlers/notice_raw.py` 신규)

기존 `applyhome_page.py`의 `_parse_html` 패턴을 확장:

```python
def extract_notice_raw(url: str, max_chars: int = 30000) -> dict:
    # 1. requests.get + BeautifulSoup (기존과 동일, 24h 캐시)
    # 2. script/style/nav/footer 제거
    # 3. 본문 컨테이너만 (.cont, #pblancCont 등 — 청약홈 SSR 셀렉터)
    # 4. 텍스트 추출 + 공백 정규화
    # 5. 섹션 헤딩 감지 (정규식: "1. 자격", "■ 공급금액" 등)으로 dict 분할
    # 6. max_chars 초과 시 비례 truncate + truncated=True
    return {...}
```

### 3.5 카테고리별 어댑터 ✅ **확정: 청약홈 + LH 둘 다 Phase 1**

| 카테고리 | URL 호스트 | Phase 1? | 비고 |
|---------|-----------|---------|------|
| apt, officetell, remndr, opt, pbl_pvt_rent | applyhome.co.kr | ✅ | 기존 `applyhome_page.py` 재사용 가능 |
| lh | apply.lh.or.kr | ✅ | 신규 어댑터 — 게시글 상세 페이지 셀렉터 별도 조사 필요 |
| sh | i-sh.co.kr | ❌ Phase 2 | 게시판 구조 상이 |
| gh | gh.or.kr | ❌ Phase 2 | 게시판 구조 상이 |

**구현 패턴** — 호스트별 dispatcher:

```python
EXTRACTORS = {
    "applyhome.co.kr": _extract_applyhome,  # 본문 셀렉터 .cont, #pblancCont
    "apply.lh.or.kr":  _extract_lh,         # 본문 셀렉터 별도 조사
}

def extract_notice_raw(url, max_chars):
    host = urlparse(url).netloc
    extractor = next((fn for h, fn in EXTRACTORS.items() if h in host), None)
    if not extractor:
        raise HTTPException(400, f"unsupported host: {host}")
    return extractor(url, max_chars)
```

Phase 1 청약홈 + LH로 공고 95%+ 커버. SH/GH는 실사용 빈도 보고 Phase 2 결정.

### 3.6 캐싱·보호

- `notice_raw` 캐시: id 키, **TTL 7일** (모집공고문은 사실상 변경 없음 — 단 발표 직후 정정공고 가능성 → 7일이 안전)
- **티어별 캐시 분리**: 같은 id라도 `max_chars` 다르면 다른 캐시 키 (`{id}:{max_chars}`)
  - 또는 항상 80K로 fetch·캐시 후 응답 시 truncate (호스트 부하 ↓ 권장)
- 일일 호출 카운터:
  - **무료 사용자**: `notice_raw_calls_free` 1000건/일 (전역)
  - **유료 사용자**: `notice_raw_calls_paid` 별도 — 더 큰 한도 또는 무제한
- 응답 무게: 30KB ≈ 8K 토큰 / 50KB ≈ 13K / 80KB ≈ 20K 토큰

### 3.7 max_chars 티어 검증 ✅ **확정: 무료 30K / 유료 50~80K 선택**

```python
TIER_LIMITS = {"free": 30000, "paid": 80000}

def resolve_max_chars(tier: str, requested: int | None, auth_ok: bool) -> int:
    effective_tier = tier if auth_ok else "free"
    cap = TIER_LIMITS[effective_tier]
    if requested is None:
        return 30000  # 모든 티어 기본값
    return min(requested, cap)
```

- 무료 사용자가 `max_chars=80000` 요청 → 30000으로 자동 클램프 (에러 X, 응답에 `tier_capped: true` 표시)
- 유료 사용자만 50K~80K 효과 발휘
- 응답 메타에 항상 `effective_max_chars`, `tier`, `tier_capped` 포함

### 3.8 인증 방식 ✅ **확정: B — Supabase Auth + JWT**

상세 설계는 §8 (회원·결제·커뮤니티 로드맵)에서 다룬다. Phase 1에서는 **인증 인터페이스만 정의**하고 토큰 없으면 `tier=free`로 강제 처리. Phase 2에서 실제 Auth/결제 연결.

```python
# Phase 1 — 인터페이스만, 검증은 Phase 2부터
def resolve_tier(authorization: str | None) -> str:
    if not authorization:
        return "free"
    # Phase 2: Supabase JWT 검증 후 user.subscriptions.tier 조회
    return "free"  # 임시 — 모든 호출 free 처리
```

### 3.9 변경 파일
- `proxy/crawlers/notice_raw.py` 신규 — 호스트별 dispatcher + 청약홈/LH 추출기
- `proxy/main.py` — 라우트 추가 (60~80줄)
- `proxy/config.py` — `NOTICE_RAW_TTL`, `NOTICE_RAW_DAILY_LIMITS`, `TIER_LIMITS`
- `supabase/functions/announcements/` 와 동급으로 `supabase/functions/notice/` Edge Function 추가

---

## 4. SKILL.md 변경

### 4.1 트리거

| 사용자 말 | 동작 |
|---------|------|
| "이 공고 분석/해석해줘" + 공고명/번호/URL | 단일 공고 raw 호출 + LLM 요약 |
| "Top 1 자세히" / "방금 추천한 첫 번째 깊게" | 직전 추천 공고를 raw 호출 |
| `/korea-apt-alert analyze <id-or-url>` | 명시적 명령 |

### 4.2 워크플로우 (SKILL 새 섹션)

```
1. 공고 식별
   - URL이면 그대로 ?url= 사용
   - 공고명·지역이면 직전 announcements 응답에서 id 매칭
   - 모호하면 후보 2~3개 제시 후 사용자 선택

2. raw 호출
   curl -s --max-time 60 "https://.../v1/apt/notice/{id}/raw?max_chars=30000"

3. 프로필 로드 (~/.config/k-skill/apt-alert-profile.json)

4. LLM 요약 — 아래 출력 템플릿 사용
```

### 4.3 출력 템플릿 (간결 모드)

```
📑 [공고명] — 분석 요약 (프로필: 만 31세 / 무주택 / 통장 5년 / 신혼부부)

✅ 너에게 해당
• 신청 가능 평형: 59A, 84B (소득 기준 충족)
• 자격: 신혼부부 특별공급 ✅ / 일반공급 1순위 ✅
• 분양가: 5.8~7.2억 (인근 시세 대비 -12%)

⚠️ 주의
• 재당첨 제한 7년 (당첨 시 다른 공고 신청 차단)
• 발코니 확장 의무 (+1,200~1,800만)
• 중도금 대출 한도 60% — 자기자본 ~2.5억 필요

📅 핵심 일정
• 특공 접수 D-5 (2026-05-01) → 1순위 D-6 → 발표 D-13

🔗 [원문 →](url) · 더 깊게 보려면 "유의사항 전부" / "비교: 다른 공고"
```

### 4.4 상세 모드
사용자가 "전부", "원문" 요청하면 raw text를 섹션별로 그대로 페이지네이션해서 출력.

### 4.5 보안·프라이버시
- 프로필은 LLM 컨텍스트에만 — 프록시로 절대 전송 X (기존 원칙 유지)
- raw 응답에 개인정보 없음 (공개 공고문)

---

## 5. Phase 2 ~ Phase 3 (추후)

| Phase | 추가 내용 | 트리거 |
|-------|----------|-------|
| **2** | PDF 첨부 추출 (`pdfminer.six`), LH/SH/GH 어댑터 | Phase 1 실사용 후 PDF 본문이 필요한 케이스 빈도 측정 |
| **3** | "사전 알리미"와 결합 — 공고 떠 있을 거라 예고된 공고가 발표되면 자동으로 raw + 요약 → Slack 발송 | Phase 1 안정화 후 |
| **3+** | "공고 비교" 모드 — 2개 raw 받아 차이점 요약 (분양가·자격·일정) | 사용자 요청 시 |

---

## 6. 결정 사항

| # | 항목 | 결정 |
|---|------|------|
| 1 | ID → URL 해석 | ✅ A(캐시) + C(url 폴백) |
| 2 | Phase 1 범위 | ✅ 청약홈 + LH 둘 다 |
| 3 | max_chars | ✅ 무료 30K / 유료 50~80K 선택 |
| 4 | 인증 방식 | ✅ B — Supabase Auth + JWT (Phase 2부터 활성) |
| 5 | 커뮤니티/결제 로드맵 | ✅ §8 참조 (Phase 2~5 단계적) |
| 6 | 프록시 구현 위치 | ✅ C — FastAPI + Edge Function 둘 다 미러 |
| 7 | 정정공고 대응 | ✅ `?force_refresh=true` 쿼리 파라미터 지원 |
| 8 | 테스트 픽스처 전략 | ✅ C — fixtures 기반 unit + `pytest.mark.live` 옵셔널 |

---

## 7. 작업량 예측

| 항목 | 시간 |
|------|------|
| `notice_raw.py` 추출기 (청약홈) + 캐시 | 2~3h |
| LH 추출기 (apply.lh.or.kr 셀렉터 조사 포함) | 2~3h |
| `main.py` 라우트 + 티어 클램프 + Edge Function | 1.5h |
| 셀렉터/정규식 튜닝 (청약홈 5개 + LH 3개 회귀 테스트) | 2~3h |
| SKILL.md 워크플로우 + 출력 템플릿 추가 | 1.5h |
| 페르소나 테스트 1~2건 추가 | 1h |
| **합계 (Phase 1)** | **10~13h** |

---

## 8. 회원·결제·커뮤니티 로드맵 (Phase 2~5)

> Phase 1(notice-raw)을 단독 기능이 아니라 **유료 SaaS·커뮤니티의 진입 기능**으로 위치시킨다. 인증·결제·커뮤니티 인프라를 단계적으로 쌓아 올린다.

### 8.1 단계별 로드맵

| Phase | 범위 | 핵심 가치 | 작업량 |
|-------|------|----------|--------|
| **1** (현재) | notice-raw 추출 + LLM 요약 (무료 30K 고정) | 차별화된 핵심 기능 검증 | 10~13h |
| **2** | Supabase Auth(이메일·OAuth) + JWT, mypage 최소판, CLI `login` 명령 | 회원 식별·세션 | 15~20h |
| **3** | 결제 PG 연동(Toss Payments 추천), 정기결제 webhook, mypage 결제 폼/내역 | 매출 발생, 유료 50~80K 활성 | 25~35h |
| **4** | 커뮤니티 게시판(질문·공고 리뷰·당첨 후기), 신고·모더레이션 | 사용자 락인, 가치 누적 | 30~40h |
| **5** | 공고별 평점·리뷰 누적, AI가 커뮤니티 데이터까지 반영한 추천, 알림 공유 | 데이터 네트워크 효과 | 40h+ |

### 8.2 데이터 모델 (Phase 2~)

```sql
-- Phase 2
auth.users                       -- Supabase 기본 (email, encrypted_password, oauth providers)

public.profiles                  -- 1:1 with auth.users
  id uuid PK FK auth.users.id
  nickname text
  apt_profile_json jsonb         -- 청약 프로필 서버 저장 (옵션 — 동기화용)
  created_at, updated_at

-- Phase 3
public.subscriptions
  id uuid PK
  user_id uuid FK auth.users.id
  tier text                      -- 'free' | 'paid'
  status text                    -- 'active' | 'expired' | 'cancelled' | 'pending'
  started_at, expires_at, cancelled_at
  payment_provider text          -- 'toss' | 'kakao' | 'stripe'
  external_subscription_id text  -- PG 측 ID

public.payments
  id uuid PK
  user_id uuid FK
  subscription_id uuid FK
  provider text, provider_payment_id text UNIQUE
  amount integer, currency text
  status text                    -- 'paid' | 'failed' | 'refunded'
  paid_at timestamptz, raw_payload jsonb

public.payment_webhooks          -- idempotency log
  id uuid PK
  provider text, event_id text UNIQUE
  received_at, processed_at
  payload jsonb

-- Phase 4
public.community_posts
  id uuid PK
  user_id uuid FK
  kind text                      -- 'question' | 'review' | 'tip' | 'result'
  related_announcement_id text   -- 공고 id (선택, 리뷰일 때)
  title, body text
  created_at, updated_at
  upvote_count int, comment_count int

public.community_comments
  id uuid PK
  post_id uuid FK
  user_id uuid FK
  body text, created_at

public.community_reactions       -- 추천·신고
  id, post_id|comment_id, user_id, kind, created_at
```

### 8.3 RLS 정책

- `profiles`: SELECT/UPDATE 본인만, INSERT 본인만
- `subscriptions`/`payments`: SELECT 본인만, INSERT/UPDATE는 service_role(webhook)만
- `community_posts`/`comments`: SELECT 모두, INSERT 인증된 사용자, UPDATE/DELETE 본인만
- 신고된 콘텐츠: 모더레이터 role 추가

### 8.4 인증 흐름

**웹 로그인** (mypage)
1. `/login` 페이지 → Supabase Auth UI
2. 이메일 매직링크 또는 OAuth (Google/Kakao)
3. 로그인 성공 → JWT 발급 + httpOnly 쿠키
4. 첫 로그인 시 `profiles` row 자동 생성 (DB trigger)

**CLI 로그인** (스킬)
- `/korea-apt-alert login` 실행
- 디바이스 코드 플로우:
  1. CLI가 프록시에 `POST /v1/auth/device` → 짧은 코드 + 검증 URL 반환
  2. 사용자 브라우저에서 URL 열고 코드 입력
  3. Supabase 인증 후 코드 ↔ JWT 매핑
  4. CLI가 폴링하여 JWT 받아 `~/.config/k-skill/secrets.env`의 `KSKILL_API_TOKEN`에 저장 (chmod 600)
- 또는 매직링크 + 토큰 paste 방식 (더 단순)

**API 호출**
- 모든 `/v1/...` 호출에 `Authorization: Bearer <jwt>` 첨부
- Edge Function이 Supabase JWT 검증 (built-in)
- `tier`는 `subscriptions` 테이블 조회 또는 JWT custom claim

### 8.5 결제 흐름 (Phase 3 — Toss Payments 추천)

**왜 Toss?**
- 한국 카드/계좌이체/간편결제 통합
- 정기결제(빌링키) 지원
- 한국어 문서·고객지원
- 수수료 합리적 (카드 ~2.5%)

**플로우**
```
mypage/billing
  ↓ "유료 가입" 클릭
Toss Payments 결제창 (clientKey + orderId)
  ↓ 사용자 결제 완료
브라우저 → /payment/success?paymentKey&orderId&amount
  ↓ 클라이언트가 confirm 호출
프록시 POST /v1/payments/confirm (서명·Idempotency-Key 포함)
  ↓ Toss 서버에 confirmPayment 요청 (서명된 secretKey)
Toss → 결제 확정 응답
  ↓ DB update: payments.status='paid', subscriptions.status='active', expires_at = now + 30일
사용자 ← "결제 완료" UI

별도: Toss webhook → /v1/payments/webhook
  - 환불·실패·정기결제 갱신 등 비동기 이벤트 처리
  - event_id로 idempotency 보장
```

**대안**
- KakaoPay / NaverPay: Toss와 비슷한 위상, 한쪽만 우선 + 나중에 추가
- Stripe: 해외 카드 필요 시. 한국 사용자만이라면 후순위

### 8.6 mypage 웹 프론트

| 페이지 | 내용 | 권한 |
|--------|------|------|
| `/` | 랜딩 — 기능·가격·CLI 설치 가이드 | 비로그인 |
| `/login` | Supabase Auth UI (매직링크/OAuth) | 비로그인 |
| `/mypage` | 닉네임·이메일·구독 상태·CLI 토큰 발급/회수 | 본인 |
| `/mypage/profile` | 청약 프로필 편집 (서버 저장 옵션) | 본인 |
| `/mypage/billing` | 현재 플랜·결제 폼·해지·결제 내역 | 본인 |
| `/community` | 게시판 목록 (Phase 4) | 모두 읽기, 작성은 로그인 |
| `/community/post/:id` | 게시글 상세·댓글 (Phase 4) | 동일 |

**기술 스택 옵션** (Phase 2 진입 시 선택):
- **Next.js (App Router)** — 가장 대중적, Vercel 무료 호스팅, Supabase JS SDK 잘 맞음
- **Astro + React/Svelte 아일랜드** — 정적 페이지 빠름, Phase 4 게시판은 동적 처리 필요
- **SvelteKit** — 가볍고 빠름, 생태계 작음

추천: **Next.js + Vercel** (Supabase 공식 가이드도 Next 우선).

도메인:
- `app.k-apt-alert.com` (또는 별도 결정) — Cloudflare/Vercel 도메인 연결

### 8.7 가격 모델 (Phase 3 진입 전 결정 필요)

| 플랜 | 월 | 연 (할인) | 포함 |
|------|----|---------:|------|
| **Free** | ₩0 | ₩0 | 공고 조회, 가점 계산, 알림 1채널, notice-raw 30K |
| **Pro** | ₩4,900~9,900 | ₩49,000~99,000 | + notice-raw 50~80K, 일일 호출 한도 ↑, 알림 다채널, 즐겨찾기 무제한 |
| **(미래) Plus** | TBD | TBD | + 커뮤니티 광고 제거, 우선순위 응답, 베타 기능 |

→ **결정 필요 (Phase 3 진입 전)**: 정확한 금액, 월·연 비율, 기능 차등 항목

### 8.8 보안·프라이버시

- 청약 프로필은 **로컬 우선·서버는 옵션** (사용자가 mypage에서 동기화 ON 선택 시만)
- JWT는 `~/.config/k-skill/secrets.env`에 저장, chmod 600 자동
- 결제 webhook 서명 검증 필수 (Toss `Toss-Signature` 헤더)
- PII 암호화: 이메일은 Supabase Auth가 처리, 추가 PII는 저장하지 않음
- 회원 탈퇴: 30일 grace → hard delete (GDPR/한국 개인정보보호법 대응)
- 커뮤니티 게시글: 신고 3회 이상 자동 숨김, 모더레이터 검토

### 8.9 변경 파일/디렉토리 (Phase 2~)

```
supabase/
  migrations/
    004_auth_profiles.sql         # Phase 2: profiles
    005_subscriptions_payments.sql # Phase 3
    006_rls_policies.sql           # 모든 테이블 RLS
    007_community.sql              # Phase 4
  functions/
    auth-device/                   # Phase 2: 디바이스 코드 발급
    auth-callback/                 # Phase 2: OAuth 콜백
    payments-confirm/              # Phase 3
    payments-webhook/              # Phase 3
    user-tier/                     # GET 현재 tier (CLI 디버그용)

web/                                # Phase 2 신규 (Next.js)
  app/
    page.tsx                       # 랜딩
    login/page.tsx
    mypage/page.tsx
    mypage/profile/page.tsx
    mypage/billing/page.tsx
    community/page.tsx             # Phase 4
    community/post/[id]/page.tsx   # Phase 4
    api/                           # Vercel API routes (필요 시 보조)
  lib/
    supabase.ts
    toss.ts                        # Phase 3
  package.json

SKILL.md                            # /korea-apt-alert login·logout·tier 명령 추가
proxy/main.py                       # Authorization 검증, tier resolution
proxy/config.py                     # SUPABASE_JWT_SECRET, TOSS_SECRET_KEY 등
```

### 8.10 Phase 2 진입 전 결정 필요

| # | 항목 | 옵션 |
|---|------|------|
| P2-1 | OAuth 제공자 | 이메일 매직링크만 / +Google / +Kakao(한국 사용자 우대) |
| P2-2 | CLI 로그인 UX | 디바이스 코드 / 매직링크+토큰 paste |
| P2-3 | 청약 프로필 서버 저장 | 항상 옵션 / 유료만 활성 / 강제 |
| P2-4 | mypage 도메인 | 별도 도메인 / 서브도메인 / 일단 vercel.app |
| P2-5 | 프론트엔드 스택 | Next.js / Astro / SvelteKit |

### 8.11 Phase 3 진입 전 결정 필요

| # | 항목 | 옵션 |
|---|------|------|
| P3-1 | 결제 PG | Toss / Kakao / Naver / Stripe / 복수 |
| P3-2 | 가격 모델 | 월 ₩ / 연 ₩ / 평생 결제 |
| P3-3 | 무료↔유료 차등 | max_chars만 / +호출 한도 / +채널 수 / +커뮤니티 권한 |
| P3-4 | 환불 정책 | 7일 / 14일 / 무환불 |
| P3-5 | 사업자 등록 | 개인사업자 / 법인 / 통신판매업 신고 필수 |

### 8.12 법무·컴플라이언스 체크리스트 (Phase 3 시작 전)

- 통신판매업 신고 (전자상거래법)
- 개인정보처리방침 작성
- 이용약관 작성
- 사업자등록 (월 매출 기준)
- 부가세 신고 절차
- PG사 가맹 심사 (Toss 등)
- 환불·청약철회 절차 명문화

→ **법무 자문 1회 권장** (소규모 SaaS 표준 패키지로 처리 가능)



---

## 9. Phase 2 — API 표면 (mypage UI 역산)

> 모바일 앱 "청약 코파일럿"의 마이페이지 화면(2026-04-26 디자인 확정)이 요구하는 데이터를 역산해서 도출한 API 표면. **프론트는 별도 팀이 제작**하므로 본 백엔드 작업은 API 계약 정의 + 구현만.

### 9.0 디자인이 요구하는 데이터

마이페이지 한 화면에서 필요한 정보:
- **헤더**: 닉네임, 청약가점 (예상)
- **기본 정보 카드**: 연령, 세대구성, 주택소유 + 무주택 기간, 소득구간, 선호지역+평형
- **청약통장 카드**: 가입기간, 납입회차, 예치금
- **특별공급 자격 (관심) 카드**: 신혼부부·생애최초·다자녀·노부모부양 멀티선택
- **상단 🔔**: 인앱 알림 (읽지 않은 개수 뱃지)
- **하단 4-탭**: 홈 / 공고 / AI 리포트 / 내 정보

### 9.1 단계별 (B → C → D → E)

| 단계 | 항목 | 의존성 | 예상 작업량 | 본 PR 포함? |
|------|------|-------|-----------|-----------|
| **B** | Supabase Auth + JWT 검증 인프라 (`_shared/auth.ts`) | Supabase 프로젝트 | 4~6h | ✅ |
| **C** | 프로필 CRUD (`GET/PATCH /v1/profile`) | B | 4~6h | ❌ **별도 PR** — main의 운영 DB가 `user_profiles` JSONB 패턴(my-score Edge Function이 사용 중) 채택. 우리의 정규화 `profiles` 테이블과 도메인 충돌. user_profiles 통합 후 별도 PR (§9.11 참조) |
| **D** | 추천 (`GET /v1/recommendations`) | C | 3~4h | ❌ **별도 PR** — C 의존이므로 같이 보류 |
| **E1** | 알림 (`GET /v1/notifications`, `PATCH /v1/notifications/{id}/read`) | B | 4~6h | ✅ |
| **E2** | AI 리포트 저장·이력 (`POST/GET /v1/reports`, `GET /v1/reports/{id}`) | B + notice/raw | 5~7h | ✅ |
| **(생략)** | ~~A. 청약가점 계산기~~ | — | — | ❌ main에 이미 `my-score` Edge Function 있음 (사용자 결정 2026-04-26) |

### 9.2 Auth 설계

**채택**: Supabase Auth — 매직링크 + Google OAuth (한국 사용자 우대 시 +Kakao OAuth)

**검증 흐름** (Edge Function 기준):
```typescript
// _shared/auth.ts
export async function requireUser(req: Request): Promise<User>
// → Authorization: Bearer <jwt> 추출
// → supabase.auth.getUser(jwt) 검증
// → 실패 시 401 throw
```

- **RLS 정책으로 권한 처리** — 코드는 user_id만 신뢰, 행 격리는 DB가
- **service_role key**는 서버측 cron에서만 사용 (사용자 호출 X)
- **FastAPI 프록시는 Auth 미연동** — Phase 1 무료 기능만 호스팅, 모든 인증 API는 Edge Function 단독

**프로필 자동 생성**: `auth.users` insert 트리거로 `public.profiles` 빈 row 자동 생성

### 9.3 프로필 스키마 (mypage 화면 역산)

```sql
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '',
  -- 기본 정보 카드
  age INT,                              -- 34
  household_type TEXT,                  -- '무주택세대구성원' | '세대주' | '세대원'
  homeownership TEXT,                   -- '무주택' | '1주택' | '다주택'
  homeless_years INT,                   -- 무주택 기간 (년)
  income_bracket TEXT,                  -- '도시근로자 100% 이하' | '120%' | '140%' | '160%'
  preferred_regions TEXT[],             -- ['서울', '경기 남부']
  preferred_size_sqm INT,               -- 84 (㎡)
  -- 청약통장
  account_join_date DATE,               -- 가입일 (가입기간은 NOW - join_date)
  account_payment_count INT,            -- 납입회차 (66회)
  account_balance INT,                  -- 예치금 (원 단위)
  -- 특별공급 관심
  special_supply_interests TEXT[],      -- ['신혼부부', '생애최초', '다자녀', '노부모부양']
  -- 메타
  estimated_score INT,                  -- 가점 캐시 (계산 미구현 시 NULL)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self_read" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "self_update" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "self_insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### 9.4 추천 API

`GET /v1/recommendations?limit=3`

**동작**:
1. 인증된 user_id로 profile 조회
2. announcements 테이블에서 active만 (rcept_end >= today)
3. 프로필과 매칭 점수 계산:
   - 선호지역 일치 +30
   - 선호평형(±10㎡ 내) +20
   - 무주택 + 일반공급 1순위 자격 +15
   - 특별공급 관심 카테고리 매칭 +10/항목
4. 점수 내림차순 → 상위 N개 + 매칭 사유 함께 반환

**응답**:
```json
{
  "recommendations": [
    {
      "announcement": { ...standard fields },
      "match_score": 75,
      "match_reasons": ["선호지역(서울) 일치", "84㎡ 평형 일치", "신혼부부 특공 자격"]
    }
  ],
  "profile_used": true,
  "generated_at": "2026-04-26T12:30:00Z"
}
```

### 9.5 알림 스키마

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- 'announcement_new' | 'dday_alert' | 'report_complete' | 'system'
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,                            -- 앱 내 딥링크 (선택)
  related_announcement_id TEXT,         -- 연관 공고 (선택)
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self_read" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "self_update_read" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
-- INSERT는 service_role만 (cron이 생성)
```

**API**:
- `GET /v1/notifications?unread_only=true&limit=20` — 본인 알림 목록
- `PATCH /v1/notifications/{id}/read` — 읽음 처리
- (내부) cron이 D-day 임박 공고 → 사용자별 알림 생성

### 9.6 리포트 저장·이력 스키마

```sql
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notice_id TEXT NOT NULL,              -- 공고 ID
  title TEXT NOT NULL DEFAULT '',
  summary_markdown TEXT NOT NULL,       -- LLM이 생성한 분석 요약
  raw_excerpt TEXT,                     -- notice_raw에서 추출한 원문 발췌 (선택)
  matched_profile_snapshot JSONB,       -- 분석 시점의 프로필 스냅샷
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_user_created ON public.reports(user_id, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self_all" ON public.reports FOR ALL USING (auth.uid() = user_id);
```

**API**:
- `POST /v1/reports` — 클라이언트가 LLM 요약 후 저장 (body: notice_id, title, summary_markdown 등)
- `GET /v1/reports?limit=20` — 본인 리포트 목록
- `GET /v1/reports/{id}` — 단일 리포트 상세

**저장 시점**: 클라이언트(LLM 호출 측)가 분석 완료 후 명시 저장. 서버는 raw 추출만 담당하므로 자동 저장 안 함.

### 9.7 IA — 4탭과 API 매핑

| 탭 | 주 API | 보조 API |
|----|-------|---------|
| **홈** | `GET /v1/recommendations` | `GET /v1/notifications?unread_only=true` (뱃지 카운트) |
| **공고** | `GET /v1/apt/announcements` | (필터 기반) |
| **AI 리포트** | `GET /v1/reports` (이력) + `GET /v1/apt/notice/{id}/raw` (신규 분석) | `POST /v1/reports` (저장) |
| **내 정보** | `GET /v1/profile` + `PATCH /v1/profile` | `GET /v1/notifications` (전체 목록) |

### 9.8 프록시 구현 분리

| 카테고리 | FastAPI (proxy/) | Edge Function (supabase/) |
|---------|----------------|--------------------------|
| 공개·무인증 (announcements, notice/raw, categories, health) | ✅ | ✅ (미러) |
| 인증 필요 (profile, recommendations, notifications, reports) | ❌ | ✅ |

**이유**: Edge Function은 Supabase Auth/RLS와 자연스럽게 통합. FastAPI에서 JWT 검증 + RLS 우회 코드를 짜는 건 중복 작업. Phase 2 신규 API는 모두 Edge Function 단독.

### 9.9 마이그레이션 번호

- ~~`005_profiles.sql`~~ — 본 PR 제외 (§9.11 통합 이슈). user_profiles 통합 후 별도 PR
- `006_notifications.sql` — 알림 테이블 + RLS + 인덱스
- `007_reports.sql` — 리포트 테이블 + RLS

> **참고**: 005 번호는 user_profiles 통합 마이그레이션에 reserved. 본 PR 머지 시 006/007이 먼저 들어가도 005가 후속 PR로 채워질 예정.

### 9.10 Phase 2 외 결정 사항 (Phase 3+ 보존)

- ~~A. 청약가점 계산기~~ — main에 `my-score` Edge Function으로 이미 존재
- 결제·구독 (`subscriptions`, `payments`) — Phase 3 그대로
- 커뮤니티 (`community_posts`) — Phase 4 그대로

### 9.11 user_profiles 통합 이슈 (별도 PR로 후속)

운영 main DB(김상원, 2026-04-26)에 이미 `user_profiles` 테이블이 적용됨:

```sql
-- main 운영 패턴 (my-score Edge Function이 사용 중)
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,                  -- auth.uid()::text
  profile JSONB NOT NULL DEFAULT '{}',       -- UserProfile (eligibility.ts) 통째 저장
  score JSONB,                               -- ScoreBreakdown 통째 저장
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile" ON user_profiles
  USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
```

**우리 작업과의 충돌**:

| 측면 | main `user_profiles` | 우리 `005_profiles.sql` |
|------|---------------------|-------------------------|
| 테이블명 | `user_profiles` | `profiles` |
| user_id | `TEXT` | `UUID REFERENCES auth.users` |
| 필드 | `profile JSONB`, `score JSONB` | 정규화 12개 컬럼 |
| 관점 | 가점 계산용 (날짜 기반) | mypage UI 표시용 (파생값) |

main의 `UserProfile` (eligibility.ts) 13개 필드 vs mypage UI 화면이 요구하는 ~12개 필드는 **같은 도메인의 다른 관점**. 통합 방향:

1. **단일 user_profiles.profile JSONB**에 main 필드(birth_date, savings_start, ...) + UI 필드(preferred_regions, special_supply_interests, ...) 모두 보관
2. profile/index.ts는 user_profiles JSONB 부분 머지 패턴으로 재작성
3. recommendations/index.ts는 user_profiles.profile에서 selected fields 추출

**별도 PR 작업 (TODO)**:
- `migrations/005_user_profiles_extend.sql` — user_profiles에 인덱스/뷰 추가 (테이블 자체는 이미 적용)
- `supabase/functions/profile/index.ts` — user_profiles 패턴으로 재작성
- `supabase/functions/recommendations/index.ts` — user_profiles 패턴 호환

본 PR(`feat/notice-and-foundation`)에서는 `_shared/auth.ts` + notifications + reports만 보내고, profile + recommendations는 김상원님과 user_profiles 통합 합의 후 별도 PR.
