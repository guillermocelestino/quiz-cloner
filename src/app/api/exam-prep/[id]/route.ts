import { NextResponse, type NextRequest } from "next/server";
import {
  getExamPrep,
  getLatestSnapshot,
  listExamsForExamPrep,
  listPages,
} from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) {
    return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
  }
  const [pages, snapshot, exams] = await Promise.all([
    listPages(id),
    getLatestSnapshot(id),
    listExamsForExamPrep(id),
  ]);

  const verifiedCount = pages.filter((p) => p.status === "ready").length;
  return NextResponse.json({
    examPrep: detail.examPrep,
    studentName: detail.studentName,
    studentGrade: detail.studentGrade,
    pages,
    hasSnapshot: !!snapshot,
    snapshotVersion: snapshot?.version ?? null,
    exams,
    verifiedCount,
  });
}
