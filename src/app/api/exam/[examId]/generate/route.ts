import { NextResponse, type NextRequest } from "next/server";
import { getExamPrep, getLatestSnapshot, getSnapshotContents, createExam, addQuestions, updateExam } from "@/lib/server/db/queries";
import { generateGrade1Reviewer } from "@/lib/server/ai/gemini-reviewer";
import { sanitizeOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    const { examId } = await params;
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { questionTypes = ["phonics_mc", "fill_blank"] } = body;

    // 1. Fetch verified OCR records for this exam prep from DB
    const examPrep = await getExamPrep(examId);
    if (!examPrep) {
      return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
    }

    const snapshot = await getLatestSnapshot(examId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Verify the pages before generating a reviewer." },
        { status: 400 }
      );
    }

    const snapshotItems = await getSnapshotContents(snapshot.id);
    const verifiedSnapshots = snapshotItems.map((item) => ({
      pageLabel: item.pageLabel,
      factKind: item.content.factKind,
      itemNumber: item.content.itemNumber,
      sentence: item.content.sentence || item.content.content,
      blankToken: item.content.blankToken,
      availableBank: item.content.wordBank,
      pictureCue: item.content.pictureCue,
      proposedAnswer: item.content.proposedAnswer,
      content: item.content.content,
      included: item.content.included,
    }));

    // 2. Run Gemini Single-Pass Reviewer Generation
    const reviewerData = await generateGrade1Reviewer(verifiedSnapshots, questionTypes);

    // 3. Save into DB (exams & questions)
    const exam = await createExam({
      examPrepId: examId,
      snapshotId: snapshot.id,
      version: 1,
      config: { questionTypes, questionCount: 10 } as any,
      promptVersion: "gemini-3.6-flash-v1",
      generationModel: "gemini-3.6-flash",
      ocrModel: "gemini-3.6-flash",
    });

    const flattenedQuestions: any[] = [];
    if (reviewerData.sections && Array.isArray(reviewerData.sections)) {
      for (const sec of reviewerData.sections) {
        if (sec.questions && Array.isArray(sec.questions)) {
          for (const q of sec.questions) {
            flattenedQuestions.push({
              type: sec.formatType || "multiple_choice",
              question: q.promptText,
              answer: q.correctAnswer,
              choices: (q.options || []).map((opt: string) => sanitizeOption(opt)),
              sourceFactId: `gemini_q_${q.itemNumber}`,
              difficulty: "easy",
              validation: { valid: true, explanation: q.parentExplanation },
            });
          }
        }
      }
    }

    if (flattenedQuestions.length > 0) {
      await addQuestions(exam.id, flattenedQuestions);
      await updateExam(exam.id, { status: "completed", completedAt: new Date() });
    }

    return NextResponse.json({
      success: true,
      reviewer: {
        examId: exam.id,
        unitTopic: reviewerData.unitTopic,
        sections: reviewerData.sections,
        sourceInstruction: reviewerData.sourceInstruction,
        availableBank: reviewerData.availableBank,
      },
    });
  } catch (err: any) {
    console.error("[gemini-generate] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate reviewer using Gemini." },
      { status: 500 }
    );
  }
}
