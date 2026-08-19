import { notFound } from "next/navigation";
import { getExamPrep } from "@/lib/server/db/queries";
import { isDemoMode } from "@/lib/server/workers";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import { GenerationProgress } from "@/components/GenerationProgress";

export const dynamic = "force-dynamic";

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) notFound();

  return (
    <main className="page-container narrow">
      <ExamPrepHeader
        id={id}
        subject={detail.examPrep.subject}
        studentName={detail.studentName}
        status={detail.examPrep.status}
      />
      <GenerationProgress examPrepId={id} demo={isDemoMode()} />
    </main>
  );
}
