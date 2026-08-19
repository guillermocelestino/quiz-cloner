import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createExamPrep, getStudent } from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  studentId: z.string().min(1),
  subject: z.string().trim().min(1).max(80),
  gradeLevel: z.number().int().min(1).max(3).default(1),
  examDate: z.string().optional().nullable(),
  teacherInstructions: z.string().max(2000).optional().nullable(),
  generationMode: z.enum(["generated", "source_reproduced"]).default("generated"),
});

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

  const student = await getStudent(parsed.data.studentId);
  if (!student) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const examPrep = await createExamPrep({
    studentId: parsed.data.studentId,
    subject: parsed.data.subject,
    gradeLevel: parsed.data.gradeLevel,
    examDate: parsed.data.examDate ?? null,
    teacherInstructions: parsed.data.teacherInstructions ?? null,
    generationMode: parsed.data.generationMode,
  });

  return NextResponse.json({ examPrep }, { status: 201 });
}
