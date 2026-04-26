-- 013: 누락 RLS 패치 + user_profiles UUID 전환 + fcm_token 추가

-- ① notice_raw_rate_limit RLS (004_notice_raw.sql 누락분)
ALTER TABLE notice_raw_rate_limit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_only" ON notice_raw_rate_limit;
CREATE POLICY "service_only" ON notice_raw_rate_limit
  TO service_role USING (true) WITH CHECK (true);

-- ② user_profiles: TEXT → UUID 전환 + fcm_token 컬럼 추가
-- 이미 UUID로 됐으면 IF NOT EXISTS로 안전하게 처리
DO $$
BEGIN
  -- user_id 컬럼 타입 확인
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles'
      AND column_name = 'user_id'
      AND data_type = 'text'
  ) THEN
    -- TEXT 상태면 DROP 후 UUID로 재생성
    DROP TABLE IF EXISTS user_profiles;
    CREATE TABLE user_profiles (
      user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      profile    JSONB NOT NULL DEFAULT '{}'::jsonb,
      score      JSONB,
      fcm_token  TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "own_read"    ON user_profiles FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "own_write"   ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "own_update"  ON user_profiles FOR UPDATE USING (auth.uid() = user_id);
    CREATE POLICY "service_all" ON user_profiles TO service_role USING (true) WITH CHECK (true);
  ELSE
    -- 이미 UUID면 fcm_token 컬럼만 추가
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS fcm_token TEXT;
  END IF;
END $$;
