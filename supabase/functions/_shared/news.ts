/** 네이버 뉴스 검색 API + 호재 키워드 추출 유틸. */

const NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json";

// 분양 광고에 자주 등장하는 호재 키워드 패턴
const DEVELOPMENT_PATTERNS: Record<string, string[]> = {
  "GTX":        ["GTX-A", "GTX-B", "GTX-C", "GTX"],
  "지하철":      ["지하철", "철도", "노선"],
  "역세권":      ["역세권", "지하철역"],
  "KTX":        ["KTX"],
  "신분당선":    ["신분당선"],
  "재개발":      ["재개발", "재건축"],
  "신도시":      ["신도시", "택지"],
  "도시개발":    ["도시개발"],
  "복합개발":    ["복합개발", "복합쇼핑"],
  "백화점":      ["백화점", "아울렛"],
  "공원":        ["공원", "녹지"],
  "학군":        ["학군", "학교"],
  "산업단지":    ["산업단지", "테크노밸리"],
};

export function extractKeywords(text: string): string[] {
  const found: string[] = [];
  for (const [keyword, patterns] of Object.entries(DEVELOPMENT_PATTERNS)) {
    if (patterns.some((p) => text.includes(p))) {
      found.push(keyword);
    }
  }
  return [...new Set(found)];
}

export interface NewsItem {
  keyword: string;
  article_count: number;
  latest_title: string | null;
  latest_date: string | null;
}

export async function searchNews(
  keyword: string,
  district: string,
  clientId: string,
  clientSecret: string,
): Promise<NewsItem> {
  const query = `${district} ${keyword}`;
  const url   = new URL(NAVER_NEWS_URL);
  url.searchParams.set("query",  query);
  url.searchParams.set("display", "5");
  url.searchParams.set("sort",    "date");

  try {
    const r = await fetch(url.toString(), {
      headers: {
        "X-Naver-Client-Id":     clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { keyword, article_count: 0, latest_title: null, latest_date: null };
    const data  = await r.json();
    const items: Array<{ title: string; pubDate: string }> = data.items ?? [];
    const latest = items[0];
    return {
      keyword,
      article_count: data.total ?? 0,
      latest_title:  latest ? latest.title.replace(/<[^>]+>/g, "") : null,
      latest_date:   latest?.pubDate ?? null,
    };
  } catch {
    return { keyword, article_count: 0, latest_title: null, latest_date: null };
  }
}

// 뉴스 기사 수 기반 신뢰도 판정
// 1년 내 기사가 많을수록 실현 가능성 높다고 가정
export function calcReliabilityScore(newsSummary: NewsItem[]): number {
  if (newsSummary.length === 0) return 0;
  const scores = newsSummary.map((n) => {
    if (n.article_count >= 100) return 100;
    if (n.article_count >= 30)  return 70;
    if (n.article_count >= 10)  return 40;
    if (n.article_count >= 1)   return 20;
    return 0;
  });
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
