import { NextResponse, type NextRequest } from "next/server";
import { getOcrResultsForExamPrep } from "@/lib/server/db/queries";
import { isDemoMode } from "@/lib/server/workers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await getOcrResultsForExamPrep(id);

  const pages = rows.map((r) => ({
    pageId: r.page.id,
    orderIndex: r.page.orderIndex,
    pageLabel: r.page.pageLabel,
    storageKey: r.page.storageKey,
    status: r.page.status,
    hasOcr: !!r.ocr,
    text: r.ocr?.text ?? "",
    confidence: r.ocr?.confidence ?? null,
    warningFlags: (r.ocr?.warningFlags as string[]) ?? [],
    model: r.ocr?.model ?? null,
  }));

  return NextResponse.json({ pages, demo: isDemoMode() });
}
