/** GET /v1/apt/notice/{id}/raw — 모집공고 본문 추출 (Phase 1 of notice-interpreter)
 *
 * - id로 announcements 테이블에서 url 조회 (A안)
 * - 실패 시 ?url= 폴백 (C안)
 * - 호스트 화이트리스트: applyhome.co.kr / apply.lh.or.kr
 * - 7일 캐시 (notice_raw_cache 테이블), force_refresh로 무효화
 * - 무료 30K cap, 유료 50~80K (Phase 1은 인증 미구현 — 무료 강제)
 */

import { getSupabaseClient } from "../_shared/db.ts";
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

const NOTICE_RAW_TTL_SECONDS = 7 * 24 * 3600;
const NOTICE_RAW_DAILY_LIMIT_FREE = 1000;
const TIER_LIMITS: Record<string, number> = { free: 30000, paid: 80000 };
const NOTICE_MAX_CHARS_DEFAULT = 30000;
const NOTICE_HTTP_TIMEOUT_MS = 15000;
const SUPPORTED_HOSTS = ["applyhome.co.kr", "apply.lh.or.kr"];

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["자격", /(?:신청\s*자격|입주자\s*자격|자격\s*요건|공급\s*대상)/g],
  ["공급일정", /(?:공급\s*일정|모집\s*일정|청약\s*일정|접수\s*일정)/g],
  ["공급금액", /(?:공급\s*(?:금액|가격)|분양\s*가|임대\s*보증금|공급\s*조건)/g],
  ["유의사항", /(?:유의\s*사항|주의\s*사항|참고\s*사항|기타\s*사항)/g],
];

function isSupportedHost(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return SUPPORTED_HOSTS.some((allowed) => host.includes(allowed));
  } catch {
    return false;
  }
}

function pickExtractorHost(url: string): "applyhome" | "lh" | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("applyhome.co.kr")) return "applyhome";
    if (host.includes("apply.lh.or.kr")) return "lh";
  } catch {}
  return null;
}

/** 단순 HTML → text. <script>/<style>/<nav>/<footer> 제거 후 텍스트만. */
function stripHtml(html: string): string {
  let cleaned = html;
  cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  cleaned = cleaned.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  cleaned = cleaned.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  // 줄 단위 분리를 위해 block element 닫는 태그 앞에 newline
  cleaned = cleaned.replace(/<\/(p|div|li|tr|h[1-6]|br|table|section)>/gi, "\n");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  // entity decode (간이)
  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 공백 정규화
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
}

function extractTitle(html: string, fallback = ""): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 200);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return stripHtml(h1Match[1]).slice(0, 200);
  return fallback;
}

/** 청약홈 본문 컨테이너 우선 추출. */
function extractApplyhome(html: string): { title: string; text: string } {
  const title = extractTitle(html);
  const containerMatch = html.match(
    /<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:cont|pblancCont|pblanc_cont|board-view|view-cont)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
  );
  const body = containerMatch ? containerMatch[1] : html;
  return { title, text: stripHtml(body) };
}

function extractLh(html: string): { title: string; text: string } {
  const title = extractTitle(html);
  const containerMatch = html.match(
    /<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:board-view|view-content|view-cont|content|bbs-view|cont-area)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
  );
  const body = containerMatch ? containerMatch[1] : html;
  return { title, text: stripHtml(body) };
}

function detectSections(text: string): Record<string, string> {
  const hits: Array<[number, string]> = [];
  for (const [label, pattern] of SECTION_PATTERNS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (m) hits.push([m.index, label]);
  }
  if (hits.length === 0) return {};
  hits.sort((a, b) => a[0] - b[0]);
  const sections: Record<string, string> = {};
  for (let i = 0; i < hits.length; i++) {
    const [start, label] = hits[i];
    const end = i + 1 < hits.length ? hits[i + 1][0] : text.length;
    if (!sections[label]) {
      sections[label] = text.slice(start, end).trim().slice(0, 5000);
    }
  }
  return sections;
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[... truncated]", truncated: true };
}

/** id로 announcements 테이블에서 url 조회 (A안). */
async function resolveUrlFromDb(noticeId: string): Promise<string | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("announcements")
    .select("url")
    .eq("id", noticeId)
    .maybeSingle();
  if (error || !data) return null;
  return data.url ?? null;
}

async function readCache(noticeId: string): Promise<{
  url: string;
  source: string;
  title: string;
  full_text: string;
  sections: Record<string, string>;
  fetched_at: string;
} | null> {
  const db = getSupabaseClient();
  const { data, error } = await db
    .from("notice_raw_cache")
    .select("url,source,title,full_text,sections,fetched_at")
    .eq("notice_id", noticeId)
    .maybeSingle();
  if (error || !data) return null;
  const fetchedAt = new Date(data.fetched_at);
  const ageSec = (Date.now() - fetchedAt.getTime()) / 1000;
  if (ageSec > NOTICE_RAW_TTL_SECONDS) return null;
  return data as never;
}

async function writeCache(
  noticeId: string,
  url: string,
  title: string,
  fullText: string,
  sections: Record<string, string>,
): Promise<void> {
  const db = getSupabaseClient();
  await db.from("notice_raw_cache").upsert(
    {
      notice_id: noticeId,
      url,
      source: "html",
      title,
      full_text: fullText,
      sections,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "notice_id" },
  );
}

async function invalidateCache(noticeId: string): Promise<void> {
  const db = getSupabaseClient();
  await db.from("notice_raw_cache").delete().eq("notice_id", noticeId);
}

async function checkRateLimit(): Promise<{ count: number; limit: number; exceeded: boolean }> {
  const db = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await db
    .from("notice_raw_rate_limit")
    .select("call_count,daily_limit_free")
    .eq("date", today)
    .maybeSingle();
  if (!row) {
    await db.from("notice_raw_rate_limit").insert({
      date: today,
      call_count: 1,
      daily_limit_free: NOTICE_RAW_DAILY_LIMIT_FREE,
    });
    return { count: 1, limit: NOTICE_RAW_DAILY_LIMIT_FREE, exceeded: false };
  }
  const newCount = row.call_count + 1;
  await db.from("notice_raw_rate_limit").update({ call_count: newCount }).eq("date", today);
  return {
    count: newCount,
    limit: row.daily_limit_free,
    exceeded: newCount > row.daily_limit_free,
  };
}

async function fetchAndExtract(
  url: string,
): Promise<{ title: string; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NOTICE_HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/3.0 (notice-interpreter)" },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const which = pickExtractorHost(url);
    if (which === "applyhome") return extractApplyhome(html);
    if (which === "lh") return extractLh(html);
    throw new Error(`no extractor for ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

function resolveTier(_authorization: string | null): "free" | "paid" {
  // Phase 1 스텁: 항상 free. Phase 2에서 Supabase JWT 검증으로 교체.
  return "free";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  try {
    const url = new URL(req.url);
    // 경로 패턴: /functions/v1/notice/{id}/raw
    const pathParts = url.pathname.split("/").filter(Boolean);
    const rawIdx = pathParts.indexOf("raw");
    if (rawIdx < 1) {
      return jsonResponse({ error: "expected /notice/{id}/raw" }, 400);
    }
    const noticeId = pathParts[rawIdx - 1];
    if (!noticeId) {
      return jsonResponse({ error: "missing notice id" }, 400);
    }

    const fallbackUrl = url.searchParams.get("url") ?? "";
    const requestedTier = url.searchParams.get("tier") ?? "free";
    const forceRefresh = url.searchParams.get("force_refresh") === "true";
    const requestedMaxChars = parseInt(
      url.searchParams.get("max_chars") ?? String(NOTICE_MAX_CHARS_DEFAULT),
      10,
    );

    const auth = req.headers.get("Authorization");
    const effectiveTier = resolveTier(auth);
    if (requestedTier === "paid" && effectiveTier !== "paid") {
      // 인증 실패 — free로 강등 (에러 X)
    }
    const cap = TIER_LIMITS[effectiveTier];
    const effectiveMaxChars = Math.min(
      Math.max(requestedMaxChars || NOTICE_MAX_CHARS_DEFAULT, 1000),
      cap,
    );
    const tierCapped = requestedMaxChars > cap;

    if (effectiveTier === "free") {
      const rl = await checkRateLimit();
      if (rl.exceeded) {
        return jsonResponse(
          { error: `Daily notice_raw limit exceeded (${rl.limit}). Upgrade to paid tier.` },
          429,
        );
      }
    }

    // id → url 해석 (A안 → C안 폴백)
    let resolvedUrl = await resolveUrlFromDb(noticeId);
    if (!resolvedUrl) resolvedUrl = fallbackUrl;
    if (!resolvedUrl) {
      return jsonResponse(
        {
          error: `id '${noticeId}' not in announcements DB. Provide ?url= as fallback.`,
        },
        404,
      );
    }
    if (!isSupportedHost(resolvedUrl)) {
      return jsonResponse(
        {
          error:
            `unsupported host. Phase 1 supports applyhome.co.kr and apply.lh.or.kr only. Got: ${resolvedUrl}`,
        },
        400,
      );
    }

    if (forceRefresh) await invalidateCache(noticeId);

    let cached = await readCache(noticeId);
    let cacheHit = !!cached;

    if (!cached) {
      try {
        const { title, text } = await fetchAndExtract(resolvedUrl);
        if (!text) {
          return jsonResponse({ error: "empty extracted text" }, 502);
        }
        const sections = detectSections(text);
        await writeCache(noticeId, resolvedUrl, title, text, sections);
        cached = {
          url: resolvedUrl,
          source: "html",
          title,
          full_text: text,
          sections,
          fetched_at: new Date().toISOString(),
        };
      } catch (e) {
        return jsonResponse({ error: `notice_raw extract failed: ${e}` }, 502);
      }
    }

    const { text: outText, truncated } = truncate(cached.full_text, effectiveMaxChars);

    return jsonResponse({
      id: noticeId,
      url: cached.url,
      source: cached.source,
      title: cached.title,
      extracted_at: cached.fetched_at,
      char_count: outText.length,
      truncated,
      sections: cached.sections,
      text: outText,
      tier: effectiveTier,
      effective_max_chars: effectiveMaxChars,
      tier_capped: tierCapped,
      cache_hit: cacheHit,
    });
  } catch (e) {
    console.error(`notice error: ${e}`);
    return jsonResponse({ error: String(e) }, 500);
  }
});
