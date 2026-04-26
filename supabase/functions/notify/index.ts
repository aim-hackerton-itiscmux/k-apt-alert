/** POST /v1/apt/notify — 청약 공고 조회 후 Slack/Telegram 자동 발송. */

import { getSupabaseClient } from "../_shared/db.ts";
import { addDDay, isActive } from "../_shared/d-day.ts";
import { dedupAnnouncements, applyExtraFilters, applyReminderFilter } from "../_shared/filters.ts";
import { sendSlack, sendTelegram } from "../_shared/notifications.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import type { Announcement } from "../_shared/types.ts";

const ALL_CATEGORIES = ["apt", "officetell", "lh", "remndr", "pbl_pvt_rent", "opt", "sh", "gh"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    const webhookUrl = url.searchParams.get("webhook_url") ?? "";
    const telegramToken = url.searchParams.get("telegram_token") ?? "";
    const telegramChatId = url.searchParams.get("telegram_chat_id") ?? "";
    const category = url.searchParams.get("category") ?? "all";
    const activeOnly = url.searchParams.get("active_only") !== "false";
    const region = url.searchParams.get("region") ?? "";
    const district = url.searchParams.get("district") ?? "";
    const minUnits = parseInt(url.searchParams.get("min_units") ?? "0", 10);
    const constructorContains = url.searchParams.get("constructor_contains") ?? "";
    const excludeIds = url.searchParams.get("exclude_ids") ?? "";
    const reminder = url.searchParams.get("reminder") ?? "";

    const hasSlack = !!webhookUrl;
    const hasTelegram = !!(telegramToken && telegramChatId);

    if (telegramToken && !telegramChatId) {
      return jsonResponse(
        { error: "telegram_chat_id is required when telegram_token is provided" },
        400,
      );
    }
    if (!hasSlack && !hasTelegram) {
      return jsonResponse(
        { error: "Provide webhook_url (Slack) or telegram_token + telegram_chat_id" },
        400,
      );
    }

    const regionFilter = region
      ? new Set(region.split(",").map((r) => r.trim()).filter(Boolean))
      : new Set<string>();
    const districtFilter = district
      ? new Set(district.split(",").map((d) => d.trim()).filter(Boolean))
      : new Set<string>();

    // DB에서 공고 조회
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

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

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

    if (activeOnly) {
      announcements = announcements.filter(isActive);
    }

    announcements = applyExtraFilters(announcements, minUnits, constructorContains, excludeIds);

    if (announcements.length === 0) {
      return jsonResponse({ sent: 0, message: "No announcements to notify" });
    }

    let active: Announcement[];
    let emptyLabel: string;

    if (reminder) {
      active = applyReminderFilter(announcements, reminder);
      emptyLabel = `reminder=${reminder}`;
    } else {
      active = announcements.filter(
        (a) => a.d_day != null && (a.d_day ?? -1) >= 0,
      );
      emptyLabel = "active announcements";
    }

    if (active.length === 0) {
      return jsonResponse({ sent: 0, message: `No ${emptyLabel} to notify` });
    }

    active.sort((a, b) => (a.d_day ?? 999) - (b.d_day ?? 999));

    const channelsSent: string[] = [];
    const channelErrors: Record<string, string> = {};

    if (hasSlack) {
      try {
        await sendSlack(webhookUrl, active);
        channelsSent.push("slack");
      } catch (e) {
        channelErrors["slack"] = String(e);
      }
    }

    if (hasTelegram) {
      try {
        await sendTelegram(telegramToken, telegramChatId, active);
        channelsSent.push("telegram");
      } catch (e) {
        channelErrors["telegram"] = String(e);
      }
    }

    if (channelsSent.length === 0) {
      return jsonResponse(
        { error: "All configured channels failed", errors: channelErrors },
        502,
      );
    }

    return jsonResponse({
      sent: active.length,
      channels: channelsSent,
      errors: Object.keys(channelErrors).length > 0 ? channelErrors : null,
      message: `Sent to ${channelsSent.join(", ")}`,
    });
  } catch (e) {
    console.error(`notify error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
