-- price-assessment / location-score 결과 캐시 (외부 API 호출 비용 절감)
-- 두 함수는 이미 cache 읽기/쓰기 코드가 있으나 테이블이 없어 매번 fresh fetch 중

CREATE TABLE IF NOT EXISTS price_assessment_cache (
  announcement_id TEXT PRIMARY KEY,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS location_score_cache (
  announcement_id TEXT PRIMARY KEY,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE price_assessment_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_score_cache   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_price"      ON price_assessment_cache FOR SELECT USING (true);
CREATE POLICY "service_write_price"    ON price_assessment_cache FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "public_read_location"   ON location_score_cache   FOR SELECT USING (true);
CREATE POLICY "service_write_location" ON location_score_cache   FOR ALL    USING (auth.role() = 'service_role');

-- 매월 1일 03:00 UTC, 30일 지난 캐시 삭제
SELECT cron.schedule('cleanup-price-cache',    '0 3 1 * *',
  $$ DELETE FROM price_assessment_cache WHERE created_at < NOW() - INTERVAL '30 days' $$
);
SELECT cron.schedule('cleanup-location-cache', '0 3 1 * *',
  $$ DELETE FROM location_score_cache   WHERE created_at < NOW() - INTERVAL '30 days' $$
);
