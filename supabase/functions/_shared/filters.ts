/** 필터 로직. main.py _dedup_announcements, _apply_extra_filters, _apply_reminder_filter 포팅. */

import type { Announcement } from "./types.ts";

/** ID 기준 1차 + name+region+district 기준 2차 중복 제거. */
export function dedupAnnouncements(announcements: Announcement[]): Announcement[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const unique: Announcement[] = [];

  for (const ann of announcements) {
    const annId = ann.id;
    if (seenIds.has(annId)) continue;
    seenIds.add(annId);

    const baseName = (ann.name ?? "").split("(")[0].trim();
    const nameKey = `${baseName}|${ann.region}|${ann.district}`;
    if (baseName && seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);

    unique.push(ann);
  }
  return unique;
}

/** 세대수·시공사·제외 ID 필터. */
export function applyExtraFilters(
  anns: Announcement[],
  minUnits: number,
  constructorContains: string,
  excludeIds: string,
): Announcement[] {
  const exclude = excludeIds
    ? new Set(excludeIds.split(",").map((s) => s.trim()).filter(Boolean))
    : new Set<string>();
  const kwList = constructorContains
    ? constructorContains.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  return anns.filter((a) => {
    if (exclude.size && exclude.has(String(a.id))) return false;
    if (minUnits > 0) {
      const u = parseInt(String(a.total_units ?? "0").replace(",", "") || "0", 10);
      if (isNaN(u) || u < minUnits) return false;
    }
    if (kwList.length > 0) {
      const ctor = String(a.constructor ?? "").toLowerCase();
      if (!kwList.some((kw) => ctor.includes(kw))) return false;
    }
    return true;
  });
}

/** 리마인더 타입별 공고 필터. */
export function applyReminderFilter(
  anns: Announcement[],
  reminder: string,
): Announcement[] {
  if (!reminder) return anns;
  return anns.filter((a) => {
    const d = a.d_day;
    if (d == null) return false;
    if (reminder === "d3") return d >= 0 && d <= 3;
    if (reminder === "d1") return d >= 0 && d <= 1;
    if (reminder === "winners") return d >= -10 && d <= -7;
    if (reminder === "contract") return d >= -21 && d <= -14;
    return false;
  });
}
