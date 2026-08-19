import { describe, it, expect } from "vitest";
import { normalizeOcr, validateAnswerHint } from "@/lib/server/ocr/normalize-ocr";
import {
  extractSourceFacts,
  isAnswerSupportedByFact,
  validateGrounding,
} from "@/lib/server/validation/grounding";
import {
  getGradeProfile,
  validateGradeOneLanguage,
} from "@/lib/server/validation/grade-profile";
import { isDuplicate, normalizeForCompare } from "@/lib/server/validation/duplicates";
import { extractJson } from "@/lib/server/ai/nvidia-reasoning";
import { grade1ReviewerSchema, sanitizeOption, isCorrectAnswer } from "@/lib/types";
import { buildGrade1ReviewerSystemPrompt } from "@/lib/server/generation/prompts";

/* ----------------------------- OCR normalizer --------------------------- */
describe("normalizeOcr", () => {
  it("parses plain text into ordered blocks", () => {
    const out = normalizeOcr("Parts of a Plant\n\nRoots hold the plant in the soil.");
    expect(out.detectedFormat).toBe("text");
    expect(out.blocks.length).toBe(2);
    expect(out.blocks[0].text).toBe("Parts of a Plant");
    expect(out.blocks[0].order).toBe(0);
    expect(out.blocks[1].order).toBe(1);
    expect(out.text).toContain("Roots hold the plant in the soil.");
  });

  it("parses the documented Nemotron OCR v2 structured output", () => {
    const raw = {
      ocr_txts: ["Roots hold the plant in the soil.", "Roots absorb water from the soil."],
      ocr_confs: [0.97, 0.95],
      ocr_boxes: [
        [
          [1, 2],
          [3, 2],
          [3, 4],
          [1, 4],
        ],
      ],
    };
    const out = normalizeOcr("", raw);
    expect(out.detectedFormat).toBe("nemotron_ocr_v2_structured");
    expect(out.blocks.length).toBe(2);
    expect(out.blocks[0].confidence).toBeCloseTo(0.97);
    expect(out.avgConfidence).toBeCloseTo(0.96, 1);
    expect(out.text).toContain("Roots absorb water");
  });

  it("detects markdown and normalizes unicode artifacts", () => {
    const out = normalizeOcr("# Heading\n\u201Cquoted\u201D \u2013 dash");
    expect(out.detectedFormat).toBe("markdown");
    expect(out.text).toContain('"quoted"');
    expect(out.text).not.toContain("\u201C");
  });

  it("flags empty OCR", () => {
    const out = normalizeOcr("   \n\n  ");
    expect(out.text).toBe("");
    expect(out.warningFlags).toContain("empty_ocr");
  });

  it("never invents text", () => {
    const out = normalizeOcr("Only this sentence exists.");
    expect(out.text).toBe("Only this sentence exists.");
    expect(out.blocks.every((b) => b.text.length > 0)).toBe(true);
  });

  it("Phase 8: strips prose commentary wrappers and flags filled-in blanks from handwriting", () => {
    const rawProseContent = `The image shows a page from a workbook, with the title "Words with Long i".
* **Title**
* The title is in red text.
1. The woman who is to get married is a bride.
2. The players threw the _____ to start the game.
Overall, the page appears to be a worksheet for children.`;

    const out = normalizeOcr(rawProseContent);
    expect(out.text).not.toContain("The image shows");
    expect(out.text).not.toContain("Overall,");
    expect(out.text).not.toContain("* **Title**");
    expect(out.text).toContain("1. The woman who is to get married is a bride.");
    expect(out.warningFlags).toContain("POSSIBLY_FILLED_FROM_HANDWRITING");
  });

  it("Phase 8: preserves blanks and captures handwrittenAnswer from structured handwriting OCR", () => {
    const rawStructured = {
      exerciseItems: [
        {
          itemNumber: 1,
          sentence: "The woman who is to get married is a _____.",
          blankToken: "_____",
          proposedAnswer: "bride",
          handwrittenAnswer: "bride",
          firstLetterClue: "b",
          letterCount: 5,
        },
      ],
    };

    const out = normalizeOcr("", rawStructured);
    expect(out.warningFlags).toContain("POSSIBLY_FILLED_FROM_HANDWRITING");
  });

  it("Phase 9: validateAnswerHint nullifies leaked answer hints not present in raw text", () => {
    const rawContent = "1. The woman who is to get married is a bride. (reward)";
    const leakedHint = validateAnswerHint("(12th)", rawContent);
    const validHint = validateAnswerHint("(reward)", rawContent);

    expect(leakedHint).toBeNull();
    expect(validHint).toBe("(reward)");
  });

  it("Phase 9: isInstructionText and extractSourceFacts filter out meta-instructions", () => {
    const items = [
      {
        content: "Instructions: Complete each sentence by writing the letters in the boxes.\nA bride gets married on her wedding day.",
        pageLabel: "Page 1",
        included: true,
      },
    ];

    const facts = extractSourceFacts(items);
    expect(facts.length).toBe(1);
    expect(facts[0].text).toContain("A bride gets married on her wedding day.");
    expect(facts[0].text).not.toContain("Complete each sentence");
  });
});

/* ------------------------------- Grounding ------------------------------ */
describe("grounding", () => {
  const items = [
    {
      content: "Roots hold the plant in the soil. Roots absorb water from the soil.",
      pageLabel: "Parts of a Plant",
      included: true,
    },
  ];
  const facts = extractSourceFacts(items);

  it("extracts atomic facts with stable ids", () => {
    expect(facts.length).toBe(2);
    expect(facts[0].id).toBe("F1");
    expect(facts[1].id).toBe("F2");
  });

  it("supports an answer present in the source", () => {
    expect(isAnswerSupportedByFact("water", facts[1].text)).toBe(true);
  });

  it("rejects an answer not present in the source", () => {
    expect(isAnswerSupportedByFact("oxygen", facts[1].text)).toBe(false);
  });

  it("validates a grounded question", () => {
    const included = new Set(facts.map((f) => f.id));
    const result = validateGrounding(
      {
        type: "fill_blank",
        question: "Roots absorb ______ from the soil.",
        answer: "water",
        sourceFactId: "F2",
      },
      facts,
      included
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a fabricated sourceFactId", () => {
    const included = new Set(facts.map((f) => f.id));
    const result = validateGrounding(
      {
        type: "identification",
        question: "What gas do plants use during photosynthesis?",
        answer: "carbon dioxide",
        sourceFactId: "F99",
      },
      facts,
      included
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a correct-but-unsupported question", () => {
    const included = new Set(facts.map((f) => f.id));
    const result = validateGrounding(
      {
        type: "identification",
        question: "What gas do plants use during photosynthesis?",
        answer: "carbon dioxide",
        sourceFactId: "F1",
      },
      facts,
      included
    );
    expect(result.valid).toBe(false);
  });
});

/* ---------------------------- Grade-1 profile --------------------------- */
describe("grade profile", () => {
  const profile = getGradeProfile(1);
  it("uses Grade-1 limits", () => {
    expect(profile.maxChoices).toBe(3);
    expect(profile.maxSentenceWords).toBe(18);
  });

  it("accepts a short, simple question", () => {
    const result = validateGradeOneLanguage(
      { type: "fill_blank", question: "Roots absorb water from the soil.", answer: "water" },
      profile
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an overly long sentence", () => {
    const longQ =
      "Which of the following best describes the very important and complex job that roots do for the whole plant every day?";
    const result = validateGradeOneLanguage(
      { type: "identification", question: longQ, answer: "hold" },
      profile
    );
    expect(result.valid).toBe(false);
  });

  it("rejects too many choices for Grade 1", () => {
    const result = validateGradeOneLanguage(
      {
        type: "multiple_choice",
        question: "Which holds the plant up?",
        answer: "Stem",
        choices: ["Roots", "Stem", "Leaves", "Flower"],
      },
      profile
    );
    expect(result.valid).toBe(false);
  });
});

/* ------------------------------ Duplicates ------------------------------ */
describe("duplicates", () => {
  it("flags the same fact/type/answer as duplicate", () => {
    const accepted = [
      { type: "fill_blank" as const, question: "Roots absorb water from the soil.", answer: "water", sourceFactId: "F2" },
    ];
    const dup = isDuplicate(
      { type: "fill_blank", question: "Roots take in water from the soil.", answer: "water", sourceFactId: "F2" },
      accepted
    );
    expect(dup).toBe(true);
  });

  it("does not flag distinct questions", () => {
    const accepted = [
      { type: "true_false" as const, question: "Roots hold the plant in the soil.", answer: "True", sourceFactId: "F1" },
    ];
    const dup = isDuplicate(
      { type: "fill_blank", question: "Leaves make food for the plant.", answer: "food", sourceFactId: "F3" },
      accepted
    );
    expect(dup).toBe(false);
  });

  it("normalizes consistently", () => {
    expect(normalizeForCompare("Roots absorb water!")).toBe(
      normalizeForCompare("roots absorb water")
    );
  });
});

/* --------------------------- JSON extraction ---------------------------- */
describe("extractJson", () => {
  it("extracts JSON from fenced code", () => {
    const out = extractJson("Result:\n```json\n{\"questions\":[]}\n```");
    expect(JSON.parse(out)).toEqual({ questions: [] });
  });

  it("extracts JSON surrounded by prose", () => {
    const out = extractJson('Sure! {"questions":[{"q":1}]} hope that helps');
    expect(JSON.parse(out).questions[0].q).toBe(1);
  });

  it("extracts a top-level array", () => {
    const out = extractJson("[1,2,3]");
    expect(JSON.parse(out)).toEqual([1, 2, 3]);
  });
});

/* ---------------- Phase 3: Deterministic Post-Gen Validators ------------- */
import {
  validateWordBankContainment,
  validateSwapGrounding,
  validateBlankTokenMatch,
} from "@/lib/server/validation/validators";
import { validateAndBalancePlan } from "@/lib/server/generation/generate-reviewer";

describe("Phase 3 Deterministic Post-Generation Validators", () => {
  const verifiedContext = [
    {
      content: "A clock tells us the time. A flag waves in the wind.",
      pageLabel: "P1",
      included: true,
      wordBank: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"],
    },
  ];

  it("validateWordBankContainment approves choices present in wordBank", () => {
    const q = { type: "blend_mc", choices: ["bl-", "cl-", "fl-"] };
    const res = validateWordBankContainment(q, verifiedContext);
    expect(res.valid).toBe(true);
  });

  it("validateWordBankContainment rejects choice NOT present in wordBank", () => {
    const q = { type: "blend_mc", choices: ["bl-", "cl-", "invalid-blend"] };
    const res = validateWordBankContainment(q, verifiedContext);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("not present in verified wordBank");
  });

  it("validateSwapGrounding approves false statements using snapshot words", () => {
    const q = {
      type: "tf_swap",
      question: "True or False: A flag tells us the time.",
      answer: "False",
    };
    const res = validateSwapGrounding(q, verifiedContext);
    expect(res.valid).toBe(true);
  });

  it("validateSwapGrounding rejects false statements using random ungrounded words", () => {
    const q = {
      type: "tf_swap",
      question: "True or False: An astronaut flies to galaxy solar system.",
      answer: "False",
    };
    const res = validateSwapGrounding(q, verifiedContext);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("not grounded in verified snapshot");
  });

  it("validateBlankTokenMatch checks for blank token", () => {
    const validQ = { type: "fill_blank", question: "A ____ waves in the wind." };
    expect(validateBlankTokenMatch(validQ).valid).toBe(true);

    const invalidQ = { type: "fill_blank", question: "A flag waves in the wind." };
    expect(validateBlankTokenMatch(invalidQ).valid).toBe(false);
  });
});

/* -------------------- Phase 3: Plan-Then-Write Plan --------------------- */
describe("Phase 3 Plan Validation & Balancing", () => {
  it("balances plan and prevents 4 consecutive identical question types", () => {
    const rawPlan = [
      { sourceFactId: "F1", questionType: "tf_exact" },
      { sourceFactId: "F1", questionType: "tf_exact" },
      { sourceFactId: "F1", questionType: "tf_exact" },
      { sourceFactId: "F1", questionType: "tf_exact" },
    ];
    const allowed = ["tf_exact", "blend_mc", "fill_blank"] as const;
    const plan = validateAndBalancePlan(rawPlan, ["F1"], allowed, 4);

    expect(plan.length).toBe(4);
    // 4th item should cycle to avoid 4 in a row
    expect(plan[3].questionType).not.toBe("tf_exact");
  });
});

/* --------------- Phase 4: Deterministic Part A Extraction --------------- */
import { generatePartAContent } from "@/lib/server/pdf/part-a";

describe("Phase 4 Deterministic Part A Content Extraction", () => {
  it("extracts words to practice and sentences to remember deterministically without LLM", () => {
    const snapshot = [
      {
        content: "A clock tells us the time.",
        factKind: "DeclarativeFact",
        included: true,
      },
      {
        content: "____ock",
        factKind: "ExerciseItem",
        proposedAnswer: "cl-",
        wordBank: ["bl-", "cl-", "fl-"],
        included: true,
      },
    ];

    const partA = generatePartAContent(snapshot);
    expect(partA.wordsToPractice).toContain("cl-");
    expect(partA.wordsToPractice).toContain("bl-");
    expect(partA.sentencesToRemember).toContain("A clock tells us the time.");
  });
});

/* --------------- Phase 5: Extended Quality Gates & Overlap -------------- */
import {
  calculateQuestionOverlap,
  checkVersionOverlap,
} from "@/lib/server/validation/overlap";

describe("Phase 5 Version Overlap & Anti-Clumping Coverage", () => {
  const oldQuestions = [
    { question: "A clock tells us the time." },
    { question: "A flag waves in the wind." },
  ];

  it("calculateQuestionOverlap computes accurate overlap ratio", () => {
    const newQuestions = [
      { question: "A clock tells us the time." }, // match
      { question: "A plum is a sweet purple fruit." }, // new
    ];
    const result = calculateQuestionOverlap(oldQuestions, newQuestions);
    expect(result.overlapCount).toBe(1);
    expect(result.overlapPercentage).toBe(50);
  });

  it("checkVersionOverlap fails when overlap is >= 50%", () => {
    const newQuestions = [
      { question: "A clock tells us the time." },
      { question: "A flag waves in the wind." },
    ];
    const result = checkVersionOverlap(oldQuestions, newQuestions);
    expect(result.valid).toBe(false);
    expect(result.overlapPercentage).toBe(100);
  });

  it("checkVersionOverlap passes when overlap is < 50%", () => {
    const newQuestions = [
      { question: "A clock tells us the time." }, // 1/4 = 25% overlap
      { question: "A plum is a sweet purple fruit." },
      { question: "Leaves make food for the plant." },
      { question: "Roots hold the plant in soil." },
    ];
    const result = checkVersionOverlap(oldQuestions, newQuestions);
    expect(result.valid).toBe(true);
    expect(result.overlapPercentage).toBe(25);
  });

  it("validateAndBalancePlan enforces distinct coverage (anti-clumping <=60% per page)", () => {
    const rawPlan = [
      { sourceFactId: "F1", questionType: "fill_blank" },
      { sourceFactId: "F1", questionType: "true_false" },
      { sourceFactId: "F1", questionType: "identification" },
      { sourceFactId: "F1", questionType: "multiple_choice" },
    ];
    const factPageMap: Record<string, string> = {
      F1: "Page 1",
      F2: "Page 2",
    };
    const plan = validateAndBalancePlan(rawPlan, ["F1", "F2"], ["fill_blank", "true_false"], 4, factPageMap);

    // Max 60% of 4 = 3 per page; at least 1 item must target Page 2
    const p1Count = plan.filter((p) => factPageMap[p.sourceFactId] === "Page 1").length;
    expect(p1Count).toBeLessThanOrEqual(3);
  });
});

describe("Grade 1 Reviewer Specification & Schemas", () => {
  it("validates Grade 1 Reviewer JSON payload against grade1ReviewerSchema", () => {
    const samplePayload = {
      unitTopic: "Words with L-Blends",
      sourceInstruction: "Complete each word with a consonant blend (bl-, cl-, fl-, gl-, pl-, sl-).",
      availableBank: ["bl-", "cl-", "fl-"],
      sections: [
        {
          sectionTitle: "Part I: Circle the Correct Blend",
          formatType: "phonics_mc",
          sectionInstructions: "Choose the blend that matches the picture.",
          questions: [
            {
              itemNumber: 1,
              sourceItemRef: "Page 94, Item 1",
              promptText: "A _____ ock tells us the time.",
              blankToken: "_____",
              options: ["A. bl-", "B. cl-", "C. fl-"],
              correctAnswer: "B. cl-",
              targetWord: "clock",
              parentExplanation: "cl + ock = clock (tells us the time)",
            },
          ],
        },
      ],
    };

    const parsed = grade1ReviewerSchema.safeParse(samplePayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.unitTopic).toBe("Words with L-Blends");
      expect(parsed.data.sourceInstruction).toBe("Complete each word with a consonant blend (bl-, cl-, fl-, gl-, pl-, sl-).");
      expect(parsed.data.sections[0].questions[0].targetWord).toBe("clock");
    }
  });

  it("builds Grade 1 Reviewer system prompt with strict output rules", () => {
    const prompt = buildGrade1ReviewerSystemPrompt();
    expect(prompt).toContain("Phonics Specialist");
    expect(prompt).toContain("INSTRUCTION AS THE FIRST-CLASS CONTEXT");
    expect(prompt).toContain("STRICT JSON OUTPUT FORMAT");
  });

  it("normalizes precision elementary textbook OCR JSON payload", () => {
    const rawPayload = {
      pageInstructions: ["Complete each word by adding the correct L-blend."],
      availableBank: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"],
      exerciseItems: [
        {
          itemNumber: 1,
          printedPrompt: "The girl put the ____ ates on the table.",
          targetWord: "plates",
          targetBlend: "pl-",
          hasHandwriting: false,
          blankToken: "_____",
        },
      ],
    };

    const out = normalizeOcr("", rawPayload);
    expect(out.availableBank).toEqual(["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]);
    expect(out.exerciseItems?.[0].sentence).toBe("The girl put the ____ ates on the table.");
    expect(out.exerciseItems?.[0].proposedAnswer).toBe("plates");
    expect(out.exerciseItems?.[0].firstLetterClue).toBe("pl-");
  });
});

describe("Option Sanitization & Answer Key Validation", () => {
  it("removes prefixes like 'A. ', 'B) ', '1. ' from choice strings", () => {
    expect(sanitizeOption("A. bl-")).toBe("bl-");
    expect(sanitizeOption("B. cl-")).toBe("cl-");
    expect(sanitizeOption("A) fl-")).toBe("fl-");
    expect(sanitizeOption("1. gl-")).toBe("gl-");
    expect(sanitizeOption("  pl-")).toBe("pl-");
    expect(sanitizeOption("sl-")).toBe("sl-");
  });

  it("accurately matches correct answers regardless of prefixes", () => {
    expect(isCorrectAnswer("A. bl-", "bl-")).toBe(true);
    expect(isCorrectAnswer("A. bl-", "A. bl-")).toBe(true);
    expect(isCorrectAnswer("bl-", "A. bl-")).toBe(true);
    expect(isCorrectAnswer("bl-", "bl-")).toBe(true);
    expect(isCorrectAnswer("A. bl-", "cl-")).toBe(false);
  });
});



