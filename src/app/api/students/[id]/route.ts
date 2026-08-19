import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { eq, inArray } from "drizzle-orm";
import { examPreps, pages, students } from "@/db/schema";
import { deleteFile } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Delete a student and all related data (cascade) + remove their stored images.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const preps = await db
    .select({ id: examPreps.id })
    .from(examPreps)
    .where(eq(examPreps.studentId, id));
  const prepIds = preps.map((p) => p.id);

  if (prepIds.length) {
    const pageRows = await db
      .select({ key: pages.storageKey })
      .from(pages)
      .where(inArray(pages.examPrepId, prepIds));
    await Promise.all(pageRows.map((p) => deleteFile(p.key)));
  }

  // Cascade removes exam preps, pages, snapshots, exams, questions, assets.
  await db.delete(students).where(eq(students.id, id));
  return NextResponse.json({ ok: true });
}
