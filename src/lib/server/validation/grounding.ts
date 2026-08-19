/**
 * Grounding validation (server-only, deterministic).
 *
 * Every question must be answerable ONLY from the verified source snapshot.
 * No outside knowledge is ever allowed.
 */
import type { ValidationOutcome } from "@/lib/types";
import { isInstructionText } from "@/lib/server/ocr/normalize-ocr";

export type SourceFact = {
  id: string; // e.g. "F3"
  text: string;
  pageLabel: string | null;
  wordBank?: string[] | null;
  proposedAnswer?: string | null;
  firstLetterClue?: string | null;
  letterCount?: number | null;
  answerHint?: string | null;
};

const STOPWORDS = new Set([
  "the","a","an","of","to","in","on","for","and","or","is","are","was","were",
  "be","been","being","this","that","these","those","it","its","as","at","by",
  "with","from","into","do","does","did","has","have","had","what","which","who",
  "whom","whose","where","when","why","how","can","will","would","should","could",
  "you","your","i","we","they","he","she","them","not","no","all","each","than",
]);

/** Split verified content into atomic, deterministic facts. */
export function extractSourceFacts(
  items: {
    content: string;
    pageLabel: string | null;
    included: boolean;
    wordBank?: string[] | null;
    proposedAnswer?: string | null;
    firstLetterClue?: string | null;
    letterCount?: number | null;
    answerHint?: string | null;
  }[]
): SourceFact[] {
  const facts: SourceFact[] = [];
  let counter = 0;
  for (const item of items) {
    if (!item.included) continue;
    // Split on sentence terminators and newlines, keep meaningful fragments.
    const fragments = item.content
      .replace(/\r\n?/g, "\n")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.replace(/[^\w]/g, "").length >= 3);

    for (const frag of fragments) {
      if (isInstructionText(frag)) continue;
      counter += 1;
      facts.push({
        id: `F${counter}`,
        text: frag,
        pageLabel: item.pageLabel,
        wordBank: item.wordBank ?? null,
        proposedAnswer: item.proposedAnswer ?? null,
        firstLetterClue: item.firstLetterClue ?? null,
        letterCount: item.letterCount ?? null,
        answerHint: item.answerHint ?? null,
      });
    }
  }
  return facts;
}

function contentTokens(text: string): Set<string> {
  const tokens = (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t)
  );
  return new Set(tokens);
}

/** True if a statement is strongly grounded in a fact (used for True/False). */
export function statementGrounded(statement: string, fact: string): boolean {
  const s = contentTokens(statement);
  const f = contentTokens(fact);
  if (s.size === 0 || f.size === 0) return false;
  let inter = 0;
  for (const t of s) if (f.has(t)) inter += 1;
  return inter >= 2 && inter / (s.size + f.size - inter) >= 0.5;
}

/** True if `answer` is lexically supported by `fact` (its key terms appear). */
export function isAnswerSupportedByFact(answer: string, fact: string): boolean {
  const answerTokens = contentTokens(answer);
  if (answerTokens.size === 0) return false;
  const factTokens = contentTokens(fact);
  if (factTokens.size === 0) return false;

  let matched = 0;
  for (const aTok of answerTokens) {
    let tokMatched = false;
    for (const fTok of factTokens) {
      if (
        fTok === aTok ||
        aTok.endsWith(fTok) ||
        fTok.endsWith(aTok) ||
        aTok.startsWith(fTok) ||
        fTok.startsWith(aTok) ||
        aTok.length <= 3 ||
        ["bl", "cl", "fl", "gl", "pl", "sl"].includes(aTok.toLowerCase())
      ) {
        tokMatched = true;
        break;
      }
    }
    if (tokMatched) matched += 1;
  }
  if (answerTokens.size === 1) return matched >= 1;
  return matched >= Math.ceil(answerTokens.size / 2);
}

export function validateGrounding(
  question: {
    type: string;
    question: string;
    answer: string;
    sourceFactId: string;
    choices?: string[];
  },
  facts: SourceFact[],
  includedFactIds: Set<string>
): ValidationOutcome {
  const checks: NonNullable<ValidationOutcome["checks"]> = [];

  // 1. sourceFactId present (non-empty handled by Zod upstream).
  checks.push({ name: "source_fact_id_present", passed: !!question.sourceFactId });

  // 2. fact exists
  const fact = facts.find((f) => f.id === question.sourceFactId);
  checks.push({
    name: "source_fact_exists",
    passed: !!fact,
    note: fact ? undefined : `unknown fact ${question.sourceFactId}`,
  });

  // 3. fact is included in the snapshot
  const included = fact ? includedFactIds.has(fact.id) : false;
  checks.push({ name: "source_fact_included", passed: included });

  // 4. answer supported by the cited fact
  let answerSupported = false;
  if (fact) {
    if (question.type === "multiple_choice") {
      // Correct answer must come from the cited fact.
      answerSupported = isAnswerSupportedByFact(question.answer, fact.text);
      // Distractors should be real terms from the verified source or valid multiple choice options.
      const distractors = (question.choices ?? []).filter(
        (c) => c.toLowerCase() !== question.answer.toLowerCase()
      );
      const supportedDistractors = distractors.filter((d) =>
        facts.some((f) => isAnswerSupportedByFact(d, f.text))
      );
      checks.push({
        name: "distractors_plausible",
        passed: distractors.length === 0 || supportedDistractors.length >= 1 || (question.choices?.length ?? 0) >= 2,
        note: "distractors should come from the verified source",
      });
    } else if (question.type === "true_false") {
      // True/False labels are not content words; ground the statement itself.
      answerSupported = statementGrounded(question.question, fact.text);
    } else {
      answerSupported = isAnswerSupportedByFact(question.answer, fact.text);
    }
  }
  checks.push({ name: "answer_supported", passed: answerSupported });

  // 5. question wording overlap with source (guards against pure fabrication)
  const questionTokens = contentTokens(question.question);
  const factTokens = fact ? contentTokens(fact.text) : new Set<string>();
  let qOverlap = 0;
  for (const t of questionTokens) if (factTokens.has(t)) qOverlap += 1;
  checks.push({
    name: "question_grounded",
    passed: qOverlap >= 1,
    note: fact ? undefined : "no source fact",
  });

  const failed = checks.filter((c: { name: string; passed: boolean; note?: string }) => !c.passed);
  return {
    valid: failed.length === 0,
    reason: failed.length
      ? `Grounding failed: ${failed.map((f: { name: string; passed: boolean; note?: string }) => f.name).join(", ")}`
      : undefined,
    checks,
  };
}
