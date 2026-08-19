CREATE TABLE "question_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"question_id" text,
	"action" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "fact_kind" text DEFAULT 'DeclarativeFact' NOT NULL;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "item_number" integer;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "sentence" text;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "blank_token" text;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "word_bank" jsonb;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "picture_cue" text;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "proposed_answer" text;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD COLUMN "parent_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_feedback_exam_idx" ON "question_feedback" USING btree ("exam_id");