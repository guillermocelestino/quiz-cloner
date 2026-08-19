"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./PageCapture.module.css";

type PageItem = {
  id: string;
  orderIndex: number;
  storageKey: string;
  pageLabel: string | null;
  status: string;
  qualityFlags: string[];
};

const QUALITY_LABELS: Record<string, string> = {
  unsupported_format: "Unsupported image format",
  invalid_image: "Image could not be read",
  too_small: "Image is very small",
  extreme_aspect: "Unusual page shape",
  blur_warning: "Photo may be blurry. Retaking is recommended.",
  glare_warning: "Possible glare on the page.",
};

const STATUS_META: Record<string, { label: string; variant: string }> = {
  pending: { label: "Waiting", variant: "neutral" },
  processing: { label: "Reading…", variant: "info" },
  ready: { label: "Ready", variant: "success" },
  failed: { label: "Could not read", variant: "error" },
};

export function PageCapture({
  examPrepId,
  initialPages,
  demo,
}: {
  examPrepId: string;
  initialPages: PageItem[];
  demo: boolean;
}) {
  const [pages, setPages] = useState<PageItem[]>(initialPages);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      arr.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/exam-prep/${examPrepId}/pages`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
      } else {
        setPages(
          data.pages.map((p: PageItem) => ({
            id: p.id,
            orderIndex: p.orderIndex,
            storageKey: p.storageKey,
            pageLabel: p.pageLabel,
            status: p.status,
            qualityFlags: p.qualityFlags ?? [],
          }))
        );
        if (data.errors?.length) {
          setError(
            `${data.errors.length} file(s) could not be added: ${data.errors
              .map((e: { name: string; error: string }) => e.error)
              .join(" · ")}`
          );
        }
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  async function startReading() {
    setError(null);
    setReading(true);
    try {
      const res = await fetch(`/api/exam-prep/${examPrepId}/ocr`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Could not start reading.");
        setReading(false);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetch(`/api/exam-prep/${examPrepId}/status`);
          const data = await s.json();
          setPages(data.pages);
          const allDone = data.pages.every(
            (p: PageItem) => p.status === "ready" || p.status === "failed"
          );
          if (allDone) {
            if (pollRef.current) clearInterval(pollRef.current);
            setReading(false);
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch {
      setError("Could not start reading. Please try again.");
      setReading(false);
    }
  }

  async function removePage(id: string) {
    await fetch(`/api/exam-prep/${examPrepId}/pages/${id}`, { method: "DELETE" });
    setPages((prev) => prev.filter((p) => p.id !== id));
  }

  async function setLabel(id: string, label: string) {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pageLabel: label } : p))
    );
  }

  async function saveLabel(id: string, label: string) {
    await fetch(`/api/exam-prep/${examPrepId}/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageLabel: label || null }),
    });
  }

  async function move(id: string, dir: -1 | 1) {
    const order = pages.map((p) => p.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setPages((prev) =>
      prev
        .map((p) => ({ ...p }))
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
        .map((p, idx) => ({ ...p, orderIndex: idx }))
    );
    await fetch(`/api/exam-prep/${examPrepId}/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  }

  const canRead = pages.length > 0 && !reading;
  const allRead = pages.length > 0 && pages.every((p) => p.status === "ready" || p.status === "failed");
  const hasReady = pages.some((p) => p.status === "ready");

  return (
    <div className={styles.wrap}>
      {demo && (
        <div className="alert info" role="status">
          <strong>Demo mode:</strong> No NVIDIA API key configured. Page text and
          questions will use clearly-labeled sample content so you can try the full flow.
        </div>
      )}

      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className={styles.dropIcon} aria-hidden="true">📸</div>
        <div className={styles.dropText}>
          Drag &amp; drop textbook photos here
        </div>
        <div className="text-secondary" style={{ marginBottom: 12 }}>
          JPG or PNG · up to 8 pages
        </div>
        <div className={styles.dropActions}>
          <button
            type="button"
            className="btn btn-blue"
            onClick={() => cameraRef.current?.click()}
          >
            + Take photo
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => uploadRef.current?.click()}
          >
            Upload from device
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={uploadRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploading && (
        <div className="row" style={{ color: "var(--color-text-secondary)" }}>
          <span className="spinner" /> Uploading…
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {pages.length > 0 && (
        <>
          <div className={styles.queueHeader}>
            <h2 className="section-title">Page queue</h2>
            <span className="text-mono-sm">{pages.length} page(s)</span>
          </div>
          <div className={styles.queue}>
            {pages.map((p, i) => {
              const meta = STATUS_META[p.status] ?? STATUS_META.pending;
              return (
                <div key={p.id} className={`card ${styles.pageCard}`}>
                  <div className={styles.thumbWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/files/${p.storageKey}`}
                      alt={`Page ${i + 1}`}
                      className={styles.thumb}
                    />
                    <span className={styles.pageIndex}>Page {i + 1}</span>
                  </div>
                  <div className={styles.pageBody}>
                    <input
                      className={`input ${styles.labelInput}`}
                      placeholder="Label e.g. Page 42"
                      value={p.pageLabel ?? ""}
                      onChange={(e) => setLabel(p.id, e.target.value)}
                      onBlur={(e) => saveLabel(p.id, e.target.value)}
                    />
                    <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                      <span className={`status-chip ${meta.variant}`}>
                        <span className="dot" />
                        {meta.label}
                      </span>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn btn-outline btn-small"
                          onClick={() => move(p.id, -1)}
                          disabled={i === 0}
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-outline btn-small"
                          onClick={() => move(p.id, 1)}
                          disabled={i === pages.length - 1}
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() => removePage(p.id)}
                          aria-label="Remove page"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {p.qualityFlags.length > 0 && (
                      <ul className={styles.flags}>
                        {p.qualityFlags.map((f) => (
                          <li key={f} className="text-mono-sm">
                            ⚠ {QUALITY_LABELS[f] ?? f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.actionBar}>
            {!allRead ? (
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                <button
                  className="btn btn-primary"
                  onClick={startReading}
                  disabled={!canRead}
                >
                  {reading ? (
                    <>
                      <span className="spinner" /> Reading pages ({pages.filter((p) => p.status === "ready" || p.status === "failed").length}/{pages.length})…
                    </>
                  ) : (
                    "Read pages with Nemotron OCR"
                  )}
                </button>
                {hasReady && (
                  <Link href={`/exam-prep/${examPrepId}/verify`} className="btn btn-secondary">
                    Verify extracted content →
                  </Link>
                )}
              </div>
            ) : (
              <>
                {hasReady ? (
                  <Link href={`/exam-prep/${examPrepId}/verify`} className="btn btn-primary">
                    Verify extracted content →
                  </Link>
                ) : (
                  <span className="alert error" style={{ border: "none", background: "none" }}>
                    No pages could be read. Retake clearer photos and try again.
                  </span>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
