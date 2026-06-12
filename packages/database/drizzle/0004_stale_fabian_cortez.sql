CREATE TABLE IF NOT EXISTS "generated_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"generation_run_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"reply_mode" text NOT NULL,
	"subject" text NOT NULL,
	"body_text_encrypted" text NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rules_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commitments_made" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correlation_key" text,
	"status" text DEFAULT 'preview' NOT NULL,
	"provider_draft_id" text,
	"provider_draft_message_id" text,
	"sent_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"context_snapshot_id" uuid,
	"prompt_version" text,
	"model_id" text,
	"status" text NOT NULL,
	"error_kind" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_drafts" ADD CONSTRAINT "generated_drafts_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_context_snapshot_id_context_snapshots_id_fk" FOREIGN KEY ("context_snapshot_id") REFERENCES "public"."context_snapshots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
