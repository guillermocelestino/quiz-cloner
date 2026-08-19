import { NextResponse, type NextRequest, after } from "next/server";
import { reviewerConfigSchema } from "@/lib/types";
import { getExamPrep, getLatestSnapshot } from "@/lib/server/db/queries";
import { generateReviewerForExamPrep } from "@/lib/server/workers";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) {
    return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
  }
  const snapshot = await getLatestSnapshot(id);
  if (!snapshot) {
    return NextResponse.json(
      { error: "Verify the pages before generating a reviewer." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = reviewerConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid configuration." },
      { status: 422 }
    );
  }

  after(async () => {
    try {
      await generateReviewerForExamPrep(id, parsed.data);
    } catch (err) {
      console.error("[generate] background failure", err);
    }
  });

  return NextResponse.json({ started: true });
}
