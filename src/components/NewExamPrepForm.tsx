"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./NewExamPrepForm.module.css";

type Student = { id: string; displayName: string; gradeLevel: number };

export function NewExamPrepForm({
  students,
  initialStudentId,
}: {
  students: Student[];
  initialStudentId?: string;
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(initialStudentId ?? students[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState(1);
  const [examDate, setExamDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generationMode, setGenerationMode] = useState<"generated" | "source_reproduced">("generated");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!studentId) {
      setError("Please choose a student.");
      return;
    }
    if (!subject.trim()) {
      setError("Please enter a subject.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/exam-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          subject,
          gradeLevel: grade,
          examDate: examDate || null,
          teacherInstructions: instructions || null,
          generationMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the exam prep.");
        return;
      }
      router.push(`/exam-prep/${data.examPrep.id}/pages`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (students.length === 0) {
    return (
      <div className="empty-state">
        <h3>Add a student first</h3>
        <p className="text-secondary" style={{ marginBottom: 16 }}>
          You need a student profile before creating an exam prep.
        </p>
        <Link href="/students/new" className="btn btn-primary">
          Add a student
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`card card-padded-lg ${styles.form}`}>
      <div className={styles.modeSection}>
        <div className={styles.modeHeader}>
          <h2 className={styles.modeTitle}>How should we create the reviewer?</h2>
          <p className={styles.modeSubtitle}>
            Choose whether you want new practice questions or the actual textbook exercises reproduced for your child.
          </p>
        </div>

        <div className={styles.modeGrid} role="radiogroup" aria-label="How should we create the reviewer?">
          <label
            htmlFor="mode-generated"
            className={`${styles.modeCard} ${
              generationMode === "generated" ? styles.modeCardSelected : ""
            }`}
          >
            <input
              type="radio"
              id="mode-generated"
              name="generationMode"
              value="generated"
              checked={generationMode === "generated"}
              onChange={() => setGenerationMode("generated")}
              className={styles.radioInput}
            />
            <div className={styles.cardHeader}>
              <div className={styles.cardTitleRow}>
                <span
                  className={`${styles.radioCircle} ${
                    generationMode === "generated" ? styles.radioCircleSelected : ""
                  }`}
                  aria-hidden="true"
                >
                  {generationMode === "generated" && <span className={styles.radioDot} />}
                </span>
                <span className={styles.cardTitle}>Generated Reviewer</span>
              </div>
              <span className={`${styles.badge} ${styles.badgeGenerated}`}>NEW PRACTICE</span>
            </div>
            <p className={styles.cardDescription}>
              Creates new practice questions based on your verified textbook content.
            </p>
          </label>

          <label
            htmlFor="mode-source_reproduced"
            className={`${styles.modeCard} ${
              generationMode === "source_reproduced" ? styles.modeCardSelected : ""
            }`}
          >
            <input
              type="radio"
              id="mode-source_reproduced"
              name="generationMode"
              value="source_reproduced"
              checked={generationMode === "source_reproduced"}
              onChange={() => setGenerationMode("source_reproduced")}
              className={styles.radioInput}
            />
            <div className={styles.cardHeader}>
              <div className={styles.cardTitleRow}>
                <span
                  className={`${styles.radioCircle} ${
                    generationMode === "source_reproduced" ? styles.radioCircleSelected : ""
                  }`}
                  aria-hidden="true"
                >
                  {generationMode === "source_reproduced" && <span className={styles.radioDot} />}
                </span>
                <span className={styles.cardTitle}>Source-Reproduced Exercise</span>
              </div>
              <span className={`${styles.badge} ${styles.badgeSource}`}>TEXTBOOK PRACTICE</span>
            </div>
            <p className={styles.cardDescription}>
              Reproduces the actual textbook exercises with the answers removed so your child can complete them.
            </p>
          </label>
        </div>
      </div>

      <div className={styles.grid}>
        <div className="form-field">
          <label className="label" htmlFor="student">
            Student
          </label>
          <select
            id="student"
            className="select"
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              const s = students.find((x) => x.id === e.target.value);
              if (s) setGrade(s.gradeLevel);
            }}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} · Grade {s.gradeLevel}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="label" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            className="input"
            placeholder="e.g. Science"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoFocus
            maxLength={80}
          />
        </div>

        <div className="form-field">
          <label className="label" htmlFor="grade">
            Grade level
          </label>
          <select
            id="grade"
            className="select"
            value={grade}
            onChange={(e) => setGrade(Number(e.target.value))}
          >
            <option value={1}>Grade 1</option>
            <option value={2}>Grade 2</option>
            <option value={3}>Grade 3</option>
          </select>
        </div>

        <div className="form-field">
          <label className="label" htmlFor="examDate">
            Exam date <span className="text-muted">(optional)</span>
          </label>
          <input
            id="examDate"
            type="date"
            className="input"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
          />
        </div>
      </div>

      <div className="form-field">
        <label className="label" htmlFor="instructions">
          Teacher instructions <span className="text-muted">(optional)</span>
        </label>
        <textarea
          id="instructions"
          className="textarea"
          placeholder={'e.g. Review pages 42–47. Focus on parts of plants.'}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={2000}
        />
        <span className="hint">
          Instructions only prioritize existing page content — they never add new facts.
        </span>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Creating…" : "Create exam prep"}
        </button>
      </div>
    </form>
  );
}
