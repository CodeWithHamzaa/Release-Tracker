-- Release Tracker: allow two services to publish the same host port.
--
-- 001 made (environment, host, hostPort, protocol) unique, so the compose
-- import refused a second service on a host port. Reverse-proxy setups do
-- this on purpose, so the import now saves it and shows a warning instead.
-- A service still binds each host port only once.
--
-- Run once in the Supabase SQL editor. Safe to run again.

BEGIN;

DROP INDEX IF EXISTS "ServicePort_environment_host_hostPort_protocol_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ServicePort_serviceId_environment_host_hostPort_protocol_key"
    ON "ServicePort"("serviceId", "environment", "host", "hostPort", "protocol");

CREATE INDEX IF NOT EXISTS "ServicePort_environment_host_idx"
    ON "ServicePort"("environment", "host");

COMMIT;

-- Check: expect the two new indexes and no "..._environment_host_hostPort_protocol_key".
SELECT indexname FROM pg_indexes WHERE tablename = 'ServicePort' ORDER BY 1;
