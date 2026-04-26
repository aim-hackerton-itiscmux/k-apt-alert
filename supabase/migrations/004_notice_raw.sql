-- notice-interpreter Phase 1: 모집공고 raw 텍스트 캐시
-- 7일 TTL. force_refresh로 무효화 가능.
CREATE TABLE notice_raw_cache (
  notice_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'html',  -- html | pdf | unavailable
  title TEXT NOT NULL DEFAULT '',
  full_text TEXT NOT NULL,               -- 풀텍스트 보관, 응답 시 max_chars로 truncate
  sections JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notice_raw_fetched_at ON notice_raw_cache(fetched_at);

-- notice_raw 일일 호출 카운터 (announcements rate_limit과 별개)
CREATE TABLE notice_raw_rate_limit (
  date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  call_count INT NOT NULL DEFAULT 0,
  daily_limit_free INT NOT NULL DEFAULT 1000
);

-- 공개 읽기 허용 (캐시는 사용자별 격리 안 함 — 공개 공고문)
ALTER TABLE notice_raw_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON notice_raw_cache FOR SELECT USING (true);
