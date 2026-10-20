# Patch Planner

Plans promotions between environments (SIT → UAT, UAT → Prod, or any other
pair, with a warning) and writes the manual steps for the **target servers
only**. It is a planning and tracking tool: it never connects to, copies to or
runs anything on a server, and it never exports or transfers images. The
image tars are assumed to be on the target already; the steps start there.

## Where the data comes from

Nothing new is collected. The planner reads what the tracker already holds:

| Evidence | Source | Shown as |
|---|---|---|
| Expected version | Vault compose file, or a newer deployed build record (`lib/currentVersions.ts`) | `expected · vault` / `expected · record` |
| Observed version | Newest status / snapshot / receipt health report | `observed`, `observed · stale` (> 7 days), `observed · old` (> 30 days) |
| Image ID | A deployment receipt whose tag matches | `image ID` (immutable; registry digests do not survive `docker save` / `docker load`) |
| Target server | Server registry (Infrastructure → Servers) | IP, compose folder, run-as account, access |
| Config | Latest vault copies of the env files | redacted values, admins only |
| Features / fixes | Keys like `JIRA-123` in release-record notes, plus manual mappings | see below |

A side with no evidence is **unverified**, never guessed. A fresh report that
contradicts the expected version, or a floating `latest` tag, makes the
service a **conflict**: full sync leaves it out until you pick it by hand.

Service statuses: **Update**, **Same**, **Missing on target** (add it to the
compose file by hand), **Target only** (never removed), **Conflict**,
**Unknown**.

## Scope

- **Specific builds**: tick services; each defaults to the source build, or
  pick any logged build.
- **Full environment sync**: every service that differs plus missing ones.
- **By feature / fix**: pick change keys; their services join at the source
  build, which must contain the change (an older build is refused).

Always one image per service, the final one. Builds logged in between are
listed ("not loaded"), never loaded one by one.

## Feature / fix mapping

Evidence levels, strongest first: **verified** (a person marked a mapping
verified and said what proves it), **in release note** (the record for that
exact build names the key), **mapped, unverified** (added by hand),
**inferred, unverified** (the build was logged after the introducing build of
the same service; likely, not proven), **not included**, **unknown**.

Release-record notes are read on the fly and never copied, so the audit log
stays the single source for what was released. Manual mappings live in two
new tables (below).

## Output

One plan, two views of the same steps with the same numbering:

- **Deployment steps**: a short checklist. Each step: target server, exact
  commands, file and setting, expected result, what to do on failure.
- **Full runbook**: 10 sections (patch, images, features/fixes and evidence,
  differences, config changes, ordered steps, checks, rollback, execution
  checklist and evidence table, unknowns/assumptions/risks).

Copy as Markdown or download a `.md`. Ticks stay in the browser tab and prove
nothing; upload a status report after deploying for evidence.

Steps per target server, in order Database → ChatBot → Chat-Service →
Bot-Builder: access and identity, pre-checks (compose valid, current image ID
as the rollback point, tars present, disk), backups (`*.before-<PATCH_ID>`),
`docker load -i`, env-key appends (target values; secrets by hand),
image-line edit (an exact `sed` only when the line is unique and literal,
otherwise a manual edit), `docker compose up -d --no-deps` in `depends_on`
order, verification (image, ID, health, restarts, logs, port), evidence, and
per-server rollback from the backups. Missing facts stay
`<PLACEHOLDERS>` and are listed as unknowns.

Config: keys only on the target are kept; nothing is deleted and no file is
overwritten. Values that differ are listed for judgement, not copied.

## Database change: `prisma/manual/007_change_mapping.sql`

Additive only (tables `Change`, `ChangeBuild`, RLS on, no policies). Run it
once in the Supabase SQL editor **before** deploying this code; it is safe to
run twice. Until it runs, the planner works without manual mapping (keys in
release notes are still read) and `/api/changes` writes answer 503 with the
file name. Recovery: `DROP TABLE "ChangeBuild"; DROP TABLE "Change";` removes
the feature without touching other data. Verified on Postgres 16: applied
twice on top of the previous schema; `prisma migrate diff` against
`schema.prisma` reports no difference.

## Removed

The Health page's "Generate Promotion Scripts" (Part 1 exported images with
`docker save` and gave WinSCP copy steps), the all-servers promotion plan and
the per-record toolkit runbook are replaced by the planner. Release records,
receipts (old receipt files still import), the release checklist and the
toolkit rollout panel are unchanged.

## Manual validation

1. Infrastructure → Servers: fill in UAT/Prod IP, compose folder and run-as
   account for each role (or leave them, and see them flagged as unknown).
2. Configuration: make sure SIT, UAT and Prod each have their
   `docker-compose.yml` and env files in the vault; upload a fresh
   `./alara_server.sh status` for each server on the Health page.
3. **SIT → UAT**: Differences → From SIT, To UAT. Check each service's
   status, the evidence badges and the config table. Press *Plan a patch*,
   tick one service (or choose *Full environment sync*), *Build plan*. Read
   *What this patch changes*, then the *Deployment steps*: every command must
   name the UAT folder, UAT compose file and service, and there must be no
   `docker save`, `scp`, `sftp` or WinSCP. Switch to *Full runbook* and
   download it.
4. **UAT → Prod**: same, with the *UAT → PROD* shortcut. Expect warnings
   for any Prod server missing from the registry.
5. Changes: add `JIRA-123`, link it to a build, and see it in the planner's
   *Promote by feature / fix* list. Pick it and confirm the service joins the
   scope.
6. As an operator account (if you add one): config values show as hidden
   and every config step is "set by hand".
