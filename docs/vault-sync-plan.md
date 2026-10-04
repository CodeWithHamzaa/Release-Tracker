# Plan: Config Vault as the single source of truth for services, ports and image versions

Status: **implemented** on branch `ccr-4534a492-b8u2g6` (see "Implementation notes" below). The sections after it are the approved design, kept as written.
Audience: another AI or engineer asked to read, analyse and challenge this plan. Section 12 lists the questions I most want answered.

## Implementation notes (differences from the design)

- **Only build records move image versions.** A record with `isBuildUpdate: false` (a config- or env-only change) no longer sets the current version; its version field says nothing about the image. Found while checking the UI.
- **`SyncPlan` is a flat object** (`ok`, `error`, `services`, `warnings`) instead of a discriminated union, because the repo's `tsconfig` does not narrow on `!plan.ok`.
- **Catalog-name matching:** a compose key that is itself a catalog name always keeps it; other services cannot borrow it through `container_name` or image.
- **Deleting a vault compose or `.env` file re-runs the sync** for that environment + role, so another compose file of that role takes over.
- **Missing 006 schema** is reported as "Run prisma/manual/006_vault_sync.sql" (HTTP 503 on `GET /api/catalog`, a failed sync on save) instead of a generic 500.
- **Amber chips** on the Infrastructure page only mark a newer compose upload overriding a logged build. A record ahead of the vault file is the normal case and shows neutral.
- **Health "Version check"** treats PENDING like SUCCESS, and its vault column is now "Expected (vault / audit log)".
- `/api/configs/sync` also accepts `{ environment, role }` to resync one pair.

Verified: 148/148 unit tests, `npm run lint` (tsc + API ESM check), `npm run build`. `006_vault_sync.sql` was applied twice to Postgres 16 on top of the previous schema, and `prisma migrate diff` against the new `schema.prisma` came back empty. An end-to-end API run covered sync, idempotent re-upload, a removed service, per-environment images, legacy-row replacement, 409 on synced services, invalid YAML, resync and cascade on delete. A headless-browser check covered the Infrastructure, Configs and Health pages. Not verified: Supabase itself, Vercel timeouts, and real bank compose files. `tsc` does not check React component props in this repo (`@types/react` is not installed), so prop wiring was checked by hand and in the browser.

---

## 1. Product context

ALARA Release Tracker is an internal web app for one operator (Abdul Hameed) who deploys the ALARA chatbot platform for a bank. It tracks what is deployed in which environment and helps generate promotion scripts.

- Environments: `SIT`, `UAT`, `Prod`.
- Four server roles per environment: `Bot-Builder`, `ChatBot / NLU`, `Database`, `Chat-Service`. Role names are used as the `server` field on release records.
- UAT and Prod are air-gapped behind bank jump servers (limited sessions). Health snapshots are carried out by hand as files.
- The operator never lets the tracker change a server. It records, compares and generates scripts only.

Stack: React 19 + Vite + Tailwind (client); Express API in `lib/app.ts` (runs locally via `server.ts`, on Vercel as one serverless function via `api/index.ts`); Prisma 6 on Postgres (Supabase). Schema changes are applied **by hand** as SQL files in `prisma/manual/00N_*.sql` run in the Supabase SQL editor (the next number is `006`). There is no Prisma Migrate. Tests: `tsx --test lib/*.test.ts`.

## 2. Current state: the problem

Two places hold the same docker-compose.yml:

1. **Infrastructure page.** The user pastes a compose file. It is parsed in the browser (`lib/compose.ts`, `parseCompose`) and saved through `POST /api/catalog/import` into `Service` (name, group, one `image`) and `ServicePort` (published host ports, per environment + free-text `host` label).
2. **Configs page (Config Vault).** The user uploads the same compose file and the `.env` files through `POST /api/configs` for version history and cross-environment drift comparison. Each save is a new `ConfigFileVersion`; nothing is overwritten.

Relevant existing code (verified by reading it):

| Piece | Where | Notes |
| --- | --- | --- |
| Compose parser | `lib/compose.ts` `parseCompose(text, vars)` | Pure, no browser/Node APIs. Handles short and long port syntax, ranges, `${VAR:-default}`, `network_mode: host`. Returns services with `image`, `containerName`, `ports[]`, `internalPorts`, plus `warnings`. |
| Compose summary | `lib/configDrift.ts` `summarizeCompose`, `imageTag`, `imageRepo` | Used by the Health page and risk engine. |
| `.env` parser | `lib/envFile.ts` `parseEnvFile` | Flags `ENC[...]` encrypted values. |
| Vault save | `lib/app.ts` `POST /api/configs` (about line 894) | JSON body: environment, role, path, content, source, note. Upserts `ConfigFile`, appends `ConfigFileVersion` unless the sha256 equals the latest. |
| Catalog | `GET /api/catalog`, `POST /api/catalog/import` | The import route is what this plan removes. |
| Client compose index | `src/useConfigs.ts` `useComposeIndex` | Parses the latest vault compose per role + env in the browser. Feeds the Health page and the risk analyzer. |
| Risk analyzer | `lib/riskEngine.ts`, `lib/riskInputs.ts` (`buildRoleRiskInput`) | Deterministic rules. Already takes compose summaries from the vault (`sourceCompose`, `targetCompose`) and PENDING release records. |
| Release records | `ReleaseRecord` model, `POST /api/records` | The "audit log". Fields: environment, server (role), service, version, status (`SUCCESS`/`FAILED`/`PENDING`), `createdAt` (editable/backdatable), `isBuildUpdate`, `isEnvUpdate`, `isConfigUpdate`, notes. |
| Health version check | `lib/healthModel.ts` `versionChecks` | Compares running container tag vs latest **SUCCESS** record vs vault compose tag. |

Current schema (the parts that change):

```prisma
model Service {
  id String @id @default(uuid())
  server String            // group, e.g. Bot-Builder
  name String
  image String?            // ONE image for all environments (last import wins)
  ports ServicePort[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([server, name])
}

model ServicePort {
  id String @id @default(uuid())
  serviceId String
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  environment String
  host String              // free-text label chosen at import
  hostPort Int
  containerPort Int
  protocol String @default("tcp")
  hostIp String?
  createdAt DateTime @default(now())
  @@unique([serviceId, environment, host, hostPort, protocol])
  @@index([environment, host])
  @@index([serviceId])
}
```

## 3. Goals

1. **One input point.** Uploading `docker-compose.yml` (and `.env`) to the vault automatically populates services, per-environment images and published ports. Remove the manual import from the Infrastructure page.
2. **No duplicates** when the same file is synced repeatedly.
3. **The audit log wins after the baseline.** The operator receives several service builds almost daily, deploys them to SIT, and logs a release record for each. Sometimes several fixes are bundled into one UAT release. He will **not** re-upload compose for every build. So after the first compose/env upload, release records (not new compose uploads) define each service's current version in each environment.
4. The pre-flight risk analyzer should take the target environment's expected services from the vault, not from manual entry.

## 4. Findings that change the shape of the plan

- The brief says `PortMap`, `/api/configs/upload` and Prisma migrations. The real names are `ServicePort`, `POST /api/configs`, and hand-written SQL.
- `Service.image` is one value, so SIT, UAT and Prod cannot hold different tags. A per-environment table is required.
- The risk analyzer **already** reads compose files from the vault. No manual service entry exists to remove. The remaining work is feeding it current versions (section 8) and a stale-vault warning.
- `parseCompose` is pure and already shared by client and server, so the server can reuse it unchanged.

## 5. Decisions already made by the operator

| Question | Decision |
| --- | --- |
| `ServicePort.host` label for synced ports (the vault knows environment + role, not a host) | Use the **role name**. The IP stays in the server registry (`ServerNode`). |
| Old manually imported rows | **Replace on first sync.** When an environment + role is first synced, delete the legacy manual port rows (any host label) of the services that appear in that compose file. |
| Image tags | **Per environment**, new `ServiceDeployment` table. `Service.image` stays as "last synced image" for back-compat. |
| Which audit entries count as deployed | `SUCCESS` and `PENDING` (PENDING = deployed, waiting for the bank's test). `FAILED` never counts. |
| Re-uploading compose after records exist | **Newest timestamp wins**: vault version `createdAt` vs record `createdAt` (records can be backdated). |
| Env/config records | Records stay text. A newer env/config record than the vault file triggers a "vault may be stale, re-upload" flag. |

## 6. Design

### 6.1 Data flow

```
Upload compose / .env  ──►  POST /api/configs  ──►  ConfigFile + new ConfigFileVersion (always saved first)
                                   │
                                   └─► syncRoleFromVault(env, role)   (same request, awaited)
                                           parse latest primary compose (+ .env for ${VARS})
                                           ├─ upsert Service rows (server = role)
                                           ├─ replace ServiceDeployment rows (image/tag per env)
                                           └─ replace ServicePort rows (host = role)
                                           record ConfigFile.syncedVersion / syncError

Add Record (audit log) ──► ReleaseRecord (existing, unchanged)

Read time (client or server, pure function):
  currentVersion(service, env) = newest of
      baseline  (compose tag, timestamped by its ConfigFileVersion.createdAt)
      latest deployed record (SUCCESS|PENDING, createdAt)
```

Key property: **vault files are never rewritten by records.** The "current version" is computed when read, so editing, backdating or deleting a record changes it immediately and nothing can drift out of sync with a stored copy.

### 6.2 Rule table: current version

| Situation | Current version | Shown as |
| --- | --- | --- |
| Only a compose upload exists | Compose image tag | Vault vN |
| SUCCESS/PENDING record dated after that compose version | Record's version | Audit log (date, status) |
| FAILED record | Ignored | none |
| Compose re-uploaded after the latest record | Compose tag; record's version shown as superseded | Vault vN+1 |
| Record and compose with identical timestamps | Record's version | Audit log |

- Compose time = `ConfigFileVersion.createdAt` of the version that set the tag (not `syncedAt`, so a resync does not make the vault look newer).
- Matching: environment (case-insensitive), `record.server === role`, `record.service === catalog name`. The sync maps compose keys to catalog names (see 6.4) so `alara-ui2` matches records for `alara-ui`. Versions compare without a leading `v`.

### 6.3 Stale-vault flags (per environment + role)

| Record logged after the vault file | Flag |
| --- | --- |
| `isBuildUpdate` newer than the compose version | Info only ("N builds logged since compose vK; versions shown from the audit log"). Expected, not a warning. |
| `isConfigUpdate` newer than the compose version | Warning: compose may be stale, re-upload. |
| `isEnvUpdate` newer than the newest env file of that role | Warning: env files may be stale. Records do not say which env file changed, so this compares with the newest one. |

### 6.4 Sync behaviour

- One **primary compose file** per environment + role: `docker-compose.yml` if present, else the first compose-named file (sorted). The client's `useComposeIndex` is changed to use the same rule.
- `${VAR}` in ports/images resolve from the vault's `.env` for the same environment + role (docker compose reads `${VAR}` only from the project `.env`). `ENC[...]` values are skipped, so ports that need them are reported as unset warnings.
- Catalog-name matching: if the compose key differs from an existing catalog name, the first of `[composeKey, container_name, imageRepo(image)]` that equals an existing catalog name (for that role) is used.
- **An unreadable file never deletes data.** Invalid YAML or no `services:` returns `ok:false`; `ConfigFile.syncError` is recorded; the database is otherwise untouched.
- Sync runs **inside the upload request**, awaited (Vercel freezes the function after the response is sent). A sync failure never undoes the vault save; the response carries `sync: {status, ...}` and a "Resync from vault" endpoint retries and backfills.
- A service that disappears from the compose file loses its ports and deployments for that environment (matched by `sourceFileId`), but the `Service` row stays (it may still be in the Add Record picker and in historical records).
- Services edited by hand in the catalog (the "Add service" form, kept for services that are in no compose file) are never touched by sync unless the name also appears in the compose file. Synced services cannot be renamed or deleted from the UI (HTTP 409 with a pointer to the vault).

## 7. Implementation steps

### Step 1. `prisma/schema.prisma`

```prisma
model Service {
  id          String              @id @default(uuid())
  server      String              // group = vault role for synced services
  name        String
  image       String?             // deprecated: last synced image, any environment
  ports       ServicePort[]
  deployments ServiceDeployment[]
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  @@unique([server, name])
}

model ServicePort {
  id              String             @id @default(uuid())
  serviceId       String
  service         Service            @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  environment     String
  host            String             // role name for synced rows; free label for legacy rows
  hostPort        Int
  containerPort   Int
  protocol        String             @default("tcp")
  hostIp          String?
  sourceFileId    String?            // null = legacy manual import
  sourceFile      ConfigFile?        @relation(fields: [sourceFileId], references: [id], onDelete: Cascade)
  sourceVersionId String?
  sourceVersion   ConfigFileVersion? @relation(fields: [sourceVersionId], references: [id], onDelete: SetNull)
  createdAt       DateTime           @default(now())

  @@unique([serviceId, environment, host, hostPort, protocol])
  @@index([environment, host])
  @@index([serviceId])
  @@index([sourceFileId])
}

// What one environment runs for a service, from the latest vault compose file.
model ServiceDeployment {
  id              String             @id @default(uuid())
  serviceId       String
  service         Service            @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  environment     String
  role            String
  composeKey      String             // key under services: (may differ from the catalog name)
  containerName   String?
  image           String?
  tag             String?
  sourceFileId    String
  sourceFile      ConfigFile         @relation(fields: [sourceFileId], references: [id], onDelete: Cascade)
  sourceVersionId String?
  sourceVersion   ConfigFileVersion? @relation(fields: [sourceVersionId], references: [id], onDelete: SetNull)
  syncedAt        DateTime           @default(now())

  @@unique([serviceId, environment])
  @@index([environment, role])
}

model ConfigFile {
  // ...existing fields...
  syncedVersion Int?
  syncedAt      DateTime?
  syncError     String?
  deployments   ServiceDeployment[]
  ports         ServicePort[]
}

model ConfigFileVersion {
  // ...existing fields...
  deployments ServiceDeployment[]
  ports       ServicePort[]
}
```

Why repeated syncs cannot duplicate: `Service` stays unique on `(server, name)` and is inserted with `createMany({skipDuplicates:true})`; `ServiceDeployment` is unique on `(serviceId, environment)`; ports are deleted by `sourceFileId` and re-created in one transaction; deleting a compose file from the vault cascades to what it produced.

### Step 2. `prisma/manual/006_vault_sync.sql` (idempotent, RLS on, no policies, like `004_config_vault.sql`)

```sql
BEGIN;

ALTER TABLE "ServicePort" ADD COLUMN IF NOT EXISTS "sourceFileId" TEXT;
ALTER TABLE "ServicePort" ADD COLUMN IF NOT EXISTS "sourceVersionId" TEXT;
CREATE INDEX IF NOT EXISTS "ServicePort_sourceFileId_idx" ON "ServicePort"("sourceFileId");

ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncedVersion" INTEGER;
ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);
ALTER TABLE "ConfigFile" ADD COLUMN IF NOT EXISTS "syncError" TEXT;

CREATE TABLE IF NOT EXISTS "ServiceDeployment" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "composeKey" TEXT NOT NULL,
    "containerName" TEXT,
    "image" TEXT,
    "tag" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceDeployment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceDeployment_serviceId_environment_key"
    ON "ServiceDeployment"("serviceId", "environment");
CREATE INDEX IF NOT EXISTS "ServiceDeployment_environment_role_idx"
    ON "ServiceDeployment"("environment", "role");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServicePort_sourceFileId_fkey') THEN
    ALTER TABLE "ServicePort" ADD CONSTRAINT "ServicePort_sourceFileId_fkey"
      FOREIGN KEY ("sourceFileId") REFERENCES "ConfigFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServicePort_sourceVersionId_fkey') THEN
    ALTER TABLE "ServicePort" ADD CONSTRAINT "ServicePort_sourceVersionId_fkey"
      FOREIGN KEY ("sourceVersionId") REFERENCES "ConfigFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_serviceId_fkey') THEN
    ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_serviceId_fkey"
      FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_sourceFileId_fkey') THEN
    ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_sourceFileId_fkey"
      FOREIGN KEY ("sourceFileId") REFERENCES "ConfigFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceDeployment_sourceVersionId_fkey') THEN
    ALTER TABLE "ServiceDeployment" ADD CONSTRAINT "ServiceDeployment_sourceVersionId_fkey"
      FOREIGN KEY ("sourceVersionId") REFERENCES "ConfigFileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

ALTER TABLE "ServiceDeployment" ENABLE ROW LEVEL SECURITY;

COMMIT;
```

### Step 3. `lib/composeSync.ts` (pure, unit-testable)

```ts
import { parseCompose, ComposePort } from './compose.js';
import { parseEnvFile } from './envFile.js';
import { imageRepo, imageTag } from './configDrift.js';

export const isComposePath = (path: string) => /compose.*\.ya?ml$/i.test(path);

// One compose file per environment + role feeds the catalog.
export function primaryComposePath(paths: string[]): string | null {
  const compose = paths.filter(isComposePath).sort();
  return compose.includes('docker-compose.yml') ? 'docker-compose.yml' : compose[0] ?? null;
}

export interface SyncService {
  name: string;        // catalog name
  composeKey: string;
  containerName: string | null;
  image: string | null;
  tag: string | null;
  ports: ComposePort[];
}

export type SyncPlan =
  | { ok: true; services: SyncService[]; warnings: string[] }
  | { ok: false; error: string };

export function planComposeSync(input: { compose: string; dotEnv: string | null; catalogNames: string[] }): SyncPlan {
  const vars: Record<string, string> = {};
  for (const e of input.dotEnv ? parseEnvFile(input.dotEnv).entries : []) {
    if (!e.encrypted) vars[e.key] = e.value;
  }
  const { services, warnings } = parseCompose(input.compose, vars);
  if (services.length === 0) {
    return { ok: false, error: warnings[0] ?? 'No services found in the compose file.' };
  }
  const taken = new Set<string>();
  const out: SyncService[] = services.map((s) => {
    const name =
      [s.name, s.containerName, imageRepo(s.image)].find((n) => n && input.catalogNames.includes(n) && !taken.has(n)) ?? s.name;
    taken.add(name);
    const ports: ComposePort[] = [];
    for (const p of s.ports) {
      if (!ports.some((q) => q.hostPort === p.hostPort && q.protocol === p.protocol)) ports.push(p);
    }
    return { name, composeKey: s.name, containerName: s.containerName, image: s.image, tag: imageTag(s.image), ports };
  });
  return { ok: true, services: out, warnings };
}
```

### Step 4. Express (`lib/app.ts`)

Sync function:

```ts
type SyncOutcome =
  | { status: 'synced'; environment: string; role: string; version: number; services: number; created: string[]; ports: number; warnings: string[] }
  | { status: 'failed'; environment: string; role: string; error: string }
  | { status: 'skipped'; environment: string; role: string; reason: string };

async function latestVersion(db: any, key: { environment: string; role: string; path: string }) {
  const file = await db.configFile.findUnique({
    where: { environment_role_path: key },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, content: true } } },
  });
  return file?.versions[0] ? { file, version: file.versions[0] } : null;
}

async function syncRoleFromVault(prisma: any, environment: string, role: string): Promise<SyncOutcome> {
  const siblings = await prisma.configFile.findMany({ where: { environment, role }, select: { path: true } });
  const path = primaryComposePath(siblings.map((f: any) => f.path));
  const compose = path ? await latestVersion(prisma, { environment, role, path }) : null;
  if (!compose) return { status: 'skipped', environment, role, reason: 'No compose file in the vault.' };

  const dotEnv = await latestVersion(prisma, { environment, role, path: '.env' });
  const catalog = await prisma.service.findMany({ where: { server: role }, select: { name: true } });
  const plan = planComposeSync({
    compose: compose.version.content,
    dotEnv: dotEnv?.version.content ?? null,
    catalogNames: catalog.map((s: any) => s.name),
  });
  const { file, version } = compose;
  if (!plan.ok) {
    await prisma.configFile.update({ where: { id: file.id }, data: { syncError: plan.error.slice(0, 500) } });
    return { status: 'failed', environment, role, error: plan.error };
  }

  const host = role; // synced ports are labelled by role; the IP comes from the server registry
  return prisma.$transaction(
    async (tx: any) => {
      // A newer version landed while we parsed: its own save runs the sync.
      const head = await tx.configFileVersion.findFirst({ where: { fileId: file.id }, orderBy: { version: 'desc' }, select: { id: true } });
      if (head?.id !== version.id) return { status: 'skipped', environment, role, reason: 'Superseded by a newer version.' };

      const names = plan.services.map((s) => s.name);
      const existing = await tx.service.findMany({ where: { server: role, name: { in: names } }, select: { name: true, image: true } });
      const before = new Map<string, string | null>(existing.map((s: any) => [s.name, s.image]));
      await tx.service.createMany({ data: plan.services.map((s) => ({ server: role, name: s.name, image: s.image })), skipDuplicates: true });
      const rows = await tx.service.findMany({ where: { server: role, name: { in: names } }, select: { id: true, name: true } });
      const idOf = new Map<string, string>(rows.map((s: any) => [s.name, s.id]));
      const ids = [...idOf.values()];

      await tx.serviceDeployment.deleteMany({ where: { OR: [{ sourceFileId: file.id }, { environment, serviceId: { in: ids } }] } });
      await tx.serviceDeployment.createMany({
        data: plan.services.map((s) => ({
          serviceId: idOf.get(s.name)!, environment, role, composeKey: s.composeKey, containerName: s.containerName,
          image: s.image, tag: s.tag, sourceFileId: file.id, sourceVersionId: version.id,
        })),
      });

      // Drop this file's previous ports plus legacy manual-import rows of the same services in this environment.
      await tx.servicePort.deleteMany({
        where: { environment, OR: [{ sourceFileId: file.id }, { sourceFileId: null, serviceId: { in: ids } }] },
      });
      const portRows = plan.services.flatMap((s) =>
        s.ports.map((p) => ({ ...p, environment, host, serviceId: idOf.get(s.name)!, sourceFileId: file.id, sourceVersionId: version.id }))
      );
      if (portRows.length) await tx.servicePort.createMany({ data: portRows, skipDuplicates: true });

      for (const s of plan.services) {
        if (s.image && before.has(s.name) && before.get(s.name) !== s.image) {
          await tx.service.update({ where: { id: idOf.get(s.name) }, data: { image: s.image } });
        }
      }

      const others = await tx.servicePort.findMany({
        where: { environment, host, serviceId: { notIn: ids } },
        include: { service: { select: { name: true } } },
      });
      const clashes = findPortConflicts([
        ...others.map((p: any) => ({ service: p.service.name, environment, host, hostPort: p.hostPort, protocol: p.protocol })),
        ...portRows.map((p) => ({ service: plan.services.find((s) => idOf.get(s.name) === p.serviceId)!.name, environment, host, hostPort: p.hostPort, protocol: p.protocol })),
      ]);

      await tx.configFile.update({ where: { id: file.id }, data: { syncedVersion: version.version, syncedAt: new Date(), syncError: null } });
      return {
        status: 'synced', environment, role, version: version.version,
        services: plan.services.length,
        created: names.filter((n) => !before.has(n)),
        ports: portRows.length,
        warnings: [...plan.warnings, ...clashes.map((c) => `Host port ${c.hostPort}/${c.protocol} shared by ${c.services.join(', ')}`)],
      } as SyncOutcome;
    },
    { timeout: 20_000, maxWait: 10_000 }
  );
}
```

Hook at the end of `POST /api/configs` (called after the version is saved; awaited; never undoes the save):

```ts
let sync: SyncOutcome | null = null;
if (isComposePath(path) || path === '.env') {
  sync = await syncRoleFromVault(prisma, environment, role).catch((err: unknown): SyncOutcome => {
    console.error('[vault-sync]', (err as Error)?.name ?? 'Error'); // never log file contents
    return { status: 'failed', environment, role, error: 'Saved to the vault, but the catalog sync failed. Use "Resync from vault" on the Infrastructure page.' };
  });
}
res.status(result.unchanged ? 200 : 201).json({ success: true, unchanged: result.unchanged,
  file: { id: result.file.id, environment, role, path }, version: result.version,
  previousContent: result.previousContent, sync });
```

Resync endpoint (also backfills files that were in the vault before this feature):

```ts
router.post('/configs/sync', async (req, res) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const pairs = await prisma.configFile.findMany({ distinct: ['environment', 'role'], select: { environment: true, role: true } });
    const results: SyncOutcome[] = [];
    for (const p of pairs) results.push(await syncRoleFromVault(prisma, p.environment, p.role)); // sequential
    res.json({ success: true, results });
  } catch (err) { return sendDbError(res, err, 'sync the catalog from the vault'); }
});
```

Catalog route changes: delete `POST /catalog/import`; `GET /catalog` also returns each service's `deployments` (environment, role, image, tag, composeKey, syncedAt, source version number and its `createdAt`) and a `syncState` list per primary compose file (latest version, `syncedVersion`, `syncedAt`, `syncError`); `PATCH`/`DELETE /catalog/services/:id` answer 409 when the service has deployments ("Synced from the Config Vault, change docker-compose.yml there.").

### Step 5. `lib/currentVersions.ts` (pure; implements section 6.2)

```ts
import type { ReleaseRecord } from './types.js';

const DEPLOYED = new Set(['SUCCESS', 'PENDING']);
const norm = (v: string | null) => (v ?? '').trim().replace(/^v/i, '');

type Rec = Pick<ReleaseRecord, 'id' | 'environment' | 'server' | 'service' | 'version' | 'status' | 'createdAt'>;

export interface Baseline { tag: string | null; at: string } // compose tag + its ConfigFileVersion.createdAt

export interface CurrentVersion {
  version: string | null;
  source: 'vault' | 'record' | 'none';
  at: string | null;
  recordId: string | null;
  status: string | null;
  superseded: { source: 'vault' | 'record'; version: string | null } | null;
}

export function recordsFor(records: Rec[], environment: string, role: string, service: string): Rec[] {
  const env = environment.trim().toUpperCase();
  return records.filter((r) => r.environment.trim().toUpperCase() === env && r.server === role && r.service === service);
}

export function currentVersion(baseline: Baseline | null, records: Rec[]): CurrentVersion {
  let latest: Rec | null = null;
  for (const r of records) {
    if (!DEPLOYED.has(String(r.status).toUpperCase())) continue;
    if (!latest || new Date(r.createdAt) > new Date(latest.createdAt)) latest = r;
  }
  if (!latest && !baseline) return { version: null, source: 'none', at: null, recordId: null, status: null, superseded: null };
  const recordWins = !!latest && (!baseline || new Date(latest.createdAt) >= new Date(baseline.at));
  const differs = !!latest && !!baseline && norm(latest.version) !== norm(baseline.tag);
  if (recordWins) {
    return { version: latest!.version, source: 'record', at: String(latest!.createdAt), recordId: latest!.id,
      status: String(latest!.status).toUpperCase(), superseded: differs ? { source: 'vault', version: baseline!.tag } : null };
  }
  return { version: baseline!.tag, source: 'vault', at: baseline!.at, recordId: null, status: null,
    superseded: differs ? { source: 'record', version: latest!.version } : null };
}

// Replace the tag in "repo/name:tag" (digest and registry port kept apart).
export function withTag(image: string | null, version: string): string | null {
  if (!image) return null;
  const at = image.indexOf('@');
  const base = at === -1 ? image : image.slice(0, at);
  const colon = base.lastIndexOf(':');
  const repo = colon > base.lastIndexOf('/') ? base.slice(0, colon) : base;
  return `${repo}:${version}`;
}
```

### Step 6. React

- `InfrastructureView.tsx`: delete `ComposeImport`, `PreviewRow`, `parseVars` and the `<ComposeImport />` line (about 330 lines) and the now-unused imports. Add a badge with the exact text "Services and Ports are automatically synced from the latest Config Vault version." plus a "Resync from vault" button and per-file sync state. Per-environment image chips show the current version and its source (for example "SIT 1.4.7 · log 2026-10-03 PENDING", "UAT 1.4.2 · vault v4"); a superseded value is shown in amber on hover. Hide edit/delete on synced services. Keep "Add service" for services in no compose file (the Add Record picker still needs them).
- `useCatalog.ts`: add `deployments`, `syncState`, `resync()`.
- New `src/useCurrentVersions.ts`: `useMemo` over catalog deployments + records, returns current versions and stale flags; recomputes whenever a record changes.
- `useConfigs.ts`: `SaveResult.sync`; `useComposeIndex` uses `primaryComposePath`.
- `ConfigsView.tsx`: show each upload's sync result and per-file stale flags; after `configs.reload()` call a new `onCatalogChanged` prop.
- `App.tsx`: pass `onCatalogChanged={catalog.reload}`; call `useCurrentVersions` once and pass the result down.
- `PortMapPanel.tsx`: text only (`host` is now the role name).
- Health page: otherwise unchanged (it reads `composeIndex`, rebuilt after each vault save). `healthModel.versionChecks` is changed to treat PENDING like SUCCESS and to compare against the current version instead of the raw compose tag.

### Step 7. Pre-flight risk analyzer

It already receives vault compose summaries. Changes:

1. **Overlay current versions.** Before `buildRoleRiskInput`, an `applyCurrentVersions` helper rewrites each summary's `tag` to the current version and `image` to `withTag(image, version)`, so image comparisons reflect what SIT really runs. Port and volume checks keep using the vault compose file (records carry no ports or volumes).
2. **Stale-vault finding** (medium): a config or env record newer than the vault file on the source or target environment raises "Vault may be stale for <env> / <role>: re-upload before generating scripts." Build records newer than the compose version raise nothing.
3. `pendingRecords` stays as is.
4. Optional later phase: build the analyzer's compose input from `ServiceDeployment` instead of parsing full compose text in the browser (needs `volumes` and `envFiles` columns).

## 8. Rollout

1. Run `006_vault_sync.sql` in Supabase **before** deploying (new code queries the new columns).
2. Deploy; click **Resync from vault** once to backfill every environment + role. This replaces legacy manual ports for services present in a compose file.
3. Legacy rows for services in no compose file remain; delete them from the Infrastructure page.

## 9. Tests

`lib/composeSync.test.ts`: key `alara-ui2` with `container_name: alara-ui` maps to catalog name `alara-ui`; `${PORT:-8080}` and a `.env` value resolve while an `ENC[...]` value is skipped with a warning; invalid YAML or no `services:` returns `ok:false`; duplicate port bindings in one service are deduplicated; `primaryComposePath` prefers `docker-compose.yml` and is otherwise deterministic.

`lib/currentVersions.test.ts`: a PENDING record after the compose upload wins and a FAILED one is ignored; a compose re-upload dated after the latest record wins and reports the record as superseded; a record backdated before the compose version loses; equal timestamps go to the record; `v1.2.0` and `1.2.0` are not reported as different; `withTag` keeps a registry port in `host:5000/app:1.0` and drops a digest; config/env records newer than the vault raise the stale flags while build records raise only the info line.

## 10. Known limits and unverified claims

- Unverified: none of the code compiles or runs yet.
- Unverified: whether the existing catalog `server` (group) values equal the four role names. `config/services.json` uses them, but groups created through the old free-text import may differ. The sync assumes `Service.server === role`.
- Unverified: whether 12 sequential syncs in `/configs/sync` fit the Vercel function timeout (`maxDuration` may be needed).
- Unverified: docker compose reading `${VAR}` only from the project `.env` is general knowledge, not checked against the bank servers (a run with `--env-file` would differ).
- Unverified: record `service` names match catalog names in the live data. A mismatch means that record won't move the current version.
- The "head version" check inside the transaction is not a lock; two near-simultaneous uploads for the same role could both sync, and the last transaction to commit wins.
- Record timestamps come from the server unless backdated; a record backdated to the same day as an upload resolves by exact time, not date.
- Image tag semantics: record versions look like `v1.0.2`, image tags may be `1.0.2` or something else. `withTag` uses the record's string as the tag; this could produce a tag that is not the real one.

## 11. Alternatives considered

- **Write record versions back into the vault compose** (rewrite `image:` lines): rejected. It would create fake vault versions and break the "vault = what the file said" audit trail.
- **Store the current version in a table on every record insert** (denormalised): rejected for now. Edits, backdating and deletes of records would need to keep it in sync; computing on read avoids that.
- **Run the sync as Express middleware**: rejected. It would have to re-read the body and intercept the response; a call at the end of the handler is simpler.
- **Background job / queue for the sync**: rejected for Vercel serverless; the work is small and must finish before the function freezes.

## 12. What I want the reviewing AI to do

Read sections 1 to 11, then reply with:

1. **A plain-language explanation** of the logic as you understand it (so I can check you read it correctly), including what happens on (a) the first compose upload, (b) a daily SIT build logged as a record, (c) a bundled UAT release, (d) a later compose re-upload.
2. **Logic holes.** Where can the precedence rule in 6.2 give a wrong answer? Think about backdated records, deleted records, a FAILED record followed by a re-deploy, two roles with the same service name, and clock differences.
3. **Data-integrity risks** in `syncRoleFromVault`: the delete-then-create pattern, the legacy-row deletion (`sourceFileId: null`), the lack of locking, and removed services.
4. **The riskiest assumptions** in section 10, ranked, and a cheap way to check each before building.
5. **Simplifications**: what could be cut without losing the goals in section 3? Is `ServiceDeployment` really needed, or can image tags live elsewhere?
6. **Better alternatives** to computing precedence on the client versus on the server, and whether the risk analyzer should consume current versions on the server.
7. **Anything in the bank-air-gap context** (limited UAT/Prod sessions, no tracker access to servers) that this design handles badly.

Please separate facts you can verify from this document from guesses, and mark guesses as "unverified".
