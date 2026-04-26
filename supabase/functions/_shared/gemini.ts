/** Google Gemini API 유틸 — LLM 자연어 분석 생성. */

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

/** 프롬프트 → 텍스트 응답. API 키 없으면 null. */
export async function generateText(
  prompt: string,
  maxTokens = 512,
): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not configured — LLM analysis skipped");
    return null;
  }

  try {
    const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      console.warn(`Gemini error ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = await resp.json();
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text as string) ?? null;
  } catch (e) {
    console.error("Gemini call failed:", e);
    return null;
  }
}
