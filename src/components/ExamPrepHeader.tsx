import Link from "next/link";
import styles from "./ExamPrepHeader.module.css";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  processing: "Reading pages",
  verification: "Needs review",
  ready: "Ready to generate",
  generating: "Generating",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_VARIANT: Record<string, string> = {
  draft: "neutral",
  processing: "info",
  verification: "warning",
  ready: "success",
  generating: "info",
  completed: "success",
  failed: "error",
};

export function ExamPrepHeader({
  id,
  subject,
  studentName,
  status,
}: {
  id: string;
  subject: string;
  studentName: string | null;
  status: string;
}) {
  const steps = [
    { label: "Capture", href: `/exam-prep/${id}/pages` },
    { label: "Verify", href: `/exam-prep/${id}/verify` },
    { label: "Configure", href: `/exam-prep/${id}/configure` },
    { label: "Generate", href: `/exam-prep/${id}/generate` },
  ];

  const currentIndex =
    status === "completed" || status === "generating"
      ? 4
      : status === "ready"
        ? 3
        : status === "verification"
          ? 1
          : 0;

  return (
    <div className={styles.header}>
      <div className="row-wrap" style={{ gap: 12 }}>
        <div>
          <Link href="/dashboard" className="text-mono-sm" style={{ textDecoration: "none" }}>
            ← Dashboard
          </Link>
          <h1 className={styles.title}>{subject}</h1>
          <div className="text-mono-sm">
            {studentName ?? "—"} · Exam prep
          </div>
        </div>
        <span className={`status-chip ${STATUS_VARIANT[status] ?? "neutral"}`}>
          <span className="dot" />
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>

      <ol className={styles.stepper} aria-label="Workflow steps">
        {steps.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={step.href} className={styles.stepWrap}>
              <Link
                href={step.href}
                className={`${styles.step} ${done ? styles.done : ""} ${active ? styles.activeStep : ""}`}
              >
                <span className={styles.stepDot}>{done ? "✓" : i + 1}</span>
                <span className={styles.stepLabel}>{step.label}</span>
              </Link>
              {i < steps.length - 1 && <span className={styles.stepLine} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
