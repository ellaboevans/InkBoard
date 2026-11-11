CREATE TYPE "public"."poem_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."poem_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "editors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"pen_name" text,
	"slug" text,
	"bio" text,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"requested_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"body" text NOT NULL,
	"visibility" "poem_visibility" DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"password_version" integer DEFAULT 0 NOT NULL,
	"status" "poem_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poems_private_requires_password" CHECK ("poems"."visibility" = 'public' OR "poems"."password_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poems" ADD CONSTRAINT "poems_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "editors_email_key" ON "editors" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "editors_slug_key" ON "editors" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "email_otps_email_created_idx" ON "email_otps" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poems_editor_slug_key" ON "poems" USING btree ("editor_id","slug");--> statement-breakpoint
CREATE INDEX "poems_editor_idx" ON "poems" USING btree ("editor_id");--> statement-breakpoint
CREATE INDEX "poems_status_published_idx" ON "poems" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_editor_idx" ON "sessions" USING btree ("editor_id");