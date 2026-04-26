/** NEIS 학교알리미 API 유틸 — 학교 정보 조회. */

const NEIS_BASE = "https://open.neis.go.kr/hub";

export interface SchoolInfo {
  name: string;
  type: "초등" | "중학" | "고등" | "기타";
  distance_m: number;
  students: number | null;
  avg_class_size: number | null;
}

function schoolType(kakaoName: string): SchoolInfo["type"] {
  if (kakaoName.includes("초등") || kakaoName.includes("초교")) return "초등";
  if (kakaoName.includes("중학") || kakaoName.endsWith("중")) return "중학";
  if (kakaoName.includes("고등") || kakaoName.endsWith("고")) return "고등";
  return "기타";
}

async function fetchNeisSchoolInfo(
  schoolName: string,
  apiKey: string,
): Promise<{ students: number | null; avgClassSize: number | null }> {
  if (!apiKey) return { students: null, avgClassSize: null };

  try {
    // 학교 기본정보 → 학교코드 획득
    const infoUrl = new URL(`${NEIS_BASE}/schoolInfo`);
    infoUrl.searchParams.set("KEY", apiKey);
    infoUrl.searchParams.set("Type", "json");
    infoUrl.searchParams.set("SCHUL_NM", schoolName);
    infoUrl.searchParams.set("pSize", "1");

    const infoRes = await fetch(infoUrl.toString(), { signal: AbortSignal.timeout(8000) });
    if (!infoRes.ok) return { students: null, avgClassSize: null };
    const infoData = await infoRes.json();
    const schoolRow = infoData?.schoolInfo?.[1]?.row?.[0];
    if (!schoolRow) return { students: null, avgClassSize: null };

    const { SD_SCHUL_CODE: schoolCode, ATPT_OFCDC_SC_CODE: officeCode } = schoolRow;

    // 학급 정보 조회
    const classUrl = new URL(`${NEIS_BASE}/classInfo`);
    classUrl.searchParams.set("KEY", apiKey);
    classUrl.searchParams.set("Type", "json");
    classUrl.searchParams.set("ATPT_OFCDC_SC_CODE", officeCode);
    classUrl.searchParams.set("SD_SCHUL_CODE", schoolCode);
    classUrl.searchParams.set("pSize", "100");

    const classRes = await fetch(classUrl.toString(), { signal: AbortSignal.timeout(8000) });
    if (!classRes.ok) return { students: null, avgClassSize: null };
    const classData = await classRes.json();
    const rows: Record<string, string>[] = classData?.classInfo?.[1]?.row ?? [];

    // 학생수: 학급당 인원 추정 (학급수로 나누기)
    const totalClasses = rows.length;
    if (totalClasses === 0) return { students: null, avgClassSize: null };

    // NEIS classInfo에서 학생수 직접 제공 안 함 — 전교생 수는 별도 API
    // 학급수만으로 avgClassSize 추정 불가 → 학급수만 반환
    return { students: null, avgClassSize: null };
  } catch {
    return { students: null, avgClassSize: null };
  }
}

export async function fetchSchoolDetails(
  kakaoPlaces: Array<{ place_name: string; distance: string }>,
  apiKey: string,
): Promise<SchoolInfo[]> {
  const results = await Promise.all(
    kakaoPlaces.slice(0, 5).map(async (place) => {
      const distM = parseFloat(place.distance || "9999");
      const type = schoolType(place.place_name);
      const { students, avgClassSize } = await fetchNeisSchoolInfo(place.place_name, apiKey);
      return {
        name: place.place_name,
        type,
        distance_m: Math.floor(distM),
        students,
        avg_class_size: avgClassSize,
      } satisfies SchoolInfo;
    }),
  );
  return results;
}
