/** 청약 경쟁률 + 당첨가점 공공데이터 유틸. */

import { DATA_GO_KR_API_KEY } from "./config.ts";
import { fetchPage } from "./http.ts";

const _BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const COMPETITION_API = `${_BASE}/getAPTLttotPblancCmpetNm`;
const WINNER_API      = `${_BASE}/getAPTLttotPblancWnnrNm`;

export interface CompetitionResult {
  pblanc_no: string;
  competition_rate: number | null;  // 평균 경쟁률
  winning_min_score: number | null; // 최저 당첨 가점 (일반공급)
  winning_avg_score: number | null; // 평균 당첨 가점
  sample_size: number;              // 집계된 타입 수
}

/** 공고번호로 경쟁률 + 당첨가점 조회. 없으면 null 필드로 반환. */
export async function fetchCompetition(pblancNo: string): Promise<CompetitionResult> {
  const result: CompetitionResult = {
    pblanc_no: pblancNo,
    competition_rate: null,
    winning_min_score: null,
    winning_avg_score: null,
    sample_size: 0,
  };

  const [compRes, winRes] = await Promise.allSettled([
    fetchPage(COMPETITION_API, {
      serviceKey: DATA_GO_KR_API_KEY,
      pageNo: "1",
      numOfRows: "50",
      PBLANC_NO: pblancNo,
    }),
    fetchPage(WINNER_API, {
      serviceKey: DATA_GO_KR_API_KEY,
      pageNo: "1",
      numOfRows: "50",
      PBLANC_NO: pblancNo,
    }),
  ]);

  if (compRes.status === "fulfilled" && compRes.value) {
    const items = (compRes.value.data as Record<string, unknown>[]) ?? [];
    const rates = items
      .map((i) => parseFloat(String(i["CMPET_RATE"] ?? "")))
      .filter((r) => !isNaN(r) && r > 0);
    if (rates.length > 0) {
      result.competition_rate =
        Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
      result.sample_size = rates.length;
    }
  }

  if (winRes.status === "fulfilled" && winRes.value) {
    const items = (winRes.value.data as Record<string, unknown>[]) ?? [];
    // PSSRP_SCORE: 일반공급 당첨 가점
    const scores = items
      .map((i) => parseFloat(String(i["PSSRP_SCORE"] ?? i["MIN_SCORE"] ?? "")))
      .filter((s) => !isNaN(s) && s > 0);
    if (scores.length > 0) {
      result.winning_min_score = Math.min(...scores);
      result.winning_avg_score =
        Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    }
  }

  return result;
}
