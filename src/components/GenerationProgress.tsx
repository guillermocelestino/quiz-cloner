"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./GenerationProgress.module.css";

type ExamSummary = { id: string; version: number; status: string; createdAt: string };

export function GenerationProgress({
  examPrepId,
  demo,
}: {
  examPrepId: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [latest, setLatest] = useState<ExamSummary | null>(null);
  const [phase, setPhase] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    phaseRef.current = setInterval(() => {
      setPhase((p) => (p < 2 ? p + 1 : p));
    }, 1400);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/exam-prep/${examPrepId}/status`);
        const data = await res.json();
        const exams: ExamSummary[] = data.exams ?? [];
        if (exams.length > 0) {
          const last = exams.reduce((a, b) =>
            new Date(b.createdAt) > new Date(a.createdAt) ? b : a
          );
          setLatest(last);
          if (last.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (phaseRef.current) clearInterval(phaseRef.current);
            router.push(`/exam-prep/${examPrepId}/reviewer/${last.id}`);
          }
        }
      } catch {
        /* keep polling */
      }
    }, 1500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (phaseRef.current) clearInterval(phaseRef.current);
    };
  }, [examPrepId, router]);

  const failed = latest?.status === "failed";

  const steps = [
    "Reading verified content",
    "Creating questions",
    "Checking questions against the source",
    "Preparing worksheet",
  ];

  return (
    <div className={styles.wrap}>
      {demo && (
        <div className="alert info">
          Demo mode is on — sample questions are generated instantly.
        </div>
      )}

      <div className={`card card-padded-lg ${styles.card}`}>
        {!failed ? (
          <>
            <div className={styles.spinnerRow}>
              <span className="spinner" />
              <h2 className="section-title">Creating your reviewer</h2>
            </div>
            <p className="text-secondary" style={{ marginBottom: 20 }}>
              Every question is checked to make sure it can be answered from your
              verified pages. This can take a little while.
            </p>
            <ul className={styles.steps}>
              {steps.map((s, i) => {
                const done = i < phase;
                const active = i === phase;
                return (
                  <li key={s} className={styles.step}>
                    <span className={`${styles.stepIcon} ${done ? styles.done : ""} ${active ? styles.active : ""}`}>
                      {done ? "✓" : active ? "●" : "○"}
                    </span>
                    <span className={done || active ? styles.stepOn : styles.stepOff}>{s}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            <h2 className="section-title" style={{ color: "var(--color-error)", marginBottom: 8 }}>
              Generation failed
            </h2>
            <p className="text-secondary" style={{ marginBottom: 16 }}>
              We couldn&apos;t safely create a reviewer from the verified pages. You can
              try again — we never invent questions.
            </p>
            <div className="row">
              <Link href={`/exam-prep/${examPrepId}/configure`} className="btn btn-primary">
                Try again
              </Link>
              <Link href={`/exam-prep/${examPrepId}/verify`} className="btn btn-outline">
                Review content
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
