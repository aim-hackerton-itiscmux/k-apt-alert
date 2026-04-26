/** 국토부 실거래가 공개시스템 API 유틸. */

const RTMS_API_BASE =
  "http://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

const DISTRICT_TO_LAWD_CD: Record<string, string> = {
  // 서울 25구
  "종로구": "11110", "용산구": "11170", "성동구": "11200",
  "광진구": "11215", "동대문구": "11230", "중랑구": "11260",
  "성북구": "11290", "강북구": "11305", "도봉구": "11320",
  "노원구": "11350", "은평구": "11380", "서대문구": "11410",
  "마포구": "11440", "양천구": "11470", "구로구": "11530",
  "금천구": "11545", "영등포구": "11560", "동작구": "11590",
  "관악구": "11620", "서초구": "11650", "강남구": "11680",
  "송파구": "11710", "강동구": "11740",
  // 서울 중구/강서구는 타 지역과 이름 겹침 — 조합키로 처리
  "서울중구": "11140", "서울강서구": "11500",
  // 경기 주요시
  "수원시": "41110", "성남시": "41130", "고양시": "41280",
  "용인시": "41460", "화성시": "41590", "파주시": "41480",
  "김포시": "41570", "평택시": "41220", "하남시": "41450",
  "광명시": "41210", "시흥시": "41390", "남양주시": "41360",
  "안산시": "41270", "안양시": "41170", "부천시": "41190",
  "의정부시": "41150", "과천시": "41290",
  // 인천 주요구
  "연수구": "28185", "남동구": "28200", "부평구": "28237",
  "계양구": "28245", "미추홀구": "28177",
  // 부산 주요구
  "해운대구": "26350", "수영구": "26380", "동래구": "26260",
  "남구": "26290", "금정구": "26410",
  // 대구
  "수성구": "27290", "달서구": "27380",
  // 대전
  "유성구": "30170",
};

export interface Trade {
  areaSqm: number;
  priceManWon: number;
  year: number;
  month: number;
  buildYear: number;
}

export interface PriceAssessmentResult {
  announcement_id: string;
  price_per_pyeong: number;
  comparable_avg_per_pyeong: number;
  comparable_count: number;
  price_premium_pct: number;
  percentile: number;
  assessment: "저평가" | "적정" | "고평가" | "위험" | "데이터없음";
  comparable_period: string;
}

export function extractLawdCd(address: string): string | null {
  if (!address) return null;
  const parts = address.split(/[\s,]+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (DISTRICT_TO_LAWD_CD[part]) return DISTRICT_TO_LAWD_CD[part];
    if (i > 0) {
      const combined = parts[i - 1].replace(/특별시|광역시|특별자치시|도/, "") + part;
      if (DISTRICT_TO_LAWD_CD[combined]) return DISTRICT_TO_LAWD_CD[combined];
    }
  }
  return null;
}

export async function fetchTradeData(
  lawdCd: string,
  apiKey: string,
  months = 60,
): Promise<Trade[]> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const trades: Trade[] = [];

  const requests: Array<{ y: number; m: number; url: string }> = [];
  for (let i = 0; i < months; i++) {
    const totalMonths = now.getFullYear() * 12 + now.getMonth() - i;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    const dealYmd = `${y}${String(m).padStart(2, "0")}`;
    const url = new URL(RTMS_API_BASE);
    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("LAWD_CD", lawdCd);
    url.searchParams.set("DEAL_YMD", dealYmd);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "100");
    url.searchParams.set("_type", "json");
    requests.push({ y, m, url: url.toString() });
  }

  // 10개씩 병렬 처리
  for (let i = 0; i < requests.length; i += 10) {
    const batch = requests.slice(i, i + 10);
    await Promise.all(
      batch.map(async ({ y, m, url }) => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) return;
          const data = await r.json();
          let items = data?.response?.body?.items?.item ?? [];
          if (!Array.isArray(items)) items = [items];
          for (const item of items) {
            const area = parseFloat(String(item["전용면적"] ?? "0").trim());
            const priceStr = String(item["거래금액"] ?? "0").replace(/,/g, "").trim();
            const price = parseInt(priceStr, 10);
            const buildYear =
              parseInt(String(item["건축년도"] ?? "0").trim(), 10) || 0;
            if (buildYear >= currentYear - 5 && area > 0 && price > 0) {
              trades.push({ areaSqm: area, priceManWon: price, year: y, month: m, buildYear });
            }
          }
        } catch {
          // 개별 월 실패 무시
        }
      }),
    );
  }
  return trades;
}

function calcPricePerPyeong(priceManWon: number, areaSqm: number): number {
  const pyeong = areaSqm / 3.3;
  return pyeong > 0 ? priceManWon / pyeong : 0;
}

function calcPercentile(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 50;
  const below = distribution.filter((v) => v < value).length;
  return Math.round((below / distribution.length) * 100 * 10) / 10;
}

export function calcPriceAssessment(
  trades: Trade[],
  areaSqm: number,
  priceWon: number,
  announcementId: string,
): PriceAssessmentResult {
  if (trades.length === 0) {
    return {
      announcement_id: announcementId,
      price_per_pyeong: 0,
      comparable_avg_per_pyeong: 0,
      comparable_count: 0,
      price_premium_pct: 0,
      percentile: 50,
      assessment: "데이터없음",
      comparable_period: "",
    };
  }

  let comparables = trades.filter(
    (t) => Math.abs(t.areaSqm - areaSqm) <= areaSqm * 0.3,
  );
  if (comparables.length < 5) comparables = trades;

  const prices = comparables.map((t) =>
    calcPricePerPyeong(t.priceManWon, t.areaSqm)
  );
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const myPrice = calcPricePerPyeong(priceWon, areaSqm);
  const premiumPct =
    avg > 0 ? Math.round(((myPrice - avg) / avg) * 100 * 10) / 10 : 0;
  const percentile = calcPercentile(myPrice, prices);

  let assessment: PriceAssessmentResult["assessment"];
  if (percentile < 25) assessment = "저평가";
  else if (percentile < 50) assessment = "적정";
  else if (percentile < 75) assessment = "고평가";
  else assessment = "위험";

  const years = comparables.map((t) => t.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const minMonth = Math.min(
    ...comparables.filter((t) => t.year === minYear).map((t) => t.month),
  );
  const maxMonth = Math.max(
    ...comparables.filter((t) => t.year === maxYear).map((t) => t.month),
  );
  const period = `${minYear}-${String(minMonth).padStart(2, "0")} ~ ${maxYear}-${String(maxMonth).padStart(2, "0")}`;

  return {
    announcement_id: announcementId,
    price_per_pyeong: Math.round(myPrice),
    comparable_avg_per_pyeong: Math.round(avg),
    comparable_count: comparables.length,
    price_premium_pct: premiumPct,
    percentile,
    assessment,
    comparable_period: period,
  };
}
