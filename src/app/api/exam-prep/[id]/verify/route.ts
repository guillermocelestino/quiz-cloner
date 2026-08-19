import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  addVerifiedContents,
  addVerifiedExercises,
  addVerifiedExerciseAnswers,
  createSnapshot,
  getExamPrep,
  updateExamPrep,
} from "@/lib/server/db/queries";

export const dynamic = "force-dynamic";

// Generated Mode Schema
const itemSchema = z.object({
  pageId: z.string().min(1),
  content: z.string(),
  included: z.boolean(),
});
const generatedBodySchema = z.object({ contents: z.array(itemSchema).min(1) });

// Source-Reproduced Mode Schema
const exerciseItemSchema = z.object({
  pageId: z.string().nullable().optional(),
  itemNumber: z.number().int(),
  exerciseType: z.string(),
  instructions: z.string().nullable().optional(),
  questionText: z.string(),
  blankLocations: z.array(z.number()).nullable().optional(),
  choices: z.array(z.string()).nullable().optional(),
  wordBank: z.array(z.string()).nullable().optional(),
  matchingPairs: z.array(z.object({ left: z.string(), right: z.string() })).nullable().optional(),
  detectedAnswers: z.array(z.unknown()).nullable().optional(),
  handwrittenAnswers: z.array(z.unknown()).nullable().optional(),
  printedAnswers: z.array(z.unknown()).nullable().optional(),
  answerMarkers: z.array(z.string()).nullable().optional(),
  confidence: z.number().nullable().optional(),
  pageLabel: z.string().nullable().optional(),
  sourceOrder: z.number().int(),
  included: z.boolean(),
  parentConfirmed: z.boolean().default(true),
  answer: z.string().optional(),
});
const sourceReproducedBodySchema = z.object({
  exercises: z.array(exerciseItemSchema).min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getExamPrep(id);
  if (!detail) {
    return NextResponse.json({ error: "Exam prep not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  // Branch on Generation Mode
  if (detail.examPrep.generationMode === "source_reproduced") {
    const parsed = sourceReproducedBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid verification data for source-reproduced exercises." },
        { status: 422 }
      );
    }

    const included = parsed.data.exercises.filter(
      (ex) => ex.included && ex.questionText.trim().length > 0
    );

    if (included.length === 0) {
      return NextResponse.json(
        { error: "Include at least one valid exercise to continue." },
        { status: 400 }
      );
    }

    const snapshot = await createSnapshot(id);

    // Save to verified_exercises (IMMUTABLE source exercises with parentConfirmed: true)
    const insertedExercises = await addVerifiedExercises(
      snapshot.id,
      parsed.data.exercises.map((ex, i) => ({
        pageId: ex.pageId ?? null,
        itemNumber: ex.itemNumber,
        exerciseType: ex.exerciseType,
        instructions: ex.instructions ?? null,
        questionText: ex.questionText,
        blankLocations: ex.blankLocations ?? null,
        choices: ex.choices ?? null,
        wordBank: ex.wordBank ?? null,
        matchingPairs: ex.matchingPairs ?? null,
        detectedAnswers: ex.detectedAnswers ?? null,
        handwrittenAnswers: ex.handwrittenAnswers ?? null,
        printedAnswers: ex.printedAnswers ?? null,
        answerMarkers: ex.answerMarkers ?? null,
        confidence: ex.confidence ?? 1.0,
        pageLabel: ex.pageLabel ?? null,
        sourceOrder: i + 1,
        included: ex.included && ex.questionText.trim().length > 0,
        parentConfirmed: true, // Immutability boundary established!
      }))
    );

    // Save to verified_exercise_answers (Authoritative answer key submitted/confirmed by parent)
    const answerKeyItems = insertedExercises
      .map((inserted, i) => {
        const rawEx = parsed.data.exercises[i];
        const resolvedAnswer = rawEx.answer?.trim() || "N/A";
        return {
          verifiedExerciseId: inserted.id,
          itemNumber: inserted.itemNumber,
          exerciseType: inserted.exerciseType,
          answer: resolvedAnswer,
          sourcePage: inserted.pageLabel,
        };
      })
      .filter((a) => a.answer.trim().length > 0);

    if (answerKeyItems.length > 0) {
      await addVerifiedExerciseAnswers(snapshot.id, answerKeyItems);
    }

    await updateExamPrep(id, { status: "ready" });

    return NextResponse.json({ snapshotId: snapshot.id, version: snapshot.version });
  }

  // Generated Mode (UNCHANGED)
  const parsed = generatedBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid verification data." }, { status: 422 });
  }

  const included = parsed.data.contents.filter(
    (c) => c.included && c.content.trim().length > 0
  );
  if (included.length === 0) {
    return NextResponse.json(
      { error: "Include at least one page with content to continue." },
      { status: 400 }
    );
  }

  const snapshot = await createSnapshot(id);
  await addVerifiedContents(
    snapshot.id,
    parsed.data.contents.map((c, i) => ({
      pageId: c.pageId,
      content: c.content,
      sourceOrder: i,
      included: c.included && c.content.trim().length > 0,
    }))
  );
  await updateExamPrep(id, { status: "ready" });

  return NextResponse.json({ snapshotId: snapshot.id, version: snapshot.version });
}
