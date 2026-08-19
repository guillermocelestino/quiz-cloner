"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./DataManagement.module.css";

type Student = { id: string; displayName: string; gradeLevel: number };

export function DataManagement({ students }: { students: Student[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteStudent(id: string) {
    if (!confirm("Delete this student and all their reviewers? This cannot be undone.")) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/students/${id}`, { method: "DELETE" });
      if (!res.ok) setError("Could not delete student.");
      router.refresh();
    } catch {
      setError("Could not delete student.");
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!confirm("Delete ALL students, exam preps, pages and reviewers? This cannot be undone.")) {
      return;
    }
    setBusy("all");
    setError(null);
    try {
      const res = await fetch("/api/data", { method: "DELETE" });
      if (!res.ok) {
        setError("Could not clear data.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Could not clear data.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className={`card ${styles.section}`}>
        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Students
        </h2>
        {students.length === 0 ? (
          <p className="text-secondary">No students yet.</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {students.map((s) => (
              <div key={s.id} className="list-row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{s.displayName}</div>
                  <div className="text-mono-sm">Grade {s.gradeLevel}</div>
                </div>
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => deleteStudent(s.id)}
                  disabled={busy === s.id}
                >
                  {busy === s.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`card ${styles.dangerZone}`}>
        <h2 className="section-title" style={{ color: "var(--color-error)", marginBottom: 8 }}>
          Danger zone
        </h2>
        <p className="text-secondary" style={{ marginBottom: 12 }}>
          Permanently delete every student, exam prep, page image and reviewer from this workspace.
        </p>
        <button className="btn btn-danger" onClick={clearAll} disabled={busy === "all"}>
          {busy === "all" ? "Clearing…" : "Delete all data"}
        </button>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
