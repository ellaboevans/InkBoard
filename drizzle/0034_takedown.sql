ALTER TABLE "editors" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "hidden_at" timestamp with time zone;