/**
 * DETERMINISTIC OCR NORMALIZER (server-only, pure function).
 *
 * This is NOT an AI model. It is plain application code that converts the
 * ACTUAL NVIDIA Nemotron OCR v2 response into a consistent internal structure.
 *
 * Nemotron OCR v2's documented output is structured:
 *   ocr_boxes: 1D list of bounding boxes (4 corner points each)
 *   ocr_txts:  1D list of recognized text strings
 *   ocr_confs: 1D list of confidence floats
 *
 * Via the OpenAI-compatible API the result may arrive as:
 *   - JSON containing ocr_txts / ocr_boxes / ocr_confs
 *   - JSON containing a markdown / text / content field
 *   - an array of { text } objects
 *   - plain markdown / plain text
 *
 * The normalizer handles all of these without inventing, summarizing,
 * rewriting or applying world knowledge.
 */
import type { NormalizedOcr, OcrBlock, SourceReproducedOcr, SourceReproducedExerciseItem, SourceReproducedAnswer } from "@/lib/types";

export function completeCandidateAnswer(candidate: string, questionText?: string): string {
  if (!candidate || !candidate.trim()) return candidate;
  const raw = candidate.trim();
  const cleanPrefix = raw.replace(/[-_]/g, "").trim().toLowerCase();

  if (!questionText || !questionText.trim()) return raw;

  const fragmentMatch = questionText.match(/(?:_{1,}|\s*_\s*_\s*)([a-zA-Z]+)/);
  if (fragmentMatch && fragmentMatch[1]) {
    const suffix = fragmentMatch[1].trim().toLowerCase();
    const isBlend = raw.endsWith("-") || (cleanPrefix.length <= 3 && !cleanPrefix.endsWith(suffix));

    if (isBlend) {
      const combined = cleanPrefix + suffix;
      if (raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase()) {
        return combined.charAt(0).toUpperCase() + combined.slice(1);
      }
      return combined;
    }
  }

  return raw;
}

/* ----------------------- Text normalization helpers --------------------- */

/** Map of common OCR / unicode artifacts to normalized ASCII equivalents. */
function normalizeCharacters(input: string): string {
  return input
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars + BOM
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/[\u2010\u2011\u2012\u2013]/g, "-") // dashes -> hyphen
    .replace(/\u2014/g, "--") // em dash -> double hyphen
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // double quotes
    .replace(/\u2026/g, "..."); // ellipsis
}

/** Collapse whitespace artifacts inside a single line. */
function normalizeLine(line: string): string {
  return normalizeCharacters(line)
    .replace(/[ \t\f\v]+/g, " ") // collapse runs of spaces/tabs
    .replace(/\s+$/g, "") // trim trailing whitespace
    .replace(/^\s+/g, ""); // trim leading whitespace
}

function finalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n") // normalize line endings
    .replace(/[ \t]+\n/g, "\n") // trim trailing spaces on lines
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ blank lines
    .replace(/^\n+/, "") // trim leading blank lines
    .replace(/\n+$/, ""); // trim trailing blank lines
}

function computeAvgConfidence(confs: number[]): number | undefined {
  if (confs.length === 0) return undefined;
  const sum = confs.reduce((a, b) => a + b, 0);
  return Math.round((sum / confs.length) * 1000) / 1000;
}

function deriveWarnings(text: string, avgConfidence?: number): string[] {
  const flags: string[] = [];
  if (text.trim().length === 0) flags.push("empty_ocr");
  if (text.trim().length > 0 && text.trim().length < 20)
    flags.push("partial_text");
  if (avgConfidence !== undefined && avgConfidence < 0.8)
    flags.push("low_confidence");
  return flags;
}

/* --------------------------- Format detection --------------------------- */

type StructuredHit = {
  txts: string[];
  confs: (number | undefined)[];
  boxes: OcrBlock["left"][]; // left per entry (optional)
};

function tryParseJson(content: string): unknown | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  // Direct JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // JSON embedded in prose / fenced code
  const start = trimmed.search(/[[{]/);
  if (start !== -1) {
    const slice = trimmed.slice(start);
    try {
      return JSON.parse(slice);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

function asArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function extractStructured(parsed: unknown): StructuredHit | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;

  // Top-level ocr_txts / ocr_confs / ocr_boxes (documented Nemotron OCR v2).
  const obj = parsed as Record<string, unknown>;
  const txts = asArray<string>(obj.ocr_txts) ?? asArray<string>(obj.texts);
  if (txts) {
    const confs = (asArray<number>(obj.ocr_confs) ?? []).map((c) =>
      typeof c === "number" ? c : undefined
    );
    const boxes = asArray<unknown>(obj.ocr_boxes) ?? [];
    const lefts: StructuredHit["boxes"] = boxes.map((b) => {
      // boxes are typically [[x,y],[x,y],[x,y],[x,y]]
      const first = Array.isArray(b) ? (b[0] as unknown) : undefined;
      const point = Array.isArray(first) ? first : undefined;
      const x = point && typeof point[0] === "number" ? point[0] : undefined;
      return x;
    });
    return { txts, confs, boxes: lefts };
  }

  // Array of objects with text fields: [{ text, confidence }, ...]
  const arr = asArray<Record<string, unknown>>(obj) ?? asArray<Record<string, unknown>>(obj.lines) ?? asArray<Record<string, unknown>>(obj.blocks);
  if (arr && arr.length && typeof arr[0]?.text === "string") {
    return {
      txts: arr.map((b) => String(b.text ?? "")),
      confs: arr.map((b) =>
        typeof b.confidence === "number"
          ? b.confidence
          : typeof b.score === "number"
            ? b.score
            : undefined
      ),
      boxes: arr.map(() => undefined),
    };
  }

  // Object with a single text / markdown / content field.
  const textField =
    (obj.markdown as string) ??
    (obj.text as string) ??
    (obj.content as string) ??
    (obj.full_text as string) ??
    (obj.raw_text as string);
  if (typeof textField === "string" && textField.trim()) {
    return undefined; // handled as plain text path below
  }

  return undefined;
}

/* ------------------------------ Main entry ------------------------------ */

export function isProseOrCommentaryLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith("the image shows") ||
    lower.startsWith("overall,") ||
    lower.startsWith("note:") ||
    lower.startsWith("the text on this page") ||
    lower.startsWith("this page appears to be") ||
    lower.startsWith("there are two pictures") ||
    lower.startsWith("the page appears to be")
  ) {
    return true;
  }

  if (/^\*\s*\*\*(title|instructions|pictures|numbers|overview|description)\*\*/i.test(trimmed)) {
    return true;
  }

  if (/^\*\s*(the title|the instructions|there are|sentence \d+:|the first question|the second question|the third question|the fourth question|the number \d+)/i.test(trimmed)) {
    return true;
  }

  return false;
}

export function cleanProseContent(content: string): string {
  const lines = content.split(/\r?\n/);
  const cleaned = lines.filter((l) => !isProseOrCommentaryLine(l));
  return cleaned.join("\n");
}

export function validateAnswerHint(answerHint: string | null, rawText: string): string | null {
  if (!answerHint) return null;
  const innerText = answerHint.replace(/[()]/g, "").trim().toLowerCase();
  if (!innerText) return null;

  const rawLower = rawText.toLowerCase();
  if (rawLower.includes(innerText)) {
    return answerHint;
  }
  return null;
}

export function isInstructionText(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith("instructions") ||
    lower.startsWith("directions") ||
    lower.startsWith("complete each sentence") ||
    lower.startsWith("group yourselves") ||
    lower.startsWith("your teacher will") ||
    lower.startsWith("start with a different pupil") ||
    lower.startsWith("look at the picture") ||
    lower.startsWith("fill in the missing") ||
    lower.startsWith("write your name") ||
    lower.startsWith("read the sentence") ||
    /^\s*(\*|\-|\u2022)?\s*\b([a-z]|\d+)\.\s*(complete|group|look|fill|write|read|match)/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

export function extractExerciseDetails(text: string): {
  firstLetterClue: string | null;
  letterCount: number | null;
  answerHint: string | null;
  wordBank: string[] | null;
} {
  let firstLetterClue: string | null = null;
  let letterCount: number | null = null;
  let answerHint: string | null = null;
  let wordBank: string[] | null = null;

  // First letter + blanks e.g. "b _ _ _ _"
  const letterMatch = text.match(/\b([a-zA-Z])((\s*_\s*)+)/);
  if (letterMatch) {
    firstLetterClue = letterMatch[1].toLowerCase();
    const underscoreCount = (letterMatch[2].match(/_/g) || []).length;
    letterCount = underscoreCount + 1;
  }

  // Parenthesized hint vs wordBank e.g. "(12th)" vs "(bl-, cl-, fl-)"
  const hintMatch = text.match(/\(([^)]+)\)/);
  if (hintMatch) {
    const rawHint = hintMatch[1].trim();
    if (rawHint.includes(",")) {
      wordBank = rawHint.split(",").map((w) => w.trim()).filter(Boolean);
    } else {
      answerHint = `(${rawHint})`;
    }
  }

  return { firstLetterClue, letterCount, answerHint, wordBank };
}

export function normalizeOcr(content: string, raw?: unknown): NormalizedOcr {
  const blocks: OcrBlock[] = [];
  let detectedFormat = "text";
  let avgConfidence: number | undefined;

  // Clean raw content of prose wrappers first if plain text
  const sanitizedContent = cleanProseContent(content);

  // Prefer structured fields embedded in the raw response object.
  let structured: StructuredHit | undefined;
  if (raw && typeof raw === "object") {
    // The chat completion wraps the model payload; search a few common spots.
    const r = raw as Record<string, unknown>;
    structured =
      extractStructured(r) ??
      extractStructured(r.output) ??
      extractStructured(r.data) ??
      extractStructured(r.result);
  }
  if (!structured) {
    const parsed = tryParseJson(content);
    if (parsed) {
      structured = extractStructured(parsed);
    }
  }

  if (structured) {
    detectedFormat = "nemotron_ocr_v2_structured";
    structured.txts.forEach((rawText, i) => {
      const text = finalizeText(normalizeLine(rawText));
      if (!text || isProseOrCommentaryLine(text)) return;
      const conf = structured!.confs[i];
      const left = structured!.boxes[i];
      const block: OcrBlock = { order: blocks.length, text };
      if (typeof conf === "number") block.confidence = conf;
      if (typeof left === "number") {
        block.left = left;
        block.top = 0;
      }
      blocks.push(block);
    });
    const confs = structured.confs.filter(
      (c): c is number => typeof c === "number"
    );
    avgConfidence = computeAvgConfidence(confs);
  }

  // Fallback: treat the sanitized content as plain text / markdown.
  if (blocks.length === 0) {
    detectedFormat = sanitizedContent.includes("#") || sanitizedContent.includes("|")
      ? "markdown"
      : "text";
    const normalized = finalizeText(normalizeCharacters(sanitizedContent));
    for (const line of normalized.split("\n")) {
      const text = normalizeLine(line);
      if (!text || isProseOrCommentaryLine(text)) continue;
      blocks.push({ order: blocks.length, text });
    }
  }

  const text = blocks.map((b) => b.text).join("\n");
  const warningFlags = deriveWarnings(text, avgConfidence);

  // Extract structured objects, pageWordFamily, pageInstructions, declarativeFacts, exerciseItems
  const parsedJson = tryParseJson(content) as Record<string, unknown> | undefined;
  const rawObj = (raw as Record<string, unknown>) ?? {};
  
  const rawExerciseItems = (rawObj.exerciseItems ?? parsedJson?.exerciseItems) as Record<string, unknown>[] | undefined;
  const rawDeclarativeFacts = (rawObj.declarativeFacts ?? parsedJson?.declarativeFacts) as Record<string, unknown>[] | undefined;
  const rawPageInstructions = (rawObj.pageInstructions ?? parsedJson?.pageInstructions) as (string | Record<string, unknown>)[] | undefined;

  const pageInstructions: string[] = [];
  if (Array.isArray(rawPageInstructions)) {
    rawPageInstructions.forEach((inst) => {
      const str = typeof inst === "string" ? inst : String((inst as Record<string, unknown>)?.content ?? "");
      if (str.trim()) pageInstructions.push(str.trim());
    });
  }

  const declarativeFacts: Record<string, unknown>[] = [];
  if (Array.isArray(rawDeclarativeFacts)) {
    rawDeclarativeFacts.forEach((fact) => {
      const contentStr = String(fact.content ?? "").trim();
      if (!contentStr) return;
      if (isInstructionText(contentStr)) {
        pageInstructions.push(contentStr);
      } else {
        declarativeFacts.push(fact);
      }
    });
  }

  const rawAvailableBank = (rawObj.availableBank ?? parsedJson?.availableBank) as string[] | undefined;
  const availableBank = Array.isArray(rawAvailableBank) ? rawAvailableBank.filter((b) => typeof b === "string" && b.trim()) : undefined;

  const exerciseItems: Record<string, unknown>[] = [];
  if (Array.isArray(rawExerciseItems)) {
    rawExerciseItems.forEach((item) => {
      // Deterministic answerHint validation: keep answerHint ONLY if exact text appears in raw text
      const rawHint = typeof item.answerHint === "string" ? item.answerHint : null;
      const validatedHint = validateAnswerHint(rawHint, text || content);

      // Map alias fields (printedPrompt -> sentence, targetWord -> proposedAnswer, targetBlend -> firstLetterClue)
      const sentence = typeof item.printedPrompt === "string" ? item.printedPrompt : typeof item.sentence === "string" ? item.sentence : "";
      const proposedAnswer = typeof item.targetWord === "string" ? item.targetWord : typeof item.proposedAnswer === "string" ? item.proposedAnswer : null;
      const firstLetterClue = typeof item.targetBlend === "string" ? item.targetBlend : typeof item.firstLetterClue === "string" ? item.firstLetterClue : null;
      const wordBank = Array.isArray(item.wordBank) ? item.wordBank : availableBank ?? null;

      exerciseItems.push({
        ...item,
        sentence,
        proposedAnswer,
        firstLetterClue,
        wordBank,
        answerHint: validatedHint,
      });
    });
  }

  let pageWordFamily: string[] | undefined;
  if (exerciseItems.length > 0) {
    pageWordFamily = Array.from(
      new Set(
        exerciseItems
          .map((it) => (typeof it.proposedAnswer === "string" ? it.proposedAnswer.trim().toLowerCase() : ""))
          .filter((ans): ans is string => ans.length > 0)
      )
    );
  }

  // Handwriting & Blank restoration check: flag POSSIBLY_FILLED_FROM_HANDWRITING
  let hasSuspectedFilledBlank = false;
  if (exerciseItems.length > 0) {
    for (const item of exerciseItems) {
      if (
        item.hasHandwriting === true ||
        item.handwrittenAnswer ||
        !item.blankToken ||
        (typeof item.sentence === "string" &&
          !/(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/.test(item.sentence))
      ) {
        hasSuspectedFilledBlank = true;
        break;
      }
    }
  } else {
    for (const block of blocks) {
      if (
        /(\d+\.|\bSentence\b)/i.test(block.text) &&
        !/(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/.test(block.text)
      ) {
        hasSuspectedFilledBlank = true;
        break;
      }
    }
  }

  if (hasSuspectedFilledBlank && !warningFlags.includes("POSSIBLY_FILLED_FROM_HANDWRITING")) {
    warningFlags.push("POSSIBLY_FILLED_FROM_HANDWRITING");
  }

  // Ensure text is non-empty whenever structured exerciseItems, declarativeFacts, or instructions exist
  let finalText = text.trim();
  if (
    !finalText ||
    finalText.startsWith("{") ||
    finalText.startsWith("[") ||
    !/[a-zA-Z0-9]/.test(finalText)
  ) {
    const parts: string[] = [];
    if (pageInstructions.length > 0) {
      parts.push(...pageInstructions);
    }
    if (declarativeFacts.length > 0) {
      parts.push(
        ...declarativeFacts.map((d) => String((d as Record<string, unknown>).content ?? "").trim()).filter(Boolean)
      );
    }
    if (exerciseItems.length > 0) {
      parts.push(
        ...exerciseItems
          .map((e) => String((e as Record<string, unknown>).sentence ?? (e as Record<string, unknown>).printedPrompt ?? "").trim())
          .filter(Boolean)
      );
    }
    finalText = parts.join("\n");
  }

  return {
    text: finalText,
    blocks,
    avgConfidence,
    detectedFormat,
    warningFlags,
    declarativeFacts: declarativeFacts.length > 0 ? (declarativeFacts as any) : undefined,
    exerciseItems: exerciseItems.length > 0 ? (exerciseItems as any) : undefined,
    pageWordFamily,
    pageInstructions: pageInstructions.length > 0 ? pageInstructions : undefined,
    availableBank: availableBank && availableBank.length > 0 ? availableBank : undefined,
  };
}

/**
 * Normalize the source-reproduced OCR output from the dedicated exercise extraction prompts.
 * This handles the structured JSON output from extractTextbookExercise / runNemotronExerciseOcr.
 */
export function normalizeExerciseOcr(
  rawResponse: unknown,
  content: string,
  model: string
): SourceReproducedOcr {
  const warningFlags: string[] = [];

  // Try to parse as JSON first
  let parsedJson: Record<string, unknown> | undefined;
  try {
    if (typeof rawResponse === "string") {
      parsedJson = JSON.parse(rawResponse) as Record<string, unknown>;
    } else if (rawResponse && typeof rawResponse === "object") {
      parsedJson = rawResponse as Record<string, unknown>;
    }
  } catch {
    // Not JSON, treat as plain text
  }

  // Also try parsing the content field if it's a string
  let parsedContent: Record<string, unknown> | undefined;
  if (!parsedJson && typeof content === "string") {
    try {
      parsedContent = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // Not JSON
    }
  }

  const rawObj = parsedJson ?? parsedContent ?? {};

  // Extract structured fields
  const rawPageInstructions = (rawObj.pageInstructions as (string | Record<string, unknown>)[]) ?? [];
  const pageInstructions: string[] = [];
  rawPageInstructions.forEach((inst) => {
    const str = typeof inst === "string" ? inst : String((inst as Record<string, unknown>)?.content ?? "");
    if (str.trim()) pageInstructions.push(str.trim());
  });

  const rawAvailableBank = (rawObj.availableBank as string[]) ?? [];
  const availableBank = Array.isArray(rawAvailableBank)
    ? rawAvailableBank.filter((b) => typeof b === "string" && b.trim())
    : undefined;

  // Extract exercise items with full source-reproduced structure
  const rawExerciseItems = (rawObj.exerciseItems as Record<string, unknown>[]) ?? [];
  const exerciseItems: SourceReproducedExerciseItem[] = [];

  if (Array.isArray(rawExerciseItems)) {
    rawExerciseItems.forEach((item) => {
      const itemNumber = typeof item.itemNumber === "number" ? item.itemNumber : 0;
      const exerciseType = typeof item.exerciseType === "string" ? item.exerciseType : "other";
      const instructions = typeof item.instructions === "string" ? item.instructions : undefined;
      const questionText = typeof item.questionText === "string" ? item.questionText : "";
      const blankLocations = Array.isArray(item.blankLocations)
        ? item.blankLocations.filter((b): b is number => typeof b === "number")
        : [];
      const choices = Array.isArray(item.choices)
        ? item.choices.filter((c): c is string => typeof c === "string")
        : undefined;
      const wordBank = Array.isArray(item.wordBank)
        ? item.wordBank.filter((w): w is string => typeof w === "string")
        : undefined;
      const matchingPairs = Array.isArray(item.matchingPairs)
        ? item.matchingPairs
            .filter((p): p is { left: string; right: string } =>
              typeof p === "object" && p !== null && typeof (p as any).left === "string" && typeof (p as any).right === "string"
            )
            .map((p) => ({ left: (p as any).left, right: (p as any).right }))
        : undefined;

      // Helper function to safely normalize an answer entry
      const normalizeAnswerEntry = (ans: unknown, defaultSource: "printed" | "handwritten" | "marker"): SourceReproducedAnswer | null => {
        if (typeof ans === "string" && ans.trim()) {
          return {
            value: ans.trim(),
            source: defaultSource,
            location: "blank",
            confidence: 1.0,
          };
        }
        if (ans && typeof ans === "object") {
          const obj = ans as Record<string, unknown>;
          const val = typeof obj.value === "string" ? obj.value.trim() : typeof obj.answer === "string" ? obj.answer.trim() : typeof obj.text === "string" ? obj.text.trim() : "";
          if (!val) return null;
          const source = (typeof obj.source === "string" && ["printed", "handwritten", "marker"].includes(obj.source))
            ? (obj.source as "printed" | "handwritten" | "marker")
            : defaultSource;
          const location = (typeof obj.location === "string" && ["blank", "choice", "word_bank", "marker_text"].includes(obj.location))
            ? (obj.location as "blank" | "choice" | "word_bank" | "marker_text")
            : "blank";
          const conf = typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 1.0;
          return { value: val, source, location, confidence: conf };
        }
        return null;
      };

      // Parse detected answers with flexible property detection
      const rawDetectedAnswers = (item.detectedAnswers as unknown[]) ??
        (item.detected_answers as unknown[]) ??
        (item.detectedAnswer ? [item.detectedAnswer] : undefined) ??
        (item.detected_answer ? [item.detected_answer] : undefined) ??
        (item.answer ? [item.answer] : undefined) ??
        (item.proposedAnswer ? [item.proposedAnswer] : undefined) ??
        (item.proposed_answer ? [item.proposed_answer] : undefined) ?? [];

      const detectedAnswers: SourceReproducedAnswer[] = [];
      rawDetectedAnswers.forEach((ans) => {
        const parsed = normalizeAnswerEntry(ans, "printed");
        if (parsed) detectedAnswers.push(parsed);
      });

      // Parse handwritten answers
      const rawHandwrittenAnswers = (item.handwrittenAnswers as unknown[]) ??
        (item.handwritten_answers as unknown[]) ??
        (item.handwrittenAnswer ? [item.handwrittenAnswer] : undefined) ??
        (item.handwritten_answer ? [item.handwritten_answer] : undefined) ?? [];

      const handwrittenAnswers: SourceReproducedAnswer[] = [];
      rawHandwrittenAnswers.forEach((ans) => {
        const parsed = normalizeAnswerEntry(ans, "handwritten");
        if (parsed) handwrittenAnswers.push(parsed);
      });

      // Parse printed answers
      const rawPrintedAnswers = (item.printedAnswers as unknown[]) ??
        (item.printed_answers as unknown[]) ??
        (item.printedAnswer ? [item.printedAnswer] : undefined) ??
        (item.printed_answer ? [item.printed_answer] : undefined) ?? [];

      const printedAnswers: SourceReproducedAnswer[] = [];
      rawPrintedAnswers.forEach((ans) => {
        const parsed = normalizeAnswerEntry(ans, "printed");
        if (parsed) printedAnswers.push(parsed);
      });

      // Parse answer markers
      const rawAnswerMarkers = (item.answerMarkers as unknown[]) ??
        (item.answer_markers as unknown[]) ??
        (item.answerMarker ? [item.answerMarker] : undefined) ??
        (item.answer_marker ? [item.answer_marker] : undefined) ?? [];
      let answerMarkers = Array.isArray(rawAnswerMarkers)
        ? rawAnswerMarkers.map((m) => (typeof m === "string" ? m.trim() : (m as any)?.value || (m as any)?.text || "")).filter((m) => m.length > 0)
        : undefined;



      // Normalize partial candidates if question text contains complete fragment (e.g. "bl" + "_ _ ue" -> "blue")
      detectedAnswers.forEach((ans) => {
        ans.value = completeCandidateAnswer(ans.value, questionText);
      });
      handwrittenAnswers.forEach((ans) => {
        ans.value = completeCandidateAnswer(ans.value, questionText);
      });
      printedAnswers.forEach((ans) => {
        ans.value = completeCandidateAnswer(ans.value, questionText);
      });
      if (answerMarkers) {
        answerMarkers = answerMarkers.map((m) => completeCandidateAnswer(m, questionText));
      }

      const confidence = typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : undefined;
      const pageLabel = typeof item.pageLabel === "string" ? item.pageLabel : undefined;
      const sourceOrder = typeof item.sourceOrder === "number" ? item.sourceOrder : itemNumber;

      exerciseItems.push({
        itemNumber,
        exerciseType,
        instructions,
        questionText,
        blankLocations,
        choices,
        wordBank,
        matchingPairs,
        detectedAnswers: detectedAnswers.length > 0 ? detectedAnswers : undefined,
        handwrittenAnswers: handwrittenAnswers.length > 0 ? handwrittenAnswers : undefined,
        printedAnswers: printedAnswers.length > 0 ? printedAnswers : undefined,
        answerMarkers,
        confidence,
        pageLabel,
        sourceOrder,
        included: true,
      });
    });
  }

  // Compute average confidence from items
  const confidences = exerciseItems.map((it) => it.confidence).filter((c): c is number => typeof c === "number");
  const avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined;

  // Build plain text representation for compatibility
  const textParts: string[] = [];
  if (pageInstructions.length > 0) textParts.push(...pageInstructions);
  if (availableBank && availableBank.length > 0) textParts.push("Word Bank: " + availableBank.join(" "));
  exerciseItems.forEach((item) => {
    textParts.push(`${item.itemNumber}. ${item.questionText}`);
    if (item.answerMarkers && item.answerMarkers.length > 0) {
      textParts.push(item.answerMarkers.join(" "));
    }
  });

  // Check for handwriting warnings
  const hasHandwriting = exerciseItems.some(
    (it) => (it.handwrittenAnswers && it.handwrittenAnswers.length > 0) || (it.detectedAnswers && it.detectedAnswers.some((a) => a.source === "handwritten"))
  );
  if (hasHandwriting && !warningFlags.includes("POSSIBLY_FILLED_FROM_HANDWRITING")) {
    warningFlags.push("POSSIBLY_FILLED_FROM_HANDWRITING");
  }

  // Check for low confidence items
  const lowConfItems = exerciseItems.filter((it) => (it.confidence ?? 1) < 0.7);
  if (lowConfItems.length > 0 && !warningFlags.includes("low_confidence")) {
    warningFlags.push("low_confidence");
  }

  return {
    text: textParts.join("\n"),
    blocks: [], // No block-level data from structured extraction
    avgConfidence,
    detectedFormat: "exercise_json",
    warningFlags,
    pageInstructions: pageInstructions.length > 0 ? pageInstructions : undefined,
    availableBank: availableBank && availableBank.length > 0 ? availableBank : undefined,
    exerciseItems: exerciseItems.length > 0 ? exerciseItems : undefined,
  };
}
