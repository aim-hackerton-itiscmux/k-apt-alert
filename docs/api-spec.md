# k-apt-alert API 명세서

> 백엔드: Supabase Edge Functions (Deno/TypeScript)  
> 베이스 URL: `https://{SUPABASE_PROJECT_ID}.supabase.co/functions/v1`

---

## 인증

### 공개 엔드포인트 (로그인 불필요)
```
Authorization: Bearer {SUPABASE_ANON_KEY}
```

### 인증 필요 엔드포인트
Supabase Auth로 로그인 → JWT 발급 → 헤더에 첨부

**로그인 요청**
```
POST https://{SUPABASE_PROJECT_ID}.supabase.co/auth/v1/token?grant_type=password
Content-Type: application/json

{ "email": "user@example.com", "password": "password" }
```

**로그인 응답**
```json
{ "access_token": "eyJ...", "token_type": "bearer", "expires_in": 3600 }
```

**인증 헤더**
```
Authorization: Bearer {access_token}
```

> 인증 필요 엔드포인트에 토큰 없으면 `401 Authentication required` 반환

---

## 엔드포인트 목록

| 엔드포인트 | 메서드 | 인증 | 설명 |
|-----------|--------|------|------|
| `/announcement-detail` | GET | ⚡ | 단일 공고 상세 + 진단 (인증 시 맞춤 진단 추가) |
| `/announcements` | GET | ❌ | 청약 공고 통합 조회 |
| `/categories` | GET | ❌ | 공급 유형 카테고리 목록 |
| `/notice/{id}/raw` | GET | ❌ | 공고 원문 텍스트 추출 |
| `/recommendations` | GET | ✅ | 프로필 기반 맞춤 추천 |
| `/favorites` | GET / POST / PATCH / DELETE | ✅ | 즐겨찾기 공고 CRUD + 변경 알림 토글 |
| `/announcement-changes` | GET | ❌ | 공고 변경(정정) 이력 |
| `/documents` | GET / POST / PATCH / DELETE | ✅ | 청약 준비 서류함 |
| `/profile` | GET / PATCH | ✅ | 사용자 선호 프로필 |
| `/my-score` | GET / POST | ✅ | 청약 가점 조회·계산 |
| `/eligibility-precheck` | POST | ❌ | 부적격 위험 검증 + 가점 계산 |
| `/simulate` | POST | ❌ | 청약 프로세스 단계별 시뮬레이션 |
| `/notifications` | GET / POST / PATCH | ✅ | 인앱 알림 CRUD |
| `/notify` | GET | ❌ | Slack·Telegram 알림 발송 |
| `/compare` | GET | ❌ | 공고 2~5개 비교 |
| `/similar-listings` | GET | ❌ | 유사 공고 + 경쟁률 예측 |
| `/location-score` | GET | ❌ | 입지 점수 |
| `/school-zone` | GET | ❌ | 인근 초등학교 |
| `/commute` | GET | ❌ | 대중교통 통근 시간 |
| `/price-assessment` | GET | ❌ | 분양가 적정성 평가 |
| `/development-news` | GET | ❌ | 개발 호재 뉴스 검증 |
| `/visit-checklist` | GET | ❌ | 현장 방문 체크리스트 |
| `/preparation/init` | POST | ✅ | 청약 준비 체크리스트 초기화 |
| `/preparation` | GET | ✅ | 체크리스트 조회 (documents 자동 연동) |
| `/preparation/{id}/done` | PATCH | ✅ | 항목 체크/언체크 |
| `/preparation/{id}` | DELETE | ✅ | 항목 삭제 |
| `/reports` | GET / POST / DELETE | ✅ | 분석 리포트 저장·조회 |
| `/health` | GET | ❌ | 서버 상태 확인 |
| `/cache-status` | GET | ❌ | 크롤 캐시 상태 |

---

## 공고 조회

### `GET /announcement-detail`

단일 공고 상세 통합 응답. 인증 옵셔널 — 비로그인도 공고 메타·변경 내역 조회 가능, 로그인 시 맞춤 진단 포함.

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | (필수) |

**응답**
```json
{
  "announcement": {
    "id": "uuid",
    "name": "래미안 원베일리",
    "region": "서울",
    "district": "서초구",
    "period": "2026-04-20 ~ 2026-04-22",
    "rcept_bgn": "2026-04-20",
    "rcept_end": "2026-04-22",
    "total_units": 641,
    "house_category": "APT 일반분양",
    "constructor": "삼성물산",
    "size": "59㎡/84㎡",
    "speculative_zone": "Y",
    "price_controlled": "Y",
    "d_day": 3
  },
  "recent_changes": [
    {
      "id": "uuid",
      "detected_at": "2026-04-25T10:00:00Z",
      "field": "rcept_end",
      "field_label_ko": "청약 마감일",
      "change_type": "updated",
      "old_value": "2026-04-21",
      "new_value": "2026-04-22"
    }
  ],
  "change_count": 1,
  "has_changes": true,
  "diagnosis": {
    "score": {
      "total": 32,
      "homeless_years": 6.3,
      "homeless_score": 14,
      "dependents_score": 10,
      "savings_months": 48,
      "savings_score": 8
    },
    "warnings": [
      {
        "field": "savings_period",
        "severity": "critical",
        "message": "투기과열지구 1순위 요건: 청약통장 24개월 이상 — 현재 18개월",
        "detail": "..."
      }
    ],
    "warning_summary": { "critical": 1, "warning": 0, "info": 1 },
    "profile_used": true
  },
  "generated_at": "2026-04-26T14:00:00Z"
}
```

> `diagnosis` — 로그인 안 했으면 `null`, 로그인했지만 프로필 미등록이면 `profile_used: false`로 반환  
> `recent_changes` — 최근 5건만 (전체는 `/announcement-changes` 별도 엔드포인트)

---

### `GET /announcements`

8개 채널(APT·오피스텔·LH·잔여세대·공공임대·임의공급·SH·GH) 통합 공고 목록.

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|-------|------|
| `category` | string | `"all"` | `apt` `officetell` `lh` `remndr` `pbl_pvt_rent` `opt` `sh` `gh` `all` |
| `region` | string | (전체) | 쉼표 구분 광역 (`"서울,경기"`) |
| `district` | string | (전체) | 쉼표 구분 구/군 (`"강남구,수원시"`) |
| `active_only` | bool | `true` | 접수 중 공고만 |
| `min_units` | int | `0` | 최소 세대수 |
| `constructor_contains` | string | (없음) | 시공사 이름 포함 검색 |
| `exclude_ids` | string | (없음) | 쉼표 구분 제외 공고 ID |
| `reminder` | string | (없음) | `winner` `contract` — 발표·계약 임박 필터 |
| `risk_flags` | bool | `true` | risk_flags 포함 여부 |

**응답**
```json
{
  "count": 42,
  "announcements": [
    {
      "id": "uuid",
      "name": "래미안 원베일리",
      "region": "서울",
      "district": "서초구",
      "address": "서울 서초구 ...",
      "period": "2026-04-20 ~ 2026-04-22",
      "rcept_bgn": "2026-04-20",
      "rcept_end": "2026-04-22",
      "total_units": 641,
      "house_type": "아파트",
      "house_category": "APT 일반분양",
      "constructor": "삼성물산",
      "url": "https://...",
      "size": "59㎡/84㎡",
      "speculative_zone": "Y",
      "price_controlled": "Y",
      "d_day": 3,
      "winner_date": "2026-05-10",
      "contract_start": "2026-05-20",
      "contract_end": "2026-05-22",
      "risk_flags": ["투기과열지구", "분양가상한제"]
    }
  ],
  "data_age_seconds": 1200,
  "fetched_at": "2026-04-26 14:30:00",
  "filters": { "category": "all", "region": "all", "active_only": true }
}
```

---

### `GET /categories`

**응답**
```json
{
  "categories": [
    { "id": "apt", "name": "APT 일반분양", "description": "..." },
    { "id": "officetell", "name": "오피스텔/도시형", "description": "..." }
  ]
}
```

---

### `GET /notice/{id}/raw`

공고 상세 원문 텍스트 (HTML 파싱 + PDF 첨부 추출 옵션).

**경로 파라미터:** `id` — 공고 ID (announcements.id)

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|-------|------|
| `url` | string | (없음) | DB에 없을 때 직접 URL 지정 |
| `include_attachments` | bool | `false` | PDF 첨부 텍스트 추출 포함 |
| `force_refresh` | bool | `false` | 캐시 무시하고 재크롤 |
| `max_chars` | int | `30000` | 최대 텍스트 길이 |

**응답**
```json
{
  "id": "uuid",
  "url": "https://...",
  "title": "래미안 원베일리 분양공고",
  "text": "...(원문 전체)...",
  "char_count": 12500,
  "truncated": false,
  "source": "html",
  "sections": {
    "자격": "...",
    "공급일정": "...",
    "공급금액": "...",
    "유의사항": "..."
  },
  "cache_hit": true,
  "extracted_at": "2026-04-26T10:00:00Z",
  "attachments_included": false
}
```

---

## 맞춤 추천

### `GET /recommendations` ✅

저장된 프로필 기반 공고 추천. 프로필 미등록 시 `404`.

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|-------|------|
| `limit` | int | `3` | 추천 개수 (1~20) |

**응답**
```json
{
  "recommendations": [
    {
      "announcement": { "id": "...", "name": "...", "region": "서울", "d_day": 5 },
      "match_score": 87,
      "match_reasons": ["선호 지역 일치", "무주택 자격 충족"]
    }
  ],
  "profile_used": { "preferred_regions": ["서울", "경기"], "is_homeless": true },
  "match_fields_used": ["regions", "preferred_size_sqm", "is_homeless"],
  "total_active": 156,
  "generated_at": "2026-04-26T14:00:00Z"
}
```

---

---

## 즐겨찾기

> 인증 필수 (✅). RLS로 본인 데이터만 격리. 공고 1개당 1개 즐겨찾기 (UNIQUE 제약).

### `GET /favorites` ✅

내 즐겨찾기 목록 + 공고 메타 JOIN

**응답 예시**
```json
{
  "favorites": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "announcement_id": "string",
      "notes": "메모 텍스트",
      "notify_on_change": true,
      "created_at": "2026-04-01T00:00:00Z",
      "announcement": {
        "id": "string",
        "name": "공고명",
        "region": "서울",
        "district": "강남구",
        "period": "2026-04",
        "rcept_end": "2026-04-30",
        "total_units": 120,
        "house_type": "아파트",
        "house_category": "공공분양",
        "url": "https://...",
        "speculative_zone": false,
        "price_controlled": true
      }
    }
  ],
  "summary": {
    "total": 3,
    "notify_on_change_count": 2
  }
}
```

**Flutter 예시**
```dart
final res = await supabase.functions.invoke('favorites');
final data = res.data as Map<String, dynamic>;
final favorites = data['favorites'] as List;
```

---

### `POST /favorites` ✅

즐겨찾기 추가

**요청 body**
```json
{
  "announcement_id": "string",    // 필수
  "notes": "메모",                 // 선택 (최대 1000자)
  "notify_on_change": true        // 선택 (기본값: true)
}
```

**응답 (201)**
```json
{
  "favorite": { "id": "uuid", "announcement_id": "string", "notes": null, "notify_on_change": true, ... }
}
```

**에러**
| 코드 | code | 설명 |
|------|------|------|
| 409 | `ALREADY_EXISTS` | 이미 즐겨찾기한 공고 |
| 404 | `ANNOUNCEMENT_NOT_FOUND` | 존재하지 않는 announcement_id |

---

### `PATCH /favorites/{id}` ✅

메모·알림 설정 수정

**요청 body** (하나 이상 필수)
```json
{
  "notes": "수정된 메모",
  "notify_on_change": false
}
```

**응답 (200)**
```json
{
  "favorite": { "id": "uuid", "notes": "수정된 메모", "notify_on_change": false, ... }
}
```

---

### `DELETE /favorites/{id}` ✅

즐겨찾기 해제 (id 기반)

**응답 (200)**
```json
{ "deleted": ["uuid"], "count": 1 }
```

---

### `DELETE /favorites?announcement_id={id}` ✅

즐겨찾기 해제 (favorite id를 모를 때 토글 UX용)

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `announcement_id` | string | 해제할 공고 ID |

**응답 (200)**
```json
{ "deleted": ["uuid"], "count": 1 }
```

**Flutter 토글 예시**
```dart
// 즐겨찾기 추가
final addRes = await supabase.functions.invoke(
  'favorites',
  body: {'announcement_id': annId, 'notify_on_change': true},
  method: HttpMethod.post,
);

// 즐겨찾기 해제 (announcement_id 기반)
final delRes = await supabase.functions.invoke(
  'favorites?announcement_id=$annId',
  method: HttpMethod.delete,
);
```


## 프로필 관리

### `GET /profile` ✅

**응답**
```json
{
  "user_id": "uuid",
  "profile": {
    "preferred_regions": ["서울", "경기"],
    "resident_region": "서울",
    "preferred_size_sqm": 59,
    "is_homeless": true,
    "has_house": false,
    "special_supply_interests": ["신혼부부", "생애최초"]
  },
  "derived": { "eligible_categories": ["apt", "lh"] },
  "score": { "total": 32, "homeless_score": 14, "dependents_score": 10, "savings_score": 8 },
  "updated_at": "2026-04-20T10:00:00Z"
}
```

### `PATCH /profile` ✅

선호 정보 부분 업데이트. 아래 필드 중 일부만 보내도 됨.

**요청 Body**
```json
{
  "preferred_regions": ["서울", "경기"],
  "resident_region": "서울",
  "preferred_size_sqm": 59,
  "is_homeless": true,
  "has_house": false,
  "special_supply_interests": ["신혼부부", "생애최초"],
  "onboarding_step": 3,
  "onboarding_completed_at": "2026-04-26T10:00:00Z",
  "subscription_contributions": 24
}
```

| 필드 | 타입 | 범위 | 설명 |
|------|------|------|------|
| `onboarding_step` | int | 1..10 | 앱 온보딩 현재 step |
| `onboarding_completed_at` | string | ISO datetime | 온보딩 완료 시각 |
| `subscription_contributions` | int | 0..10000 | 청약통장 누적 납입 회차 |

**응답:** `GET /profile`과 동일 구조

---

## 가점 계산

### `GET /my-score` ✅

DB에 저장된 가점 반환. 30일 초과 시 자동 재계산.

**응답**
```json
{
  "user_id": "uuid",
  "score": {
    "total": 32,
    "homeless_years": 6.3,
    "homeless_score": 14,
    "dependents_score": 10,
    "savings_months": 48,
    "savings_score": 8,
    "next_upgrade": { "field": "homeless", "days_until": 120, "score_gain": 2 }
  },
  "upcoming_alert": {
    "message": "이번 달 가점 +2점 예정 (무주택 기간 증가)",
    "days_until": 14,
    "field": "homeless",
    "confirm_required": true
  },
  "updated_at": "2026-04-01T00:00:00Z",
  "recalculated": false
}
```

### `POST /my-score` ✅

프로필 입력 → 가점 즉석 계산 + DB 저장.

**요청 Body**
```json
{
  "birth_date": "1990-01-15",
  "is_married": true,
  "marriage_date": "2020-06-01",
  "dependents_count": 1,
  "is_homeless": true,
  "homeless_since": "2018-03-01",
  "savings_start": "2016-05-01",
  "savings_balance_wan": 300,
  "resident_region": "서울",
  "has_house": false,
  "parents_registered": false,
  "fcm_token": "fcm_token_string"
}
```

> `fcm_token` — FCM 푸시 알림 등록용, 선택 사항

**응답**
```json
{
  "user_id": "uuid",
  "score": {
    "total": 32,
    "homeless_years": 6.3,
    "homeless_score": 14,
    "dependents_score": 10,
    "savings_months": 48,
    "savings_score": 8
  },
  "upcoming_alert": null,
  "saved": true
}
```

---

### `POST /eligibility-precheck`

인증 없이 가점 계산 + 부적격 위험 항목 검증. 특정 공고 기준으로 평가.

**요청 Body**
```json
{
  "announcement_id": "uuid",
  "birth_date": "1990-01-15",
  "is_married": true,
  "marriage_date": "2020-06-01",
  "dependents_count": 1,
  "is_homeless": true,
  "homeless_since": "2018-03-01",
  "savings_start": "2016-05-01",
  "savings_balance_wan": 300,
  "resident_region": "서울",
  "has_house": false,
  "parents_registered": false
}
```

**응답**
```json
{
  "announcement_id": "uuid",
  "announcement": { "name": "래미안 원베일리", "region": "서울 서초구" },
  "eligible": true,
  "critical_count": 0,
  "warnings": [
    {
      "field": "savings_period",
      "severity": "critical",
      "message": "투기과열지구 1순위 요건: 청약통장 24개월 이상 — 현재 18개월",
      "detail": "..."
    }
  ],
  "score": {
    "total": 32,
    "homeless_score": 14,
    "dependents_score": 10,
    "savings_score": 8
  },
  "llm_summary": "..."
}
```

> `warnings[].severity`: `"critical"` (1순위 불가) | `"warning"` (주의) | `"info"` (참고)

---

## 청약 시뮬레이션

### `POST /simulate`

공고 기준 청약 프로세스 5단계 체크리스트 생성.

**요청 Body**
```json
{
  "announcement_id": "uuid",
  "supply_type": "일반공급",
  "user_profile": {
    "birth_date": "1990-01-15",
    "is_married": true,
    "dependents_count": 1,
    "is_homeless": true,
    "savings_start": "2016-05-01",
    "savings_balance_wan": 300,
    "resident_region": "서울",
    "has_house": false,
    "parents_registered": false
  }
}
```

> `supply_type`: `"일반공급"` `"특별공급_신혼부부"` `"특별공급_생애최초"` `"특별공급_다자녀"` `"특별공급_노부모"`  
> `user_profile`: 선택 사항 — 없으면 가점·부적격 체크 스킵

**응답**
```json
{
  "announcement_id": "uuid",
  "announcement": { "name": "...", "region": "서울 서초구", "period": "..." },
  "supply_type": "일반공급",
  "score": { "total": 32 },
  "eligibility_warnings": [],
  "total_steps": 5,
  "steps": [
    {
      "order": 1,
      "phase": "청약 전 (D-60 이전)",
      "title": "자격 요건 확인",
      "checklist": ["무주택 세대구성원 여부 확인", "..."],
      "warnings": [],
      "tips": ["청약홈 공인인증서 미리 등록"]
    }
  ],
  "llm_guide": "..."
}
```

---

## 공고 상세 분석

### `GET /compare`

2~5개 공고 항목 비교.

**쿼리 파라미터:** `ids` — 쉼표 구분 공고 ID (`"uuid1,uuid2,uuid3"`)

**응답**
```json
{
  "count": 3,
  "items": [
    {
      "announcement_id": "uuid",
      "name": "래미안 원베일리",
      "region": "서울",
      "total_units": 641,
      "price_assessment": { "assessment": "적정", "percentile": 65 },
      "location_score": 88,
      "has_elementary_within_300m": true,
      "nearest_elementary_m": 180,
      "walk_to_nearest_station_min": 7,
      "nearest_station": "반포역",
      "overall_score": 91,
      "overall_rank": 1
    }
  ],
  "winner": { "announcement_id": "uuid", "name": "래미안 원베일리" }
}
```

---

### `GET /similar-listings`

유사 공고 + 경쟁률·당첨 가점 예측.

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 |
|---------|------|-------|
| `announcement_id` | string | (필수) |
| `max_results` | int | `5` (최대 10) |

**응답**
```json
{
  "announcement_id": "uuid",
  "target": { "name": "...", "region": "서울", "size": "59㎡/84㎡", "constructor": "삼성물산" },
  "similar_count": 4,
  "items": [
    {
      "announcement_id": "uuid2",
      "name": "...",
      "similarity_score": 0.82,
      "score_breakdown": { "region": 1.0, "size": 0.9, "constructor": 0.5 },
      "competition_rate": 312.5,
      "winning_min_score": 58,
      "winning_avg_score": 63
    }
  ],
  "predicted": {
    "expected_competition_rate": 250,
    "expected_winning_score": 61,
    "confidence": "medium"
  },
  "llm_analysis": "..."
}
```

---

### `GET /location-score`

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | (필수) |
| `address` | string | 주소 (DB에 없을 때) |
| `lat` / `lng` | float | 좌표 직접 지정 |

**응답**
```json
{
  "announcement_id": "uuid",
  "location_score": 88,
  "category_scores": { "transport": 95, "school": 80, "commerce": 85 },
  "red_flags": []
}
```

---

### `GET /school-zone`

**쿼리 파라미터:** `announcement_id` (필수), `address`, `lat`, `lng`

**응답**
```json
{
  "announcement_id": "uuid",
  "has_elementary_within_300m": true,
  "nearest_elementary_m": 180,
  "elementary_within_300m": [{ "name": "반포초등학교", "distance_m": 180 }],
  "elementary_within_500m": [],
  "elementary_within_1km": []
}
```

---

### `GET /commute`

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | (필수) |
| `address` | string | 공고 주소 |
| `lat` / `lng` | float | 좌표 |
| `ad_claim` | string | 광고 문구 (`"역세권 도보 5분"`) |

**응답**
```json
{
  "announcement_id": "uuid",
  "nearest_station": "반포역",
  "walk_to_nearest_station_min": 7,
  "commute": {
    "강남역": { "transit_min": 12, "walk_min": 25 },
    "여의도": { "transit_min": 22, "walk_min": 55 }
  },
  "ad_claim_vs_reality": "광고 '도보 5분' vs 실측 7분 — 오차 2분 (허용 범위)"
}
```

---

### `GET /price-assessment`

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | (필수) |
| `address` | string | (필수) |
| `area_sqm` | float | 전용면적 ㎡ (필수) |
| `price_won` | int | 분양가 만원 단위 (필수) |

**응답**
```json
{
  "announcement_id": "uuid",
  "assessment": "적정",
  "percentile": 65,
  "price_per_pyeong": 4200
}
```

---

### `GET /development-news`

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | (필수) |
| `name` | string | 공고명 |
| `district` | string | 구/군 (필수) |
| `ad_text` | string | 광고 호재 문구 |

**응답**
```json
{
  "announcement_id": "uuid",
  "claimed_developments": ["GTX-A 예정"],
  "verified_developments": ["GTX-A 예정"],
  "marketing_only": [],
  "reliability_score": 90,
  "news_summary": ["GTX-A 2028년 개통 예정 — 사실 확인됨"]
}
```

---

### `GET /visit-checklist`

**쿼리 파라미터:** `announcement_id` (필수)

**응답**
```json
{
  "announcement_id": "uuid",
  "checklist": [
    { "timing": "모델하우스 방문 전", "action": "분양가 주변 시세 비교 확인" },
    { "timing": "현장 방문 시", "action": "역까지 직접 걸어보기" }
  ],
  "priority_count": 3,
  "data_available": { "commute": true, "school": true, "location": true }
}
```

---

---

## 공고 변경 이력

> 인증 불필요 (❌). 공개 정보. 크롤러가 공고를 upsert할 때 자동으로 diff를 기록.

### `GET /announcement-changes?announcement_id={id}` ❌

특정 공고의 변경(정정) 내역. 파라미터 없이 호출하면 **400** — `announcement_id` 필수.

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `announcement_id` | string | **필수** | 공고 ID |
| `limit` | int | 50 | 최대 200 |

**응답 예시**
```json
{
  "announcement_id": "string",
  "announcement": { "name": "공고명", "region": "서울", "district": "강남구" },
  "has_changes": true,
  "total_changes": 8,
  "revision_count": 2,
  "last_changed_at": "2026-04-10T09:00:00Z",
  "groups": [
    {
      "detected_at": "2026-04-10T09:00:00Z",
      "changes": [
        {
          "id": "uuid",
          "field": "rcept_end",
          "field_label_ko": "청약 마감일",
          "change_type": "updated",
          "old_value": "2026-04-15",
          "new_value": "2026-04-20",
          "source": "crawl-apt"
        }
      ]
    }
  ],
  "flat": [ ... ]
}
```

---

### `GET /announcement-changes/recent` ❌

전체 공고 중 최근 변경 목록 (대시보드·운영자용)

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `limit` | int | 50 | 최대 200 |
| `since_hours` | int | 24 | 최근 N시간 이내 (최대 720) |

**응답 예시**
```json
{
  "since": "2026-04-25T00:00:00Z",
  "since_hours": 24,
  "total": 12,
  "changes": [
    {
      "id": "uuid",
      "announcement_id": "string",
      "field": "rcept_end",
      "field_label_ko": "청약 마감일",
      "change_type": "updated",
      "old_value": "...",
      "new_value": "...",
      "detected_at": "...",
      "announcements": { "name": "...", "region": "서울", "district": "강남구" }
    }
  ]
}
```

**Flutter 예시**
```dart
// 특정 공고 변경 이력
final res = await supabase.functions.invoke(
  'announcement-changes',
  queryParameters: {'announcement_id': annId},
);

// 최근 변경 전체 (대시보드)
final recent = await supabase.functions.invoke(
  'announcement-changes/recent',
  queryParameters: {'since_hours': '48'},
);
```

---

## 서류함

> 인증 필수 (✅). RLS로 본인 서류만 격리. Supabase Storage `user-documents` bucket 연동. `status`는 DB 트리거가 자동 계산 (`ready` / `missing` / `expiring` / `expired`).

### `GET /documents` ✅

내 서류 목록 + 요약

**응답 예시**
```json
{
  "documents": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "doc_type": "resident_register",
      "doc_type_label_ko": "주민등록등본",
      "status": "ready",
      "issued_date": "2026-03-01",
      "expires_date": "2026-06-01",
      "validity_months": 3,
      "file_url": null,
      "file_storage_path": "user_id/1234567_파일명.pdf",
      "file_byte_size": 204800,
      "file_mime": "application/pdf",
      "notes": null,
      "created_at": "2026-04-01T00:00:00Z"
    }
  ],
  "summary": {
    "total": 5,
    "required": 3,
    "ready": 2,
    "missing": 1,
    "expiring": 1,
    "expired": 0
  }
}
```

**doc_type 허용값**
| 값 | 설명 |
|----|------|
| `resident_register` | 주민등록등본 |
| `family_relation` | 가족관계증명서 |
| `savings_account` | 청약통장 가입확인서 |
| `income_proof` | 소득증빙 |
| `homeless_proof` | 무주택증명 |
| `marriage_proof` | 혼인관계증명 |
| `children_proof` | 자녀(다자녀) 증명 |
| `other` | 기타 |

---

### `POST /documents` ✅

서류 등록

**요청 body**
```json
{
  "doc_type": "resident_register",       // 필수, 위 허용값 중 하나
  "doc_type_label_ko": "주민등록등본",    // 필수
  "issued_date": "2026-03-01",           // YYYY-MM-DD
  "expires_date": "2026-06-01",          // YYYY-MM-DD
  "validity_months": 3,                  // 0..120
  "file_url": null,                      // 외부 URL (선택)
  "file_storage_path": "user/...",       // Storage 경로 (upload-url 통해 얻은 값)
  "file_byte_size": 204800,
  "file_mime": "application/pdf",        // application/pdf | image/jpeg | image/png | image/heic
  "notes": "메모"
}
```

**응답 (201)**
```json
{ "document": { "id": "uuid", "status": "ready", ... } }
```

---

### `POST /documents/upload-url` ✅

Supabase Storage 직접 업로드 URL 발급 (파일 업로드 전 선행 호출)

**요청 body**
```json
{
  "filename": "주민등록등본.pdf",
  "mime": "application/pdf"
}
```

**응답 (200)**
```json
{
  "storage_path": "user_id/1714123456789_주민등록등본.pdf",
  "upload_url": "https://...supabase.co/storage/v1/...",
  "token": "...",
  "bucket": "user-documents"
}
```

> `upload_url`로 PUT 요청 → 업로드 완료 → `storage_path`를 `POST /documents`의 `file_storage_path`에 전달

---

### `PATCH /documents/{id}` ✅

서류 정보 수정 (`doc_type` 변경 불가)

**요청 body** (변경할 필드만)
```json
{
  "issued_date": "2026-04-01",
  "expires_date": "2026-07-01",
  "notes": "갱신본"
}
```

---

### `DELETE /documents/{id}` ✅

서류 삭제 (Storage 파일도 자동 삭제 시도)

**응답 (200)**
```json
{ "deleted": "uuid" }
```

**Flutter 파일 업로드 전체 흐름**
```dart
// 1. 업로드 URL 발급
final urlRes = await supabase.functions.invoke(
  'documents/upload-url',
  body: {'filename': 'doc.pdf', 'mime': 'application/pdf'},
  method: HttpMethod.post,
);
final uploadUrl = urlRes.data['upload_url'] as String;
final storagePath = urlRes.data['storage_path'] as String;

// 2. Storage 직접 PUT 업로드
final http.Response uploadResp = await http.put(
  Uri.parse(uploadUrl),
  headers: {'Content-Type': 'application/pdf'},
  body: fileBytes,
);

// 3. 서류 등록
final docRes = await supabase.functions.invoke(
  'documents',
  body: {
    'doc_type': 'resident_register',
    'doc_type_label_ko': '주민등록등본',
    'file_storage_path': storagePath,
    'file_byte_size': fileBytes.length,
    'file_mime': 'application/pdf',
    'issued_date': '2026-04-01',
    'validity_months': 3,
  },
  method: HttpMethod.post,
);
```


## 알림

### `GET /notifications` ✅

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 |
|---------|------|-------|
| `unread_only` | bool | `false` |
| `limit` | int | `20` (최대 100) |

**응답**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "favorite_dday",
      "title": "관심 공고 마감 D-3",
      "body": "래미안 원베일리 접수 마감이 3일 남았습니다.",
      "link": "https://...",
      "read_at": null,
      "created_at": "2026-04-23T10:00:00Z"
    }
  ],
  "unread_count": 2
}
```

### `POST /notifications` ✅

사용자 직접 알림 생성.

**요청 Body**
```json
{
  "type": "user_memo",
  "title": "청약 일정 메모",
  "body": "4/20 모델하우스 방문 예정",
  "link": "https://...",
  "related_announcement_id": "uuid"
}
```

> `type`: `"user_memo"` | `"favorite_dday"` | `"test"`

**응답:** 생성된 알림 객체 (HTTP 201)

### `PATCH /notifications/{id}/read` ✅

단일 알림 읽음 처리.

**응답:** `{ "id": "uuid", "read_at": "2026-04-26T14:00:00Z" }`

### `PATCH /notifications/read-all` ✅

전체 알림 읽음 처리.

**응답:** `{ "marked_read": 5, "read_at": "2026-04-26T14:00:00Z" }`

---

### `GET /notify`

Slack·Telegram 웹훅으로 공고 알림 발송 (서버 주도 알림).

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `webhook_url` | string | Slack 웹훅 URL |
| `telegram_token` | string | Telegram 봇 토큰 |
| `telegram_chat_id` | string | Telegram 채팅 ID |
| `category` | string | 공고 유형 필터 (기본 `all`) |
| `region` | string | 지역 필터 |
| `active_only` | bool | 접수 중만 (기본 `true`) |

**응답**
```json
{ "sent": 3, "channels": ["slack", "telegram"], "errors": null, "message": "알림 발송 완료" }
```

---

## 청약 준비 체크리스트

### `POST /preparation/init` ✅

체크리스트 초기화 — 일반공급 12개 + 특별공급 유형별 추가 항목 자동 생성.  
이미 초기화된 경우 기존 목록 그대로 반환 (중복 생성 없음).

**쿼리 파라미터**
| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|-------|------|
| `announcement_id` | string | (없음) | 연결할 공고 ID |
| `supply_types` | string | (프로필에서 자동) | 쉼표 구분 특별공급 유형 (`"신혼부부,생애최초"`) |

> `supply_types` 미지정 시 저장된 프로필의 `special_supply_interests` 자동 사용  
> 지원 값: `신혼부부` `생애최초` `다자녀` `노부모부양`

**응답** (HTTP 201)
```json
{
  "items": [
    {
      "id": "uuid",
      "category": "기본준비",
      "type": "자격",
      "title": "무주택 세대구성원 확인",
      "description": "본인·배우자·세대원 모두 주택 미보유",
      "due_offset_days": -14,
      "is_auto_checkable": true,
      "linked_doc_type": null,
      "is_done": false,
      "linked_document_status": null,
      "auto_done_by_doc": false,
      "effective_is_done": false,
      "sort_order": 20
    }
  ],
  "summary": { "total": 14, "done": 0, "auto_done": 0, "manual_done": 0, "pending": 14, "percent": 0 },
  "initialized": 14,
  "supply_types_used": ["신혼부부"]
}
```

---

### `GET /preparation` ✅

체크리스트 조회. `documents` 도메인과 자동 연동 — 서류 준비 완료 항목은 `effective_is_done: true` 자동 표시.

**쿼리 파라미터**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `announcement_id` | string | 특정 공고 필터 (없으면 전체) |

**응답**
```json
{
  "items": [
    {
      "id": "uuid",
      "category": "서류및결정",
      "type": "서류",
      "title": "주민등록등본 발급",
      "description": "공고일 이후 발급분 (3개월 이내)",
      "due_offset_days": -3,
      "linked_doc_type": "resident_register",
      "is_done": false,
      "linked_document_status": "ready",
      "auto_done_by_doc": true,
      "effective_is_done": true,
      "sort_order": 50
    }
  ],
  "summary": { "total": 14, "done": 3, "auto_done": 2, "manual_done": 1, "pending": 11, "percent": 21 }
}
```

> `effective_is_done` = `is_done` OR (`linked_doc_type` 있고 해당 document.status == `"ready"`)  
> `category`: `"기본준비"` | `"서류및결정"` | `"접수당일"`  
> `type`: `"자금"` | `"자격"` | `"서류"` | `"결정"` | `"접수"`

---

### `PATCH /preparation/{id}/done` ✅

항목 체크/언체크.

**요청 Body**
```json
{ "is_done": true }
```

**응답**
```json
{ "item": { "id": "uuid", "is_done": true, "done_at": "2026-04-26T14:00:00Z" } }
```

---

### `DELETE /preparation/{id}` ✅

불필요한 항목 삭제.

**응답:** `{ "deleted": "uuid" }`

---

## 리포트

### `POST /reports` ✅

분석 리포트 저장.

**요청 Body**
```json
{
  "notice_id": "uuid",
  "summary_markdown": "## 분석 결과\n...",
  "notice_url": "https://...",
  "title": "래미안 원베일리 분석",
  "match_score": 850,
  "verdict": "conditional_recommend",
  "confidence_score": 72,
  "key_points": [
    { "icon": "savings", "label": "분양가 우위", "value": "주변 대비 -15%", "tone": "positive" }
  ],
  "evidence": [
    { "category": "official_source", "icon": "format_quote", "title": "모집공고 원문", "citation": "...", "link": "..." },
    { "category": "official_db", "icon": "account_balance", "title": "청약홈 자격요건", "citation": "...", "link": "..." },
    { "category": "market_data", "icon": "monitoring", "title": "인근 실거래가", "citation": "...", "link": "..." }
  ],
  "charts_data": {
    "price_vs_market": { "target": { "size_sqm": 84, "price_eok": 9.5 }, "comparable": { "avg_eok": 11.2 }, "margin_eok": 1.7 },
    "competition_estimate": { "tier1_required_score": 60, "user_score": 54 }
  }
}
```

> `verdict` 허용값: `strong_recommend` | `conditional_recommend` | `caution` | `not_recommend`
> `key_points[].tone`: `positive` | `neutral` | `caution` | `negative`
> `evidence[].category`: `official_source` | `official_db` | `market_data` | `ai_inference`
> 마이그레이션 `020_reports_rich_fields.sql` DB 반영 필요 (Supabase SQL Editor)

### `GET /reports` ✅

**쿼리 파라미터:** `limit` (기본 20), `notice_id` (필터)

**응답**
```json
{
  "reports": [
    { "id": "uuid", "notice_id": "uuid", "title": "...", "match_score": 850, "created_at": "..." }
  ],
  "count": 1
}
```

### `GET /reports/{id}` ✅

리포트 상세 (summary_markdown 포함).

### `DELETE /reports/{id}` ✅

**응답:** `{ "deleted": "uuid" }`

---

## 시스템

### `GET /health`

```json
{ "status": "ok", "api_key_configured": true, "runtime": "supabase-edge" }
```

### `GET /cache-status`

```json
{
  "entries": [
    { "key": "apt", "items": 142, "age_seconds": 1200, "ttl_remaining": 2400 }
  ],
  "rate_limit": { "date": "2026-04-26", "count": 450, "limit": 9000 }
}
```

---

## 공통 에러 형식

```json
{ "error": "에러 메시지" }
```

| HTTP 상태 | 의미 |
|---------|------|
| `400` | 잘못된 요청 (필수 파라미터 누락 등) |
| `401` | 인증 필요 |
| `404` | 리소스 없음 |
| `405` | 허용되지 않는 메서드 |
| `500` | 서버 오류 |

---

## Flutter 연동 예시

```dart
// pubspec.yaml
// dependencies:
//   supabase_flutter: ^2.0.0

import 'package:supabase_flutter/supabase_flutter.dart';

await Supabase.initialize(
  url: 'https://xxxx.supabase.co',
  anonKey: 'eyJh...',
);

final supabase = Supabase.instance.client;

// 로그인
await supabase.auth.signInWithPassword(email: email, password: password);

// 공고 조회 (인증 불필요)
final res = await supabase.functions.invoke(
  'announcements',
  method: HttpMethod.get,
  queryParameters: {'category': 'apt', 'region': '서울', 'active_only': 'true'},
);

// 가점 계산 저장 (인증 필요 — 로그인 후 자동으로 JWT 첨부)
final scoreRes = await supabase.functions.invoke(
  'my-score',
  body: {
    'birth_date': '1990-01-15',
    'is_married': true,
    'dependents_count': 1,
    'is_homeless': true,
    'savings_start': '2016-05-01',
    'savings_balance_wan': 300,
    'resident_region': '서울',
    'has_house': false,
    'parents_registered': false,
  },
);

// 부적격 검증 (인증 불필요)
final checkRes = await supabase.functions.invoke(
  'eligibility-precheck',
  body: {
    'announcement_id': 'uuid',
    'birth_date': '1990-01-15',
    // ... 나머지 프로필 필드
  },
);
```

> `supabase_flutter` SDK는 로그인 후 모든 `functions.invoke` 호출에 JWT를 자동 첨부합니다.

