import { NextResponse, type NextRequest } from "next/server";
import {
  getExamPrep,
  getExamWithQuestions,
  listAssetsForExam,
} from "@/lib/server/db/queries";
import { reviewerTitle } from "@/lib/server/pdf/generate-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  const { examId } = await params;
  const data = await getExamWithQuestions(examId);
  if (!data) {
    return NextResponse.json({ error: "Reviewer not found." }, { status: 404 });
  }
  const { exam, questions } = data;
  const ep = await getExamPrep(exam.examPrepId);
  const assets = await listAssetsForExam(examId);

  return NextResponse.json({
    exam: {
      id: exam.id,
      version: exam.version,
      status: exam.status,
      config: exam.config,
      stats: exam.stats,
      promptVersion: exam.promptVersion,
      createdAt: exam.createdAt,
      failureReason: exam.failureReason,
    },
    subject: ep?.examPrep.subject ?? "Reviewer",
    title: reviewerTitle(ep?.examPrep.subject ?? "Reviewer"),
    studentName: ep?.studentName ?? null,
    gradeLevel: ep?.examPrep.gradeLevel ?? 1,
    questions: questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      type: q.type,
      question: q.question,
      answer: q.answer,
      choices: q.choices,
      difficulty: q.difficulty,
    })),
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      pageFormat: a.pageFormat,
    })),
  });
}
