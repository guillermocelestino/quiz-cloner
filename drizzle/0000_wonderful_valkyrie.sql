CREATE TABLE "exam_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"kind" text NOT NULL,
	"page_format" text DEFAULT 'A4' NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_preps" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"subject" text NOT NULL,
	"grade_level" integer DEFAULT 1 NOT NULL,
	"exam_date" date,
	"teacher_instructions" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_prep_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb,
	"status" text DEFAULT 'generating' NOT NULL,
	"prompt_version" text,
	"generation_model" text,
	"ocr_model" text,
	"stats" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ocr_results" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"raw_response" jsonb,
	"normalized" jsonb,
	"text" text,
	"confidence" real,
	"warning_flags" jsonb DEFAULT '[]'::jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_prep_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text NOT NULL,
	"page_label" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"type" text NOT NULL,
	"question" text NOT NULL,
	"choices" jsonb,
	"answer" text NOT NULL,
	"source_page" text,
	"source_fact_id" text NOT NULL,
	"difficulty" text,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"grade_level" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"page_id" text,
	"content" text NOT NULL,
	"source_order" integer NOT NULL,
	"included" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_prep_id" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_assets" ADD CONSTRAINT "exam_assets_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_preps" ADD CONSTRAINT "exam_preps_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_prep_id_exam_preps_id_fk" FOREIGN KEY ("exam_prep_id") REFERENCES "public"."exam_preps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_snapshot_id_verified_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."verified_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_exam_prep_id_exam_preps_id_fk" FOREIGN KEY ("exam_prep_id") REFERENCES "public"."exam_preps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD CONSTRAINT "verified_contents_snapshot_id_verified_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."verified_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_contents" ADD CONSTRAINT "verified_contents_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_snapshots" ADD CONSTRAINT "verified_snapshots_exam_prep_id_exam_preps_id_fk" FOREIGN KEY ("exam_prep_id") REFERENCES "public"."exam_preps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_assets_exam_idx" ON "exam_assets" USING btree ("exam_id","kind");--> statement-breakpoint
CREATE INDEX "exam_preps_student_idx" ON "exam_preps" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "exam_preps_status_idx" ON "exam_preps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "exams_exam_prep_idx" ON "exams" USING btree ("exam_prep_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ocr_results_page_idx" ON "ocr_results" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "pages_exam_prep_idx" ON "pages" USING btree ("exam_prep_id","order_index");--> statement-breakpoint
CREATE INDEX "pages_deleted_at_idx" ON "pages" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "questions_exam_idx" ON "questions" USING btree ("exam_id","order_index");--> statement-breakpoint
CREATE INDEX "students_created_at_idx" ON "students" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verified_contents_snapshot_idx" ON "verified_contents" USING btree ("snapshot_id","source_order");--> statement-breakpoint
CREATE INDEX "verified_snapshots_exam_prep_idx" ON "verified_snapshots" USING btree ("exam_prep_id");