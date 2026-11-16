CREATE TABLE "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"editor_id" uuid NOT NULL,
	"poem_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "poems" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_poem_id_poems_id_fk" FOREIGN KEY ("poem_id") REFERENCES "public"."poems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_subscription_sent_idx" ON "push_deliveries" USING btree ("subscription_id","sent_at");--> statement-breakpoint
CREATE INDEX "push_deliveries_editor_idx" ON "push_deliveries" USING btree ("editor_id");--> statement-breakpoint
CREATE INDEX "push_deliveries_poem_idx" ON "push_deliveries" USING btree ("poem_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");