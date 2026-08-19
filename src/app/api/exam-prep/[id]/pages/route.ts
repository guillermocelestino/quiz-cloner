import { NextResponse, type NextRequest } from "next/server";
import {
  createPage,
  getExamPrep,
  listPages,
  nextPageOrder,
} from "@/lib/server/db/queries";
import { analyzeAndOptimize, QUALITY_LABELS } from "@/lib/server/image-quality";
import { extFromMime, saveUpload } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const MAX_FILES = 8;
const MAX_BYTES = 18 * 1024 * 1024; // 18MB per file
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pages = await listPages(id);
  return NextResponse.json({ pages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) {
    return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json(
      { error: "No images were received. Please choose at least one photo." },
      { status: 400 }
    );
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `You can upload at most ${MAX_FILES} pages at once.` },
      { status: 400 }
    );
  }

  const created = [];
  const errors = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      errors.push({ name: file.name, error: "This photo is too large (over 18MB)." });
      continue;
    }
    if (file.type && !ALLOWED.has(file.type) && !file.type.startsWith("image/")) {
      errors.push({ name: file.name, error: "Unsupported file type. Use JPG or PNG." });
      continue;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const analysis = await analyzeAndOptimize(bytes, file.type);

    if (!analysis.ok) {
      errors.push({ name: file.name, error: analysis.errorReason ?? "Could not read image." });
      continue;
    }

    const { key } = await saveUpload(analysis.optimizedBuffer, "jpg");
    const orderIndex = await nextPageOrder(id);
    const page = await createPage({
      examPrepId: id,
      orderIndex,
      storageKey: key,
      originalFilename: file.name || null,
      mimeType: analysis.optimizedMime,
      qualityFlags: analysis.qualityFlags,
      width: analysis.width ?? null,
      height: analysis.height ?? null,
      sizeBytes: analysis.sizeBytes,
    });
    created.push(page);
  }

  const pages = await listPages(id);
  return NextResponse.json(
    {
      pages,
      created: created.length,
      errors: errors.map((e) => ({ ...e, label: e.error })),
      warnings: created.flatMap((p) =>
        (p.qualityFlags ?? []).map((f) => QUALITY_LABELS[f] ?? f)
      ),
    },
    { status: created.length ? 201 : 400 }
  );
}
