import { notFound } from "next/navigation";
import { getExamPrep, listPages } from "@/lib/server/db/queries";
import { isDemoMode } from "@/lib/server/workers";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import { PageCapture } from "@/components/PageCapture";

export const dynamic = "force-dynamic";

export default async function PagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) notFound();

  const pages = await listPages(id);

  return (
    <main className="page-container">
      <ExamPrepHeader
        id={id}
        subject={detail.examPrep.subject}
        studentName={detail.studentName}
        status={detail.examPrep.status}
      />
      <PageCapture
        examPrepId={id}
        initialPages={pages.map((p) => ({
          id: p.id,
          orderIndex: p.orderIndex,
          storageKey: p.storageKey,
          pageLabel: p.pageLabel,
          status: p.status,
          qualityFlags: (p.qualityFlags as string[]) ?? [],
        }))}
        demo={isDemoMode()}
      />
    </main>
  );
}
