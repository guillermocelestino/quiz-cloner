"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DIFFICULTIES,
  OUTPUT_FORMATS,
  PAGE_FORMATS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type Difficulty,
  type OutputFormat,
  type PageFormat,
  type QuestionType,
} from "@/lib/types";
import styles from "./ReviewerConfigurator.module.css";

export function ReviewerConfigurator({
  examPrepId,
  defaultInstructions,
}: {
  examPrepId: string;
  defaultInstructions: string;
}) {
  const router = useRouter();
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("reviewer");
  const [types, setTypes] = useState<Set<QuestionType>>(
    new Set<QuestionType>(["fill_blank", "true_false"])
  );
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [count, setCount] = useState(10);
  const [pageFormat, setPageFormat] = useState<PageFormat>("A4");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(t: QuestionType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  async function generate() {
    setError(null);
    if (types.size === 0) {
      setError("Choose at least one question type.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/exam-prep/${examPrepId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionTypes: Array.from(types),
          difficulty,
          questionCount: count,
          outputFormat,
          pageFormat,
          teacherInstructions: instructions || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start generation.");
        return;
      }
      router.push(`/exam-prep/${examPrepId}/generate`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <div className="alert info">
        The reviewer will be generated only from your verified pages. We&apos;d rather
        give you a few correct questions than many wrong ones.
      </div>

      <div className={`card card-padded-lg ${styles.form}`}>
        <section className="form-field">
          <span className="label">Output</span>
          <div className={styles.optionRow}>
            {OUTPUT_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.option} ${outputFormat === f ? styles.optionActive : ""}`}
                onClick={() => setOutputFormat(f)}
              >
                {f === "reviewer" ? "Reviewer" : "Practice Exam"}
              </button>
            ))}
          </div>
        </section>

        <section className="form-field">
          <span className="label">Question types</span>
          <div className={styles.checkGrid}>
            {QUESTION_TYPES.map((t) => (
              <label key={t} className={styles.checkItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={types.has(t)}
                  onChange={() => toggleType(t)}
                />
                {QUESTION_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </section>

        <section className="form-field">
          <span className="label">Difficulty</span>
          <div className={styles.optionRow}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.option} ${difficulty === d ? styles.optionActive : ""}`}
                onClick={() => setDifficulty(d)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.twoCol}>
          <div className="form-field">
            <label className="label" htmlFor="count">
              Questions
            </label>
            <input
              id="count"
              type="number"
              min={1}
              max={30}
              className="input"
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
              }
            />
            <span className="hint">We may create fewer if the source can&apos;t support them all.</span>
          </div>
          <div className="form-field">
            <span className="label">Page format</span>
            <div className={styles.optionRow}>
              {PAGE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.option} ${pageFormat === f ? styles.optionActive : ""}`}
                  onClick={() => setPageFormat(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="form-field">
          <label className="label" htmlFor="instructions">
            Teacher instructions <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id="instructions"
            className="textarea"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
            placeholder="e.g. Focus on pages 42–47. Focus on vocabulary."
          />
        </section>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <Link href={`/exam-prep/${examPrepId}/verify`} className="btn btn-outline">
          Back
        </Link>
        <button className="btn btn-primary" onClick={generate} disabled={loading}>
          {loading ? "Starting…" : "Generate Reviewer"}
        </button>
      </div>
    </div>
  );
}
