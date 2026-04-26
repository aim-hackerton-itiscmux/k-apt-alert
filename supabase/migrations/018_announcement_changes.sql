-- 018: 공고 변경 내역 (정정공고 추적) — 앱 '공고 변경 내역' 화면
--
-- 화면 디자인 (Stitch project 16062927818472003315 / screen fe8d00f0):
-- - "정정공고 비교 리포트" — 공고일 vs 정정일 시점 비교
-- - 변경 type: 일정 변경 / 세대수 변경 / 서류 기준일 추가
-- - 시각화: 이전값 → arrow → 이후값
--
-- 자동 감지:
-- announcements 테이블 UPDATE 시 트리거가 OLD vs NEW 비교 → 변경 필드 감지
-- → announcement_changes에 자동 row insert. 크롤러 코드 변경 0.

CREATE TABLE public.announcement_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id TEXT NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,

  -- 변경 메타
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field TEXT NOT NULL,                  -- 'rcept_end' | 'total_units' | 'house_type' | ...
  field_label_ko TEXT NOT NULL,         -- '접수 마감일' | '총 세대수' | '주택 타입' | ...
  change_type TEXT NOT NULL,            -- 'updated' | 'added' | 'removed'

  -- 값 (TEXT로 통일 — 모든 필드 직렬화 가능)
  old_value TEXT,                       -- NULL이면 'added'
  new_value TEXT,                       -- NULL이면 'removed'

  -- 자동 감지 출처
  source TEXT NOT NULL DEFAULT 'auto_diff',  -- 'auto_diff' | 'manual'

  CONSTRAINT changes_change_type_chk CHECK (change_type IN ('updated', 'added', 'removed')),
  CONSTRAINT changes_source_chk CHECK (source IN ('auto_diff', 'manual'))
);

CREATE INDEX idx_changes_ann_detected ON public.announcement_changes(announcement_id, detected_at DESC);
CREATE INDEX idx_changes_detected ON public.announcement_changes(detected_at DESC);

-- RLS — 공고 변경은 공개 정보, 누구나 읽기. 쓰기는 service_role + 트리거.
ALTER TABLE public.announcement_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "changes_public_read" ON public.announcement_changes
  FOR SELECT USING (true);

CREATE POLICY "changes_service_write" ON public.announcement_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────
-- 자동 diff 감지 트리거
-- announcements UPDATE 시 OLD vs NEW 비교 → 변경 필드 자동 row insert
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.detect_announcement_diff()
RETURNS TRIGGER AS $$
DECLARE
  v_change_type TEXT;
BEGIN
  -- 추적 대상 필드별 비교 (NULL-safe IS DISTINCT FROM)

  -- 일정 (가장 중요)
  IF OLD.rcept_end IS DISTINCT FROM NEW.rcept_end THEN
    v_change_type := CASE
      WHEN OLD.rcept_end IS NULL OR OLD.rcept_end = '' THEN 'added'
      WHEN NEW.rcept_end IS NULL OR NEW.rcept_end = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'rcept_end', '접수 마감일', v_change_type, OLD.rcept_end, NEW.rcept_end);
  END IF;

  IF OLD.rcept_bgn IS DISTINCT FROM NEW.rcept_bgn THEN
    v_change_type := CASE
      WHEN OLD.rcept_bgn IS NULL OR OLD.rcept_bgn = '' THEN 'added'
      WHEN NEW.rcept_bgn IS NULL OR NEW.rcept_bgn = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'rcept_bgn', '접수 시작일', v_change_type, OLD.rcept_bgn, NEW.rcept_bgn);
  END IF;

  IF OLD.winner_date IS DISTINCT FROM NEW.winner_date THEN
    v_change_type := CASE
      WHEN OLD.winner_date IS NULL OR OLD.winner_date = '' THEN 'added'
      WHEN NEW.winner_date IS NULL OR NEW.winner_date = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'winner_date', '당첨자 발표일', v_change_type, OLD.winner_date, NEW.winner_date);
  END IF;

  IF OLD.contract_start IS DISTINCT FROM NEW.contract_start THEN
    v_change_type := CASE
      WHEN OLD.contract_start IS NULL OR OLD.contract_start = '' THEN 'added'
      WHEN NEW.contract_start IS NULL OR NEW.contract_start = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'contract_start', '계약 시작일', v_change_type, OLD.contract_start, NEW.contract_start);
  END IF;

  IF OLD.contract_end IS DISTINCT FROM NEW.contract_end THEN
    v_change_type := CASE
      WHEN OLD.contract_end IS NULL OR OLD.contract_end = '' THEN 'added'
      WHEN NEW.contract_end IS NULL OR NEW.contract_end = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'contract_end', '계약 종료일', v_change_type, OLD.contract_end, NEW.contract_end);
  END IF;

  IF OLD.notice_date IS DISTINCT FROM NEW.notice_date THEN
    v_change_type := CASE
      WHEN OLD.notice_date IS NULL OR OLD.notice_date = '' THEN 'added'
      WHEN NEW.notice_date IS NULL OR NEW.notice_date = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'notice_date', '모집공고일', v_change_type, OLD.notice_date, NEW.notice_date);
  END IF;

  -- 세대수
  IF OLD.total_units IS DISTINCT FROM NEW.total_units THEN
    v_change_type := CASE
      WHEN OLD.total_units IS NULL OR OLD.total_units = '' THEN 'added'
      WHEN NEW.total_units IS NULL OR NEW.total_units = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'total_units', '총 세대수', v_change_type, OLD.total_units, NEW.total_units);
  END IF;

  -- 주택 타입
  IF OLD.house_type IS DISTINCT FROM NEW.house_type THEN
    v_change_type := CASE
      WHEN OLD.house_type IS NULL OR OLD.house_type = '' THEN 'added'
      WHEN NEW.house_type IS NULL OR NEW.house_type = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'house_type', '주택 타입', v_change_type, OLD.house_type, NEW.house_type);
  END IF;

  -- URL (정정공고는 별도 PBLANC_URL일 수도)
  IF OLD.url IS DISTINCT FROM NEW.url THEN
    v_change_type := CASE
      WHEN OLD.url IS NULL OR OLD.url = '' THEN 'added'
      WHEN NEW.url IS NULL OR NEW.url = '' THEN 'removed'
      ELSE 'updated'
    END;
    INSERT INTO public.announcement_changes
      (announcement_id, field, field_label_ko, change_type, old_value, new_value)
    VALUES (NEW.id, 'url', '공고 URL', v_change_type, OLD.url, NEW.url);
  END IF;

  -- 의도적으로 추적 안 하는 필드: id, category, name, region, district, address,
  -- crawled_at, updated_at, schedule_source — 노이즈 방지

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_announcements_detect_diff
  AFTER UPDATE ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.detect_announcement_diff();
