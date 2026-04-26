/** 카카오 Mobility Directions API 유틸 — 도보/대중교통 소요시간 계산. */

const MOBILITY_BASE = "https://apis-navi.kakaomobility.com/v1/directions";

export interface DirectionResult {
  duration_sec: number;
  distance_m: number;
}

async function fetchDirection(
  originLat: number, originLng: number,
  destLat: number,   destLng: number,
  priority: "DISTANCE" | "TIME" | "RECOMMEND",
  apiKey: string,
): Promise<DirectionResult | null> {
  const url = new URL(MOBILITY_BASE);
  url.searchParams.set("origin",      `${originLng},${originLat}`);
  url.searchParams.set("destination", `${destLng},${destLat}`);
  url.searchParams.set("priority",    priority);

  try {
    const r = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const route = data?.routes?.[0];
    if (!route || route.result_code !== 0) return null;
    const summary = route.summary;
    return {
      duration_sec: summary.duration,
      distance_m:   summary.distance,
    };
  } catch {
    return null;
  }
}

export const MAJOR_HUBS = {
  gangnam:     { lat: 37.4979, lng: 127.0276, name: "강남역" },
  gwanghwamun: { lat: 37.5749, lng: 126.9769, name: "광화문" },
  pangyo:      { lat: 37.3943, lng: 127.1110, name: "판교역" },
} as const;

export async function calcWalkMinutes(
  fromLat: number, fromLng: number,
  toLat: number,   toLng: number,
  apiKey: string,
): Promise<number | null> {
  const result = await fetchDirection(fromLat, fromLng, toLat, toLng, "DISTANCE", apiKey);
  if (!result) return null;
  return Math.round(result.duration_sec / 60);
}

export async function calcTransitMinutes(
  fromLat: number, fromLng: number,
  toLat: number,   toLng: number,
  apiKey: string,
): Promise<number | null> {
  const result = await fetchDirection(fromLat, fromLng, toLat, toLng, "TIME", apiKey);
  if (!result) return null;
  return Math.round(result.duration_sec / 60);
}
