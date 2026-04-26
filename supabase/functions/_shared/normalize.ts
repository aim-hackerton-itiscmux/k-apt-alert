/** 데이터 표준화. crawlers/common.py 포팅. */

import type { Announcement } from "./types.ts";

export const AREA_CODE_MAP: Record<string, string> = {
  "100": "서울", "200": "인천", "300": "경기",
  "400": "부산", "401": "대구", "402": "광주", "403": "대전",
  "404": "울산", "405": "세종",
  "500": "강원", "600": "충북", "601": "충남",
  "700": "전북", "701": "전남", "712": "경북", "800": "경남", "900": "제주",
};

export const REGION_KEYWORDS: Record<string, string> = {
  "서울": "서울", "경기": "경기", "인천": "인천",
  "부산": "부산", "대구": "대구", "광주": "광주",
  "대전": "대전", "울산": "울산", "세종": "세종",
  "강원": "강원", "충북": "충북", "충남": "충남",
  "전북": "전북", "전남": "전남", "경북": "경북",
  "경남": "경남", "제주": "제주",
};

/** 주소에서 구/군/시(세부지역)를 추출한다. */
export function extractDistrict(address: string): string {
  if (!address) return "";
  const parts = address.split(/\s+/);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (/^[가-힣]+[구군]$/.test(part)) return part;
    if (/^[가-힣]+시$/.test(part)) {
      if (i + 1 < parts.length && /^[가-힣]+[구군]$/.test(parts[i + 1])) {
        return parts[i + 1];
      }
      return part;
    }
  }
  return "";
}

/** 청약홈 계열 API (APT/오피스텔/잔여/임대/임의) 공통 표준화. */
export function normalizeApplyhome(
  item: Record<string, unknown>,
  prefix: string,
  category: string,
): Announcement | null {
  try {
    const annId = String(item.PBLANC_NO ?? item.HOUSE_MANAGE_NO ?? "");
    if (!annId) return null;

    const areaCode = String(item.SUBSCRPT_AREA_CODE ?? "");
    const areaName =
      String(item.SUBSCRPT_AREA_CODE_NM ?? "") ||
      AREA_CODE_MAP[areaCode] ||
      "기타";

    const rceptBgn = String(item.RCEPT_BGNDE ?? "");
    const rceptEnd = String(item.RCEPT_ENDDE ?? "");
    const period = rceptBgn ? `${rceptBgn} ~ ${rceptEnd}` : "";

    const houseType =
      String(item.HOUSE_DTL_SECD_NM ?? "") ||
      String(item.HOUSE_SECD_NM ?? "");

    const address = String(item.HSSPLY_ADRES ?? "");

    return {
      id: prefix ? `${prefix}_${annId}` : annId,
      name: String(item.HOUSE_NM ?? ""),
      region: areaName,
      district: extractDistrict(address),
      address,
      period,
      rcept_end: rceptEnd,
      rcept_bgn: rceptBgn,
      total_units: String(item.TOT_SUPLY_HSHLDCO ?? ""),
      house_type: houseType,
      constructor: String(item.CNSTRCT_ENTRPS_NM ?? ""),
      url: String(item.PBLANC_URL ?? ""),
      speculative_zone: String(item.SPECLT_RDN_EARTH_AT ?? ""),
      price_controlled: String(item.CMPTT_PYMNT_CND_AT ?? ""),
      house_category: category,
      size: "",
      schedule_source: "api",
    };
  } catch (e) {
    console.warn(`Normalize failed (${category}): ${e}`);
    return null;
  }
}
