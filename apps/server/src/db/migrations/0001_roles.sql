-- Append-only audit log and least-privilege roles (plan step 4).
-- Roles are NOLOGIN group roles; the deploy (step 12) creates login users that
-- are members of them. Every later migration that adds a table must grant it here too.

-- 1. audit_log is append-only for everyone, owner and superuser included.
CREATE FUNCTION "audit_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_append_only"();
--> statement-breakpoint

-- 2. Roles (cluster-wide, so create only if missing).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cane_app') THEN
    CREATE ROLE "cane_app" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cane_readonly') THEN
    CREATE ROLE "cane_readonly" NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

-- 3. cane_app: the running server. Full DML except on audit_log (SELECT + INSERT only).
GRANT USAGE ON SCHEMA public TO "cane_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "owner", "sessions", "recovery_codes", "settings", "strategies", "signals",
  "jev_calls", "positions", "orders", "trades", "notifications", "candles"
  TO "cane_app";
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO "cane_app";
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "cane_app";
--> statement-breakpoint

-- 4. cane_readonly: replay CLI and daily replay-diff (step 13). SELECT on trading
-- records and market data only; no auth tables, no settings (encrypted secrets).
GRANT USAGE ON SCHEMA public TO "cane_readonly";
--> statement-breakpoint
GRANT SELECT ON
  "strategies", "signals", "jev_calls", "positions", "orders", "trades", "candles"
  TO "cane_readonly";
