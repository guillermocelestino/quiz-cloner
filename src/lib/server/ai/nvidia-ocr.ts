/**
 * NVIDIA Nemotron OCR v2 integration (server-only).
 *
 * Flow:
 *   textbook image  ->  base64 data URL  ->  nemotron-ocr-v2  ->  raw OCR content
 *
 * The raw content is then handed to the DETERMINISTIC normalizer
 * (src/lib/server/ocr/normalize-ocr.ts). This module never invents text.
 */
import { chatCompletion, getOcrModel, isDemoMode } from "./nvidia-client";

export type OcrInput = {
  imageBuffer: Buffer;
  mimeType: string;
};

export type OcrOutput = {
  content: string;
  raw: unknown;
  model: string;
  demo: boolean;
};

const SAMPLE_PAGE_TEXT = `Parts of a Plant

A plant has many parts. Each part helps the plant live and grow.

Roots
Roots hold the plant in the soil.
Roots absorb water from the soil.

Stem
The stem holds the plant up.
The stem carries water to the leaves.

Leaves
Leaves make food for the plant.
Leaves need sunlight to make food.

Flower
The flower makes seeds.
Seeds grow into new plants.

Word List
root  stem  leaf  flower  seed`;

/**
 * Run Nemotron OCR v2 on a single textbook page image.
 * Returns the raw textual content emitted by the model.
 */
export async function runNemotronOcr(input: OcrInput): Promise<OcrOutput> {
  const model = getOcrModel();

  if (isDemoMode()) {
    // DEMO MODE: deterministic sample content so the journey is fully testable
    // when no NVIDIA_API_KEY is configured. Clearly flagged as demo upstream.
    return {
      content: SAMPLE_PAGE_TEXT,
      raw: { demo: true, note: "Deterministic sample OCR (no API key configured)." },
      model: `${model} (demo)`,
      demo: true,
    };
  }

  const base64 = input.imageBuffer.toString("base64");
  const dataUrl = `data:${input.mimeType};base64,${base64}`;

  const { content, raw } = await chatCompletion({
    model,
    temperature: 0,
    topP: 1,
    maxTokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcribe all readable text from this textbook page image accurately.

CRITICAL ELEMENTARY TEXTBOOK OCR INSTRUCTIONS:
1. "pageInstructions": Extract top directions verbatim.
2. "availableBank": Extract any blend list or word box (e.g. ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]). If none, return [].
3. "exerciseItems": For each numbered item:
   - "itemNumber": integer
   - "sentence" (or "printedPrompt"): exact text with blanks preserved as "_____" EVEN IF pencil handwriting is present.
   - "proposedAnswer" (or "targetWord"): the solved word combining visual clue and word bank (e.g. "plates" for picture of plates + "____ ates").
   - "targetBlend" (or "firstLetterClue"): missing prefix (e.g. "pl-").
   - "hasHandwriting": true ONLY if actual physical pencil/pen marks are visible on the page, else false.
   - "handwrittenAnswer": pencil answer text if visible, else null.
   - "blankToken": "_____"
   - "letterCount": integer or null
   - "answerHint": parenthesized hint if present on page (e.g. "(cost)"), else null
4. Return ONLY a valid JSON object matching this schema. No descriptions, no markdown, no commentary.

JSON Schema:
{
  "pageInstructions": [
    "Verbatim top directions or instructions text."
  ],
  "availableBank": [
    "bl-", "cl-", "fl-", "gl-", "pl-", "sl-"
  ],
  "declarativeFacts": [
    { "content": "Printed lesson text sentence." }
  ],
  "exerciseItems": [
    {
      "itemNumber": 1,
      "sentence": "Printed prompt with blank token _____.",
      "printedPrompt": "Printed prompt with blank token _____.",
      "blankToken": "_____",
      "proposedAnswer": "plates",
      "targetWord": "plates",
      "targetBlend": "pl-",
      "firstLetterClue": "p",
      "hasHandwriting": false,
      "handwrittenAnswer": null,
      "letterCount": 6,
      "answerHint": null,
      "wordBank": ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]
    }
  ]
}`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return { content, raw, model, demo: false };
}

/**
 * Run Nemotron OCR for SOURCE EXERCISE REPRODUCTION mode.
 * Extracts the exact exercise structure from textbook images that already contain exercises.
 * Does NOT generate new questions — only reconstructs what is visible.
 */
export async function runNemotronExerciseOcr(input: OcrInput): Promise<OcrOutput> {
  const model = getOcrModel();

  if (isDemoMode()) {
    // DEMO MODE: deterministic sample exercise content for source reproduction
    const demoExerciseContent = `Complete each sentence using the words in the box.

cat   dog   bird

1. The bird can fly.
2. The dog can bark.
3. The cat can meow.`;

    return {
      content: demoExerciseContent,
      raw: { demo: true, note: "Deterministic sample exercise OCR (no API key configured)." },
      model: `${model} (demo)`,
      demo: true,
    };
  }

  const base64 = input.imageBuffer.toString("base64");
  const dataUrl = `data:${input.mimeType};base64,${base64}`;

  const { content, raw } = await chatCompletion({
    model,
    temperature: 0,
    topP: 1,
    maxTokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a precision Vision OCR engine for SOURCE EXERCISE REPRODUCTION.

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
   - "detectedAnswers": Array of answer objects for answers found in the image or options matching from word bank/choices:
       { "value": "the answer text", "source": "printed|handwritten|marker", "location": "blank|choice|word_bank|marker_text", "confidence": 0.0-1.0 }
     - "printed": Answer printed in textbook or matched from word bank/choices.
     - "handwritten": Answer written by student in pencil/pen.
     - "marker": Explicit answer marker like "Answer: B" or "✓ B".
     - "location": WHERE the answer appears — "blank" (in a blank), "choice" (selected choice), "word_bank" (word in bank), "marker_text" (explicit marker).
     - FOR UNFILLED EXERCISES WITH A WORD BANK / CHOICES: Include candidate completions from the word bank (e.g., "pl-" or "plates" for "_____ ates" with bank ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]) as candidates in detectedAnswers with location: "word_bank".
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
- Do NOT invent content not visible in the image.

Return ONLY a valid JSON object matching this schema. No descriptions, no markdown, no commentary.

JSON Schema:
{
  "pageInstructions": [
    "Verbatim top directions or instructions text."
  ],
  "availableBank": [
    "cat", "dog", "bird"
  ],
  "exerciseItems": [
    {
      "itemNumber": 1,
      "exerciseType": "fill_blank",
      "instructions": "Complete each sentence using the words in the box.",
      "questionText": "The bird can fly.",
      "blankLocations": [],
      "choices": null,
      "wordBank": ["cat", "dog", "bird"],
      "matchingPairs": null,
      "detectedAnswers": [
        { "value": "bird", "source": "printed", "location": "blank", "confidence": 0.9 }
      ],
      "answerMarkers": [],
      "confidence": 0.95,
      "pageLabel": "Page 1",
      "sourceOrder": 1
    }
  ]
}`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return { content, raw, model, demo: false };
}
