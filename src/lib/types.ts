import { z } from "zod";

/* ============================================================
   Shared domain types & Zod schemas (framework-agnostic).
   These are used by server logic, validation and the API layer.
   ============================================================ */

export const PROMPT_VERSION = "v1";

/* ------------------------------- Enums --------------------------------- */

export const QUESTION_TYPES = [
  "blend_mc",
  "fill_blank",
  "tf_exact",
  "tf_swap",
  "reverse_id",
  "multiple_choice",
  "true_false",
  "identification",
  "word_family_mc",
  "first_letter_fill",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  blend_mc: "Multiple Choice (Blend)",
  fill_blank: "Fill in the Blank",
  tf_exact: "True / False (Exact)",
  tf_swap: "True / False (Swap)",
  reverse_id: "Identification",
  multiple_choice: "Multiple Choice",
  true_false: "True / False",
  identification: "Identification",
  word_family_mc: "Multiple Choice (Word Family)",
  first_letter_fill: "First Letter Fill-in-the-Blank",
};

export const DIFFICULTIES = ["easy", "normal", "challenge"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const OUTPUT_FORMATS = ["reviewer", "exam"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const PAGE_FORMATS = ["A4", "Letter"] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

export const GENERATION_MODES = ["generated", "source_reproduced"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

/* --------------------------- Reviewer config --------------------------- */

export const reviewerConfigSchema = z.object({
  questionTypes: z.array(z.enum(QUESTION_TYPES)).min(1),
  difficulty: z.enum(DIFFICULTIES).default("normal"),
  questionCount: z.number().int().min(1).max(30).default(10),
  outputFormat: z.enum(OUTPUT_FORMATS).default("reviewer"),
  pageFormat: z.enum(PAGE_FORMATS).default("A4"),
  teacherInstructions: z.string().optional(),
  generationMode: z.enum(GENERATION_MODES).default("generated"),
});
export type ReviewerConfig = z.infer<typeof reviewerConfigSchema>;

/* ----------------------------- Grade profile --------------------------- */

export const gradeProfileSchema = z.object({
  grade: z.number().int(),
  maxSentenceWords: z.number().int().positive(),
  maxChoices: z.number().int().positive(),
  fontSize: z.number().int().positive(),
  avoid: z.array(z.string()),
  instructionStyle: z.string(),
});
export type GradeProfile = z.infer<typeof gradeProfileSchema>;

/* ---------------------------- Verified content ------------------------- */

export const FACT_KINDS = ["ExerciseItem", "DeclarativeFact"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const declarativeFactSchema = z.object({
  id: z.string().optional(),
  pageId: z.string().default(""),
  pageLabel: z.string().nullable().optional(),
  factKind: z.literal("DeclarativeFact").default("DeclarativeFact"),
  content: z.string(),
  sourceOrder: z.number().int().optional(),
  included: z.boolean().default(true),
});
export type DeclarativeFactItem = z.infer<typeof declarativeFactSchema>;

export const exerciseItemSchema = z.object({
  id: z.string().optional(),
  pageId: z.string().default(""),
  pageLabel: z.string().nullable().optional(),
  factKind: z.literal("ExerciseItem").default("ExerciseItem"),
  itemNumber: z.number().int().nullable().optional().default(null),
  sentence: z.string(),
  printedPrompt: z.string().optional(),
  blankToken: z.string().nullable().optional().default(null),
  wordBank: z.array(z.string()).nullable().optional().default(null),
  pictureCue: z.string().nullable().optional().default(null),
  proposedAnswer: z.string().nullable().optional().default(null),
  targetWord: z.string().nullable().optional().default(null),
  targetBlend: z.string().nullable().optional().default(null),
  handwrittenAnswer: z.string().nullable().optional().default(null),
  hasHandwriting: z.boolean().optional(),
  firstLetterClue: z.string().nullable().optional().default(null),
  letterCount: z.number().int().nullable().optional().default(null),
  answerHint: z.string().nullable().optional().default(null),
  parentConfirmed: z.boolean().default(false),
  content: z.string(),
  sourceOrder: z.number().int().optional(),
  included: z.boolean().default(true),
});
export type ExerciseItemData = z.infer<typeof exerciseItemSchema>;

/* --------------------------- Normalized OCR (moved up for schema deps) ---------------------------- */

export const ocrBlockSchema = z.object({
  order: z.number().int(),
  text: z.string(),
  confidence: z.number().optional(),
  left: z.number().optional(),
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
});
export type OcrBlock = z.infer<typeof ocrBlockSchema>;

/* --------------------- Source-Reproduced Exercise Types ------------------- */

export const answerSourceSchema = z.enum(["printed", "handwritten", "marker"]);
export type AnswerSource = z.infer<typeof answerSourceSchema>;

export const answerLocationSchema = z.enum(["blank", "choice", "word_bank", "marker_text"]);
export type AnswerLocation = z.infer<typeof answerLocationSchema>;

export const sourceReproducedAnswerSchema = z.object({
  value: z.string(),
  source: answerSourceSchema,
  location: answerLocationSchema,
  confidence: z.number().min(0).max(1),
});
export type SourceReproducedAnswer = z.infer<typeof sourceReproducedAnswerSchema>;

export const sourceReproducedExerciseItemSchema = z.object({
  itemNumber: z.number().int(),
  exerciseType: z.string(), // e.g., "fill_blank", "multiple_choice", "word_bank", "matching", "true_false"
  instructions: z.string().optional(),
  questionText: z.string(), // The full question text with answers in place
  blankLocations: z.array(z.number().int()).optional(), // Character positions of blanks
  choices: z.array(z.string()).optional(), // For multiple choice
  wordBank: z.array(z.string()).optional(), // For word bank exercises
  matchingPairs: z.array(z.object({ left: z.string(), right: z.string() })).optional(), // For matching
  detectedAnswers: z.array(sourceReproducedAnswerSchema).optional(), // Answers found in the image
  handwrittenAnswers: z.array(sourceReproducedAnswerSchema).optional(), // Specifically handwritten
  printedAnswers: z.array(sourceReproducedAnswerSchema).optional(), // Specifically printed
  answerMarkers: z.array(z.string()).optional(), // Explicit "Answer: B" type markers
  confidence: z.number().min(0).max(1).optional(),
  pageLabel: z.string().optional(),
  sourceOrder: z.number().int(),
  included: z.boolean().default(true),
});
export type SourceReproducedExerciseItem = z.infer<typeof sourceReproducedExerciseItemSchema>;

export const sourceReproducedOcrSchema = z.object({
  text: z.string(),
  blocks: z.array(ocrBlockSchema),
  avgConfidence: z.number().optional(),
  detectedFormat: z.string(),
  warningFlags: z.array(z.string()),
  pageInstructions: z.array(z.string()).optional(),
  availableBank: z.array(z.string()).optional(),
  exerciseItems: z.array(sourceReproducedExerciseItemSchema).optional(),
});
export type SourceReproducedOcr = z.infer<typeof sourceReproducedOcrSchema>;

/* --------------------- Verified Source Exercise (Immutable/Authoritative) --------------------- */
/**
 * Verified source exercise - IMMUTABLE after parent verification.
 * Contains the full exercise structure WITH answers as verified by parent.
 * Reconstruction derives the student-facing version from this.
 */
export const verifiedExerciseSchema = z.object({
  id: z.string(),
  snapshotId: z.string(),
  pageId: z.string().nullable().optional(),
  itemNumber: z.number().int(),
  exerciseType: z.string(),
  instructions: z.string().nullable().optional(),
  questionText: z.string(), // Full question text WITH answers (parent-verified)
  blankLocations: z.array(z.number().int()).optional(),
  choices: z.array(z.string()).optional(),
  wordBank: z.array(z.string()).optional(),
  matchingPairs: z.array(z.object({ left: z.string(), right: z.string() })).optional(),
  detectedAnswers: z.array(sourceReproducedAnswerSchema).optional(),
  handwrittenAnswers: z.array(sourceReproducedAnswerSchema).optional(),
  printedAnswers: z.array(sourceReproducedAnswerSchema).optional(),
  answerMarkers: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  pageLabel: z.string().nullable().optional(),
  sourceOrder: z.number().int(),
  included: z.boolean().default(true),
  parentConfirmed: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});
export type VerifiedExercise = z.infer<typeof verifiedExerciseSchema>;

/* --------------------- Verified Exercise Answer (Answer Key) --------------------- */
/**
 * Answer key derived from verified source answers.
 * Separate from questionnaire so answers are not mixed with student-facing version.
 */
export const verifiedExerciseAnswerSchema = z.object({
  id: z.string(),
  verifiedExerciseId: z.string(),
  itemNumber: z.number().int(),
  exerciseType: z.string(),
  answer: z.string(),
  sourcePage: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});
export type VerifiedExerciseAnswer = z.infer<typeof verifiedExerciseAnswerSchema>;

/* --------------------- Source-Reproduced PDF Question (Preserves Structure) --------------------- */
/**
 * PDF question format for source-reproduced mode.
 * Preserves original exercise structure, wording, and formatting.
 * Does NOT map exercise types to generated question types.
 */
export const sourceReproducedPdfQuestionSchema = z.object({
  // Original exercise type (not mapped)
  exerciseType: z.string(), // fill_blank, multiple_choice, word_bank, matching, true_false, complete_sentence, circle_select, other
  // Original item number from source
  itemNumber: z.number().int(),
  // Section/instructions
  instructions: z.string().nullable().optional(),
  // Question text with blanks preserved in original format (e.g., "b _ _ _", "_____", "[ ]")
  questionText: z.string(),
  // For multiple_choice / circle_select
  choices: z.array(z.string()).optional(),
  // For word_bank / fill_blank with word bank
  wordBank: z.array(z.string()).optional(),
  // For matching
  matchingPairs: z.array(z.object({ left: z.string(), right: z.string() })).optional(),
  // Source page reference
  sourcePage: z.string().nullable().optional(),
  // Traceability to verified exercise
  sourceExerciseItemId: z.string(),
  // Answer (for answer key only - not printed in student version)
  answer: z.string().optional(),
});
export type SourceReproducedPdfQuestion = z.infer<typeof sourceReproducedPdfQuestionSchema>;

// Reconstructed exercise item (output of reconstruction engine)
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

export const verifiedContentItemSchema = z.discriminatedUnion("factKind", [
  declarativeFactSchema,
  exerciseItemSchema,
]);
export type VerifiedContentItem = z.infer<typeof verifiedContentItemSchema>;

export const normalizedOcrSchema = z.object({
  text: z.string(),
  blocks: z.array(ocrBlockSchema),
  avgConfidence: z.number().optional(),
  detectedFormat: z.string(),
  warningFlags: z.array(z.string()),
  declarativeFacts: z.array(declarativeFactSchema).optional(),
  exerciseItems: z.array(exerciseItemSchema).optional(),
  pageWordFamily: z.array(z.string()).optional(),
  pageInstructions: z.array(z.string()).optional(),
  availableBank: z.array(z.string()).optional(),
});
export type NormalizedOcr = z.infer<typeof normalizedOcrSchema>;

/* ------------------------------ Questions ------------------------------ */

export const questionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  question: z.string().min(1),
  answer: z.string().min(1),
  choices: z.array(z.string()).optional(),
  sourcePage: z.string().nullable().optional(),
  sourceFactId: z.string().min(1),
  // For source_reproduced mode: reference to verified_exercises.id
  sourceExerciseItemId: z.string().optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});
export type Question = z.infer<typeof questionSchema>;

// Alias for PDF generation (generated mode)
export type PdfQuestion = Question;

/* Validation result for a single question */
export const validationOutcomeSchema = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
  checks: z
    .array(z.object({ name: z.string(), passed: z.boolean(), note: z.string().optional() }))
    .optional(),
});
export type ValidationOutcome = z.infer<typeof validationOutcomeSchema>;

/* -------------------- Grade 1 Reviewer Specification -------------------- */

export const grade1QuestionSchema = z.object({
  itemNumber: z.number().int(),
  sourceItemRef: z.string(),
  imageClue: z.string().nullable().optional(),
  promptText: z.string().min(1),
  blankToken: z.string().nullable().optional(),
  options: z.array(z.string()).nullable().optional(),
  correctAnswer: z.string().min(1),
  targetWord: z.string().optional(),
  parentExplanation: z.string().optional(),
});
export type Grade1Question = z.infer<typeof grade1QuestionSchema>;

export const grade1SectionSchema = z.object({
  sectionTitle: z.string(),
  formatType: z.enum(["phonics_mc", "fill_blank", "first_letter_fill", "tf_simple"]),
  sectionInstructions: z.string(),
  questions: z.array(grade1QuestionSchema),
});
export type Grade1Section = z.infer<typeof grade1SectionSchema>;

export const grade1ReviewerSchema = z.object({
  unitTopic: z.string(),
  sourceInstruction: z.string().optional(),
  instruction: z.string().optional(),
  availableBank: z.array(z.string()),
  sections: z.array(grade1SectionSchema),
});
export type Grade1Reviewer = z.infer<typeof grade1ReviewerSchema>;

/* ------------------------------ Job types ------------------------------ */

export const JOB_TYPES = ["OCR_PAGE", "GENERATE_EXAM", "GENERATE_PDF"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Sanitizes option string by removing repetitive prefix labels like "A. ", "B) ", "1. " */
export function sanitizeOption(option: string): string {
  if (!option) return "";
  return option.replace(/^[A-Za-z0-9][.)]\s*/, "").trim();
}

/** Robust comparison checking if a choice option matches the answer string */
export function isCorrectAnswer(option: string, answer: string): boolean {
  if (!option || !answer) return false;
  const cleanOpt = sanitizeOption(option).toLowerCase();
  const cleanAns = sanitizeOption(answer).toLowerCase();
  const rawOpt = option.trim().toLowerCase();
  const rawAns = answer.trim().toLowerCase();
  return (
    cleanOpt === cleanAns ||
    rawOpt === rawAns ||
    cleanOpt === rawAns ||
    rawOpt === cleanAns
  );
}
