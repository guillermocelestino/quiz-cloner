import Link from "next/link";
import { listStudents } from "@/lib/server/db/queries";
import { DataManagement } from "@/components/DataManagement";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const students = await listStudents();
  return (
    <main className="page-container narrow">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Settings</div>
          <h1 className="page-title">Data &amp; privacy</h1>
        </div>
        <Link href="/dashboard" className="btn btn-outline btn-small">
          Back
        </Link>
      </div>

      <div className="alert info" style={{ marginBottom: 16 }}>
        This is a single-user workspace with no accounts. You can remove individual
        students (and all their exam preps, pages and reviewers) or clear everything.
        Stored textbook photos are deleted alongside their data.
      </div>

      <DataManagement
        students={students.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          gradeLevel: s.gradeLevel,
        }))}
      />
    </main>
  );
}
