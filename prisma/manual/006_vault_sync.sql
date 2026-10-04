-- Release Tracker: the Config Vault becomes the single source of truth for
-- services, per-environment images and published ports.
--
-- Saving a docker-compose.yml (or the .env it reads ${VAR}s from) in the vault
-- now syncs that environment + role into the catalog (lib/composeSync.ts):
--   - ServicePort rows carry the vault file + version they came from, so a
--     re-sync replaces its own rows instead of duplicating them. Rows with no
--     source file are legacy manual imports; the first sync of an environment
--     replaces them for the services in that compose file.
--   - ServiceDeployment holds the image/tag per service + environment.
--   - ConfigFile records which version was last applied and why the latest
--     one was not (invalid YAML, no services).
--
-- Run once in the Supabase SQL editor, BEFORE deploying the code that uses
-- it. Safe to run again. Then press "Resync from vault" on the Infrastructure
-- page once to backfill the files already in the vault.

BEGIN;

ALTER TABLE "ServicePort" ADD COLUMN IF NOT EXISTS "sourceFileId" TEXT;
ALTER TABLE "ServicePort" ADD COLUMN IF NOT EXISTS "sourceVersionId" TEXT;
CREATE INDEX IF NOT EXISTS "ServicePort_sourceFileId_idx" ON "ServicePort"("sourceFileId");

ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncedVersion" INTEGER;
ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);
ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

CREATE TABLE IF NOT EXISTS "ServiceDeployment" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "composeKey" TEXT NOT NULL,
    "containerName" TEXT,
    "image" TEXT,
    "tag" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDeployment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceDeployment_serviceId_environment_key"
    ON "ServiceDeployment"("serviceId", "environment");
CREATE INDEX IF NOT EXISTS "ServiceDeployment_environment_role_idx"
    ON "ServiceDeployment"("environment", "role");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServicePort_sourceFileId_fkey') THEN
        ALTER TABLE "ServicePort" ADD CONSTRAINT "ServicePort_sourceFileId_fkey"
            FOREIGN KEY ("sourceFileId") REFERENCES "ConfigFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServicePort_sourceVersionId_fkey') THEN
        ALTER TABLE "ServicePort" ADD CONSTRAINT "ServicePort_sourceVersionId_fkey"
            FOREIGN KEY ("sourceVersionId") REFERENCES "ConfigFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_serviceId_fkey') THEN
        ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_serviceId_fkey"
            FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_sourceFileId_fkey') THEN
        ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_sourceFileId_fkey"
            FOREIGN KEY ("sourceFileId") REFERENCES "ConfigFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_sourceVersionId_fkey') THEN
        ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_sourceVersionId_fkey"
            FOREIGN KEY ("sourceVersionId") REFERENCES "ConfigFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

ALTER TABLE "ServiceDeployment" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Check: expect the new table with RLS on and the three new ConfigFile columns.
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'ServiceDeployment';
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'ConfigFile' AND column_name IN ('syncedVersion', 'syncedAt', 'syncError') ORDER BY 1;
