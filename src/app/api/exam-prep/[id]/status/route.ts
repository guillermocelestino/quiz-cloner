import { NextResponse, type NextRequest } from "next/server";
import { getLatestSnapshot, listExamsForExamPrep, listPages } from "@/lib/server/db/queries";
import { isDemoMode } from "@/lib/server/workers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [pages, snapshot, exams] = await Promise.all([
    listPages(id),
    getLatestSnapshot(id),
    listExamsForExamPrep(id),
  ]);

  return NextResponse.json({
    status: pages.length ? "has_pages" : "empty",
    pages: pages.map((p) => ({
      id: p.id,
      orderIndex: p.orderIndex,
      pageLabel: p.pageLabel,
      status: p.status,
      qualityFlags: p.qualityFlags ?? [],
      storageKey: p.storageKey,
    })),
    hasSnapshot: !!snapshot,
    snapshotVersion: snapshot?.version ?? null,
    exams: exams.map((e) => ({
      id: e.id,
      version: e.version,
      status: e.status,
      createdAt: e.createdAt,
    })),
    demo: isDemoMode(),
  });
}
