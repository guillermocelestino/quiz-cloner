/**
 * Background workers for the PostgreSQL-backed job system (server-only).
 *
 * OCR and generation do not block the browser request: the route handler
 * kicks these off (fire-and-forget) and the client polls for status.
 */
import { runNemotronOcr, runNemotronExerciseOcr } from "./ai/nvidia-ocr";
import { extractTextbookPage, extractTextbookExercise } from "./ai/gemini-ocr";
import { getOcrModel, getReasoningModel, isDemoMode, NvidiaError } from "./ai/nvidia-client";
import { normalizeOcr, normalizeExerciseOcr } from "./ocr/normalize-ocr";
import { generateReviewer } from "./generation/generate-reviewer";
import { generateGrade1Reviewer } from "./ai/gemini-reviewer";
import { generateSourceReproducedExercise } from "./reconstruction/source-reproduced-generator";
import { readBytes } from "./storage";
import * as q from "./db/queries";
import { PROMPT_VERSION, type ReviewerConfig, sanitizeOption } from "@/lib/types";
import sharp from "sharp";

function errMsg(err: unknown): string {
  if (err instanceof NvidiaError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * Run Nemotron OCR v2 across all (non-deleted) pages of an exam prep, store
 * normalized results, and move the exam prep into verification.
 */
export async function runOcrForExamPrep(examPrepId: string): Promise<void> {
  const job = await q.createJob({ type: "OCR_PAGE", payload: { examPrepId } });
  await q.updateJob(job.id, { status: "running", startedAt: new Date() });
  await q.updateExamPrep(examPrepId, { status: "processing" });

  try {
    const ep = await q.getExamPrep(examPrepId);
    const generationMode = ep?.examPrep.generationMode ?? "generated";
    const pageRows = await q.listPages(examPrepId);

    if (pageRows.length === 0) {
      await q.updateExamPrep(examPrepId, { status: "draft" });
      await q.updateJob(job.id, { status: "failed", error: "No pages to read.", completedAt: new Date() });
      return;
    }

    await Promise.all(
      pageRows.map(async (page) => {
        try {
          const bytes = await readBytes(page.storageKey);
          let content: string;
          let raw: unknown;
          let model: string;

          if (generationMode === "source_reproduced") {
            // Source-Reproduced OCR Path
            if (process.env.GEMINI_API_KEY) {
              try {
                model = "gemini-2.0-flash-exercise";
                const geminiData = await extractTextbookExercise(bytes, page.mimeType);
                raw = geminiData;
                content = JSON.stringify(geminiData, null, 2);
              } catch (geminiErr: any) {
                console.warn(
                  `[workers] Gemini Exercise OCR unavailable (${geminiErr?.message || "Quota Exceeded"}). Falling back to Nemotron...`
                );
                const ocrRes = await runNemotronExerciseOcr({
                  imageBuffer: bytes,
                  mimeType: page.mimeType,
                });
                content = ocrRes.content;
                raw = ocrRes.raw;
                model = ocrRes.model;
              }
            } else {
              const ocrRes = await runNemotronExerciseOcr({
                imageBuffer: bytes,
                mimeType: page.mimeType,
              });
              content = ocrRes.content;
              raw = ocrRes.raw;
              model = ocrRes.model;
            }

            const normalized = normalizeExerciseOcr(raw, content, model);
            await q.saveSourceReproducedOcrResult({
              pageId: page.id,
              rawResponse: raw,
              normalized,
              text: normalized.text,
              warningFlags: normalized.warningFlags,
              model,
            });
            const isReady =
              Boolean(normalized.text.trim()) ||
              Boolean(normalized.exerciseItems?.length);
            await q.updatePage(page.id, {
              status: isReady ? "ready" : "failed",
              processedAt: new Date(),
            });
          } else {
            // Generated Mode Path (UNCHANGED)
            if (process.env.GEMINI_API_KEY) {
              try {
                model = "gemini-2.0-flash";
                const geminiData = await extractTextbookPage(bytes, page.mimeType);
                raw = geminiData;
                content = JSON.stringify(geminiData, null, 2);
              } catch (geminiErr: any) {
                console.warn(
                  `[workers] Gemini OCR unavailable (${geminiErr?.message || "Quota Exceeded"}). Falling back to Nemotron OCR...`
                );
                const ocrRes = await runNemotronOcr({
                  imageBuffer: bytes,
                  mimeType: page.mimeType,
                });
                content = ocrRes.content;
                raw = ocrRes.raw;
                model = ocrRes.model;
              }
            } else {
              const ocrRes = await runNemotronOcr({
                imageBuffer: bytes,
                mimeType: page.mimeType,
              });
              content = ocrRes.content;
              raw = ocrRes.raw;
              model = ocrRes.model;
            }

            const normalized = normalizeOcr(content, raw);
            await q.saveOcrResult({
              pageId: page.id,
              rawResponse: raw,
              normalized,
              text: normalized.text,
              confidence: normalized.avgConfidence ?? null,
              warningFlags: normalized.warningFlags,
              model,
            });
            const isReady =
              Boolean(normalized.text.trim()) ||
              Boolean(normalized.exerciseItems?.length) ||
              Boolean(normalized.declarativeFacts?.length);
            await q.updatePage(page.id, {
              status: isReady ? "ready" : "failed",
              processedAt: new Date(),
            });
          }
        } catch (err) {
          console.error(`[workers] Page ${page.id} OCR error:`, err);
          await q.updatePage(page.id, { status: "failed", processedAt: new Date() });
          if (generationMode === "source_reproduced") {
            await q.saveSourceReproducedOcrResult({
              pageId: page.id,
              rawResponse: null,
              normalized: {
                text: "",
                pageInstructions: [],
                availableBank: [],
                exerciseItems: [],
                warningFlags: ["ocr_failed"],
              },
              text: "",
              warningFlags: ["ocr_failed"],
              model: getOcrModel(),
            });
          } else {
            await q.saveOcrResult({
              pageId: page.id,
              rawResponse: null,
              normalized: {
                text: "",
                blocks: [],
                detectedFormat: "error",
                warningFlags: ["ocr_failed"],
              },
              text: "",
              warningFlags: ["ocr_failed"],
              model: getOcrModel(),
            });
          }
          await q.updateJob(job.id, { error: errMsg(err) });
        }
      })
    );

    await q.updateExamPrep(examPrepId, { status: "verification" });
    await q.updateJob(job.id, { status: "completed", completedAt: new Date() });
  } catch (err) {
    await q.updateExamPrep(examPrepId, { status: "failed" });
    await q.updateJob(job.id, {
      status: "failed",
      error: errMsg(err),
      completedAt: new Date(),
    });
  }
}

/**
 * Generate a grounded reviewer from the latest verified snapshot.
 * Branches on generationMode: "generated" (existing) or "source_reproduced" (new).
 */
export async function generateReviewerForExamPrep(
  examPrepId: string,
  config: ReviewerConfig
): Promise<{ examId: string; acceptedCount: number; rejectedCount: number; demo: boolean }> {
  const ep = await q.getExamPrep(examPrepId);
  if (!ep) throw new Error("Exam prep not found.");
  const snapshot = await q.getLatestSnapshot(examPrepId);
  if (!snapshot) throw new Error("No verified snapshot found. Verify the pages first.");

  const contents = await q.getSnapshotContents(snapshot.id);
  const previousQuestions = await q.getLatestExamQuestionsForPrep(examPrepId);

  const includedItems = contents
    .filter((c) => c.content.included)
    .map((c) => ({
      content: c.content.content,
      pageLabel: c.pageLabel,
      included: true,
      factKind: c.content.factKind ?? undefined,
      itemNumber: c.content.itemNumber,
      sentence: c.content.sentence,
      blankToken: c.content.blankToken,
      wordBank: c.content.wordBank,
      pictureCue: c.content.pictureCue,
      proposedAnswer: c.content.proposedAnswer,
    }));

  const job = await q.createJob({
    type: "GENERATE_EXAM",
    payload: { examPrepId, snapshotId: snapshot.id },
  });
  await q.updateJob(job.id, { status: "running", startedAt: new Date() });
  await q.updateExamPrep(examPrepId, { status: "generating" });

  const version = await q.nextExamVersion(examPrepId);
  const exam = await q.createExam({
    examPrepId,
    snapshotId: snapshot.id,
    version,
    config,
    promptVersion: PROMPT_VERSION,
    generationModel: getReasoningModel(),
    ocrModel: getOcrModel(),
  });

  try {
    let result: any;

    // Branch on generation mode
    if (config.generationMode === "source_reproduced" || ep.examPrep.generationMode === "source_reproduced") {
      // Source-Reproduced Exercise Mode: deterministic reconstruction from verified_exercises
      result = await generateSourceReproducedExam(examPrepId, snapshot.id, config);
    } else {
      // Existing Generated Reviewer Mode (unchanged)
      if (process.env.GEMINI_API_KEY) {
        try {
          const geminiRes = await generateGrade1Reviewer(includedItems, config.questionTypes);
          const flattenedQs: any[] = [];
          if (geminiRes.sections && Array.isArray(geminiRes.sections)) {
            for (const sec of geminiRes.sections) {
              if (sec.questions && Array.isArray(sec.questions)) {
                for (const qItem of sec.questions) {
                  flattenedQs.push({
                    type: sec.formatType || "multiple_choice",
                    question: qItem.promptText,
                    answer: qItem.correctAnswer,
                    choices: (qItem.options || []).map((opt: string) => sanitizeOption(opt)),
                    sourceFactId: `gemini_q_${qItem.itemNumber}`,
                    difficulty: "easy",
                    validation: { valid: true, explanation: qItem.parentExplanation },
                  });
                }
              }
            }
          }
          result = {
            questions: flattenedQs,
            requestedCount: config.questionCount,
            acceptedCount: flattenedQs.length,
            rejectedCount: 0,
            rejections: [],
            facts: [],
            demo: false,
          };
        } catch (geminiErr: any) {
          console.warn(
            `[workers] Gemini Reviewer generation failed (${geminiErr?.message || "Quota Exceeded"}). Falling back to Nemotron Reasoning...`
          );
          result = await generateReviewer({
            verifiedItems: includedItems,
            config,
            subject: ep.examPrep.subject,
            gradeLevel: ep.examPrep.gradeLevel,
            previousQuestions,
          });
        }
      } else {
        result = await generateReviewer({
          verifiedItems: includedItems,
          config,
          subject: ep.examPrep.subject,
          gradeLevel: ep.examPrep.gradeLevel,
          previousQuestions,
        });
      }
    }

    await q.addQuestions(exam.id, result.questions);
    await q.updateExam(exam.id, {
      status: "completed",
      stats: {
        requested: result.requestedCount,
        accepted: result.acceptedCount,
        rejected: result.rejectedCount,
        rejections: result.rejections,
        facts: result.facts,
        demo: result.demo,
      },
      completedAt: new Date(),
    });
    await q.updateExamPrep(examPrepId, {
      status: result.questions.length > 0 ? "completed" : "failed",
    });
    await q.updateJob(job.id, { status: "completed", completedAt: new Date() });

    return {
      examId: exam.id,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      demo: result.demo,
    };
  } catch (err) {
    await q.updateExam(exam.id, {
      status: "failed",
      failureReason: errMsg(err),
      completedAt: new Date(),
    });
    await q.updateExamPrep(examPrepId, { status: "failed" });
    await q.updateJob(job.id, {
      status: "failed",
      error: errMsg(err),
      completedAt: new Date(),
    });
    throw err;
  }
}

/**
 * Generate source-reproduced exam from verified exercises.
 * Deterministic pipeline: READ verified_exercises -> reconstruct -> validate -> persist.
 * Zero LLM question generation or AI solving calls.
 */
async function generateSourceReproducedExam(
  examPrepId: string,
  snapshotId: string,
  config: ReviewerConfig
): Promise<{
  questions: any[];
  requestedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejections: any[];
  facts: any[];
  demo: boolean;
}> {
  const { reconstructFromVerifiedSnapshot } = await import(
    "./reconstruction/source-reproduced-generator"
  );

  // Step 1: Reconstruct exercises directly from immutable verified_exercises (READ-ONLY)
  const reconResult = await reconstructFromVerifiedSnapshot(snapshotId);
  const verifiedRows = await q.getVerifiedExercisesForSnapshot(snapshotId);

  // Step 2: Fail closed if validation failed
  if (!reconResult.validation.valid) {
    throw new Error(
      "Source-reproduced reconstruction validation failed: " +
        reconResult.validation.errors.map((e) => e.message).join("; ")
    );
  }

  // Step 3: Map reconstructed items to question records for DB persistence
  const questions: any[] = [];
  for (const item of reconResult.questionnaireItems) {
    const verifiedEx = verifiedRows.find((v) => v.itemNumber === item.itemNumber);
    const answerItem = reconResult.answerKeyItems.find((a) => a.itemNumber === item.itemNumber);
    const answerValue = answerItem?.answer?.trim() || "N/A";

    questions.push({
      type: item.exerciseType,
      question: item.questionnaireText,
      answer: answerValue || "N/A",
      choices: item.choices ?? null,
      sourceFactId: verifiedEx ? verifiedEx.id : `verified_exercise_${item.itemNumber}`,
      sourceExerciseItemId: verifiedEx ? verifiedEx.id : `verified_exercise_${item.itemNumber}`,
      sourcePage: item.pageLabel ?? null,
      difficulty: "normal",
      validation: { valid: true, rules: "source_reproduced_1:1" },
    });
  }

  return {
    questions,
    requestedCount: questions.length,
    acceptedCount: questions.length,
    rejectedCount: 0,
    rejections: [],
    facts: [],
    demo: false,
  };
}

export { isDemoMode };
