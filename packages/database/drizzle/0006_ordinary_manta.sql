CREATE TABLE IF NOT EXISTS "draft_sent_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sent_message_id" uuid NOT NULL,
	"generated_draft_id" uuid NOT NULL,
	"confidence_milli" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_sent_pairs_sent_unique" UNIQUE("sent_message_id"),
	CONSTRAINT "draft_sent_pairs_draft_unique" UNIQUE("generated_draft_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pairing_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sent_message_id" uuid NOT NULL,
	"generated_draft_id" uuid NOT NULL,
	"score_milli" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "correlation_key_header" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_sent_pairs" ADD CONSTRAINT "draft_sent_pairs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_sent_pairs" ADD CONSTRAINT "draft_sent_pairs_sent_message_id_email_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draft_sent_pairs" ADD CONSTRAINT "draft_sent_pairs_generated_draft_id_generated_drafts_id_fk" FOREIGN KEY ("generated_draft_id") REFERENCES "public"."generated_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pairing_candidates" ADD CONSTRAINT "pairing_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pairing_candidates" ADD CONSTRAINT "pairing_candidates_sent_message_id_email_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."email_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pairing_candidates" ADD CONSTRAINT "pairing_candidates_generated_draft_id_generated_drafts_id_fk" FOREIGN KEY ("generated_draft_id") REFERENCES "public"."generated_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
