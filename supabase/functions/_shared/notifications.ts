/** 알림 빌드 + 발송. main.py Slack/Telegram 포팅. */

import type { Announcement } from "./types.ts";

function urgencyIcon(dDay: number | null | undefined): string {
  const d = dDay ?? 99;
  if (d <= 1) return "🔴";
  if (d <= 3) return "🟡";
  return "🟢";
}

/** Slack Block Kit 페이로드 빌드. */
export function buildSlackBlocks(active: Announcement[]): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🏠 청약 공고 알림 (${active.length}건)`, emoji: true },
    },
    { type: "divider" },
  ];

  for (const ann of active.slice(0, 10)) {
    const location = `${ann.region ?? ""} ${ann.district ?? ""}`.trim();
    const icon = urgencyIcon(ann.d_day);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${icon} ${ann.name ?? "?"}* — ${location}\n` +
          `📅 ${ann.period ?? ""} | ⏰ ${ann.d_day_label ?? ""} | ` +
          `🏗️ ${ann.total_units ?? ""}세대 | 📂 ${ann.house_category ?? ""}\n` +
          `<${ann.url || "https://www.applyhome.co.kr"}|청약홈 바로가기>`,
      },
    });
  }

  if (active.length > 10) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `_...외 ${active.length - 10}건 더_` },
    });
  }

  return { blocks };
}

/** Telegram HTML parse_mode 메시지 빌드. */
export function buildTelegramText(active: Announcement[]): string {
  const lines: string[] = [
    `<b>🏠 청약 공고 알림 (${active.length}건)</b>`,
    "",
  ];

  for (const ann of active.slice(0, 10)) {
    const location = `${ann.region ?? ""} ${ann.district ?? ""}`.trim();
    const icon = urgencyIcon(ann.d_day);
    const name = ann.name ?? "?";
    const url = ann.url || "https://www.applyhome.co.kr";
    lines.push(`${icon} <b><a href="${url}">${name}</a></b> — ${location}`);
    lines.push(
      `📅 ${ann.period ?? ""} | ⏰ ${ann.d_day_label ?? ""} | ` +
        `🏗️ ${ann.total_units ?? ""}세대 | 📂 ${ann.house_category ?? ""}`,
    );
    lines.push("");
  }

  if (active.length > 10) {
    lines.push(`<i>...외 ${active.length - 10}건 더</i>`);
  }

  return lines.join("\n");
}

/** Slack webhook 발송. */
export async function sendSlack(
  webhookUrl: string,
  active: Announcement[],
): Promise<void> {
  const payload = buildSlackBlocks(active);
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Slack delivery failed: HTTP ${resp.status} — ${body.slice(0, 200)}`,
    );
  }

  const bodyText = await resp.text();
  if (bodyText && bodyText.trim() !== "ok") {
    throw new Error(
      `Slack 응답이 ok가 아님 — '${bodyText.slice(0, 200)}'. webhook URL 토큰을 확인하세요.`,
    );
  }
  console.log(`Slack notify sent: ${active.length} announcements`);
}

/** Telegram Bot API 발송. */
export async function sendTelegram(
  token: string,
  chatId: string,
  active: Announcement[],
): Promise<void> {
  const text = buildTelegramText(active);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Telegram delivery failed: HTTP ${resp.status} — ${body.slice(0, 200)}`,
    );
  }

  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Telegram API 응답 실패 — ${data.description ?? "unknown error"}`);
  }
  console.log(`Telegram notify sent: ${active.length} announcements to chat ${chatId}`);
}
