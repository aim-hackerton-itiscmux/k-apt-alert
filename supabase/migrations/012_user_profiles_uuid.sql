-- user_profiles를 UUID 기반으로 재생성, auth.users FK 연결, fcm_token 컬럼 추가
-- (사용자 요청 [4]) — 008에서 만든 user_profiles는 user_id가 TEXT였음

DROP TABLE IF EXISTS user_profiles;

CREATE TABLE user_profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile    JSONB NOT NULL DEFAULT '{}'::jsonb,
  score      JSONB,
  fcm_token  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_read"    ON user_profiles FOR SELECT USING      (auth.uid() = user_id);
CREATE POLICY "own_write"   ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_update"  ON user_profiles FOR UPDATE USING      (auth.uid() = user_id);
CREATE POLICY "service_all" ON user_profiles TO service_role USING (true) WITH CHECK (true);
