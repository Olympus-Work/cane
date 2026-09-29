-- Reverts 0003_owner_totp_last_step.sql.
ALTER TABLE "owner" DROP COLUMN "totp_last_step";
