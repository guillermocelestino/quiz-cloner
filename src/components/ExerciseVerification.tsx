"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceReproducedOcr, SourceReproducedExerciseItem } from "@/lib/types";
import { completeCandidateAnswer } from "@/lib/server/ocr/normalize-ocr";
import styles from "./OcrVerification.module.css";

export interface ExerciseOcrPageData {
  pageId: string;
  orderIndex: number;
  pageLabel: string | null;
  storageKey: string;
  normalized: SourceReproducedOcr;
  warningFlags: string[];
}

export interface EditableExerciseItem {
  id: string; // client-side key
  pageId: string | null;
  pageLabel: string | null;
  itemNumber: number;
  exerciseType: string;
  instructions: string;
  questionText: string;
  blankLocations: number[];
  choices: string[];
  wordBank: string[];
  matchingPairs: { left: string; right: string }[];
  detectedAnswers: Array<{ value: string; type?: string; confidence?: number }>;
  handwrittenAnswers: Array<{ value: string; confidence?: number }>;
  printedAnswers: Array<{ value: string; confidence?: number }>;
  answerMarkers: string[];
  answer: string; // Parent verified answer for key
  sourceOrder: number;
  included: boolean;
}

const EXERCISE_TYPES = [
  { value: "fill_blank", label: "Fill in the Blank" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "word_bank", label: "Word Bank Exercise" },
  { value: "matching", label: "Matching Pairs" },
  { value: "true_false", label: "True / False" },
  { value: "complete_sentence", label: "Complete Sentence" },
  { value: "circle_select", label: "Circle / Select Correct" },
  { value: "other", label: "Other / Freeform" },
];

export function ExerciseVerification({
  examPrepId,
  initialOcrResults,
}: {
  examPrepId: string;
  initialOcrResults: ExerciseOcrPageData[];
}) {
  const router = useRouter();

  // Flatten OCR exercise items into an initial array of EditableExerciseItem
  const [exercises, setExercises] = useState<EditableExerciseItem[]>(() => {
    const list: EditableExerciseItem[] = [];
    let globalIndex = 0;

    initialOcrResults.forEach((page) => {
      const items = page.normalized.exerciseItems ?? [];
      const pageInstr = page.normalized.pageInstructions?.join("\n") || "";
      const pageBank = page.normalized.availableBank || [];

      items.forEach((item, idx) => {
        globalIndex++;

        // Format candidate lists safely supporting strings, objects, numbers, and varied key names
        const formatCandidateList = (arr: any[] | undefined, questionText?: string) => {
          if (!arr || !Array.isArray(arr) || arr.length === 0) return "";
          return arr
            .map((a) => {
              let val = "";
              if (typeof a === "string") val = a.trim();
              else if (typeof a === "number") val = String(a);
              else if (a && typeof a === "object") {
                val = (a.value || a.answer || a.text || a.val || a.word || a.choice || "").trim();
              }
              return val ? completeCandidateAnswer(val, questionText) : "";
            })
            .filter(Boolean)
            .join(", ");
        };

        const detectedArr = item.detectedAnswers || (item as any).detected_answers || ((item as any).detectedAnswer ? [(item as any).detectedAnswer] : undefined);
        const handwrittenArr = item.handwrittenAnswers || (item as any).handwritten_answers || ((item as any).handwrittenAnswer ? [(item as any).handwrittenAnswer] : undefined);
        const printedArr = item.printedAnswers || (item as any).printed_answers || ((item as any).printedAnswer ? [(item as any).printedAnswer] : undefined);
        const markersArr = item.answerMarkers || (item as any).answer_markers || ((item as any).answerMarker ? [(item as any).answerMarker] : undefined);
        const matchingArr = item.matchingPairs || (item as any).matching_pairs;

        let initAnswer = typeof (item as any).answer === "string" ? (item as any).answer.trim() : typeof (item as any).proposedAnswer === "string" ? (item as any).proposedAnswer.trim() : "";

        if (!initAnswer && detectedArr) {
          initAnswer = formatCandidateList(detectedArr, item.questionText);
        }
        if (!initAnswer && handwrittenArr) {
          initAnswer = formatCandidateList(handwrittenArr, item.questionText);
        }
        if (!initAnswer && printedArr) {
          initAnswer = formatCandidateList(printedArr, item.questionText);
        }
        if (!initAnswer && markersArr) {
          initAnswer = formatCandidateList(markersArr, item.questionText);
        }
        if (!initAnswer && matchingArr && matchingArr.length > 0) {
          initAnswer = matchingArr.map((p: any) => `${p.left} -> ${p.right}`).join(", ");
        }



        list.push({
          id: `ex_${page.pageId}_${idx}_${Date.now()}`,
          pageId: page.pageId,
          pageLabel: item.pageLabel ?? page.pageLabel ?? `Page ${page.orderIndex + 1}`,
          itemNumber: item.itemNumber ?? idx + 1,
          exerciseType: item.exerciseType || "fill_blank",
          instructions: item.instructions || pageInstr,
          questionText: item.questionText || "",
          blankLocations: item.blankLocations || [],
          choices: item.choices || [],
          wordBank: item.wordBank || pageBank,
          matchingPairs: item.matchingPairs || [],
          detectedAnswers: item.detectedAnswers || [],
          handwrittenAnswers: item.handwrittenAnswers || [],
          printedAnswers: item.printedAnswers || [],
          answerMarkers: item.answerMarkers || [],
          answer: initAnswer,
          sourceOrder: globalIndex,
          included: true,
        });
      });
    });

    return list;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handlers for individual item field updates
  function updateItem(id: string, updates: Partial<EditableExerciseItem>) {
    setExercises((prev) =>
      prev.map((ex) => (ex.id === id ? { ...ex, ...updates } : ex))
    );
  }

  function moveItem(index: number, direction: "up" | "down") {
    setExercises((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((item, idx) => ({ ...item, sourceOrder: idx + 1 }));
    });
  }

  function addChoice(id: string, choiceText: string) {
    if (!choiceText.trim()) return;
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id ? { ...ex, choices: [...ex.choices, choiceText.trim()] } : ex
      )
    );
  }

  function removeChoice(id: string, choiceIndex: number) {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id
          ? { ...ex, choices: ex.choices.filter((_, i) => i !== choiceIndex) }
          : ex
      )
    );
  }

  function addWordBankItem(id: string, word: string) {
    if (!word.trim()) return;
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id ? { ...ex, wordBank: [...ex.wordBank, word.trim()] } : ex
      )
    );
  }

  function removeWordBankItem(id: string, wordIndex: number) {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id
          ? { ...ex, wordBank: ex.wordBank.filter((_, i) => i !== wordIndex) }
          : ex
      )
    );
  }

  function addMatchingPair(id: string) {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id
          ? { ...ex, matchingPairs: [...ex.matchingPairs, { left: "", right: "" }] }
          : ex
      )
    );
  }

  function updateMatchingPair(
    id: string,
    pairIndex: number,
    field: "left" | "right",
    val: string
  ) {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== id) return ex;
        const pairs = [...ex.matchingPairs];
        pairs[pairIndex] = { ...pairs[pairIndex], [field]: val };
        return { ...ex, matchingPairs: pairs };
      })
    );
  }

  function removeMatchingPair(id: string, pairIndex: number) {
    setExercises((prev) =>
      prev.map((ex) =>
        ex.id === id
          ? { ...ex, matchingPairs: ex.matchingPairs.filter((_, i) => i !== pairIndex) }
          : ex
      )
    );
  }

  async function saveVerification() {
    setError(null);
    const includedExercises = exercises.filter(
      (ex) => ex.included && ex.questionText.trim().length > 0
    );

    if (includedExercises.length === 0) {
      setError("Verify and include at least one valid exercise to continue.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        exercises: exercises.map((ex, index) => ({
          pageId: ex.pageId,
          itemNumber: ex.itemNumber,
          exerciseType: ex.exerciseType,
          instructions: ex.instructions || null,
          questionText: ex.questionText,
          blankLocations: ex.blankLocations.length > 0 ? ex.blankLocations : null,
          choices: ex.choices.length > 0 ? ex.choices : null,
          wordBank: ex.wordBank.length > 0 ? ex.wordBank : null,
          matchingPairs: ex.matchingPairs.length > 0 ? ex.matchingPairs : null,
          detectedAnswers: ex.detectedAnswers.length > 0 ? ex.detectedAnswers : null,
          handwrittenAnswers: ex.handwrittenAnswers.length > 0 ? ex.handwrittenAnswers : null,
          printedAnswers: ex.printedAnswers.length > 0 ? ex.printedAnswers : null,
          answerMarkers: ex.answerMarkers.length > 0 ? ex.answerMarkers : null,
          confidence: 1.0,
          pageLabel: ex.pageLabel,
          sourceOrder: index + 1,
          included: ex.included && ex.questionText.trim().length > 0,
          parentConfirmed: true,
          answer: ex.answer,
        })),
      };

      const res = await fetch(`/api/exam-prep/${examPrepId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save verified exercises.");
        return;
      }

      router.push(`/exam-prep/${examPrepId}/configure`);
    } catch {
      setError("Failed to save verification. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const includedCount = exercises.filter(
    (ex) => ex.included && ex.questionText.trim().length > 0
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div className={styles.stickyHeader}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
            Source Exercise Verification
          </h2>
          <p className="text-secondary" style={{ fontSize: "0.875rem", margin: "4px 0 0" }}>
            Review, edit, and confirm each textbook exercise. Confirmed exercises become the
            authoritative source for student reproduction.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span style={{ fontSize: "0.875rem" }} className="text-secondary">
            {includedCount} of {exercises.length} items included
          </span>
          <button
            className="btn btn-primary"
            onClick={saveVerification}
            disabled={saving || includedCount === 0}
          >
            {saving ? "Finalizing Snapshot..." : "Finalize & Confirm Verified Source"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error">
          <span>{error}</span>
        </div>
      )}

      {exercises.length === 0 ? (
        <div className="empty-state">
          <h3>No exercises detected</h3>
          <p className="text-secondary">
            No structured exercise items were detected from OCR. Please check the textbook page capture.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {exercises.map((item, index) => (
            <div
              key={item.id}
              className="card"
              style={{
                border: item.included ? "1px solid var(--color-border, #30363d)" : "1px dashed var(--color-text-muted, #6e7681)",
                opacity: item.included ? 1 : 0.6,
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {/* Card Top Control Bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingBottom: "12px",
                  borderBottom: "1px solid var(--color-border, #30363d)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, cursor: "pointer", color: "var(--color-text-primary, #e6edf3)" }}>
                    <input
                      type="checkbox"
                      checked={item.included}
                      onChange={(e) => updateItem(item.id, { included: e.target.checked })}
                    />
                    Include Item #{item.itemNumber}
                  </label>
                  {item.pageLabel && (
                    <span className="badge badge-secondary" style={{ fontSize: "0.75rem" }}>
                      {item.pageLabel}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={index === 0}
                    onClick={() => moveItem(index, "up")}
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={index === exercises.length - 1}
                    onClick={() => moveItem(index, "down")}
                  >
                    ↓ Down
                  </button>
                </div>
              </div>

              {/* Item Metadata Form Row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: "16px" }}>
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Item #
                  </label>
                  <input
                    type="number"
                    className="input"
                    value={item.itemNumber}
                    onChange={(e) => updateItem(item.id, { itemNumber: parseInt(e.target.value, 10) || index + 1 })}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Exercise Type
                  </label>
                  <select
                    className="input"
                    value={item.exerciseType}
                    onChange={(e) => updateItem(item.id, { exerciseType: e.target.value })}
                  >
                    {EXERCISE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Order
                  </label>
                  <span className="input" style={{ backgroundColor: "var(--color-surface-elevated, #1c2128)", color: "var(--color-text-primary, #e6edf3)", display: "block" }}>
                    {index + 1}
                  </span>
                </div>
              </div>

              {/* Exercise Instructions */}
              <div>
                <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                  Section / Exercise Instructions
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Fill in the missing blend for each word:"
                  value={item.instructions}
                  onChange={(e) => updateItem(item.id, { instructions: e.target.value })}
                />
              </div>

              {/* Question Wording */}
              <div>
                <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                  Exact Exercise Wording
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={item.questionText}
                  onChange={(e) => updateItem(item.id, { questionText: e.target.value })}
                  placeholder="e.g. 1. The _____ can fly."
                />
              </div>

              {/* Type-Specific Verification Editors */}

              {/* Multiple Choice Options */}
              {(item.exerciseType === "multiple_choice" || item.exerciseType === "circle_select") && (
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Choices
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                    {item.choices.map((choice, cIdx) => (
                      <span
                        key={cIdx}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: "var(--color-surface-elevated, #1c2128)",
                          border: "1px solid var(--color-border, #30363d)",
                          color: "var(--color-text-primary, #e6edf3)",
                          fontSize: "0.875rem",
                        }}
                      >
                        {choice}
                        <button
                          type="button"
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-error, #f85149)", padding: 0 }}
                          onClick={() => removeChoice(item.id, cIdx)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      className="input"
                      id={`new_choice_${item.id}`}
                      placeholder="Add choice (e.g. A. Dog)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addChoice(item.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const inputEl = document.getElementById(`new_choice_${item.id}`) as HTMLInputElement;
                        if (inputEl) {
                          addChoice(item.id, inputEl.value);
                          inputEl.value = "";
                        }
                      }}
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )}

              {/* Word Bank */}
              {(item.exerciseType === "word_bank" || item.exerciseType === "fill_blank") && (
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Word Bank Options
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                    {item.wordBank.map((word, wIdx) => (
                      <span
                        key={wIdx}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          backgroundColor: "rgba(47, 129, 247, 0.15)",
                          border: "1px solid rgba(47, 129, 247, 0.3)",
                          color: "var(--color-accent-blue, #58a6ff)",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        {word}
                        <button
                          type="button"
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-accent-blue, #58a6ff)", padding: 0 }}
                          onClick={() => removeWordBankItem(item.id, wIdx)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      className="input"
                      id={`new_word_${item.id}`}
                      placeholder="Add word bank item"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addWordBankItem(item.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const inputEl = document.getElementById(`new_word_${item.id}`) as HTMLInputElement;
                        if (inputEl) {
                          addWordBankItem(item.id, inputEl.value);
                          inputEl.value = "";
                        }
                      }}
                    >
                      + Add Word
                    </button>
                  </div>
                </div>
              )}

              {/* Matching Pairs */}
              {item.exerciseType === "matching" && (
                <div>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 600, display: "block", marginBottom: "4px", color: "var(--color-text-primary, #e6edf3)" }}>
                    Matching Pairs
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
                    {item.matchingPairs.map((pair, pIdx) => (
                      <div key={pIdx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Left prompt (e.g. Dog)"
                          value={pair.left}
                          onChange={(e) => updateMatchingPair(item.id, pIdx, "left", e.target.value)}
                        />
                        <span style={{ color: "var(--color-text-secondary, #8b949e)" }}>↔</span>
                        <input
                          type="text"
                          className="input"
                          placeholder="Right match (e.g. Woof)"
                          value={pair.right}
                          onChange={(e) => updateMatchingPair(item.id, pIdx, "right", e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ color: "var(--color-error, #f85149)" }}
                          onClick={() => removeMatchingPair(item.id, pIdx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => addMatchingPair(item.id)}
                  >
                    + Add Matching Pair
                  </button>
                </div>
              )}

              {/* Detected Answers Display & Answer Key Verification Input */}
              <div
                style={{
                  backgroundColor: "var(--color-surface-elevated, #1c2128)",
                  border: "1px solid var(--color-border, #30363d)",
                  padding: "12px",
                  borderRadius: "6px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--color-text-primary, #e6edf3)",
                    marginBottom: "8px",
                  }}
                >
                  Detected Answers & Verification
                </div>

                {/* Detected Badges & Candidate Selection */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                  {item.detectedAnswers.map((ans, aIdx) => {
                    const val = typeof ans === "string" ? ans : (ans as any)?.value || "";
                    if (!val) return null;
                    return (
                      <button
                        key={`d_${aIdx}`}
                        type="button"
                        className="badge badge-info"
                        style={{ cursor: "pointer" }}
                        onClick={() => updateItem(item.id, { answer: val })}
                        title="Click to copy into Verified Answer Key"
                      >
                        Detected: &quot;{val}&quot;
                      </button>
                    );
                  })}

                  {item.printedAnswers.map((ans, aIdx) => {
                    const val = typeof ans === "string" ? ans : (ans as any)?.value || "";
                    if (!val) return null;
                    return (
                      <button
                        key={`p_${aIdx}`}
                        type="button"
                        className="badge badge-info"
                        style={{ cursor: "pointer" }}
                        onClick={() => updateItem(item.id, { answer: val })}
                        title="Click to copy into Verified Answer Key"
                      >
                        Printed Answer: &quot;{val}&quot;
                      </button>
                    );
                  })}

                  {item.handwrittenAnswers.map((ans, aIdx) => {
                    const val = typeof ans === "string" ? ans : (ans as any)?.value || "";
                    if (!val) return null;
                    return (
                      <button
                        key={`h_${aIdx}`}
                        type="button"
                        className="badge badge-warning"
                        style={{ cursor: "pointer" }}
                        onClick={() => updateItem(item.id, { answer: val })}
                        title="Click to copy into Verified Answer Key"
                      >
                        Handwritten: &quot;{val}&quot;
                      </button>
                    );
                  })}

                  {item.answerMarkers.map((marker, mIdx) => (
                    <button
                      key={`m_${mIdx}`}
                      type="button"
                      className="badge badge-secondary"
                      style={{ cursor: "pointer" }}
                      onClick={() => updateItem(item.id, { answer: marker })}
                      title="Click to copy into Verified Answer Key"
                    >
                      Marker: &quot;{marker}&quot;
                    </button>
                  ))}
                </div>

                {/* Candidate Conflict Warning */}
                {(() => {
                  const getVal = (a: any) => (typeof a === "string" ? a : (a as any)?.value || "");
                  const candidates = [
                    ...item.detectedAnswers.map(getVal),
                    ...item.printedAnswers.map(getVal),
                    ...item.handwrittenAnswers.map(getVal),
                    ...(item.answerMarkers || []),
                  ].filter((c) => c.trim().length > 0);
                  const uniqueCandidates = Array.from(new Set(candidates.map((c) => c.trim().toLowerCase())));
                  if (uniqueCandidates.length > 1) {
                    return (
                      <div className="alert warning" style={{ marginBottom: "12px", fontSize: "0.8125rem", padding: "8px 12px" }}>
                        ⚠️ Multiple candidate answers detected from OCR. Click the correct candidate badge above or enter the verified answer below.
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Verified Answer Key Input */}
                <div>
                  <label
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--color-text-primary, #e6edf3)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Verified Answer Key (Parent Confirmed)
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Enter authoritative answer key for this exercise"
                    value={item.answer}
                    onChange={(e) => updateItem(item.id, { answer: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
