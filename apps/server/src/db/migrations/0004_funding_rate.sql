CREATE TABLE "funding_rate" (
	"symbol" text NOT NULL,
	"funding_time" bigint NOT NULL,
	"rate" numeric NOT NULL,
	"mark_price" numeric,
	"interval_hours" integer NOT NULL,
	CONSTRAINT "funding_rate_pk" PRIMARY KEY("symbol","funding_time"),
	CONSTRAINT "funding_rate_symbol" CHECK ("funding_rate"."symbol" ~ '^[A-Z0-9]{2,20}$'),
	CONSTRAINT "funding_rate_interval" CHECK ("funding_rate"."interval_hours" in (1, 2, 4, 8))
);
--> statement-breakpoint
-- Grants (0001_roles: every migration that adds a table grants it). cane_readonly reads it for the F02 backtest.
GRANT SELECT, INSERT, UPDATE, DELETE ON "funding_rate" TO "cane_app";
--> statement-breakpoint
GRANT SELECT ON "funding_rate" TO "cane_readonly";
