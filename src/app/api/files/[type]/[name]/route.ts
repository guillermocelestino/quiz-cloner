import { NextResponse, type NextRequest } from "next/server";
import { mimeFromKey, readBytes } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Access-controlled file serving. Files live outside /public.
// Reconstructs storage key as "<type>/<name>" (e.g. uploads/abc.jpg).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; name: string }> }
) {
  const { type, name } = await params;
  const joined = `${type}/${name}`;
  try {
    const bytes = await readBytes(joined);
    return new NextResponse(bytes as never, {
      headers: {
        "Content-Type": mimeFromKey(joined),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
