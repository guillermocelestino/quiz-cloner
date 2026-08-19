"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { type QuestionType, type ReviewerConfig, sanitizeOption } from "@/lib/types";
import styles from "./ReviewerPreview.module.css";

type Question = {
  id?: string;
  type: QuestionType;
  question: string;
  answer: string;
  choices?: string[];
  difficulty?: string;
};

const SECTION_ORDER: QuestionType[] = [
  "fill_blank",
  "first_letter_fill",
  "true_false",
  "tf_exact",
  "tf_swap",
  "identification",
  "reverse_id",
  "multiple_choice",
  "blend_mc",
  "word_family_mc",
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const SECTION_TITLES: Record<QuestionType, string> = {
  blend_mc: "Multiple Choice (Blend)",
  fill_blank: "Fill in the Blank",
  tf_exact: "True or False",
  tf_swap: "True or False",
  reverse_id: "Identification",
  multiple_choice: "Multiple Choice",
  true_false: "True or False",
  identification: "Identification",
  word_family_mc: "Multiple Choice (Word Family)",
  first_letter_fill: "Fill in the Blank (First Letter)",
};

export function ReviewerPreview({
  examPrepId,
  examId,
  subject,
  title,
  studentName,
  version,
  acceptedCount,
  requestedCount,
  config,
  questions,
  warnings,
}: {
  examPrepId: string;
  examId: string;
  subject: string;
  title: string;
  studentName: string | null;
  version: number;
  acceptedCount: number;
  requestedCount: number;
  config: ReviewerConfig;
  questions: Question[];
  warnings?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [questionList, setQuestionList] = useState<Question[]>(questions);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  async function generateAnother() {
    setBusy(true);
    try {
      await fetch(`/api/exam-prep/${examPrepId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config ?? {}),
      });
      router.push(`/exam-prep/${examPrepId}/generate`);
    } catch {
      setBusy(false);
    }
  }

  async function handleDeleteQuestion(target: Question) {
    // 1. Optimistic removal from UI
    setQuestionList((prev) =>
      prev.filter((q) => (target.id ? q.id !== target.id : q.question !== target.question))
    );

    // 2. Show notification toast
    setToastMessage("Question removed. This feedback helps us improve.");

    // 3. Post to Feedback API
    try {
      await fetch(`/api/exam/${examId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: target.id ?? target.question,
          action: "delete",
          details: { questionText: target.question, type: target.type },
        }),
      });
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    }
  }

  const groups = SECTION_ORDER.map((type) => ({
    type,
    items: questionList.filter((q) => q.type === type),
  })).filter((g) => g.items.length > 0);

  let n = 0;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidePanel}>
        <div className={`card ${styles.actionsCard}`}>
          <div className="page-eyebrow">Version {version}</div>
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            {title}
          </h2>

          {warnings && warnings.length > 0 && (
            <div
              className="alert warning"
              style={{
                marginBottom: 12,
                backgroundColor: "#fffbe6",
                borderColor: "#ffe58f",
                color: "#873800",
                padding: "10px 14px",
                borderRadius: "6px",
                fontSize: "13px",
              }}
            >
              ⚠️ <strong>Notice:</strong> {warnings[0]}
            </div>
          )}

          <div className={styles.statsRow}>
            <div className={styles.statItem}>
              <div className={styles.statNum}>{questionList.length}</div>
              <div className={styles.statLbl}>questions</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statNum}>{requestedCount}</div>
              <div className={styles.statLbl}>requested</div>
            </div>
          </div>

          {acceptedCount < requestedCount && !warnings?.length && (
            <div className="alert success" style={{ marginTop: 12 }}>
              We could safely create {acceptedCount} question(s) from the verified pages.
            </div>
          )}

          <div className={styles.btnStack}>
            <a
              href={`/api/exam/${examId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-block"
            >
              ⬇ Download PDF
            </a>
            <a
              href={`/api/exam/${examId}/pdf/answer-key`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-block"
            >
              Answer Key
            </a>
            <a
              href={`/api/exam/${examId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-block"
            >
              🖨 Print
            </a>
            <button
              className="btn btn-blue btn-block"
              onClick={generateAnother}
              disabled={busy}
            >
              {busy ? "Starting…" : "↻ Generate Another Version"}
            </button>
          </div>
          <p className="text-mono-sm" style={{ marginTop: 12 }}>
            Reuses the same verified pages — no re-upload needed.
          </p>
          <Link href={`/exam-prep/${examPrepId}`} className="text-mono-sm">
            ← Back to exam prep
          </Link>
        </div>
      </aside>

      {/* The actual worksheet — light, child-friendly, print-ready look */}
      <section className={styles.worksheet} aria-label="Reviewer worksheet preview">
        <div className={styles.wsHeader}>
          <div className={styles.wsSubject}>{subject.toUpperCase()}</div>
          <h1 className={styles.wsTitle}>{title}</h1>
          <div className={styles.wsNameRow}>
            <span>
              Name: <span className={styles.wsLine} />
            </span>
            <span>
              Date: <span className={styles.wsLineShort} />
            </span>
          </div>
        </div>

        {groups.map((group, gi) => (
          <div key={group.type} className={styles.wsSection}>
            <h2 className={styles.wsSectionTitle}>
              {ROMAN[gi]}. {SECTION_TITLES[group.type]}
            </h2>
            {group.items.map((q) => {
              n += 1;
              return (
                <div key={q.id ?? n} className={styles.wsQuestion}>
                  <span className={styles.wsNumber}>{n}.</span>
                  <div className={styles.wsQBody}>
                    <div className={styles.wsQuestionHeader}>
                      <div className={styles.wsQText}>{q.question}</div>
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDeleteQuestion(q)}
                        title="Remove question"
                      >
                        🗑 Delete
                      </button>
                    </div>
                    {(q.type === "multiple_choice" || q.type === "blend_mc" || q.type === "word_family_mc" || (q.type as string) === "phonics_mc") && q.choices && (
                      <ul className={styles.wsChoices}>
                        {q.choices.map((c, i) => (
                          <li key={i}>
                            <span className={styles.wsChoiceLetter}>
                              {String.fromCharCode(65 + i)}.
                            </span>{" "}
                            {sanitizeOption(c)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.type === "identification" && <div className={styles.wsAnswerLine} />}
                    {q.type === "true_false" && (
                      <div className={styles.wsTf}>○ True &nbsp;&nbsp; ○ False</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {questionList.length === 0 && (
          <p style={{ color: "#666" }}>No questions remaining in reviewer.</p>
        )}
        <div className={styles.wsFooter}>Good luck, {studentName ?? "friend"}! 🌟</div>
      </section>

      {toastMessage && (
        <div className={styles.toastBanner} role="status">
          <span>{toastMessage}</span>
          <button
            className={styles.toastClose}
            onClick={() => setToastMessage(null)}
            aria-label="Close notification"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
