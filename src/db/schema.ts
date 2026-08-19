import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  real,
  date,
  index,
} from "drizzle-orm/pg-core";

/**
 * Data model for the single-user MVP.
 *
 * NOTE: There is intentionally NO User / userId / auth layer in V1.
 * The architecture starts at Student and supports adding ownership later
 * without a rewrite (every root entity is keyed independently).
 *
 * Statuses / types are stored as text and validated with Zod in code,
 * keeping the schema light and avoiding unnecessary normalization.
 */

/* ------------------------------- Students ------------------------------- */
export const students = pgTable(
  "students",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    gradeLevel: integer("grade_level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("students_created_at_idx").on(t.createdAt)]
);

/* ------------------------------ Exam Preps ------------------------------ */
export const examPreps = pgTable(
  "exam_preps",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    gradeLevel: integer("grade_level").notNull().default(1),
    examDate: date("exam_date"),
    teacherInstructions: text("teacher_instructions"),
    // draft | processing | verification | ready | generating | completed | failed
    status: text("status").notNull().default("draft"),
    // generated | source_reproduced
    generationMode: text("generation_mode").notNull().default("generated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("exam_preps_student_idx").on(t.studentId),
    index("exam_preps_status_idx").on(t.status),
  ]
);

/* -------------------------------- Pages --------------------------------- */
export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    examPrepId: text("exam_prep_id")
      .notNull()
      .references(() => examPreps.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    pageLabel: text("page_label"),
    // pending | processing | ready | failed
    status: text("status").notNull().default("pending"),
    qualityFlags: jsonb("quality_flags").$type<string[]>().default([]),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("pages_exam_prep_idx").on(t.examPrepId, t.orderIndex),
    index("pages_deleted_at_idx").on(t.deletedAt),
  ]
);

/* ------------------------------ OCR Results ----------------------------- */
export const ocrResults = pgTable(
  "ocr_results",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    // The raw NVIDIA response (kept for debugging / re-normalization)
    rawResponse: jsonb("raw_response"),
    // The deterministic normalized structure produced by normalize-ocr.ts
    normalized: jsonb("normalized"),
    // Convenience plain-text extraction
    text: text("text"),
    confidence: real("confidence"),
    warningFlags: jsonb("warning_flags").$type<string[]>().default([]),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ocr_results_page_idx").on(t.pageId)]
);

/* -------------------------- Verified Snapshots -------------------------- */
export const verifiedSnapshots = pgTable(
  "verified_snapshots",
  {
    id: text("id").primaryKey(),
    examPrepId: text("exam_prep_id")
      .notNull()
      .references(() => examPreps.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verified_snapshots_exam_prep_idx").on(t.examPrepId)]
);

export const verifiedContents = pgTable(
  "verified_contents",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => verifiedSnapshots.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
    // ExerciseItem | DeclarativeFact
    factKind: text("fact_kind").notNull().default("DeclarativeFact"),
    itemNumber: integer("item_number"),
    sentence: text("sentence"),
    blankToken: text("blank_token"),
    wordBank: jsonb("word_bank").$type<string[]>(),
    pictureCue: text("picture_cue"),
    proposedAnswer: text("proposed_answer"),
    handwrittenAnswer: text("handwritten_answer"),
    firstLetterClue: text("first_letter_clue"),
    letterCount: integer("letter_count"),
    answerHint: text("answer_hint"),
    parentConfirmed: boolean("parent_confirmed").notNull().default(false),
    content: text("content").notNull(),
    sourceOrder: integer("source_order").notNull(),
    included: boolean("included").notNull().default(true),
  },
  (t) => [index("verified_contents_snapshot_idx").on(t.snapshotId, t.sourceOrder)]
);

/* -------------------------- Source-Reproduced OCR Results -------------------------- */
export const sourceReproducedOcrResults = pgTable(
  "source_reproduced_ocr_results",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    rawResponse: jsonb("raw_response").notNull(),
    normalized: jsonb("normalized").notNull(),
    text: text("text").notNull(),
    warningFlags: jsonb("warning_flags").$type<string[]>().default([]),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("source_reproduced_ocr_results_page_idx").on(t.pageId)]
);

/* -------------------------- Verified Exercises (Source-Reproduced) -------------------------- */
/**
 * Verified source exercises - IMMUTABLE/AUTHORITATIVE after parent verification.
 * Contains the full exercise structure WITH answers as verified by parent.
 * Reconstruction derives the student-facing version from this.
 */
export const verifiedExercises = pgTable(
  "verified_exercises",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => verifiedSnapshots.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
    itemNumber: integer("item_number").notNull(),
    exerciseType: text("exercise_type").notNull(),
    instructions: text("instructions"),
    questionText: text("question_text").notNull(),
    blankLocations: integer("blank_locations").array(),
    choices: jsonb("choices").$type<string[]>(),
    wordBank: jsonb("word_bank").$type<string[]>(),
    matchingPairs: jsonb("matching_pairs").$type<{ left: string; right: string }[]>(),
    detectedAnswers: jsonb("detected_answers"),
    handwrittenAnswers: jsonb("handwritten_answers"),
    printedAnswers: jsonb("printed_answers"),
    answerMarkers: jsonb("answer_markers").$type<string[]>(),
    confidence: real("confidence"),
    pageLabel: text("page_label"),
    sourceOrder: integer("source_order").notNull(),
    included: boolean("included").notNull().default(true),
    parentConfirmed: boolean("parent_confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verified_exercises_snapshot_idx").on(t.snapshotId, t.sourceOrder)]
);

/* -------------------------- Verified Exercise Answers (Answer Key) -------------------------- */
/**
 * Answer key derived from verified source answers.
 * Separate table so answers are not mixed with student-facing questionnaire.
 */
export const verifiedExerciseAnswers = pgTable(
  "verified_exercise_answers",
  {
    id: text("id").primaryKey(),
    verifiedExerciseId: text("verified_exercise_id")
      .notNull()
      .references(() => verifiedExercises.id, { onDelete: "cascade" }),
    itemNumber: integer("item_number").notNull(),
    exerciseType: text("exercise_type").notNull(),
    answer: text("answer").notNull(),
    sourcePage: text("source_page"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("verified_exercise_answers_exercise_idx").on(t.verifiedExerciseId)]
);

/* -------------------------------- Exams --------------------------------- */
export const exams = pgTable(
  "exams",
  {
    id: text("id").primaryKey(),
    examPrepId: text("exam_prep_id")
      .notNull()
      .references(() => examPreps.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => verifiedSnapshots.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Reviewer configuration (question types, difficulty, count, format...)
    config: jsonb("config"),
    // generating | completed | failed
    status: text("status").notNull().default("generating"),
    // Auditing / versioning
    promptVersion: text("prompt_version"),
    generationModel: text("generation_model"),
    ocrModel: text("ocr_model"),
    stats: jsonb("stats"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("exams_exam_prep_idx").on(t.examPrepId, t.createdAt)]
);

/* ------------------------------- Questions ------------------------------ */
export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    // multiple_choice | fill_blank | true_false | identification
    type: text("type").notNull(),
    question: text("question").notNull(),
    // For multiple_choice this holds the array of choices.
    choices: jsonb("choices").$type<string[]>(),
    // The correct answer text (for MC, the correct choice text).
    answer: text("answer").notNull(),
    sourcePage: text("source_page"),
    sourceFactId: text("source_fact_id").notNull(),
    // For source_reproduced mode: reference to verified_exercises.id
    sourceExerciseItemId: text("source_exercise_item_id"),
    difficulty: text("difficulty"),
    // Validation metadata (kept for audit, never shown on the printed worksheet)
    validation: jsonb("validation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("questions_exam_idx").on(t.examId, t.orderIndex)]
);

/* ------------------------------ Exam Assets ----------------------------- */
export const examAssets = pgTable(
  "exam_assets",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    // reviewer_pdf | answer_key_pdf
    kind: text("kind").notNull(),
    pageFormat: text("page_format").notNull().default("A4"),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("exam_assets_exam_idx").on(t.examId, t.kind)]
);

/* --------------------------------- Jobs --------------------------------- */
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    // OCR_PAGE | GENERATE_EXAM | GENERATE_PDF
    type: text("type").notNull(),
    // pending | running | completed | failed
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt)]
);

/* -------------------------- Question Feedback --------------------------- */
export const questionFeedback = pgTable(
  "question_feedback",
  {
    id: text("id").primaryKey(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, {
      onDelete: "set null",
    }),
    // edit | delete
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("question_feedback_exam_idx").on(t.examId)]
);
