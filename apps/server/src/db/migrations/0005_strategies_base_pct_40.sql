ALTER TABLE "strategies" DROP CONSTRAINT "strategies_base_pct";--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_base_pct" CHECK ("strategies"."base_pct" between 5 and 40);