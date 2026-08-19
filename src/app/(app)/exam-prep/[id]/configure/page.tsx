import { redirect } from "next/navigation";
import { getExamPrep, getLatestSnapshot } from "@/lib/server/db/queries";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import { ReviewerConfigurator } from "@/components/ReviewerConfigurator";

export const dynamic = "force-dynamic";

export default async function ConfigurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) redirect("/dashboard");
  const snapshot = await getLatestSnapshot(id);
  if (!snapshot) redirect(`/exam-prep/${id}/verify`);

  return (
    <main className="page-container narrow">
      <ExamPrepHeader
        id={id}
        subject={detail.examPrep.subject}
        studentName={detail.studentName}
        status={detail.examPrep.status}
      />
      <ReviewerConfigurator
        examPrepId={id}
        defaultInstructions={detail.examPrep.teacherInstructions ?? ""}
      />
    </main>
  );
}
