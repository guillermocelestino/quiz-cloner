import { redirect } from "next/navigation";
import { getExamPrep, getExamWithQuestions } from "@/lib/server/db/queries";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import { ReviewerPreview } from "@/components/ReviewerPreview";
import { reviewerTitle } from "@/lib/server/pdf/generate-pdf";

export const dynamic = "force-dynamic";

export default async function ReviewerPage({
  params,
}: {
  params: Promise<{ id: string; examId: string }>;
}) {
  const { id, examId } = await params;
  const data = await getExamWithQuestions(examId);
  if (!data) redirect(`/exam-prep/${id}`);
  const { exam, questions } = data;

  const ep = await getExamPrep(exam.examPrepId);
  if (!ep) redirect(`/exam-prep/${id}`);

  const stats = (exam.stats as { accepted?: number; requested?: number; rejected?: number } | null) ?? {};

  return (
    <main className="page-container wide">
      <ExamPrepHeader
        id={id}
        subject={ep.examPrep.subject}
        studentName={ep.studentName}
        status={ep.examPrep.status}
      />
      <ReviewerPreview
        examPrepId={id}
        examId={examId}
        subject={ep.examPrep.subject}
        title={reviewerTitle(ep.examPrep.subject)}
        studentName={ep.studentName}
        version={exam.version}
        acceptedCount={stats.accepted ?? questions.length}
        requestedCount={stats.requested ?? questions.length}
        config={exam.config as never}
        questions={questions.map((q) => ({
          id: q.id,
          type: q.type as never,
          question: q.question,
          answer: q.answer,
          choices: (q.choices as string[] | null) ?? undefined,
          difficulty: q.difficulty ?? undefined,
        }))}
      />
    </main>
  );
}
