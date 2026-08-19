import Link from "next/link";
import { listRecentExamPreps, listStudents } from "@/lib/server/db/queries";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; variant: string }> = {
  draft: { label: "Draft", variant: "neutral" },
  processing: { label: "Reading pages", variant: "info" },
  verification: { label: "Needs review", variant: "warning" },
  ready: { label: "Ready", variant: "success" },
  generating: { label: "Generating", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
};

function timeAgo(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default async function DashboardPage() {
  const [students, examPreps] = await Promise.all([
    listStudents(),
    listRecentExamPreps(8),
  ]);

  return (
    <main className="page-container wide">
      <div className={styles.hero}>
        <div>
          <div className="page-eyebrow">Workspace</div>
          <h1 className={styles.heroTitle}>CloneQuizzAndReview</h1>
          <p className="text-secondary">
            Photograph the exact textbook pages your child&apos;s teacher assigned,
            verify what the app read, and get a Grade-1 reviewer based only on those pages.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/exam-prep/new" className="btn btn-primary">
            + New Reviewer
          </Link>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="empty-state">
          <h3>Welcome — let&apos;s set up your first student</h3>
          <p className="text-secondary" style={{ marginBottom: 16 }}>
            Add a Grade-1 student profile, then create an exam prep to start
            generating reviewers.
          </p>
          <Link href="/students/new" className="btn btn-primary">
            Add a student
          </Link>
        </div>
      ) : (
        <section className="stack" style={{ gap: 32 }}>
          <div>
            <div className={styles.sectionHeader}>
              <h2 className="section-title">Students</h2>
              <Link href="/students/new" className="btn btn-outline btn-small">
                + Add student
              </Link>
            </div>
            <div className={styles.studentGrid}>
              {students.map((s) => (
                <Link
                  key={s.id}
                  href={`/exam-prep/new?student=${s.id}`}
                  className={`card hoverable ${styles.studentCard}`}
                >
                  <div className={styles.studentAvatar}>
                    {s.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className={styles.studentInfo}>
                    <div className={styles.studentName}>{s.displayName}</div>
                    <div className="text-mono-sm">Grade {s.gradeLevel}</div>
                  </div>
                  <span className="chip">+ New reviewer</span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionHeader}>
              <h2 className="section-title">Recent reviewers</h2>
            </div>
            {examPreps.length === 0 ? (
              <div className="card text-secondary">
                No exam preps yet. Create your first reviewer to get started.
              </div>
            ) : (
              <div className="card" style={{ padding: 0 }}>
                {examPreps.map((row, i) => {
                  const meta = STATUS_META[row.examPrep.status] ?? STATUS_META.draft;
                  return (
                    <Link
                      key={row.examPrep.id}
                      href={`/exam-prep/${row.examPrep.id}`}
                      className={`list-row ${styles.prepRow} ${i === examPreps.length - 1 ? "" : ""}`}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={styles.prepTitle}>
                          {row.examPrep.subject}
                        </div>
                        <div className="text-mono-sm">
                          {row.studentName ?? "—"} · updated {timeAgo(row.examPrep.updatedAt)}
                        </div>
                      </div>
                      <span className={`status-chip ${meta.variant}`}>
                        <span className="dot" />
                        {meta.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
