-- Add API key scopes and expiry metadata
ALTER TABLE "ApiKey"
ADD COLUMN "scopes" JSONB,
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "ApiKey"
SET
  "scopes" = '["employees:read","attendance:read","leaves:read","payroll:read"]'::jsonb,
  "expiresAt" = NOW() + INTERVAL '365 days'
WHERE "scopes" IS NULL;

ALTER TABLE "ApiKey"
ALTER COLUMN "scopes" SET NOT NULL;
