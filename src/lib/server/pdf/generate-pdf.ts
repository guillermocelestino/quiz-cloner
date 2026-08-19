/**
 * PDF generation (server-only, pdfkit).
 *
 * The printed reviewer is a real school worksheet: black/white friendly,
 * large text, generous writing space.
 * Part A renders a deterministic Study Reviewer (vocabulary & core reading facts).
 * Part B renders the Practice Quiz.
 * Answer Key PDF appends source page citations in parentheses e.g. (p. 94).
 */
import PDFDocument from "pdfkit";
import {
  QUESTION_TYPE_LABELS,
  type PageFormat,
  type QuestionType,
  sanitizeOption,
  isCorrectAnswer,
} from "@/lib/types";
import type { PartAContent } from "./part-a";

export type PdfQuestion = {
  type: QuestionType;
  question: string;
  answer: string;
  choices?: string[];
  sourcePage?: string | null;
  sourceFactId?: string;
};

export type PdfInput = {
  title: string;
  subject: string;
  studentName?: string | null;
  questions: PdfQuestion[];
  pageFormat: PageFormat;
  partA?: PartAContent;
};


const SECTION_ORDER: QuestionType[] = [
  "fill_blank",
  "first_letter_fill",
  "true_false",
  "tf_exact",
  "tf_swap",
  "reverse_id",
  "multiple_choice",
  "blend_mc",
  "word_family_mc",
  "identification",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const SECTION_TITLES: Record<QuestionType, string> = {
  blend_mc: "Multiple Choice (Blend)",
  fill_blank: "Fill in the Blank",
  tf_exact: "True or False",
  tf_swap: "True or False",
  reverse_id: "Identification",
  multiple_choice: "Multiple Choice",
  true_false: "True or False",
  identification: "Identification",
  word_family_mc: "Multiple Choice (Word Family)",
  first_letter_fill: "Fill in the Blank (First Letter)",
};

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
    info: { Title: "Reviewer", Author: "CloneQuizzAndReview" },
  });
}

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number, margin = 64) {
  if (doc.y + needed > doc.page.height - margin) {
    doc.addPage();
  }
}

function groupedByType(questions: PdfQuestion[]): { type: QuestionType; items: PdfQuestion[] }[] {
  const groups: { type: QuestionType; items: PdfQuestion[] }[] = [];
  for (const type of SECTION_ORDER) {
    const items = questions.filter((q) => q.type === type);
    if (items.length) groups.push({ type, items });
  }
  for (const q of questions) {
    if (!SECTION_ORDER.includes(q.type) && !groups.find((g) => g.type === q.type)) {
      groups.push({ type: q.type, items: questions.filter((x) => x.type === q.type) });
    }
  }
  return groups;
}

let globalNumber = 0;

export async function generateReviewerPdf(input: PdfInput): Promise<Buffer> {
  const doc = makeDoc(input.pageFormat);
  const buf = docToBuffer(doc);

  // Header
  doc
    .fontSize(11)
    .fillColor("#888888")
    .font("Helvetica")
    .text(input.subject.toUpperCase(), { align: "center" });
  doc.moveUp();
  doc
    .fontSize(24)
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .text(input.title, { align: "center" });
  doc.moveDown(0.5);
  doc
    .moveTo(64, doc.y)
    .lineTo(doc.page.width - 64, doc.y)
    .lineWidth(1)
    .strokeColor("#bbbbbb")
    .stroke();
  doc.moveDown(1);

  // Name / Date lines
  doc
    .fontSize(14)
    .fillColor("#000000")
    .font("Helvetica")
    .text(`Name: ${" ".repeat(54)}`, { continued: true })
    .text(`   Date: ${" ".repeat(16)}`);
  doc.moveDown(1.5);

  // Part A — Study Reviewer
  if (
    input.partA &&
    (input.partA.wordsToPractice.length > 0 ||
      input.partA.sentencesToRemember.length > 0)
  ) {
    ensureSpace(doc, 120);
    doc
      .fontSize(16)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text("PART A — STUDY REVIEWER");
    doc.moveDown(0.5);

    if (input.partA.wordsToPractice.length > 0) {
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor("#111111")
        .text("Words to Practice:");
      doc.moveDown(0.3);

      const wordsStr = input.partA.wordsToPractice
        .map((w) => `• ${w}`)
        .join("     ");
      doc
        .fontSize(12)
        .font("Helvetica")
        .fillColor("#222222")
        .text(wordsStr, { width: doc.page.width - 128, lineGap: 4 });
      doc.moveDown(0.8);
    }

    if (input.partA.sentencesToRemember.length > 0) {
      doc
        .fontSize(13)
        .font("Helvetica-Bold")
        .fillColor("#111111")
        .text("Sentences to Remember:");
      doc.moveDown(0.3);

      input.partA.sentencesToRemember.forEach((sentence) => {
        ensureSpace(doc, 24);
        doc
          .fontSize(12)
          .font("Helvetica")
          .fillColor("#222222")
          .text(`• ${sentence}`, { width: doc.page.width - 128, lineGap: 3 });
        doc.moveDown(0.2);
      });
      doc.moveDown(0.8);
    }

    // Separator line between Part A and Part B
    doc
      .moveTo(64, doc.y)
      .lineTo(doc.page.width - 64, doc.y)
      .lineWidth(0.75)
      .strokeColor("#cccccc")
      .stroke();
    doc.moveDown(1.2);

    ensureSpace(doc, 60);
    doc
      .fontSize(16)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text("PART B — PRACTICE QUIZ");
    doc.moveDown(0.6);
  }

  globalNumber = 0;
  const groups = groupedByType(input.questions);
  groups.forEach((group, gi) => {
    ensureSpace(doc, 60);
    doc
      .fontSize(15)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text(`${ROMAN[gi]}. ${SECTION_TITLES[group.type]}`);
    doc.moveDown(0.6);
    group.items.forEach((q) => writeQuestion(doc, q, false));
    doc.moveDown(1);
  });

  doc.end();
  return buf;
}

export async function generateAnswerKeyPdf(input: PdfInput): Promise<Buffer> {
  const doc = makeDoc(input.pageFormat);
  const buf = docToBuffer(doc);

  doc
    .fontSize(11)
    .fillColor("#888888")
    .font("Helvetica")
    .text(input.subject.toUpperCase(), { align: "center" });
  doc.moveUp();
  doc
    .fontSize(24)
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .text(`${input.title} — Answer Key`, { align: "center" });
  doc.moveDown(0.5);
  doc
    .moveTo(64, doc.y)
    .lineTo(doc.page.width - 64, doc.y)
    .lineWidth(1)
    .strokeColor("#bbbbbb")
    .stroke();
  doc.moveDown(1.5);

  globalNumber = 0;
  const groups = groupedByType(input.questions);
  groups.forEach((group, gi) => {
    ensureSpace(doc, 50);
    doc
      .fontSize(14)
      .fillColor("#000000")
      .font("Helvetica-Bold")
      .text(`${ROMAN[gi]}. ${SECTION_TITLES[group.type]}`);
    doc.moveDown(0.5);
    group.items.forEach((q) => writeQuestion(doc, q, true));
    doc.moveDown(0.8);
  });

  doc.end();
  return buf;
}

function writeQuestion(
  doc: InstanceType<typeof PDFDocument>,
  q: PdfQuestion,
  isAnswerKey: boolean
) {
  globalNumber += 1;
  const n = globalNumber;
  const startY = doc.y;
  const indent = 34;
  const numberLabel = `${n}.`;

  ensureSpace(doc, 80);

  doc
    .fontSize(15)
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .text(numberLabel, 64, startY, { lineBreak: false, width: indent - 8 });

  const pageCite = q.sourcePage ? `  (p. ${q.sourcePage})` : "";

  if ((q.type === "multiple_choice" || q.type === "blend_mc" || q.type === "word_family_mc" || (q.type as string) === "phonics_mc") && q.choices) {
    doc
      .font("Helvetica")
      .text(q.question, 64 + indent, startY, { width: doc.page.width - 64 - (64 + indent) });
    doc.moveDown(0.3);
    q.choices.forEach((choice, i) => {
      ensureSpace(doc, 28);
      const letter = String.fromCharCode(65 + i);
      const cleanChoice = sanitizeOption(choice);
      if (isAnswerKey) {
        const correct = isCorrectAnswer(choice, q.answer);
        doc
          .font(correct ? "Helvetica-Bold" : "Helvetica")
          .fillColor(correct ? "#0a7d24" : "#000000")
          .text(
            `${letter}. ${cleanChoice}${correct ? `   \u2713${pageCite}` : ""}`,
            64 + indent,
            doc.y
          );
      } else {
        doc
          .font("Helvetica")
          .fillColor("#000000")
          .text(`${letter}. ${cleanChoice}`, 64 + indent, doc.y);
      }
    });
    doc.moveDown(0.5);
  } else if (q.type === "true_false" || q.type === "tf_exact" || q.type === "tf_swap") {
    doc
      .font("Helvetica")
      .fillColor("#000000")
      .text(q.question, 64 + indent, startY, {
        width: doc.page.width - 64 - (64 + indent),
        continued: true,
      });
    if (isAnswerKey) {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`    Answer: ${q.answer}${pageCite}`);
    } else {
      doc
        .font("Helvetica")
        .fillColor("#555555")
        .text(`      ( Circle:  True  /  False )`);
    }
    doc.fillColor("#000000");
    doc.moveDown(0.6);
  } else if (q.type === "fill_blank") {
    doc
      .font("Helvetica")
      .fillColor("#000000")
      .text(q.question, 64 + indent, startY, {
        width: doc.page.width - 64 - (64 + indent),
      });
    if (isAnswerKey) {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`Answer: ${q.answer}${pageCite}`, 64 + indent, doc.y);
    } else {
      doc.moveDown(0.8);
    }
    doc.fillColor("#000000");
    doc.moveDown(0.4);
  } else {
    // identification / reverse_id
    doc
      .font("Helvetica")
      .fillColor("#000000")
      .text(q.question, 64 + indent, startY, {
        width: doc.page.width - 64 - (64 + indent),
      });
    if (isAnswerKey) {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0a7d24")
        .text(`Answer: ${q.answer}${pageCite}`, 64 + indent, doc.y);
    } else {
      doc
        .moveDown(0.3)
        .moveTo(64 + indent, doc.y)
        .lineTo(doc.page.width - 64, doc.y)
        .lineWidth(0.75)
        .strokeColor("#999999")
        .stroke();
    }
    doc.fillColor("#000000");
    doc.moveDown(0.5);
  }
}

export function reviewerTitle(subject: string): string {
  const s = subject.trim();
  return s ? `${s} Reviewer` : "Reviewer";
}

export { QUESTION_TYPE_LABELS };
