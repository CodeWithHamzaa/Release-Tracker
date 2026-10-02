-- Release Tracker: health reports (ALARA toolkit output uploaded from the
-- servers: .snapshot files, `alara_server.sh status` and `doctor` output).
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Snapshots contain no plaintext secrets (the toolkit stores only SHA256
-- hashes of sensitive values). Row-level security is on with no policies:
-- only the API (Prisma, table owner) reads it, and the API requires login.

BEGIN;

CREATE TABLE IF NOT EXISTS "HealthReport" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,
    "host" TEXT,
    "parsed" JSONB NOT NULL,
    "raw" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HealthReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HealthReport_environment_role_kind_reportedAt_idx"
    ON "HealthReport"("environment", "role", "kind", "reportedAt");

ALTER TABLE "HealthReport" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Check: expect the table with RLS on.
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'HealthReport';
