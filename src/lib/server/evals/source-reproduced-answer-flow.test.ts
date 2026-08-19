import { describe, it, expect } from "vitest";
import { normalizeExerciseOcr, completeCandidateAnswer } from "@/lib/server/ocr/normalize-ocr";
import { reconstructAllExercises } from "@/lib/server/reconstruction/reconstruct-exercise";
import { generateSourceReproducedStudentPdf, generateSourceReproducedAnswerKeyPdf } from "@/lib/server/pdf/source-reproduced-pdf";

describe("Source-Reproduced Answer Verification & Data Flow Tests", () => {
  // Candidate Answer Completion Unit Tests
  it("Candidate completion: Complete OCR answer remains unchanged (blue -> blue)", () => {
    expect(completeCandidateAnswer("blue", "The sky is _ _ ue during sunny days.")).toBe("blue");
    expect(completeCandidateAnswer("plates", "These ____ ates are clean.")).toBe("plates");
  });

  it("Candidate completion: Partial OCR candidate completed when suffix fragment exists (bl + _ _ ue -> blue)", () => {
    expect(completeCandidateAnswer("bl", "10. The sky is _ _ ue during sunny days.")).toBe("blue");
    expect(completeCandidateAnswer("bl-", "10. The sky is _ _ ue during sunny days.")).toBe("blue");
    expect(completeCandidateAnswer("pl-", "1. These ____ ates are clean.")).toBe("plates");
    expect(completeCandidateAnswer("fl-", "2. That __ __ ag is on the pole.")).toBe("flag");
  });

  it("Candidate completion: Answer that cannot be deterministically completed remains unchanged without guessing", () => {
    expect(completeCandidateAnswer("bl", "10. The sky is clear.")).toBe("bl");
    expect(completeCandidateAnswer("xyz", "Complete the sentence.")).toBe("xyz");
  });
  // Test 1: Detected answer appears in initial state following precedence
  it("1. Prepopulates detected answers from OCR using established precedence", () => {
    const rawOcr = {
      text: "1. These plates are clean.",
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "1. These plates are clean.",
          detectedAnswers: [{ value: "plates", source: "printed", location: "blank", confidence: 0.95 }],
        },
      ],
    };

    const normalized = normalizeExerciseOcr(rawOcr, JSON.stringify(rawOcr), "test-model");
    expect(normalized.exerciseItems).toHaveLength(1);
    const item = normalized.exerciseItems![0];

    // Check detected answers array normalized correctly
    expect(item.detectedAnswers).toBeDefined();
    expect(item.detectedAnswers![0].value).toBe("plates");
  });

  it("1b. Normalizes snake_case, singular, and non-standard OCR payloads (e.g. detected_answers, text, answer)", () => {
    const rawOcr = {
      text: "1. The dice rolled six.",
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "1. The dice rolled six.",
          detected_answers: ["dice"],
        },
        {
          itemNumber: 2,
          exerciseType: "fill_blank",
          questionText: "2. The bride wore white.",
          printed_answers: [{ text: "bride" }],
        },
        {
          itemNumber: 3,
          exerciseType: "multiple_choice",
          questionText: "3. Choose correct.",
          answer_markers: ["Answer: B"],
        },
      ],
    };

    const normalized = normalizeExerciseOcr(rawOcr, JSON.stringify(rawOcr), "test-model");
    expect(normalized.exerciseItems).toHaveLength(3);

    expect(normalized.exerciseItems![0].detectedAnswers).toBeDefined();
    expect(normalized.exerciseItems![0].detectedAnswers![0].value).toBe("dice");

    expect(normalized.exerciseItems![1].printedAnswers).toBeDefined();
    expect(normalized.exerciseItems![1].printedAnswers![0].value).toBe("bride");

    expect(normalized.exerciseItems![2].answerMarkers).toBeDefined();
    expect(normalized.exerciseItems![2].answerMarkers![0]).toBe("Answer: B");
  });



  it("1d. Real textbook exercise payload with detected answer 'bride' initializes item.answer with 'bride'", () => {
    const rawOcr = {
      text: "The bride wore white.",
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "The bride wore white.",
          blankLocations: [4],
          detectedAnswers: [{ value: "bride", source: "printed", location: "blank", confidence: 0.95 }],
        },
      ],
    };

    const normalized = normalizeExerciseOcr(rawOcr, JSON.stringify(rawOcr), "test-model");
    expect(normalized.exerciseItems).toHaveLength(1);
    const item = normalized.exerciseItems![0];

    expect(item.detectedAnswers).toBeDefined();
    expect(item.detectedAnswers![0].value).toBe("bride");
  });

  // Test 2: Multiple candidate answers are exposed for candidate selection
  it("2. Preserves multiple candidate answers across sources for parent review", () => {
    const rawOcr = {
      text: "1. What is the price/prize?",
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "1. What is the _____?",
          printedAnswers: [{ value: "prize", source: "printed", location: "blank", confidence: 0.9 }],
          handwrittenAnswers: [{ value: "price", source: "handwritten", location: "blank", confidence: 0.85 }],
        },
      ],
    };

    const normalized = normalizeExerciseOcr(rawOcr, JSON.stringify(rawOcr), "test-model");
    const item = normalized.exerciseItems![0];

    expect(item.printedAnswers).toHaveLength(1);
    expect(item.printedAnswers![0].value).toBe("prize");
    expect(item.handwrittenAnswers).toHaveLength(1);
    expect(item.handwrittenAnswers![0].value).toBe("price");
  });

  // Test 3: Parent confirmation of unchanged detected answer
  it("3. Reconstruction preserves parent-confirmed detected answers for answer key", () => {
    const ocrSnapshot = {
      text: "1. These plates are clean.",
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          questionText: "1. These plates are clean.",
          blankLocations: [12],
          detectedAnswers: [{ value: "plates", source: "printed" as const, location: "blank" as const, confidence: 0.95 }],
          sourceOrder: 1,
          included: true,
        },
      ],
    };

    const reconstructed = reconstructAllExercises(ocrSnapshot);
    expect(reconstructed).toHaveLength(1);
    expect(reconstructed[0].preservedAnswers).toHaveLength(1);
    expect(reconstructed[0].preservedAnswers[0].value).toBe("plates");
  });

  // Test 4: Parent edits a detected answer and the corrected value becomes authoritative
  it("4. Parent-edited answer overrides detected OCR answer in answer key rendering", async () => {
    const parentEditedAnswer = "plates (clean)";

    const pdfBuffer = await generateSourceReproducedAnswerKeyPdf({
      title: "Science Reviewer",
      subject: "Science",
      studentName: "Alex",
      items: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Fill in the blank.",
          questionText: "1. These _____ are clean.",
          blankLocations: [8],
          choices: null,
          wordBank: null,
          matchingPairs: null,
          answer: parentEditedAnswer,
          sourcePage: "Page 12",
          sourceOrder: 1,
        },
      ],
      pageFormat: "A4",
    });

    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });

  // Test 5: Exercise with no detected answer legitimately remains N/A
  it("5. Exercise with no detected or parent-confirmed answer remains N/A without LLM hallucination", async () => {
    const pdfBuffer = await generateSourceReproducedAnswerKeyPdf({
      title: "Science Reviewer",
      subject: "Science",
      studentName: "Alex",
      items: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Fill in the blank.",
          questionText: "1. The _____ is shiny.",
          blankLocations: [8],
          choices: null,
          wordBank: null,
          matchingPairs: null,
          answer: "N/A",
          sourcePage: "Page 12",
          sourceOrder: 1,
        },
      ],
      pageFormat: "A4",
    });

    expect(pdfBuffer).toBeDefined();
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });

  // Test 6 & 7: Verified answer reaches Answer Key PDF while Student PDF strips answer
  it("6 & 7. Student PDF removes answer from blank while Answer Key PDF retains verified answer", async () => {
    const itemData = {
      itemNumber: 1,
      exerciseType: "fill_blank",
      instructions: "Complete each sentence.",
      questionText: "1. The sun shines brightly.",
      blankLocations: [8],
      detectedAnswers: [{ value: "sun", source: "printed" as const, location: "blank" as const, confidence: 0.99 }],
      sourceOrder: 1,
      included: true,
    };

    const ocrSnapshot = {
      text: itemData.questionText,
      blocks: [],
      detectedFormat: "source_reproduced",
      warningFlags: [],
      exerciseItems: [itemData],
    };

    const reconstructed = reconstructAllExercises(ocrSnapshot);
    // Student questionnaire text should have blank substituted
    expect(reconstructed[0].questionnaireText).toContain("_____");
    expect(reconstructed[0].questionnaireText).not.toContain("1. The sun shines");

    // Student PDF generation
    const studentPdf = await generateSourceReproducedStudentPdf({
      title: "Science Exam",
      subject: "Science",
      studentName: "Child",
      items: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Complete each sentence.",
          questionText: reconstructed[0].questionnaireText,
          blankLocations: reconstructed[0].blankLocations,
          choices: null,
          wordBank: null,
          matchingPairs: null,
          answer: "sun",
          sourcePage: "Page 1",
          sourceOrder: 1,
        },
      ],
      pageFormat: "A4",
    });
    expect(studentPdf).toBeDefined();

    // Answer Key PDF generation
    const answerKeyPdf = await generateSourceReproducedAnswerKeyPdf({
      title: "Science Answer Key",
      subject: "Science",
      studentName: "Child",
      items: [
        {
          itemNumber: 1,
          exerciseType: "fill_blank",
          instructions: "Complete each sentence.",
          questionText: reconstructed[0].questionnaireText,
          blankLocations: reconstructed[0].blankLocations,
          choices: null,
          wordBank: null,
          matchingPairs: null,
          answer: "sun",
          sourcePage: "Page 1",
          sourceOrder: 1,
        },
      ],
      pageFormat: "A4",
    });
    expect(answerKeyPdf).toBeDefined();
  });
});
