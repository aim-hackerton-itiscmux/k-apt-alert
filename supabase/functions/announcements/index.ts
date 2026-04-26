/** GET /v1/apt/announcements — 청약 공고 통합 조회. DB 기반. */

import { getSupabaseClient } from "../_shared/db.ts";
import { addDDay, isActive } from "../_shared/d-day.ts";
import { dedupAnnouncements, applyExtraFilters, applyReminderFilter } from "../_shared/filters.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { calcRiskFlags } from "../_shared/risk.ts";
import type { Announcement } from "../_shared/types.ts";

const ALL_CATEGORIES = ["apt", "officetell", "lh", "remndr", "pbl_pvt_rent", "opt", "sh", "gh"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? "all";
    const activeOnly = url.searchParams.get("active_only") !== "false";
    const region = url.searchParams.get("region") ?? "";
    const district = url.searchParams.get("district") ?? "";
    const minUnits = parseInt(url.searchParams.get("min_units") ?? "0", 10);
    const constructorContains = url.searchParams.get("constructor_contains") ?? "";
    const excludeIds = url.searchParams.get("exclude_ids") ?? "";
    const reminder = url.searchParams.get("reminder") ?? "";
    const withRisk = url.searchParams.get("risk_flags") !== "false"; // 기본 true

    const regionFilter = region
      ? new Set(region.split(",").map((r) => r.trim()).filter(Boolean))
      : new Set<string>();
    const districtFilter = district
      ? new Set(district.split(",").map((d) => d.trim()).filter(Boolean))
      : new Set<string>();

    const db = getSupabaseClient();
    const categories = category === "all" ? ALL_CATEGORIES : [category];

    if (category !== "all" && !ALL_CATEGORIES.includes(category)) {
      return jsonResponse({ error: `Invalid category: ${category}` }, 400);
    }

    let query = db.from("announcements").select("*").in("category", categories);

    if (regionFilter.size > 0) {
      query = query.or(
        `region.in.(${[...regionFilter].map((r) => `"${r}"`).join(",")}),region.eq.전국`,
      );
    }

    const { data: rows, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    let announcements: Announcement[] = (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      region: r.region,
      district: r.district,
      address: r.address,
      period: r.period,
      rcept_end: r.rcept_end,
      rcept_bgn: r.rcept_bgn,
      total_units: r.total_units,
      house_type: r.house_type,
      house_category: r.house_category,
      constructor: r.constructor,
      url: r.url,
      size: r.size,
      speculative_zone: r.speculative_zone,
      price_controlled: r.price_controlled,
      schedule_source: r.schedule_source,
      notice_date: r.notice_date ?? undefined,
      winner_date: r.winner_date ?? undefined,
      contract_start: r.contract_start ?? undefined,
      contract_end: r.contract_end ?? undefined,
    }));

    if (districtFilter.size > 0) {
      announcements = announcements.filter(
        (a) => !a.district || districtFilter.has(a.district),
      );
    }

    announcements = dedupAnnouncements(announcements);
    announcements = announcements.map(addDDay);
    if (activeOnly) announcements = announcements.filter(isActive);
    announcements = applyExtraFilters(announcements, minUnits, constructorContains, excludeIds);
    announcements = applyReminderFilter(announcements, reminder);

    // risk_flags enrichment (병렬)
    if (withRisk && announcements.length > 0) {
      const riskResults = await Promise.all(
        announcements.map((ann) => calcRiskFlags(ann, announcements, db)),
      );
      announcements = announcements.map((ann, i) => ({
        ...ann,
        risk_flags: riskResults[i],
      }));
    }

    const { data: metaRows } = await db
      .from("crawl_metadata")
      .select("crawled_at")
      .in("category", categories)
      .order("crawled_at", { ascending: true })
      .limit(1);

    const now = new Date();
    let maxAge = 0;
    let fetchedAt = now.toISOString().replace("T", " ").slice(0, 19);
    if (metaRows && metaRows.length > 0) {
      const oldest = new Date(metaRows[0].crawled_at);
      maxAge = Math.floor((now.getTime() - oldest.getTime()) / 1000);
      fetchedAt = oldest.toISOString().replace("T", " ").slice(0, 19);
    }

    return jsonResponse({
      count: announcements.length,
      announcements,
      errors: null,
      data_age_seconds: maxAge,
      fetched_at: fetchedAt,
      filters: {
        category,
        region: regionFilter.size > 0 ? [...regionFilter] : "all",
        district: districtFilter.size > 0 ? [...districtFilter] : "all",
        active_only: activeOnly,
        min_units: minUnits,
        constructor_contains: constructorContains || null,
        exclude_ids: excludeIds
          ? [...new Set(excludeIds.split(",").map((s) => s.trim()).filter(Boolean))]
          : null,
        reminder: reminder || null,
      },
    });
  } catch (e) {
    console.error(`announcements error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
