# 청약 코파일럿 (korea-apt-alert)

> 한국 청약 공고를 개인 프로필 기반으로 조회·분석·해석하는 백엔드 + Agent Skill + 모바일 앱(별도 레포). **Claude Code · OpenAI Codex 둘 다 지원.**

- **무엇인가**: 8개 청약 채널(APT 일반분양·오피스텔/도시형·LH·APT 잔여세대·공공지원민간임대·임의공급·SH·GH) 통합 조회 + AI 모집공고 해석 + 가점 트래커 + 부적격 사전검증 + 시뮬레이션 + 공고 비교 + 유사공고 경쟁률 예측 + 인앱 알림 + 마이페이지·리포트 저장.
- **3가지 사용 방식**:
  - **CLI Skill** (`korea-apt-alert`) — Claude Code · Codex 대화창에서 "내 조건에 맞는 청약 알려줘"
  - **모바일 앱** (별도 레포) — 4-탭 IA(홈/공고/AI 리포트/내 정보) — Supabase Auth 로그인
  - **REST API 직접 호출** — 30+ Edge Functions (공개 API 5종 + 인증 API 다수)
- **누가 쓰나**: 청약 준비 중인 개인 / 청약 정보 자동화하고 싶은 개발자 / 부동산 SaaS 운영자
- **얼마나 걸리나**: CLI 설치 2분, 프로필 설정 3분, 첫 조회 5초(캐시 히트)

## 지원 런타임 — Claude Code 또는 Codex CLI

이 스킬은 YAML frontmatter + Markdown 기반 Agent Skill 표준을 따르므로 **두 런타임에서 동일하게 동작**합니다.

- **Anthropic Claude Code**: [claude.com/claude-code](https://claude.com/claude-code) · [docs](https://docs.claude.com/en/docs/claude-code/overview)
- **OpenAI Codex CLI**: [developers.openai.com/codex](https://developers.openai.com/codex) · [Skills 문서](https://developers.openai.com/codex/skills)

둘 다 macOS / Linux / Windows (PowerShell 또는 WSL) 지원. 설치 위치만 다르고 SKILL.md는 동일합니다.

## Prerequisites

| 항목 | 필요 여부 | 비고 |
|------|-----------|------|
| Claude Code **또는** Codex CLI | **둘 중 하나 필수** | 본 스킬이 동작하는 런타임 |
| 운영체제 | macOS / Linux / Windows 10+ | Windows는 PowerShell 또는 WSL |
| Python·Node 등 런타임 | ❌ 불필요 | 스킬 동작에는 필요 없음 (프록시 자체 호스팅 시에만 Python 3.11+) |
| 공공데이터포털 API 키 | ❌ 불필요 | 공용 프록시가 관리 |
| Slack/Telegram 계정 | 선택 | 알림 발송 시에만 필요 |

---

공공데이터포털 청약홈 분양정보 API 6종을 프록시 서버 경유로 통합 조회합니다. 사용자는 **API 키 없이** 최신 공고를 받아볼 수 있고, 개인 프로필을 등록하면 가점 추정·특별공급 자격·추천 유형까지 맞춤 분석됩니다.

## 어떤 걸 할 수 있나

### 무인증 (CLI · 비회원)
| 기능 | 설명 |
|------|------|
| 최신 공고 조회 | APT·오피스텔·LH·잔여·공공임대·임의공급·**SH(서울)**·**GH(경기)** 8종 통합 |
| 지역·구/군 필터 | 17개 광역 + 세부 구/군 |
| 프로필 기반 추천 (로컬) | 청약통장·무주택·소득 기준 자격 매칭 |
| 추정 가점 계산 | 무주택 기간 + 부양가족 + 통장 → 84점 |
| 특별공급 자격 판정 | 신혼부부·생애최초·다자녀·한부모·노부모 |
| D-day 알림 | 마감 임박(D-3/D-1) / 당첨자 발표 / 계약 체결 |
| **AI 모집공고 해석** | 30~150쪽 모집공고문 → 사용자 프로필 맥락 LLM 요약 |
| **공고 비교** | 2~5개 공고 한 표로 비교 (가격·입지·학군·통근) |
| **부적격 사전검증** | 신청 자격 사전 점검 + 가점 계산 + critical/warning |
| **청약 시뮬레이션** | 5단계(자격→접수→추첨→발표→계약) 단계별 통과 가능성 |
| **유사공고 + 경쟁률 예측** | 과거 데이터 + Gemini 분석 |
| Slack·Telegram 발송 | Block Kit + 긴급도 이모지 |

### 인증 (앱 · 마이페이지)
| 기능 | 설명 |
|------|------|
| **사용자 프로필 (서버)** | `user_profiles.profile JSONB` — 13+ 필드 통합 보관 |
| **가점 트래커** | `my-score` — 정확한 가점 + 다음 +N점 예정 알림 |
| **인앱 알림 (🔔)** | D-day 임박 / 신규 공고 자동 매칭 알림 (매일 06/08시 cron) |
| **수동 알림** | 즐겨찾기 D-day / 메모 알림 본인 등록 |
| **알림 즉시 새로고침** | cron 기다리지 않고 본인 매칭 즉시 실행 |
| **AI 리포트 저장·이력** | 분석 결과를 reports 테이블에 시점 기록 |
| **추천 (서버)** | profile JSONB 기반 Top N + 매칭 사유 |
| **FCM 푸시** | fcm_token 등록 시 가점 변동·알림 푸시 |

## 처음 시작하는 순서

### 1단계: 스킬 설치

**가장 간단한 방법 — 에이전트에게 이 URL만 전달**하면 알아서 설치합니다:
```
https://github.com/tkddnjs-dlqslek/k-apt-alert
```
Claude Code / Codex 대화창에 "이 스킬 설치해줘"라고 하면 됩니다.

---

**수동 설치 (1-라이너):**

#### A) Claude Code — macOS / Linux / WSL
```bash
mkdir -p ~/.claude/skills && git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git ~/.claude/skills/korea-apt-alert
```

#### A) Claude Code — Windows PowerShell
```powershell
$dst = "$env:USERPROFILE\.claude\skills\korea-apt-alert"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git $dst
```

#### B) Codex CLI — macOS / Linux / WSL
```bash
mkdir -p ~/.agents/skills && git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git ~/.agents/skills/korea-apt-alert
```

#### B) Codex CLI — Windows PowerShell
```powershell
$dst = "$env:USERPROFILE\.agents\skills\korea-apt-alert"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git $dst
```

#### C) 둘 다 사용 — Unix 심볼릭 링크 (선택)
파일 1벌만 유지하려면:
```bash
# Claude Code 경로에 실제 설치
mkdir -p ~/.claude/skills && git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git ~/.claude/skills/korea-apt-alert
# Codex는 그 위치를 심볼릭 링크
mkdir -p ~/.agents/skills && ln -s ~/.claude/skills/korea-apt-alert ~/.agents/skills/korea-apt-alert
```

> **중요:** `korea-apt-alert` 대상 폴더명을 그대로 유지해야 합니다 (기본 clone 폴더명은 `k-apt-alert`이지만, SKILL.md의 스킬명이 `korea-apt-alert`라서 폴더명이 일치해야 `/korea-apt-alert` 명령이 동작).

### 설치 검증

런타임을 재시작하고 대화창에서 아래 명령이 동작하면 성공입니다.
```
/korea-apt-alert 청약이 뭐야?
```
→ 초보 가이드·핵심 용어 사전이 응답으로 나오면 스킬이 정상 로드된 것입니다. Claude Code와 Codex 모두 동일한 결과가 나와야 합니다.

### 2단계: 프로필 설정 (선택이지만 강력 권장)

Claude Code에서:
```
/korea-apt-alert setup
```
대화형으로 출생연도·선호 지역·가구 구성·청약통장·연소득 등 12개 항목을 입력합니다.
프로필은 `~/.config/k-skill/apt-alert-profile.json`에 로컬 저장되며 서버로 전송되지 않습니다.

### 3단계: 조회

```
/korea-apt-alert                     # 전체 조회
/korea-apt-alert 내 조건에 맞는 청약    # 프로필 기반 맞춤
/korea-apt-alert 서울 강남구 대단지만   # 지역 + 구/군 + 필터
/korea-apt-alert 내 가점 몇 점이야?    # 추정 가점 + 전략 안내
/korea-apt-alert 청약이 뭐야?          # 초보 가이드
```

### 4단계: 알림 설정 (선택)

Slack/Telegram으로 정기 알림을 받으려면 `~/.config/k-skill/secrets.env`에 추가:

```env
KSKILL_APT_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../xxx
KSKILL_APT_TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
KSKILL_APT_TELEGRAM_CHAT_ID=-1001234567890
```

### 5단계: 자동 알림 (선택)

두 가지 옵션:

**(A) Claude Code `/loop` — 세션 내 반복**
```
/loop 24h /korea-apt-alert 내 조건에 맞는 청약 알림 보내줘
```

**(B) 프록시 notify API — 세션 불필요, 가장 안정적**

GitHub Actions·cron 등에서 매일 호출 (한글 파라미터는 반드시 퍼센트 인코딩):
```bash
# region=서울,경기,인천 → 퍼센트 인코딩
curl -X POST "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notify?webhook_url=...&region=%EC%84%9C%EC%9A%B8,%EA%B2%BD%EA%B8%B0,%EC%9D%B8%EC%B2%9C&reminder=d3"
```

📘 **자동화 전체 가이드**: [`examples/user-automation/`](./examples/user-automation/) — 본인 GitHub 계정에 **빈 repo 1개 + yaml 파일 1개**만 올리면 매일 오전 7시(KST) 자동 발송 (Fork 불필요, 5분 셋업)

## 실제 출력 예시

### 예시 1) `/korea-apt-alert 내 조건에 맞는 청약` (프로필 28세·서울·통장 3년)

```
📋 프로필: 만 28세 / 서울·경기·인천 / 1인 가구 / 무주택 / 통장 3년
📊 추정 가점: 11점 / 84점
   - 무주택 기간: 0점 (만 30세 미만, 혼인 이력 없음)
   - 부양가족: 5점 (0명)
   - 통장 가입기간: 6점 (3년)
⭐ 특별공급: 생애최초 (통장 2년+ 충족)

⚠️ 가점이 낮아 수도권 APT 가점제 당첨은 현실적으로 어렵습니다.
   오피스텔·잔여세대·임의공급, 지방 중소도시 APT, 특별공급이 더 유리합니다.

🎯 추천 Top 3:
  1. 오피스텔/도시형 — 가점 무관, 통장 불필요
  2. APT 잔여세대 — 무순위 추첨, 즉시 신청 가능
  3. 생애최초 특별공급 — 통장 2년 + 무주택 + 소득 충족

📌 접수 중 공고 (서울·경기·인천, 3건):
| 이름                  | 지역       | D-day | 세대수 | 타입   |
|---------------------|-----------|-------|-------|--------|
| 인천가정2지구 B2블록   | 인천 서구   | D-13  | 308   | APT    |
| 동탄 그웬 160         | 경기 화성   | D-12  | 160   | APT    |
| 용인 고림 동문 디 이스트 | 경기 처인구 | D-5   | 350   | APT    |

💡 다음 단계:
1. 관심 공고의 청약홈 원문을 확인하세요
2. 청약 일정: 특별공급 → 1순위 → 2순위
3. 당첨자 발표: 접수 마감 후 7~10일
```

### 예시 2) `/korea-apt-alert 청약이 뭐야?`

```
청약이란?
새로 짓는 아파트(신축)를 분양받기 위해 신청하는 제도입니다.
추첨 또는 가점(점수) 방식으로 당첨자를 선정하며, 당첨되면 시세보다
저렴하게 내 집을 마련할 수 있습니다.

핵심 용어 사전
| 용어         | 뜻 |
|------------|-----|
| 청약통장     | 청약 신청에 필요한 전용 저축 통장 ... |
| 가점제       | 무주택 기간 + 부양가족 + 통장 기간으로 ... |
| 추첨제       | 가점 무관, 무작위 추첨 ... |
| 특별공급     | 신혼부부·다자녀 등 별도 물량 ... |
...
```

### 예시 3) 매칭 0건 — 인접 지역 제안

```
⚠️ 광주 지역 현재 접수 중인 공고 0건입니다.
💡 인접 지역(전남·전북)으로 확장하시겠어요?
   "전남 포함해서 다시 찾아줘"라고 말씀해주세요.
```

---

## 포함된 기능

### CLI Skill (사용자가 설치)
- [`SKILL.md`](SKILL.md) — 전체 워크플로우, 프로필 스키마, 12+ 트리거, 7개 분석 도구 통합, 인앱 알림 워크플로우, AI 리포트 저장 흐름

### Supabase 백엔드 (운영자가 배포 — 30+ Edge Functions)
- **크롤러** (8): `crawl-apt`, `crawl-officetell`, `crawl-lh`, `crawl-remndr`, `crawl-pbl-pvt-rent`, `crawl-opt`, `crawl-sh`, `crawl-gh`
- **공개 API** (8): `health`, `categories`, `announcements`, `notify`, `cache-status`, `notice`, `compare`, `similar-listings`
- **분석 도구** (5): `eligibility-precheck`, `simulate`, `price-assessment`, `location-score`, `school-zone`, `commute`, `development-news`, `visit-checklist`
- **인증 API** (5): `profile`, `recommendations`, `notifications`, `reports`, `my-score`, `score-refresh`
- **알림 cron** (2): `notify-cron` (KST 06/08시), `notifications/refresh` (수동)
- [`supabase/functions/_shared/`](supabase/functions/_shared/) — 공유 모듈 (auth, profile, notify-match, eligibility, gemini, kakao, mobility, neis, news, realestate, risk, types, …)
- [`supabase/migrations/`](supabase/migrations/) — 015+ 마이그레이션 (테이블·RLS·pg_cron·vault)

### 청약 코파일럿 모바일 앱 (별도 레포)
- 4-탭 IA: 홈 / 공고 / AI 리포트 / 내 정보
- Supabase Auth (이메일 매직링크 + Google/Kakao OAuth)
- 본 레포의 인증 API들이 백엔드

### 프록시 (FastAPI, 옵션)
- [`proxy/`](proxy/) — Render 호스팅용 FastAPI 미러 (Phase 1 무료 기능만)
- 162개 pytest 테스트 (`pytest tests/`)
- Edge Function이 prod, FastAPI는 로컬 디버깅용

## API 레퍼런스

**운영 base**: `https://xnyhzyvigazofjoozuub.supabase.co/functions/v1`

### 공개 API (인증 불필요)

| 메서드 · 경로 | 설명 |
|---|---|
| `GET /health` | 서버 상태 |
| `GET /categories` | 카테고리 8종 목록 |
| `GET /announcements?category=&region=&district=&min_units=&constructor_contains=&exclude_ids=&reminder=` | 청약 공고 통합 조회 (D-day 자동 계산) |
| `POST /notify?webhook_url=&telegram_token=&telegram_chat_id=&...` | Slack/Telegram 발송 |
| `GET /cache-status` | 크롤 메타데이터·일일 호출 카운터 상태 |
| `GET /notice/{id}/raw?url=&max_chars=&force_refresh=` | 모집공고 본문 추출 (LLM 분석용 raw 텍스트) |
| `GET /compare?ids=A,B,C` | 2~5개 공고 한 표로 비교 |
| `GET /similar-listings?announcement_id=&max_results=` | 유사공고 + 경쟁률 예측 + Gemini 분석 |
| `POST /eligibility-precheck` body: `{announcement_id, ...UserProfile}` | 부적격 사전검증 + 가점 계산 |
| `POST /simulate` body: `{announcement_id, supply_type, user_profile}` | 5단계 시뮬레이션 |
| `GET /price-assessment?announcement_id=` | 분양가 평가 (실거래가 비교) |
| `GET /location-score?announcement_id=` | 입지 점수 (학군·통근 종합) |
| `GET /school-zone?announcement_id=` | 학군 분석 (반경 300m/500m/1km) |
| `GET /commute?announcement_id=&to=` | 통근 시간 (카카오 모빌리티) |
| `GET /development-news?announcement_id=` | 주변 호재 뉴스 (네이버 검색) |
| `GET /visit-checklist?announcement_id=` | 임장 체크리스트 |

### 인증 API (`Authorization: Bearer <jwt>` 필수)

| 메서드 · 경로 | 설명 |
|---|---|
| `GET /profile` | 본인 프로필 (profile JSONB + score + derived fields) |
| `PATCH /profile` body: `{...18개 필드 일부}` | 프로필 부분 머지 (UI extras + UserProfile 통합) |
| `GET /recommendations?limit=3` | 본인 프로필 기반 Top N 추천 + 매칭 사유 |
| `GET /notifications?unread_only=&limit=` | 본인 인앱 알림 목록 + unread_count |
| `POST /notifications` body: `{type, title, body?, link?, related_announcement_id?}` | 본인 임의 알림 등록 |
| `POST /notifications/refresh?mode=dday_alert\|announcement_new` | 본인 매칭 즉시 실행 |
| `PATCH /notifications/{id}/read` | 단일 읽음 처리 |
| `PATCH /notifications/read-all` | 일괄 읽음 |
| `GET /reports?limit=&notice_id=` | 본인 AI 리포트 이력 |
| `POST /reports` body: `{notice_id, summary_markdown, raw_excerpt?, ...}` | AI 분석 결과 저장 |
| `GET /reports/{id}` | 단일 리포트 상세 |
| `DELETE /reports/{id}` | 본인 리포트 삭제 |
| `GET /my-score` | 본인 가점 조회 (저장된 프로필 + score 캐시) |
| `POST /my-score` body: `{...UserProfile 13필드}` | 프로필 갱신 + 즉시 가점 재계산 |

### Service-role 전용 (cron)

| 메서드 · 경로 | 설명 |
|---|---|
| `POST /notify-cron?mode=dday_alert\|announcement_new` | 전체 사용자 매칭 알림 (매일 KST 06/08시) |
| `POST /score-refresh` | 월별 가점 일괄 재계산 + FCM 푸시 |
| `GET /crawl-{apt\|officetell\|lh\|remndr\|pbl-pvt-rent\|opt\|sh\|gh}` | 카테고리별 크롤링 (10분 간격 cron) |
| `GET /crawl-enrich` | 일정 보강 (HTML 스크래핑) |

> 모든 함수는 `--no-verify-jwt`로 배포 — 게이트웨이 JWT 검증 끄고 함수 코드에서 직접 처리.

---

## 청약 코파일럿 모바일 앱 (별도 레포)

본 레포가 백엔드. 앱은 별도 팀이 개발.

### 4-탭 IA

| 탭 | 주 API | 보조 API |
|----|-------|---------|
| **🏠 홈** | `GET /recommendations` | `GET /notifications?unread_only=true` (🔔 뱃지) |
| **📋 공고** | `GET /announcements` | `GET /compare`, `GET /similar-listings` |
| **🤖 AI 리포트** | `GET /notice/{id}/raw` + `POST /reports` | `GET /reports` (이력) |
| **👤 내 정보** | `GET /profile` + `PATCH /profile` | `GET /my-score`, `GET /notifications` |

### 마이페이지 화면 데이터

| 영역 | 데이터 |
|------|------|
| 헤더 (닉네임 · 가점) | `profile.nickname` + `score.total` |
| 기본 정보 카드 | `profile`의 age (derived) / household_type / homeownership / income_bracket / preferred_regions / preferred_size_sqm |
| 청약통장 카드 | `profile.account_join_date` (가입기간 derived) / payment_count / balance |
| 특별공급 자격 (관심) | `profile.special_supply_interests[]` |
| 🔔 알림 뱃지 | `notifications.unread_count` |

### 인증 흐름

1. 앱 로그인 (이메일 매직링크 / Google OAuth / Kakao OAuth) — Supabase Auth
2. JWT 발급 → `Authorization: Bearer <jwt>` 헤더로 모든 인증 API 호출
3. RLS 정책 (`auth.uid() = user_id`)이 본인 row만 격리

### 데이터 소스

| 카테고리 | 업데이트 | 캐시 TTL |
|----------|---------|----------|
| APT 일반분양 | 월 25일 배치 | 60분 |
| 공공지원민간임대 | 실시간 | 30분 |
| 오피스텔/도시형, LH, 잔여세대, 임의공급 | 실시간 | 10분 |
| SH(서울) · GH(경기) 공공주택 | HTML 크롤링 | 30분 |

## Supabase 백엔드 (운영자용)

### 로컬 실행
```bash
supabase start                      # 로컬 DB + Edge Functions 실행
supabase functions serve            # Edge Functions 핫리로드
# http://localhost:54321/functions/v1/health 에서 확인
```

### Supabase 배포
```bash
supabase link --project-ref xnyhzyvigazofjoozuub

# Secrets
supabase secrets set DATA_GO_KR_API_KEY=your_key
supabase secrets set FIREBASE_SERVER_KEY=your_fcm_key   # 푸시 알림 (선택)
supabase secrets set GEMINI_API_KEY=your_key            # similar-listings LLM (선택)
supabase secrets set KAKAO_API_KEY=your_key             # 카카오 모빌리티/로컬 (선택)
supabase secrets set NEIS_API_KEY=your_key              # 학교 정보 (선택)
supabase secrets set NAVER_CLIENT_ID=                   # 호재 뉴스 (선택)
supabase secrets set NAVER_CLIENT_SECRET=
supabase secrets set REALESTATE_API_KEY=                # 국토부 실거래가 (선택)

# 마이그레이션 (15+개) — Supabase SQL Editor 또는 supabase db push
supabase db push

# Edge Functions (30+) — 모두 --no-verify-jwt
supabase functions deploy --no-verify-jwt
```

### 운영 보호 장치
- **PostgreSQL 영속 캐시**: 서버 재시작과 무관, 분석 함수 결과는 30일 cron 정리
- **pg_cron 자동 크롤링·알림**:
  - 8개 크롤러 10분 간격
  - notify-cron 매일 KST 06시(D-day) / 08시(신규공고)
  - score-refresh 월 1회 (가점 일괄 재계산)
- **카테고리별 TTL**: apt 60분 / pbl_pvt_rent·sh·gh 30분 / 나머지 10분
- **일일 rate limit**: 9000건 초과 시 DB 기반 카운터로 보호
- **RLS**:
  - 공고 데이터: 공개 읽기, 쓰기 service_role
  - 사용자 데이터(profiles, notifications, reports, user_profiles): `auth.uid() = user_id` 본인만
  - 분석 캐시: 공개 읽기, 쓰기 service_role
- **Vault**: `service_role_key`를 vault 저장 → pg_cron이 안전하게 읽음 (007_vault_cron)

### 마이그레이션 목록 (요약)
| 파일 | 내용 |
|------|------|
| `001_create_tables` | announcements, crawl_metadata, rate_limit, schedule_enrichment_cache + RLS |
| `002_enable_extensions` | pg_cron, pg_net |
| `003_cron` | 크롤러 10분 cron 등록 |
| `004_cache_tables` | price/location 캐시 |
| `005_cron_debug` | 진단 도구 |
| `006_notifications` | 알림 테이블 + RLS (self select/update) |
| `007_vault_cron` | service_role_key vault 저장 |
| `008_more_caches` | school/commute/news/similar 캐시 + user_profiles 초기 (TEXT) |
| `009_notice_raw` | 모집공고 raw 캐시 |
| `010_reports` | AI 리포트 저장 |
| `012_user_profiles_uuid` | user_profiles UUID 전환 + fcm_token |
| `013_patches` | RLS 패치 + UUID 마이그레이션 보충 |
| `014_notify_cron_schedule` | notify-cron 매일 06/08시 등록 |
| `015_notifications_self_insert` | notifications POST 위한 RLS |

## 보안·프라이버시

- 프로필은 로컬 파일(`~/.config/k-skill/*.json`)에 저장되며 **프록시·서버로 전송되지 않습니다**.
- 프록시 요청에는 지역·평형·카테고리·세대수·시공사 키워드만 포함됩니다 (개인정보 미포함).
- Unix/macOS는 `chmod 600`이 자동 설정됩니다.
- 프로필 삭제: `/korea-apt-alert profile --delete` 또는 파일 직접 삭제.

## FAQ

**Q. API 서버가 응답하지 않아요**
A. Supabase Edge Functions는 항상 활성 상태입니다 (Render free tier와 달리 슬립 없음). 응답이 없다면 Supabase 대시보드에서 Edge Functions 로그를 확인하세요.

**Q. 가점 계산이 정확한가요?**
A. 프로필 기반 추정치입니다. 만 30세 ↔ 혼인신고일 중 늦은 해 기산, 통장 미성년 가입분 최대 2년 인정 등 주요 규칙은 반영되어 있지만, 부양가족 직계존속 3년 동일 세대 등록 요건은 자동 확인이 불가합니다. 정확한 가점은 [청약홈](https://www.applyhome.co.kr)에서 조회하세요.

**Q. 1주택자도 사용할 수 있나요?**
A. 네. 오피스텔, 잔여세대, 임의공급은 무주택 불문이며, "갈아타기 안내"가 자동 제공됩니다.

**Q. LH 공고의 지역이 "전국"으로 나와요**
A. LH 공고 제목에서 특정 지역을 추론할 수 없는 경우 "전국"으로 표시되며, 모든 프로필 지역 필터에서 항상 통과됩니다.

**Q. 매칭 공고가 0건이에요**
A. 프로필 지역이 좁은 경우 인접 지역(17개 매핑) 확장 제안을 받습니다. 예: 광주 → 전남·전북, 강원 → 충북.

**Q. CLI에서 인증 토큰을 어떻게 얻나요?**
A. 청약 코파일럿 모바일 앱 → 마이페이지 → CLI 토큰 발급 (Phase 2 후속). 임시로 Supabase Auth `access_token`을 직접 사용해도 됩니다. 토큰은 `~/.config/k-skill/auth.json` (chmod 600) 또는 `KAPT_AUTH_TOKEN` env var에 저장. 자세한 가이드는 [SKILL.md](SKILL.md) "서버 프로필 + 추천" 섹션 참조.

**Q. AI 리포트는 어떻게 저장되나요?**
A. SKILL이 한 흐름으로 처리: ① `notice/{id}/raw`로 모집공고 본문 추출 → ② SKILL 자체가 LLM (사용자 프로필 + raw로 분석) → ③ `POST /reports`로 시점 기록 저장. 인증 토큰 필수. `reports`는 UPDATE 정책 없음 (시점 기록 불변), 다시 분석하려면 새 row 생성.

**Q. 모바일 앱은 어디서 받나요?**
A. 별도 레포에서 개발 중. 본 레포는 백엔드 + CLI Skill만 포함합니다. 앱이 출시되기 전에도 CLI Skill로 모든 기능 사용 가능.

**Q. 인앱 알림(🔔)이 비어있어요**
A. `notify-cron`이 매일 KST 06시(D-day) / 08시(신규공고)에 사용자 프로필 매칭 알림을 자동 생성합니다. 즉시 받고 싶으면 `POST /notifications/refresh?mode=dday_alert` (인증 토큰)로 본인 매칭 즉시 실행. 또는 SKILL에서 "알림 새로고침"이라고 입력.

## License

MIT
