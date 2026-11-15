CREATE TABLE "poem_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poem_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"language" text,
	"saved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poem_revisions" ADD CONSTRAINT "poem_revisions_poem_id_poems_id_fk" FOREIGN KEY ("poem_id") REFERENCES "public"."poems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poem_revisions_poem_saved_idx" ON "poem_revisions" USING btree ("poem_id","saved_at" DESC NULLS LAST);