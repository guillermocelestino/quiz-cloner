import { GoogleGenAI, Type } from "@google/genai";
import sharp from "sharp";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const EXERCISE_EXTRACTION_MODE = "source_reproduced";

const MODELS = [
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

async function prepareImageBase64(input: string | Buffer): Promise<string> {
  const buf =
    typeof input === "string"
      ? Buffer.from(input.replace(/^data:image\/\w+;base64,/, ""), "base64")
      : input;

  try {
    // Downscale and compress image with sharp for fast Vision OCR payload delivery (~100-200 KB)
    const optimized = await sharp(buf)
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();

    return optimized.toString("base64");
  } catch {
    return buf.toString("base64");
  }
}

export async function extractTextbookPage(inputImage: string | Buffer, mimeType = "image/jpeg") {
  const base64Data = await prepareImageBase64(inputImage);

  const systemPrompt = `You are a precision Vision OCR and Early Childhood Curriculum engine.
Analyze the textbook image and extract all content into structured JSON.

EXTRACTION RULES:
1. "pageInstructions": Extract the verbatim top directions on the page.
2. "availableBank": Extract any letter blend list, word box, or choices (e.g., ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]). If none exists, return an empty array [].
3. "exerciseItems": Extract each numbered exercise:
   - "itemNumber": Integer.
   - "printedPrompt": Exact text with blanks preserved as "_____".
   - "targetWord": Solved full word combining the visual illustration and word bank (e.g. "plates" for picture of plates + "____ ates").
   - "targetBlend": The specific missing blend or prefix (e.g. "pl-").
   - "hasHandwriting": True ONLY if physical pencil/pen marks are written on the page, otherwise false.`;

  let lastError: any = null;

  for (const model of MODELS) {
    let delay = 500;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                pageInstructions: { type: Type.STRING },
                availableBank: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                exerciseItems: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      itemNumber: { type: Type.INTEGER },
                      printedPrompt: { type: Type.STRING },
                      targetWord: { type: Type.STRING },
                      targetBlend: { type: Type.STRING },
                      hasHandwriting: { type: Type.BOOLEAN },
                    },
                    required: ["itemNumber", "printedPrompt", "targetWord", "hasHandwriting"],
                  },
                },
              },
              required: ["pageInstructions", "availableBank", "exerciseItems"],
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
          console.warn(`[gemini-ocr] ${model} quota exhausted (429). Trying next free Gemini model...`);
          break; // Move to next model in MODELS list immediately
        }

        const isUnavailable =
          err?.status === 503 ||
          err?.message?.includes("503") ||
          err?.message?.includes("high demand") ||
          err?.message?.includes("UNAVAILABLE");

        if (isUnavailable && attempt < 2) {
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

/**
 * Extract textbook EXERCISE structure for source-reproduced mode.
 *
 * This function is dedicated to identifying and extracting exercises that
 * already exist in the textbook image. It does NOT generate new questions.
 * It reconstructs the exact exercise structure from the source image.
 */
export async function extractTextbookExercise(inputImage: string | Buffer, mimeType = "image/jpeg") {
  const base64Data = await prepareImageBase64(inputImage);

  const systemPrompt = `You are a precision Vision OCR engine for SOURCE EXERCISE REPRODUCTION.

Your task: Extract the EXACT exercise structure visible in the textbook image.
Do NOT generate new questions. Do NOT improve the exercise. Do NOT change the exercise type.
Preserve everything as it appears in the source.

EXTRACTION RULES:
1. "pageInstructions": Extract the verbatim top directions/instructions on the page (e.g., "Complete each sentence using the words in the box.")
2. "availableBank": Extract any word bank, letter blend list, or choice options visible on the page. If none exists, return an empty array [].
3. "exerciseItems": Extract EACH numbered exercise/item EXACTLY as it appears:
   - "itemNumber": Integer (the question number as shown).
   - "exerciseType": String identifying the exercise type. Must be one of: "fill_blank", "multiple_choice", "word_bank", "matching", "true_false", "complete_sentence", "circle_select", "other". Use "other" only if the type doesn't match any listed.
   - "instructions": Any specific instructions for this item (if different from pageInstructions).
   - "questionText": The FULL question text AS IT APPEARS IN THE IMAGE, including any filled-in answers, handwritten answers, or selected choices. Do NOT remove answers here — we need them for the answer key.
   - "blankLocations": Array of character indices where blanks (_____) appear in questionText. If no blanks, return [].
   - "choices": For multiple choice — array of choice strings EXACTLY as shown (e.g., ["A. Dog", "B. Bird", "C. Cat"]). Preserve the correct choice. Do NOT remove the correct answer from choices. Only explicit answer markers go to answerMarkers.
   - "wordBank": For word bank exercises — array of words in the bank EXACTLY as shown.
   - "matchingPairs": For matching exercises — array of {left: "...", right: "..."} pairs.
   - "detectedAnswers": Array of answer objects for answers found in the image:
       { "value": "the answer text", "source": "printed|handwritten|marker", "location": "blank|choice|word_bank|marker_text", "confidence": 0.0-1.0 }
     - "printed": Answer printed in the textbook (e.g., filled blank).
     - "handwritten": Answer written by student in pencil/pen.
     - "marker": Explicit answer marker like "Answer: B" or "✓ B".
     - "location": WHERE the answer appears — "blank" (in a blank), "choice" (selected choice), "word_bank" (word circled in bank), "marker_text" (explicit marker).
   - "answerMarkers": Array of explicit answer marker strings found (e.g., ["Answer: B", "✓ C"]).
   - "confidence": Overall confidence 0.0-1.0 for this item extraction.
   - "pageLabel": Page label if visible (e.g., "Page 42").
   - "sourceOrder": Sequential order of this item on the page (1, 2, 3...).

CRITICAL CONSTRAINTS:
- Extract ONLY exercises that actually appear in the image.
- Preserve the original exercise type — do NOT convert fill_blank to multiple_choice or vice versa.
- Preserve the original question order.
- Preserve the original number of questions — do NOT add or remove.
- Preserve all choices, word banks, matching pairs exactly as shown.
- Detect answers but do NOT remove them from questionText — that happens in a separate reconstruction step.
- If uncertain whether text is an answer or source content, include it in detectedAnswers with lower confidence and note in warningFlags.
- Do NOT invent content not visible in the image.`;

  let lastError: any = null;

  for (const model of MODELS) {
    let delay = 500;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                pageInstructions: { type: Type.ARRAY, items: { type: Type.STRING } },
                availableBank: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                exerciseItems: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      itemNumber: { type: Type.INTEGER },
                      exerciseType: { type: Type.STRING },
                      instructions: { type: Type.STRING },
                      questionText: { type: Type.STRING },
                      blankLocations: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                      },
                      choices: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      wordBank: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      matchingPairs: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            left: { type: Type.STRING },
                            right: { type: Type.STRING },
                          },
                          required: ["left", "right"],
                        },
                      },
                      detectedAnswers: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            value: { type: Type.STRING },
                            source: { type: Type.STRING, enum: ["printed", "handwritten", "marker"] },
                            location: { type: Type.STRING, enum: ["blank", "choice", "word_bank", "marker_text"] },
                            confidence: { type: Type.NUMBER },
                          },
                          required: ["value", "source", "location", "confidence"],
                        },
                      },
                      answerMarkers: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      confidence: { type: Type.NUMBER },
                      pageLabel: { type: Type.STRING },
                      sourceOrder: { type: Type.INTEGER },
                    },
                    required: ["itemNumber", "exerciseType", "questionText", "sourceOrder"],
                  },
                },
              },
              required: ["pageInstructions", "availableBank", "exerciseItems"],
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
          console.warn(`[gemini-ocr-exercise] ${model} quota exhausted (429). Trying next free Gemini model...`);
          break;
        }

        const isUnavailable =
          err?.status === 503 ||
          err?.message?.includes("503") ||
          err?.message?.includes("high demand") ||
          err?.message?.includes("UNAVAILABLE");

        if (isUnavailable && attempt < 2) {
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
