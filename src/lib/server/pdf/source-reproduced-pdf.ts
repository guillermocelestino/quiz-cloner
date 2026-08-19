/**
 * Dedicated PDF Renderer for Source-Reproduced Exercises (server-only, pdfkit).
 *
 * Preserves the exact verified source exercise structure:
 * - Original item order (strictly by sourceOrder / itemNumber)
 * - Page and section instructions
 * - Exercise types (fill_blank, multiple_choice, word_bank, matching, true_false, identification, etc.)
 * - Exact wording and blank styles (_____, _ _ _, b _ _ _, [ ], [_____])
 * - Multiple choice choices (intact)
 * - Word bank items (intact)
 * - Matching pairs (intact)
 * - Student PDF: answers removed ONLY from answer-bearing locations
 * - Answer Key PDF: parent-verified answers from verified_exercise_answers
 */
import PDFDocument from "pdfkit";
import type { PageFormat } from "@/lib/types";

export interface SourceReproducedPdfItem {
  itemNumber: number;
  exerciseType: string;
  instructions?: string | null;
  questionText: string; // Answer-free student version
  blankLocations?: number[] | null;
  choices?: string[] | null;
  wordBank?: string[] | null;
  matchingPairs?: { left: string; right: string }[] | null;
  answer: string; // Parent-verified answer
  sourcePage?: string | null;
  sourceOrder: number;
}

export interface SourceReproducedPdfInput {
  title: string;
  subject: string;
  studentName?: string | null;
  items: SourceReproducedPdfItem[];
  pageFormat: PageFormat;
  pageInstructions?: string[];
  availableBank?: string[];
}

function docToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function makeDoc(pageFormat: PageFormat) {
  return new PDFDocument({
    size: pageFormat === "A4" ? "A4" : "LETTER",
    margins: { top: 64, bottom: 64, left: 64, right: 64 },
    info: { Title: "Source-Reproduced Reviewer", Author: "CloneQuizzAndReview" },
  });
}

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number, margin = 64) {
  if (doc.y + needed > doc.page.height - margin) {
    doc.addPage();
  }
}

/**
 * Render Student Worksheet PDF for Source-Reproduced Exercises.
 * Answers removed strictly from answer-bearing positions; original structure preserved.
 */
export async function generateSourceReproducedStudentPdf(
  input: SourceReproducedPdfInput
): Promise<Buffer> {
  const doc = makeDoc(input.pageFormat);
  const buf = docToBuffer(doc);

  // Header
  renderHeader(doc, input, false);

  // Render Page-level Instructions / Global Word Bank if available
  const hasItemInstructions = input.items.some((it) => it.instructions && it.instructions.trim());
  renderGlobalBanners(doc, hasItemInstructions ? undefined : input.pageInstructions, input.availableBank);

  // Sort items strictly by sourceOrder to preserve original textbook exercise order
  const sortedItems = [...input.items].sort((a, b) => a.sourceOrder - b.sourceOrder);

  // Track rendered instructions across section boundaries to render each section instruction once
  let lastRenderedInstruction: string | null = null;

  sortedItems.forEach((item) => {
    const rawInstr = item.instructions?.trim();
    if (rawInstr && rawInstr !== lastRenderedInstruction) {
      ensureSpace(doc, 40);
      doc
        .fontSize(12)
        .font("Helvetica-BoldOblique")
        .fillColor("#333333")
        .text(rawInstr, 64, doc.y, { width: doc.page.width - 128 });
      doc.moveDown(0.4);
      lastRenderedInstruction = rawInstr;
    }

    renderItem(doc, item, false);
  });

  doc.end();
  return buf;
}

/**
 * Render Answer Key PDF for Source-Reproduced Exercises.
 * Uses ONLY parent-verified answers from verified_exercise_answers table.
 */
export async function generateSourceReproducedAnswerKeyPdf(
  input: SourceReproducedPdfInput
): Promise<Buffer> {
  const doc = makeDoc(input.pageFormat);
  const buf = docToBuffer(doc);

  // Header
  renderHeader(doc, input, true);

  // Render Page-level Instructions / Global Word Bank if available
  const hasItemInstructions = input.items.some((it) => it.instructions && it.instructions.trim());
  renderGlobalBanners(doc, hasItemInstructions ? undefined : input.pageInstructions, input.availableBank);

  // Sort items strictly by sourceOrder to preserve original textbook exercise order
  const sortedItems = [...input.items].sort((a, b) => a.sourceOrder - b.sourceOrder);

  // Track rendered instructions across section boundaries to render each section instruction once
  let lastRenderedInstruction: string | null = null;

  sortedItems.forEach((item) => {
    const rawInstr = item.instructions?.trim();
    if (rawInstr && rawInstr !== lastRenderedInstruction) {
      ensureSpace(doc, 40);
      doc
        .fontSize(12)
        .font("Helvetica-BoldOblique")
        .fillColor("#333333")
        .text(rawInstr, 64, doc.y, { width: doc.page.width - 128 });
      doc.moveDown(0.4);
      lastRenderedInstruction = rawInstr;
    }

    renderItem(doc, item, true);
  });

  doc.end();
  return buf;
}

function renderHeader(
  doc: InstanceType<typeof PDFDocument>,
  input: SourceReproducedPdfInput,
  isAnswerKey: boolean
) {
  doc
    .fontSize(11)
    .fillColor("#888888")
    .font("Helvetica")
    .text(input.subject.toUpperCase(), { align: "center" });
  doc.moveUp();
  doc
    .fontSize(22)
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .text(isAnswerKey ? `${input.title} — Answer Key` : input.title, { align: "center" });
  doc.moveDown(0.5);
  doc
    .moveTo(64, doc.y)
    .lineTo(doc.page.width - 64, doc.y)
    .lineWidth(1)
    .strokeColor("#bbbbbb")
    .stroke();
  doc.moveDown(1);

  if (!isAnswerKey) {
    doc
      .fontSize(13)
      .fillColor("#000000")
      .font("Helvetica")
      .text(`Name: ${" ".repeat(54)}`, { continued: true })
      .text(`   Date: ${" ".repeat(16)}`);
    doc.moveDown(1.2);
  }
}

function renderGlobalBanners(
  doc: InstanceType<typeof PDFDocument>,
  pageInstructions?: string[],
  availableBank?: string[]
) {
  if (pageInstructions && pageInstructions.length > 0) {
    ensureSpace(doc, 40);
    doc
      .fontSize(13)
      .font("Helvetica-BoldOblique")
      .fillColor("#222222")
      .text(`Instructions: ${pageInstructions.join(" ")}`, { width: doc.page.width - 128 });
    doc.moveDown(0.6);
  }

  if (availableBank && availableBank.length > 0) {
    ensureSpace(doc, 50);
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("#111111")
      .text("Word Bank:");
    doc.moveDown(0.2);

    const bankStr = availableBank.join("    ");
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#333333")
      .text(`[  ${bankStr}  ]`, { width: doc.page.width - 128 });
    doc.moveDown(0.8);
  }
}

function renderItem(
  doc: InstanceType<typeof PDFDocument>,
  item: SourceReproducedPdfItem,
  isAnswerKey: boolean
) {
  const indent = 34;
  const startY = doc.y;
  const pageCite = item.sourcePage ? `  (p. ${item.sourcePage})` : "";

  ensureSpace(doc, 80);

  const currentY = doc.y;

  // Number label
  doc
    .fontSize(14)
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .text(`${item.itemNumber}.`, 64, currentY, { lineBreak: false, width: indent - 8 });

  const questionWidth = doc.page.width - 64 - (64 + indent);

  if (item.exerciseType === "multiple_choice" && item.choices && item.choices.length > 0) {
    // Multiple Choice
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#000000")
      .text(item.questionText, 64 + indent, currentY, { width: questionWidth });
    doc.moveDown(0.3);

    let anyMatched = false;
    item.choices.forEach((choice, i) => {
      ensureSpace(doc, 24);
      const letter = String.fromCharCode(65 + i);
      const cleanAns = item.answer.trim().toLowerCase();
      const cleanChoice = choice.trim().toLowerCase();
      const isCorrect = isAnswerKey && (
        cleanChoice === cleanAns ||
        cleanChoice.includes(cleanAns) ||
        (cleanAns.length > 2 && cleanAns.includes(cleanChoice)) ||
        (cleanAns.length === 1 && letter.toLowerCase() === cleanAns) ||
        cleanAns.startsWith(letter.toLowerCase() + ".") ||
        cleanAns.startsWith(letter.toLowerCase() + ")") ||
        cleanAns.startsWith(letter.toLowerCase() + " ")
      );
      if (isCorrect) anyMatched = true;

      if (isAnswerKey) {
        doc
          .fontSize(12)
          .font(isCorrect ? "Helvetica-Bold" : "Helvetica")
          .fillColor(isCorrect ? "#0a7d24" : "#000000")
          .text(
            `${letter}. ${choice}${isCorrect ? `   \u2713 (Answer: ${item.answer})${pageCite}` : ""}`,
            64 + indent,
            doc.y
          );
      } else {
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#000000")
          .text(`${letter}. ${choice}`, 64 + indent, doc.y);
      }
    });
    if (isAnswerKey && !anyMatched) {
      ensureSpace(doc, 24);
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`Answer: ${item.answer}${pageCite}`, 64 + indent, doc.y);
    }
    doc.moveDown(0.6);
  } else if (item.exerciseType === "word_bank") {
    // Word Bank Exercise
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#000000")
      .text(item.questionText, 64 + indent, currentY, { width: questionWidth });
    doc.moveDown(0.3);

    if (item.wordBank && item.wordBank.length > 0) {
      ensureSpace(doc, 30);
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor("#444444")
        .text(`Word Bank: [ ${item.wordBank.join("   ")} ]`, 64 + indent, doc.y);
      doc.moveDown(0.3);
    }

    if (isAnswerKey) {
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`Answer: ${item.answer}${pageCite}`, 64 + indent, doc.y);
    }
    doc.moveDown(0.6);
  } else if (item.exerciseType === "matching" && item.matchingPairs && item.matchingPairs.length > 0) {
    // Matching Exercise
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#000000")
      .text(item.questionText, 64 + indent, currentY, { width: questionWidth });
    doc.moveDown(0.4);

    item.matchingPairs.forEach((pair, idx) => {
      ensureSpace(doc, 24);
      const leftText = `${idx + 1}. ${pair.left}`;
      const rightText = `(___)  ${pair.right}`;

      if (isAnswerKey) {
        doc
          .fontSize(12)
          .font("Helvetica-Bold")
          .fillColor("#0a7d24")
          .text(`${leftText}   --->   ${pair.right}${pageCite}`, 64 + indent, doc.y);
      } else {
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#000000")
          .text(`${leftText}${" ".repeat(20)}${rightText}`, 64 + indent, doc.y);
      }
    });
    doc.moveDown(0.6);
  } else if (item.exerciseType === "true_false") {
    // True / False Exercise
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#000000")
      .text(item.questionText, 64 + indent, currentY, {
        width: questionWidth,
        continued: true,
      });

    if (isAnswerKey) {
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`    Answer: ${item.answer}${pageCite}`);
    } else {
      doc
        .fontSize(12)
        .font("Helvetica")
        .fillColor("#555555")
        .text(`      ( Circle:  True  /  False )`);
    }
    doc.fillColor("#000000");
    doc.moveDown(0.6);
  } else {
    // Fill Blank / Identification / General
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#000000")
      .text(item.questionText, 64 + indent, currentY, { width: questionWidth });

    if (isAnswerKey) {
      doc.moveDown(0.2);
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`Answer: ${item.answer}${pageCite}`, 64 + indent, doc.y);
    }
    doc.moveDown(0.6);
  }
}
