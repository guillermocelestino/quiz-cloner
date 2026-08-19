/**
 * Build (and cache) a PDF for an exam, returning raw bytes.
 * Shared by the reviewer and answer-key route handlers.
 */
import {
  createExamAsset,
  getExamPrep,
  getExamWithQuestions,
  getSnapshotContents,
  listAssetsForExam,
  getVerifiedExercisesForSnapshot,
  getVerifiedExerciseAnswersForSnapshot,
} from "@/lib/server/db/queries";
import {
  generateAnswerKeyPdf,
  generateReviewerPdf,
  reviewerTitle,
} from "@/lib/server/pdf/generate-pdf";
import {
  generateSourceReproducedStudentPdf,
  generateSourceReproducedAnswerKeyPdf,
  type SourceReproducedPdfItem,
} from "@/lib/server/pdf/source-reproduced-pdf";
import { generatePartAContent } from "@/lib/server/pdf/part-a";
import { readBytes, savePdf } from "@/lib/server/storage";
import type { PageFormat } from "@/lib/types";

export type PdfMode = "reviewer" | "answer";

export async function buildExamPdf(
  examId: string,
  mode: PdfMode
): Promise<{ buffer: Buffer; pageFormat: PageFormat }> {
  const data = await getExamWithQuestions(examId);
  if (!data) throw new Error("Reviewer not found.");
  const { exam, questions } = data;
  const ep = await getExamPrep(exam.examPrepId);

  const cfg = (exam.config as { pageFormat?: PageFormat } | null) ?? null;
  const pageFormat: PageFormat = cfg?.pageFormat ?? "A4";
  const subject = ep?.examPrep.subject ?? "Reviewer";

  const kind = mode === "answer" ? "answer_key_pdf" : "reviewer_pdf";

  // Dedup asset: reuse a previously rendered PDF for the same kind+format.
  const assets = await listAssetsForExam(examId);
  const existing = assets.find((a) => a.kind === kind && a.pageFormat === pageFormat);
  if (existing) {
    try {
      const buffer = await readBytes(existing.storageKey);
      return { buffer, pageFormat };
    } catch {
      /* fall through and regenerate */
    }
  }

  // Branch on generation mode
  if (ep?.examPrep.generationMode === "source_reproduced") {
    const verifiedRows = exam.snapshotId ? await getVerifiedExercisesForSnapshot(exam.snapshotId) : [];
    const answerRows = exam.snapshotId ? await getVerifiedExerciseAnswersForSnapshot(exam.snapshotId) : [];

    const pdfItems: SourceReproducedPdfItem[] = questions.map((q, idx) => {
      const verifiedEx = verifiedRows.find(
        (v) =>
          v.id === q.sourceExerciseItemId ||
          `verified_exercise_${v.itemNumber}` === q.sourceExerciseItemId ||
          v.itemNumber === idx + 1
      );
      const verifiedAns = answerRows.find(
        (a) =>
          a.answer.verifiedExerciseId === verifiedEx?.id ||
          a.answer.itemNumber === (verifiedEx?.itemNumber ?? idx + 1)
      );

      return {
        itemNumber: verifiedEx?.itemNumber ?? idx + 1,
        exerciseType: q.type,
        instructions: verifiedEx?.instructions ?? null,
        questionText: q.question,
        blankLocations: (verifiedEx?.blankLocations as number[]) ?? null,
        choices: (q.choices as string[] | null) ?? (verifiedEx?.choices as string[]) ?? null,
        wordBank: (verifiedEx?.wordBank as string[]) ?? null,
        matchingPairs: (verifiedEx?.matchingPairs as { left: string; right: string }[]) ?? null,
        answer: (verifiedAns?.answer.answer && verifiedAns.answer.answer !== "N/A") ? verifiedAns.answer.answer : (q.answer || "N/A"),
        sourcePage: q.sourcePage ?? verifiedEx?.pageLabel ?? null,
        sourceOrder: verifiedEx?.sourceOrder ?? idx + 1,
      };
    });

    const buffer =
      mode === "answer"
        ? await generateSourceReproducedAnswerKeyPdf({
            title: reviewerTitle(subject),
            subject,
            studentName: ep?.studentName ?? null,
            items: pdfItems,
            pageFormat,
          })
        : await generateSourceReproducedStudentPdf({
            title: reviewerTitle(subject),
            subject,
            studentName: ep?.studentName ?? null,
            items: pdfItems,
            pageFormat,
          });

    const { key } = await savePdf(buffer, mode);
    await createExamAsset({ examId, kind, pageFormat, storageKey: key });

    return { buffer, pageFormat };
  }

  // Fetch snapshot verified contents to build deterministic Part A
  let partA = undefined;
  if (exam.snapshotId) {
    const rawSnapshot = await getSnapshotContents(exam.snapshotId);
    const snapshotItems = rawSnapshot.map((s) => ({
      content: s.content.content,
      pageLabel: s.pageLabel,
      factKind: s.content.factKind ?? undefined,
      itemNumber: s.content.itemNumber,
      sentence: s.content.sentence,
      blankToken: s.content.blankToken,
      wordBank: s.content.wordBank,
      pictureCue: s.content.pictureCue,
      proposedAnswer: s.content.proposedAnswer,
      included: s.content.included,
    }));
    partA = generatePartAContent(snapshotItems);
  }

  const questionsForPdf = questions.map((q) => ({
    type: q.type as never,
    question: q.question,
    answer: q.answer,
    choices: (q.choices as string[] | null) ?? undefined,
    sourcePage: q.sourcePage ?? null,
  }));

  const buffer =
    mode === "answer"
      ? await generateAnswerKeyPdf({
          title: reviewerTitle(subject),
          subject,
          studentName: ep?.studentName ?? null,
          questions: questionsForPdf,
          pageFormat,
        })
      : await generateReviewerPdf({
          title: reviewerTitle(subject),
          subject,
          studentName: ep?.studentName ?? null,
          questions: questionsForPdf,
          pageFormat,
          partA,
        });

  const { key } = await savePdf(buffer, mode);
  await createExamAsset({ examId, kind, pageFormat, storageKey: key });

  return { buffer, pageFormat };
}
