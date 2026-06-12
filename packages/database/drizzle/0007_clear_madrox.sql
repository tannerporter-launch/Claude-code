CREATE TABLE IF NOT EXISTS "comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"mechanical" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"semantic" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_edit_distance_milli" integer NOT NULL,
	"context_bucket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparisons_pair_unique" UNIQUE("pair_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"comparison_id" uuid NOT NULL,
	"supports" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rule_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_type" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"proposed_text" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_value" text,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_milli" integer NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"evidence_count" integer NOT NULL,
	"contradiction_count" integer DEFAULT 0 NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resulting_rule_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_pair_id_draft_sent_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."draft_sent_pairs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_proposal_id_rule_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."rule_proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_comparison_id_comparisons_id_fk" FOREIGN KEY ("comparison_id") REFERENCES "public"."comparisons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_proposals" ADD CONSTRAINT "rule_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
