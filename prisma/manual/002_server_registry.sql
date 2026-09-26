-- Release Tracker: server registry (environment x role), used by the patch
-- runbook generator. Seeded from the ALARA Project Knowledge index section 2
-- (IP matrix, DNS matrix, ENV_FILES per role, access path, run-as account).
--
-- Run once in the Supabase SQL editor. Safe to run again: existing rows are
-- never overwritten, so edits made on the Catalog page survive a re-run.
-- Values the index does not state (compose folders, the PROD account) are
-- left NULL and show as "unverified" in the app.
--
-- Row-level security is on with no policies: only the API (Prisma, table
-- owner) reads it, and the API requires login.

BEGIN;

CREATE TABLE IF NOT EXISTS "ServerNode" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ip" TEXT,
    "domain" TEXT,
    "composePath" TEXT,
    "runAs" TEXT,
    "access" TEXT,
    "envFiles" TEXT[],
    "toolkitVersion" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServerNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServerNode_environment_role_key"
    ON "ServerNode"("environment", "role");

INSERT INTO "ServerNode"
    ("id", "environment", "role", "ip", "domain", "runAs", "access", "envFiles", "notes", "updatedAt")
SELECT gen_random_uuid()::text, v.env, v.role, v.ip, v.domain, v.run_as, v.access, v.env_files, v.notes, CURRENT_TIMESTAMP
FROM (VALUES
  ('SIT', 'Bot-Builder',   '10.42.42.249', 'evasit.faysalbank.com', 'root', 'Jump server 10.200.200.20 (SSH/SFTP)', ARRAY['.env','.env_fbl','.poly_env'], 'Runs as root; non-standard paths (e.g. /root/ISSM/...). Toolkit v2.4 (assumed, index 2026-09-20).'),
  ('SIT', 'ChatBot / NLU', '10.42.42.250', 'evasit.faysalbank.com', 'root', 'Jump server 10.200.200.20 (SSH/SFTP)', ARRAY['.env_fbl','.env'],            'Runs as root; non-standard paths (e.g. /root/ISSM/...). Toolkit v2.4 (assumed, index 2026-09-20).'),
  ('SIT', 'Database',      '10.42.42.251', 'evasit.faysalbank.com', 'root', 'Jump server 10.200.200.20 (SSH/SFTP)', ARRAY['.env'],                        'Runs as root; non-standard paths (e.g. /root/ISSM/...). Toolkit v2.4 (assumed, index 2026-09-20).'),
  ('SIT', 'Chat-Service',  '10.42.42.252', 'evasit.faysalbank.com', 'root', 'Jump server 10.200.200.20 (SSH/SFTP)', ARRAY['.env'],                        'Runs as root; non-standard paths (e.g. /root/ISSM/...). Toolkit v2.4 (assumed, index 2026-09-20).'),
  ('UAT', 'Bot-Builder',   '10.32.32.98',  'evauat.faysalbank.com', 'chatbotuat', 'Bank jump server, session requested each time', ARRAY['.env','.env_fbl','.poly_env'], 'No root. Base dir /home/chatbotuat/ISSM/ (exact compose folder unverified).'),
  ('UAT', 'ChatBot / NLU', '10.32.32.158', 'evauat.faysalbank.com', 'chatbotuat', 'Bank jump server, session requested each time', ARRAY['.env_fbl','.env'],            'No root. Base dir /home/chatbotuat/ISSM/ (exact compose folder unverified).'),
  ('UAT', 'Database',      '10.42.42.79',  'evauat.faysalbank.com', 'chatbotuat', 'Bank jump server, session requested each time', ARRAY['.env'],                        'On the SIT subnet intentionally. No root. Base dir /home/chatbotuat/ISSM/ (exact compose folder unverified).'),
  ('UAT', 'Chat-Service',  '10.32.32.155', 'evauat.faysalbank.com', 'chatbotuat', 'Bank jump server, session requested each time', ARRAY['.env'],                        'No root. Base dir /home/chatbotuat/ISSM/ (exact compose folder unverified). Missing litellm-service/litellm-db is known (ChatBot).'),
  ('Prod', 'Bot-Builder',   '10.0.8.117', 'eva.faysalbank.com', NULL, 'Bank jump server, session requested each time', ARRAY['.env','.env_fbl','.poly_env'], 'No root; app account unverified. Older toolkit (stated).'),
  ('Prod', 'ChatBot / NLU', '10.0.11.72', 'eva.faysalbank.com', NULL, 'Bank jump server, session requested each time', ARRAY['.env_fbl','.env'],            'No root; app account unverified. Older toolkit (stated).'),
  ('Prod', 'Database',      '10.0.8.57',  'eva.faysalbank.com', NULL, 'Bank jump server, session requested each time', ARRAY['.env'],                        'No root; app account unverified. Older toolkit (stated).'),
  ('Prod', 'Chat-Service',  '10.0.11.74', 'eva.faysalbank.com', NULL, 'Bank jump server, session requested each time', ARRAY['.env'],                        'No root; app account unverified. Older toolkit (stated).')
) AS v(env, role, ip, domain, run_as, access, env_files, notes)
ON CONFLICT ("environment", "role") DO NOTHING;

ALTER TABLE "ServerNode" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Check: expect 12 rows.
SELECT "environment", "role", "ip", "runAs" FROM "ServerNode" ORDER BY 1, 2;
