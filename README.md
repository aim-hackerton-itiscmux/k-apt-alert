# k-apt-alert

한국 청약 공고 알리미 — Claude Code 스킬

공공데이터포털의 청약홈 분양정보 API를 프록시 서버 경유로 조회하여, 사용자가 **API 키 없이** 최신 청약 공고를 조회·분석·알림받을 수 있습니다.

## 구조

```
k-apt-alert/
├── korea-apt-alert/    ← Claude Code 스킬 (사용자가 설치)
│   └── SKILL.md
├── proxy/              ← 프록시 서버 (운영자가 배포)
│   ├── main.py
│   ├── config.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── crawlers/
└── render.yaml         ← Render 배포 설정
```

## 스킬 설치 (사용자)

```bash
# 스킬 폴더를 Claude Code 개인 스킬 디렉토리에 복사
cp -r korea-apt-alert ~/.claude/skills/

# 또는 프로젝트 스킬로 설치
cp -r korea-apt-alert .claude/skills/
```

설치 후 Claude Code에서 바로 사용:

```
/korea-apt-alert                     # 최신 청약 공고 전체 조회
/korea-apt-alert setup               # 개인 프로필 설정 (맞춤 추천)
/korea-apt-alert 서울 강남구 아파트     # 지역 + 구/군 필터링
/korea-apt-alert 내 조건에 맞는 청약    # 프로필 기반 맞춤 조회
/korea-apt-alert 내 가점 몇 점이야?    # 추정 가점 계산
/korea-apt-alert 청약이 뭐야?          # 초보 가이드
/korea-apt-alert --notify             # 조회 후 Slack/Telegram 발송
```

## 개인화 프로필

`/korea-apt-alert setup`으로 프로필을 설정하면 맞춤 추천을 받을 수 있습니다.

| 항목 | 설명 | 용도 |
|------|------|------|
| 출생연도 | 만 나이 계산 | 청약 자격 (만 19세+) |
| 선호 지역 | 복수 선택 | 지역 필터링 |
| 가구 구성 | 1인/신혼/기혼+자녀 등 | 특별공급 자격 판정 |
| 무주택 여부 | 무주택/1주택/다주택 | 자격 + 갈아타기 안내 |
| 청약통장 | 보유 여부 + 가입기간 | APT/LH 자격 + 가점 |
| 연소득 | 구간 선택 | LH/공공임대 소득 기준 |
| 선호 평형 | 소형/중형/대형 | 평형 필터링 |
| 혼인신고일 | 신혼부부 여부 | 신혼부부 특별공급 (7년 이내) |
| 거주 지역/기간 | 현재 거주지 | 지역민 우대 |
| 당첨 이력 | 과거 당첨 여부 | 재당첨 제한 확인 |
| 부양가족 수 | 본인 제외 | 가점제 계산 (최대 35점) |

프로필은 `~/.config/k-skill/apt-alert-profile.json`에 로컬 저장되며 서버로 전송되지 않습니다.

## 주요 기능

- **맞춤 추천**: 프로필 기반 자격 매칭 + 추천 카테고리 자동 판정
- **가점 추정**: 무주택 기간 + 부양가족 + 통장 기간 → 84점 만점 추정
- **특별공급 안내**: 신혼부부, 생애최초, 다자녀 자격 추정
- **1주택 갈아타기**: 유주택자도 가능한 유형 안내
- **초보 가이드**: 가점제/추첨제/특별공급 등 용어 설명
- **구/군 필터링**: 서울 강남구, 경기 분당구 등 세부 지역

## 알림 설정 (선택)

Slack 또는 Telegram으로 알림을 받으려면 `~/.config/k-skill/secrets.env`에 추가:

```env
KSKILL_APT_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../xxx
KSKILL_APT_TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
KSKILL_APT_TELEGRAM_CHAT_ID=-1001234567890
```

## 데이터 소스

| 카테고리 | 데이터 출처 | 업데이트 주기 |
|----------|------------|--------------|
| APT 일반분양 | 청약홈 API | 월 25일 배치 |
| 오피스텔/도시형 | 청약홈 API | 실시간 |
| LH 공공분양 | LH 공지 API | 실시간 |
| APT 잔여세대 | 청약홈 API | 실시간 |
| 공공지원민간임대 | 청약홈 API | 실시간 |
| 임의공급 | 청약홈 API | 실시간 |

## 프록시 서버 (운영자용)

### 로컬 실행

```bash
cd proxy
pip install -r requirements.txt
DATA_GO_KR_API_KEY=your_key uvicorn main:app --reload
# http://localhost:8000/docs 에서 API 문서 확인
```

### Render 배포

1. GitHub에 이 레포를 push
2. Render Dashboard → New Web Service → Connect repo
3. Environment Variable에 `DATA_GO_KR_API_KEY` 추가

`DATA_GO_KR_API_KEY`는 [공공데이터포털](https://www.data.go.kr/)에서 무료 발급 가능합니다.

## 프록시 API

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /health` | 서버 상태 확인 |
| `GET /v1/apt/announcements` | 청약 공고 조회 |
| `GET /v1/apt/categories` | 카테고리 목록 |

**쿼리 파라미터** (`/v1/apt/announcements`):

| 파라미터 | 기본값 | 설명 |
|---------|--------|------|
| `category` | `all` | `all`, `apt`, `officetell`, `lh`, `remndr`, `pbl_pvt_rent`, `opt` |
| `active_only` | `true` | 접수 마감 전 공고만 |
| `months_back` | `2` | 조회 기간 (1~12개월) |
| `region` | (전체) | 지역 필터 (쉼표 구분, 예: `서울,경기,인천`) |
| `district` | (전체) | 세부 지역 필터 (구/군, 쉼표 구분, 예: `강남구,서초구`) |

## FAQ

**Q. 프록시 서버가 응답하지 않아요**
A. Render free tier는 15분 비활성 시 슬립합니다. 첫 요청에 30초~1분 걸릴 수 있습니다.

**Q. 가점 계산이 정확한가요?**
A. 프로필 기반 추정치입니다. 정확한 가점은 [청약홈](https://www.applyhome.co.kr)에서 조회하세요.

**Q. 1주택자도 사용할 수 있나요?**
A. 네. 오피스텔, 잔여세대, 임의공급은 무주택 불문이며, 갈아타기 관련 안내도 제공합니다.

**Q. LH 공고의 지역이 "전국"으로 나와요**
A. LH 공고 제목에서 특정 지역을 추론할 수 없는 경우 "전국"으로 표시됩니다. 지역 필터 시 "전국" 공고는 항상 포함됩니다.

## License

MIT
