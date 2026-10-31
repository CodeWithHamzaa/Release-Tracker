-- Release Tracker: group records logged before release bundles (008) into
-- bundles, so the feed shows one row per release event for old data too.
--
-- Rule: records with no release, in the same environment, with the same note
-- (release note), each logged within 10 minutes of the previous one, become
-- one Release. (The old batch form saved one note for every service, and a
-- release was sometimes submitted in two goes a minute or two apart.)
--
-- Each new Release gets:
--   id              'backfill-' || md5(environment, note, first record time)
--   title           first line of the note (max 150 chars), else the services
--   releasedAt      the earliest record's time
--   status          the records' status when they all agree, else PENDING
--   hasConfigChange any record with an env or config update
--   configDetails   the first record's config details, note = the note
--   createdBy       the first record's added_by
-- Records keep their own status, dates and every other field; only
-- "releaseId" is set.
--
-- Safe to run again: it only touches records whose "releaseId" is NULL, and
-- the deterministic ids make a repeated insert a no-op.
--
-- Undo (removes only what this file created):
--   UPDATE "ReleaseRecord" SET "releaseId" = NULL WHERE "releaseId" LIKE 'backfill-%';
--   DELETE FROM "Release" WHERE id LIKE 'backfill-%';

BEGIN;

WITH r AS (
  SELECT rr.*, COALESCE(rr.note, '') AS note_key,
         LAG(rr."createdAt") OVER (PARTITION BY rr.environment, COALESCE(rr.note, '') ORDER BY rr."createdAt", rr.id) AS prev_at
  FROM "ReleaseRecord" rr
  WHERE rr."releaseId" IS NULL
),
s AS (
  SELECT r.*,
         SUM(CASE WHEN prev_at IS NULL OR "createdAt" - prev_at > INTERVAL '10 minutes' THEN 1 ELSE 0 END)
           OVER (PARTITION BY environment, note_key ORDER BY "createdAt", id) AS grp
  FROM r
),
g AS (
  SELECT environment, note_key, grp,
         'backfill-' || md5(environment || '|' || note_key || '|' || MIN("createdAt")::text) AS release_id,
         MIN("createdAt") AS released_at,
         CASE WHEN COUNT(DISTINCT UPPER(status)) = 1 THEN MIN(UPPER(status)) ELSE 'PENDING' END AS status,
         BOOL_OR("isConfigUpdate" OR "isEnvUpdate") AS has_config,
         (ARRAY_AGG("configDetails" ORDER BY "createdAt", id) FILTER (WHERE "configDetails" IS NOT NULL))[1] AS config_details,
         (ARRAY_AGG(added_by ORDER BY "createdAt", id))[1] AS created_by,
         STRING_AGG(DISTINCT service, ', ') AS services
  FROM s
  GROUP BY environment, note_key, grp
),
ins AS (
  INSERT INTO "Release" (id, title, environment, status, "releasedAt", "hasConfigChange", "configDetails", note, "createdBy", "updatedAt")
  SELECT release_id,
         COALESCE(NULLIF(LEFT(BTRIM(SPLIT_PART(BTRIM(note_key), E'\n', 1)), 150), ''), LEFT(services, 150)),
         environment, status, released_at, has_config, config_details, NULLIF(note_key, ''), created_by, NOW()
  FROM g
  ON CONFLICT (id) DO NOTHING
  RETURNING id
),
upd AS (
  UPDATE "ReleaseRecord" rr
  SET "releaseId" = g.release_id
  FROM s JOIN g USING (environment, note_key, grp)
  WHERE rr.id = s.id
  RETURNING rr.id
)
SELECT (SELECT COUNT(*) FROM ins) AS releases_created, (SELECT COUNT(*) FROM upd) AS records_linked;

COMMIT;
