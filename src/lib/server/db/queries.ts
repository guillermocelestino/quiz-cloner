/**
 * Centralized data-access layer (server-only).
 * Keeps Drizzle query details out of route handlers and workers.
 */
import { db } from "@/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  examAssets,
  examPreps,
  exams,
  jobs,
  ocrResults,
  pages,
  questions,
  students,
  verifiedContents,
  verifiedSnapshots,
  questionFeedback,
  sourceReproducedOcrResults,
  verifiedExercises,
  verifiedExerciseAnswers,
} from "@/db/schema";
import type { NormalizedOcr, ReviewerConfig } from "@/lib/types";
import type { GeneratedQuestion } from "@/lib/server/generation/generate-reviewer";

const now = () => new Date();

/* ------------------------------- Students ------------------------------- */
export async function createStudent(input: {
  displayName: string;
  gradeLevel: number;
}) {
  const [row] = await db
    .insert(students)
    .values({
      id: nanoid(12),
      displayName: input.displayName.trim(),
      gradeLevel: input.gradeLevel,
    })
    .returning();
  return row;
}

export async function listStudents() {
  return db.select().from(students).orderBy(desc(students.createdAt));
}

export async function getStudent(id: string) {
  const [row] = await db.select().from(students).where(eq(students.id, id));
  return row ?? null;
}

/* ------------------------------ Exam preps ------------------------------ */
export async function createExamPrep(input: {
  studentId: string;
  subject: string;
  gradeLevel: number;
  examDate?: string | null;
  teacherInstructions?: string | null;
  generationMode?: "generated" | "source_reproduced";
}) {
  const [row] = await db
    .insert(examPreps)
    .values({
      id: nanoid(12),
      studentId: input.studentId,
      subject: input.subject.trim(),
      gradeLevel: input.gradeLevel,
      examDate: input.examDate || null,
      teacherInstructions: input.teacherInstructions?.trim() || null,
      generationMode: input.generationMode ?? "generated",
    })
    .returning();
  return row;
}

export async function getExamPrep(id: string) {
  const [row] = await db
    .select({
      examPrep: examPreps,
      studentName: students.displayName,
      studentGrade: students.gradeLevel,
    })
    .from(examPreps)
    .leftJoin(students, eq(students.id, examPreps.studentId))
    .where(eq(examPreps.id, id));
  return row ?? null;
}

export async function listRecentExamPreps(limit = 20) {
  return db
    .select({
      examPrep: examPreps,
      studentName: students.displayName,
    })
    .from(examPreps)
    .leftJoin(students, eq(students.id, examPreps.studentId))
    .orderBy(desc(examPreps.updatedAt))
    .limit(limit);
}

export async function listExamPrepsForStudent(studentId: string) {
  return db
    .select()
    .from(examPreps)
    .where(eq(examPreps.studentId, studentId))
    .orderBy(desc(examPreps.updatedAt));
}

export async function updateExamPrep(
  id: string,
  patch: Partial<{
    status: string;
    subject: string;
    teacherInstructions: string | null;
    examDate: string | null;
  }>
) {
  const [row] = await db
    .update(examPreps)
    .set({ ...patch, updatedAt: now() })
    .where(eq(examPreps.id, id))
    .returning();
  return row;
}

/* -------------------------------- Pages --------------------------------- */
export async function createPage(input: {
  examPrepId: string;
  orderIndex: number;
  storageKey: string;
  originalFilename?: string | null;
  mimeType: string;
  pageLabel?: string | null;
  qualityFlags?: string[];
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
}) {
  const [row] = await db
    .insert(pages)
    .values({
      id: nanoid(12),
      examPrepId: input.examPrepId,
      orderIndex: input.orderIndex,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename ?? null,
      mimeType: input.mimeType,
      pageLabel: input.pageLabel ?? null,
      qualityFlags: input.qualityFlags ?? [],
      width: input.width ?? null,
      height: input.height ?? null,
      sizeBytes: input.sizeBytes ?? null,
    })
    .returning();
  return row;
}

export async function listPages(examPrepId: string) {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.examPrepId, examPrepId), isNull(pages.deletedAt)))
    .orderBy(asc(pages.orderIndex));
}

export async function nextPageOrder(examPrepId: string) {
  const rows = await listPages(examPrepId);
  return rows.length ? Math.max(...rows.map((r) => r.orderIndex)) + 1 : 0;
}

export async function softDeletePage(id: string) {
  await db
    .update(pages)
    .set({ deletedAt: now(), status: "failed" })
    .where(eq(pages.id, id));
}

export async function updatePage(
  id: string,
  patch: Partial<{ pageLabel: string | null; status: string; processedAt: Date | null }>
) {
  const [row] = await db.update(pages).set(patch).where(eq(pages.id, id)).returning();
  return row;
}

/** Replace a page's underlying image (re-take). Resets OCR. */
export async function updatePageStorage(
  id: string,
  storageKey: string,
  analysis: {
    optimizedMime: string;
    width?: number;
    height?: number;
    sizeBytes: number;
    qualityFlags: string[];
  }
) {
  await db.delete(ocrResults).where(eq(ocrResults.pageId, id));
  const [row] = await db
    .update(pages)
    .set({
      storageKey,
      mimeType: analysis.optimizedMime,
      width: analysis.width ?? null,
      height: analysis.height ?? null,
      sizeBytes: analysis.sizeBytes,
      qualityFlags: analysis.qualityFlags,
      status: "pending",
      processedAt: null,
    })
    .where(eq(pages.id, id))
    .returning();
  return row;
}

export async function reorderPages(examPrepId: string, orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(pages)
      .set({ orderIndex: i })
      .where(and(eq(pages.id, orderedIds[i]), eq(pages.examPrepId, examPrepId)));
  }
}

/* ------------------------------ OCR results ----------------------------- */
export async function saveOcrResult(input: {
  pageId: string;
  rawResponse: unknown;
  normalized: NormalizedOcr;
  text: string;
  confidence?: number | null;
  warningFlags: string[];
  model: string;
}) {
  // Replace any existing result for the page.
  await db.delete(ocrResults).where(eq(ocrResults.pageId, input.pageId));
  const [row] = await db
    .insert(ocrResults)
    .values({
      id: nanoid(12),
      pageId: input.pageId,
      rawResponse: input.rawResponse as never,
      normalized: input.normalized as never,
      text: input.text,
      confidence: input.confidence ?? null,
      warningFlags: input.warningFlags,
      model: input.model,
    })
    .returning();
  return row;
}

export async function getOcrResult(pageId: string) {
  const [row] = await db
    .select()
    .from(ocrResults)
    .where(eq(ocrResults.pageId, pageId));
  return row ?? null;
}

export async function getOcrResultsForExamPrep(examPrepId: string) {
  return db
    .select({ page: pages, ocr: ocrResults })
    .from(pages)
    .leftJoin(ocrResults, eq(ocrResults.pageId, pages.id))
    .where(and(eq(pages.examPrepId, examPrepId), isNull(pages.deletedAt)))
    .orderBy(asc(pages.orderIndex));
}

/* -------------------- Source-Reproduced OCR Results -------------------- */
export async function saveSourceReproducedOcrResult(input: {
  pageId: string;
  rawResponse: unknown;
  normalized: unknown;
  text: string;
  warningFlags: string[];
  model: string;
}) {
  const [row] = await db
    .insert(sourceReproducedOcrResults)
    .values({
      id: nanoid(12),
      pageId: input.pageId,
      rawResponse: input.rawResponse,
      normalized: input.normalized,
      text: input.text,
      warningFlags: input.warningFlags,
      model: input.model,
    })
    .returning();
  return row;
}

export async function getSourceReproducedOcrResultsForExamPrep(examPrepId: string) {
  return db
    .select({ page: pages, ocr: sourceReproducedOcrResults })
    .from(pages)
    .leftJoin(sourceReproducedOcrResults, eq(sourceReproducedOcrResults.pageId, pages.id))
    .where(and(eq(pages.examPrepId, examPrepId), isNull(pages.deletedAt)))
    .orderBy(asc(pages.orderIndex));
}

/* -------------------------- Verified snapshots -------------------------- */
export async function createSnapshot(examPrepId: string) {
  const [latest] = await db
    .select()
    .from(verifiedSnapshots)
    .where(eq(verifiedSnapshots.examPrepId, examPrepId))
    .orderBy(desc(verifiedSnapshots.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const [row] = await db
    .insert(verifiedSnapshots)
    .values({ id: nanoid(12), examPrepId, version })
    .returning();
  return row;
}

export async function getLatestSnapshot(examPrepId: string) {
  const [row] = await db
    .select()
    .from(verifiedSnapshots)
    .where(eq(verifiedSnapshots.examPrepId, examPrepId))
    .orderBy(desc(verifiedSnapshots.version))
    .limit(1);
  return row ?? null;
}

export async function addVerifiedContents(
  snapshotId: string,
  items: {
    pageId: string | null;
    content: string;
    sourceOrder: number;
    included: boolean;
    factKind?: string;
    itemNumber?: number | null;
    sentence?: string | null;
    blankToken?: string | null;
    wordBank?: string[] | null;
    pictureCue?: string | null;
    proposedAnswer?: string | null;
    handwrittenAnswer?: string | null;
    firstLetterClue?: string | null;
    letterCount?: number | null;
    answerHint?: string | null;
    parentConfirmed?: boolean;
  }[]
) {
  if (items.length === 0) return;
  await db.insert(verifiedContents).values(
    items.map((it) => ({
      id: nanoid(12),
      snapshotId,
      pageId: it.pageId,
      factKind: it.factKind ?? "DeclarativeFact",
      itemNumber: it.itemNumber ?? null,
      sentence: it.sentence ?? null,
      blankToken: it.blankToken ?? null,
      wordBank: it.wordBank ?? null,
      pictureCue: it.pictureCue ?? null,
      proposedAnswer: it.proposedAnswer ?? null,
      handwrittenAnswer: it.handwrittenAnswer ?? null,
      firstLetterClue: it.firstLetterClue ?? null,
      letterCount: it.letterCount ?? null,
      answerHint: it.answerHint ?? null,
      parentConfirmed: it.parentConfirmed ?? false,
      content: it.content,
      sourceOrder: it.sourceOrder,
      included: it.included,
    }))
  );
}

export async function logQuestionFeedback(input: {
  examId: string;
  questionId?: string | null;
  action: "edit" | "delete";
  details?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(questionFeedback)
    .values({
      id: nanoid(12),
      examId: input.examId,
      questionId: input.questionId ?? null,
      action: input.action,
      details: input.details ?? null,
    })
    .returning();
  return row;
}

export async function getSnapshotContents(snapshotId: string) {
  return db
    .select({ content: verifiedContents, pageLabel: pages.pageLabel })
    .from(verifiedContents)
    .leftJoin(pages, eq(pages.id, verifiedContents.pageId))
    .where(eq(verifiedContents.snapshotId, snapshotId))
    .orderBy(asc(verifiedContents.sourceOrder));
}

/* --------------------- Verified Exercises (Source-Reproduced) --------------------- */
export async function addVerifiedExercises(
  snapshotId: string,
  items: {
    pageId: string | null;
    itemNumber: number;
    exerciseType: string;
    instructions: string | null | undefined;
    questionText: string;
    blankLocations: number[] | null | undefined;
    choices: string[] | null | undefined;
    wordBank: string[] | null | undefined;
    matchingPairs: { left: string; right: string }[] | null | undefined;
    detectedAnswers: unknown[] | null | undefined;
    handwrittenAnswers: unknown[] | null | undefined;
    printedAnswers: unknown[] | null | undefined;
    answerMarkers: string[] | null | undefined;
    confidence: number | null | undefined;
    pageLabel: string | null | undefined;
    sourceOrder: number;
    included: boolean;
    parentConfirmed: boolean;
  }[]
) {
  if (items.length === 0) return [];
  const rows = await db
    .insert(verifiedExercises)
    .values(
      items.map((it) => ({
        id: nanoid(12),
        snapshotId,
        pageId: it.pageId,
        itemNumber: it.itemNumber,
        exerciseType: it.exerciseType,
        instructions: it.instructions ?? null,
        questionText: it.questionText,
        blankLocations: it.blankLocations ?? null,
        choices: it.choices ?? null,
        wordBank: it.wordBank ?? null,
        matchingPairs: it.matchingPairs ?? null,
        detectedAnswers: it.detectedAnswers ?? null,
        handwrittenAnswers: it.handwrittenAnswers ?? null,
        printedAnswers: it.printedAnswers ?? null,
        answerMarkers: it.answerMarkers ?? null,
        confidence: it.confidence ?? null,
        pageLabel: it.pageLabel ?? null,
        sourceOrder: it.sourceOrder,
        included: it.included,
        parentConfirmed: it.parentConfirmed,
      }))
    )
    .returning();
  return rows;
}

export async function getVerifiedExercisesForSnapshot(snapshotId: string) {
  return db
    .select()
    .from(verifiedExercises)
    .where(eq(verifiedExercises.snapshotId, snapshotId))
    .orderBy(asc(verifiedExercises.sourceOrder));
}

export async function updateVerifiedExerciseQuestionnaireText(
  exerciseId: string,
  questionnaireText: string,
  blankLocations: number[]
) {
  const existing = await db
    .select({ parentConfirmed: verifiedExercises.parentConfirmed })
    .from(verifiedExercises)
    .where(eq(verifiedExercises.id, exerciseId))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Verified exercise not found: ${exerciseId}`);
  }

  if (existing[0].parentConfirmed) {
    throw new Error(
      `Cannot update verified exercise ${exerciseId}: verified source is finalized and immutable.`
    );
  }

  const [row] = await db
    .update(verifiedExercises)
    .set({ questionText: questionnaireText, blankLocations })
    .where(
      and(
        eq(verifiedExercises.id, exerciseId),
        eq(verifiedExercises.parentConfirmed, false)
      )
    )
    .returning();
  return row;
}

/* --------------------- Verified Exercise Answers (Answer Key) --------------------- */
export async function addVerifiedExerciseAnswers(
  snapshotId: string,
  items: {
    verifiedExerciseId: string;
    itemNumber: number;
    exerciseType: string;
    answer: string;
    sourcePage: string | null | undefined;
  }[]
) {
  if (items.length === 0) return;
  await db.insert(verifiedExerciseAnswers).values(
    items.map((it) => ({
      id: nanoid(12),
      verifiedExerciseId: it.verifiedExerciseId,
      itemNumber: it.itemNumber,
      exerciseType: it.exerciseType,
      answer: it.answer,
      sourcePage: it.sourcePage ?? null,
    }))
  );
}

export async function getVerifiedExerciseAnswersForSnapshot(snapshotId: string) {
  // Join through verified_exercises to filter by snapshot
  return db
    .select({
      answer: verifiedExerciseAnswers,
      exercise: verifiedExercises,
    })
    .from(verifiedExerciseAnswers)
    .leftJoin(verifiedExercises, eq(verifiedExercises.id, verifiedExerciseAnswers.verifiedExerciseId))
    .where(eq(verifiedExercises.snapshotId, snapshotId))
    .orderBy(asc(verifiedExerciseAnswers.itemNumber));
}

/* -------------------------------- Exams --------------------------------- */
export async function createExam(input: {
  examPrepId: string;
  snapshotId: string;
  version: number;
  config: ReviewerConfig;
  promptVersion: string;
  generationModel: string;
  ocrModel: string;
}) {
  const [row] = await db
    .insert(exams)
    .values({
      id: nanoid(12),
      examPrepId: input.examPrepId,
      snapshotId: input.snapshotId,
      version: input.version,
      config: input.config as never,
      status: "generating",
      promptVersion: input.promptVersion,
      generationModel: input.generationModel,
      ocrModel: input.ocrModel,
    })
    .returning();
  return row;
}

export async function updateExam(
  id: string,
  patch: Partial<{
    status: string;
    stats: unknown;
    failureReason: string | null;
    completedAt: Date | null;
  }>
) {
  const [row] = await db
    .update(exams)
    .set(patch)
    .where(eq(exams.id, id))
    .returning();
  return row;
}

export async function nextExamVersion(examPrepId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(exams)
    .where(eq(exams.examPrepId, examPrepId));
  return (row?.count ?? 0) + 1;
}

export async function getExam(id: string) {
  const [row] = await db.select().from(exams).where(eq(exams.id, id));
  return row ?? null;
}

export async function getExamWithQuestions(id: string) {
  const exam = await getExam(id);
  if (!exam) return null;
  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.examId, id))
    .orderBy(asc(questions.orderIndex));
  return { exam, questions: qs };
}

export async function listExamsForExamPrep(examPrepId: string) {
  return db
    .select()
    .from(exams)
    .where(eq(exams.examPrepId, examPrepId))
    .orderBy(desc(exams.createdAt));
}

export async function getLatestExamQuestionsForPrep(examPrepId: string) {
  const previousExams = await listExamsForExamPrep(examPrepId);
  for (const ex of previousExams) {
    const data = await getExamWithQuestions(ex.id);
    if (data && data.questions.length > 0) {
      return data.questions;
    }
  }
  return [];
}

export async function addQuestions(examId: string, qs: GeneratedQuestion[]) {
  if (qs.length === 0) return;
  await db.insert(questions).values(
    qs.map((q, i) => ({
      id: nanoid(12),
      examId,
      orderIndex: i,
      type: q.type,
      question: q.question,
      choices: q.choices ?? null,
      answer: q.answer,
      sourcePage: q.sourcePage ?? null,
      sourceFactId: q.sourceFactId,
      // For source_reproduced mode: reference to verified_exercises.id
      sourceExerciseItemId: (q as any).sourceExerciseItemId ?? null,
      difficulty: q.difficulty ?? null,
      validation: (q.validation ?? null) as never,
    }))
  );
}

export async function createExamAsset(input: {
  examId: string;
  kind: string;
  pageFormat: string;
  storageKey: string;
}) {
  const [row] = await db
    .insert(examAssets)
    .values({
      id: nanoid(12),
      examId: input.examId,
      kind: input.kind,
      pageFormat: input.pageFormat,
      storageKey: input.storageKey,
    })
    .returning();
  return row;
}

export async function listAssetsForExam(examId: string) {
  return db.select().from(examAssets).where(eq(examAssets.examId, examId));
}

/* --------------------------------- Jobs --------------------------------- */
export async function createJob(input: { type: string; payload?: unknown }) {
  const [row] = await db
    .insert(jobs)
    .values({
      id: nanoid(12),
      type: input.type,
      status: "pending",
      payload: (input.payload ?? null) as never,
    })
    .returning();
  return row;
}

export async function updateJob(
  id: string,
  patch: Partial<{
    status: string;
    attempts: number;
    error: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }>
) {
  await db.update(jobs).set(patch).where(eq(jobs.id, id));
}
