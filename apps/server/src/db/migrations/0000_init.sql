CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"market" text NOT NULL,
	"pair" text NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" bigint NOT NULL,
	"close_time" bigint NOT NULL,
	"open" numeric NOT NULL,
	"high" numeric NOT NULL,
	"low" numeric NOT NULL,
	"close" numeric NOT NULL,
	"volume" numeric NOT NULL,
	CONSTRAINT "candles_pk" PRIMARY KEY("market","pair","timeframe","open_time"),
	CONSTRAINT "candles_market" CHECK ("candles"."market" in ('spot', 'futures')),
	CONSTRAINT "candles_timeframe" CHECK ("candles"."timeframe" in ('4h', '1d', '1w')),
	CONSTRAINT "candles_times" CHECK ("candles"."close_time" > "candles"."open_time")
);
--> statement-breakpoint
CREATE TABLE "jev_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"signal_id" bigint,
	"side" text NOT NULL,
	"timeframe" text NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"error" text,
	"latency_ms" integer,
	"fallback" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jev_calls_side" CHECK ("jev_calls"."side" in ('long', 'short')),
	CONSTRAINT "jev_calls_timeframe" CHECK ("jev_calls"."timeframe" in ('4h', '1d', '1w'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_channel" CHECK ("notifications"."channel" in ('line', 'telegram')),
	CONSTRAINT "notifications_status" CHECK ("notifications"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"signal_id" bigint,
	"position_id" bigint,
	"client_order_id" text NOT NULL,
	"exchange_order_id" text,
	"market" text NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"type" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"qty" numeric NOT NULL,
	"price" numeric,
	"stop_price" numeric,
	"filled_qty" numeric DEFAULT '0' NOT NULL,
	"avg_fill_price" numeric,
	"reduce_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_client_order_id_format" CHECK ("orders"."client_order_id" ~ '^[.A-Z:/a-z0-9_-]{1,36}$'),
	CONSTRAINT "orders_market" CHECK ("orders"."market" in ('spot', 'futures')),
	CONSTRAINT "orders_side" CHECK ("orders"."side" in ('BUY', 'SELL')),
	CONSTRAINT "orders_purpose" CHECK ("orders"."purpose" in ('entry', 'stop', 'take_profit', 'exit', 'kill_switch', 'reconcile')),
	CONSTRAINT "orders_qty_positive" CHECK ("orders"."qty" > 0),
	CONSTRAINT "orders_filled_qty" CHECK ("orders"."filled_qty" >= 0 and "orders"."filled_qty" <= "orders"."qty")
);
--> statement-breakpoint
CREATE TABLE "owner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea",
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_single_row" CHECK ("owner"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"market" text NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"entry_kind" text NOT NULL,
	"signal_timeframe" text NOT NULL,
	"signal_candle_open_time" bigint NOT NULL,
	"qty" numeric NOT NULL,
	"entry_price" numeric NOT NULL,
	"stop_price" numeric NOT NULL,
	"take_profit_price" numeric,
	"leverage" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_market" CHECK ("positions"."market" in ('spot', 'futures')),
	CONSTRAINT "positions_side" CHECK ("positions"."side" in ('long', 'short')),
	CONSTRAINT "positions_status" CHECK ("positions"."status" in ('open', 'closed')),
	CONSTRAINT "positions_entry_kind" CHECK ("positions"."entry_kind" in ('primary', 'late', 'flip')),
	CONSTRAINT "positions_signal_timeframe" CHECK ("positions"."signal_timeframe" in ('4h', '1d', '1w')),
	CONSTRAINT "positions_spot_long_only" CHECK ("positions"."market" = 'futures' or "positions"."side" = 'long'),
	CONSTRAINT "positions_qty_positive" CHECK ("positions"."qty" > 0),
	CONSTRAINT "positions_closed_at" CHECK (("positions"."status" = 'closed') = ("positions"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"device" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"value_enc" "bytea",
	"hint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_one_value" CHECK (("settings"."value" is null) <> ("settings"."value_enc" is null))
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"timeframe" text NOT NULL,
	"candle_open_time" bigint NOT NULL,
	"decision" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_timeframe" CHECK ("signals"."timeframe" in ('4h', '1d', '1w'))
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"market" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"attention_reason" text,
	"leverage" integer,
	"sizing_mode" text DEFAULT 'B' NOT NULL,
	"margin_mode" text,
	"base_pct" numeric DEFAULT '10' NOT NULL,
	"confidence_threshold" numeric DEFAULT '0.70' NOT NULL,
	"risk_pct" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_id_format" CHECK ("strategies"."id" ~ '^S-[0-9]{2,}$'),
	CONSTRAINT "strategies_pair_usdt" CHECK ("strategies"."pair" ~ '^[A-Z0-9]+USDT$'),
	CONSTRAINT "strategies_market" CHECK ("strategies"."market" in ('spot', 'futures')),
	CONSTRAINT "strategies_status" CHECK ("strategies"."status" in ('disabled', 'enabled', 'needs_attention', 'closed')),
	CONSTRAINT "strategies_sizing_mode" CHECK ("strategies"."sizing_mode" in ('A', 'B', 'C')),
	CONSTRAINT "strategies_margin_mode" CHECK ("strategies"."margin_mode" in ('isolated', 'cross')),
	CONSTRAINT "strategies_futures_fields" CHECK (("strategies"."market" = 'futures' and "strategies"."leverage" between 1 and 20 and "strategies"."margin_mode" is not null)
        or ("strategies"."market" = 'spot' and "strategies"."leverage" is null and "strategies"."margin_mode" is null and "strategies"."sizing_mode" = 'B')),
	CONSTRAINT "strategies_base_pct" CHECK ("strategies"."base_pct" between 5 and 20),
	CONSTRAINT "strategies_confidence" CHECK ("strategies"."confidence_threshold" between 0 and 1),
	CONSTRAINT "strategies_risk_pct" CHECK (("strategies"."sizing_mode" = 'C') = ("strategies"."risk_pct" is not null) and ("strategies"."risk_pct" is null or "strategies"."risk_pct" > 0))
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"position_id" bigint NOT NULL,
	"strategy_id" text NOT NULL,
	"jev_call_id" bigint,
	"market" text NOT NULL,
	"pair" text NOT NULL,
	"side" text NOT NULL,
	"entry_kind" text NOT NULL,
	"signal_timeframe" text NOT NULL,
	"trend_1w" text,
	"qty" numeric NOT NULL,
	"entry_price" numeric NOT NULL,
	"exit_price" numeric NOT NULL,
	"exit_reason" text NOT NULL,
	"sizing_mode" text NOT NULL,
	"size_pct" numeric NOT NULL,
	"leverage_configured" integer,
	"leverage_used" integer,
	"jev_fallback" boolean DEFAULT false NOT NULL,
	"gross_pnl" numeric NOT NULL,
	"fees" numeric NOT NULL,
	"funding" numeric DEFAULT '0' NOT NULL,
	"net_pnl" numeric NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trades_market" CHECK ("trades"."market" in ('spot', 'futures')),
	CONSTRAINT "trades_side" CHECK ("trades"."side" in ('long', 'short')),
	CONSTRAINT "trades_entry_kind" CHECK ("trades"."entry_kind" in ('primary', 'late', 'flip')),
	CONSTRAINT "trades_signal_timeframe" CHECK ("trades"."signal_timeframe" in ('4h', '1d', '1w')),
	CONSTRAINT "trades_exit_reason" CHECK ("trades"."exit_reason" in ('first_red', 'first_green', 'stop', 'take_profit', 'kill_switch', 'manual', 'liquidated')),
	CONSTRAINT "trades_sizing_mode" CHECK ("trades"."sizing_mode" in ('A', 'B', 'C'))
);
--> statement-breakpoint
ALTER TABLE "jev_calls" ADD CONSTRAINT "jev_calls_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jev_calls" ADD CONSTRAINT "jev_calls_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_jev_call_id_jev_calls_id_fk" FOREIGN KEY ("jev_call_id") REFERENCES "public"."jev_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("status") WHERE "notifications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_order_id_uq" ON "orders" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "orders_strategy_idx" ON "orders" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_one_open_per_strategy" ON "positions" USING btree ("strategy_id") WHERE "positions"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_idempotency_uq" ON "signals" USING btree ("strategy_id","timeframe","candle_open_time");--> statement-breakpoint
CREATE UNIQUE INDEX "strategies_one_active_per_pair" ON "strategies" USING btree ("pair") WHERE "strategies"."status" in ('enabled', 'needs_attention');--> statement-breakpoint
CREATE UNIQUE INDEX "trades_position_uq" ON "trades" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "trades_closed_at_idx" ON "trades" USING btree ("closed_at");