# Release bundles, promotion and bundle runbooks

A **release** is one release event: a purpose, an environment, a date and one
service record per build. The feed shows one row per release, never one row
per service.

## Data model (`prisma/manual/008_release_bundles.sql`)

| Table | What changes |
|---|---|
| `Release` (new) | `title`, `environment`, `status`, `releasedAt`, `hasConfigChange`, `configDetails`, `note`, `promotedFromId`, `undoState`, `createdBy` |
| `ReleaseRecord` | new nullable `releaseId` (cascade on delete of the release) |

Additive only. Existing records keep `releaseId = NULL` and show as
one-service bundles marked "single record". **Run the SQL file in Supabase
before deploying**: the Prisma client reads `ReleaseRecord.releaseId`, so
`/api/records` fails until the column exists. Safe to run twice. Verified on
Postgres 16: applied twice on top of the previous schema (built from the old
`schema.prisma`), existing rows kept, and `prisma migrate diff` against the new
`schema.prisma` reports no difference.

Recovery: `ALTER TABLE "ReleaseRecord" DROP COLUMN "releaseId"; DROP TABLE "Release";`

### Older records (`prisma/manual/009_backfill_release_bundles.sql`)

Records logged before 008 are grouped into bundles: same environment, same
note, each logged within 10 minutes of the previous one. Title = first line of
the note, date = earliest record, status = the records' status when they all
agree (else PENDING). Only `releaseId` is set on the records. Safe to run
again; ids start with `backfill-`, and the file ends with the undo SQL.
Applied to production on 2026-10-31: 103 records into 29 bundles, none left
unlinked. Records that receipts or the config vault log later still arrive
without a release and show as single rows.

## Statuses

| Status | Meaning | Counts as deployed? |
|---|---|---|
| `PENDING` | deployed, waiting for the bank's test | yes |
| `SUCCESS` | deployed and confirmed | yes |
| `FAILED` | did not go in | no |
| `PLANNED` (new) | logged ahead of the deployment; what a promotion creates | **no** |

"Counts as deployed" is what moves an environment's current version
(`lib/currentVersions.ts`), the Health version check and the planner. A
deployment receipt closes PLANNED records the same way it closes PENDING ones.

The **bundle status** (the Pending / Success / Fail toggle on the collapsed
row) is the release's own and does not change the service records. When they
disagree, the expanded row says so and offers **Set all services to …**, an
explicit second action. Legacy one-record rows have no bundle, so their toggle
sets the record's status.

## Logging a release (Add Record)

- **Release Purpose / Title** (required) and **Release Date & Time**
  (optional `datetime-local`; empty = now). A past date backdates the release
  and every service record in it. Future dates are refused (one day of slack
  for clock and time-zone differences, as for record edits).
- **Owner per service**: each service block has its own owner; empty uses
  the lead developer.
- **Config Change Required** is set when the Env Variables or Config Changes
  toggle is on, and shows as a highlighted badge (plus an orange left edge) on
  the row, collapsed and expanded.

`POST /api/records` still ignores client timestamps (unchanged); backdating
goes only through the validated `releasedAt` field of `/api/releases`, or an
edit of an existing record or release.

## Promotion (SIT → UAT → Prod)

Expanded row → target → **Promote to …**:

- Creates a `PLANNED` copy of the release in the target environment, with one
  `PLANNED` record per build. FAILED builds are left out. The note says where
  it came from.
- Promoting the same release again while its copy is still entirely PLANNED
  **refreshes** that copy (no duplicates).
- **Undo** (in the notice after promoting, or on the copy's expanded row)
  removes the copy, or restores it as it was before a refresh. It is offered
  only while the copy and all its records are still PLANNED; once anyone or a
  receipt moves it on, use Edit or Delete instead.
- Nothing is sent to or run on a server, and the target's current versions do
  not change until the copy's records become PENDING / SUCCESS.
- Needs a database (local dev without one answers 503).

## Runbook and Ops brief

Expanded row → **Runbook & Ops brief** (`lib/bundleRunbook.ts`, generated in
the browser from data already loaded). Target environment is selectable;
Copy Markdown or Download .md.

- **Standard**: per server, in the order Database → ChatBot / NLU →
  Chat-Service → Bot-Builder: log in, back up compose (and env files when env
  changes), `docker load -i`, set image tags (a manual edit, with a `grep`
  and `docker compose config -q` check), apply env / config changes (values
  redacted by `lib/redact.ts`), supplied commands, `docker compose up -d
  --no-deps`, verify, per-server rollback, checklist.
- **Detailed**: Standard plus pre-flight checks (host/IP, `df -h`, tar
  present, `sha256sum`, compose validity, current image IDs as the rollback
  point) and health, restart count and logs after the restart.
- **Bank IT / Ops brief**: one page with servers in order, what the operator
  does, downtime, whether config changes are required (setting **names**
  only), rollback, prerequisites and contacts. No versions, notes or values.

Image names and compose keys come from the target's vault compose file (via
the catalog). Anything unknown (IP, folder, account, tar folder, image name)
is a `<PLACEHOLDER>` listed under Unknowns, never a guess. This runbook does
not replace the Patch Planner, which compares environments using evidence
(health reports, image IDs). The two are separate generators by design.

## API

| Route | Who | |
|---|---|---|
| `GET /api/releases` | operator, admin | `undoState` is never returned; `canUndo` instead |
| `POST /api/releases` | operator, admin | `{ title, environment, status?, releasedAt?, hasConfigChange?, configDetails?, note, source?, …record flags, services: [...] }` |
| `PATCH /api/releases/:id` | operator, admin | title, status, releasedAt (moves its records too), hasConfigChange, configDetails, note, `applyStatusToRecords` |
| `DELETE /api/releases/:id` | admin | deletes the release and its records |
| `POST /api/releases/:id/promote` | operator, admin | `{ targetEnvironment }` |
| `POST /api/releases/:id/revert` | operator, admin | undo a still-PLANNED promotion |

## Not verified

- Supabase itself (RLS, the pooler, realtime): the new table has RLS on with
  no policies like the others and is reached only through the API. Realtime
  still streams `ReleaseRecord` changes only; release rows from another user
  appear after a reload.
- The runbook commands against the real bank servers (they follow the same
  conventions as the Patch Planner's runbook).
