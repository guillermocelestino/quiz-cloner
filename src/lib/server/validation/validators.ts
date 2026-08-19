/**
 * Deterministic Post-Generation Validators (server-only).
 * Runs after LLM outputs JSON but BEFORE saving to DB.
 */
import { type ValidationOutcome, sanitizeOption } from "@/lib/types";

export type VerifiedItemContext = {
  content: string;
  pageLabel: string | null;
  included: boolean;
  factKind?: string;
  itemNumber?: number | null;
  sentence?: string | null;
  blankToken?: string | null;
  wordBank?: string[] | null;
  pictureCue?: string | null;
  proposedAnswer?: string | null;
  firstLetterClue?: string | null;
  letterCount?: number | null;
  answerHint?: string | null;
  pageWordFamily?: string[];
};

/**
 * 1. WordBank & PageWordFamily Containment Validator
 * For blend_mc, multiple_choice, and word_family_mc:
 * Verifies that every choice in question.choices exists in the wordBank of source items,
 * or falls back to pageWordFamily (proposedAnswers) if wordBank is null.
 */
export function validateWordBankContainment(
  question: { type: string; choices?: string[]; sourceFactId?: string },
  verifiedItems: VerifiedItemContext[]
): ValidationOutcome {
  if (
    question.type !== "multiple_choice" &&
    question.type !== "blend_mc" &&
    question.type !== "word_family_mc"
  ) {
    return { valid: true };
  }

  if (!question.choices || question.choices.length === 0) {
    return { valid: false, reason: "Multiple choice question has no choices." };
  }

  // Gather all valid word bank entries across items
  const allWordBanks = new Set<string>();
  for (const item of verifiedItems) {
    if (item.wordBank && Array.isArray(item.wordBank)) {
      item.wordBank.forEach((w) => allWordBanks.add(w.trim().toLowerCase()));
    }
  }

  // Fallback: When wordBank is null/empty, validate choices against pageWordFamily (all proposedAnswer values)
  if (allWordBanks.size === 0) {
    for (const item of verifiedItems) {
      if (item.proposedAnswer && item.proposedAnswer.trim().length > 0) {
        allWordBanks.add(item.proposedAnswer.trim().toLowerCase());
      }
    }
  }

  // If still no valid entries found in snapshot, pass
  if (allWordBanks.size === 0) {
    return { valid: true };
  }

  const invalidChoices: string[] = [];
  for (const choice of question.choices) {
    const normChoice = choice.trim().toLowerCase();
    const cleanChoice = sanitizeOption(choice).toLowerCase();
    if (!allWordBanks.has(normChoice) && !allWordBanks.has(cleanChoice)) {
      invalidChoices.push(choice);
    }
  }

  if (invalidChoices.length > 0) {
    return {
      valid: false,
      reason: `Choice(s) [${invalidChoices.join(", ")}] not present in verified wordBank or pageWordFamily.`,
    };
  }

  return { valid: true };
}

/**
 * 2. Swap Grounding Validator
 * For tf_swap (False statements), checks if the swapped word actually exists
 * somewhere in the verified snapshot text to prevent random hallucinations.
 */
export function validateSwapGrounding(
  question: { type: string; question: string; answer: string },
  verifiedItems: VerifiedItemContext[]
): ValidationOutcome {
  if (question.type !== "tf_swap") {
    return { valid: true };
  }

  if (question.answer.trim().toLowerCase() !== "false") {
    return {
      valid: false,
      reason: "tf_swap question answer must be 'False'.",
    };
  }

  const combinedText = verifiedItems
    .map((it) => `${it.content} ${it.sentence || ""} ${it.wordBank?.join(" ") || ""}`)
    .join(" ")
    .toLowerCase();

  const words = (question.question.toLowerCase().match(/[a-z0-9'-]+/g) ?? []).filter(
    (w) => w.length > 2 && !["true", "false", "or", "the", "a", "an"].includes(w)
  );

  let groundedWordCount = 0;
  for (const word of words) {
    if (combinedText.includes(word)) {
      groundedWordCount += 1;
    }
  }

  if (words.length > 0 && groundedWordCount / words.length < 0.6) {
    return {
      valid: false,
      reason: "tf_swap statement contains words not grounded in verified snapshot.",
    };
  }

  return { valid: true };
}

/**
 * 3. Blank Token Match Validator
 * For fill_blank and first_letter_fill, ensures question prompt contains a blank token.
 */
export function validateBlankTokenMatch(question: {
  type: string;
  question: string;
}): ValidationOutcome {
  if (question.type !== "fill_blank" && question.type !== "first_letter_fill") {
    return { valid: true };
  }

  const hasBlank = /(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/.test(question.question);
  if (!hasBlank) {
    return {
      valid: false,
      reason: "Fill-in-the-blank question must contain a blank token ('_ _' or 'b _ _ _ _').",
    };
  }

  return { valid: true };
}

/**
 * Main deterministic post-generation validation gate.
 */
export function validateGeneratedQuestions(
  question: {
    type: string;
    question: string;
    answer: string;
    choices?: string[];
    sourceFactId?: string;
  },
  verifiedItems: VerifiedItemContext[]
): ValidationOutcome {
  const wb = validateWordBankContainment(question, verifiedItems);
  if (!wb.valid) return wb;

  const swap = validateSwapGrounding(question, verifiedItems);
  if (!swap.valid) return swap;

  const blank = validateBlankTokenMatch(question);
  if (!blank.valid) return blank;

  return { valid: true };
}
