/**
 * Source-Reproduced Exercise Pipeline Orchestrator (server-only).
 *
 * Orchestrates the complete pipeline:
 * Source Exercise Image → OCR Extraction → Parent Verification → Reconstruction → Validation → Questionnaire + Answer Key
 */

import type {
  SourceReproducedOcr,
  SourceReproducedExerciseItem,
  ReviewerConfig,
  PdfQuestion,
  PageFormat,
} from "@/lib/types";
import { extractTextbookExercise } from "@/lib/server/ai/gemini-ocr";
import { runNemotronExerciseOcr, runNemotronOcr, type OcrInput } from "@/lib/server/ai/nvidia-ocr";
import { normalizeExerciseOcr } from "@/lib/server/ocr/normalize-ocr";
import {
  getVerifiedExercisesForSnapshot,
  getVerifiedExerciseAnswersForSnapshot,
} from "@/lib/server/db/queries";
import {
  reconstructAllExercises,
  generateQuestionnaireText,
  type ReconstructedExerciseItem,
} from "./reconstruct-exercise";
import { validateReconstruction, type ValidationResult } from "./validate-reconstruction";
import sharp from "sharp";

export interface SourceReproducedResult {
  questionnaireText: string;
  questionnaireItems: ReconstructedExerciseItem[];
  pdfQuestions: PdfQuestion[];
  answerKeyData: AnswerKeyEntry[];
  validation: ValidationResult;
  ocr: SourceReproducedOcr;
}

export interface AnswerKeyEntry {
  itemNumber: number;
  exerciseType: string;
  answer: string;
  sourcePage?: string | null;
  sourceExerciseItemId: string; // Reference to the source exercise item
}

/**
 * Read-only reconstruction pass from parent-verified exercises (verified_exercises).
 *
 * READ-ONLY GUARANTEE: Does NOT issue any UPDATE, DELETE, or INSERT queries against verified_exercises.
 */
export async function reconstructFromVerifiedSnapshot(snapshotId: string): Promise<{
  questionnaireText: string;
  questionnaireItems: ReconstructedExerciseItem[];
  answerKeyItems: { itemNumber: number; exerciseType: string; answer: string; sourcePage?: string | null }[];
  validation: ValidationResult;
}> {
  const verifiedRows = await getVerifiedExercisesForSnapshot(snapshotId);
  const answerRows = await getVerifiedExerciseAnswersForSnapshot(snapshotId);

  if (verifiedRows.length === 0) {
    throw new Error(`No verified exercises found for snapshot ${snapshotId}`);
  }

  // Convert verified_exercises rows to SourceReproducedExerciseItem format
  const exerciseItems: SourceReproducedExerciseItem[] = verifiedRows.map((row) => ({
    itemNumber: row.itemNumber,
    exerciseType: row.exerciseType,
    instructions: row.instructions ?? undefined,
    questionText: row.questionText,
    blankLocations: (row.blankLocations as number[]) ?? undefined,
    choices: (row.choices as string[]) ?? undefined,
    wordBank: (row.wordBank as string[]) ?? undefined,
    matchingPairs: (row.matchingPairs as { left: string; right: string }[]) ?? undefined,
    detectedAnswers: (row.detectedAnswers as any[]) ?? [],
    handwrittenAnswers: (row.handwrittenAnswers as any[]) ?? [],
    printedAnswers: (row.printedAnswers as any[]) ?? [],
    answerMarkers: (row.answerMarkers as string[]) ?? undefined,
    confidence: row.confidence ?? 1.0,
    pageLabel: row.pageLabel ?? undefined,
    sourceOrder: row.sourceOrder,
    included: row.included ?? true,
  }));

  const ocrSnapshot: SourceReproducedOcr = {
    text: exerciseItems.map((e) => e.questionText).join("\n"),
    blocks: [],
    detectedFormat: "source_reproduced",
    pageInstructions: Array.from(new Set(exerciseItems.map((e) => e.instructions).filter(Boolean))) as string[],
    availableBank: Array.from(new Set(exerciseItems.flatMap((e) => e.wordBank || []))),
    exerciseItems,
    warningFlags: [],
  };

  // Step 1: Reconstruct student-facing exercises (deterministic answer removal)
  const reconstructed = reconstructAllExercises(ocrSnapshot);

  // Step 2: Validate 1:1 structural fidelity against source
  const validation = validateReconstruction(ocrSnapshot, reconstructed);

  // Step 3: Format answer key from verified_exercise_answers table (no AI calls)
  const answerKeyItems = answerRows.map((row) => ({
    itemNumber: row.answer.itemNumber,
    exerciseType: row.answer.exerciseType,
    answer: row.answer.answer,
    sourcePage: row.answer.sourcePage,
  }));

  // Step 4: Generate questionnaire text
  const questionnaireText = generateQuestionnaireText(ocrSnapshot, reconstructed);

  return {
    questionnaireText,
    questionnaireItems: reconstructed,
    answerKeyItems,
    validation,
  };
}

/**
 * Main entry point for source-reproduced exercise generation.
 *
 * @param imageBuffer - The textbook page image buffer
 * @param mimeType - Image MIME type
 * @param config - Reviewer configuration (must have generationMode: "source_reproduced")
 * @param examPrepId - Parent exam prep ID for tracking
 * @param pageLabel - Optional page label (e.g., "Page 42")
 */
export async function generateSourceReproducedExercise(
  imageBuffer: Buffer,
  mimeType: string,
  config: ReviewerConfig,
  examPrepId: string,
  pageLabel?: string
): Promise<SourceReproducedResult> {
  // Validate generation mode
  if (config.generationMode !== "source_reproduced") {
    throw new Error("generateSourceReproducedExercise called with non-source_reproduced generationMode");
  }

  // Step 1: OCR Extraction (with fallback)
  const ocrResult = await extractExerciseWithFallback(imageBuffer, mimeType);

  // Step 2: Normalize OCR to structured SourceReproducedOcr
  const normalizedOcr = normalizeExerciseOcr(ocrResult.raw, ocrResult.content, ocrResult.model);

  // Add page label if provided
  if (pageLabel && normalizedOcr.exerciseItems) {
    normalizedOcr.exerciseItems.forEach((item) => {
      if (!item.pageLabel) item.pageLabel = pageLabel;
    });
  }

  // Step 3: Reconstruct exercises (deterministic answer removal)
  const reconstructed = reconstructAllExercises(normalizedOcr);

  // Step 4: Validate reconstruction
  const validation = validateReconstruction(normalizedOcr, reconstructed);

  if (!validation.valid) {
    // Log validation errors but continue - parent verification can catch issues
    console.warn("[source-reproduced] Validation warnings/errors:", validation.errors, validation.warnings);
  }

  // Step 5: Generate questionnaire text
  const questionnaireText = generateQuestionnaireText(normalizedOcr, reconstructed);

  // Step 6: Convert to PDF question format
  const pdfQuestions = convertToPdfQuestions(reconstructed, normalizedOcr, examPrepId);

  // Step 7: Generate answer key data
  const answerKeyData = generateAnswerKeyData(reconstructed, normalizedOcr);

  return {
    questionnaireText,
    questionnaireItems: reconstructed,
    pdfQuestions,
    answerKeyData,
    validation,
    ocr: normalizedOcr,
  };
}

/**
 * Extract exercise with Gemini primary, Nemotron fallback.
 * Reuses the existing model routing infrastructure.
 */
async function extractExerciseWithFallback(
  imageBuffer: Buffer,
  mimeType: string
): Promise<{ content: string; raw: unknown; model: string; demo: boolean }> {
  // Try Gemini first (if API key available)
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await extractTextbookExercise(imageBuffer, mimeType);
      return {
        content: JSON.stringify(result),
        raw: result,
        model: "gemini-exercise-extraction",
        demo: false,
      };
    } catch (err) {
      console.warn("[source-reproduced] Gemini exercise extraction failed, falling back to Nemotron:", err);
    }
  }

  // Fallback to Nemotron
  const input: OcrInput = { imageBuffer, mimeType };
  return runNemotronExerciseOcr(input);
}

/**
 * Convert reconstructed exercises to PDF question format.
 * Maps exercise types to existing question types where possible.
 */
function convertToPdfQuestions(
  reconstructed: ReconstructedExerciseItem[],
  ocr: SourceReproducedOcr,
  examPrepId: string
): PdfQuestion[] {
  const questions: PdfQuestion[] = [];

  for (const item of reconstructed) {
    const pdfQuestion = mapToPdfQuestion(item, ocr, examPrepId);
    if (pdfQuestion) {
      questions.push(pdfQuestion);
    }
  }

  return questions;
}

/**
 * Map a reconstructed exercise item to the existing PdfQuestion format.
 * Uses sourceExerciseItemId instead of sourceFactId for traceability.
 */
function mapToPdfQuestion(
  item: ReconstructedExerciseItem,
  ocr: SourceReproducedOcr,
  examPrepId: string
): PdfQuestion | null {
  const sourceExerciseItemId = `${examPrepId}-exercise-${item.itemNumber}`;

  // Map exercise types to existing question types
  let questionType: PdfQuestion["type"] = "identification"; // default fallback

  switch (item.exerciseType) {
    case "fill_blank":
      questionType = "fill_blank";
      break;
    case "multiple_choice":
      questionType = "multiple_choice";
      break;
    case "true_false":
      questionType = "true_false";
      break;
    case "word_bank":
      questionType = "fill_blank"; // Word bank fill-in-the-blank
      break;
    case "matching":
      questionType = "identification"; // Matching mapped to identification
      break;
    case "complete_sentence":
      questionType = "fill_blank";
      break;
    case "circle_select":
      questionType = "multiple_choice";
      break;
    default:
      questionType = "identification";
  }

  // Build the question text (already answer-free from reconstruction)
  let questionText = item.questionnaireText;

  // Add item-specific instructions if present
  if (item.instructions && item.instructions.trim()) {
    questionText = `${item.instructions}\n\n${questionText}`;
  }

  // For multiple choice, include choices in question text
  let choices: string[] | undefined;
  if (item.choices && item.choices.length > 0) {
    choices = item.choices;
    if (!questionText.includes(item.choices[0])) {
      questionText += "\n" + item.choices.join("\n");
    }
  }

  // For word bank, include word bank
  if (item.wordBank && item.wordBank.length > 0) {
    if (!questionText.includes("Word Bank")) {
      questionText = `Word Bank: ${item.wordBank.join("   ")}\n\n${questionText}`;
    }
  }

  // Get the answer from preserved answers (for answer key)
  const primaryAnswer = item.preservedAnswers[0]?.value ?? "";

  return {
    type: questionType,
    question: questionText,
    answer: primaryAnswer,
    choices,
    sourcePage: item.pageLabel ?? null,
    sourceFactId: sourceExerciseItemId, // Using sourceFactId field but storing exercise item reference
  };
}

/**
 * Generate answer key entries from preserved answers.
 */
function generateAnswerKeyData(
  reconstructed: ReconstructedExerciseItem[],
  ocr: SourceReproducedOcr
): AnswerKeyEntry[] {
  const entries: AnswerKeyEntry[] = [];

  for (const item of reconstructed) {
    // Combine all preserved answers for this item
    const allAnswers = item.preservedAnswers.map((a) => a.value).filter(Boolean);

    if (allAnswers.length > 0) {
      entries.push({
        itemNumber: item.itemNumber,
        exerciseType: item.exerciseType,
        answer: allAnswers.join("; "),
        sourcePage: item.pageLabel ?? null,
        sourceExerciseItemId: `${item.pageLabel ?? "page"}-exercise-${item.itemNumber}`,
      });
    } else {
      // No detected answers - might be an exercise without answers in the source
      entries.push({
        itemNumber: item.itemNumber,
        exerciseType: item.exerciseType,
        answer: "[No answer detected in source]",
        sourcePage: item.pageLabel ?? null,
        sourceExerciseItemId: `${item.pageLabel ?? "page"}-exercise-${item.itemNumber}`,
      });
    }
  }

  return entries;
}

/**
 * Prepare image buffer for OCR (resize, compress) - reuses existing logic.
 */
export async function prepareExerciseImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toBuffer();
}