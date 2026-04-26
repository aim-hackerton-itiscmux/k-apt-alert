/** PDF 첨부 텍스트 추출 — notice/raw 확장용.
 *
 * Deno에서 PDF 텍스트 추출:
 * - pdfjs-dist (Mozilla 공식) legacy 빌드를 esm.sh로 import
 * - worker 미사용 (간단한 텍스트 추출만, 폰트 렌더링 불필요)
 * - 페이지별 텍스트 join
 *
 * 안전장치:
 * - 다운로드 크기 상한 (10MB) — DoS 방지
 * - HTTP timeout 30초
 * - 페이지 수 상한 (100p) — 비정상 큰 PDF 차단
 * - 추출 실패해도 throw 안 함 (notice/raw 본문 유지)
 *
 * 사용 패턴:
 *   const result = await extractPdfText(url);
 *   if (result) {
 *     // result.text + result.page_count + result.byte_size 사용
 *   }
 */

import * as pdfjs from "https://esm.sh/pdfjs-dist@4.7.76/legacy/build/pdf.mjs";

const PDF_MAX_BYTES = 10 * 1024 * 1024;        // 10MB
const PDF_HTTP_TIMEOUT_MS = 30_000;
const PDF_MAX_PAGES = 100;

export interface PdfExtractResult {
  url: string;
  page_count: number;
  byte_size: number;
  text: string;
  truncated_pages: boolean;  // PDF_MAX_PAGES 초과로 잘렸는지
}

/** PDF URL 후보를 HTML에서 추출. <a href="...pdf">형태만 인식 (간단). */
export function findPdfAttachments(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const hrefPattern = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefPattern.exec(html)) !== null) {
    const raw = m[1];
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (!urls.includes(abs)) urls.push(abs);
    } catch {
      // invalid URL — skip
    }
  }
  return urls;
}

/** 단일 PDF URL → 텍스트. 실패 시 null. */
export async function extractPdfText(url: string): Promise<PdfExtractResult | null> {
  // 1. 다운로드 (크기 + timeout 보호)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PDF_HTTP_TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 k-apt-alert/3.0 (notice-pdf-extractor)" },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn(`PDF fetch ${url} → HTTP ${resp.status}`);
      return null;
    }
    const lengthHeader = resp.headers.get("content-length");
    if (lengthHeader && parseInt(lengthHeader, 10) > PDF_MAX_BYTES) {
      console.warn(`PDF ${url} too large (${lengthHeader} bytes), skip`);
      return null;
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > PDF_MAX_BYTES) {
      console.warn(`PDF ${url} too large after read (${buf.byteLength}), skip`);
      return null;
    }
    bytes = new Uint8Array(buf);
  } catch (e) {
    console.warn(`PDF fetch ${url} failed: ${e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  // 2. PDF 파싱
  try {
    // worker 비활성화 — Deno에서 worker 셋업 복잡, 텍스트 추출만 하므로 main thread OK
    // deno-lint-ignore no-explicit-any
    (pdfjs as any).GlobalWorkerOptions.workerSrc = "";

    // deno-lint-ignore no-explicit-any
    const loadingTask = (pdfjs as any).getDocument({
      data: bytes,
      disableWorker: true,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    const pagesToRead = Math.min(totalPages, PDF_MAX_PAGES);
    const truncatedPages = totalPages > PDF_MAX_PAGES;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pagesToRead; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        // deno-lint-ignore no-explicit-any
        const text = content.items.map((it: any) => it.str ?? "").join(" ");
        pageTexts.push(text);
      } catch (pageErr) {
        console.warn(`PDF ${url} page ${i} failed: ${pageErr}`);
        pageTexts.push("");
      }
    }

    // 페이지 구분자 — 추출 후 섹션 분할 시 도움
    const fullText = pageTexts
      .map((t, i) => `\n\n[Page ${i + 1}]\n${t}`)
      .join("")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      url,
      page_count: totalPages,
      byte_size: bytes.byteLength,
      text: fullText,
      truncated_pages: truncatedPages,
    };
  } catch (e) {
    console.warn(`PDF parse ${url} failed: ${e}`);
    return null;
  }
}

/** notice/raw 통합 헬퍼 — HTML 본문에서 PDF 첨부 발견 후 텍스트 합침.
 *
 * @param html 원본 HTML
 * @param baseUrl URL 절대화 기준
 * @param maxAttachments 최대 추출할 PDF 개수 (default 3)
 * @returns { merged_text, attachments } — merged_text는 PDF 텍스트(있으면)를 끝에 append
 */
export async function extractPdfsFromHtml(
  html: string,
  baseUrl: string,
  maxAttachments = 3,
): Promise<{ texts: PdfExtractResult[]; merged_extra: string }> {
  const urls = findPdfAttachments(html, baseUrl).slice(0, maxAttachments);
  if (urls.length === 0) return { texts: [], merged_extra: "" };

  const results: PdfExtractResult[] = [];
  for (const u of urls) {
    const r = await extractPdfText(u);
    if (r) results.push(r);
  }

  if (results.length === 0) return { texts: [], merged_extra: "" };

  const blocks = results.map((r) =>
    `\n\n--- 첨부 PDF: ${r.url} (${r.page_count}p, ${Math.round(r.byte_size / 1024)}KB${r.truncated_pages ? ", 일부 페이지만" : ""}) ---\n${r.text}`
  );
  return { texts: results, merged_extra: blocks.join("") };
}
