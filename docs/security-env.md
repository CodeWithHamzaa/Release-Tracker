# Access control and request limits

## Environment variables

| Variable | Required in production | Meaning |
|---|---|---|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | yes | Supabase project URL. Missing: every API call answers 503. |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | yes | Anon key, used only to verify login tokens. Never the service_role key. |
| `ADMIN_EMAILS` | one of the two lists | Comma-separated, case-insensitive. Admins. |
| `ALLOWED_EMAILS` | one of the two lists | Comma-separated, case-insensitive. Operators. |
| `DATABASE_URL` / `DIRECT_URL` | yes | Postgres. Missing: 503. |

"Production" means `NODE_ENV=production` or `VERCEL=1` (`isStrictDatabaseMode`).
The lists are read on every request, so a change takes effect on the next
deploy or restart of the environment without code changes.

**Fail closed.** In production, if Supabase is not configured, or if both
`ADMIN_EMAILS` and `ALLOWED_EMAILS` are empty, the API answers 503 to every
request (except `GET /api/health`). A valid Supabase account that is on neither
list gets 403. Public sign-ups no longer grant access by themselves.

## Roles

| | operator | admin |
|---|---|---|
| Read records, catalog, servers, vault file list and version history (metadata), health reports | yes | yes |
| Add/edit records, catalog services, servers; upload health reports and receipts | yes | yes |
| Read Config Vault file **contents** (`GET /api/configs/versions/:id`) | no (403) | yes |
| Write the vault (`POST /api/configs`, `POST /api/configs/sync`) | no (403) | yes |
| Delete records, catalog services, vault files, health reports | no (403) | yes |

Vault contents are stored as uploaded, including plaintext secrets. Writes are
admin-only too because the save response includes the previous file content.

**Not locked out:** if `ADMIN_EMAILS` is unset, everyone in `ALLOWED_EMAILS` is
an admin (the behaviour before roles existed) and a warning is logged. Set
`ADMIN_EMAILS` to turn the separation on. Admins do not need to be repeated in
`ALLOWED_EMAILS`. Local dev with no Supabase and no lists keeps auth off.

Operators who open the Configs page will see "needs an administrator" errors
when the app fetches file contents; the UI does not yet hide those actions.

## Record writes (`/api/records`)

Rules live in `lib/recordInput.ts` and apply to POST (single, array,
`{ services: [...] }`) and PATCH.

- Never accepted from the client: `id`, `createdAt`, `updatedAt`, `added_by`.
  The server generates the id and timestamps and stamps `added_by` with the
  signed-in user's email. A deployment date can still be corrected with PATCH
  `createdAt` (validated: real date, after 2000, not in the future).
- `environment` must be SIT, UAT or Prod (any case; stored canonically).
  `status` must be SUCCESS, FAILED or PENDING (default PENDING).
  `server`, `service`, `version` and the release note are required.
- Booleans must be real booleans. Single-line fields are at most 100 characters
  with no control characters; the note at most 5,000; env/config/command
  details at most 20,000. At most 100 records per request.
- Array bodies no longer inherit fields from the first element: each element is
  validated on its own.
- Behaviour change: unknown or missing values now return 400 instead of being
  silently replaced (`Server`, `Service`, `v1.0.0`, `PENDING`).
- `added_by` is now an email, not "A.Hameed". Older rows keep their old values.

## Request body limits

| Routes | Limit | Why |
|---|---|---|
| `/configs*`, `/health-reports*`, `/receipts*` | 3 MB | Each file is capped at 1 MB of text by its route; JSON escaping (quotes, newlines) can roughly double it. A test uploads a 1 MB file of quotes. |
| everything else | 256 KB | Records and catalog edits are small JSON. |

Vercel's request body limit for functions is, from memory, 4.5 MB. A search of
Vercel's documentation did not confirm the figure, so treat it as unverified;
the 3 MB cap stays below it. Oversized and malformed bodies now return JSON
(413 / 400) rather than an HTML error page.
