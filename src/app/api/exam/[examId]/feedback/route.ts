import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getExam, logQuestionFeedback } from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  questionId: z.string().min(1),
  action: z.enum(["delete", "edit"]),
  details: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    const { examId } = await params;
    if (!examId) {
      return NextResponse.json({ error: "examId is required" }, { status: 400 });
    }

    const exam = await getExam(examId);
    if (!exam) {
      return NextResponse.json({ error: "Exam not found." }, { status: 404 });
    }

    const body = await req.json();
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload shape", details: parsed.error.format() },
        { status: 400 }
      );
    }

    await logQuestionFeedback({
      examId,
      questionId: parsed.data.questionId,
      action: parsed.data.action,
      details: parsed.data.details,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to log feedback:", error);
    return NextResponse.json(
      { error: "Failed to record question feedback" },
      { status: 500 }
    );
  }
}
