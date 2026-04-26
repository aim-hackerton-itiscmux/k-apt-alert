# HANDOFF — 사용자가 처리할 일

> 코드·백엔드·스킬·CI·문서는 모두 완료되었습니다. 아래는 **사람만 할 수 있는** 운영 체크리스트입니다.

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

### 4. Supabase 시크릿 등록
```bash
supabase link --project-ref xnyhzyvigazofjoozuub
supabase secrets set DATA_GO_KR_API_KEY=<공공데이터포털 키>
```

### 5. DB 마이그레이션 + Edge Functions 배포
```bash
supabase db push                         # 테이블 + pg_cron 스케줄 적용
supabase functions deploy --no-verify-jwt # 14개 Edge Functions 배포
```

### 6. GitHub Actions Secrets 등록 (CI/자동 알림용)
레포 Settings → Secrets and variables → Actions → New repository secret:
- `SLACK_WEBHOOK` = 본인 Webhook URL (자동 알림 원하는 경우만)

### 7. 공공데이터포털 API 키 만료일 확인
[공공데이터포털 마이페이지](https://www.data.go.kr/mypage/index.do) → 개발계정 → 신청 내역:
- 일반적으로 **2년 자동 연장**이지만 간혹 중단되는 경우 있음
- 1년에 한 번 확인 권장

---

## ☑ 주기적으로 확인 (월 1회 권장)

### 8. Supabase 로그 점검
Supabase Dashboard → Edge Functions → Logs에서 에러 패턴 체크:
- `crawl failed` 다수 → 공공 API 응답 포맷 변경 가능성
- `Slack notify failed` 다수 → Webhook 유효성 점검

### 9. 캐시·Rate limit 상태 확인
```bash
curl https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/cache-status
```
- `rate_limit.count`가 `limit` (9000) 근처면 호출 패턴 점검 필요
- 대부분 하루 수백 건 이내여야 정상

### 10. APT 월배치 업데이트 (매월 25일경)
APT 일반분양 데이터는 월 25일 전후 공공데이터포털이 갱신합니다. pg_cron이 10분 간격으로 자동 크롤링하므로 별도 조치 불필요.

---

## ☑ 피드백 루프 (2주 후)

### 11. 지인 1~2명에게 공유 후 실사용 피드백 수집
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

### 12. Slack/Telegram 알림 실제 테스트
```bash
curl -X POST "https://xnyhzyvigazofjoozuub.supabase.co/functions/v1/notify?webhook_url=YOUR_SLACK_WEBHOOK&region=%EC%84%9C%EC%9A%B8,%EA%B2%BD%EA%B8%B0,%EC%9D%B8%EC%B2%9C&reminder=d3"
```
- 정상이면 `{"sent":N,"channels":["slack"],"message":"Sent to slack"}`
- Webhook 잘못되면 502 + 상세 에러 메시지

### 13. 자동 알림 GitHub Actions 활성화 (원하는 경우)
`examples/user-automation/apt-notify.yml`을 참고하여 본인 레포에 복사.
매일 오전 7시 KST 자동 발송 (GitHub Actions cron).

---

## ☑ 비상 대응

| 증상 | 원인 | 조치 |
|------|------|------|
| Edge Function 응답 500 | 환경변수 누락 또는 코드 에러 | Dashboard → Edge Functions → Logs 확인 |
| 모든 카테고리 0건 | API 키 만료/정지 | 공공데이터포털에서 갱신, `supabase secrets set` |
| pg_cron 크롤링 안 됨 | pg_cron/pg_net 확장 비활성 | Dashboard → Database → Extensions 확인 |
| Webhook 발송 실패 | Slack 채널 삭제/토큰 회전 | Webhook 재발급 후 파라미터 업데이트 |
| GitHub Actions 실패 | Secrets 미등록 | Settings → Secrets 확인 |

---

## 최종 상태

- **배포**: Supabase Edge Functions (xnyhzyvigazofjoozuub)
- **GitHub**: https://github.com/tkddnjs-dlqslek/k-apt-alert
- **API**: https://xnyhzyvigazofjoozuub.supabase.co/functions/v1
- **버전**: v3.0 (Supabase 이전)
- **컨벤션**: [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill) 호환 (`~/.config/k-skill/` 경로)

이후 변경사항이 생기면 이 문서와 MEMORY.md를 같이 갱신하세요.
