-- Reverts 0002_position_entry_details.sql.
ALTER TABLE "positions" DROP CONSTRAINT "positions_jev_call_id_jev_calls_id_fk";
ALTER TABLE "positions" DROP COLUMN "jev_fallback";
ALTER TABLE "positions" DROP COLUMN "jev_call_id";
ALTER TABLE "positions" DROP COLUMN "trend_1w";
ALTER TABLE "positions" DROP COLUMN "size_pct";
ALTER TABLE "positions" DROP COLUMN "leverage_ceiling";
