import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getExamPrep,
  getOcrResultsForExamPrep,
  getSourceReproducedOcrResultsForExamPrep,
} from "@/lib/server/db/queries";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import { OcrVerification } from "@/components/OcrVerification";
import { ExerciseVerification } from "@/components/ExerciseVerification";
import type { SourceReproducedOcr } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) notFound();

  const isSourceReproduced = detail.examPrep.generationMode === "source_reproduced";

  if (isSourceReproduced) {
    const ocrRows = await getSourceReproducedOcrResultsForExamPrep(id);
    const initialOcrResults = ocrRows
      .filter((r) => r.ocr && r.page.status !== "failed")
      .map((r) => ({
        pageId: r.page.id,
        orderIndex: r.page.orderIndex,
        pageLabel: r.page.pageLabel,
        storageKey: r.page.storageKey,
        normalized: (r.ocr?.normalized as SourceReproducedOcr) ?? {
          text: "",
          pageInstructions: [],
          availableBank: [],
          exerciseItems: [],
          warningFlags: [],
        },
        warningFlags: (r.ocr?.warningFlags as string[]) ?? [],
      }));



    return (
      <main className="page-container wide">
        <ExamPrepHeader
          id={id}
          subject={detail.examPrep.subject}
          studentName={detail.studentName}
          status={detail.examPrep.status}
        />

        <div className="alert info" style={{ marginBottom: 16 }}>
          Review and verify each source textbook exercise item below. Confirmed items form the immutable parent-verified source.
        </div>

        {initialOcrResults.length === 0 ? (
          <div className="empty-state">
            <h3>No exercises to verify yet</h3>
            <p className="text-secondary" style={{ marginBottom: 16 }}>
              Capture and read the textbook exercise pages first.
            </p>
            <Link href={`/exam-prep/${id}/pages`} className="btn btn-primary">
              Go to capture
            </Link>
          </div>
        ) : (
          <ExerciseVerification examPrepId={id} initialOcrResults={initialOcrResults} />
        )}
      </main>
    );
  }

  // Generated Mode (UNCHANGED)
  const rows = await getOcrResultsForExamPrep(id);
  const pages = rows
    .filter((r) => r.ocr && r.page.status !== "failed")
    .map((r) => ({
      pageId: r.page.id,
      orderIndex: r.page.orderIndex,
      pageLabel: r.page.pageLabel,
      storageKey: r.page.storageKey,
      text: r.ocr?.text ?? "",
      confidence: r.ocr?.confidence ?? null,
      warningFlags: (r.ocr?.warningFlags as string[]) ?? [],
      model: r.ocr?.model ?? null,
    }));

  return (
    <main className="page-container wide">
      <ExamPrepHeader
        id={id}
        subject={detail.examPrep.subject}
        studentName={detail.studentName}
        status={detail.examPrep.status}
      />

      <div className="alert info" style={{ marginBottom: 16 }}>
        Never trust OCR blindly. Review the extracted text and fix anything the app
        misread. Only verified, included content will be used to generate the reviewer.
      </div>

      {pages.length === 0 ? (
        <div className="empty-state">
          <h3>No text to verify yet</h3>
          <p className="text-secondary" style={{ marginBottom: 16 }}>
            Capture and read the textbook pages first.
          </p>
          <Link href={`/exam-prep/${id}/pages`} className="btn btn-primary">
            Go to capture
          </Link>
        </div>
      ) : (
        <OcrVerification examPrepId={id} initialPages={pages} />
      )}
    </main>
  );
}
