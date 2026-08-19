/**
 * Deterministic Part A Content Generator (server-only).
 *
 * Extracts Vocabulary Words ("Words to Practice") and Core Reading Facts
 * ("Sentences to Remember") directly from the verified snapshot.
 * THIS MODULE DOES NOT USE AN LLM.
 */

export type SnapshotItem = {
  content: string;
  pageLabel?: string | null;
  factKind?: string;
  itemNumber?: number | null;
  sentence?: string | null;
  blankToken?: string | null;
  wordBank?: string[] | null;
  pictureCue?: string | null;
  proposedAnswer?: string | null;
  included?: boolean;
};

export type PartAContent = {
  wordsToPractice: string[];
  sentencesToRemember: string[];
};

export function generatePartAContent(items: SnapshotItem[]): PartAContent {
  const wordsSet = new Set<string>();
  const sentencesSet = new Set<string>();

  for (const item of items) {
    if (item.included === false) continue;

    // 1. Vocabulary extraction from ExerciseItems
    if (item.factKind === "ExerciseItem") {
      if (item.proposedAnswer && item.proposedAnswer.trim().length > 0) {
        wordsSet.add(item.proposedAnswer.trim());
      }
      if (item.wordBank && Array.isArray(item.wordBank)) {
        item.wordBank.forEach((w) => {
          if (w.trim().length > 0 && w.trim().length <= 25) {
            wordsSet.add(w.trim());
          }
        });
      }
    }

    // 2. Sentences extraction from DeclarativeFacts
    if (item.factKind === "DeclarativeFact" || !item.factKind) {
      const text = (item.content || item.sentence || "").trim();
      if (text.length >= 5) {
        // Split multi-sentence paragraphs if needed
        const lines = text
          .split(/(?<=[.!?])\s+|\n+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 5);
        lines.forEach((l) => sentencesSet.add(l));
      }
    }
  }

  const wordsToPractice = Array.from(wordsSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const sentencesToRemember = Array.from(sentencesSet);

  return {
    wordsToPractice,
    sentencesToRemember,
  };
}
