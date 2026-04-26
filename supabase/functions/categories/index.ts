/** GET /v1/apt/categories — 조회 가능한 청약 카테고리 목록 (정적). */

import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  return jsonResponse({
    categories: [
      { id: "apt", name: "APT 일반분양", description: "아파트 일반분양 (월 25일 배치 업데이트)" },
      { id: "officetell", name: "오피스텔/도시형", description: "오피스텔, 도시형생활주택, 민간임대 (실시간)" },
      { id: "lh", name: "LH 공공분양", description: "뉴홈, 행복주택 등 공공주택 (실시간)" },
      { id: "remndr", name: "APT 잔여세대", description: "미계약/미분양 재공급 — 청약통장 불필요" },
      { id: "pbl_pvt_rent", name: "공공지원민간임대", description: "시세 대비 저렴, 최대 10년 거주" },
      { id: "opt", name: "임의공급", description: "사업주체 자율 공급 — 선착순 계약" },
      { id: "sh", name: "SH 공공주택", description: "서울주택도시공사 — 장기전세·청년안심·매입임대 등" },
      { id: "gh", name: "GH 공공주택", description: "경기주택도시공사 — 경기행복주택·매입임대 등" },
    ],
  });
});
