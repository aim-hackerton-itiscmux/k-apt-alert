/** /v1/announcement-changes — 공고 변경 내역 (정정공고 추적, 공개 읽기)
 *
 * 라우트:
 *   GET /v1/announcement-changes?announcement_id=X&limit=20
 *     → 본 공고의 변경 이력 (시간 역순) + 그룹핑된 timeline
 *
 *   GET /v1/announcement-changes/recent?limit=50&since_hours=24
 *     → 전체 공고 중 최근 변경 (운영자/대시보드용)
 *
 * 인증 불필요 — 공고 변경은 공개 정보. RLS도 public_read.
 *
 * 데이터 출처: 018_announcement_changes.sql의 announcements UPDATE 트리거
 * (crawl-* 함수가 announcements row를 upsert할 때 자동으로 diff 감지·기록).
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

interface ChangeRow {
  id: string;
  announcement_id: string;
  detected_at: string;
  field: string;
  field_label_ko: string;
  change_type: "updated" | "added" | "removed";
  old_value: string | null;
  new_value: string | null;
  source: string;
}

/** 같은 detected_at(±5초)에 발생한 변경들을 한 그룹으로 묶음 — UI에서 "정정공고 1건" 단위 표시 */
function groupByDetectionWindow(rows: ChangeRow[]): Array<{
  detected_at: string;
  changes: ChangeRow[];
}> {
  const groups: Array<{ detected_at: string; changes: ChangeRow[] }> = [];
  const WINDOW_MS = 5_000;
  let currentGroup: { detected_at: string; changes: ChangeRow[] } | null = null;

  for (const row of rows) {
    const t = new Date(row.detected_at).getTime();
    if (currentGroup) {
      const groupT = new Date(currentGroup.detected_at).getTime();
      if (Math.abs(t - groupT) <= WINDOW_MS) {
        currentGroup.changes.push(row);
        continue;
      }
    }
    currentGroup = { detected_at: row.detected_at, changes: [row] };
    groups.push(currentGroup);
  }
  return groups;
}

async function handleSingleAnnouncement(req: Request, announcementId: string): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10)));

  const db = getSupabaseClient();

  // 공고 메타 같이 조회 (UI 헤더용)
  const [annResp, changesResp] = await Promise.all([
    db
      .from("announcements")
      .select("id,name,region,district,notice_date,rcept_end")
      .eq("id", announcementId)
      .maybeSingle(),
    db
      .from("announcement_changes")
      .select("*")
      .eq("announcement_id", announcementId)
      .order("detected_at", { ascending: false })
      .limit(limit),
  ]);

  if (annResp.error) {
    return jsonResponse({ error: `announcement read failed: ${annResp.error.message}` }, 500);
  }
  if (changesResp.error) {
    return jsonResponse({ error: `changes read failed: ${changesResp.error.message}` }, 500);
  }

  const changes = (changesResp.data ?? []) as ChangeRow[];
  const groups = groupByDetectionWindow(changes);

  return jsonResponse({
    announcement_id: announcementId,
    announcement: annResp.data ?? null,
    has_changes: changes.length > 0,
    total_changes: changes.length,
    revision_count: groups.length,                // 정정공고 횟수 추정 (그룹 수)
    last_changed_at: changes[0]?.detected_at ?? null,
    groups,                                       // UI 타임라인용 (정정 단위)
    flat: changes,                                // 시간 역순 평면 목록
  });
}

async function handleRecent(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10)));
  const sinceHours = Math.max(1, Math.min(720, parseInt(url.searchParams.get("since_hours") ?? "24", 10)));
  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

  const db = getSupabaseClient();
  const { data, error } = await db
    .from("announcement_changes")
    .select("*, announcements(name, region, district)")
    .gte("detected_at", since)
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) return jsonResponse({ error: `db error: ${error.message}` }, 500);

  return jsonResponse({
    since,
    since_hours: sinceHours,
    total: data?.length ?? 0,
    changes: data ?? [],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") {
    return jsonResponse({ error: `method ${req.method} not allowed` }, 405);
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const last = pathParts[pathParts.length - 1];

    // /functions/v1/announcement-changes/recent
    if (last === "recent") {
      return await handleRecent(req);
    }

    // /functions/v1/announcement-changes?announcement_id=X
    const announcementId = url.searchParams.get("announcement_id");
    if (!announcementId) {
      return jsonResponse(
        {
          error: "announcement_id query param required (or use /announcement-changes/recent for global)",
        },
        400,
      );
    }
    return await handleSingleAnnouncement(req, announcementId);
  } catch (e) {
    console.error(`announcement-changes error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
