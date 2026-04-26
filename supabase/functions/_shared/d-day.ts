/** D-day 계산 + active 판정. main.py _add_d_day, _is_active 포팅. */

import type { Announcement } from "./types.ts";

/** rcept_end 기반 D-day 계산. */
export function addDDay(ann: Announcement): Announcement {
  const rceptEnd = ann.rcept_end ?? "";
  if (rceptEnd && rceptEnd.length >= 8) {
    try {
      const fmt = rceptEnd.includes("-") ? rceptEnd.slice(0, 10) : `${rceptEnd.slice(0, 4)}-${rceptEnd.slice(4, 6)}-${rceptEnd.slice(6, 8)}`;
      const endDate = new Date(fmt + "T00:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const delta = Math.floor(
        (endDate.getTime() - today.getTime()) / 86_400_000,
      );
      ann.d_day = delta;
      if (delta < 0) ann.d_day_label = "마감";
      else if (delta === 0) ann.d_day_label = "D-Day (오늘 마감)";
      else ann.d_day_label = `D-${delta}`;
    } catch {
      ann.d_day = null;
      ann.d_day_label = "";
    }
  } else {
    ann.d_day = null;
    ann.d_day_label = "";
  }
  return ann;
}

/** active_only 필터 — rcept_end가 오늘 이후면 true. */
export function isActive(ann: Announcement): boolean {
  const rceptEnd = String(ann.rcept_end ?? "");
  if (!rceptEnd || rceptEnd.length < 8) return false;
  try {
    const fmt = rceptEnd.includes("-") ? rceptEnd.slice(0, 10) : `${rceptEnd.slice(0, 4)}-${rceptEnd.slice(4, 6)}-${rceptEnd.slice(6, 8)}`;
    const endDate = new Date(fmt + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return endDate >= today;
  } catch {
    return false;
  }
}
