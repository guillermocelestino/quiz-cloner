import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createStudent, listStudents } from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  gradeLevel: z.number().int().min(1).max(3).default(1),
});

export async function GET() {
  const students = await listStudents();
  return NextResponse.json({ students });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 422 }
    );
  }
  const student = await createStudent(parsed.data);
  return NextResponse.json({ student }, { status: 201 });
}
