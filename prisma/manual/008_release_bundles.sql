-- Release Tracker: release bundles (one release event, many services).
--
-- Additive only:
--   "Release"                 new table: title, environment, date, the
--                             bundle's own status, config-change flag,
--                             promotion link and undo state.
--   "ReleaseRecord"."releaseId"  new nullable column linking a service record
--                             to its bundle. Existing rows keep NULL and show
--                             as one-service bundles; nothing is rewritten.
-- The PLANNED status needs no schema change (status is text).
--
-- Run once in the Supabase SQL editor, BEFORE deploying the code that uses
-- it. Safe to run again. Until it is run, GET /api/releases answers 503 with
-- this file's name and the feed falls back to one row per record.
--
-- Recovery:
--   ALTER TABLE "ReleaseRecord" DROP COLUMN "releaseId";
--   DROP TABLE "Release";
-- (dropping the column first keeps the service records; dropping the table
-- alone would fail on the foreign key).

BEGIN;

CREATE TABLE IF NOT EXISTS "Release" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "hasConfigChange" BOOLEAN NOT NULL DEFAULT false,
    "configDetails" TEXT,
    "note" TEXT,
    "promotedFromId" TEXT,
    "undoState" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Release_environment_releasedAt_idx" ON "Release"("environment", "releasedAt");
CREATE INDEX IF NOT EXISTS "Release_promotedFromId_idx" ON "Release"("promotedFromId");

ALTER TABLE "ReleaseRecord" ADD COLUMN IF NOT EXISTS "releaseId" TEXT;
CREATE INDEX IF NOT EXISTS "ReleaseRecord_releaseId_idx" ON "ReleaseRecord"("releaseId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Release_promotedFromId_fkey') THEN
    ALTER TABLE "Release" ADD CONSTRAINT "Release_promotedFromId_fkey"
      FOREIGN KEY ("promotedFromId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReleaseRecord_releaseId_fkey') THEN
    ALTER TABLE "ReleaseRecord" ADD CONSTRAINT "ReleaseRecord_releaseId_fkey"
      FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Like the other tables: reachable only through the API.
ALTER TABLE "Release" ENABLE ROW LEVEL SECURITY;

COMMIT;
