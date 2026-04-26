/** 일정 보강 (schedule enrichment). proxy/crawlers/applyhome_page.py 포팅.
 *
 * DB에서 rcept_end가 빈 applyhome 공고를 조회 → HTML fetch → 날짜 추출 → DB 업데이트.
 */

import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.48/deno-dom-wasm.ts";
import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

// 정규식 패턴 — HTML 구조 변경에도 견고
const RCEPT_SECTION_RE = /청약\s*접수/;
const DATE_RANGE_RE = /(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/;
const DATE_SINGLE_RE = /(\d{4}-\d{2}-\d{2})/g;
const NOTICE_DATE_RE = /(?:모집)?\s*공고일[^\d]*(\d{4}-\d{2}-\d{2})/;
const WINNER_DATE_RE = /당첨자\s*발표일?[^\d]*(\d{4}-\d{2}-\d{2})/;
const CONTRACT_RE = /계약(?:일|기간|체결)[^\d]*(\d{4}-\d{2}-\d{2})(?:\s*~\s*(\d{4}-\d{2}-\d{2}))?/;
const SECTION_TERMINATORS = /당첨자\s*발표|계약(?:일|기간|체결)|입주/;

interface ScheduleResult {
  rcept_bgn: string;
  rcept_end: string;
  period: string;
  notice_date: string;
  winner_date: string;
  contract_start: string;
  contract_end: string;
}

function extractRceptDates(text: string): [string, string] {
  const m = RCEPT_SECTION_RE.exec(text);
  if (!m) return ["", ""];
  let section = text.slice(m.index + m[0].length);
  const term = SECTION_TERMINATORS.exec(section);
  if (term) section = section.slice(0, term.index);
  section = section.slice(0, 800);

  const rm = DATE_RANGE_RE.exec(section);
  if (rm) return [rm[1], rm[2]];

  const dates = [...section.matchAll(DATE_SINGLE_RE)].map((x) => x[1]);
  if (dates.length === 0) return ["", ""];
  return [dates[0], dates[dates.length - 1]];
}

function parseHtml(html: string): ScheduleResult {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return { rcept_bgn: "", rcept_end: "", period: "", notice_date: "", winner_date: "", contract_start: "", contract_end: "" };

  // script/style 제거 후 텍스트만 추출
  for (const tag of doc.querySelectorAll("script, style")) {
    tag.remove();
  }
  const text = doc.body?.textContent ?? "";

  const result: ScheduleResult = {
    rcept_bgn: "",
    rcept_end: "",
    period: "",
    notice_date: "",
    winner_date: "",
    contract_start: "",
    contract_end: "",
  };

  const [bgnStr, endStr] = extractRceptDates(text);
  if (bgnStr) {
    result.rcept_bgn = bgnStr.replace(/-/g, "");
    result.rcept_end = endStr.replace(/-/g, "");
    result.period = endStr !== bgnStr ? `${bgnStr} ~ ${endStr}` : bgnStr;
  }

  let m = NOTICE_DATE_RE.exec(text);
  if (m) result.notice_date = m[1];

  m = WINNER_DATE_RE.exec(text);
  if (m) result.winner_date = m[1];

  m = CONTRACT_RE.exec(text);
  if (m) {
    result.contract_start = m[1];
    result.contract_end = m[2] || m[1];
  }

  return result;
}

async function fetchOne(annId: string, annUrl: string): Promise<ScheduleResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(annUrl, {
      headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/2.4" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    return parseHtml(html);
  } catch (e) {
    console.warn(`enrich fail ${annId}: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const db = getSupabaseClient();

    // rcept_end가 빈 applyhome 공고 조회
    const { data: targets, error } = await db
      .from("announcements")
      .select("id, url")
      .eq("rcept_end", "")
      .like("url", "%applyhome%")
      .limit(20);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    if (!targets || targets.length === 0) {
      return jsonResponse({ enriched: 0, message: "No announcements need enrichment" });
    }

    console.log(`Enriching ${targets.length} announcements from applyhome.co.kr`);

    let enriched = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    // 4건씩 청크로 병렬 처리
    for (let i = 0; i < targets.length; i += 4) {
      const chunk = targets.slice(i, i + 4);
      const results = await Promise.all(
        chunk.map((t) => fetchOne(t.id, t.url)),
      );

      for (let j = 0; j < chunk.length; j++) {
        const target = chunk[j];
        const sched = results[j];

        if (!sched || !sched.rcept_end) {
          // schedule_source를 unavailable로 업데이트
          await db
            .from("announcements")
            .update({ schedule_source: "unavailable", updated_at: now })
            .eq("id", target.id);
          continue;
        }

        // announcements 업데이트
        const { error: updateErr } = await db
          .from("announcements")
          .update({
            rcept_end: sched.rcept_end,
            rcept_bgn: sched.rcept_bgn,
            period: sched.period,
            notice_date: sched.notice_date || null,
            winner_date: sched.winner_date || null,
            contract_start: sched.contract_start || null,
            contract_end: sched.contract_end || null,
            schedule_source: "html_scraped",
            updated_at: now,
          })
          .eq("id", target.id);

        if (updateErr) {
          errors.push(`${target.id}: ${updateErr.message}`);
        } else {
          enriched++;
        }

        // schedule_enrichment_cache UPSERT
        await db.from("schedule_enrichment_cache").upsert(
          {
            announcement_id: target.id,
            rcept_bgn: sched.rcept_bgn,
            rcept_end: sched.rcept_end,
            period: sched.period,
            winner_date: sched.winner_date || null,
            contract_start: sched.contract_start || null,
            contract_end: sched.contract_end || null,
            fetched_at: now,
          },
          { onConflict: "announcement_id" },
        );
      }
    }

    console.log(`Enriched ${enriched}/${targets.length} announcements`);
    return jsonResponse({
      enriched,
      total_targets: targets.length,
      errors: errors.length ? errors : null,
    });
  } catch (e) {
    console.error(`crawl-enrich error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
