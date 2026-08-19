import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { pages } from "@/db/schema";
import { deleteFile } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Application-level "clear all data" (single-user workspace reset).
export async function DELETE(_req: NextRequest) {
  const pageRows = await db.select({ key: pages.storageKey }).from(pages);
  await Promise.all(pageRows.map((p) => deleteFile(p.key)));

  await db.execute(
    sql`TRUNCATE TABLE
      students, exam_preps, pages, ocr_results, verified_snapshots,
      verified_contents, exams, questions, exam_assets, jobs
      RESTART IDENTITY CASCADE`
  );

  return NextResponse.json({ ok: true });
}
