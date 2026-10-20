-- Release Tracker: feature/fix-to-build mapping for the patch planner.
--
-- Additive only: two new tables, no change to any existing table or row.
--   "Change"       one feature / fix / change identifier (e.g. JIRA-123).
--   "ChangeBuild"  a manual statement that a build (role + service + version)
--                  introduced or contains that change, with its evidence and
--                  whether it has been verified.
-- Release-record notes that name a change key are read on the fly
-- (lib/changeMap.ts) and are never copied here, so the audit log stays the
-- one source for what was released.
--
-- Run once in the Supabase SQL editor, BEFORE deploying the code that uses
-- it. Safe to run again. Until it is run, the planner works without change
-- mapping and the Changes API answers 503 with this file's name.
--
-- Recovery: nothing else references these tables, so
--   DROP TABLE "ChangeBuild"; DROP TABLE "Change";
-- removes the feature without touching other data.

BEGIN;

CREATE TABLE IF NOT EXISTS "Change" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fix',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Change_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Change_key_key" ON "Change"("key");

CREATE TABLE IF NOT EXISTS "ChangeBuild" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'introduced',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "ChangeBuild_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChangeBuild_changeId_role_service_version_key"
    ON "ChangeBuild"("changeId", "role", "service", "version");
CREATE INDEX IF NOT EXISTS "ChangeBuild_role_service_idx" ON "ChangeBuild"("role", "service");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChangeBuild_changeId_fkey') THEN
        ALTER TABLE "ChangeBuild" ADD CONSTRAINT "ChangeBuild_changeId_fkey"
            FOREIGN KEY ("changeId") REFERENCES "Change"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Reachable only through the API (same as every other table).
ALTER TABLE "Change" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChangeBuild" ENABLE ROW LEVEL SECURITY;

COMMIT;
