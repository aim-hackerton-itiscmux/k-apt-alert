/** 카카오 로컬 API 유틸 — 입지 점수 계산. */

const KAKAO_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";
const KAKAO_KEYWORD_URL  = "https://dapi.kakao.com/v2/local/search/keyword.json";
const KAKAO_ADDRESS_URL  = "https://dapi.kakao.com/v2/local/search/address.json";

export interface KakaoPlace {
  place_name: string;
  distance: string;
}

// [카테고리코드, 반경(m), 가중치점수]
const CATEGORY_CONFIG: Record<string, [string, number, number]> = {
  transit:    ["SW8", 1000, 25],
  school:     ["SC4", 1000, 20],
  mart:       ["MT1", 1000, 15],
  hospital:   ["HP8", 1000, 10],
  daycare:    ["PS3",  500, 10],
  restaurant: ["FD6",  500, 10],
};

// 혐오시설 [카테고리코드, 반경(m), 표시명]
const RED_FLAG_CATEGORIES: [string, number, string][] = [
  ["FN9", 200, "주유소"],
  ["OL7", 200, "충전소"],
  ["AC5", 300, "숙박업소"],
];

function distanceScore(distM: number): number {
  if (distM <= 500)  return 1.0;
  if (distM <= 1000) return 0.6;
  if (distM <= 2000) return 0.3;
  return 0;
}

export async function searchCategory(
  code: string, lat: number, lng: number, radius: number, apiKey: string,
): Promise<KakaoPlace[]> {
  const url = new URL(KAKAO_CATEGORY_URL);
  url.searchParams.set("category_group_code", code);
  url.searchParams.set("y", String(lat));
  url.searchParams.set("x", String(lng));
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "15");
  try {
    const r = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    return (await r.json()).documents ?? [];
  } catch { return []; }
}

async function searchKeyword(
  keyword: string, lat: number, lng: number, radius: number, apiKey: string,
): Promise<KakaoPlace[]> {
  const url = new URL(KAKAO_KEYWORD_URL);
  url.searchParams.set("query", keyword);
  url.searchParams.set("y", String(lat));
  url.searchParams.set("x", String(lng));
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", "5");
  try {
    const r = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    return (await r.json()).documents ?? [];
  } catch { return []; }
}

export async function geocodeAddress(
  address: string, apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(KAKAO_ADDRESS_URL);
  url.searchParams.set("query", address);
  url.searchParams.set("size", "1");
  try {
    const r = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const doc = (await r.json()).documents?.[0];
    if (!doc) return null;
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
  } catch { return null; }
}

export interface LocationScoreData {
  location_score: number;
  category_scores: Record<string, number>;
  red_flags: string[];
  nearest: Record<string, string>;
}

export async function calcLocationScore(
  lat: number, lng: number, apiKey: string,
): Promise<LocationScoreData> {
  const entries = Object.entries(CATEGORY_CONFIG);

  const [categoryResults, redFlagResults, funeralResults] = await Promise.all([
    Promise.all(entries.map(([, [code, radius]]) => searchCategory(code, lat, lng, radius, apiKey))),
    Promise.all(RED_FLAG_CATEGORIES.map(([code, radius]) => searchCategory(code, lat, lng, radius, apiKey))),
    searchKeyword("장례", lat, lng, 500, apiKey),
  ]);

  const categoryScores: Record<string, number> = {};
  const nearest: Record<string, string> = {};
  const nearestMap: Record<string, string> = {
    transit: "station", school: "school", mart: "mart", hospital: "hospital",
  };

  for (let i = 0; i < entries.length; i++) {
    const [key, [, radius, weight]] = entries[i];
    const docs = categoryResults[i];
    if (docs.length === 0) { categoryScores[key] = 0; continue; }
    const distM = parseFloat(docs[0].distance || String(radius + 1));
    const score = key === "restaurant"
      ? (docs.length >= 10 ? weight : Math.floor(weight * docs.length / 10))
      : Math.floor(weight * distanceScore(distM));
    categoryScores[key] = score;
    if (nearestMap[key]) nearest[nearestMap[key]] = `${docs[0].place_name} ${Math.floor(distM)}m`;
  }

  const total = Object.values(categoryScores).reduce((a, b) => a + b, 0);

  const redFlags: string[] = [];
  let deduction = 0;

  for (let i = 0; i < RED_FLAG_CATEGORIES.length; i++) {
    const [, radius, label] = RED_FLAG_CATEGORIES[i];
    const docs = redFlagResults[i];
    if (docs.length > 0) {
      const d = parseFloat(docs[0].distance || String(radius + 1));
      redFlags.push(`${label} ${Math.floor(d)}m`);
      deduction += 5;
    }
  }
  if (funeralResults.length > 0) {
    const d = parseFloat(funeralResults[0].distance || "500");
    redFlags.push(`장례식장 ${Math.floor(d)}m`);
    deduction += 10;
  }

  return {
    location_score: Math.max(0, Math.min(100, total - deduction)),
    category_scores: categoryScores,
    red_flags: redFlags,
    nearest,
  };
}
