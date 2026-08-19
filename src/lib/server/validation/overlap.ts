/**
 * Version Overlap Validator (server-only).
 *
 * Enforces the <50% Overlap Rule across reviewer versions for the same ExamPrep.
 * If new generated questions overlap by >= 50% with the previous exam version,
 * the batch is flagged so regeneration / variation can be enforced.
 */
import type { ValidationOutcome } from "@/lib/types";

export type QuestionMinimal = {
  question: string;
  answer?: string;
};

export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculates the overlap percentage between old questions and new questions.
 * Returns overlap ratio between 0.0 and 1.0 (e.g. 35 = 35% overlap).
 */
export function calculateQuestionOverlap(
  oldQuestions: QuestionMinimal[],
  newQuestions: QuestionMinimal[]
): {
  overlapCount: number;
  totalNewCount: number;
  overlapPercentage: number;
} {
  if (oldQuestions.length === 0 || newQuestions.length === 0) {
    return { overlapCount: 0, totalNewCount: newQuestions.length, overlapPercentage: 0 };
  }

  const oldSet = new Set(oldQuestions.map((q) => normalizeQuestionText(q.question)));

  let overlapCount = 0;
  for (const newQ of newQuestions) {
    const norm = normalizeQuestionText(newQ.question);
    if (oldSet.has(norm)) {
      overlapCount += 1;
    }
  }

  const overlapPercentage =
    newQuestions.length > 0 ? (overlapCount / newQuestions.length) * 100 : 0;

  return {
    overlapCount,
    totalNewCount: newQuestions.length,
    overlapPercentage: Math.round(overlapPercentage * 100) / 100,
  };
}

/**
 * Evaluates the <50% overlap rule.
 * Fails if overlap is >= 50%.
 */
export function checkVersionOverlap(
  oldQuestions: QuestionMinimal[],
  newQuestions: QuestionMinimal[]
): ValidationOutcome & { overlapPercentage: number } {
  const { overlapCount, totalNewCount, overlapPercentage } = calculateQuestionOverlap(
    oldQuestions,
    newQuestions
  );

  if (overlapPercentage >= 50) {
    return {
      valid: false,
      overlapPercentage,
      reason: `Version overlap (${overlapPercentage}%) exceeds maximum 50% limit (${overlapCount}/${totalNewCount} duplicates).`,
    };
  }

  return {
    valid: true,
    overlapPercentage,
  };
}
