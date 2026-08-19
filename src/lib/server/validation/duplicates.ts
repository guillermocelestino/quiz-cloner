/**
 * Duplicate + ambiguity detection (server-only, deterministic).
 */
import { type QuestionType, type ValidationOutcome, isCorrectAnswer, sanitizeOption } from "@/lib/types";

export type AcceptedQuestion = {
  type: QuestionType;
  question: string;
  answer: string;
  sourceFactId: string;
};

const STOP = new Set([
  "the","a","an","of","to","in","on","for","and","or","is","are","was","were",
  "what","which","who","this","that","do","does","did","part","plant","parts",
]);

export function normalizeForCompare(text: string): string {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .filter((t) => t.length > 2 && !STOP.has(t))
    .sort()
    .join(" ");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function isDuplicate(
  candidate: AcceptedQuestion,
  accepted: AcceptedQuestion[]
): boolean {
  const candQ = new Set(normalizeForCompare(candidate.question).split(" "));
  const candA = normalizeForCompare(candidate.answer);

  for (const q of accepted) {
    // Exact answer + same fact reused -> duplicate.
    if (q.sourceFactId === candidate.sourceFactId && q.type === candidate.type) {
      const sameA = normalizeForCompare(q.answer) === candA;
      if (sameA) return true;
    }
    // High question similarity -> duplicate.
    const existingQ = new Set(normalizeForCompare(q.question).split(" "));
    if (candQ.size > 0 && jaccard(candQ, existingQ) >= 0.8) return true;
  }
  return false;
}

export function validateUniqueness(
  candidate: AcceptedQuestion,
  accepted: AcceptedQuestion[]
): ValidationOutcome {
  const dup = isDuplicate(candidate, accepted);
  return {
    valid: !dup,
    reason: dup ? "Duplicate of an already accepted question." : undefined,
    checks: [{ name: "not_duplicate", passed: !dup }],
  };
}

/** Heuristic ambiguity check: balanced true/false, single clear answer. */
export function validateAmbiguity(
  question: { type: QuestionType; question: string; answer: string; choices?: string[] }
): ValidationOutcome {
  const checks: NonNullable<ValidationOutcome["checks"]> = [];
  if (question.type === "multiple_choice") {
    const choices = question.choices ?? [];
    const normalized = choices.map((c) => normalizeForCompare(sanitizeOption(c)));
    const dupes = normalized.some((c, i) => c && normalized.indexOf(c) !== i);
    checks.push({ name: "distinct_choices", passed: !dupes });
    const correctPresent = choices.some(
      (c) => isCorrectAnswer(c, question.answer)
    );
    checks.push({ name: "correct_choice_present", passed: correctPresent });
  }
  if (question.type === "true_false") {
    const ok = ["true", "false"].includes(question.answer.trim().toLowerCase());
    checks.push({ name: "valid_true_false", passed: ok });
  }
  const failed = checks.filter((c) => !c.passed);
  return {
    valid: failed.length === 0,
    reason: failed.length ? `Ambiguity: ${failed.map((f) => f.name).join(", ")}` : undefined,
    checks,
  };
}
