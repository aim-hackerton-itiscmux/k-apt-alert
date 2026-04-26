-- 추가 분석 함수용 캐시 테이블 (school-zone, commute, development-news, similar-listings)
-- + 사용자 프로필 테이블
-- 004_cache_tables.sql과 동일한 RLS 패턴: public read + service_role write

-- 캐시 5종 (price/location은 004에서 이미 생성, IF NOT EXISTS로 멱등성)
DO $$ DECLARE t TEXT; BEGIN
  FOR t IN VALUES
    ('price_assessment_cache'),('location_score_cache'),
    ('school_zone_cache'),('commute_cache'),('development_news_cache')
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (
      announcement_id TEXT PRIMARY KEY,
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- 정책 중복 방지
    EXECUTE format($p$DROP POLICY IF EXISTS "public_read" ON %I$p$, t);
    EXECUTE format($p$DROP POLICY IF EXISTS "service_write" ON %I$p$, t);
    EXECUTE format($p$CREATE POLICY "public_read" ON %I FOR SELECT USING (true)$p$, t);
    EXECUTE format($p$CREATE POLICY "service_write" ON %I FOR ALL USING (auth.role() = 'service_role')$p$, t);
  END LOOP;
END $$;

-- similar_listings는 cache_key 기반 (announcement_id+필터 조합)
CREATE TABLE IF NOT EXISTS similar_listings_cache (
  cache_key TEXT PRIMARY KEY,
  announcement_id TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE similar_listings_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read"   ON similar_listings_cache;
DROP POLICY IF EXISTS "service_write" ON similar_listings_cache;
CREATE POLICY "public_read"   ON similar_listings_cache FOR SELECT USING (true);
CREATE POLICY "service_write" ON similar_listings_cache FOR ALL    USING (auth.role() = 'service_role');

-- 사용자 프로필 — 본인 또는 service_role만
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id    TEXT PRIMARY KEY,
  profile    JSONB NOT NULL DEFAULT '{}'::jsonb,
  score      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_profile" ON user_profiles;
CREATE POLICY "own_profile" ON user_profiles FOR ALL
  USING      (auth.uid()::text = user_id OR auth.role() = 'service_role')
  WITH CHECK (auth.uid()::text = user_id OR auth.role() = 'service_role');

-- 캐시 정리 cron 추가 (price/location은 이미 있음, 신규 4개)
SELECT cron.schedule('cleanup-school-zone-cache',     '0 3 1 * *',
  $$ DELETE FROM school_zone_cache       WHERE created_at < NOW() - INTERVAL '30 days' $$);
SELECT cron.schedule('cleanup-commute-cache',         '0 3 1 * *',
  $$ DELETE FROM commute_cache           WHERE created_at < NOW() - INTERVAL '30 days' $$);
SELECT cron.schedule('cleanup-development-news-cache','0 3 1 * *',
  $$ DELETE FROM development_news_cache  WHERE created_at < NOW() - INTERVAL '30 days' $$);
SELECT cron.schedule('cleanup-similar-listings-cache','0 3 1 * *',
  $$ DELETE FROM similar_listings_cache  WHERE created_at < NOW() - INTERVAL '30 days' $$);
