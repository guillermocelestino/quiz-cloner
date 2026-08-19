/**
 * Grade profile + Grade-1 language validation (server-only, deterministic).
 *
 * The textbook controls CONTENT. The GradeProfile controls LANGUAGE.
 * These checks ensure questions read at a Grade-1 level.
 */
import { DIFFICULTIES, type Difficulty, type GradeProfile, type ValidationOutcome, type QuestionType } from "@/lib/types";

const PROFILES: Record<number, GradeProfile> = {
  1: {
    grade: 1,
    maxSentenceWords: 18,
    maxChoices: 3,
    fontSize: 16,
    avoid: [
      "double negatives",
      "nested clauses",
      "trick wording",
      "abstract qualifiers",
      "unnecessary difficult vocabulary",
    ],
    instructionStyle: "short and direct",
  },
  2: {
    grade: 2,
    maxSentenceWords: 16,
    maxChoices: 4,
    fontSize: 15,
    avoid: [
      "double negatives",
      "nested clauses",
      "trick wording",
      "abstract qualifiers",
    ],
    instructionStyle: "short and direct",
  },
  3: {
    grade: 3,
    maxSentenceWords: 20,
    maxChoices: 4,
    fontSize: 14,
    avoid: ["double negatives", "trick wording", "abstract qualifiers"],
    instructionStyle: "clear and direct",
  },
};

export function getGradeProfile(grade: number): GradeProfile {
  return PROFILES[grade] ?? PROFILES[1];
}

/* A small list of words that are too advanced for Grade-1 reading. */
const HARD_VOCAB = new Set([
  "photosynthesis",
  "transpiration",
  "chlorophyll",
  "chloroplast",
  "respiration",
  "ecosystem",
  "organism",
  "evaporation",
  "condensation",
  "precipitation",
  "metamorphosis",
  "vertebrate",
  "invertebrate",
  "mammal",
  "reproduction",
]);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateGradeOneLanguage(
  question: {
    type: QuestionType;
    question: string;
    answer: string;
    choices?: string[];
    difficulty?: string;
  },
  profile: GradeProfile
): ValidationOutcome {
  const checks: NonNullable<ValidationOutcome["checks"]> = [];

  // 1. Sentence length for the question prompt.
  const promptWords = wordCount(question.question);
  checks.push({
    name: "sentence_length",
    passed: promptWords <= profile.maxSentenceWords,
    note: `${promptWords} words (max ${profile.maxSentenceWords})`,
  });

  // 2. Multiple choice choice count.
  if (question.type === "multiple_choice" || question.type === "blend_mc") {
    const n = question.choices?.length ?? 0;
    checks.push({
      name: "choice_count",
      passed: n >= 2 && n <= profile.maxChoices,
      note: `${n} choices (max ${profile.maxChoices})`,
    });
  }

  // 3. Avoid double negatives.
  const hasDoubleNegative = /\b(not|never|no)\b[\w\s'-]{0,12}\b(not|never|no|none)\b/i.test(
    question.question
  );
  checks.push({
    name: "no_double_negatives",
    passed: !hasDoubleNegative,
  });

  // 4. Avoid trick wording ("except", "not", "least" used to invert).
  const hasTrick = /\b(all of the following except|which (is|are) not|least likely)\b/i.test(
    question.question
  );
  checks.push({
    name: "no_trick_wording",
    passed: !hasTrick,
  });

  // 5. Vocabulary difficulty.
  const tokens = (question.question + " " + question.answer)
    .toLowerCase()
    .match(/[a-z']+/g) ?? [];
  const hard = tokens.filter((t) => HARD_VOCAB.has(t));
  checks.push({
    name: "vocabulary",
    passed: hard.length === 0,
    note: hard.length ? `hard words: ${hard.join(", ")}` : undefined,
  });

  // 6. Difficulty allowed.
  const difficultyOk =
    !question.difficulty || (DIFFICULTIES as readonly string[]).includes(question.difficulty);
  checks.push({ name: "difficulty_valid", passed: difficultyOk });

  const failed = checks.filter((c) => !c.passed);
  return {
    valid: failed.length === 0,
    reason: failed.length
      ? `Grade-1 language issues: ${failed.map((f) => f.name).join(", ")}`
      : undefined,
    checks,
  };
}

export function difficultyLabel(d?: string): Difficulty | undefined {
  if (!d) return undefined;
  return (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : undefined;
}
