-- Reverts 0005_strategies_base_pct_40.sql. Fails if a strategy has base_pct above 20; lower it first.
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_base_pct";
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_base_pct" CHECK ("strategies"."base_pct" between 5 and 20);
