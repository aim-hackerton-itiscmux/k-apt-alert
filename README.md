# k-apt-alert

> 한국 청약 공고를 개인 프로필 기반으로 조회·분석하고 알림받는 서비스. Supabase Edge Functions + Flutter 앱.

- **무엇인가**: **APT 일반분양 · 오피스텔/도시형 · LH 공공분양 · APT 잔여세대 · 공공지원민간임대 · 임의공급 · SH 서울공공주택 · GH 경기공공주택** 총 8개 채널을 통합 조회하는 청약 정보 서비스.
- **누가 쓰나**: 청약 준비 중인 개인(자격·가점 확인용), 청약 알림을 자동화하고 싶은 개발자
- **기술 스택**: Supabase Edge Functions (Deno / TypeScript), Flutter, PostgreSQL + pg_cron

---

공공데이터포털 청약홈 분양정보 API 6종을 프록시 서버 경유로 통합 조회합니다. 사용자는 **API 키 없이** 최신 공고를 받아볼 수 있고, 개인 프로필을 등록하면 가점 추정·특별공급 자격·추천 유형까지 맞춤 분석됩니다.

## 어떤 걸 할 수 있나

| 기능 | 설명 | 로그인 필요 |
|------|------|-------------|
| 최신 공고 조회 | APT·오피스텔·LH·잔여·공공임대·임의공급·**SH(서울)**·**GH(경기)** 8종 통합 | ❌ |
| 지역·구/군 필터 | 서울·경기·인천 등 17개 광역 + 세부 구/군 | ❌ |
| 프로필 기반 맞춤 추천 | 청약통장·무주택 여부·소득 구간 기준 자격 매칭 | ✅ |
| 추정 가점 계산 | 무주택 기간 + 부양가족 + 통장 가입기간 → 84점 만점 | ✅ |
| 특별공급 자격 판정 | 신혼부부·생애최초·다자녀·한부모·노부모 | ✅ |
| 가점대별 전략 안내 | 20점 미만 → 오피스텔 권장, 60+ → 수도권 도전 등 | ❌ |
| D-day 알림 | 마감 임박(D-3/D-1) / 당첨자 발표 / 계약 체결 | ✅ |
| 즐겨찾기 공고 | 관심 공고 저장 + 상태 변동 추적 | ✅ |
| 중복 알림 방지 | 7일 이내 발송 공고 자동 제외 | ✅ |
| Slack·Telegram 발송 | Block Kit 포맷 + 긴급도 이모지 | Slack/Telegram 계정 |
| 인접 지역 확장 | 매칭 0건이면 인접 도/광역 제안 (17개 매핑) | ❌ |
| 세대수·시공사 필터 | 대단지·1군 브랜드 필터 | ❌ |

## 아키텍처

```
Flutter 앱
  └── Supabase Auth (JWT)
  └── Supabase Edge Functions (API)
        ├── announcements   — 공고 조회 + risk_flags
        ├── notify-cron     — pg_cron 매일 매칭 알림
        ├── notifications   — 인앱 알림 CRUD + refresh
        ├── profile         — 사용자 프로필 PATCH/GET
        ├── my-score        — 가점 계산 + 월별 재계산
        ├── eligibility-precheck — 부적격 사전검증
        ├── recommendations — 서버 프로필 기반 추천
        └── ... (총 14개 Edge Functions)
  └── PostgreSQL (Supabase)
        ├── announcements       — 크롤 캐시
        ├── user_profiles       — 프로필 + 가점 JSONB
        ├── notifications       — 인앱 알림
        └── pg_cron 스케줄      — 10분 크롤 + 매일 알림
```

## 실제 출력 예시

### 프로필 기반 맞춤 추천 (28세·서울·통장 3년)

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
```

### 매칭 0건 — 인접 지역 제안

```
⚠️ 광주 지역 현재 접수 중인 공고 0건입니다.
💡 인접 지역(전남·전북)으로 확장하시겠어요?
```

---

## 포함된 파일

### Supabase 백엔드
- [`supabase/functions/`](supabase/functions/) — 14개 Supabase Edge Functions (크롤러 9 + API 5)
- [`supabase/functions/_shared/`](supabase/functions/_shared/) — 공유 모듈 (HTTP, 표준화, 필터, 알림, FCM v1)
- [`supabase/migrations/`](supabase/migrations/) — PostgreSQL 스키마 + pg_cron 스케줄
- [`.github/workflows/test.yml`](.github/workflows/test.yml) — mock 테스트 + E2E CI

### 테스트
- [`test_personas.py`](test_personas.py) — 시나리오 기반 페르소나 테스트
- [`test_personas_v2.json`](test_personas_v2.json) — 20개 다양성 페르소나 (연령대·지역·가구 유형 망라)

## 프록시 API

**운영 중**: https://xnyhzyvigazofjoozuub.supabase.co/functions/v1

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /health` | 서버 상태 확인 |
| `GET /categories` | 카테고리 8종 목록 |
| `GET /announcements` | 청약 공고 조회 |
| `POST /notify` | Slack/Telegram 발송 |
| `GET /cache-status` | 크롤 메타데이터·일일 호출 카운터 상태 |
| `GET /profile` | 본인 프로필 조회 (인증 필요) |
| `PATCH /profile` | 프로필 부분 업데이트 (인증 필요) |
| `GET /my-score` | 가점 조회 (인증 필요) |
| `POST /my-score` | 가점 재계산 (인증 필요) |
| `GET /notifications` | 인앱 알림 목록 (인증 필요) |
| `POST /notifications` | 수동 알림 추가 (인증 필요) |
| `POST /notifications/refresh` | 본인 매칭 즉시 실행 (인증 필요) |
| `GET /recommendations` | 프로필 기반 추천 (인증 필요) |
| `GET /eligibility-precheck` | 부적격 사전검증 (인증 필요) |

**쿼리 파라미터** (`/announcements`, `/notify` 공통):

| 파라미터 | 기본값 | 설명 |
|---------|--------|------|
| `category` | `all` | `all`, `apt`, `officetell`, `lh`, `remndr`, `pbl_pvt_rent`, `opt` |
| `active_only` | `true` | 접수 마감 전 공고만 (클라이언트 필터) |
| `months_back` | `2` | 조회 기간 (1~12개월) |
| `region` | (전체) | 지역 필터 (쉼표 구분, 예: `서울,경기`) |
| `district` | (전체) | 세부 지역 필터 (구/군 쉼표 구분) |
| `min_units` | `0` | 최소 세대수 (대단지만) |
| `constructor_contains` | (전체) | 시공사 키워드 (쉼표 구분) |
| `exclude_ids` | (전체) | 제외할 공고 ID (중복 방지) |
| `reminder` | (없음) | `d3` / `d1` / `winners` / `contract` |

### 데이터 소스

| 카테고리 | 업데이트 | 캐시 TTL |
|----------|---------|----------|
| APT 일반분양 | 월 25일 배치 | 60분 |
| 공공지원민간임대 | 실시간 | 30분 |
| 오피스텔/도시형, LH, 잔여세대, 임의공급 | 실시간 | 10분 |
| SH(서울) · GH(경기) 공공주택 | HTML 크롤링 | 30분 |

## 배포 (운영자용)

```bash
supabase link --project-ref xnyhzyvigazofjoozuub
supabase secrets set DATA_GO_KR_API_KEY=your_key
supabase db push                     # 마이그레이션 적용
supabase functions deploy --no-verify-jwt  # 14개 Edge Functions 배포
```

### 운영 보호 장치
- **PostgreSQL 영속 캐시**: 서버 재시작과 무관하게 데이터 유지
- **pg_cron 자동 크롤링**: 10분 간격으로 8개 크롤러 독립 실행
- **카테고리별 TTL**: apt 60분 / pbl_pvt_rent·sh·gh 30분 / 나머지 10분
- **일일 rate limit**: 9000건 초과 시 DB 기반 카운터로 보호
- **RLS**: 공고 데이터 공개 읽기, 쓰기는 service_role만 허용

## 보안·프라이버시

- 인증은 Supabase Auth JWT 기반이며 Row Level Security(RLS)로 데이터 격리됩니다.
- 비인증 조회(공고 목록)에는 개인정보가 포함되지 않습니다.

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

## License

MIT
