import { describe, it, expect } from "vitest";
import fixtureData from "./fixtures/spelling-l-blends.json";
import {
  extractSourceFacts,
  validateGrounding,
} from "@/lib/server/validation/grounding";
import {
  validateGeneratedQuestions,
  type VerifiedItemContext,
} from "@/lib/server/validation/validators";
import { checkVersionOverlap } from "@/lib/server/validation/overlap";
import longIFixture from "./fixtures/long-i-ie.json";
import { validateAndBalancePlan } from "@/lib/server/generation/generate-reviewer";
import { validateBlankTokenMatch } from "@/lib/server/validation/validators";

describe("Pipeline Evaluation Suite (Phase 6 Evals)", () => {
  it("Test 1 (Hallucination Rejection): rejects questions with answers not in the snapshot", () => {
    const facts = extractSourceFacts(fixtureData);
    const includedFactIds = new Set(facts.map((f) => f.id));

    // Question claiming "Mars" is the answer based on F2 ("The globe is a model of Earth.")
    const ungroundedQuestion = {
      type: "fill_blank",
      question: "The globe is a model of ______.",
      answer: "Mars",
      sourceFactId: facts[1].id,
    };

    const groundingResult = validateGrounding(
      ungroundedQuestion,
      facts,
      includedFactIds
    );

    expect(groundingResult.valid).toBe(false);
    expect(groundingResult.reason).toContain("Grounding failed");
    expect(groundingResult.reason).toContain("answer_supported");
  });

  it("Test 2 (WordBank Violation): rejects blend_mc questions with choices outside verified wordBank", () => {
    const facts = extractSourceFacts(fixtureData);

    const invalidWordBankQuestion = {
      type: "blend_mc",
      question: "Choose the correct blend for _ _ ag:",
      answer: "fl-",
      choices: ["fl-", "gl-", "str-"], // "str-" is not in wordBank ["fl-", "gl-", "sl-"] or ["bl-", "cl-", "pl-"]
      sourceFactId: facts[0].id,
    };

    const validationResult = validateGeneratedQuestions(
      invalidWordBankQuestion,
      fixtureData as VerifiedItemContext[]
    );

    expect(validationResult.valid).toBe(false);
    expect(validationResult.reason).toContain("not present in verified wordBank");
  });

  it("Test 3 (Grounded Acceptance): accepts valid questions directly derived from fixture facts", () => {
    const facts = extractSourceFacts(fixtureData);
    const includedFactIds = new Set(facts.map((f) => f.id));

    const validQuestion = {
      type: "fill_blank",
      question: "The globe is a model of ______.",
      answer: "Earth",
      sourceFactId: facts[1].id,
    };

    const groundingResult = validateGrounding(
      validQuestion,
      facts,
      includedFactIds
    );
    const postGenResult = validateGeneratedQuestions(
      validQuestion,
      fixtureData as VerifiedItemContext[]
    );

    expect(groundingResult.valid).toBe(true);
    expect(postGenResult.valid).toBe(true);
  });

  it("Test 4 (Overlap Detection): flags exams with >50% identical question text", () => {
    const previousExam = [
      { question: "The globe is a model of Earth." },
      { question: "A clock tells us the time." },
      { question: "A flag waves in the wind." },
    ];

    const newExamHighOverlap = [
      { question: "The globe is a model of Earth." },
      { question: "A clock tells us the time." },
      { question: "A plum is a sweet purple fruit." },
    ];

    const overlapResult = checkVersionOverlap(previousExam, newExamHighOverlap);

    expect(overlapResult.valid).toBe(false);
    expect(overlapResult.overlapPercentage).toBeGreaterThanOrEqual(50);
    expect(overlapResult.reason).toContain("exceeds maximum");
  });
});

describe("Pipeline Evaluation Suite (Phase 7 Multi-Format Generalization)", () => {
  const longIFacts = extractSourceFacts(longIFixture as VerifiedItemContext[]);

  it("Template Guard: validateAndBalancePlan NEVER assigns blend_mc to a fact whose wordBank is null", () => {
    const rawPlan = [
      { sourceFactId: longIFacts[0].id, questionType: "blend_mc" },
      { sourceFactId: longIFacts[1].id, questionType: "blend_mc" },
    ];
    const factWordBankMap: Record<string, string[] | null> = {};
    longIFacts.forEach((f) => {
      factWordBankMap[f.id] = f.wordBank ?? null;
    });

    const plan = validateAndBalancePlan(
      rawPlan,
      longIFacts.map((f) => f.id),
      ["blend_mc", "word_family_mc", "first_letter_fill"],
      2,
      {},
      factWordBankMap
    );

    expect(plan.length).toBe(2);
    // Neither assigned item should be blend_mc because wordBank is null
    expect(plan[0].questionType).not.toBe("blend_mc");
    expect(plan[1].questionType).not.toBe("blend_mc");
  });

  it("Validator Fallback: validateWordBankContainment validates choices against pageWordFamily when wordBank is null", () => {
    const validWordFamilyQuestion = {
      type: "word_family_mc",
      question: "Which long-i word means a woman getting married? b _ _ _ _",
      answer: "bride",
      choices: ["bride", "prize", "price"],
      sourceFactId: longIFacts[0].id,
    };

    const validResult = validateGeneratedQuestions(
      validWordFamilyQuestion,
      longIFixture as VerifiedItemContext[]
    );
    expect(validResult.valid).toBe(true);

    const invalidWordFamilyQuestion = {
      type: "word_family_mc",
      question: "Which long-i word means a woman getting married? b _ _ _ _",
      answer: "bride",
      choices: ["bride", "prize", "dragon"], // "dragon" is not in proposedAnswer pageWordFamily
      sourceFactId: longIFacts[0].id,
    };

    const invalidResult = validateGeneratedQuestions(
      invalidWordFamilyQuestion,
      longIFixture as VerifiedItemContext[]
    );
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.reason).toContain("not present in verified wordBank or pageWordFamily");
  });

  it("New Template: first_letter_fill validates blank token format 'b _ _ _ _'", () => {
    const firstLetterFillQ = {
      type: "first_letter_fill",
      question: "A woman getting married is a b _ _ _ _.",
      answer: "bride",
      sourceFactId: longIFacts[0].id,
    };

    const blankResult = validateBlankTokenMatch(firstLetterFillQ);
    const fullResult = validateGeneratedQuestions(
      firstLetterFillQ,
      longIFixture as VerifiedItemContext[]
    );

    expect(blankResult.valid).toBe(true);
    expect(fullResult.valid).toBe(true);
  });
});
