ALTER TABLE "novels" ADD COLUMN "visibility" "poem_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "password_version" integer DEFAULT 0 NOT NULL;