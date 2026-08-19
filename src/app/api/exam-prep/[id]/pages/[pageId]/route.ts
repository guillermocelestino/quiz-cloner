import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reorderPages, softDeletePage, updatePage } from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  pageLabel: z.string().max(40).optional().nullable(),
  order: z.array(z.string()).optional(),
});

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { pageId } = await params;
  await softDeletePage(pageId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 422 });
  }

  if (parsed.data.order) {
    await reorderPages(id, parsed.data.order);
  }
  if (parsed.data.pageLabel !== undefined) {
    await updatePage(pageId, { pageLabel: parsed.data.pageLabel });
  }
  return NextResponse.json({ ok: true });
}

// Replace a page's image (re-take) without changing order.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { pageId } = await params;
  const form = await req.formData();
  const file = form.getAll("files").find((f): f is File => f instanceof File);
  if (!file) {
    return NextResponse.json({ error: "No image received." }, { status: 400 });
  }
  const { analyzeAndOptimize } = await import("@/lib/server/image-quality");
  const { saveUpload } = await import("@/lib/server/storage");
  const { updatePageStorage } = await import("@/lib/server/db/queries");

  const bytes = Buffer.from(await file.arrayBuffer());
  const analysis = await analyzeAndOptimize(bytes, file.type);
  if (!analysis.ok) {
    return NextResponse.json(
      { error: analysis.errorReason ?? "Could not read image." },
      { status: 400 }
    );
  }
  const { key } = await saveUpload(analysis.optimizedBuffer, "jpg");
  await updatePageStorage(pageId, key, analysis);
  return NextResponse.json({ ok: true });
}


