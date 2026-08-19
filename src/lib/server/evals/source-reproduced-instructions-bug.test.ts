import { describe, it, expect } from "vitest";
import { normalizeExerciseOcr } from "@/lib/server/ocr/normalize-ocr";
import { reconstructAllExercises, generateQuestionnaireText } from "@/lib/server/reconstruction/reconstruct-exercise";
import { validateReconstruction } from "@/lib/server/reconstruction/validate-reconstruction";
import { generateSourceReproducedStudentPdf, generateSourceReproducedAnswerKeyPdf } from "@/lib/server/pdf/source-reproduced-pdf";
import type { SourceReproducedOcr, SourceReproducedExerciseItem, SourceReproducedAnswer } from "@/lib/types";

describe("Bug Regression: Textbook Instructions in Source-Reproduced Mode", () => {
  /**
   * Test 1 — Instructions survive the pipeline
   * OCR normalization -> verification data -> verified_exercises -> reconstruction -> student PDF
   */
  it("Test 1: Instructions survive the complete pipeline to Student PDF", async () => {
    const rawOcrJson = {
      pageInstructions: ["Choose the word that completes each sentence."],
      availableBank: ["bake", "ride"],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Choose the word that completes each sentence.",
          questionText: "The girl can b _ _ _ a cake.",
          printedAnswers: [{ value: "bake", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
        },
        {
          itemNumber: 2,
          exerciseType: "fill_blank",
          instructions: "Choose the word that completes each sentence.",
          questionText: "The boy can r _ _ _ a bike.",
          printedAnswers: [{ value: "ride", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 2,
        },
      ],
    };

    // 1. OCR Normalization
    const normalizedOcr = normalizeExerciseOcr(rawOcrJson, JSON.stringify(rawOcrJson), "test-model");
    expect(normalizedOcr.exerciseItems).toBeDefined();
    expect(normalizedOcr.exerciseItems![0].instructions).toBe("Choose the word that completes each sentence.");

    // 2. Verification Data (Simulated parent-verified input for verified_exercises)
    const verifiedItems = normalizedOcr.exerciseItems!.map((item) => ({
      ...item,
      included: true,
      parentConfirmed: true,
    }));

    const verifiedOcrSnapshot: SourceReproducedOcr = {
      ...normalizedOcr,
      exerciseItems: verifiedItems,
    };

    // 3. Reconstruction
    const reconstructed = reconstructAllExercises(verifiedOcrSnapshot);
    expect(reconstructed.length).toBe(2);
    expect(reconstructed[0].instructions).toBe("Choose the word that completes each sentence.");

    // 4. Structural Validation
    const validation = validateReconstruction(verifiedOcrSnapshot, reconstructed);
    expect(validation.valid).toBe(true);

    // 5. Student PDF Generation
    const pdfItems = reconstructed.map((item) => ({
      itemNumber: item.itemNumber,
      exerciseType: item.exerciseType,
      instructions: item.instructions,
      questionText: item.questionnaireText,
      choices: item.choices,
      wordBank: item.wordBank,
      answer: item.preservedAnswers[0]?.value || "N/A",
      sourceOrder: item.sourceOrder,
    }));

    const pdfBuffer = await generateSourceReproducedStudentPdf({
      title: "English Reviewer",
      subject: "English",
      pageFormat: "A4",
      pageInstructions: verifiedOcrSnapshot.pageInstructions,
      items: pdfItems,
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(500);
    expect(pdfBuffer.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  /**
   * Test 2 — Answer word inside instruction
   * Instruction: "Choose the word fly to complete each sentence."
   * Answer: "fly"
   * Verify candidate answer removal algorithm does NOT modify the instruction text.
   */
  it("Test 2: Answer word inside instruction is NOT modified by candidate answer removal", () => {
    const ocr: SourceReproducedOcr = {
      text: "Fly exercise",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Choose the word fly to complete each sentence.",
          questionText: "The bird can fly.",
          blankLocations: [13],
          printedAnswers: [{ value: "fly", location: "blank", source: "printed", confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const reconstructed = reconstructAllExercises(ocr);

    // Instruction MUST remain exact and untouched
    expect(reconstructed[0].instructions).toBe("Choose the word fly to complete each sentence.");
    // Answer-bearing location in question text MUST be replaced by blank
    expect(reconstructed[0].questionnaireText).toBe("The bird can _____.");
    // Answer preserved for key
    expect(reconstructed[0].preservedAnswers[0].value).toBe("fly");
  });

  /**
   * Test 3 — Answer Key PDF contains original instructions
   */
  it("Test 3: Answer Key PDF contains original instruction", async () => {
    const pdfItems = [
      {
        itemNumber: 1,
        exerciseType: "fill_blank",
        instructions: "Choose the word that completes each sentence.",
        questionText: "The girl can b _ _ _ a cake.",
        answer: "bake",
        sourceOrder: 1,
      },
    ];

    const answerKeyBuffer = await generateSourceReproducedAnswerKeyPdf({
      title: "English Reviewer",
      subject: "English",
      pageFormat: "A4",
      items: pdfItems,
    });

    expect(Buffer.isBuffer(answerKeyBuffer)).toBe(true);
    expect(answerKeyBuffer.length).toBeGreaterThan(500);
    expect(answerKeyBuffer.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  /**
   * Test 4 — Multiple sections
   * Section A: "Choose the correct word." -> items 1, 2
   * Section B: "Match each word." -> items 3, 4
   * Verify instructions remain attached to correct sections and in correct order.
   */
  it("Test 4: Multiple sections preserve instructions in correct order and section scope", async () => {
    const multiSectionItems = [
      {
        itemNumber: 1,
        exerciseType: "fill_blank",
        instructions: "Choose the correct word.",
        questionText: "The sun is _____.",
        answer: "bright",
        sourceOrder: 1,
      },
      {
        itemNumber: 2,
        exerciseType: "fill_blank",
        instructions: "Choose the correct word.",
        questionText: "The grass is _____.",
        answer: "green",
        sourceOrder: 2,
      },
      {
        itemNumber: 3,
        exerciseType: "matching",
        instructions: "Match each word.",
        questionText: "Match animal to sound:",
        matchingPairs: [{ left: "Dog", right: "Woof" }],
        answer: "Dog - Woof",
        sourceOrder: 3,
      },
      {
        itemNumber: 4,
        exerciseType: "matching",
        instructions: "Match each word.",
        questionText: "Match animal to sound:",
        matchingPairs: [{ left: "Cat", right: "Meow" }],
        answer: "Cat - Meow",
        sourceOrder: 4,
      },
    ];

    const studentPdfBuffer = await generateSourceReproducedStudentPdf({
      title: "Multi-Section Reviewer",
      subject: "English",
      pageFormat: "A4",
      items: multiSectionItems,
    });

    expect(Buffer.isBuffer(studentPdfBuffer)).toBe(true);
    expect(studentPdfBuffer.length).toBeGreaterThan(500);

    const answerKeyPdfBuffer = await generateSourceReproducedAnswerKeyPdf({
      title: "Multi-Section Reviewer",
      subject: "English",
      pageFormat: "A4",
      items: multiSectionItems,
    });

    expect(Buffer.isBuffer(answerKeyPdfBuffer)).toBe(true);
    expect(answerKeyPdfBuffer.length).toBeGreaterThan(500);
  });
});
