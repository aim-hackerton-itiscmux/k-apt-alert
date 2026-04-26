---
name: korea-apt-alert
description: 한국 청약 공고를 개인 프로필 기반으로 조회·분석하고 Slack/Telegram으로 알림을 보낸다. 공공데이터포털 6개 API를 프록시 경유로 통합 조회하며, 사용자 API 키 없이 동작한다.
license: MIT
metadata:
  category: real-estate
  locale: ko-KR
  phase: v1.0
---

# 한국 청약 공고 알리미

> 한국 청약 공고 조회·분석·알림 서비스입니다. 공공데이터포털 API를 프록시 경유로 통합 조회하며, 사용자 API 키 없이 동작합니다.

공공데이터포털의 청약홈 분양정보 API를 프록시 경유로 조회하여 **사용자 프로필 기반**으로 최신 청약 공고를 필터링·분석·알림한다.

---

## ⚡ 빠른 응답 원칙 (모든 요청에 최우선 적용)

**기본은 간결하게, 상세는 요청 시에만.** 아래 규칙을 반드시 지킨다.

### 1. 출력 길이 기본값
- 기본 응답은 **프로필 요약 1줄 + 공고 테이블 1개 (최대 15줄)**
- Top 3 추천·가점대별 전략·인접 지역 확장·일정 안내 등은 **기본 출력에서 제외**
- 마지막에 한 줄만: `💡 더 보려면: '내 조건에 맞는 추천' / '내 가점' / '청약 가이드'`

### 2. 명시 요청 시에만 상세 출력
| 사용자 말 | 출력 모드 |
|-----------|----------|
| `/korea-apt-alert` 단독, "공고 보여줘", "청약 공고" | **간결** (테이블만) |
| "내 조건에 맞는", "맞춤 추천", "Top 3" | 프로필 매칭 + Top 3 + 테이블 |
| "내 가점", "가점 계산" | 가점 계산 + 가점대별 전략 |
| "특별공급", "신혼부부·다자녀 자격" | 특별공급 판정만 |
| "청약이 뭐야", "초보", "가이드", "설명해줘" | 청약 입문 가이드 |
| "0건 나왔어, 인접 지역" | 인접 지역 확장 제안 |
| "이 공고 분석/해석/요약해줘", "Top 1 자세히", "{공고명} 깊게" | **모집공고 해석자** (notice raw + LLM 요약) |
| "내 추천", "맞춤 공고", "내 조건에 맞는 추천" (인증 시) | **서버 프로필 기반 추천** (recommendations API) |
| "프로필 동기화", "내 프로필 업로드" (인증 시) | **로컬 ↔ 서버 user_profiles 동기화** (PATCH /v1/profile) |
| "알림 새로고침", "내 알림 갱신", "지금 알림 받기" (인증 시) | **본인 프로필 매칭 즉시 실행** (notifications/refresh) |
| "이 공고 알림 등록", "알림에 추가", "메모 알림" (인증 시) | **수동 알림 추가** (POST /v1/notifications) |
| "내 자격 확인", "이 공고 부적격 위험" + 공고명 (인증 시) | **부적격 사전검증** (eligibility-precheck) |
| "5단계 시뮬레이션", "당첨까지 단계", "이 공고 단계별" + 공고명 | **청약 시뮬레이션** (simulate) |
| "공고 비교", "{A} vs {B}", "이 두 공고 표로" | **공고 비교 표** (compare) |
| "비슷한 공고", "유사 공고", "경쟁률 예측" + 공고명 | **유사공고 + 경쟁률 예측** (similar-listings) |
| "내 가점", "확정 가점", "가점 계산" (인증 시) | **가점 트래커** (my-score, GET 본인 / POST 갱신) |
| "이 공고 분석 후 저장", "리포트 저장" + 공고명 (인증 시) | **AI 리포트 저장 워크플로우** (notice/raw + LLM + POST /reports) |
| "내 리포트", "내 분석 이력" (인증 시) | **AI 리포트 이력** (GET /v1/reports) |
| "내 서류함", "내 서류", "준비 서류" (인증 시) | **서류함 목록 + 진행률** (GET /v1/documents) |
| "서류 등록", "{서류명} 등록", "주민등록등본 추가" (인증 시) | **서류 신규 등록** (POST /v1/documents) |
| "서류 만료", "갱신 필요한 서류", "만료 임박" (인증 시) | **만료/만료임박 서류 필터** (GET /v1/documents에서 status 필터링) |
| "준비 체크리스트 시작", "{공고명} 준비 시작" (인증 시) | **체크리스트 자동 생성** (POST /v1/preparation/init?announcement_id=) |
| "내 준비 진행률", "준비 어디까지", "{공고명} 준비" (인증 시) | **체크리스트 + 진행률** (GET /v1/preparation, documents 자동 ✅) |
| "{항목} 체크", "체크 해제" (인증 시) | **단일 항목 토글** (PATCH /v1/preparation/{id}/done) |
| "{공고명} 변경 내역", "정정공고 확인", "이 공고 바뀐 거" | **공고 변경 이력** (GET /v1/announcement-changes?announcement_id=) |
| "최근 정정공고", "오늘 바뀐 공고" | **전체 최근 변경** (GET /v1/announcement-changes/recent) |

### 3. 프록시 호출 규칙 (필수)

**타임아웃**
- `/functions/v1/announcements` 호출은 **반드시 `--max-time 180`** 이상 (cold cache + apt 크롤링은 60~120초 소요 가능)
- `/health`는 `--max-time 15`면 충분 (하지만 기본적으로 호출 금지)
- 30초·60초·90초 타임아웃은 **쓰지 말 것** — cold 상태에서 확정적으로 실패

**URL 형식**
- URL 전체를 반드시 큰따옴표 `"..."`로 감싸 단일 스트링으로 전달
- 여러 커맨드를 `&&`로 체이닝하지 말고 **curl 1개만 실행** (셸이 `&`를 background 연산자로 오해하거나 앞 명령 출력이 다음 요청에 섞일 수 있음)
- **한국어 파라미터는 반드시 퍼센트 인코딩하여 전달**
  - Windows Git Bash 등 locale이 UTF-8이 아닌 환경에선 한글이 cp949/EUC-KR로 깨져 `invalid request line` 또는 mojibake+0건 응답 발생
  - `-G --data-urlencode "region=서울"`도 **이미 깨진 바이트**를 받으므로 무력 — 반드시 사전 인코딩된 문자열을 URL 쿼리에 직접 박을 것
  - 광역 지역 매핑 (그대로 사용):
    - `서울=%EC%84%9C%EC%9A%B8` · `경기=%EA%B2%BD%EA%B8%B0` · `인천=%EC%9D%B8%EC%B2%9C`
    - `부산=%EB%B6%80%EC%82%B0` · `대구=%EB%8C%80%EA%B5%AC` · `광주=%EA%B4%91%EC%A3%BC`
    - `대전=%EB%8C%80%EC%A0%84` · `울산=%EC%9A%B8%EC%82%B0` · `세종=%EC%84%B8%EC%A2%85`
  - 구/군 등 임의 한글은 Python 원라이너로 사전 인코딩: `python -c "import urllib.parse; print(urllib.parse.quote('강남구'))"`
- `-G --data-urlencode`는 Linux/macOS UTF-8 환경에서만 허용 (Windows 금지)

**빈 응답 처리**
- 응답이 `{"count": 0, "announcements": []}`이고 `errors` 필드에 특정 카테고리만 실패 기록이 있다면 → apt 등 느린 카테고리가 아직 적재 중일 가능성. **15~30초 대기 후 1회 재시도**
- `count: 0 + errors: null`이면 진짜 0건 → 인접 지역 확장 제안

**웜업**
- `/health` 사전 호출 **금지** (GitHub Actions가 12분마다 핑 중)
- 예외: 위 "빈 응답 처리" 재시도 시에만 허용

**최소 호출 원칙**
- 공고 조회는 필요한 `category`와 `region`만 지정해서 **단일 호출**
- 동일 파라미터로 반복 호출 금지 (캐시가 이미 warm이면 즉시 응답)

**실패 메시지**
- `Exit code 28` (timeout): "프록시가 기동 중이거나 첫 조회라 시간이 걸립니다. 1~2분 후 다시 시도해주세요."
- `"Invalid HTTP request"`: 셸 인용 문제 — URL을 `"..."`로 다시 감싸 재시도
- 2회 이상 실패하면 사용자에게 에러 전달 후 중단 (무한 재시도 금지)

### 4. Thinking 최소화
- 복잡한 판단 없이 curl 1번 → 테이블 변환 → 출력
- 사용자가 명시적으로 분석 요청하지 않으면 **추론/해석 추가 금지**

### 5. 색상 이모지 사용 규칙 (혼란 방지)

🟢·🟡·🔴·⚪는 **의미가 용도별로 다르므로 반드시 범례와 함께** 사용한다. 혼자 나열하면 사용자가 뭔 뜻인지 모른다.

| 용도 | 위치 | 범례 표기 방식 |
|------|------|--------------|
| **당첨 가능성** | Top 3 번호 옆 | `※ 항목 옆 이모지 = 당첨 가능성 (🟢 높음 · 🟡 보통 · 🔴 낮음 · ⚪ 판정불가)` |
| **D-day 긴급도** | 테이블 D-day 컬럼 | `※ D-day 색: 🔴 ≤D-1 · 🟡 ≤D-3 · 🟢 ≥D-4` |
| **프로필 매칭도** | 테이블 매칭 컬럼 | `※ 매칭: 🟢 강력 추천 · 🟡 조건부 · 🔴 제외` |

- 범례 없이 이모지만 나열 **금지**
- 같은 항목에 같은 색을 두 번 쓰지 않기 (번호 옆 🟡 + "당첨 가능성: 🟡 보통" 중복 금지)
- 간결 모드에서는 색 이모지 자체 사용 안 함

### 6. 간결 출력 템플릿 예시
```
📋 프로필: 만 28세 / 서울·경기·인천 / 무주택 / 통장 3년
📢 접수 중 공고 (3건):

| 이름                  | 지역       | D-day | 세대수 | 타입   |
|---------------------|-----------|-------|-------|--------|
| 인천가정2지구 B2블록   | 인천 서구   | D-13  | 308   | APT    |
| 동탄 그웬 160         | 경기 화성   | D-12  | 160   | APT    |
| 용인 고림 동문 디 이스트 | 경기 처인구 | D-5   | 350   | APT    |

💡 더 보려면: '내 조건에 맞는 추천' / '내 가점' / '청약 가이드'
```

이 원칙이 아래 상세 규칙들보다 **우선**한다. 아래 규칙은 사용자가 명시 요청했을 때만 적용.

---

## 사용 예시

- "최신 청약 공고 알려줘"
- "내 프로필 설정해줘" / `/korea-apt-alert setup`
- "내 조건에 맞는 청약 있어?"
- "서울 강남구 아파트 청약 조회해줘"
- "청약이 뭐야?" / "청약 초보인데 설명해줘"
- "내 가점 몇 점이야?"
- "청약 공고 조회해서 Slack으로 보내줘"

---

## 청약 입문 가이드

**적용 시점**: 사용자가 "청약이 뭐야", "처음", "초보", "모르겠", "설명해줘", "가이드" 등의 키워드를 **명시적으로** 사용할 때만. 공고 조회 요청에는 이 섹션을 출력하지 않는다.

### 청약이란?

새로 짓는 아파트(신축)를 분양받기 위해 신청하는 제도입니다. 추첨 또는 가점(점수) 방식으로 당첨자를 선정하며, 당첨되면 시세보다 저렴하게 내 집을 마련할 수 있습니다.

### 핵심 용어 사전

| 용어 | 뜻 |
|------|-----|
| **청약통장** (주택청약종합저축) | 청약 신청에 필요한 전용 저축 통장. 대부분의 APT 청약에 필수. 가입 기간과 납입 횟수가 가점에 반영됨 |
| **가점제** | 무주택 기간 + 부양가족 수 + 통장 가입기간을 점수화(최대 84점)하여 높은 점수 순으로 당첨자 선정 |
| **추첨제** | 자격을 갖춘 신청자 중 무작위 추첨. 가점이 낮아도 당첨 가능. 85m² 초과 타입에 주로 적용 |
| **특별공급** | 신혼부부, 다자녀, 생애최초 구매자 등에게 별도 물량을 배정하는 제도. 일반공급보다 경쟁률이 낮은 경우가 많음 |
| **일반공급** | 특별공급 이후 남은 물량을 1순위·2순위로 나눠 모집 |
| **무주택세대구성원** | 세대원 전원이 주택을 소유하지 않은 상태. 대부분의 청약 자격 요건 |
| **투기과열지구** | 정부가 지정한 부동산 과열 지역. 가점제 비율 100%, 전매 제한, 거주의무 등 규제 강화 |
| **분양가상한제** | 정부가 분양가를 제한하는 제도. 시세 대비 저렴하지만 거주의무기간(2~5년)이 부여됨 |
| **전용면적** | 실제 거주 공간 면적. 소형(<60m²/~18평), 중형(60~85m²/18~25평), 대형(85m²+/25평+) |

### 나에게 맞는 청약 유형 찾기

```
통장이 있나요?
├── YES → 무주택인가요?
│   ├── YES → APT 일반분양, LH 공공분양 가능!
│   │         (+ 특별공급 자격도 확인해보세요)
│   └── NO → 갈아타기: 일부 조건부 청약 가능
│             (+ 오피스텔, 잔여세대는 무주택 불문)
└── NO → 걱정 마세요! 통장 없이도 가능한 유형이 있어요
         → 오피스텔/도시형, 잔여세대, 임의공급 (선착순)
```

---

## 개인화 프로필 시스템

### 개인정보 수집·저장 고지

이 스킬은 아래 항목을 **로컬에만 저장**하며, 프록시 서버나 외부로 전송하지 않습니다.

- 출생연도, 혼인신고일, 거주지역/기간, 연소득 구간, 청약통장 정보, 가구 구성, 자녀·부양가족 수, 과거 당첨 이력
- 저장 위치: `~/.config/k-skill/apt-alert-profile.json` / `favorites.json` / `notified.json`
- 프록시 API 요청에는 **지역·평형·카테고리·세대수·시공사 키워드**만 포함됩니다 (개인정보 없음)
- 삭제: `/korea-apt-alert profile --delete` 또는 파일 직접 삭제

**파일 권한 설정 (권장)** — 프로필 저장 직후 본인만 읽기·쓰기 가능하도록:
```bash
chmod 600 ~/.config/k-skill/*.json
```
Windows 사용자는 파일 속성 → 보안 탭에서 본인 계정만 권한 부여.

### 프로필 저장 위치

`~/.config/k-skill/apt-alert-profile.json`

### 프로필 저장 후 자동 권한 설정

프로필(또는 favorites/notified) 파일을 작성/갱신할 때마다 Unix 계열 OS는 권한을 600으로 자동 설정한다. Windows는 기본 사용자 프로필 폴더가 이미 본인 한정이므로 별도 조치 불필요.

**Claude 실행 책임 (자동)**:
```bash
# Unix/macOS/WSL
chmod 600 ~/.config/k-skill/*.json 2>/dev/null || true
# Windows: %USERPROFILE%\.config\k-skill\ 폴더가 이미 사용자 한정이므로 skip
```
프로필을 편집한 모든 작업(설치·setup·부분 업데이트·favorites 추가) 끝에 이 명령을 실행한다.

### 프로필 삭제 (`profile --delete`)

사용자가 "프로필 삭제", "내 정보 지워", `profile --delete` 등을 요청하면:
1. 확인 메시지: "프로필을 영구 삭제합니다. 계속하시겠습니까? (yes/no)"
2. 동의 시 `~/.config/k-skill/apt-alert-profile.json` 삭제
3. 선택적으로 `favorites.json` / `notified.json`도 함께 삭제 여부 확인

### 프로필 설정 (`setup`)

사용자가 "프로필 설정", "setup", "내 정보 등록" 등을 요청하면 아래 항목을 **대화형으로** 하나씩 물어본다. 모르거나 건너뛰고 싶은 항목은 null로 저장한다.

**답변 형식 일반 규칙:**
- `(a) ~ (e)` 목록은 기본 단일 선택. "복수 선택 가능" 명시된 항목만 다중 응답 허용
- 복수 선택 항목은 쉼표 / 공백 / "a,b" / 선택지 이름 병기 모두 허용 (예: "소형,중형" 또는 "a, b")
- "전부", "모두", "상관없음"은 해당 필터 비활성화 (전체 매칭)
- 수치(연도·기간·소득)는 자유 입력, 모르면 "모름"으로 저장(null)

**질문 표시 형식 (필수 통일):**
- 각 질문은 반드시 `**질문 N/12.** [질문 내용]` 형식으로 출력
- 키캡 이모지(1️⃣~9️⃣·🔟)는 **사용 금지** — 10 이후 디자인 불일치 발생
- 예: `**질문 1/12.** 출생연도를 알려주세요 (예: 1998)`
- 예: `**질문 10/12.** 과거 청약 당첨 이력이 있으신가요?`

#### 질문 순서 및 선택지

**1. 출생연도**
- 자유 입력 (예: 1995)
- 만 나이를 자동 계산하여 `age` 필드에 저장

**2. 선호 지역 (복수 선택)**
- [ ] 서울  [ ] 경기  [ ] 인천  [ ] 부산  [ ] 대구
- [ ] 광주  [ ] 대전  [ ] 울산  [ ] 세종
- [ ] 강원  [ ] 충북  [ ] 충남  [ ] 전북  [ ] 전남
- [ ] 경북  [ ] 경남  [ ] 제주
- [ ] 전체 (모든 지역)

**3. 가구 구성**
- (a) 1인 가구 (미혼)
- (b) 신혼부부 (혼인 7년 이내) → 혼인신고 연월 추가 질문
- (c) 기혼 (자녀 없음)
- (d) 기혼 + 자녀 있음 → 자녀 수 추가 질문
- (e) 한부모 가정 → 자녀 수 추가 질문

**4. 무주택 여부**
- (a) 무주택 — 본인 및 세대원 명의 주택 없음
- (b) 1주택 보유 (갈아타기 관심)
- (c) 2주택 이상 보유

참고: "무주택"은 본인뿐 아니라 배우자·세대원 전원의 주택 소유 여부를 포함합니다.

**5. 청약통장**
- (a) 없음
- (b) 있음 → 가입기간(년), 납입횟수(회) 추가 질문

**6. 연소득 구간** (세대 합산)
- (a) 3천만원 이하
- (b) 3천~5천만원
- (c) 5천~7천만원
- (d) 7천~1억원
- (e) 1억원 초과
- (f) 모름 / 건너뛰기

**7. 선호 평형 (복수 선택 가능)**
- [ ] 소형 (전용 60m² 미만 / ~18평)
- [ ] 중형 (60~85m² / 18~25평)
- [ ] 대형 (85m² 초과 / 25평+)
- [ ] 상관없음 (선택 시 필터 비활성화, 단독 선택)

예시 답변: "소형, 중형" / "a,b" / "전부"

**8. 혼인신고 연월** (가구 구성이 신혼부부/기혼인 경우만)
- 자유 입력 (예: 2023-03)
- 혼인 7년 이내 여부 자동 판정 → 신혼부부 특별공급 자격

**9. 현재 거주 지역 + 거주 기간**
- 거주 시/도 (선택지: 지역 목록과 동일)
- 해당 지역 연속 거주 기간 (년)
- 일부 청약은 해당 지역 거주자 우대

**10. 과거 청약 당첨 이력**
- (a) 당첨 이력 없음
- (b) 5년 이내 당첨 이력 있음 → 재당첨 제한 대상 안내
- (c) 5년 초과 당첨 이력 있음

**11. 부양가족 수** (가점 계산용)
- 본인 제외 부양가족 수 (배우자, 직계존비속 포함)
- 가점제 최대 35점 중 가장 큰 비중

**12. 임신 여부** (다자녀 판정 보정)
- (a) 해당 없음
- (b) 임신 중 → 다자녀 특별공급·가구원수 계산 시 태아 1명 포함
- 참고: 태아 인정은 공고별 상이. 원문 확인 필요.

### 프로필 부분 업데이트

기존 프로필이 있는 상태에서 "혼인신고일만 수정", "자녀 수 업데이트" 같은 부분 변경을 요청하면:
1. `~/.config/k-skill/apt-alert-profile.json` 로드
2. 변경할 필드만 물어보고 나머지는 유지
3. `updated_at`을 오늘 날짜로 갱신
4. 전체 재설정이 필요하면 "프로필 재설정" / `setup --reset`으로 초기화

트리거 키워드: "프로필 업데이트", "수정", "변경", "바꿔줘", `setup --field=X`

### 프로필 JSON 스키마

```json
{
  "birth_year": 1995,
  "age": 31,
  "regions": ["서울", "경기", "인천"],
  "household": {
    "type": "newlywed",
    "children_count": 0
  },
  "homeless": true,
  "housing_count": 0,
  "subscription_account": {
    "has_account": true,
    "years": 5,
    "deposit_count": 60
  },
  "annual_income": "5천~7천만원",
  "income_bracket": "mid",
  "preferred_size": ["소형", "중형"],
  "marriage_date": "2023-03",
  "residence_region": "서울",
  "residence_years": 5,
  "previous_win": "없음",
  "dependents_count": 1,
  "pregnant": false,
  "updated_at": "2026-04-16"
}
```

필드 값 참조:
- `household.type`: `"single"` | `"newlywed"` | `"married_no_child"` | `"married_with_child"` | `"single_parent"`
- `income_bracket`: `"low"` (≤3천) | `"mid_low"` (3천~5천) | `"mid"` (5천~7천) | `"mid_high"` (7천~1억) | `"high"` (>1억) | `null`
- `housing_count`: 0 (무주택) | 1 (1주택) | 2+ (다주택)
- `previous_win`: `"없음"` | `"5년이내"` | `"5년초과"`

### 프로필 갱신 알림

프로필 로드 시 `updated_at`을 확인한다.
- 90일 이상 경과: "ℹ️ 프로필이 {N}일 전에 설정되었습니다. 변경 사항이 있으면 '프로필 업데이트'라고 말씀해주세요."
- 365일 이상 경과: "⚠️ 프로필이 1년 이상 지났습니다. 통장 기간·소득·가구 구성 등이 변경되었을 수 있으니 업데이트를 권장합니다."

---

## 청약 유형별 자격 매칭 로직

프로필이 있으면 아래 로직으로 **추천 유형**을 자동 판정한다.

### 매칭 테이블

| 카테고리 | 청약통장 | 무주택 | 소득 기준 | 추천 대상 |
|----------|---------|--------|-----------|-----------|
| **APT 일반분양** | 필수 (가입 2년+, 지역별 상이) | 필수 | 없음 | 통장 보유 + 무주택 |
| **오피스텔/도시형** | 불필요 | 불필요 | 없음 | **누구나** (만 19세+) |
| **LH 공공분양** | 필수 (가입 6개월+) | 필수 | 가구원수별 소득 기준 | 통장 보유 + 무주택 + 소득 충족 |
| **APT 잔여세대** | 불필요 | 불필요 | 없음 | **누구나** |
| **공공지원민간임대** | 불필요 | 필수 | 가구원수별 소득 기준 | 무주택 + 소득 충족 |
| **임의공급** | 불필요 | 불필요 | 없음 | **누구나** (선착순) |

### 1주택 이상 보유자 안내

`housing_count >= 1`인 사용자를 완전 배제하지 않는다. 대신:

1. **즉시 가능**: 오피스텔/도시형, 잔여세대, 임의공급 (무주택 불문)
2. **조건부 가능**: 투기과열지구 외 지역의 85m² 초과 타입 (추첨제로 1주택 허용하는 경우 있음)
3. **처분 조건부**: "기존 주택 처분 조건으로 청약 가능한 공고도 있습니다. 공고문의 '1주택자 허용' 여부를 확인하세요."
4. **안내 메시지**: "ℹ️ 1주택 이상 보유자는 APT 일반분양(가점제)·LH 공공분양·특별공급은 원칙적으로 불가합니다. 다만 공고별 예외가 있으므로 원문을 확인하세요."

### 소득 기준 가구원수별 안내

소득 기준 판정 시 가구원 수에 따라 기준이 다름을 반드시 안내한다:

| 가구원 수 | 도시근로자 평균소득 기준 |
|-----------|------------------------|
| 3인 이하 | 월평균 소득의 100% |
| 4인 | 월평균 소득의 110% (일부 120%) |
| 5인 이상 | 월평균 소득의 120% (일부 130%) |

프로필의 `income_bracket`과 `household.children_count` + 배우자 포함 세대원 수를 기반으로 대략적 판정 후, 반드시 아래 경고를 추가:

> ⚠️ 소득 자격은 자동 확인이 불가합니다. 정확한 도시근로자 평균소득 기준(연도별·가구원수별)은 공고 원문에서 확인하세요.

**가구원 수 자동 계산 공식:**
```
본인 1명
+ 배우자 (household.type이 newlywed/married_*인 경우 +1)
+ 자녀 수 (children_count)
+ 태아 (pregnant=true이면 +1)
= 총 가구원 수
```

**정성적 공공분양 통과 판정:**
| income_bracket | 3인 이하 | 4인 | 5인 이상 |
|---------------|---------|-----|---------|
| low / mid_low / mid | ✓ | ✓ | ✓ |
| mid_high (7천~1억) | ✗ | ✓ | ✓ |
| high (1억+) | ✗ | ✗ | ✗ (일부 ✓) |

> ⚠️ 정성 판정입니다. 공고별 실제 기준금액은 가구원수 × 도시근로자 월평균소득으로 계산하세요.

**도시근로자 월평균소득 기준 원화 (2024년 공시 기준, 세전)**

| 가구원수 | 100% (월) | 120% (월) | 140% (월) |
|---------|----------|----------|----------|
| 3인 이하 | 약 6,530,602 | 약 7,836,722 | 약 9,142,843 |
| 4인 | 약 7,620,056 | 약 9,144,067 | 약 10,668,078 |
| 5인 | 약 7,954,359 | 약 9,545,231 | 약 11,136,103 |
| 6인 | 약 8,715,780 | 약 10,458,936 | 약 12,202,092 |

**적용 기준 유형별:**
- 일반공급 (LH 공공분양): 100% 이하 (맞벌이 120%)
- 신혼부부 특별공급: 140% 이하 (맞벌이 160%)
- 생애최초 특별공급: 130% 이하
- 다자녀 특별공급: 120% 이하

연봉(`income_bracket`)을 12로 나눠 월 소득으로 변환 후 위 표와 비교. 예: `mid_high`(7천~1억) → 월 583만~833만 → 4인 이상 가구 기준 100%/120% 통과 가능.

> ⚠️ **2024년 공시 수치이며 2026년 공고에는 갱신된 기준이 적용됩니다.** 실제 당첨 자격은 공고문에 명시된 해당 연도 기준표를 반드시 확인하세요.

### 특별공급 자격 판정

프로필 기반으로 해당하는 특별공급 유형을 안내한다.

| 특별공급 | 판정 로직 | 추가 안내 |
|----------|-----------|-----------|
| **신혼부부** | `marriage_date` 존재 + 혼인 7년 이내 계산 + 무주택 + 소득 기준 | ⚠️ 혼인신고일 기준. 예혼·사실혼은 별도 확인 필요 |
| **생애최초** | 무주택 + 소득 기준 + `previous_win` = "없음" + **청약통장 보유 + 가입기간 ≥ 2년** | ⚠️ 5년 이상 소득세 납부 여부는 자동 확인 불가. 통장 미보유/2년 미만이면 자격 없음 |
| **다자녀** | (`children_count` + `pregnant`) >= 2 + 무주택 | 미성년 자녀 기준. `pregnant=true`면 태아 1명 가산 |
| **한부모(기관추천)** | `household.type` = `single_parent` + 무주택 | ⚠️ 한부모가족지원법 보호 대상 증명 필요. 증빙은 공고문 확인 |
| **노부모 부양** | `age` >= 25 | ⚠️ 만 65세 이상 직계존속 3년 이상 부양 요건은 프로필로 확인 불가 |
| **기관 추천 (기타)** | 해당 여부 확인 불가 | 국가유공자, 장애인, 이주민 등 해당 시 공고문 확인 |

특별공급 자격 판정 후 반드시:
> ⚠️ 특별공급 자격은 추정입니다. 세부 요건(증빙서류, 소득세 납부 이력, 자산 기준 등)은 공고문에서 확인하세요.

### 가점제 안내

프로필 기반으로 추정 가점을 계산하여 안내한다.

**가점 산정 기준 (최대 84점):**

| 항목 | 점수 | 프로필 기반 계산 |
|------|------|-----------------|
| 무주택 기간 (최대 32점) | 1년당 2점, 최초 1년 미만 2점 | **만 30세 도달연도 ↔ 혼인신고연도 중 늦은 해부터** 기산. 만 30세 이전 미혼자는 0점, 만 30세 이전 결혼자도 30세 전까지는 0점 |
| 부양가족 수 (최대 35점) | 0명=5점, 1명=10점, 2명=15점 ... 6명+=35점 | `dependents_count` 기반. ⚠️ **직계존속(부모·조부모)은 3년 이상 동일 세대 등록된 경우에만 인정**되며, 자동 확인 불가 — 공고문 확인 필수 |
| 통장 가입기간 (최대 17점) | 6개월당 1점 | `subscription_account.years` × 2 (최대 15년+=17점). ⚠️ **만 19세 미만 가입분은 최대 2년만 인정** — 미성년자 가입자는 전체 기간에서 차감 |

**가점 안내 메시지 예시:**
```
📊 추정 가점: 약 47점 / 84점
  - 무주택 기간: 약 22점 (만 41세, 11년 추정)
  - 부양가족: 15점 (2명)
  - 통장 가입기간: 10점 (5년)
ℹ️ 실제 가점은 청약홈에서 정확히 조회 가능합니다.
```

### 가점대별 현실 전략

**적용 시점**: "내 가점", "가점 계산", "맞춤 추천" 등을 명시 요청했을 때만. 기본 간결 응답에는 포함하지 않는다.

추정 가점에 따라 **현실적 전략 메시지**를 함께 출력한다.

| 추정 가점 | 전략 메시지 |
|----------|------------|
| **0~20점** | "⚠️ 가점이 낮아 수도권 APT 가점제 당첨은 현실적으로 어렵습니다. **오피스텔·잔여세대·임의공급**(무순위/선착순), 지방 중소도시 APT, **특별공급**(신혼·생애최초·다자녀)이 더 유리합니다." |
| **20~40점** | "ℹ️ 지방 중소도시 APT 가점제는 가능권. 수도권은 **추첨제 비중 높은 85m² 초과 대형** 타입이나 **특별공급**을 노리세요." |
| **40~60점** | "✅ 수도권 일반 지역 APT 가점제 당첨 가능권. 서울·1군 브랜드·주요 입지는 여전히 어려울 수 있습니다." |
| **60~75점** | "🎯 수도권 주요 입지도 도전 가능. 투기과열지구 가점 커트라인(보통 60~70점) 근처입니다." |
| **75점+** | "🏆 서울 강남·서초 등 최상위 입지도 가능. 가점제 경쟁에서 상위권입니다." |

이 메시지는 프로필이 있고 APT 일반분양이 Top 3에 포함된 경우에 반드시 포함한다.

**가점 관련 추가 안내:**
- 투기과열지구 공고: "이 단지는 투기과열지구로 가점제 비율이 높습니다 (85m² 이하 100%)"
- 분양가상한제 공고: "분양가상한제 적용 → 시세보다 저렴하지만 거주의무기간(2~5년)이 있습니다"
- 가점이 낮은 사용자: "가점이 낮다면 추첨제 비율이 높은 85m² 초과 타입이나 오피스텔을 노려보세요"

### 당첨 가능성 판정

**적용 시점**: 사용자가 "당첨 가능성", "내가 될 가능성", "경쟁률" 등을 명시 요청할 때만. 기본 응답에는 포함하지 않는다.

각 공고에 대해 프로필 + 공고 정보를 조합하여 **정성적 당첨 가능성**을 판정한다.

**판정 기준:**

| 요소 | 데이터 출처 | 판정 로직 |
|------|-----------|-----------|
| 투기과열지구 | `speculative_zone` | "Y"이면 가점제 100% → 가점 낮으면 "낮음" |
| 평형 (가점/추첨) | `size` | 85m² 이하=가점 우선, 초과=추첨 비중 높음 |
| 세대수 | `total_units` | 500세대+ = 물량 많아 경쟁 분산 |
| 내 가점 | 프로필 기반 | 추정 가점과 지역 평균 비교 |
| 1군 건설사 | `constructor` | 1군이면 경쟁 치열 → 가점 커트라인 상승 |

**판정 결과 (공고별 표시):**

```
🟢 당첨 가능성 높음
  - 비투기과열지구 + 추첨제 비율 높음 (85m²+)
  - 또는 내 가점이 지역 평균 이상 + 대단지

🟡 당첨 가능성 보통
  - 가점제 비율 높지만 내 가점이 지역 평균 근처
  - 또는 1군 건설사이지만 비수도권

🔴 당첨 가능성 낮음
  - 투기과열지구 + 가점제 100% + 내 가점 낮음
  - 또는 수도권 + 1군 건설사 + 소형 (경쟁 치열)

⚪ 판정 불가
  - 프로필 없음, 또는 가점 불필요 유형 (오피스텔, 잔여세대, 임의공급)
```

가점 불필요 유형(오피스텔, 잔여세대, 임의공급)은 판정 대신:
- "추첨/선착순 — 가점 무관, 누구나 동일 확률"

**지역별 참고 가점 범위 (경험적 가이드라인):**

| 지역 | 소형(~60m²) | 중형(60~85m²) | 대형(85m²+) |
|------|-------------|--------------|-------------|
| 서울 | 55~70점 | 50~65점 | 추첨 위주 |
| 경기 (과천/판교 등) | 50~65점 | 45~60점 | 추첨 위주 |
| 경기 (기타) | 35~50점 | 30~45점 | 추첨 위주 |
| 인천 | 30~45점 | 25~40점 | 추첨 위주 |
| 부산/대구/광주 | 25~40점 | 20~35점 | 추첨 위주 |
| 기타 지방 | 15~30점 | 10~25점 | 추첨 위주 |

> ⚠️ 위 가점 범위는 경험적 참고치입니다. 실제 커트라인은 공고마다 크게 다를 수 있습니다.

---

## D-day 접수 마감 알림

프록시 API가 각 공고에 `d_day`(마감까지 남은 일수)와 `d_day_label`(표시 문자열)을 자동 포함한다.

| d_day | d_day_label | 의미 |
|-------|------------|------|
| 음수 | "마감" | 이미 마감된 공고 |
| 0 | "D-Day (오늘 마감)" | 오늘이 마감일 |
| 1~3 | "D-1" ~ "D-3" | 마감 임박 |
| 4+ | "D-N" | 여유 있음 |

**결과 출력 시:**
- D-day 기준 정렬 (마감 임박순)
- 🔴 D-1 이하: 긴급 표시
- 🟡 D-2~3: 주의 표시
- 🟢 D-4+: 일반 표시
- "마감": 목록에서 제외 (active_only=true 기본)

**예상 일정 안내 (공고 하단에 포함):**
```
📌 참고 일정 (일반적 기준):
- 특별공급 접수 → 다음 날 1순위 → 그 다음 날 2순위
- 당첨자 발표: 접수 마감 후 약 7~10일
- 계약: 당첨자 발표 후 약 1~2주 내
- 입주: 공고문에 명시된 입주 예정 시기 확인
```

---

## 즐겨찾기 공고 관리

관심 공고를 로컬에 저장하여 변동 추적·중복 조회 방지에 활용한다.

### 저장 위치
`~/.config/k-skill/favorites.json`

### 파일 포맷
```json
{
  "ids": ["2026000123", "2026000456"],
  "added_at": {
    "2026000123": "2026-04-17",
    "2026000456": "2026-04-20"
  },
  "notes": {
    "2026000123": "신혼부부 특공 관심"
  }
}
```

### 명령 워크플로우

| 트리거 | 동작 |
|--------|------|
| "즐겨찾기에 추가", `fav add <ID>` | `ids`에 추가, `added_at` 오늘 날짜 저장 |
| "즐겨찾기 목록", `fav list` | 저장된 모든 공고 → 프록시에서 현재 상태 조회 → D-day·마감 여부 갱신 |
| "즐겨찾기 제거", `fav remove <ID>` | `ids`에서 제거 |
| "관심 공고 변동 체크", `fav diff` | 저장된 ID 중 마감 임박/마감/당첨발표 등 상태 변동 공고 하이라이트 |

구현 힌트: `fav list`는 `GET /functions/v1/announcements?category=all&active_only=false` 호출 후 `ids`와 교집합.

---

## 중복 알림 방지

같은 공고를 여러 번 발송하지 않도록 로컬에서 발송 이력을 관리한다.

### 저장 위치
`~/.config/k-skill/notified.json`

### 파일 포맷
```json
{
  "2026000123": "2026-04-17",
  "2026000456": "2026-04-15"
}
```
키 = 공고 ID, 값 = 마지막 발송 날짜 (YYYY-MM-DD)

### 발송 전 체크 로직
1. 발송 대상 공고 목록 구성
2. `notified.json` 로드
3. 각 공고에 대해:
   - `notified.json`에 해당 ID가 있고, 발송일 기준 **7일 이내**면 제외
   - 단, `d_day == 0`(D-Day) 공고는 재발송 허용 (긴급)
4. 필터링된 목록을 발송, 발송 성공 공고는 `notified.json` 갱신

### 프록시 엔드포인트 연동
프록시의 `exclude_ids` 파라미터에 7일 이내 발송 완료된 ID 목록을 넘기면 서버 사이드에서도 사전 제외 가능:
```
POST /functions/v1/notify?...&exclude_ids=2026000123,2026000456
```

---

## 자동 조회 및 알림 설정

> ⚠️ **기본 동작은 1회성입니다.** `/korea-apt-alert 알림 보내줘`는 그 시점에 **한 번만** Slack/Telegram으로 발송합니다. 매일 자동 발송하려면 아래 3가지 방법 중 하나를 별도 설정해야 합니다.

### 자동화가 필요한 경우 vs 필요 없는 경우

| 상황 | 권장 방법 |
|------|----------|
| 가끔 생각날 때마다 조회·알림 | 매번 `/korea-apt-alert 알림 보내줘` (자동화 불필요) |
| 매일 아침 체크하고 싶음 | **방법 2 (GitHub Actions)** — 가장 견고 |
| Claude Code 세션 항상 열어두는 편 | **방법 1 (/loop)** — 간단하지만 세션 꺼지면 중단 |
| 로컬 PC 항상 켜둠 | **방법 3 (cron / Task Scheduler)** — 로컬 스케줄러 |

사용자가 "매일", "자동", "정기", "스케줄" 등을 언급하면 위 선택지 표를 먼저 보여주고 어떤 방법 원하는지 확인한다.

### 방법 1: Claude Code `/loop` (세션 내 반복)

Claude Code 터미널에서:
```
/loop 24h /korea-apt-alert 내 조건에 맞는 청약 알림 보내줘
```
매 24시간마다 자동 조회 + Slack/Telegram 발송. Claude Code 세션이 열려 있어야 동작.

### 방법 2: 프록시 서버 자동 알림 API (세션 불필요)

프록시 서버의 `/functions/v1/notify` 엔드포인트를 외부 스케줄러에서 호출:

```bash
# cron, GitHub Actions, n8n 등에서 매일 아침 호출
curl -X POST "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notify?webhook_url=https://hooks.slack.com/services/T.../B.../xxx&region=서울,경기,인천&active_only=true"
```

**GitHub Actions 예시** (`.github/workflows/apt-notify.yml`):
```yaml
name: Daily Apt Alert
on:
  schedule:
    - cron: '0 22 * * *'  # 매일 오전 7시 (KST)
  workflow_dispatch:
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send notification
        run: |
          curl -X POST "${{ secrets.PROXY_URL }}/functions/v1/notify?webhook_url=${{ secrets.SLACK_WEBHOOK }}&region=서울,경기,인천&active_only=true"
```

**파라미터:**
| 파라미터 | 설명 |
|---------|------|
| `webhook_url` | Slack Incoming Webhook URL (Slack 발송 시) |
| `telegram_token` | Telegram Bot Token (Telegram 발송 시) |
| `telegram_chat_id` | Telegram Chat ID (Telegram 발송 시, token과 세트) |
| `category` | 카테고리 필터 (기본: all, 8종: apt/officetell/lh/remndr/pbl_pvt_rent/opt/sh/gh) |
| `region` | 지역 필터 (쉼표 구분) |
| `district` | 세부 지역 필터 (쉼표 구분) |
| `active_only` | 접수 중인 공고만 (기본: true) |
| `min_units` | 최소 세대수 (대단지만 필터, 기본 0) |
| `constructor_contains` | 시공사 키워드 필터 (쉼표 구분) |
| `exclude_ids` | 제외할 공고 ID (중복 알림 방지) |
| `reminder` | 리마인더 타입: `d3` / `d1` / `winners` / `contract` |

**채널 선택:**
- `webhook_url` 단독 → Slack만
- `telegram_token` + `telegram_chat_id` 단독 → Telegram만
- 셋 다 제공 → **양쪽 채널 동시 발송**
- 아무것도 없으면 `400 Bad Request`

응답 예:
```json
{"sent": 5, "channels": ["slack", "telegram"], "errors": null, "message": "Sent to slack, telegram"}
```
한쪽 실패 시 `errors`에 사유 기록되고 성공한 채널만 `channels`에 남음.

D-day 기준 마감 임박순 정렬, 최대 10건 발송. D-1 이하는 🔴, D-3 이하는 🟡 표시.

### 방법 3: 로컬 스케줄러 (cron / Task Scheduler)

로컬 PC에서 주기적으로 프록시 notify 엔드포인트를 호출.

**macOS / Linux (cron)** — `crontab -e`에 추가:
```
0 7 * * * curl -sS --max-time 60 -X POST "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notify?webhook_url=$(grep ^KSKILL_APT_SLACK_WEBHOOK= ~/.config/k-skill/secrets.env | cut -d= -f2-)&region=서울,경기,인천&reminder=d3" >> ~/.config/k-skill/apt-alert.log 2>&1
```

**Windows Task Scheduler**:
1. 작업 스케줄러 → 기본 작업 만들기
2. 트리거: 매일 오전 7시
3. 동작: `powershell.exe -Command "Invoke-RestMethod -Uri 'https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notify?webhook_url=...&region=...&reminder=d3' -Method Post"`

PC 꺼진 시간엔 발송 안 됨. 항상 돌아가는 환경 필요.

### 리마인더 타입별 활용

| `reminder` | 의미 | 추천 cron |
|-----------|------|-----------|
| `d3` | 마감 D-3 이하 임박 공고 | 매일 오전 7시 |
| `d1` | 마감 D-1 이하 초긴급 공고 | 매일 오전·오후 2회 |
| `winners` | 접수 마감 후 7~10일 (당첨자 발표 예정) | 매일 오후 6시 |
| `contract` | 접수 마감 후 14~21일 (계약 체결 예정) | 주 1회 |

예시: 매일 오전 7시 D-3 임박 공고 알림
```
curl -X POST ".../functions/v1/notify?webhook_url=...&region=서울&reminder=d3"
```

---

## 모집공고 해석자 (Phase 1)

룰 기반으로는 영원히 못 하는 영역 — 30~150쪽짜리 모집공고문에서 **사용자 프로필 맥락으로** "내가 신청 가능한지", "재당첨 제한 걸리는지", "유의사항 중 나한테 해당되는 것" 같은 자유 서술 질문에 답한다. 프록시는 텍스트만 추출, 해석은 LLM(이 스킬)이 직접.

### 트리거

| 사용자 말 | 동작 |
|----------|------|
| "이 공고 분석/해석/요약해줘" + 공고명·번호·URL | 단일 공고 raw 호출 + 프로필 맥락으로 LLM 요약 |
| "Top 1 자세히", "방금 첫 번째 깊게" | 직전 announcements 응답의 1번 공고 분석 |
| "{공고명} 분석" | 캐시 또는 ?url= 폴백으로 분석 |

### 워크플로우

**1단계: 공고 식별**
- 사용자가 URL 줬으면 → 그대로 사용
- 공고명·지역·번호면 → 직전 announcements 응답에서 `id` 매칭
- 모호하면 → 후보 2~3개 제시 후 사용자에게 선택 요청

**2단계: notice raw 호출**
```bash
# id 우선 (캐시 매칭 시 url 자동 해석)
curl -s --max-time 60 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notice/raw?id=2026000123"

# id 캐시 매칭 실패하면 (404 응답 시) url 폴백
curl -s --max-time 60 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notice/raw?id=2026000123&url=https%3A%2F%2Fwww.applyhome.co.kr%2F..."

# 정정공고 등 캐시 무효화 (TTL 7일)
curl -s --max-time 60 "https://.../notice/raw?id=...&force_refresh=true"
```

**파라미터**
- `id` (필수, path) — `apt_2026000123`, `lh_...` 등 공고 ID
- `url` (옵셔널, query) — id 캐시 매칭 실패 시 폴백. 직전 announcements 응답의 `url` 필드
- `max_chars` (옵셔널, 기본 30000) — 무료 30K cap, 유료 50~80K (Phase 1은 무료 강제)
- `force_refresh` (옵셔널, 기본 false) — 캐시 무시
- `tier` (옵셔널, 기본 free) — Phase 1은 무료 강제, Phase 2부터 활성

**응답 스키마**
```json
{
  "id": "2026000123",
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
  "text": "전체 클린업된 텍스트...",
  "tier": "free",
  "effective_max_chars": 30000,
  "tier_capped": false
}
```

**3단계: 프로필 로드** — `~/.config/k-skill/apt-alert-profile.json`

**4단계: LLM 요약 (이 스킬이 직접)** — 아래 출력 템플릿 사용

### 출력 템플릿 (간결 모드 — 기본)

```
📑 [공고명] — 분석 요약
👤 프로필: 만 31세 / 무주택 / 통장 5년 / 신혼부부

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

🔗 [원문 →](url) · 더 깊게: "유의사항 전부" / "비교: 다른 공고"
```

**원칙**
- 프로필이 없으면 위 "✅ 너에게 해당" 섹션은 생략, "⚠️ 주의" 대신 "📌 핵심 조건"으로 일반 요약
- 텍스트가 `truncated: true`면 마지막에 "(원문 일부만 분석. 더 보려면 'force_refresh' 또는 원문 직접 확인)" 추가
- `effective_max_chars`가 `max_chars` 요청보다 작으면 ("free 티어 cap 적용") 한 줄 표시

### 상세 모드 ("유의사항 전부", "원문 보여줘" 요청 시)

raw 응답의 `sections` 필드 또는 `text`를 섹션별로 **그대로** 페이지네이션 출력. 요약·해석 추가 금지 (사용자가 원문을 원함).

### 페일/폴백

| 상황 | 응답 코드 | 대응 |
|------|----------|------|
| id 캐시 매칭 실패 + url 미제공 | 404 | "공고 ID를 캐시에서 못 찾았습니다. 직전 공고 조회를 다시 해주세요." (선행 announcements 호출 후 재시도) |
| 호스트 미지원 (sh/gh/외부) | 400 | "Phase 1은 청약홈/LH만 지원합니다. SH/GH는 Phase 2 예정." |
| 추출 실패 (502) | 502 | "공고 페이지 로딩 실패 — 5분 후 재시도하거나 `?force_refresh=true` 추가" |
| 일일 한도 초과 (429) | 429 | "오늘 무료 분석 한도 1000건 초과. 내일 다시 시도해주세요." |

### 보안·프라이버시

- 프로필은 LLM 컨텍스트에만 — 프록시로 절대 전송 X (announcements와 동일 원칙)
- raw 응답에 개인정보 없음 (공개 모집공고문)

### Phase 2 이후 (참고)

- PDF 첨부 추출, SH/GH 어댑터
- "사전 알리미"와 결합 — 발표 즉시 자동 raw + 요약 → Slack 발송
- "공고 비교" 모드 — 2개 raw 받아 차이점 요약 (분양가·자격·일정)

---

## 서버 프로필 + 추천 (Phase 2 — 인증 필요)

청약 코파일럿 모바일 앱과 같은 백엔드(`user_profiles` 테이블 + `/v1/profile` + `/v1/recommendations`)를 SKILL에서도 사용할 수 있다. **인증 토큰이 있을 때만 동작**하므로 옵셔널 워크플로우.

### 인증 토큰 발급

1. 청약 코파일럿 앱에서 로그인 (이메일 매직링크 / Google OAuth / Kakao OAuth)
2. 마이페이지에서 "CLI 토큰" 발급 (Phase 2 후속 — 미구현 시 직접 Supabase Auth `access_token` 사용)
3. 환경변수 또는 `~/.config/k-skill/auth.json`에 저장:
   ```bash
   # 옵션 A — env var
   export KAPT_AUTH_TOKEN="eyJhbGc..."

   # 옵션 B — config file (chmod 600)
   echo '{"token":"eyJhbGc..."}' > ~/.config/k-skill/auth.json
   chmod 600 ~/.config/k-skill/auth.json
   ```
4. SKILL은 매 호출 전 토큰 존재 확인 — 없으면 "로그인 필요" 안내 후 로컬 폴백

### 트리거 1 — "내 추천" / "맞춤 공고"

**동작**:
1. 토큰 확인 (없으면 → 기존 announcements 호출 + 로컬 프로필 매칭으로 폴백)
2. recommendations API 호출:
   ```bash
   curl -s --max-time 30 \
     -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
     "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/recommendations?limit=3"
   ```
3. 응답 파싱 — 각 항목의 `match_score` + `match_reasons` 사용

**응답 구조**:
```json
{
  "recommendations": [
    { "announcement": {...}, "match_score": 75, "match_reasons": ["선호지역(서울) 일치", "선호평형(84㎡대) 일치", "..."] }
  ],
  "match_fields_used": { "regions": [...], "preferred_size_sqm": 84, "is_homeless": true, "interests": [...] },
  "total_active": 124,
  "generated_at": "..."
}
```

**출력 템플릿** (간결 모드):
```
📋 서버 프로필 기반 추천 (Top 3)

1. **OO지구 OO블록** (서울 서초구) — 점수 75/85
   📅 D-5 · 🏗️ 350세대 · 민영
   ✅ 선호지역(서울) 일치 · 선호평형(84㎡대) · 1순위 자격 · 1군 시공사
   🔗 [청약홈 →](url)

2. ...

3. ...

⏱️ {N}분 전 갱신 · 💡 더 깊게: "1번 분석" / "프로필 동기화"
```

**404 응답 시** (`profile not found or empty`): "서버에 프로필 없음 — '프로필 동기화' 먼저 실행해주세요." 안내.

### 트리거 2 — "프로필 동기화" / "내 프로필 업로드"

**동작**:
1. 토큰 확인 (없으면 → "로그인 필요" 안내)
2. 로컬 프로필 로드: `~/.config/k-skill/apt-alert-profile.json`
3. 로컬 형식 → user_profiles JSONB 형식 매핑:
   - `age` → `birth_date` (역산: 올해 - age)
   - `homeless_years` → `homeless_since` (역산)
   - `account_balance` (원) → `savings_balance_wan` (만원, /10000)
   - `preferred_regions[]` → `preferred_regions[]` (그대로)
   - `special_supply_interests[]` → `special_supply_interests[]` (그대로)
4. PATCH 호출:
   ```bash
   curl -s --max-time 30 \
     -X PATCH \
     -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"birth_date":"1991-04-26","preferred_regions":["서울","경기"],"savings_balance_wan":660,"special_supply_interests":["신혼부부"]}' \
     "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/profile"
   ```
5. 성공 응답의 `derived` 필드 (age, homeless_years 등) 표시 — 사용자에게 서버가 어떻게 해석했는지 확인

**출력**:
```
✅ 프로필 동기화 완료 (서버 user_profiles 업데이트)

📤 업로드한 필드: birth_date, preferred_regions, savings_balance_wan, special_supply_interests
🧮 서버 derived: 만 34세 · 무주택 7년 · 예치금 6,600,000원
🔔 다음 cron 실행 시 (매일 06시) D-day 알림 자동 생성됨

💡 다음: "내 추천" / "내 가점" (가점 계산은 my-score API)
```

### 트리거 3 — 인앱 알림 조회 (옵셔널)

`"내 알림"` / `"인앱 알림"` 입력 시:
```bash
curl -s --max-time 15 \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notifications?unread_only=true&limit=10"
```
응답의 `unread_count` + `notifications[]`을 그대로 표시. 사용자가 특정 항목 클릭 의도면:
```bash
curl -X PATCH -H "Authorization: ..." ".../notifications/{id}/read"
```

### 트리거 4 — 알림 즉시 새로고침

cron(매일 KST 06/08시)을 기다리지 않고 사용자가 본인 프로필 매칭을 즉시 실행. `"알림 새로고침"` / `"내 알림 갱신"` / `"지금 알림 받기"` 입력 시:

```bash
# 모드 1: D-day ≤3 임박 공고 매칭
curl -s --max-time 30 -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/notifications/refresh?mode=dday_alert"

# 모드 2: 최근 24h 신규 공고 매칭
curl -s --max-time 30 -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/notifications/refresh?mode=announcement_new"
```

응답:
```json
{
  "mode": "dday_alert",
  "user_id": "uuid",
  "scanned_announcements": 12,
  "scanned_users": 1,
  "notifications_created": 3,
  "skipped_duplicates": 2,
  "fcm_sent": 0
}
```

24h 내 같은 (type × announcement) 알림이 이미 있으면 `skipped_duplicates`로 카운트 (중복 알림 방지).

**출력 템플릿**:
```
🔔 알림 새로고침 완료

📊 결과: 신규 3건 / 중복 스킵 2건 (D-day ≤3 임박 공고 12건 스캔)

💡 받은 알림 보려면: "내 알림"
```

### 트리거 5 — 수동 알림 추가

특정 공고를 즐겨찾기로 표시하거나 메모성 알림을 본인에게 직접 등록. `"이 공고 알림 등록"` / `"알림에 추가"` / `"메모 알림"` 입력 시:

```bash
curl -s --max-time 15 -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "favorite_dday",
    "title": "[D-2] 래미안 원펜타스",
    "body": "서울 서초구 · 민영 · 350세대 — 즐겨찾기 마감 임박",
    "link": "/app/notice/apt_2026000123",
    "related_announcement_id": "apt_2026000123"
  }' \
  ".../functions/v1/notifications"
```

**type 화이트리스트** (서버 검증):
- `user_memo` — 사용자 메모 알림
- `favorite_dday` — 즐겨찾기 공고 D-day
- `test` — 테스트

**제한**: title 최대 200자, body 최대 1000자. 인증된 본인 user_id로만 INSERT 가능 (RLS).

**출력**:
```
✅ 알림 등록 완료 (type: favorite_dday)

🔔 다음 "내 알림" 조회 시 표시됨
```

### 보안·프라이버시

- 토큰은 `~/.config/k-skill/auth.json` (chmod 600) 또는 env var에만 저장 — 절대 로그/메시지에 노출 X
- 프로필 동기화는 사용자 명시 트리거 시에만 (자동 동기화 금지)
- 프로필 변경 시 `derived` 필드만 응답에 포함 — 원본 birth_date 등은 서버에만

### 인증 미설정 시 동작

토큰이 없으면 위 3개 트리거 모두 다음과 같이 안내:
```
🔒 서버 프로필 기능은 청약 코파일럿 앱 로그인 토큰이 필요합니다.

로컬 프로필(~/.config/k-skill/apt-alert-profile.json) 기반 매칭으로 대체 진행 가능:
→ '내 조건에 맞는 추천' 입력 시 기존 워크플로우(클라이언트 측 매칭)로 폴백

서버 동기화 원하시면: 청약 코파일럿 앱 → 마이페이지 → CLI 토큰 발급
```

---

## 청약 분석 도구 (서버 기능 통합)

main 백엔드에 운영 중인 **5개 청약 분석 Edge Function**을 SKILL이 호출. 일부는 인증 필수, 일부는 무인증. AI 리포트 저장 워크플로우 포함.

### 도구 1 — 부적격 사전검증 (eligibility-precheck)

`"내 자격 확인"` / `"{공고명} 부적격 위험"` / `"이 공고 신청 가능한가"` 입력 시:

```bash
curl -s --max-time 30 -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "announcement_id": "apt_2026000123",
    "birth_date": "1991-04-26",
    "is_married": true,
    "marriage_date": "2020-03-01",
    "dependents_count": 2,
    "is_homeless": true,
    "homeless_since": "2018-01-01",
    "savings_start": "2020-01-01",
    "savings_balance_wan": 660,
    "resident_region": "서울",
    "has_house": false,
    "parents_registered": false
  }' \
  ".../functions/v1/eligibility-precheck"
```

**응답**: `{ score, warnings: [{field, severity: 'critical'|'warning'|'info', message, detail}] }`

**입력 매핑**: 사용자 프로필(`~/.config/k-skill/apt-alert-profile.json`) → 위 필드. 누락 시 합리적 default 사용.

**출력 템플릿**:
```
🔍 [공고명] — 부적격 사전검증

📊 가점: 54점 (무주택 14점 / 부양가족 15점 / 통장 17점)

⚠️ Critical (신청 차단 위험)
• {field}: {message}
  → {detail}

🟡 Warning (주의)
• {field}: {message}

💡 수정 가능한 부분: 청약통장 가입기간을 X개월 더 채우면 +Y점 가능
```

`critical` 1건이라도 있으면 **신청 비추천** 명시. `warning`은 참고 안내.

### 도구 2 — 청약 시뮬레이션 (simulate)

`"5단계 시뮬레이션"` / `"{공고명} 당첨까지"` 입력 시:

```bash
curl -s --max-time 30 -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "announcement_id": "apt_2026000123",
    "supply_type": "일반공급",
    "user_profile": { ...UserProfile 필드 동일... }
  }' \
  ".../functions/v1/simulate"
```

`supply_type`: `"일반공급"` / `"신혼부부 특별공급"` / `"생애최초 특별공급"` / `"다자녀 특별공급"` / `"노부모부양 특별공급"`

**응답**: 5단계(자격검증 → 청약접수 → 추첨/가점 → 당첨자 발표 → 계약) 각 단계별 통과 가능성 + 필요 서류 + 주의사항.

**출력 템플릿**: 각 단계를 ✅/⚠️/❌ 아이콘과 함께 표시. 막힌 단계가 있으면 빨간색 강조.

### 도구 3 — 공고 비교 (compare)

`"이 두 공고 비교"` / `"{A} vs {B}"` / `"{A}, {B}, {C} 비교"` (2~5개) 입력 시:

```bash
# id는 직전 announcements 응답에서 가져옴
curl -s --max-time 30 \
  ".../functions/v1/compare?ids=apt_2026000123,apt_2026000456"
```

**응답**: 공고별 기본 정보 + price_assessment + location_score + school_zone + commute 캐시 데이터를 한 표로.

**출력 템플릿**:
```
📊 공고 비교 (2건)

| 항목 | 래미안 원펜타스 | OO 자이 |
|------|--------------|---------|
| 지역 | 서울 서초구 | 서울 강동구 |
| 세대수 | 641 | 350 |
| 분상제 | Y | N |
| 분양가 평가 | 적정 (-12% vs 시세) | 고가 (+8%) |
| 입지 점수 | 88 | 72 |
| 학군 (반경 500m) | 우수 | 보통 |
| 통근(강남역) | 12분 | 28분 |

→ **추천**: A (분양가·입지·통근 모두 우수)
```

### 도구 4 — 유사공고 + 경쟁률 예측 (similar-listings)

`"비슷한 공고"` / `"{공고명} 경쟁률"` / `"유사 공고 추천"` 입력 시:

```bash
curl -s --max-time 60 \
  ".../functions/v1/similar-listings?announcement_id=apt_2026000123&max_results=5"
```

**응답**: 유사 공고 목록 + 과거 경쟁률·당첨가점 + Gemini LLM 분석 코멘트.

**출력 템플릿**:
```
🔍 [공고명] 유사 공고 분석

📊 과거 경쟁률 (유사 공고 5건 기반)
• 평균 경쟁률: 24.3:1
• 평균 당첨 가점: 62점
• 본인 가점(54점) 기준: 당첨 확률 약 30~40%

🤖 AI 분석:
{gemini 코멘트}

📋 유사 공고 목록
1. {name} (서울·{date}) — 경쟁률 18:1, 당첨 60점
2. ...
```

### 도구 5 — 가점 트래커 (my-score, 인증 필수)

`"내 가점"` / `"확정 가점 계산"` 입력 시:

```bash
# GET — 저장된 프로필 + 가점 조회
curl -s -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/my-score"

# POST — 프로필 갱신 + 즉시 재계산
curl -s -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ ...UserProfile 필드... }' \
  ".../functions/v1/my-score"
```

**응답**: `{ score: { homeless_years, homeless_score, dependents_score, savings_months, savings_score, total, next_upgrade }, upcoming_alert }`

**출력 템플릿**:
```
📊 청약가점 (확정)

• 무주택 기간 7년 → 16점 (max 32)
• 부양가족 2명 → 15점 (max 35)
• 통장 가입 5년 6개월 → 11점 (max 17)

총 42점 / 84점 (50%)

🔔 35일 후 +2점 예정 (무주택 8년 진입)
```

`next_upgrade.days_until ≤ 35`이면 **upcoming_alert** 안내 표시.

### 도구 6 — AI 리포트 저장 워크플로우

`"이 공고 분석 후 저장"` / `"{공고명} 리포트 저장"` 입력 시 (인증 필수):

**워크플로우** (SKILL이 한 흐름으로 처리):
1. `notice/raw` 호출 → raw 텍스트 추출
2. 사용자 프로필 + raw로 LLM 분석 (이 SKILL 자체)
3. summary_markdown 작성
4. `POST /v1/reports`로 저장:
   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "notice_id": "apt_2026000123",
       "notice_url": "https://www.applyhome.co.kr/...",
       "title": "래미안 원펜타스 분석",
       "summary_markdown": "## 너에게 해당\\n- ...\\n## 주의\\n- ...\\n",
       "raw_excerpt": "{raw 텍스트 일부 5K자 정도}",
       "matched_profile_snapshot": { ...현재 프로필 스냅샷... }
     }' \
     ".../functions/v1/reports"
   ```

**reports 테이블 UPDATE 정책 없음** → 한 번 저장하면 수정 불가 (시점 기록). 다시 저장하면 새 row 생성.

### 도구 7 — AI 리포트 이력 (인증 필수)

`"내 리포트"` / `"분석 이력"` 입력 시:

```bash
curl -s -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/reports?limit=20"
```

**응답** (목록은 본문 제외, 페이로드 절감): `[{id, notice_id, title, match_score, created_at}]`

특정 리포트 상세는:
```bash
curl -s -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/reports/{id}"
```

**출력 템플릿**:
```
📑 내 분석 이력 (12건)

1. 래미안 원펜타스 (2026-04-15) — 매칭 75점
2. OO 자이 (2026-04-12) — 매칭 68점
...

💡 자세히 보려면: "1번 리포트" 또는 ID 직접 입력
```

### 통합 흐름 — 한 사용자 시나리오

```
사용자: "공고 보여줘"
  → announcements API
  → "1. 래미안 원펜타스 ..."

사용자: "1번 부적격 검증"
  → eligibility-precheck — critical 0건, warning 1건
  → "신청 가능"

사용자: "1번 분석 후 저장"
  → notice/raw → LLM 분석 → POST /reports
  → "리포트 저장됨 (id: ...)"

사용자: "비슷한 공고"
  → similar-listings — 경쟁률 예측
  → "본인 가점 기준 당첨 확률 30~40%"

사용자: "1번 vs OO자이"
  → compare — 표로 출력

사용자: "내 리포트"
  → GET /reports — 이력 표시
```

### 인증 필요 여부

| 도구 | 인증 |
|------|------|
| eligibility-precheck | ❌ (body로 프로필 받음) |
| simulate | ❌ |
| compare | ❌ |
| similar-listings | ❌ |
| my-score | ✅ (본인 user_profiles 필요) |
| reports 저장·조회 | ✅ |
| documents (서류함) | ✅ |

인증 토큰 없으면 1~4번은 그대로 사용 가능. 5~7번은 "토큰 필요" 안내.

---

## 서류함 (인증 필요)

청약 신청 시 필요한 서류 (주민등록등본·가족관계증명서·청약통장 가입확인서 등) 메타데이터·파일을 본인 user_id로 격리 보관. Supabase Storage `user-documents` bucket의 `{user_id}/` 폴더에 파일 저장.

### 트리거 1 — `"내 서류함"` / `"내 서류"`

```bash
curl -s --max-time 15 \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/documents"
```

**응답**:
```json
{
  "documents": [
    {
      "id": "uuid",
      "doc_type": "resident_register",
      "doc_type_label_ko": "주민등록등본",
      "description": "최근 3개월 이내 발급분",
      "is_required": true,
      "status": "missing",     // 'missing' | 'ready' | 'expiring' | 'expired'
      "issued_date": null,
      "expires_date": null,
      "validity_months": 3,
      "file_url": null,
      ...
    }
  ],
  "summary": { "total": 5, "required": 5, "ready": 2, "missing": 1, "expiring": 1, "expired": 1 }
}
```

**출력 템플릿** (간결 모드):
```
📁 내 서류함 — 준비 완료 2 / 필수 5

✅ 준비됨
• 가족관계증명서 (발급 2026-04-15, 만료 없음)

⚠️ 갱신 필요 (D-3)
• 청약통장 가입확인서 — 만료 2026-04-29 → "갱신" 트리거

❌ 미등록 (필수)
• 주민등록등본 — "최근 3개월 이내 발급분" → "등록" 트리거

🔗 모바일 앱에서 PDF/이미지 업로드 가능
```

### 트리거 2 — `"서류 등록"` / `"{서류명} 추가"`

```bash
# 1. (옵션) 파일 업로드 URL 발급 — 모바일 앱이 호출, CLI는 file_url 직접 전달 가능
curl -s -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"resident_register.pdf","mime":"application/pdf"}' \
  ".../functions/v1/documents/upload-url"
# → { storage_path, upload_url, token, bucket }

# 2. 파일 업로드 (PUT to upload_url with token)
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/pdf" \
  --data-binary @resident_register.pdf "<upload_url>"

# 3. 메타 row 등록
curl -s -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "doc_type": "resident_register",
    "doc_type_label_ko": "주민등록등본",
    "description": "최근 3개월 이내 발급분",
    "issued_date": "2026-04-20",
    "validity_months": 3,
    "file_url": "https://...signed.url",
    "file_storage_path": "{user_id}/1751234567_resident_register.pdf",
    "file_byte_size": 245678,
    "file_mime": "application/pdf"
  }' \
  ".../functions/v1/documents"
```

**doc_type 화이트리스트** (서버 검증):
- `resident_register` (주민등록등본)
- `family_relation` (가족관계증명서)
- `savings_account` (청약통장 가입확인서)
- `income_proof` (소득증빙)
- `homeless_proof` (무주택증명)
- `marriage_proof` (혼인관계증명)
- `children_proof` (자녀/다자녀)
- `other`

**자동 status 계산** (DB 트리거):
- `file_url` 없음 → `missing`
- 만료일 없음 → `ready`
- 만료일 < 오늘 → `expired`
- 만료일 < 오늘 + 7일 → `expiring`
- 그 외 → `ready`

→ 발급일 + `validity_months`로 만료일 자동 계산. 사용자는 발급일만 입력하면 됨.

### 트리거 3 — `"만료 임박 서류"`

GET 응답을 받아 `summary.expiring + expired` 또는 `documents.filter(d => d.status === 'expiring' || 'expired')`로 표시:
```
⚠️ 갱신 필요한 서류 (3건)

1. 주민등록등본 — 만료 D+0 (오늘) ❌ 즉시 재발급 필요
2. 청약통장 가입확인서 — 만료 D-3
3. 소득증빙 — 만료 D-5

💡 서류 갱신 후 PATCH로 issued_date·file_url 업데이트
```

### 보안·프라이버시

- **파일은 Supabase Storage `user-documents` bucket의 `{user_id}/` 폴더에만** — RLS로 본인만 read/write
- file_url은 signed URL (만료 있음) 또는 비공개 → 다운로드 시 매번 새 signed URL 발급
- 메타 row에서 `file_byte_size 10MB 상한`, `mime 화이트리스트` (PDF/JPEG/PNG/HEIC만)
- doc_type 화이트리스트로 임의 카테고리 차단

### 인증 미설정 시 동작

토큰 없으면 "서류함은 청약 코파일럿 앱 로그인 후 사용 가능합니다. CLI 토큰은 마이페이지에서 발급" 안내.

---

## 준비 체크리스트 (인증 필요, 서류함 자동 연동)

청약 신청까지 단계별 할 일 자동 체크리스트. **서류함(documents)과 자동 연동** — 사용자가 서류 등록하면 체크리스트가 자동 ✅.

### 트리거 1 — `"준비 체크리스트 시작"` / `"{공고명} 준비 시작"`

관심 공고 선택 후 첫 1회. 디폴트 12~15개 항목 자동 생성.

```bash
curl -s --max-time 15 -X POST \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/preparation/init?announcement_id=apt_2026000123&supply_types=신혼부부,생애최초"
```

`supply_types` 미지정 시 `user_profiles.special_supply_interests`에서 자동 추출.

**카테고리 / type 5종**:
- 카테고리: `기본준비` / `서류및결정` / `접수당일`
- type: `자금` / `자격` / `서류` / `결정` / `접수`

**자동 채워지는 항목 예시**:
- 기본준비: 통장 예치금 / 무주택 확인 / 자금 계획 / 인증서 (4개)
- 서류및결정: 등본 / 가족관계 / 통장확인서 / 평형 결정 / 공급유형 결정 (5개)
- 접수당일: 청약홈 접속 / 신청 진행 / 발표 확인 (3개)
- 특공 추가: 신혼부부(혼인증명+7년 확인) / 생애최초(주택소유이력) / 다자녀(자녀증빙) 등

### 트리거 2 — `"내 준비 진행률"` / `"{공고명} 준비"`

```bash
curl -s --max-time 15 \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  ".../functions/v1/preparation?announcement_id=apt_2026000123"
```

**응답** (documents 자동 연동 결과 포함):
```json
{
  "items": [
    {
      "id": "uuid", "category": "서류및결정", "type": "서류",
      "title": "주민등록등본 발급",
      "linked_doc_type": "resident_register",
      "is_done": false,                      // 사용자가 수동 체크 안 함
      "linked_document_status": "ready",     // documents 테이블에 ready 있음
      "auto_done_by_doc": true,              // → 자동 ✅
      "effective_is_done": true              // 화면에서 체크된 것으로 표시
    },
    ...
  ],
  "summary": {
    "total": 14, "done": 6,
    "auto_done": 3,    // documents로 자동 체크된 개수
    "manual_done": 3,  // 사용자 수동 체크 개수
    "pending": 8,
    "percent": 43      // 화면 헤더에 표시
  }
}
```

**출력 템플릿**:
```
✅ 준비 진행률: 43% (6 / 14)

📂 기본 준비 (D-14)
  ✅ 청약 통장 예치금 확인
  ⬜ 자금 계획 수립

📂 서류 및 결정 (D-3)
  ✅ 주민등록등본 발급      [📁 서류함 자동]
  ✅ 가족관계증명서          [📁 서류함 자동]
  ⬜ 평형 결정

📂 접수 당일 (D-day)
  ⬜ 청약홈 접속 (9~17:30)
  ⬜ 신청 완료

💡 [📁 서류함 자동] 표시 항목은 documents에 등록하면 자동 체크됨
```

### 트리거 3 — `"{항목} 체크"` / `"체크 해제"`

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $KAPT_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_done": true}' \
  ".../functions/v1/preparation/{id}/done"
```

자동 ✅ 표시되는 항목(`auto_done_by_doc=true`)을 **수동 ⬜ 처리할 수도 있음** — 단, 다음 GET 호출 시 documents 상태가 ready면 다시 자동 ✅. 사용자 의도 우선시되려면 documents에서 해당 doc_type row 삭제 필요.

### documents 자동 연동 매핑

| 체크리스트 항목 (linked_doc_type) | documents.doc_type | 자동 ✅ 조건 |
|--------------------------------|-------------------|------------|
| 주민등록등본 발급 | `resident_register` | status='ready' |
| 가족관계증명서 발급 | `family_relation` | status='ready' |
| 청약통장 가입확인서 발급 | `savings_account` | status='ready' |
| 혼인관계증명서 (신혼부부) | `marriage_proof` | status='ready' |
| 자녀 증빙 (다자녀) | `children_proof` | status='ready' |
| 주택 소유 이력 없음 (생애최초) | `homeless_proof` | status='ready' |

→ 사용자가 한 번 서류 등록하면 모든 공고의 체크리스트에 자동 반영 (재사용).

### 인증 미설정 시 동작

토큰 없으면 "체크리스트는 청약 코파일럿 앱 로그인 후 사용 가능" 안내.

---

## 공고 변경 내역 (정정공고 추적, 인증 불필요)

청약 공고는 자주 정정됨 (접수 마감 연장 / 세대수 변경 / 일정 보강). 백엔드가 `announcements` UPDATE 시 **DB 트리거로 자동 diff 감지** → `announcement_changes` 테이블에 기록. 크롤러 코드 변경 0.

### 트리거 1 — `"{공고명} 변경 내역"` / `"정정공고 확인"`

```bash
curl -s --max-time 15 \
  ".../functions/v1/announcement-changes?announcement_id=apt_2026000123&limit=50"
```

**응답**:
```json
{
  "announcement_id": "apt_2026000123",
  "announcement": { "name": "OO지구 OO블록", "region": "서울", ... },
  "has_changes": true,
  "total_changes": 5,
  "revision_count": 2,             // 정정공고 횟수 (그룹 수, 5초 윈도우 클러스터링)
  "last_changed_at": "2026-04-26T14:30:00Z",
  "groups": [
    {
      "detected_at": "2026-04-26T14:30:00Z",
      "changes": [
        {
          "field": "rcept_end",
          "field_label_ko": "접수 마감일",
          "change_type": "updated",
          "old_value": "20260420",
          "new_value": "20260425"
        },
        ...
      ]
    },
    { "detected_at": "2026-04-25T...", "changes": [...] }
  ],
  "flat": [...]
}
```

**추적되는 필드 9종**:
- 일정: `rcept_end` / `rcept_bgn` / `winner_date` / `contract_start` / `contract_end` / `notice_date`
- 메타: `total_units` / `house_type` / `url`

→ name·region·district·address 같은 식별 필드는 추적 안 함 (노이즈 방지).

**출력 템플릿**:
```
📑 [공고명] — 정정공고 2회

📅 2026-04-26 14:30 (1차)
  ✏️ 접수 마감일: 20260420 → 20260425 (5일 연장)
  ✏️ 총 세대수: 641 → 645 (특공 4세대 추가)

📅 2026-04-25 09:15 (최초 정정)
  ➕ 계약 시작일: (없음) → 20260511

🔗 [원문 →](url)
```

### 트리거 2 — `"최근 정정공고"` / `"오늘 바뀐 공고"`

전체 공고 중 최근 변경:
```bash
curl -s ".../functions/v1/announcement-changes/recent?limit=50&since_hours=24"
```

운영자/대시보드용 — 일반 사용자는 본인 매칭 공고 변경만 알림으로 받게 됨 (notify-cron의 후속 PR로 mode='change_alert' 추가 예정).

### 자동 감지 동작

```
crawl-* (10분 간격) → announcements UPSERT
  ↓
trg_announcements_detect_diff (AFTER UPDATE 트리거)
  ↓ OLD vs NEW 9개 필드 비교
  ↓ IS DISTINCT FROM 결과 발견
  ↓
announcement_changes INSERT (자동)
```

→ 크롤러 코드 변경 0. 정정공고가 들어오면 즉시 기록됨.

### 후속 통합 (별도 PR)

- `_shared/notify-match.ts`에 mode='change_alert' 추가 — 변경 발생 시 매칭/즐겨찾기 사용자에게 알림
- 즐겨찾기 도메인 (favorites) 신규 — 사용자가 관심 공고 추적

---

## 사전 조건

### 필수

없음. 프록시 서버가 공공데이터포털 API 키를 관리하므로 사용자는 별도 키가 불필요하다.

### 선택 (알림 기능)

Slack 또는 Telegram으로 알림을 받으려면 `~/.config/k-skill/secrets.env`에 설정:

```
KSKILL_APT_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../xxx
KSKILL_APT_TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
KSKILL_APT_TELEGRAM_CHAT_ID=-1001234567890
```

### 웹훅·토큰 자동 저장 (필수 규칙)

사용자가 채팅창에 Slack Webhook URL 또는 Telegram Bot Token/Chat ID를 그대로 붙여넣으면 Claude는 **무조건 자동 감지하여 secrets.env에 저장**한다. "직접 파일에 넣으세요" 같은 수동 안내는 **금지**.

**패턴 감지 (최우선 적용):**
| 패턴 | 저장 키 | 후속 동작 |
|------|--------|----------|
| `https://hooks.slack.com/services/...` | `KSKILL_APT_SLACK_WEBHOOK` | 확인 후 저장 종료 |
| `\d{8,10}:[A-Za-z0-9_-]{30,}` (Bot Token 형식) | `KSKILL_APT_TELEGRAM_TOKEN` | **즉시 chat_id 추가 질문** |
| `-100\d{10}` 또는 단독 숫자 ID | `KSKILL_APT_TELEGRAM_CHAT_ID` | 확인 후 저장 종료 |

**동작 순서 (모든 패턴 공통):**
1. 패턴 감지 → 어떤 종류인지 한 줄로 알림: `Slack Webhook 감지` / `Telegram Bot Token 감지` / `Telegram Chat ID 감지`
2. 확인 질문: "이걸 `~/.config/k-skill/secrets.env`에 저장할까요? (yes/no)"
3. yes → 기존 `secrets.env`의 **해당 키만** 덮어쓰기 (다른 키 보존), 없으면 새로 생성
4. 저장 후 `chmod 600` 자동 실행 (Unix 계열, Windows는 스킵)
5. 저장 완료 메시지 + **후속 동작 유도**:
   - Slack → "✅ 저장 완료. 이제 '알림 보내줘'로 Slack 발송 가능합니다."
   - Telegram Bot Token → "✅ 토큰 저장됨. 이제 **Chat ID도 알려주세요** (예: `-1001234567890`, 숫자 그대로 붙여넣기 OK)"
   - Telegram Chat ID → "✅ Chat ID 저장됨. Token도 저장돼 있다면 '알림 보내줘'로 Telegram 발송 가능합니다."

**자동 저장 예시 (Bash):**
```bash
# 기존 라인 제거 후 새 값 추가 (key-safe)
save_secret() {
  local KEY="$1"
  local VAL="$2"
  local FILE="$HOME/.config/k-skill/secrets.env"
  mkdir -p "$(dirname "$FILE")"
  touch "$FILE"
  grep -v "^${KEY}=" "$FILE" > "$FILE.tmp" 2>/dev/null && mv "$FILE.tmp" "$FILE" || true
  echo "${KEY}=${VAL}" >> "$FILE"
  chmod 600 "$FILE" 2>/dev/null || true
}

# Slack
save_secret "KSKILL_APT_SLACK_WEBHOOK" "https://hooks.slack.com/services/T.../B.../xxx"

# Telegram (2개 키 세트)
save_secret "KSKILL_APT_TELEGRAM_TOKEN" "123456789:ABCdef..."
save_secret "KSKILL_APT_TELEGRAM_CHAT_ID" "-1001234567890"
```

**Windows PowerShell 등가 명령:**
```powershell
$FILE = "$env:USERPROFILE\.config\k-skill\secrets.env"
New-Item -ItemType Directory -Force -Path (Split-Path $FILE) | Out-Null
if (!(Test-Path $FILE)) { New-Item -ItemType File -Path $FILE | Out-Null }
(Get-Content $FILE | Where-Object { $_ -notmatch "^KSKILL_APT_SLACK_WEBHOOK=" }) + "KSKILL_APT_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../xxx" | Set-Content $FILE
```

**금지 사항:**
- 사용자가 직접 파일 편집하라고 안내하는 것 (❌ "secrets.env를 수동으로 편집하세요")
- 패턴 감지했는데 저장하지 않고 설명만 하는 것
- Chat ID 없이 Telegram Token만 저장하고 끝내기 (반드시 이어서 chat_id 요청)

## 조회 가능한 카테고리

| ID | 이름 | 설명 | 데이터 소스 |
|---|---|---|---|
| `apt` | APT 일반분양 | 아파트 일반분양 (월 25일 배치 업데이트) | 공공데이터포털 |
| `officetell` | 오피스텔/도시형 | 오피스텔, 도시형생활주택, 민간임대 (실시간) | 공공데이터포털 |
| `lh` | LH 공공분양 | 뉴홈, 행복주택 등 공공주택 (실시간) | 공공데이터포털 |
| `remndr` | APT 잔여세대 | 미계약/미분양 재공급 — 청약통장 불필요 | 공공데이터포털 |
| `pbl_pvt_rent` | 공공지원민간임대 | 시세 대비 저렴, 최대 10년 거주 | 공공데이터포털 |
| `opt` | 임의공급 | 사업주체 자율 공급 — 선착순 계약 | 공공데이터포털 |
| `sh` | SH 공공주택 | 서울주택도시공사 — 장기전세·청년안심·매입임대 | i-sh.co.kr HTML 크롤링 |
| `gh` | GH 공공주택 | 경기주택도시공사 — 경기행복주택·매입임대 | gh.or.kr HTML 크롤링 |

`sh`·`gh` 카테고리는 공식 OpenAPI 부재로 각 공사 게시판 HTML 크롤링. 일정 필드(`rcept_end`·`period`)는 상세 페이지에서 별도 파싱 필요 — 현재는 `schedule_source="unavailable"`로 기본 표기. 사용자가 `url`을 클릭해 공식 사이트에서 일정 직접 확인 권장.

## 워크플로우

### 0단계: 프록시 웜업 (기본 SKIP)

GitHub Actions가 12분마다 `/health` ping을 보내 Render 슬립을 방지하므로 **일반적으로 불필요**. 공고 조회가 30초 이상 실패할 때만 수동 웜업:
```bash
curl -s --max-time 60 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/health"
```
그 외에는 바로 1단계로 진행한다.

### 1단계: 프로필 확인

```
1. ~/.config/k-skill/apt-alert-profile.json 파일 존재 확인
2. 있으면 → 로드 + updated_at 경과일 체크 (90일/365일 경고)
3. 없으면 → 프로필 없이 전체 조회 + "프로필을 설정하면 맞춤 추천이 가능합니다" 안내
```

### 1단계: 청약 공고 조회

프록시 서버에서 공고를 가져온다. 프로필이 있으면 추천 카테고리와 지역으로 필터링.

```bash
# 전체 조회 — 반드시 --max-time 180 이상, URL은 "..." 단일 스트링
curl -s --max-time 180 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/announcements?category=all&active_only=true"

# 특정 카테고리
curl -s --max-time 180 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/announcements?category=apt&active_only=true"

# 지역 필터 (복수 가능, 쉼표 구분)
curl -s --max-time 180 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/announcements?region=서울,경기,인천"

# 세부 지역(구/군) 필터
curl -s --max-time 180 "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/announcements?region=서울&district=강남구,서초구"
```

**중요**: `&&` 체이닝 금지, URL은 항상 `"..."`로 감싸 단일 스트링. 자세한 규칙은 상단 "빠른 응답 원칙 > 3. 프록시 호출 규칙" 참고.

응답 형식:
```json
{
  "count": 15,
  "announcements": [
    {
      "id": "2026000123",
      "name": "래미안 원펜타스",
      "region": "서울",
      "district": "서초구",
      "address": "서울특별시 서초구 ...",
      "period": "2026-04-15 ~ 2026-04-20",
      "rcept_end": "20260420",
      "notice_date": "2026-04-10",
      "winner_date": "2026-04-27",
      "contract_start": "2026-05-11",
      "contract_end": "2026-05-13",
      "total_units": "641",
      "house_type": "민영",
      "constructor": "삼성물산(주)",
      "url": "https://www.applyhome.co.kr/...",
      "speculative_zone": "Y",
      "price_controlled": "N",
      "house_category": "APT",
      "size": "중형/대형",
      "schedule_source": "api"
    }
  ]
}
```

**`schedule_source` 필드:**
- `"api"` — 공공데이터포털 API 응답에서 바로 얻은 일정 (APT 일반분양 대부분)
- `"html_scraped"` — 청약홈 공고 상세 페이지 HTML 파싱으로 보강 (오피스텔·잔여세대 등 API 누락분)
- `"unavailable"` — 두 경로 모두 실패, 일정 미확인 (원문 URL 직접 확인 필요)

**관련 필드 (html_scraped 시 추가 제공):**
- `notice_date` — 모집공고일
- `winner_date` — 당첨자 발표일 (reminder=winners 기반)
- `contract_start`, `contract_end` — 계약 체결 기간 (reminder=contract 기반)

### 2단계: 프로필 기반 분석

조회된 공고를 프로필 기준으로 분석한다. 분류는 에이전트가 직접 수행한다.

**분류 필드:**
- `region`: 지역
- `district`: 세부 지역 (구/군 — API 응답의 district 필드 또는 주소에서 추출)
- `type`: 민영 / 공공 / 재건축 / 재개발
- `size`: 소형 / 중형 / 대형
- `priority`: HIGH / MEDIUM / LOW
- `eligibility`: 자격 해당 여부 (프로필 기반)
- `special_supply`: 해당 특별공급 유형

**우선순위 판정 기준 (프로필 반영):**
- **HIGH**: 선호 지역 + 선호 평형 + 자격 충족 + 1군 건설사(삼성, 현대, GS, 대우, 롯데, 포스코, DL, HDC) or 공공분양
- **MEDIUM**: 위 조건 중 2개 이상 충족
- **LOW**: 그 외

### 3단계: 결과 출력

**기본은 간결 모드.** 상단 "빠른 응답 원칙"의 템플릿을 따른다. 상세 모드는 사용자가 명시 요청했을 때만 확장한다.

#### 간결 모드 (기본)

```
📋 프로필: 만 31세 / 서울·경기·인천 / 무주택 / 통장 5년
📢 접수 중 공고 (N건):

| 이름 | 지역 | D-day | 세대수 | 타입 | 링크 |
| ... | ... | D-5 | 350 | 민영 | [청약홈 →](url) |

⏱️ {N}분 전 갱신 · 💡 더 보려면: '내 조건에 맞는 추천' / '내 가점' / '청약 가이드'
```

- **링크 컬럼 필수**: 각 공고 `url` 필드를 `[청약홈 →](url)` 형식으로 출력. 터미널 마크다운 렌더러가 링크로 표시해서 원클릭 이동 가능
- **Freshness 표시 필수**: 응답의 `data_age_seconds`를 분 단위로 환산해 맨 아래 `⏱️ N분 전 갱신` 표시. 60분 넘으면 "N시간 전"
- 프로필이 없으면 첫 줄만 `📢 접수 중 공고 (N건):`로 바꾸고 맨 아래 "프로필 설정하면 맞춤 추천 가능" 추가
- **간결 모드에서는 색 이모지 사용 금지** — 텍스트만 출력. D-day는 숫자만(`D-5`), 세대수·타입도 텍스트만. 색·판정은 상세 모드에서만

#### 상세 모드 ("맞춤 추천" 요청 시에만)

사용자가 "맞춤 추천", "내 조건에 맞는", "Top 3" 등을 명시하면 아래 확장:

```
📋 프로필: 만 31세 / 서울·경기·인천 / 신혼부부 / 무주택 / 통장 5년
📊 추정 가점: 약 32점 / 84점
⭐ 특별공급: 신혼부부 (추정)

🎯 추천 Top 3
  ※ 항목 옆 이모지 = 당첨 가능성 (🟢 높음 · 🟡 보통 · 🔴 낮음 · ⚪ 판정불가)

  1. 🟢 [공고명] — [지역], D-day
     📅 접수 YYYY-MM-DD~YYYY-MM-DD | 발표 YYYY-MM-DD | 계약 YYYY-MM-DD
     [청약홈 원문 →](url)
     - 핵심 이유 1~2줄 (소득·가점·평형 적합성)

  (2·3번도 동일 포맷)

📢 접수 중 공고 (N건): [테이블]
  ※ D-day 컬럼 색: 🔴 D-1 이하 · 🟡 D-2~3 · 🟢 D-4 이상
  ※ 매칭 컬럼: 🟢 강력 추천 · 🟡 조건부 · 🔴 제외(프로필 불일치)

⏱️ N분 전 갱신
```

**Top 3 세부 정보 필수 출력:**
- 📅 `winner_date` 있으면 "발표 YYYY-MM-DD", 없으면 생략
- 📅 `contract_start` 있으면 "계약 YYYY-MM-DD", `contract_end`가 다르면 "~ YYYY-MM-DD" 병기
- 🔗 `url` 마크다운 링크 `[청약홈 원문 →](url)` — 원클릭 이동 가능

**중복 표시 금지:**
- Top 3 항목에 "당첨 가능성: 🟡 보통" 같은 문구를 다시 쓰지 않는다 (번호 옆 이모지로 이미 표현됨)
- 테이블의 각 컬럼은 색 이모지 단독 — "🟢 D-4" 처럼 숫자만 병기, "🟢 높음 D-4" 같은 중복 라벨 금지

**Top 3 선정 규칙:** 자격 엄격한 순(APT > LH > 오피스텔), 프로필 특공 포함, 1주택자는 갈아타기 가능 유형 우선.

#### 매칭 0건 — 인접 지역 확장 ("0건 어떻게 해" 요청 시에만)

```
⚠️ {지역} 접수 중 공고 0건입니다.
💡 인접 지역({인접}) 확장하시겠어요? "{인접} 포함해서 다시"
```

인접 매핑: 서울↔경기↔인천 / 부산↔경남↔울산 / 광주↔전남↔전북 / 대전↔세종↔충남 / 세종↔대전↔충남↔충북 / 강원↔충북 / 대구↔경북 / 경북↔대구↔충북↔강원 / 경남↔부산↔울산↔전남 / 전북↔광주↔전남↔충남 / 충북↔세종↔대전↔충남↔강원 / 충남↔세종↔대전↔충북 / 제주↔(전국 공고만)

#### 일정 안내 ("언제 발표?", "계약은?" 요청 시에만)

```
📌 참고 일정: 접수 → 발표(7~10일 후) → 계약(1~2주 내)
```

### 4단계: 알림 발송 (선택)

사용자가 "알림 보내줘", "Slack으로 보내줘", `--notify` 등을 요청한 경우에만 실행한다.

> 🚨 **기본값 자동 선택 금지 — 주기·필터 둘 다 반드시 사용자에게 물어본다.**
> 어떤 알림 요청이든(필터 지정 여부 무관) 아래 STEP 1·2를 순서대로 강제 진행한다. 묻지 않고 바로 발송하는 경로는 존재하지 않는다.

#### 발송 전 필수 3단계 대화 (절대 규칙)

**STEP 1. 발송 주기 선택 (필수)**

알림 요청을 받자마자 **다른 어떤 동작보다 먼저** 아래 표를 출력하고 주기를 묻는다. 기술 용어가 아닌 **결과 중심**으로 설명할 것.

```
📢 알림 발송 — 어떻게 받으시겠어요?

| # | 선택 | 결과 | 추천 대상 |
|---|------|------|----------|
| 1 | 지금 한 번만 | 즉시 1회 발송 후 종료 | 오늘만 확인 |
| 2 | 매일 자동 (GitHub) ⭐ | 매일 오전 7시 (KST) 자동 발송, PC 꺼도 OK | 꾸준히 받기 (권장) |
| 3 | 매일 자동 (내 PC) | 매일 오전 7시 (KST) PC가 직접 발송 | 데스크톱 상시 가동 |
| 4 | 창 열린 동안 반복 | Claude 창 열어둔 동안 N시간마다 | 테스트용 |

1~4 중 선택해주세요. (2번 추천)
🕗 2·3번 기본 시간은 오전 7시(KST)입니다. 다른 시각 원하시면 말씀해주세요.
   예: "저녁 7시", "오전·오후 2회", "주말만" 등

ℹ️ 내부 구현 참고
  1=즉시 API · 2=GitHub Actions · 3=cron/Task Scheduler · 4=/loop
```

**시간 커스터마이징 규칙 (Claude가 변환):**

사용자가 한국어로 "저녁 7시", "오전 10시" 등 말하면 Claude가 **KST → UTC 변환 후 cron 형식**으로 자동 변환한다. GitHub Actions는 UTC 기준이므로 KST 시각에서 -9시간 하면 UTC.

| 사용자 입력 | KST | UTC | cron |
|-----------|-----|-----|------|
| 오전 7시 (기본) | 07:00 | 22:00 전날 | `0 22 * * *` |
| 오전 8시 | 08:00 | 23:00 전날 | `0 23 * * *` |
| 오전 9시 | 09:00 | 00:00 | `0 0 * * *` |
| 정오 12시 | 12:00 | 03:00 | `0 3 * * *` |
| 오후 6시 | 18:00 | 09:00 | `0 9 * * *` |
| 오후 7시 | 19:00 | 10:00 | `0 10 * * *` |
| 오후 8시 | 20:00 | 11:00 | `0 11 * * *` |
| 오전·오후 7시 2회 | 07·19시 | 22·10시 | `0 22,10 * * *` |
| 주말만 오전 9시 | 토·일 09시 | 00시 토·일 | `0 0 * * 0,6` |

3번(로컬)은 cron/Task Scheduler도 **로컬 OS 시각 그대로 KST** 사용하므로 변환 불필요. 예: crontab에 `0 7 * * *`로 바로 설정.

사용자가 숫자나 키워드("1번", "매일", "지금만" 등)로 명확히 답할 때까지 **대기**한다. 애매하거나 답이 없으면 이 표를 **다시** 출력한다. 절대 "기본 1회성"으로 임의 판단해서 넘어가지 않는다.

**사용자가 2번(GitHub 자동) 선택 시 추가 안내:**
"GitHub 계정만 있으면 5분 안에 설정 가능합니다. 다음 3가지만 진행하면 됩니다:
  ① 이 레포를 본인 계정으로 fork (GitHub 홈페이지 Fork 버튼)
  ② Settings → Secrets → New secret 으로 `SLACK_WEBHOOK` 등록
  ③ `.github/workflows/apt-notify.yml` 커밋
제가 ③번 파일 내용 생성해드리겠습니다."

**사용자가 3번(로컬 스케줄러) 선택 시 추가 안내:**
OS 확인 후 macOS/Linux는 `crontab` 한 줄, Windows는 PowerShell `Register-ScheduledTask` 명령 제공.

**STEP 2. 필터 확인 (필수)**

주기가 결정되면 **8개 필터 표를 반드시 보여주고** 사용자가 원하는 조건을 선택하게 한다:

```
📢 알림 조건 — 아래 필터 중 원하는 것만 조정하세요:

| # | 파라미터 | 현재값 / 기본 | 설명 |
|---|---------|------------|------|
| 1 | category | {초기값} | apt / officetell / lh / remndr / pbl_pvt_rent / opt / all |
| 2 | region | {프로필.regions or all} | 서울·경기·인천 등 17개 광역 (쉼표 복수) |
| 3 | district | (전체) | 강남구·서초구 등 세부 구/군 |
| 4 | min_units | 0 | 최소 세대수 (대단지만, 예: 500) |
| 5 | constructor_contains | (전체) | 시공사 키워드 (삼성·현대·GS 등) |
| 6 | active_only | true | 접수 중인 공고만 |
| 7 | reminder | (없음) | d3·d1·winners·contract |
| 8 | exclude_ids | (없음) | 중복 방지용 제외 공고 ID |

원하는 조건을 말씀해주세요.
• 예: "서울·경기 500세대 이상 D-3"
• 또는 "프로필대로" / "기본값" 이라고 하면 현재값 그대로 사용
```

사용자 메시지에 이미 필터가 포함된 경우("서울 대단지만 알림")에도 위 표는 반드시 출력하되, **해당 필터는 "현재값"에 반영**해서 보여준다. 사용자가 더 조정하거나 "이대로"/"확정" 하면 STEP 3로.

**STEP 3. 실행 (주기별 분기)**

| STEP 1 선택 | STEP 3 실행 내용 |
|-------------|----------------|
| 1. 🔂 1회성 | `POST /functions/v1/notify?<filters>` 즉시 호출 → 결과 보고 |
| 2. 🔁 /loop | `/loop 24h /korea-apt-alert <조건> 알림` 한 줄 안내만, 사용자가 복붙 실행 |
| 3. 🗓️ GitHub Actions | `.github/workflows/apt-notify.yml` 예시 yaml 출력 + 필요 Secrets(`SLACK_WEBHOOK`, `PROXY_URL`) 등록 안내 |
| 4. 💻 로컬 스케줄러 | macOS/Linux `crontab -e` 라인 OR Windows PowerShell Task Scheduler 등록 명령 출력 |

2~4번은 Claude가 **직접 발송하지 않고 스크립트/설정만 제공**한다. 사용자가 등록 후 "완료" 응답하면 마무리.

#### 절대 규칙 요약

- STEP 1·2 **생략 절대 금지** — 주기·필터 둘 다 묻지 않고 바로 발송하는 경로는 **없음**
- "기본 1회성"으로 자동 추정 **금지**, 반드시 사용자 명시 선택
- 사용자가 "그냥 보내줘" 같이 애매하게 말해도 **STEP 1 표부터 다시** 보여주기
- 필터 표는 마크다운 그대로 (파라미터명 영문·8행 유지, "현재값" 공백 X)


**Slack 발송:**
```bash
curl -X POST "$KSKILL_APT_SLACK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{
    "blocks": [
      {"type": "header", "text": {"type": "plain_text", "text": "🏠 래미안 원펜타스 — 서울 서초구"}},
      {"type": "divider"},
      {"type": "section", "text": {"type": "mrkdwn", "text": "*📅 접수기간:* 20260415 ~ 20260420\n*🏢 타입:* 민영 / 중형/대형\n*🔴 우선순위:* HIGH\n*⭐ 특별공급:* 신혼부부 자격 해당 (추정)\n*📊 추정 가점:* 32점\n*💬 분석:* _1군 건설사 + 서초구 입지 + 641세대_"}},
      {"type": "divider"},
      {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "청약홈 바로가기 →"}, "url": "https://www.applyhome.co.kr", "style": "primary"}]}
    ]
  }'
```

**Telegram 발송:**
```bash
curl -X POST "https://api.telegram.org/bot${KSKILL_APT_TELEGRAM_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": "'"$KSKILL_APT_TELEGRAM_CHAT_ID"'",
    "text": "🏠 <b>래미안 원펜타스</b> — 서울 서초구\n\n📅 <b>접수기간:</b> 20260415 ~ 20260420\n🏢 <b>타입:</b> 민영 / 중형/대형\n🔴 <b>우선순위:</b> HIGH\n⭐ <b>특별공급:</b> 신혼부부 자격 해당\n📊 <b>추정 가점:</b> 32점\n💬 <i>1군 건설사 + 서초구 입지</i>\n\n<a href=\"https://www.applyhome.co.kr\">청약홈 바로가기 →</a>",
    "parse_mode": "HTML",
    "disable_web_page_preview": true
  }'
```

HIGH 우선순위는 알림음 ON, 나머지는 무음 발송.

## 성공 기준

- 프록시에서 공고 JSON을 정상 수신
- 프로필이 있으면: 자격 매칭 + 가점 추정 + 특별공급 안내 + 경고 메시지 포함
- 프로필이 없으면: 전체 조회 + 프로필 설정 안내
- 초보 사용자: 입문 가이드 제공 후 조회
- 1주택 사용자: 갈아타기 안내 포함
- 결과를 마크다운 테이블로 출력
- (선택) Slack/Telegram 알림 발송 성공

## 실패 시나리오

| 상황 | 대응 |
|------|------|
| 프록시 응답 없음 | "프록시 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요." (Render free tier는 15분 비활성 시 슬립) |
| 공고 0건 | "현재 접수 중인 청약 공고가 없습니다." |
| 프로필 없음 | 전체 조회 후 "프로필을 설정하면 맞춤 추천이 가능합니다" 안내 |
| 프로필 매칭 0건 | "현재 조건에 맞는 공고가 없습니다. 지역이나 평형 조건을 넓혀보세요." |
| Slack/Telegram 미설정 | 해당 환경변수 설정 방법 안내 |

## 기술 노트

- API 서버: `https://xnyhzyvigazofjoozuub.supabase.co/functions/v1` (Supabase Edge Functions — 항상 활성)
- 프로필: `~/.config/k-skill/apt-alert-profile.json` (로컬 저장, 서버 전송 없음)
- 데이터 출처: 공공데이터포털 한국부동산원_청약홈 분양정보 조회 서비스
- API 키: 프록시 서버에서 관리 — 사용자 노출 없음
- 프록시 소스코드: https://github.com/aim-hackerton-itiscmux/k-apt-alert
