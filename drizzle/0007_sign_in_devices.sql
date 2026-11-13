CREATE TABLE "sign_in_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sign_in_devices" ADD CONSTRAINT "sign_in_devices_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_devices_editor_device_key" ON "sign_in_devices" USING btree ("editor_id","device_key");