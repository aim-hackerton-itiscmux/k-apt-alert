-- 공고 데이터 (인메모리 캐시 대체)
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  period TEXT NOT NULL DEFAULT '',
  rcept_end TEXT NOT NULL DEFAULT '',
  rcept_bgn TEXT NOT NULL DEFAULT '',
  total_units TEXT NOT NULL DEFAULT '',
  house_type TEXT NOT NULL DEFAULT '',
  house_category TEXT NOT NULL DEFAULT '',
  constructor TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  speculative_zone TEXT NOT NULL DEFAULT '',
  price_controlled TEXT NOT NULL DEFAULT '',
  schedule_source TEXT NOT NULL DEFAULT 'api',
  notice_date TEXT,
  winner_date TEXT,
  contract_start TEXT,
  contract_end TEXT,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ann_category ON announcements(category);
CREATE INDEX idx_ann_region ON announcements(region);
CREATE INDEX idx_ann_rcept_end ON announcements(rcept_end);

-- 크롤 메타데이터 (캐시 timestamp 대체)
CREATE TABLE crawl_metadata (
  cache_key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  months_back INT NOT NULL DEFAULT 2,
  item_count INT NOT NULL DEFAULT 0,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds INT NOT NULL DEFAULT 600
);

-- 일일 API 호출 카운터 (인메모리 rate_counter 대체)
CREATE TABLE rate_limit (
  date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  call_count INT NOT NULL DEFAULT 0,
  daily_limit INT NOT NULL DEFAULT 9000
);

-- 일정 보강 캐시 (applyhome_page.py _schedule_cache 대체)
CREATE TABLE schedule_enrichment_cache (
  announcement_id TEXT PRIMARY KEY,
  rcept_bgn TEXT,
  rcept_end TEXT,
  period TEXT,
  winner_date TEXT,
  contract_start TEXT,
  contract_end TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: 공고 데이터는 공개 읽기 허용
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON announcements FOR SELECT USING (true);
