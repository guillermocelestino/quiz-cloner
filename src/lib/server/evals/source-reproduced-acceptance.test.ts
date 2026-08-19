/**
 * Real-World Source-Reproduced Acceptance Test Suite (Phase 7)
 *
 * Verifies end-to-end runtime flow:
 * OCR → source_reproduced_ocr_results → ExerciseVerification → verified_exercises →
 * deterministic reconstruction → structural validation → student PDF → answer-key PDF.
 *
 * Covers Cases A through L:
 * A. Fill-in-the-blank with a printed answer
 * B. Fill-in-the-blank with a handwritten answer
 * C. Multiple choice with a marked/selected answer
 * D. Multiple choice where correct answer text also appears elsewhere
 * E. Word-bank exercise where answer also appears in word bank
 * F. Matching exercise with answers/lines/marks
 * G. First-letter clue such as "b _ _ _"
 * H. Multiple exercises on same page
 * I. Mixed exercise types on same page
 * J. Exercise with NO existing answers
 * K. Explicit answer marker such as "Answer: bird"
 * L. Answer word also appears in instructions or lead-in prose
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { normalizeExerciseOcr } from "@/lib/server/ocr/normalize-ocr";
import {
  reconstructAllExercises,
  generateQuestionnaireText,
  reconstructExerciseItem,
} from "@/lib/server/reconstruction/reconstruct-exercise";
import { validateReconstruction } from "@/lib/server/reconstruction/validate-reconstruction";
import {
  generateSourceReproducedStudentPdf,
  generateSourceReproducedAnswerKeyPdf,
} from "@/lib/server/pdf/source-reproduced-pdf";
import type { SourceReproducedOcr, SourceReproducedExerciseItem } from "@/lib/types";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixtureJson(name: string): any {
  const filePath = path.join(FIXTURES_DIR, `${name}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

describe("Phase 7: Real-World Source-Reproduced Acceptance Tests (Cases A - L)", () => {
  it("Case A: Fill-in-the-blank with a printed answer", async () => {
    const ocr: SourceReproducedOcr = {
      text: "The bird can fly.",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The bird can fly.",
          printedAnswers: [{ value: "fly", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    // 1. Reconstruction
    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("The bird can _____.");
    expect(recon[0].preservedAnswers[0].value).toBe("fly");

    // 2. Validation
    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);

    // 3. Student PDF
    const studentPdf = await generateSourceReproducedStudentPdf({
      title: "Case A Test",
      subject: "English",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: recon[0].exerciseType,
          questionText: recon[0].questionnaireText,
          answer: "fly",
          sourceOrder: 1,
        },
      ],
    });
    expect(Buffer.isBuffer(studentPdf)).toBe(true);
    expect(studentPdf.toString("utf8", 0, 5)).toBe("%PDF-");

    // 4. Answer Key PDF
    const keyPdf = await generateSourceReproducedAnswerKeyPdf({
      title: "Case A Test",
      subject: "English",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: recon[0].exerciseType,
          questionText: recon[0].questionnaireText,
          answer: "fly",
          sourceOrder: 1,
        },
      ],
    });
    expect(Buffer.isBuffer(keyPdf)).toBe(true);
  });

  it("Case B: Fill-in-the-blank with a handwritten answer", async () => {
    const ocr: SourceReproducedOcr = {
      text: "The dog can bark.",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The dog can bark.",
          handwrittenAnswers: [{ value: "bark", location: "blank", source: "handwritten", confidence: 0.9 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("The dog can _____.");
    expect(recon[0].preservedAnswers[0].value).toBe("bark");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);

    const studentPdf = await generateSourceReproducedStudentPdf({
      title: "Case B Test",
      subject: "English",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: recon[0].exerciseType,
          questionText: recon[0].questionnaireText,
          answer: "bark",
          sourceOrder: 1,
        },
      ],
    });
    expect(studentPdf.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  it("Case C: Multiple choice with a marked/selected answer", async () => {
    const ocr: SourceReproducedOcr = {
      text: "Which animal barks?",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "multiple_choice",
          questionText: "Which animal barks?",
          choices: ["A. cat", "B. dog", "C. bird"],
          detectedAnswers: [{ value: "B. dog", location: "choice", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].choices).toEqual(["A. cat", "B. dog", "C. bird"]);
    expect(recon[0].questionnaireText).toBe("Which animal barks?");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);

    const studentPdf = await generateSourceReproducedStudentPdf({
      title: "Case C Test",
      subject: "English",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: recon[0].exerciseType,
          questionText: recon[0].questionnaireText,
          choices: recon[0].choices,
          answer: "B. dog",
          sourceOrder: 1,
        },
      ],
    });
    expect(studentPdf.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  it("Case D: Multiple choice where correct answer text also appears elsewhere in question", async () => {
    const ocr: SourceReproducedOcr = {
      text: "The cat saw a cat.",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "multiple_choice",
          questionText: "The cat saw a cat. What did the cat see?",
          choices: ["A. dog", "B. cat", "C. bird"],
          detectedAnswers: [{ value: "B. cat", location: "choice", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("The cat saw a cat. What did the cat see?");
    expect(recon[0].choices).toEqual(["A. dog", "B. cat", "C. bird"]);

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case E: Word-bank exercise where answer also appears in word bank", async () => {
    const ocr: SourceReproducedOcr = {
      text: "The bird can fly.",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "word_bank",
          questionText: "The bird can fly.",
          wordBank: ["cat", "dog", "fly"],
          detectedAnswers: [{ value: "fly", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("The bird can _____.");
    expect(recon[0].wordBank).toEqual(["cat", "dog", "fly"]);

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case F: Matching exercise with answers/lines/marks", async () => {
    const ocr: SourceReproducedOcr = {
      text: "Match animal to sound",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "matching",
          questionText: "Match the animal to its sound:",
          matchingPairs: [
            { left: "Dog", right: "Woof" },
            { left: "Cat", right: "Meow" },
          ],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].matchingPairs).toEqual([
      { left: "Dog", right: "Woof" },
      { left: "Cat", right: "Meow" },
    ]);

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case G: First-letter clue such as b _ _ _", async () => {
    const ocr: SourceReproducedOcr = {
      text: "First letter clue",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "A woman getting married is a b _ _ _ _.",
          detectedAnswers: [{ value: "bride", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("A woman getting married is a b _ _ _ _.");
    expect(recon[0].preservedAnswers[0].value).toBe("bride");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case H: Multiple exercises on the same page", async () => {
    const ocr: SourceReproducedOcr = {
      text: "Page 42 exercises",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The bird can fly.",
          detectedAnswers: [{ value: "fly", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
        {
          itemNumber: 2,
          exerciseType: "fill_blank",
          questionText: "The dog can bark.",
          detectedAnswers: [{ value: "bark", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 2,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon.length).toBe(2);
    expect(recon[0].questionnaireText).toBe("The bird can _____.");
    expect(recon[1].questionnaireText).toBe("The dog can _____.");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case I: Mixed exercise types on the same page", async () => {
    const json = loadFixtureJson("source-reproduced-mixed-types");
    const ocr = normalizeExerciseOcr(json, JSON.stringify(json), "test-model");

    const recon = reconstructAllExercises(ocr);
    expect(recon.length).toBe(3);
    expect(recon[0].exerciseType).toBe("fill_blank");
    expect(recon[1].exerciseType).toBe("multiple_choice");
    expect(recon[2].exerciseType).toBe("true_false");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case J: Exercise with NO existing answers", async () => {
    const json = loadFixtureJson("source-reproduced-no-answers");
    const ocr = normalizeExerciseOcr(json, JSON.stringify(json), "test-model");

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).toBe("The elephant is _____.");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case K: Explicit answer marker such as Answer: bird", async () => {
    const json = loadFixtureJson("source-reproduced-explicit-markers");
    const ocr = normalizeExerciseOcr(json, JSON.stringify(json), "test-model");

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].questionnaireText).not.toContain("Answer: B");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });

  it("Case L: Answer word also appears in instructions or lead-in prose", async () => {
    const ocr: SourceReproducedOcr = {
      text: "Lead-in protection test",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Choose the word fly to complete:",
          questionText: "The fly is an insect. A dog can fly.",
          blankLocations: [30],
          detectedAnswers: [{ value: "fly", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const recon = reconstructAllExercises(ocr);
    expect(recon[0].instructions).toBe("Choose the word fly to complete:");
    expect(recon[0].questionnaireText).toBe("The fly is an insect. A dog can _____.");

    const val = validateReconstruction(ocr, recon);
    expect(val.valid).toBe(true);
  });
});
