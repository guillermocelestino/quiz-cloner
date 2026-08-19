-- Migration 0002: Source-Reproduced Exercise Mode
-- Adds generationMode to exam_preps and new tables for source-reproduced pipeline

-- 1. Add generationMode to exam_preps
ALTER TABLE "exam_preps" ADD COLUMN "generation_mode" text DEFAULT 'generated' NOT NULL;
--> statement-breakpoint
ALTER TABLE "exam_preps" ADD CONSTRAINT "exam_preps_generation_mode_check" CHECK ("generation_mode" IN ('generated', 'source_reproduced'));

-- 2. source_reproduced_ocr_results - stores raw OCR output for exercise images
CREATE TABLE "source_reproduced_ocr_results" (
  "id" text PRIMARY KEY NOT NULL,
  "page_id" text NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "raw_response" jsonb NOT NULL,
  "normalized" jsonb NOT NULL,
  "text" text NOT NULL,
  "warning_flags" jsonb DEFAULT '[]'::jsonb,
  "model" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "source_reproduced_ocr_results_page_idx" ON "source_reproduced_ocr_results" USING btree ("page_id");

-- 3. verified_exercises - parent-verified source exercises (IMMUTABLE/AUTHORITATIVE)
-- Contains the full exercise structure WITH answers as verified by parent
CREATE TABLE "verified_exercises" (
  "id" text PRIMARY KEY NOT NULL,
  "snapshot_id" text NOT NULL REFERENCES "verified_snapshots"("id") ON DELETE CASCADE,
  "page_id" text REFERENCES "pages"("id") ON DELETE SET NULL,
  "item_number" integer NOT NULL,
  "exercise_type" text NOT NULL,
  "instructions" text,
  "question_text" text NOT NULL,
  "blank_locations" integer[],
  "choices" jsonb,
  "word_bank" jsonb,
  "matching_pairs" jsonb,
  "detected_answers" jsonb,
  "handwritten_answers" jsonb,
  "printed_answers" jsonb,
  "answer_markers" jsonb,
  "confidence" real,
  "page_label" text,
  "source_order" integer NOT NULL,
  "included" boolean DEFAULT true NOT NULL,
  "parent_confirmed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verified_exercises_snapshot_idx" ON "verified_exercises" USING btree ("snapshot_id", "source_order");

-- 4. verified_exercise_answers - answer key derived from verified source answers
-- Separate table so answers are not mixed with student-facing questionnaire
CREATE TABLE "verified_exercise_answers" (
  "id" text PRIMARY KEY NOT NULL,
  "verified_exercise_id" text NOT NULL REFERENCES "verified_exercises"("id") ON DELETE CASCADE,
  "item_number" integer NOT NULL,
  "exercise_type" text NOT NULL,
  "answer" text NOT NULL,
  "source_page" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verified_exercise_answers_exercise_idx" ON "verified_exercise_answers" USING btree ("verified_exercise_id");

-- 5. Add source_exercise_item_id to questions for traceability (source_reproduced mode only)
ALTER TABLE "questions" ADD COLUMN "source_exercise_item_id" text;