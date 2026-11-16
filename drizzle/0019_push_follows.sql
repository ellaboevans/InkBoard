CREATE TABLE "push_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "kind" text DEFAULT 'alert' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_follows" ADD CONSTRAINT "push_follows_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_follows" ADD CONSTRAINT "push_follows_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_follows_subscription_editor_key" ON "push_follows" USING btree ("subscription_id","editor_id");--> statement-breakpoint
CREATE INDEX "push_follows_editor_idx" ON "push_follows" USING btree ("editor_id");--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_kind_check" CHECK ("push_deliveries"."kind" IN ('alert', 'update'));--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_mode_check" CHECK ("push_subscriptions"."mode" IN ('all', 'followed'));