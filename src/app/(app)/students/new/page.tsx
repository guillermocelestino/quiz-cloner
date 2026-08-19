"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";

export default function NewStudentPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [grade, setGrade] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Please enter a display name.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, gradeLevel: grade }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the student.");
        return;
      }
      router.push(`/exam-prep/new?student=${data.student.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-container narrow">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Step 1 · Student</div>
          <h1 className="page-title">Add a student</h1>
        </div>
        <Link href="/dashboard" className="btn btn-outline btn-small">
          Back
        </Link>
      </div>

      <form onSubmit={onSubmit} className={`card card-padded-lg ${styles.form}`}>
        <div className="form-field">
          <label className="label" htmlFor="name">
            Child&apos;s name
          </label>
          <input
            id="name"
            className="input"
            placeholder="e.g. My Daughter"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={80}
          />
          <span className="hint">
            A simple nickname is fine. We collect minimal information.
          </span>
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
          <span className="hint">Reviewers are tuned for Grade 1 reading level.</span>
        </div>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Saving…" : "Save student"}
          </button>
        </div>
      </form>
    </main>
  );
}
