# HANDOFF — 사용자가 처리할 일

> 코드·프록시·스킬·CI·문서는 모두 완료되었습니다. 아래는 **사람만 할 수 있는** 운영 체크리스트입니다.

## ☑ 즉시 해야 할 일 (실사용 시작)

### 1. 본인 프로필 등록
Claude Code에서 실행:
```
/korea-apt-alert setup
```
12개 항목 입력. 소요 2~3분. 결과는 `~/.config/k-skill/apt-alert-profile.json`에 저장됩니다.

### 2. 프로필 확인
```
/korea-apt-alert 내 가점 몇 점이야?
```
- 추정 가점 + 가점대별 전략 메시지가 나오는지 확인
- 이상하면 프로필 부분 업데이트: `/korea-apt-alert profile 혼인신고일만 수정`

### 3. 알림 받고 싶으면 Slack Webhook 설정
1. [Slack Webhook 생성](https://api.slack.com/messaging/webhooks) (본인 워크스페이스에서 발급)
2. URL 저장 위치 2곳 (둘 중 선택):
   - **로컬 전용**: `~/.config/k-skill/secrets.env`에 `KSKILL_APT_SLACK_WEBHOOK=...`
   - **GitHub Actions 자동 발송**: GitHub 레포 Settings → Secrets → `SLACK_WEBHOOK` 추가

---

## ☑ 운영자가 1회만 하면 되는 일

### 4. GitHub Actions Secrets 등록 (CI/자동 알림용)
레포 Settings → Secrets and variables → Actions → New repository secret:
- `PROXY_URL` = `https://k-apt-alert-proxy.onrender.com`
- `SLACK_WEBHOOK` = 본인 Webhook URL (자동 알림 원하는 경우만)

이미 `.github/workflows/warmup.yml`이 12분 간격으로 `/health` ping을 보내서 Render 슬립을 방지합니다. Secrets 없어도 동작.

### 5. Render 환경변수 재확인
[Render Dashboard](https://dashboard.render.com/) → k-apt-alert-proxy → Environment:
- ✅ `DATA_GO_KR_API_KEY` (공공데이터포털 무료 발급 키, 이미 등록됨)
- (선택) `SENTRY_DSN` — [Sentry](https://sentry.io/) 무료 계정에서 발급해서 에러 알림 받기

### 6. 공공데이터포털 API 키 만료일 확인
[공공데이터포털 마이페이지](https://www.data.go.kr/mypage/index.do) → 개발계정 → 신청 내역:
- 일반적으로 **2년 자동 연장**이지만 간혹 중단되는 경우 있음
- 1년에 한 번 확인 권장

---

## ☑ 주기적으로 확인 (월 1회 권장)

### 7. Render 로그 점검
Dashboard → Logs에서 에러 패턴 체크:
- `crawl failed` 다수 → 공공 API 응답 포맷 변경 가능성
- `Slack notify failed` 다수 → Webhook 유효성 점검

### 8. 캐시·Rate limit 상태 확인
```bash
curl https://k-apt-alert-proxy.onrender.com/v1/apt/cache
```
- `rate_limit.count`가 `limit` (9000) 근처면 호출 패턴 점검 필요
- 대부분 하루 수백 건 이내여야 정상

### 9. APT 월배치 업데이트 (매월 25일경)
APT 일반분양 데이터는 월 25일 전후 공공데이터포털이 갱신합니다. 캐시 TTL 60분이라 자동으로 반영되지만, 즉시 새 데이터 보려면 Render Dashboard에서 인스턴스 재시작해 캐시 초기화.

---

## ☑ 피드백 루프 (2주 후)

### 10. 지인 1~2명에게 공유 후 실사용 피드백 수집
페르소나 8명은 가상입니다. 실제 사용자가 발견하는 예상 밖 케이스가 가장 값집니다.

공유 방법:
```bash
# 지인이 할 일 — 스킬 설치 후 사용 (Claude Code 기준)
git clone https://github.com/tkddnjs-dlqslek/k-apt-alert.git
mkdir -p ~/.claude/skills
cp -r k-apt-alert/korea-apt-alert ~/.claude/skills/
# Claude Code 재시작 후 /korea-apt-alert setup

# Codex CLI 사용자라면 ~/.agents/skills/ 로 복사
```

피드백 수집 포인트:
- 프로필 질문 중 답하기 어려운 것?
- 가점 추정이 실제(청약홈 조회값)와 얼마나 다른지?
- Top 3 추천이 납득 가능한지?
- 매칭 0건 시 인접 지역 제안이 도움 됐는지?

---

## ☑ 선택 과제 (있으면 좋음)

### 11. Slack/Telegram 알림 실제 테스트
```bash
# Python으로 직접 호출해 실제 Slack에 발송
python -c "
import requests
r = requests.post(
    'https://k-apt-alert-proxy.onrender.com/v1/apt/notify',
    params={
        'webhook_url': 'YOUR_SLACK_WEBHOOK',
        'region': '서울,경기,인천',
        'reminder': 'd3',
    }
)
print(r.status_code, r.text)
"
```
- 정상이면 `{"sent":N,"message":"Slack notification sent successfully"}`
- Webhook 잘못되면 502 + 상세 에러 메시지

### 12. 자동 알림 GitHub Actions 활성화 (원하는 경우)
`.github/workflows/` 아래에 추가 워크플로우 생성. 예시:

```yaml
# .github/workflows/daily-alert.yml
name: Daily apt alert
on:
  schedule:
    - cron: "0 22 * * *"  # 매일 오전 7시 KST (UTC 22시)
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "https://k-apt-alert-proxy.onrender.com/v1/apt/notify?region=서울,경기,인천&reminder=d3&webhook_url=${{ secrets.SLACK_WEBHOOK }}"
```

---

## ☑ 비상 대응

| 증상 | 원인 | 조치 |
|------|------|------|
| 프록시 응답 500 | Render 빌드 실패 | Dashboard → Events 확인, Rollback |
| 모든 카테고리 0건 | API 키 만료/정지 | 공공데이터포털에서 갱신 |
| Webhook 발송 실패 | Slack 채널 삭제/토큰 회전 | Webhook 재발급 후 secrets 업데이트 |
| GitHub Actions 실패 | Secrets 미등록 | Settings → Secrets 확인 |

---

## 최종 상태 (2026-04-17 기준)

- **배포**: `b93c881` main
- **GitHub**: https://github.com/tkddnjs-dlqslek/k-apt-alert
- **프록시**: https://k-apt-alert-proxy.onrender.com
- **버전**: v2.3 (실사용 피드백 루프 반영)
- **컨벤션**: [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill) 호환 (`~/.config/k-skill/` 경로)

이후 변경사항이 생기면 이 문서와 MEMORY.md를 같이 갱신하세요.
