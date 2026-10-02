-- Release Tracker: config vault (docker-compose and env files per
-- environment + role, with full version history).
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Files are stored as uploaded, including any plaintext secrets. Row-level
-- security is on with no policies, so the public anon key cannot read them;
-- only the API (Prisma, table owner) can, and the API requires login.

BEGIN;

CREATE TABLE IF NOT EXISTS "ConfigFile" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfigFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConfigFileVersion" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfigFileVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConfigFile_environment_role_path_key"
    ON "ConfigFile"("environment", "role", "path");
CREATE UNIQUE INDEX IF NOT EXISTS "ConfigFileVersion_fileId_version_key"
    ON "ConfigFileVersion"("fileId", "version");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConfigFileVersion_fileId_fkey') THEN
        ALTER TABLE "ConfigFileVersion" ADD CONSTRAINT "ConfigFileVersion_fileId_fkey"
            FOREIGN KEY ("fileId") REFERENCES "ConfigFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

ALTER TABLE "ConfigFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConfigFileVersion" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Check: both tables exist with RLS on.
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('ConfigFile', 'ConfigFileVersion') ORDER BY 1;
