-- Release Tracker: service catalog tables + row-level security for login.
--
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Safe to run again: every statement is idempotent.
--
-- What it does:
--   1. Creates "Service" and "ServicePort" (matches prisma/schema.prisma).
--   2. Seeds the 23 services from config/services.json.
--   3. Turns on row-level security:
--      - "Service" / "ServicePort": no policies, so the public anon key can't
--        touch them. The API reaches them through Prisma, which connects as
--        the table owner and is not subject to RLS.
--      - "ReleaseRecord": signed-in users may SELECT (needed for realtime
--        updates); the anon key can no longer read or write it directly.

BEGIN;

-- 1. Tables -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Service" (
    "id" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ServicePort" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "hostPort" INTEGER NOT NULL,
    "containerPort" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "hostIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServicePort_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Service_server_name_key" ON "Service"("server", "name");
CREATE INDEX IF NOT EXISTS "ServicePort_serviceId_idx" ON "ServicePort"("serviceId");
CREATE UNIQUE INDEX IF NOT EXISTS "ServicePort_environment_host_hostPort_protocol_key"
    ON "ServicePort"("environment", "host", "hostPort", "protocol");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServicePort_serviceId_fkey') THEN
        ALTER TABLE "ServicePort" ADD CONSTRAINT "ServicePort_serviceId_fkey"
            FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- 2. Seed the catalog from config/services.json ----------------------------------

INSERT INTO "Service" ("id", "server", "name", "updatedAt")
SELECT gen_random_uuid()::text, v.server, v.name, CURRENT_TIMESTAMP
FROM (VALUES
  ('Bot-Builder', 'ldap-connector'),
  ('Bot-Builder', 'rbac-service'),
  ('Bot-Builder', 'nginx'),
  ('Bot-Builder', 'media-service'),
  ('Bot-Builder', 'omni-channel-nodejs'),
  ('Bot-Builder', 'single-intent'),
  ('Bot-Builder', 'alara-ui'),
  ('Bot-Builder', 'mcpherson-ui'),
  ('Bot-Builder', 'bot_builder_fbl_service'),
  ('Bot-Builder', 'elasticsearch'),
  ('Bot-Builder', 'elastic-search-service'),
  ('Bot-Builder', 'minio'),
  ('ChatBot / NLU', 'retriever_api_service'),
  ('ChatBot / NLU', 'common-service'),
  ('ChatBot / NLU', 'litellm-service'),
  ('ChatBot / NLU', 'litellm-db'),
  ('Database', 'redis-db'),
  ('Database', 'mongo-db'),
  ('Database', 'kafka'),
  ('Database', 'qdrant'),
  ('Database', 'mysql-db'),
  ('Chat-Service', 'chat-service'),
  ('Chat-Service', 'chat-service-worker')
) AS v(server, name)
ON CONFLICT ("server", "name") DO NOTHING;

-- 3. Row-level security -----------------------------------------------------------

ALTER TABLE "Service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServicePort" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReleaseRecord" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can read release records" ON "ReleaseRecord";
CREATE POLICY "Signed-in users can read release records"
    ON "ReleaseRecord" FOR SELECT TO authenticated USING (true);

COMMIT;

-- Check: expect 23 services (more if you already added some) and RLS = true.
SELECT
    (SELECT count(*) FROM "Service") AS services,
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'ReleaseRecord') AS release_record_rls;
