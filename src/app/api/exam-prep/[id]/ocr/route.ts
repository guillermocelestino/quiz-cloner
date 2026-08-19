import { NextResponse, type NextRequest, after } from "next/server";
import { getExamPrep, listPages } from "@/lib/server/db/queries";
import { runOcrForExamPrep } from "@/lib/server/workers";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) {
    return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
  }
  const pages = await listPages(id);
  if (pages.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one textbook page first." },
      { status: 400 }
    );
  }

  // Keep background task alive after response using Next.js 16 after()
  after(async () => {
    try {
      await runOcrForExamPrep(id);
    } catch (err) {
      console.error("[ocr] background failure", err);
    }
  });

  return NextResponse.json({ started: true });
}
