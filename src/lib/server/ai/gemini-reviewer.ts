import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODELS = [
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

export async function generateGrade1Reviewer(verifiedPages: any[], selectedFormats: string[]) {
  const systemPrompt = `You are an expert Early Childhood Exam Writer.
Your task is to convert verified textbook items into a solvable Grade 1 Reviewer and Parent Answer Key.

RULES:
1. Treat page instructions as the primary source of truth for word/blend banks.
2. For Multiple Choice ("phonics_mc"): Provide EXACTLY 3 choices from the verified "availableBank" (e.g., ["A. fl-", "B. bl-", "C. pl-"]).
3. For Fill in the Blank ("fill_blank"): Provide a clear word bank in "sectionInstructions".
4. Grade 1 Constraints: Prompt text must not exceed 10 words. Use simple sight words.
5. Provide a 5-to-8 word parent explanation for every answer.`;

  const userPrompt = `Verified Content:
${JSON.stringify(verifiedPages, null, 2)}

Selected Question Formats:
${JSON.stringify(selectedFormats)}`;

  let lastError: any = null;

  for (const model of MODELS) {
    let delay = 500;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { text: systemPrompt },
            { text: userPrompt },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                unitTopic: { type: Type.STRING },
                sourceInstruction: { type: Type.STRING },
                availableBank: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                sections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      sectionTitle: { type: Type.STRING },
                      formatType: { type: Type.STRING },
                      sectionInstructions: { type: Type.STRING },
                      questions: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            itemNumber: { type: Type.INTEGER },
                            promptText: { type: Type.STRING },
                            blankToken: { type: Type.STRING },
                            options: {
                              type: Type.ARRAY,
                              items: { type: Type.STRING },
                            },
                            correctAnswer: { type: Type.STRING },
                            targetWord: { type: Type.STRING },
                            parentExplanation: { type: Type.STRING },
                          },
                          required: ["itemNumber", "promptText", "correctAnswer", "parentExplanation"],
                        },
                      },
                    },
                    required: ["sectionTitle", "formatType", "questions"],
                  },
                },
              },
              required: ["unitTopic", "sections"],
            },
          },
        });

        return JSON.parse(response.text || "{}");
      } catch (err: any) {
        lastError = err;
        const isQuotaExceeded =
          err?.status === 429 ||
          err?.message?.includes("429") ||
          err?.message?.includes("Quota exceeded") ||
          err?.message?.includes("RESOURCE_EXHAUSTED");

        if (isQuotaExceeded) {
          console.warn(`[gemini-reviewer] ${model} quota exhausted (429). Trying next free Gemini model...`);
          break; // Move to next model in MODELS list immediately
        }

        const isUnavailable =
          err?.status === 503 ||
          err?.message?.includes("503") ||
          err?.message?.includes("high demand") ||
          err?.message?.includes("UNAVAILABLE");

        if (isUnavailable && attempt < 2) {
          console.warn(`[gemini-reviewer] ${model} unavailable (attempt ${attempt}/2). Retrying in ${delay}ms...`);
          await new Promise((res) => setTimeout(res, delay));
          delay *= 2;
        } else {
          break;
        }
      }
    }
  }

  throw lastError;
}
