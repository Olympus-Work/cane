-- Reverts 0001_roles.sql.
DROP TRIGGER "audit_log_no_truncate" ON "audit_log";
DROP TRIGGER "audit_log_no_update_delete" ON "audit_log";
DROP FUNCTION "audit_log_append_only"();
REVOKE USAGE ON SCHEMA public FROM "cane_app";
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  "owner", "sessions", "recovery_codes", "settings", "strategies", "signals",
  "jev_calls", "positions", "orders", "trades", "notifications", "candles"
  FROM "cane_app";
REVOKE SELECT, INSERT ON "audit_log" FROM "cane_app";
REVOKE USAGE ON ALL SEQUENCES IN SCHEMA public FROM "cane_app";
REVOKE USAGE ON SCHEMA public FROM "cane_readonly";
REVOKE SELECT ON
  "strategies", "signals", "jev_calls", "positions", "orders", "trades", "candles"
  FROM "cane_readonly";
DROP ROLE IF EXISTS "cane_readonly";
DROP ROLE IF EXISTS "cane_app";
