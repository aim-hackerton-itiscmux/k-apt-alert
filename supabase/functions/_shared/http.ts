/** HTTP 호출 + 페이지네이션 + 재시도. crawlers/common.py 포팅. */

import {
  DATA_GO_KR_API_KEY,
  API_REQUEST_TIMEOUT,
  MAX_RETRIES,
  RETRY_BASE_DELAY,
} from "./config.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 단일 페이지 API 호출. 지수 백오프 재시도. */
export async function fetchPage(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const qs = new URLSearchParams(params).toString();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT);

      const resp = await fetch(`${url}?${qs}`, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const body = await resp.json();

      if (body.currentCount === 0 && body.matchCount === 0) return body;
      if (
        body.resultCode !== undefined &&
        !["00", "0", 0].includes(body.resultCode)
      ) {
        console.warn(`API error ${body.resultCode}: ${body.resultMsg}`);
        return null;
      }
      return body;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const wait = RETRY_BASE_DELAY * 2 ** attempt;
      console.warn(
        `Request failed (attempt ${attempt + 1}/${MAX_RETRIES}) — ${wait}ms wait: ${lastError.message}`,
      );
      await sleep(wait);
    }
  }
  console.error(`Final failure (${MAX_RETRIES} attempts): ${lastError?.message}`);
  return null;
}

/** 페이지네이션 순회하며 전체 항목 수집. */
export async function fetchAllPages(
  apiUrl: string,
  startmonth: string,
  endmonth: string,
  rows = 50,
): Promise<Record<string, unknown>[]> {
  const allItems: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    const params: Record<string, string> = {
      serviceKey: DATA_GO_KR_API_KEY,
      pageNo: String(page),
      numOfRows: String(rows),
      startmonth,
      endmonth,
    };

    const body = await fetchPage(apiUrl, params);
    if (!body) break;

    const items = (body.data as Record<string, unknown>[]) ?? [];
    if (items.length === 0) break;

    allItems.push(...items);

    const total =
      (body.matchCount as number) ??
      (body.totalCount as number) ??
      items.length;
    if (page * rows >= total) break;
    page++;
  }

  return allItems;
}

const SIZE_ORDER = ["소형", "중형", "대형"];

/** Mdl API 호출 -> {PBLANC_NO: size_str} 반환. */
export async function fetchSizeMap(
  mdlUrl: string,
  startmonth: string,
  endmonth: string,
): Promise<Record<string, string>> {
  const allItems = await fetchAllPages(mdlUrl, startmonth, endmonth, 100);

  const areasById: Record<string, number[]> = {};
  for (const item of allItems) {
    if (typeof item !== "object" || item === null) continue;
    const pblancNo = String(
      (item as Record<string, unknown>).PBLANC_NO ??
        (item as Record<string, unknown>).HOUSE_MANAGE_NO ??
        "",
    );
    if (!pblancNo) continue;
    const areaStr = String(
      (item as Record<string, unknown>).SUPLY_AR ??
        (item as Record<string, unknown>).HOUSE_TY ??
        "",
    );
    const area = parseFloat(areaStr);
    if (isNaN(area)) continue;
    if (!areasById[pblancNo]) areasById[pblancNo] = [];
    areasById[pblancNo].push(area);
  }

  const sizeMap: Record<string, string> = {};
  for (const [pblancNo, areas] of Object.entries(areasById)) {
    const categories = new Set<string>();
    for (const a of areas) {
      if (a < 60) categories.add("소형");
      else if (a <= 85) categories.add("중형");
      else categories.add("대형");
    }
    if (categories.size > 0) {
      sizeMap[pblancNo] = [...categories]
        .sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))
        .join("/");
    }
  }

  return sizeMap;
}
