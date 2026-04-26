/** 위험 신호 자동 감지 유틸. */
import type { Announcement, RiskFlag } from "./types.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function calcRiskFlags(
  ann: Announcement,
  allAnnouncements: Announcement[],
  db: SupabaseClient,
): Promise<RiskFlag[]> {
  const flags: RiskFlag[] = [];

  // 1. lockup_conflict: 투기과열지구 + 분양가상한제 동시
  if (ann.speculative_zone === "Y" && ann.price_controlled === "Y") {
    flags.push("lockup_conflict");
  }

  // 2. oversupply_area: 같은 region+district 공고 5건↑
  const sameArea = allAnnouncements.filter(
    (a) => a.id !== ann.id && a.region === ann.region && a.district === ann.district,
  );
  if (sameArea.length >= 4) flags.push("oversupply_area"); // 본인 포함 5건↑

  // 3. high_price: price_assessment_cache.percentile ≥ 75
  const { data: priceCache } = await db
    .from("price_assessment_cache")
    .select("result")
    .eq("announcement_id", ann.id)
    .single();
  if (priceCache?.result?.percentile >= 75) flags.push("high_price");

  // 4. weak_demand: location_score_cache.location_score < 40
  const { data: locationCache } = await db
    .from("location_score_cache")
    .select("result")
    .eq("announcement_id", ann.id)
    .single();
  if (locationCache?.result?.location_score < 40) flags.push("weak_demand");

  return flags;
}
