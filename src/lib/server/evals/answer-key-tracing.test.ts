import { describe, it, expect } from "vitest";
import { normalizeExerciseOcr } from "@/lib/server/ocr/normalize-ocr";
import { generateSourceReproducedAnswerKeyPdf } from "@/lib/server/pdf/source-reproduced-pdf";

describe("Answer Key Audit & Tracing Tests", () => {
  it("preserves answers from OCR even when confidence/source/location are omitted in raw response", () => {
    const rawResponse = {
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The dog can bark.",
          printedAnswers: [{ value: "bark" }], // missing source, location, confidence
          detectedAnswers: ["bark"], // string array
          sourceOrder: 1,
        },
      ],
    };

    const normalized = normalizeExerciseOcr(rawResponse, JSON.stringify(rawResponse), "test-model");
    expect(normalized.exerciseItems).toBeDefined();
    expect(normalized.exerciseItems![0].printedAnswers).toEqual([
      { value: "bark", source: "printed", location: "blank", confidence: 1.0 },
    ]);
    expect(normalized.exerciseItems![0].detectedAnswers).toEqual([
      { value: "bark", source: "printed", location: "blank", confidence: 1.0 },
    ]);
  });

  it("renders verified answers in Answer Key PDF for Multiple Choice even if choice text does not match letter exactly", async () => {
    const pdfBuf = await generateSourceReproducedAnswerKeyPdf({
      title: "MC Test",
      subject: "Science",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: "multiple_choice",
          questionText: "Which animal barks?",
          choices: ["Cat", "Dog", "Bird"],
          answer: "Dog",
          sourcePage: "93",
          sourceOrder: 1,
        },
      ],
    });

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.toString("utf8", 0, 5)).toBe("%PDF-");
  });

  it("renders verified answer in Answer Key PDF when answer is provided even with page citation", async () => {
    const pdfBuf = await generateSourceReproducedAnswerKeyPdf({
      title: "Fill Blank Test",
      subject: "English",
      pageFormat: "A4",
      items: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The cat sat on the _____.",
          answer: "mat",
          sourcePage: "93",
          sourceOrder: 1,
        },
      ],
    });

    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.toString("utf8", 0, 5)).toBe("%PDF-");
  });
});
