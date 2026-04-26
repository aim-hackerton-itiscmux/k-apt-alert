/** GET /v1/apt/visit-checklist — 단지별 맞춤 임장 체크리스트 */
import { jsonResponse, corsPreflightResponse } from "../_shared/crawl-helpers.ts";
import { getSupabaseClient } from "../_shared/db.ts";

interface CheckItem {
  timing: string;
  action: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();

  const url            = new URL(req.url);
  const announcementId = url.searchParams.get("announcement_id") ?? "";

  if (!announcementId) return jsonResponse({ error: "announcement_id required" }, 400);

  const db = getSupabaseClient();

  // 캐시 병렬 조회
  const [locRes, commuteRes, schoolRes] = await Promise.all([
    db.from("location_score_cache").select("result").eq("announcement_id", announcementId).single(),
    db.from("commute_cache").select("result").eq("announcement_id", announcementId).single(),
    db.from("school_zone_cache").select("result").eq("announcement_id", announcementId).single(),
  ]);

  const loc     = locRes.data?.result;
  const commute = commuteRes.data?.result;
  const school  = schoolRes.data?.result;

  const redFlags: string[]  = loc?.red_flags ?? [];
  const riskFlags: string[] = []; // price/location 캐시에서 직접 판단

  const checklist: CheckItem[] = [];

  // 항상 포함
  checklist.push({ timing: "평일 오전 8시", action: "단지 정문 → 지하철역 직접 도보 (출근 시간대 체감)" });

  // commute 기반
  if (commute?.nearest_station && commute?.walk_to_nearest_station_min) {
    checklist.push({
      timing: "평일 오전 8시",
      action: `${commute.nearest_station}까지 도보 ${commute.walk_to_nearest_station_min}분 실측 확인`,
    });
  }
  if (commute?.commute?.gangnam?.transit_min) {
    checklist.push({
      timing: "평일 오전 8~9시",
      action: `강남역 대중교통 ${commute.commute.gangnam.transit_min}분 — 혼잡도 직접 체감`,
    });
  }

  // school 기반
  if (school?.has_elementary_within_300m) {
    const name = school.elementary_within_300m?.[0]?.name ?? "인근 초등학교";
    checklist.push({
      timing: "평일 오후 3~4시",
      action: `${name} 통학로 안전성 확인 (등하원 시간대)`,
    });
  } else if (school?.elementary_within_1km?.length > 0) {
    const name = school.elementary_within_1km[0]?.name ?? "인근 초등학교";
    checklist.push({
      timing: "평일 오후 3~4시",
      action: `${name} 통학 동선 확인 (1km 이내)`,
    });
  }

  // red_flags 기반
  if (redFlags.some((f) => f.includes("장례식장"))) {
    const item = redFlags.find((f) => f.includes("장례식장"))!;
    checklist.push({ timing: "야간", action: `장례식장(${item}) 주변 분위기 및 소음 확인` });
  }
  if (redFlags.some((f) => f.includes("숙박업소"))) {
    const item = redFlags.find((f) => f.includes("숙박업소"))!;
    checklist.push({ timing: "야간", action: `숙박업소(${item}) 영업 현황 및 주변 환경 확인` });
  }
  if (redFlags.some((f) => f.includes("주유소"))) {
    checklist.push({ timing: "낮 (바람 있는 날)", action: "주유소 냄새·소음 영향 확인" });
  }
  if (redFlags.some((f) => f.includes("충전소"))) {
    checklist.push({ timing: "낮", action: "충전소 차량 출입 소음 확인" });
  }

  // 입지 점수 낮을 때
  if (loc?.location_score < 40) {
    checklist.push({
      timing: "주말",
      action: `단지 주변 상권 활성도 확인 (입지 점수 ${loc.location_score}점 — 낮은 편)`,
    });
  }

  // 음식점 부족
  if (loc?.category_scores?.restaurant < 5) {
    checklist.push({ timing: "저녁", action: "도보 500m 내 식당·편의시설 현황 직접 확인" });
  }

  return jsonResponse({
    announcement_id: announcementId,
    checklist,
    priority_count: checklist.length,
    data_available: {
      commute: !!commute,
      school: !!school,
      location: !!loc,
    },
  });
});
