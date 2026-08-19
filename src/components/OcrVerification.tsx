"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./OcrVerification.module.css";

type PageData = {
  pageId: string;
  orderIndex: number;
  pageLabel: string | null;
  storageKey: string;
  text: string;
  confidence: number | null;
  warningFlags: string[];
  model: string | null;
};

const FLAG_LABELS: Record<string, { label: string; variant: string }> = {
  low_confidence: { label: "Low confidence", variant: "warning" },
  partial_text: { label: "Partial text", variant: "warning" },
  empty_ocr: { label: "No text found", variant: "error" },
  ocr_failed: { label: "OCR failed", variant: "error" },
  POSSIBLY_FILLED_FROM_HANDWRITING: {
    label: "⚠ May be filled in from handwriting — verify the blank",
    variant: "warning",
  },
};

export function OcrVerification({
  examPrepId,
  initialPages,
}: {
  examPrepId: string;
  initialPages: PageData[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, { content: string; included: boolean }>>(
    () =>
      Object.fromEntries(
        initialPages.map((p) => [
          p.pageId,
          { content: p.text, included: p.text.trim().length > 0 },
        ])
      )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setContent(id: string, content: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], content } }));
  }
  function toggle(id: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], included: !prev[id].included } }));
  }
  function convertWordToBlank(pageId: string, targetWord: string) {
    const current = edits[pageId]?.content ?? "";
    // Replace word with blank token _____
    const regex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const updated = current.replace(regex, "_____");
    setContent(pageId, updated);
  }

  async function save() {
    setError(null);
    const contents = initialPages.map((p) => ({
      pageId: p.pageId,
      content: edits[p.pageId]?.content ?? "",
      included: edits[p.pageId]?.included ?? false,
    }));
    const anyIncluded = contents.some((c) => c.included && c.content.trim());
    if (!anyIncluded) {
      setError("Include at least one page with content to continue.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/exam-prep/${examPrepId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save verification.");
        return;
      }
      router.push(`/exam-prep/${examPrepId}/configure`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const includedCount = Object.values(edits).filter(
    (e) => e.included && e.content.trim()
  ).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className="text-secondary">
          {includedCount} page(s) included for generation
        </div>
        <div className="row">
          <Link href={`/exam-prep/${examPrepId}/pages`} className="btn btn-outline btn-small">
            Back to pages
          </Link>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Mark verified & continue →"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className={styles.list}>
        {initialPages.map((p, i) => {
          const edit = edits[p.pageId];
          const contentText = edit?.content ?? "";
          const confidence =
            p.confidence != null ? Math.round(p.confidence * 100) : null;

          const hasBlankToken = /(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/.test(contentText);

          // Only collect words that ACTUALLY exist in contentText
          const wordsInText = contentText
            .split(/\s+/)
            .map((w) => w.replace(/[^\w]/g, ""))
            .filter((w) => {
              if (
                w.length <= 2 ||
                w === "_____" ||
                ["the", "and", "a", "an", "is", "of", "to", "in", "it", "on", "or", "for", "with", "this", "that"].includes(w.toLowerCase())
              ) {
                return false;
              }
              const regex = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
              return regex.test(contentText);
            });
          const uniqueWordsInText = Array.from(new Set(wordsInText));

          return (
            <div key={p.pageId} className={`card ${styles.pageBlock}`}>
              <div className={styles.pageHead}>
                <div className="row">
                  <span className="chip">Page {i + 1}</span>
                  {p.pageLabel && <span className="text-secondary">{p.pageLabel}</span>}
                </div>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {p.warningFlags.map((f) => {
                    const meta = FLAG_LABELS[f] ?? { label: f, variant: "neutral" };
                    return (
                      <span key={f} className={`status-chip ${meta.variant}`}>
                        {meta.label}
                      </span>
                    );
                  })}
                  {confidence != null && (
                    <span
                      className={`status-chip ${confidence < 80 ? "warning" : "success"}`}
                    >
                      {confidence}% confidence
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.split}>
                <div className={styles.imageCol}>
                  <div className={styles.imageLabel}>Textbook page</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/files/${p.storageKey}`}
                    alt={`Textbook page ${i + 1}`}
                    className={styles.pageImage}
                  />
                </div>
                <div className={styles.editorCol}>
                  <div className={styles.imageLabel}>Extracted content (editable)</div>
                  <textarea
                    className={`textarea ${styles.editor}`}
                    value={edit?.content ?? ""}
                    onChange={(e) => setContent(p.pageId, e.target.value)}
                    placeholder="No text was extracted. You can type the content manually."
                  />
                  {hasBlankToken ? (
                    <div className={styles.confirmBox}>
                      <div className={styles.confirmTitle}>
                        ✓ Blank Restored (&quot;_____&quot; detected)
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-small btn-primary"
                          onClick={() => {
                            /* Confirmed */
                          }}
                        >
                          Confirm ✓
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-outline"
                          onClick={() => {
                            const newContent = prompt("Edit page content:", contentText);
                            if (newContent !== null) setContent(p.pageId, newContent);
                          }}
                        >
                          Edit ✎
                        </button>
                        <button
                          type="button"
                          className="btn btn-small btn-outline"
                          onClick={() => {
                            setContent(p.pageId, contentText.replace(/_____/g, ""));
                          }}
                        >
                          Clear ✕
                        </button>
                      </div>
                    </div>
                  ) : (
                    uniqueWordsInText.length > 0 && (
                      <div className={styles.clickToBlankBox}>
                        <div className={styles.clickToBlankTitle}>
                          ⚡ Click-to-Blank (click a filled answer word to replace it with &quot;_____&quot;):
                        </div>
                        <div className={styles.wordChips}>
                          {uniqueWordsInText.slice(0, 15).map((w, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={styles.wordChip}
                              onClick={() => convertWordToBlank(p.pageId, w)}
                              title={`Replace "${w}" with _____`}
                            >
                              + Blank &quot;{w}&quot;
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                  <label className={styles.includeRow}>
                    <input
                      type="checkbox"
                      checked={edit?.included ?? false}
                      onChange={() => toggle(p.pageId)}
                      className={styles.checkbox}
                    />
                    Include this page in the reviewer source
                  </label>
                </div>
              </div>
              {p.model && <div className="text-mono-sm">Read by {p.model}</div>}
            </div>
          );
        })}
      </div>

      <div className={styles.toolbar}>
        <div className="text-secondary">
          Once verified, this becomes an immutable source snapshot.
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Mark verified & continue →"}
        </button>
      </div>
    </div>
  );
}
