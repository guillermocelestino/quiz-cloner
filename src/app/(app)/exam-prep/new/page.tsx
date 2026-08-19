import Link from "next/link";
import { listStudents } from "@/lib/server/db/queries";
import { NewExamPrepForm } from "@/components/NewExamPrepForm";

export const dynamic = "force-dynamic";

export default async function NewExamPrepPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const { student } = await searchParams;
  const students = await listStudents();

  return (
    <main className="page-container narrow">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Step 2 · Exam Prep</div>
          <h1 className="page-title">Create an exam prep</h1>
        </div>
        <Link href="/dashboard" className="btn btn-outline btn-small">
          Back
        </Link>
      </div>

      <NewExamPrepForm students={students} initialStudentId={student} />
    </main>
  );
}
