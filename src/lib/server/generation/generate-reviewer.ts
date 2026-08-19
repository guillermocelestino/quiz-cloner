/**
 * Orchestrates the two-stage "Plan-Then-Write" reviewer generation pipeline (server-only).
 *
 * Stage 1: Planning pass (reasoning model produces an approved plan mapping sourceFactId -> questionType).
 * Plan Validation: Deterministic type-balancing & anti-clumping coverage check (<=60% per page).
 * Stage 2: Writing pass (model writes questions adhering to approved plan).
 * Deterministic Validators: Post-generation verification (WordBank containment, Swap grounding, Blank token match, Version overlap <50%).
 */
import { z } from "zod";
import { isDuplicate, validateAmbiguity } from "@/lib/server/validation/duplicates";
import {
  extractSourceFacts,
  validateGrounding,
} from "@/lib/server/validation/grounding";
import {
  getGradeProfile,
  validateGradeOneLanguage,
} from "@/lib/server/validation/grade-profile";
import { runNemotronReasoning, extractJson } from "@/lib/server/ai/nvidia-reasoning";
import {
  QUESTION_TYPES,
  type QuestionType,
  type ReviewerConfig,
  questionSchema,
} from "@/lib/types";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRegenerationPrompt,
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
} from "./prompts";
import {
  validateGeneratedQuestions,
  type VerifiedItemContext,
} from "@/lib/server/validation/validators";
import {
  checkVersionOverlap,
  type QuestionMinimal,
} from "@/lib/server/validation/overlap";

export type GeneratedQuestion = {
  type: QuestionType;
  question: string;
  answer: string;
  choices?: string[];
  sourcePage?: string | null;
  sourceFactId: string;
  difficulty?: string;
  validation?: { valid: boolean; reason?: string };
};

export type GenerationResult = {
  questions: GeneratedQuestion[];
  facts: { id: string; text: string; pageLabel: string | null }[];
  requestedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejections: { question: string; reason: string }[];
  model: string;
  promptVersion: string;
  demo: boolean;
  warnings?: string[];
};

const planEnvelopeSchema = z.object({
  plan: z
    .array(
      z.object({
        sourceFactId: z.string(),
        questionType: z.string(),
      })
    )
    .default([]),
});

const rawQuestionsEnvelope = z.object({
  questions: z
    .array(
      z.object({
        type: z.string(),
        question: z.string(),
        answer: z.string(),
        choices: z.array(z.string()).optional(),
        sourceFactId: z.string(),
        sourcePage: z.string().nullable().optional(),
        difficulty: z.string().optional(),
      })
    )
    .default([]),
});

type RawQuestion = z.infer<typeof rawQuestionsEnvelope>["questions"][number];

/** Deterministic Plan Validation, Balancing & Anti-Clumping Coverage Check */
export function validateAndBalancePlan(
  rawPlan: { sourceFactId: string; questionType: string }[],
  availableFactIds: string[],
  allowedTypes: readonly QuestionType[],
  targetCount: number,
  factPageMap?: Record<string, string>,
  factWordBankMap?: Record<string, string[] | null>
): { sourceFactId: string; questionType: QuestionType }[] {
  if (availableFactIds.length === 0 || allowedTypes.length === 0) return [];
  const factSet = new Set(availableFactIds);

  const balanced: { sourceFactId: string; questionType: QuestionType }[] = [];
  let consecutiveTypeCount = 0;
  let lastType: QuestionType | null = null;

  for (let i = 0; i < Math.min(rawPlan.length, targetCount); i++) {
    const raw = rawPlan[i];
    const factId = factSet.has(raw.sourceFactId)
      ? raw.sourceFactId
      : availableFactIds[i % availableFactIds.length];

    let qType: QuestionType = (allowedTypes as readonly string[]).includes(
      raw.questionType
    )
      ? (raw.questionType as QuestionType)
      : allowedTypes[i % allowedTypes.length];

    // Guard: NEVER assign blend_mc to a fact whose wordBank is null
    if (
      qType === "blend_mc" &&
      factWordBankMap &&
      (!factWordBankMap[factId] || factWordBankMap[factId]?.length === 0)
    ) {
      const nonBlendTypes = allowedTypes.filter((t) => t !== "blend_mc");
      if (nonBlendTypes.length > 0) {
        qType = nonBlendTypes[i % nonBlendTypes.length];
      } else {
        qType = "word_family_mc";
      }
    }

    if (qType === lastType) {
      consecutiveTypeCount++;
      if (consecutiveTypeCount > 3) {
        const typesList = allowedTypes as readonly string[];
        const nextIdx = (typesList.indexOf(qType) + 1) % typesList.length;
        let altType = allowedTypes[nextIdx] as QuestionType;
        if (
          altType === "blend_mc" &&
          factWordBankMap &&
          (!factWordBankMap[factId] || factWordBankMap[factId]?.length === 0)
        ) {
          altType = allowedTypes.find((t) => t !== "blend_mc") ?? "word_family_mc";
        }
        qType = altType;
        consecutiveTypeCount = 1;
      }
    } else {
      consecutiveTypeCount = 1;
    }
    lastType = qType;

    balanced.push({ sourceFactId: factId, questionType: qType });
  }

  // Backfill if LLM generated fewer plan items than requested
  while (balanced.length < targetCount) {
    const idx = balanced.length;
    const factId = availableFactIds[idx % availableFactIds.length];
    let qType = allowedTypes[idx % allowedTypes.length];
    if (
      qType === "blend_mc" &&
      factWordBankMap &&
      (!factWordBankMap[factId] || factWordBankMap[factId]?.length === 0)
    ) {
      const nonBlendTypes = allowedTypes.filter((t) => t !== "blend_mc");
      qType = nonBlendTypes.length > 0 ? nonBlendTypes[idx % nonBlendTypes.length] : "word_family_mc";
    }
    balanced.push({ sourceFactId: factId, questionType: qType });
  }

  // Anti-Clumping Coverage Check: Ensure <= 60% of questions are drawn from a single page
  if (factPageMap && Object.keys(factPageMap).length > 0) {
    const availablePages = Array.from(new Set(Object.values(factPageMap)));
    if (availablePages.length > 1) {
      const pageCounts: Record<string, number> = {};
      for (const item of balanced) {
        const page = factPageMap[item.sourceFactId] || "default";
        pageCounts[page] = (pageCounts[page] || 0) + 1;
      }

      const maxAllowedPerPage = Math.ceil(targetCount * 0.6);
      for (const page of Object.keys(pageCounts)) {
        if (pageCounts[page] > maxAllowedPerPage) {
          const otherFacts = availableFactIds.filter(
            (fid) => factPageMap[fid] && factPageMap[fid] !== page
          );
          if (otherFacts.length > 0) {
            let overflow = pageCounts[page] - maxAllowedPerPage;
            for (let i = balanced.length - 1; i >= 0 && overflow > 0; i--) {
              if (factPageMap[balanced[i].sourceFactId] === page) {
                balanced[i].sourceFactId = otherFacts[overflow % otherFacts.length];
                overflow--;
              }
            }
          }
        }
      }
    }
  }

  return balanced;
}

function validateOne(
  raw: RawQuestion,
  facts: ReturnType<typeof extractSourceFacts>,
  includedIds: Set<string>,
  verifiedItems: VerifiedItemContext[]
): { ok: boolean; reason?: string; q?: GeneratedQuestion } {
  const parsed = questionSchema.safeParse({
    type: raw.type,
    question: raw.question?.trim(),
    answer: raw.answer?.trim(),
    choices: raw.choices,
    sourceFactId: raw.sourceFactId?.trim(),
    sourcePage: raw.sourcePage ?? null,
    difficulty: raw.difficulty,
  });
  if (!parsed.success) {
    return { ok: false, reason: `Schema: ${parsed.error.issues[0]?.message}` };
  }
  const q = parsed.data;

  if (q.type === "multiple_choice" || q.type === "blend_mc") {
    if (!q.choices || q.choices.length < 2) {
      return { ok: false, reason: "Multiple choice needs at least 2 choices." };
    }
  }
  if (
    (q.type === "true_false" || q.type === "tf_exact" || q.type === "tf_swap") &&
    !["true", "false"].includes(q.answer.toLowerCase())
  ) {
    return { ok: false, reason: "True/False answer must be True or False." };
  }

  const grounding = validateGrounding(q, facts, includedIds);
  if (!grounding.valid) return { ok: false, reason: grounding.reason };

  const postVal = validateGeneratedQuestions(q, verifiedItems);
  if (!postVal.valid) return { ok: false, reason: postVal.reason };

  return { ok: true, q };
}

export async function generateReviewer(args: {
  verifiedItems: VerifiedItemContext[];
  config: ReviewerConfig;
  subject: string;
  gradeLevel: number;
  previousQuestions?: QuestionMinimal[];
}): Promise<GenerationResult> {
  const profile = getGradeProfile(args.gradeLevel);
  const facts = extractSourceFacts(args.verifiedItems);
  const includedFactIds = new Set(facts.map((f) => f.id));

  if (facts.length === 0) {
    return {
      questions: [],
      facts: [],
      requestedCount: args.config.questionCount,
      acceptedCount: 0,
      rejectedCount: 0,
      rejections: [{ question: "(none)", reason: "Insufficient verified source content." }],
      model: "n/a",
      promptVersion: "2.0-two-stage",
      demo: false,
    };
  }

  // Fact to Page & WordBank mapping
  const factPageMap: Record<string, string> = {};
  const factWordBankMap: Record<string, string[] | null> = {};
  facts.forEach((f) => {
    if (f.pageLabel) factPageMap[f.id] = f.pageLabel;
    factWordBankMap[f.id] = f.wordBank ?? null;
  });

  // ---------------- STAGE 1: PLANNING PASS ----------------
  const planSysPrompt = buildPlanningSystemPrompt(profile);
  const planUserPrompt = buildPlanningUserPrompt({
    subject: args.subject,
    profile,
    config: args.config,
    facts,
  });

  const planRes = await runNemotronReasoning({
    systemPrompt: planSysPrompt,
    userPrompt: planUserPrompt,
    temperature: 0.3,
    maxTokens: 2048,
  });

  let rawPlanItems: { sourceFactId: string; questionType: string }[] = [];
  try {
    rawPlanItems = planEnvelopeSchema.parse(
      JSON.parse(extractJson(planRes.content))
    ).plan;
  } catch {
    /* fallback */
  }

  const approvedPlan = validateAndBalancePlan(
    rawPlanItems,
    facts.map((f) => f.id),
    args.config.questionTypes,
    args.config.questionCount,
    factPageMap,
    factWordBankMap
  );

  // ---------------- STAGE 2: WRITING PASS ----------------
  const declarativeFacts = facts.map((f, i) => {
    const item = args.verifiedItems[i];
    return {
      id: f.id,
      content: item?.factKind === "DeclarativeFact" ? item.content : f.text,
      pageLabel: f.pageLabel,
    };
  });

  const exerciseItems = args.verifiedItems
    .filter((it) => it.factKind === "ExerciseItem" && it.included)
    .map((it, idx) => ({
      id: `F_EX_${idx + 1}`,
      itemNumber: it.itemNumber ?? null,
      sentence: it.sentence || it.content,
      blankToken: it.blankToken ?? null,
      wordBank: it.wordBank ?? null,
      pictureCue: it.pictureCue ?? null,
      proposedAnswer: it.proposedAnswer ?? null,
      pageLabel: it.pageLabel,
    }));

  const structuredPayload = { declarativeFacts, exerciseItems };

  const systemPrompt = buildSystemPrompt(profile);
  let userPrompt = buildUserPrompt({
    subject: args.subject,
    profile,
    config: args.config,
    facts,
    structuredPayload,
  });

  const planGuide = approvedPlan
    .map((p, i) => `${i + 1}. Fact ${p.sourceFactId} -> ${p.questionType}`)
    .join("\n");
  userPrompt += `\n\nAPPROVED GENERATION PLAN TO EXECUTE:\n${planGuide}\nGenerate questions strictly following this plan.`;

  const accepted: GeneratedQuestion[] = [];
  const rejections: { question: string; reason: string }[] = [];

  const runBatch = (raws: RawQuestion[]): { failed: RawQuestion[] } => {
    const failed: RawQuestion[] = [];
    for (const raw of raws) {
      if (accepted.length >= args.config.questionCount) break;

      const grade = validateGradeOneLanguage(
        {
          type: raw.type as QuestionType,
          question: raw.question,
          answer: raw.answer,
          choices: raw.choices,
          difficulty: raw.difficulty,
        },
        profile
      );
      const result = validateOne(raw, facts, includedFactIds, args.verifiedItems);
      const qObj = result.q
        ? {
            type: result.q.type,
            question: result.q.question,
            answer: result.q.answer,
            sourceFactId: result.q.sourceFactId,
          }
        : null;
      const unique = qObj ? !isDuplicate(qObj, accepted as never) : false;
      const ambiguity = result.q
        ? validateAmbiguity(result.q)
        : { valid: false, reason: "invalid" };

      const reasons: string[] = [];
      if (!grade.valid) reasons.push(grade.reason ?? "grade-1");
      if (!result.ok) reasons.push(result.reason ?? "validation");
      if (qObj && !unique) reasons.push("duplicate");
      if (!ambiguity.valid) reasons.push(ambiguity.reason ?? "ambiguous");

      if (reasons.length === 0 && result.q) {
        accepted.push({
          ...result.q,
          validation: { valid: true },
        });
      } else {
        failed.push(raw);
        rejections.push({ question: raw.question || "(unnamed)", reason: reasons.join("; ") });
      }
    }
    return { failed };
  };

  const first = await runNemotronReasoning({
    systemPrompt,
    userPrompt,
    temperature: 0.5,
    maxTokens: 8192,
  });

  let parsedFirst: RawQuestion[] = [];
  try {
    parsedFirst = rawQuestionsEnvelope.parse(
      JSON.parse(extractJson(first.content))
    ).questions;
  } catch {
    rejections.push({
      question: "(model output)",
      reason: "Malformed AI JSON (could not parse).",
    });
  }
  const firstFailed = runBatch(parsedFirst).failed;

  if (firstFailed.length > 0 && accepted.length < args.config.questionCount) {
    const failures = firstFailed.map((r) => ({
      question: r.question,
      reason:
        rejections.find((x) => x.question === r.question)?.reason ??
        "Failed strict word bank or grounding validation.",
    }));
    const regen = await runNemotronReasoning({
      systemPrompt,
      userPrompt: buildRegenerationPrompt({ facts, failures }),
      temperature: 0.4,
      maxTokens: 6144,
    });
    let regenParsed: RawQuestion[] = [];
    try {
      regenParsed = rawQuestionsEnvelope.parse(
        JSON.parse(extractJson(regen.content))
      ).questions;
    } catch {
      /* failure-closed */
    }
    runBatch(regenParsed);
  }

  // Version Overlap Checker (<50% Overlap Rule)
  const warnings: string[] = [];
  if (args.previousQuestions && args.previousQuestions.length > 0 && accepted.length > 0) {
    const overlapRes = checkVersionOverlap(args.previousQuestions, accepted);
    if (!overlapRes.valid) {
      warnings.push(
        `Version overlap notice: ${overlapRes.reason} Output maintained to ensure grounding.`
      );
    }
  }

  const typeOrder: QuestionType[] = [
    "blend_mc",
    "fill_blank",
    "tf_exact",
    "tf_swap",
    "reverse_id",
    "multiple_choice",
    "true_false",
    "identification",
  ];
  const ordered = accepted
    .slice()
    .sort(
      (a, b) =>
        typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
        a.sourceFactId.localeCompare(b.sourceFactId)
    );

  if (ordered.length < args.config.questionCount) {
    warnings.push(
      `Could only safely generate ${ordered.length} out of ${args.config.questionCount} questions due to strict grounding rules.`
    );
  }

  return {
    questions: ordered,
    facts: facts.map((f) => ({ id: f.id, text: f.text, pageLabel: f.pageLabel })),
    requestedCount: args.config.questionCount,
    acceptedCount: ordered.length,
    rejectedCount: rejections.length,
    rejections,
    model: first.model,
    promptVersion: "2.0-two-stage",
    demo: first.demo,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
