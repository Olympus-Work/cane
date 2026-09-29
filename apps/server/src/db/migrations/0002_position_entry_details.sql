ALTER TABLE "positions" ADD COLUMN "leverage_ceiling" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "size_pct" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "trend_1w" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "jev_call_id" bigint;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "jev_fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_jev_call_id_jev_calls_id_fk" FOREIGN KEY ("jev_call_id") REFERENCES "public"."jev_calls"("id") ON DELETE no action ON UPDATE no action;