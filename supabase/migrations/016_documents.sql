-- 016: 사용자 청약 준비 서류함 (앱 '준비' 탭의 '내 서류함' 화면)
--
-- 화면 디자인 (Stitch project 16062927818472003315 / screen 07aac125):
-- - 서류 type 화이트리스트
-- - 상태: missing(미등록) | ready(준비완료) | expiring(갱신필요) | expired(만료)
-- - 발급일·만료일 + 유효 개월 자동 계산
-- - 진행률 "준비 완료 N / 필수 M"
-- - 파일은 Supabase Storage 'user-documents' bucket에 본인만 접근

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 서류 분류
  doc_type TEXT NOT NULL,                  -- 'resident_register' | 'family_relation' | 'savings_account' | 'income_proof' | 'homeless_proof' | 'other'
  doc_type_label_ko TEXT NOT NULL,         -- '주민등록등본' | '가족관계증명서' | '청약통장 가입확인서' | ...
  description TEXT,                        -- '최근 3개월 이내 발급분', '상세본 + 주민번호 뒷자리 포함'
  is_required BOOLEAN NOT NULL DEFAULT true,

  -- 상태 (status는 발급일+유효기간으로 자동 계산되지만, 트리거로 동기화 가능)
  status TEXT NOT NULL DEFAULT 'missing',  -- 'missing' | 'ready' | 'expiring' | 'expired'

  -- 유효성
  issued_date DATE,                        -- 발급일
  expires_date DATE,                       -- 만료일 (수동 또는 issued + validity_months)
  validity_months INT,                     -- 발급일 기준 유효 개월 (3 = 3개월). NULL이면 만료 없음

  -- 파일 (Storage)
  file_url TEXT,                           -- Supabase Storage signed URL or public URL
  file_storage_path TEXT,                  -- 'user-documents/{user_id}/{filename}' (delete 시 사용)
  file_byte_size INT,
  file_mime TEXT,                          -- 'application/pdf' | 'image/jpeg' | 'image/png'

  -- 메타
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT documents_status_chk CHECK (status IN ('missing', 'ready', 'expiring', 'expired')),
  CONSTRAINT documents_doc_type_chk CHECK (doc_type IN (
    'resident_register', 'family_relation', 'savings_account',
    'income_proof', 'homeless_proof', 'marriage_proof', 'children_proof', 'other'
  ))
);

CREATE INDEX idx_documents_user_status ON public.documents(user_id, status);
CREATE INDEX idx_documents_user_expires ON public.documents(user_id, expires_date)
  WHERE expires_date IS NOT NULL;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.set_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_documents_updated_at();

-- status 자동 계산 (issued_date + validity_months 기반)
-- INSERT/UPDATE 시 status를 발급일·만료일로 자동 결정
CREATE OR REPLACE FUNCTION public.compute_document_status()
RETURNS TRIGGER AS $$
DECLARE
  effective_expires DATE;
BEGIN
  -- expires_date가 명시되면 우선, 없으면 issued + validity 계산
  IF NEW.expires_date IS NOT NULL THEN
    effective_expires := NEW.expires_date;
  ELSIF NEW.issued_date IS NOT NULL AND NEW.validity_months IS NOT NULL THEN
    effective_expires := NEW.issued_date + (NEW.validity_months || ' months')::INTERVAL;
    NEW.expires_date := effective_expires;
  END IF;

  -- 파일 없으면 항상 missing
  IF NEW.file_url IS NULL OR NEW.file_url = '' THEN
    NEW.status := 'missing';
  ELSIF effective_expires IS NULL THEN
    NEW.status := 'ready';  -- 만료 없음
  ELSIF effective_expires < CURRENT_DATE THEN
    NEW.status := 'expired';
  ELSIF effective_expires < CURRENT_DATE + INTERVAL '7 days' THEN
    NEW.status := 'expiring';
  ELSE
    NEW.status := 'ready';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_compute_status
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_document_status();

-- RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_self_select" ON public.documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "documents_self_insert" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_self_update" ON public.documents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "documents_self_delete" ON public.documents
  FOR DELETE USING (auth.uid() = user_id);

-- service_role 우회 (cron 만료 알림 등)
CREATE POLICY "documents_service_all" ON public.documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────
-- Storage bucket: user-documents (수동 생성 필요 — Supabase 콘솔 또는 API)
-- ────────────────────────────────────────────────────────────────
-- 본 마이그레이션 적용 후 Supabase 콘솔/SQL Editor에서 1회 실행:
--
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('user-documents', 'user-documents', false)
--   ON CONFLICT (id) DO NOTHING;
--
-- 그리고 Storage RLS 정책:

-- 본인 폴더({user_id}/...)만 read/write/delete 가능
DO $$
BEGIN
  -- bucket이 없으면 정책 적용 실패하므로 안전하게 EXCEPTION 무시
  BEGIN
    DROP POLICY IF EXISTS "user_documents_self_read" ON storage.objects;
    CREATE POLICY "user_documents_self_read" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'user-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "user_documents_self_insert" ON storage.objects;
    CREATE POLICY "user_documents_self_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'user-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "user_documents_self_update" ON storage.objects;
    CREATE POLICY "user_documents_self_update" ON storage.objects
      FOR UPDATE USING (
        bucket_id = 'user-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "user_documents_self_delete" ON storage.objects;
    CREATE POLICY "user_documents_self_delete" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'user-documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'storage.objects policy skipped (bucket not yet created): %', SQLERRM;
  END;
END $$;
