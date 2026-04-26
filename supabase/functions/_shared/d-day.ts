/** D-day 계산 + active 판정. main.py _add_d_day, _is_active 포팅. */

import type { Announcement } from "./types.ts";

/** KST 오늘 자정 기준 Date 반환 (Edge Function은 UTC에서 실행되므로 +9h 보정). */
function kstToday(): Date {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = kstNow.getUTCFullYear();
  const m = String(kstNow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kstNow.getUTCDate()).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}

/** rcept_end 기반 D-day 계산. */
export function addDDay(ann: Announcement): Announcement {
  const rceptEnd = ann.rcept_end ?? "";
  if (rceptEnd && rceptEnd.length >= 8) {
    try {
      const fmt = rceptEnd.includes("-")
        ? rceptEnd.slice(0, 10)
        : `${rceptEnd.slice(0, 4)}-${rceptEnd.slice(4, 6)}-${rceptEnd.slice(6, 8)}`;
      const endDate = new Date(`${fmt}T00:00:00+09:00`);
      const today = kstToday();
      const delta = Math.floor((endDate.getTime() - today.getTime()) / 86_400_000);
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

/** active_only 필터.
 * - rcept_end 있으면: 오늘(KST) 이후인 경우만 true
 * - rcept_end 없으면: 상시접수 공고(임의공급·잔여세대·오피스텔 등)로 간주 → true
 */
export function isActive(ann: Announcement): boolean {
  const rceptEnd = String(ann.rcept_end ?? "");
  if (!rceptEnd || rceptEnd.length < 8) return true;
  try {
    const fmt = rceptEnd.includes("-")
      ? rceptEnd.slice(0, 10)
      : `${rceptEnd.slice(0, 4)}-${rceptEnd.slice(4, 6)}-${rceptEnd.slice(6, 8)}`;
    const endDate = new Date(`${fmt}T00:00:00+09:00`);
    const today = kstToday();
    return endDate >= today;
  } catch {
    return true;
  }
}
