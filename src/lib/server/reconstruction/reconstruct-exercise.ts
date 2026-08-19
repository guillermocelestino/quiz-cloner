/**
 * Deterministic Exercise Reconstruction Engine (server-only).
 *
 * This module takes SourceReproducedExerciseItem objects (which contain the
 * full question text WITH answers in place) and produces answer-free
 * questionnaire versions by removing detected answers ONLY from their
 * answer-bearing locations.
 *
 * CRITICAL RULE: Answers are removed only from answer-bearing positions.
 * NEVER globally delete answer words — they must remain in word banks,
 * choices, instructions, etc.
 */

import type {
  SourceReproducedExerciseItem,
  SourceReproducedAnswer,
  SourceReproducedOcr,
} from "@/lib/types";

/**
 * Result of reconstruction: the questionnaire text (answer-free) and
 * the preserved answer data for the answer key.
 */
export interface ReconstructedExerciseItem {
  itemNumber: number;
  exerciseType: string;
  instructions: string | undefined;
  questionnaireText: string; // Answer-free version for printing
  blankLocations: number[]; // Updated blank positions in questionnaireText
  choices: string[] | undefined; // Unchanged (correct choice preserved)
  wordBank: string[] | undefined; // Unchanged
  matchingPairs: { left: string; right: string }[] | undefined; // Unchanged
  // Preserved answer data for answer key
  preservedAnswers: SourceReproducedAnswer[];
  answerMarkers: string[] | undefined; // Explicit markers removed from questionnaire
  pageLabel: string | undefined;
  sourceOrder: number;
  confidence: number | undefined;
}

/**
 * Reconstruct a single exercise item by removing answers from answer-bearing locations.
 */
export function reconstructExerciseItem(item: SourceReproducedExerciseItem): ReconstructedExerciseItem {
  let questionnaireText = item.questionText;
  const preservedAnswers: SourceReproducedAnswer[] = [];

  // Collect all answers to preserve (from all answer arrays)
  const allAnswers: SourceReproducedAnswer[] = [
    ...(item.detectedAnswers ?? []),
    ...(item.handwrittenAnswers ?? []),
    ...(item.printedAnswers ?? []),
  ];

  // Sort answers by confidence (highest first) to process most certain first
  allAnswers.sort((a, b) => b.confidence - a.confidence);

  // Track which character positions have been modified
  const modifiedRanges: { start: number; end: number; original: string; replacement: string }[] = [];

  // Process each detected answer
  for (const answer of allAnswers) {
    if (answer.location === "blank" && answer.value.trim().length > 0) {
      // Answer is in a blank position - replace it with blank token at targeted blank location
      const blankResult = replaceAnswerInBlank(
        questionnaireText,
        answer,
        modifiedRanges,
        item.blankLocations
      );
      if (blankResult.modified) {
        questionnaireText = blankResult.text;
        modifiedRanges.push(...blankResult.newRanges);
        preservedAnswers.push(answer);
      } else {
        // Answer not found in text (e.g., first-letter-clue format "b _ _ _")
        // Still preserve for answer key
        preservedAnswers.push(answer);
      }
    } else if (answer.location === "marker_text" && answer.value.trim().length > 0) {
      // Explicit answer marker like "Answer: B" - remove the entire marker
      const markerResult = removeAnswerMarker(questionnaireText, answer, modifiedRanges);
      if (markerResult.modified) {
        questionnaireText = markerResult.text;
        modifiedRanges.push(...markerResult.newRanges);
        preservedAnswers.push(answer);
      }
    } else if (answer.location === "choice") {
      // Answer is a selected choice - we do NOT remove the choice text
      // The choice remains in the questionnaire; only the selection indicator is removed
      // For source reproduction, the choice text itself stays
      // Preserve the answer for the answer key but don't modify questionnaire
      preservedAnswers.push(answer);
    } else if (answer.location === "word_bank") {
      // Answer word circled in word bank - we do NOT remove from word bank
      // Word bank must remain intact; preserve for answer key only
      preservedAnswers.push(answer);
    }
  }

  // Also remove explicit answerMarkers strings if present
  if (item.answerMarkers && item.answerMarkers.length > 0) {
    for (const marker of item.answerMarkers) {
      const markerResult = removeExactMarker(questionnaireText, marker, modifiedRanges);
      if (markerResult.modified) {
        questionnaireText = markerResult.text;
        modifiedRanges.push(...markerResult.newRanges);
      }
    }
  }

  // Recalculate blank locations in the new questionnaire text
  const newBlankLocations = findBlankTokens(questionnaireText);

  return {
    itemNumber: item.itemNumber,
    exerciseType: item.exerciseType,
    instructions: item.instructions,
    questionnaireText: questionnaireText.trim(),
    blankLocations: newBlankLocations,
    choices: item.choices,
    wordBank: item.wordBank,
    matchingPairs: item.matchingPairs,
    preservedAnswers,
    answerMarkers: item.answerMarkers,
    pageLabel: item.pageLabel,
    sourceOrder: item.sourceOrder,
    confidence: item.confidence,
  };
}

/**
 * Replace an answer in a blank with a blank token (_____).
 * Targeted removal only: replaces only if the answer is located at an answer-bearing blank position.
 */
function replaceAnswerInBlank(
  text: string,
  answer: SourceReproducedAnswer,
  existingRanges: { start: number; end: number; original: string; replacement: string }[],
  recordedBlankLocations?: number[]
): { modified: boolean; text: string; newRanges: { start: number; end: number; original: string; replacement: string }[] } {
  const answerText = answer.value.trim();
  if (!answerText) return { modified: false, text, newRanges: [] };

  // Collect and score all occurrences of answerText in text
  let searchIndex = 0;
  const candidates: { index: number; score: number }[] = [];

  while (true) {
    const index = text.indexOf(answerText, searchIndex);
    if (index === -1) break;

    const overlaps =
      existingRanges.some((r) => index < r.end && index + answerText.length > r.start);

    if (!overlaps) {
      const beforeContext = text.slice(Math.max(0, index - 15), index);
      const afterContext = text.slice(index + answerText.length, index + answerText.length + 15);

      let score = 10; // Baseline candidate score

      // Priority 1: Match recorded blank locations from OCR/verification
      if (recordedBlankLocations?.some((loc) => Math.abs(loc - index) <= 5)) {
        score += 100;
      }

      // Priority 2: Enclosed in brackets [answer]
      const isEnclosedInBrackets =
        beforeContext.trimEnd().endsWith("[") && afterContext.trimStart().startsWith("]");
      if (isEnclosedInBrackets) {
        score += 80;
      }

      // Priority 3: Near explicit blank tokens (_____, _ _ _, b _ _ _)
      const nearBlank = /(____+|_+\s*_+|\[\s*\]|[a-zA-Z](\s*_)+)/.test(beforeContext + answerText + afterContext);
      if (nearBlank) {
        score += 60;
      }

      // Priority 4: Preceded by blank token or prompt indicator (e.g. "is ", "can ", "a ", "the ")
      if (/(_____|____|_ _ _)\s*$/i.test(beforeContext)) {
        score += 50;
      } else if (/(is|are|a|an|the|can|will|was|were|:\s*)\s+$/i.test(beforeContext)) {
        score += 25;
      }

      // Penalty: If another blank exists elsewhere in text, non-blank lead-in occurrences score lower
      const textHasBlankElsewhere = /(____+|_+\s*_+|\[\s*\])/.test(text);
      if (
        textHasBlankElsewhere &&
        !nearBlank &&
        !isEnclosedInBrackets &&
        !recordedBlankLocations?.some((loc) => Math.abs(loc - index) <= 5)
      ) {
        score -= 40;
      }

      if (score > 0) {
        candidates.push({ index, score });
      }
    }

    searchIndex = index + 1;
  }

  if (candidates.length === 0) return { modified: false, text, newRanges: [] };

  // Select highest scoring candidate (most genuine blank position)
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const index = best.index;

  const beforeContext = text.slice(Math.max(0, index - 12), index);
  const afterContext = text.slice(index + answerText.length, index + answerText.length + 12);

  let replacement = "_____";
  const isEnclosedInBrackets =
    beforeContext.trimEnd().endsWith("[") && afterContext.trimStart().startsWith("]");

  if (isEnclosedInBrackets) {
    replacement = "_____";
  } else if (/_\s+_\s*(_\s*)*/.test(beforeContext + afterContext)) {
    replacement = "_ _ _";
  } else if (/[a-zA-Z](\s*_)+/.test(beforeContext + afterContext)) {
    const m = (beforeContext + afterContext).match(/[a-zA-Z](\s*_)+/);
    if (m) replacement = m[0];
  } else if (/____+/.test(beforeContext + afterContext)) {
    const m = (beforeContext + afterContext).match(/____+/);
    if (m) replacement = m[0];
  }

  const newText = text.slice(0, index) + replacement + text.slice(index + answerText.length);
  const newRanges = [{ start: index, end: index + answerText.length, original: answerText, replacement }];
  return { modified: true, text: newText, newRanges };
}

/**
 * Remove an explicit answer marker like "Answer: B" or "✓ B".
 */
function removeAnswerMarker(
  text: string,
  answer: SourceReproducedAnswer,
  existingRanges: { start: number; end: number; original: string; replacement: string }[]
): { modified: boolean; text: string; newRanges: { start: number; end: number; original: string; replacement: string }[] } {
  // The answer.value for marker_text might be "Answer: B" or just "B"
  // We look for common marker patterns
  const markerPatterns = [
    new RegExp(`Answer\\s*:\\s*${escapeRegex(answer.value)}`, "i"),
    new RegExp(`✓\\s*${escapeRegex(answer.value)}`),
    new RegExp(`\\*\\s*${escapeRegex(answer.value)}`),
    new RegExp(`^\\s*${escapeRegex(answer.value)}\\s*$`, "m"), // Line with just the answer
  ];

  for (const pattern of markerPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const index = match.index;
      const length = match[0].length;

      const overlaps = existingRanges.some(
        (r) => index < r.end && index + length > r.start
      );

      if (!overlaps) {
        // Remove the marker (replace with empty string, then clean up extra whitespace/newlines)
        let newText = text.slice(0, index) + text.slice(index + length);
        // Clean up potential double newlines or trailing spaces
        newText = newText.replace(/\n\s*\n\s*\n/g, "\n\n").replace(/[ \t]+\n/g, "\n");
        const newRanges = [{ start: index, end: index + length, original: match[0], replacement: "" }];
        return { modified: true, text: newText, newRanges };
      }
    }
  }

  return { modified: false, text, newRanges: [] };
}

/**
 * Remove an exact marker string from the text.
 */
function removeExactMarker(
  text: string,
  marker: string,
  existingRanges: { start: number; end: number; original: string; replacement: string }[]
): { modified: boolean; text: string; newRanges: { start: number; end: number; original: string; replacement: string }[] } {
  const trimmedMarker = marker.trim();
  if (!trimmedMarker) return { modified: false, text, newRanges: [] };

  let searchIndex = 0;
  while (true) {
    const index = text.indexOf(trimmedMarker, searchIndex);
    if (index === -1) break;

    const overlaps = existingRanges.some(
      (r) => index < r.end && index + trimmedMarker.length > r.start
    );

    if (!overlaps) {
      let newText = text.slice(0, index) + text.slice(index + trimmedMarker.length);
      newText = newText.replace(/\n\s*\n\s*\n/g, "\n\n").replace(/[ \t]+\n/g, "\n");
      const newRanges = [{ start: index, end: index + trimmedMarker.length, original: trimmedMarker, replacement: "" }];
      return { modified: true, text: newText, newRanges };
    }
    searchIndex = index + 1;
  }

  return { modified: false, text, newRanges: [] };
}

/**
 * Find all blank token positions in text (_____, _ _ _, [ ], etc.)
 */
function findBlankTokens(text: string): number[] {
  const positions: number[] = [];
  // Match: _____, _ _ _, [ ], b _ _ _, single _
  const blankRegex = /(____+|_\s*_\s*_|\[\s*\]|[a-zA-Z](\s*_)+|_)/g;
  let match;
  while ((match = blankRegex.exec(text)) !== null) {
    positions.push(match.index);
  }
  return positions;
}

/**
 * Escape regex special characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reconstruct all exercise items from a SourceReproducedOcr result.
 */
export function reconstructAllExercises(ocr: SourceReproducedOcr): ReconstructedExerciseItem[] {
  if (!ocr.exerciseItems || ocr.exerciseItems.length === 0) {
    return [];
  }

  // Sort by sourceOrder to preserve original order
  const sortedItems = [...ocr.exerciseItems].sort((a, b) => a.sourceOrder - b.sourceOrder);

  return sortedItems.map(reconstructExerciseItem);
}

/**
 * Generate the full questionnaire text from reconstructed items.
 * Includes page instructions and word bank at the top.
 */
export function generateQuestionnaireText(
  ocr: SourceReproducedOcr,
  reconstructed: ReconstructedExerciseItem[]
): string {
  const parts: string[] = [];

  // Page instructions
  if (ocr.pageInstructions && ocr.pageInstructions.length > 0) {
    parts.push(...ocr.pageInstructions);
    parts.push(""); // blank line
  }

  // Word bank / available bank
  if (ocr.availableBank && ocr.availableBank.length > 0) {
    parts.push("Word Bank:");
    parts.push(ocr.availableBank.join("   "));
    parts.push("");
  }

  // Each exercise item
  for (const item of reconstructed) {
    // Item-specific instructions if different from page instructions
    if (item.instructions && item.instructions !== ocr.pageInstructions?.[0]) {
      parts.push(item.instructions);
      parts.push("");
    }

    parts.push(`${item.itemNumber}. ${item.questionnaireText}`);
    parts.push(""); // blank line after each question
  }

  return parts.join("\n").trim();
}