import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getExamPrep,
  getLatestSnapshot,
  listExamsForExamPrep,
  listPages,
} from "@/lib/server/db/queries";
import { ExamPrepHeader } from "@/components/ExamPrepHeader";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function ExamPrepHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) notFound();

  const [pages, snapshot, exams] = await Promise.all([
    listPages(id),
    getLatestSnapshot(id),
    listExamsForExamPrep(id),
  ]);
  const ep = detail.examPrep;
  const status = ep.status;
  const completedExams = exams.filter((e) => e.status === "completed");

  let nextHref = `/exam-prep/${id}/pages`;
  let nextLabel = "Capture textbook pages";
  if (pages.length === 0 || status === "draft" || status === "processing") {
    nextHref = `/exam-prep/${id}/pages`;
    nextLabel = status === "processing" ? "View reading progress" : "Capture textbook pages";
  } else if (status === "verification") {
    nextHref = `/exam-prep/${id}/verify`;
    nextLabel = "Verify extracted content";
  } else if (status === "ready") {
    nextHref = `/exam-prep/${id}/configure`;
    nextLabel = "Configure & generate";
  } else if (status === "generating") {
    nextHref = `/exam-prep/${id}/generate`;
    nextLabel = "View generation";
  } else if (completedExams.length > 0) {
    nextHref = `/exam-prep/${id}/reviewer/${completedExams[0].id}`;
    nextLabel = "Open reviewer";
  }

  return (
    <main className="page-container">
      <ExamPrepHeader
        id={id}
        subject={ep.subject}
        studentName={detail.studentName}
        status={status}
      />

      <div className={styles.grid}>
        <Link href={nextHref} className={`card hoverable ${styles.cta}`}>
          <div>
            <div className="page-eyebrow">Continue</div>
            <div className={styles.ctaTitle}>{nextLabel}</div>
          </div>
          <span className={styles.ctaArrow}>→</span>
        </Link>

        <div className={`card ${styles.stat}`}>
          <div className={styles.statLabel}>Pages</div>
          <div className={styles.statValue}>{pages.length}</div>
          <div className="text-mono-sm">
            {pages.filter((p) => p.status === "ready").length} read successfully
          </div>
        </div>

        <div className={`card ${styles.stat}`}>
          <div className={styles.statLabel}>Verified snapshot</div>
          <div className={styles.statValue}>
            {snapshot ? `v${snapshot.version}` : "—"}
          </div>
          <div className="text-mono-sm">
            {snapshot ? "Content verified" : "Not verified yet"}
          </div>
        </div>

        <div className={`card ${styles.stat}`}>
          <div className={styles.statLabel}>Reviewers</div>
          <div className={styles.statValue}>{completedExams.length}</div>
          <div className="text-mono-sm">generated versions</div>
        </div>
      </div>

      {completedExams.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            Reviewer history
          </h2>
          <div className="card" style={{ padding: 0 }}>
            {completedExams.map((e, i) => (
              <Link
                key={e.id}
                href={`/exam-prep/${id}/reviewer/${e.id}`}
                className="list-row"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{ep.subject} Reviewer</div>
                  <div className="text-mono-sm">
                    Version {e.version} · {new Date(e.createdAt).toLocaleString()}
                  </div>
                </div>
                <span className="status-chip success">
                  <span className="dot" />
                  Completed
                </span>
              </Link>
            ))}
            {completedExams.length === 0 && (
              <div className="text-secondary" style={{ padding: 16 }}>
                No reviewers yet.
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
