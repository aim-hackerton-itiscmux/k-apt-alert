/** API URL, 타임아웃, 재시도 상수. proxy/config.py 포팅. */

export const DATA_GO_KR_API_KEY = Deno.env.get("DATA_GO_KR_API_KEY") ?? "";

export const API_REQUEST_TIMEOUT = 20_000; // ms
export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY = 2_000; // ms

const _BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";

// Detail APIs
export const APPLYHOME_API_URL = `${_BASE}/getAPTLttotPblancDetail`;
export const OFFICETELL_API_URL = `${_BASE}/getUrbtyOfctlLttotPblancDetail`;
export const REMNDR_API_URL = `${_BASE}/getRemndrLttotPblancDetail`;
export const PBL_PVT_RENT_API_URL = `${_BASE}/getPblPvtRentLttotPblancDetail`;
export const OPT_API_URL = `${_BASE}/getOPTLttotPblancDetail`;

// Mdl (size detail) APIs
export const APPLYHOME_MDL_API_URL = `${_BASE}/getAPTLttotPblancMdl`;
export const OFFICETELL_MDL_API_URL = `${_BASE}/getUrbtyOfctlLttotPblancMdl`;
export const REMNDR_MDL_API_URL = `${_BASE}/getRemndrLttotPblancMdl`;
export const PBL_PVT_RENT_MDL_API_URL = `${_BASE}/getPblPvtRentLttotPblancMdl`;
export const OPT_MDL_API_URL = `${_BASE}/getOPTLttotPblancMdl`;

export const LH_NOTICE_API_URL =
  "http://apis.data.go.kr/B552555/lhNoticeInfo1/getNoticeInfo1";

// 카테고리별 TTL (seconds)
export const CACHE_TTLS: Record<string, number> = {
  apt: 3600,
  pbl_pvt_rent: 1800,
  officetell: 600,
  lh: 600,
  remndr: 600,
  opt: 600,
  sh: 1800,
  gh: 1800,
};

export const DAILY_CALL_LIMIT = 9000;
