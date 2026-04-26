# 공고 부가 정보 도메인 — `announcement_details` 분리 설계

> 작성일: 2026-04-26
> 브랜치: `docs/announcement-details-plan`
> 상태: **기획 — 사용자 결정 대기 (스키마/소스/우선순위 4건)**

## 0. 한 줄 요약

`announcements` 테이블이 부족한 부가 정보(평형별 세대수·동수·교통·학군 등)를 별도 `announcement_details` 테이블 (1:1 FK) 로 분리해서 관리한다. 기존 announcements/크롤러 8종 코드 변경 없이 단계적으로 채울 수 있다.

---

## 1. 동기 — 화면이 요구하는 부가 필드

청약 코파일럿 앱 화면 분석에서 발견한 갭 (Stitch project `16062927818472003315`):

### 화면 1 — 공고 상세 (screen 9d762970)

| 필드 | 현재 announcements | 출처 |
|------|------------------|------|
| 위치 (정확한 도로명) | ✅ `address` | 공공데이터포털 |
| 동수 (8개동) | ❌ | 모집공고문 PDF 또는 청약홈 SSR |
| 층수 (지하 3 / 지상 35) | ❌ | 동일 |
| 3.3㎡당 분양가 | ❌ | 모집공고문 + 평형별 분양가표 |
| 평형별 세대수 (59A 100세대 / 84B 50세대) | ❌ | 모집공고문 |
| 특공별 세대수 (신혼 40 / 생애최초 25) | ❌ | 모집공고문 |
| 교통 (인근 역·GTX 등) | ❌ | 카카오 모빌리티 + 별도 인덱싱 |
| 학군 (반경 학교) | ❌ | NEIS API (school-zone 함수 활용) |
| 인근 시설 (대형마트·병원) | ❌ | 카카오 로컬 |

### 화면 2 — AI 분석 리포트 (screen 3587a9f0)

분양가 vs 시세 표 (target/comparable/margin) — `comparable` 데이터 출처가 부가 필드.

### 기타 화면

- 공고 비교 (3f5030df) — 같은 부가 필드를 표 비교
- 임장 체크리스트 (4316f446) — 인근 시설/교통 정보 활용

---

## 2. 옵션 비교 — 왜 분리?

### 옵션 A: `announcements` ALTER TABLE +N 컬럼

| 장점 | 단점 |
|------|------|
| 단일 쿼리로 다 받음 | **크롤러 8종 모두 수정 필요** |
| 마이그레이션 1건 | 기존 announcements 응답에 영향 (필드 추가) |
| | 부가 정보 수집 실패해도 row 자체는 announcements UPSERT — NULL 컬럼 누적 |
| | 부가 정보별 다른 출처·다른 fetch 주기 → 단일 테이블에 묶기 부자연스러움 |

### 옵션 B: 신규 `announcement_details` 테이블 (1:1 FK) ⭐ **채택**

| 장점 | 단점 |
|------|------|
| **announcements 코드 변경 0** — 크롤러 영향 없음 | JOIN 1번 추가 필요 |
| 부가 정보는 별도 enrich 함수에서 채움 (단계적) | 1:1 row 없을 때 응답 처리 필요 |
| 부가 정보 fetch 실패해도 base 공고는 정상 | |
| 출처별 컬럼 분리 가능 (모집공고PDF / 카카오 / NEIS / 시세DB) | |
| 신규 enrich 함수가 새 컬럼 채울 때 다른 소스 수정 0 | |

→ **B 채택**. 근거: 출처별 fetch 주기가 다르고, 실패 격리, 단계적 추가 필요.

---

## 3. 스키마 설계

### 3.1 `announcement_details` 테이블 (단일 row per announcement)

```sql
CREATE TABLE public.announcement_details (
  announcement_id TEXT PRIMARY KEY REFERENCES public.announcements(id) ON DELETE CASCADE,

  -- 모집공고문 PDF에서 추출 (notice/raw + LLM 또는 별도 파서)
  building_count INT,                       -- 동수 (8개동)
  floors_underground INT,                   -- 지하 3
  floors_aboveground INT,                   -- 지상 35
  price_per_pyeong_man INT,                 -- 3.3㎡당 분양가 (만원)
  supply_units_by_type JSONB,               -- 평형별·특공별 세대수 (구조: §3.2)
  parking_ratio NUMERIC,                    -- 가구당 주차 대수 (1.2 등)
  total_land_area_m2 NUMERIC,               -- 대지 면적
  total_floor_area_m2 NUMERIC,              -- 연면적

  -- 카카오 로컬/모빌리티에서 enrich
  nearest_subway TEXT,                      -- '강남역 도보 5분'
  nearest_subway_distance_m INT,
  nearest_bus_stop TEXT,
  commute_to_gangnam_min INT,               -- 강남역 통근 시간
  amenities JSONB,                          -- 대형마트/병원/공원 등 (구조: §3.3)

  -- NEIS school-zone에서 enrich
  schools_within_500m JSONB,                -- 학교 목록 (school-zone 캐시 동기화)

  -- 시세 비교 (실거래가 API)
  comparable_complexes JSONB,               -- 인근 비교 단지 (구조: §3.4)

  -- 메타
  enriched_sources TEXT[] DEFAULT '{}',     -- ['notice_pdf', 'kakao_local', 'neis', 'realestate']
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- enrich 부분 갱신 시 자동 갱신
CREATE TRIGGER trg_details_updated_at
  BEFORE UPDATE ON public.announcement_details
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS: 공개 읽기 (공고 정보의 일부) + service_role write
ALTER TABLE public.announcement_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "details_public_read" ON public.announcement_details FOR SELECT USING (true);
CREATE POLICY "details_service_write" ON public.announcement_details FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### 3.2 `supply_units_by_type` JSONB 구조

```json
{
  "by_size": {
    "59A": { "general": 100, "special": { "신혼부부": 40, "생애최초": 20, "다자녀": 5 } },
    "84B": { "general": 50, "special": { "신혼부부": 30, "생애최초": 15 } },
    "84C": { "general": 30, "special": {} }
  },
  "totals": { "general": 180, "special_total": 110, "all": 290 }
}
```

### 3.3 `amenities` JSONB 구조

```json
{
  "supermarket": [
    { "name": "이마트 반포점", "distance_m": 450, "kakao_id": "..." }
  ],
  "hospital": [
    { "name": "강남세브란스병원", "distance_m": 1200, "type": "종합병원" }
  ],
  "park": [...]
}
```

### 3.4 `comparable_complexes` JSONB 구조

```json
[
  {
    "name": "아크로리버파크",
    "year_built": 2016,
    "distance_m": 600,
    "avg_price_per_pyeong_man": 7500,
    "recent_transactions": [
      { "date": "2026-03-15", "size_sqm": 84, "price_eok": 11.5 }
    ],
    "source": "molit_realestate_api"
  }
]
```

---

## 4. 데이터 채움 전략 — 출처별 enrich 함수

### 4.1 출처별 매핑

| 출처 | 커버 필드 | 기존 함수 활용 |
|------|---------|---------------|
| 모집공고문 PDF (notice/raw + LLM) | building_count, floors_*, price_per_pyeong_man, supply_units_by_type, parking_ratio, total_*_area | `notice/raw?include_attachments=true` (PR #10) |
| 카카오 로컬 API | nearest_subway, nearest_bus_stop, amenities | `_shared/kakao.ts` (이미 있음) |
| 카카오 모빌리티 | commute_to_gangnam_min | `commute` 함수 + `_shared/mobility.ts` |
| NEIS 학교알리미 | schools_within_500m | `school-zone` 함수 (이미 있음) — 결과 캐시 동기화 |
| 국토부 실거래가 | comparable_complexes | `price-assessment` 함수 + `_shared/realestate.ts` |

### 4.2 신규 enrich 함수: `crawl-enrich-details`

```typescript
// supabase/functions/crawl-enrich-details/index.ts
// pg_cron으로 매일 새벽 1회 실행 (또는 신규 공고 감지 시 즉시)
// 1. announcements 중 announcement_details 없거나 30일 이상 지난 row 선택
// 2. 출처별 enrich:
//    - kakao로 좌표·인근 시설
//    - mobility로 통근 시간
//    - school-zone으로 학교
//    - realestate로 비교 단지
//    - notice/raw + LLM으로 PDF 부가 정보 (옵션, 비용 부담)
// 3. UPSERT announcement_details
// 4. enriched_sources에 성공한 소스만 추가 (부분 성공 가능)
```

### 4.3 단계적 채움 (점진적)

모든 컬럼 한 번에 채우지 않음. 우선순위:

| 단계 | 컬럼 | 출처 | 작업량 |
|------|------|------|--------|
| **1차** | nearest_subway / amenities (slim) | kakao_local | 2~3h |
| **2차** | schools_within_500m | NEIS (school-zone 캐시 sync) | 1~2h |
| **3차** | comparable_complexes | realestate | 3~4h |
| **4차** | commute_to_gangnam_min | mobility | 2h |
| **5차** | building_count / floors_* / supply_units_by_type | notice/raw + LLM (가장 비용 큼) | 5~8h |

→ 1~4차는 기존 함수 재활용으로 작업량 작음. 5차가 핵심·고비용.

---

## 5. API 영향

### 5.1 신규 엔드포인트

```
GET /v1/announcement-detail?announcement_id=X
```

이미 PR #15에서 announcement-detail 함수 만들었음. **이 함수에 details JOIN 추가**:

```typescript
// announcement-detail/index.ts 응답 확장
{
  "announcement": { ...기존 announcements row... },
  "details": { ...announcement_details row, null이면 enrich 미완 안내... },
  "recent_changes": [...],
  "diagnosis": {...}
}
```

### 5.2 기존 announcements 응답 영향 없음

- `GET /v1/announcements` (목록) — 변경 0
- 크롤러 8종 — 변경 0
- 기존 클라이언트 호환 100%

### 5.3 신규 enrich 트리거

- `POST /v1/announcement-detail/enrich?announcement_id=X` (service_role) — 수동 트리거
- pg_cron — 매일 새벽 자동

---

## 6. 마이그레이션 번호 + 단계별 PR 분할

| 단계 | PR | 마이그레이션 | 함수 | 작업량 |
|------|----|------------|------|--------|
| 0 | 본 plan doc | — | — | — |
| 1 | 스키마 + 빈 enrich 골격 | 021_announcement_details.sql | `crawl-enrich-details` (skeleton) | 2h |
| 2 | kakao 활용 enrich | — | enrich-details에 kakao 채움 | 2~3h |
| 3 | school-zone sync | — | enrich-details에 NEIS 채움 | 1~2h |
| 4 | realestate 활용 | — | enrich-details에 시세 채움 | 3~4h |
| 5 | mobility 활용 | — | enrich-details에 통근 채움 | 2h |
| 6 | PDF + LLM (옵션) | — | enrich-details에 notice/raw LLM | 5~8h |
| 7 | announcement-detail JOIN 응답 변경 | — | PR #15 함수 update | 1h |

**총 16~22h** — 단계 분할로 검토·운영 안정성 확보.

---

## 7. 결정 필요 항목 (사용자 확인)

| # | 항목 | 옵션 |
|---|------|------|
| Q1 | **PDF + LLM 단계 (6단계) 포함 여부** | 포함 (가장 비싼 작업) / 제외 (1~5단계만) |
| Q2 | **enrich 주기** | 매일 새벽 1회 / 신규 공고 감지 즉시 / 두 가지 병행 |
| Q3 | **enrich 결과 캐시 TTL** | 30일 / 90일 / 영구 (수동 갱신만) |
| Q4 | **schools_within_500m JSONB로 사본 저장 vs school_zone_cache JOIN** | 사본 (빠름) / JOIN (DRY) |

---

## 8. Phase 5+ 보존 사항

- 본 도메인은 mypage / 공고 상세 / AI 리포트 화면 풍부화에 집중
- favorites + announcement_changes와는 직접 의존 없음 (각자 독립 도메인)
- 단계 6 (LLM PDF 추출)은 비용·정확도 검증 후 진행
- 부동산 실거래가 데이터 갱신 빈도가 LH 실시간성 따라가지 못하므로 30일 캐시 권장

---

## 9. 다음 액션

1. **사용자 결정** — Q1~Q4
2. 결정 후: PR #1 (스키마 + skeleton) → PR #2 (kakao) → ... 순차 단계
3. 또는: 단계 1+2 묶음 PR 후 검토 → 나머지 단계 결정
