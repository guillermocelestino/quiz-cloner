import { NextResponse, type NextRequest } from "next/server";
import { buildExamPdf } from "@/lib/server/pdf/serve";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  const { examId } = await params;
  try {
    const { buffer } = await buildExamPdf(examId, "answer");
    return new NextResponse(buffer as never, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="answer-key.pdf"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "PDF failed." },
      { status: 500 }
    );
  }
}
