// Express API application.
//
// This module holds the API surface only -- no HTTP listener, no Vite middleware
// and no static file serving. That keeps it importable from both entry points:
//   - server.ts    local dev / self-hosted, adds Vite or static serving + listen()
//   - api/index.ts Vercel serverless function, exports this app as the handler
// Keeping Vite out of this file matters: importing it here would pull the whole
// dev server into the serverless bundle.

import express, { Request, Response } from 'express';
import { ReleaseRecord, ReleaseStatus } from './types.js';
import { getPrismaClient, DatabaseUnavailableError } from './prisma.js';
import { requireAuth } from './auth.js';
import { findPortConflicts, PortBinding } from './compose.js';
import { isComposePath, planComposeSync, primaryComposePath } from './composeSync.js';
import { parseRecordDate } from './recordDate.js';
import { validateNote } from './releaseNote.js';
import { parseToolkitOutput } from './toolkitParse.js';
import { parseReceipt, looksLikeReceipt, RECEIPT_MAX_BYTES } from './receiptParse.js';
import { matchReceipt, receiptNote } from './receiptMatch.js';
import { imageTag } from './configDrift.js';
import { DEFAULT_DEVELOPER } from './developers.js';
import crypto from 'crypto';

const app = express();
const router = express.Router();

app.use(express.json({ limit: '10mb' }));

// Initial baseline mock data
const memoryRecords: ReleaseRecord[] = [
  {
    id: 'rel-101',
    environment: 'Prod',
    server: 'Bot-Builder',
    service: 'bot-builder-api',
    version: 'v2.4.1',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'REDIS_CLUSTER_URL updated to production primary node\nBOT_MAX_CONCURRENCY=250',
    isConfigUpdate: true,
    configDetails: 'Updated timeout thresholds in config/routing.json from 15s to 8s.',
    hasCommands: true,
    commandDetails: 'kubectl rollout restart deployment/bot-builder-api -n production',
    note: 'Hotfix release addressing connection pooling during peak hours.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 'rel-102',
    environment: 'UAT',
    server: 'Chat-Service',
    service: 'websocket-server',
    version: 'v2.4.0',
    developerName: 'Muhammad Bilal',
    status: 'PENDING',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Enabled heartbeat ping interval 25s for mobile clients.',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for regression testing before Friday cutover.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
  },
  {
    id: 'rel-103',
    environment: 'SIT',
    server: 'Bot-Builder',
    service: 'ldap-connector',
    version: 'v1.2.0',
    developerName: 'Sufyan Tariq',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d ldap-connector',
    note: 'Batch update: LDAP directory sync optimization.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'rel-104',
    environment: 'SIT',
    server: 'Database',
    service: 'redis-db',
    version: '7.2-alpine',
    developerName: 'Ali Raza',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: true,
    envDetails: 'REDIS_MAX_MEMORY=4gb\nMAXMEMORY_POLICY=allkeys-lru',
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: true,
    commandDetails: 'docker compose -f docker-compose.sit.yml up -d redis-db',
    note: 'Upgraded cache container image tag in SIT batch deployment.',
    source: 'Teams Group',
    added_by: 'A.Hameed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: 'rel-105',
    environment: 'UAT',
    server: 'ChatBot / NLU',
    service: 'retriever_api_service',
    version: 'v1.4.2',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: true,
    configDetails: 'Updated vector similarity threshold to 0.82',
    hasCommands: false,
    commandDetails: null,
    note: 'Staged for acceptance testing with new embeddings model.',
    source: 'Teams DM',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
  },
  {
    id: 'rel-106',
    environment: 'Prod',
    server: 'Chat-Service',
    service: 'chat-service',
    version: 'v2.3.8',
    developerName: 'Muhammad Bilal',
    status: 'SUCCESS',
    isBuildUpdate: true,
    isEnvUpdate: false,
    envDetails: null,
    isConfigUpdate: false,
    configDetails: null,
    hasCommands: false,
    commandDetails: null,
    note: 'Stable production baseline release.',
    source: 'SharePoint',
    added_by: 'Hanzala',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
  },
];

// Helper: turn a database failure into a response. An unreachable or
// unconfigured database is a 503; anything else (a failed query) is a 500.
// Never falls back to memoryRecords -- that fallback is only for local dev
// with no database configured, where getPrismaClient() returns null.
function sendDbError(res: Response, err: unknown, action: string) {
  if (err instanceof DatabaseUnavailableError) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'The release database is unreachable. Check DATABASE_URL.',
      reason: err.reason,
    });
  }
  console.error(`Failed to ${action}:`, err);
  return res.status(500).json({
    error: 'Internal Server Error',
    message: `Failed to ${action}.`,
  });
}

// Prisma's "record to update/delete does not exist" error.
function isRecordNotFound(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2025';
}

// Fields the edit form may change. Anything else in a PATCH body (id,
// createdAt, unknown keys) is ignored rather than handed to Prisma.
const EDITABLE_FIELDS = [
  'environment',
  'server',
  'service',
  'version',
  'developerName',
  'status',
  'note',
  'isBuildUpdate',
  'isEnvUpdate',
  'envDetails',
  'isConfigUpdate',
  'configDetails',
  'hasCommands',
  'commandDetails',
  'source',
  'added_by',
] as const;

function pickEditableFields(body: any): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!body || typeof body !== 'object') return data;
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (data.status !== undefined) {
    const raw = String(data.status).toUpperCase();
    if (['SUCCESS', 'FAILED', 'PENDING'].includes(raw)) {
      data.status = raw;
    } else {
      delete data.status;
    }
  }
  return data;
}

// 1. Health check -- also reports whether the database is actually reachable,
// so a misconfigured deployment is visible from one URL.
router.get('/health', async (req: Request, res: Response) => {
  const timestamp = new Date().toISOString();
  try {
    const prisma = await getPrismaClient();
    res.json({ status: 'ok', database: prisma ? 'connected' : 'memory', timestamp });
  } catch (err) {
    const reason = err instanceof DatabaseUnavailableError ? err.reason : 'Unknown error';
    res.status(503).json({ status: 'degraded', database: 'unavailable', reason, timestamp });
  }
});

// Every API route below requires a signed-in user (see lib/auth.ts); /health
// stays open so a deployment can be checked without logging in. Scoped by
// path, not router-wide: this router is also mounted at the root (see the
// bottom of the file), where a blanket guard would 401 the SPA's own pages
// and assets under `npm run dev` / self-hosting. New route prefixes go here.
router.use(['/records', '/catalog', '/servers', '/configs', '/health-reports', '/receipts'], requireAuth);

// 2. GET all release records
router.get('/records', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (prisma) {
      const records = await prisma.releaseRecord.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ success: true, dataSource: 'database', records });
    }
  } catch (err) {
    return sendDbError(res, err, 'load release records');
  }
  res.json({ success: true, dataSource: 'memory', records: memoryRecords });
});

// 3. GET single release record
router.get('/records/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const prisma = await getPrismaClient();
    if (prisma) {
      const record = await prisma.releaseRecord.findUnique({ where: { id } });
      if (!record) {
        return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
      }
      return res.json(record);
    }
  } catch (err) {
    return sendDbError(res, err, 'load the release record');
  }

  const record = memoryRecords.find((r) => r.id === id);
  if (!record) {
    return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
  }
  res.json(record);
});

// 4. POST create single or batch release records
router.post('/records', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const isDirectArray = Array.isArray(body) && body.length > 0;
    const isBatchServices = Boolean(body.services) && Array.isArray(body.services) && body.services.length > 0;

    const environment = String((isDirectArray ? body[0]?.environment : body.environment) || 'SIT').trim();
    const added_by = String((isDirectArray ? body[0]?.added_by : body.added_by) || 'A.Hameed').trim();
    const globalDeveloperName = String((isDirectArray ? body[0]?.developerName : body.developerName) || added_by).trim();
    const source = String((isDirectArray ? body[0]?.source : body.source) || 'Teams Group').trim();
    const note = (isDirectArray ? body[0]?.note : body.note) ? String(isDirectArray ? body[0]?.note : body.note).trim() : null;

    const isBuildUpdate = Boolean(isDirectArray ? body[0]?.isBuildUpdate ?? true : body.isBuildUpdate ?? true);
    const isEnvUpdate = Boolean(isDirectArray ? body[0]?.isEnvUpdate : body.isEnvUpdate);
    const envDetails = (isDirectArray ? body[0]?.envDetails : body.envDetails) ? String(isDirectArray ? body[0]?.envDetails : body.envDetails).trim() : null;
    const isConfigUpdate = Boolean(isDirectArray ? body[0]?.isConfigUpdate : body.isConfigUpdate);
    const configDetails = (isDirectArray ? body[0]?.configDetails : body.configDetails) ? String(isDirectArray ? body[0]?.configDetails : body.configDetails).trim() : null;
    const hasCommands = Boolean(isDirectArray ? body[0]?.hasCommands : body.hasCommands);
    const commandDetails = (isDirectArray ? body[0]?.commandDetails : body.commandDetails) ? String(isDirectArray ? body[0]?.commandDetails : body.commandDetails).trim() : null;

    const rawStatus = String((isDirectArray ? body[0]?.status : body.status) || 'PENDING').trim().toUpperCase();
    const normalizedStatus: ReleaseStatus = ['SUCCESS', 'FAILED', 'PENDING'].includes(rawStatus)
      ? (rawStatus as ReleaseStatus)
      : 'PENDING';

    const timestamp = new Date().toISOString();
    const createdRecords: ReleaseRecord[] = [];

    if (isBatchServices) {
      for (const svc of body.services) {
        const itemStatus = svc.status ? String(svc.status).trim().toUpperCase() : normalizedStatus;
        const item: ReleaseRecord = {
          id: `rel-${crypto.randomUUID()}`,
          environment: (environment as any) || 'SIT',
          server: String(svc.server || 'Server').trim(),
          service: String(svc.service || 'Service').trim(),
          version: String(svc.version || 'v1.0.0').trim(),
          developerName: String(svc.developerName || globalDeveloperName).trim(),
          status: ['SUCCESS', 'FAILED', 'PENDING'].includes(itemStatus) ? (itemStatus as ReleaseStatus) : 'PENDING',
          isBuildUpdate: svc.isBuildUpdate ?? isBuildUpdate,
          isEnvUpdate,
          envDetails,
          isConfigUpdate,
          configDetails,
          hasCommands,
          commandDetails,
          note,
          source,
          added_by,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        createdRecords.push(item);
      }
    } else if (isDirectArray) {
      for (const item of body) {
        const record: ReleaseRecord = {
          id: item.id || `rel-${crypto.randomUUID()}`,
          environment: item.environment || environment,
          server: String(item.server || 'Server').trim(),
          service: String(item.service || 'Service').trim(),
          version: String(item.version || 'v1.0.0').trim(),
          developerName: String(item.developerName || globalDeveloperName).trim(),
          status: item.status || normalizedStatus,
          isBuildUpdate: item.isBuildUpdate ?? isBuildUpdate,
          isEnvUpdate: item.isEnvUpdate ?? isEnvUpdate,
          envDetails: item.envDetails ?? envDetails,
          isConfigUpdate: item.isConfigUpdate ?? isConfigUpdate,
          configDetails: item.configDetails ?? configDetails,
          hasCommands: item.hasCommands ?? hasCommands,
          commandDetails: item.commandDetails ?? commandDetails,
          note: item.note ?? note,
          source: item.source ?? source,
          added_by: item.added_by ?? added_by,
          createdAt: item.createdAt || timestamp,
          updatedAt: item.updatedAt || timestamp,
        };
        createdRecords.push(record);
      }
    } else {
      const record: ReleaseRecord = {
        id: body.id || `rel-${crypto.randomUUID()}`,
        environment: body.environment || environment,
        server: String(body.server || 'Server').trim(),
        service: String(body.service || 'Service').trim(),
        version: String(body.version || 'v1.0.0').trim(),
        developerName: String(body.developerName || globalDeveloperName).trim(),
        status: normalizedStatus,
        isBuildUpdate,
        isEnvUpdate,
        envDetails,
        isConfigUpdate,
        configDetails,
        hasCommands,
        commandDetails,
        note,
        source,
        added_by,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      createdRecords.push(record);
    }

    // The release note is mandatory on every record (batch, array or single).
    for (const record of createdRecords) {
      const noteError = validateNote(record.note);
      if (noteError) return res.status(400).json({ error: 'Bad Request', message: noteError });
      record.note = String(record.note).trim();
    }

    // Persist to the database when one is configured; only local dev with no
    // database keeps records in memory.
    try {
      const prisma = await getPrismaClient();
      if (!prisma) {
        // Newest first, same order the per-record unshift used to produce.
        memoryRecords.unshift(...[...createdRecords].reverse());
      } else {
        await prisma.releaseRecord.createMany({
          data: createdRecords.map((r) => ({
            id: r.id,
            environment: r.environment,
            server: r.server,
            service: r.service,
            version: r.version,
            developerName: r.developerName,
            status: r.status,
            isBuildUpdate: r.isBuildUpdate,
            isEnvUpdate: r.isEnvUpdate,
            envDetails: r.envDetails,
            isConfigUpdate: r.isConfigUpdate,
            configDetails: r.configDetails,
            hasCommands: r.hasCommands,
            commandDetails: r.commandDetails,
            note: r.note,
            source: r.source,
            added_by: r.added_by,
            createdAt: new Date(r.createdAt),
            updatedAt: new Date(r.updatedAt),
          })),
        });
      }
    } catch (err) {
      return sendDbError(res, err, 'save release records');
    }

    res.status(201).json({
      success: true,
      message: `Successfully created ${createdRecords.length} release record(s)`,
      count: createdRecords.length,
      records: createdRecords,
    });
  } catch (err: any) {
    console.error('Failed to create records:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. PATCH update release record
router.patch('/records/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = pickEditableFields(req.body);

  // A PATCH that does not touch the note keeps working; one that sends it must
  // not blank it out.
  if (req.body?.note !== undefined) {
    const noteError = validateNote(req.body.note);
    if (noteError) return res.status(400).json({ error: 'Bad Request', message: noteError });
    data.note = String(req.body.note).trim();
  }

  // The deployment date can be corrected or backdated (createdAt is what the
  // feed and Drift Matrix order by).
  if (req.body?.createdAt !== undefined) {
    const createdAt = parseRecordDate(req.body.createdAt);
    if (!createdAt) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Deployment date is invalid (must be a real date after 2000 and not in the future).',
      });
    }
    data.createdAt = createdAt;
  }

  try {
    const prisma = await getPrismaClient();
    if (prisma) {
      // The database is the source of truth: update there directly. (Looking
      // the id up in memoryRecords first would 404 every real database row.)
      const record = await prisma.releaseRecord.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
      });
      return res.json({ success: true, record });
    }
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
    }
    return sendDbError(res, err, 'update the release record');
  }

  const idx = memoryRecords.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
  }
  const updated: ReleaseRecord = {
    ...memoryRecords[idx],
    ...(data as Partial<ReleaseRecord>),
    ...(data.createdAt instanceof Date ? { createdAt: data.createdAt.toISOString() } : {}),
    updatedAt: new Date().toISOString(),
  };
  memoryRecords[idx] = updated;
  res.json({ success: true, record: updated });
});

// 6. DELETE release record
router.delete('/records/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const prisma = await getPrismaClient();
    if (prisma) {
      await prisma.releaseRecord.delete({ where: { id } });
      return res.json({ success: true, message: `Record ${id} deleted.` });
    }
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
    }
    return sendDbError(res, err, 'delete the release record');
  }

  const idx = memoryRecords.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
  }
  memoryRecords.splice(idx, 1);
  res.json({ success: true, message: `Record ${id} deleted.` });
});

// ── Service catalog ─────────────────────────────────────────────────────────
// Servers (groups) and services for the Add Record form, plus the image and
// host ports each service has per environment. Those are synced from the
// latest docker-compose.yml in the Config Vault (syncRoleFromVault below), so
// the catalog is never typed in twice. Services in no compose file can still
// be added by hand. Local dev without a database has no catalog: GET answers dataSource
// 'memory' with no services and the UI falls back to config/services.json.

const CATALOG_ENVIRONMENTS = ['SIT', 'UAT', 'Prod'];

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

function cleanLabel(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v && v.length <= max ? v : null;
}

async function requireCatalogDb(res: Response) {
  const prisma = await getPrismaClient();
  if (!prisma) {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Editing the catalog needs a database. Set DATABASE_URL.',
    });
  }
  return prisma;
}

router.get('/catalog', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) {
      return res.json({ success: true, dataSource: 'memory', services: [], syncState: [] });
    }
    const services = await prisma.service.findMany({
      orderBy: [{ server: 'asc' }, { name: 'asc' }],
      include: {
        ports: { orderBy: [{ environment: 'asc' }, { host: 'asc' }, { hostPort: 'asc' }] },
        deployments: {
          orderBy: { environment: 'asc' },
          select: {
            environment: true,
            role: true,
            composeKey: true,
            containerName: true,
            image: true,
            tag: true,
            syncedAt: true,
            sourceVersion: { select: { version: true, createdAt: true } },
          },
        },
      },
    });
    res.json({ success: true, dataSource: 'database', services, syncState: await composeSyncState(prisma) });
  } catch (err) {
    if (isMissingVaultSyncSchema(err)) {
      return res.status(503).json({ error: 'Service Unavailable', message: VAULT_SYNC_SCHEMA_MESSAGE });
    }
    return sendDbError(res, err, 'load the service catalog');
  }
});

router.post('/catalog/services', async (req: Request, res: Response) => {
  const server = cleanLabel(req.body?.server);
  const name = cleanLabel(req.body?.name);
  if (!server || !name) {
    return res.status(400).json({ error: 'Bad Request', message: 'server and name are required (max 100 characters).' });
  }
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const service = await prisma.service.create({ data: { server, name }, include: { ports: true } });
    res.status(201).json({ success: true, service });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Conflict', message: `${server} / ${name} is already in the catalog.` });
    }
    return sendDbError(res, err, 'add the service');
  }
});

router.patch('/catalog/services/:id', async (req: Request, res: Response) => {
  const data: { server?: string; name?: string } = {};
  for (const key of ['server', 'name'] as const) {
    if (req.body?.[key] === undefined) continue;
    const v = cleanLabel(req.body[key]);
    if (!v) {
      return res.status(400).json({ error: 'Bad Request', message: `${key} must be 1-100 characters.` });
    }
    data[key] = v;
  }
  if (!data.server && !data.name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Nothing to update.' });
  }
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    if (await refuseIfSynced(prisma, req.params.id, res)) return;
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data,
      include: { ports: true },
    });
    res.json({ success: true, service });
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: 'Service not found.' });
    }
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Conflict', message: 'A service with that group and name already exists.' });
    }
    return sendDbError(res, err, 'update the service');
  }
});

router.delete('/catalog/services/:id', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    if (await refuseIfSynced(prisma, req.params.id, res)) return;
    await prisma.service.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: 'Service not found.' });
    }
    return sendDbError(res, err, 'delete the service');
  }
});

// A service with vault deployments is owned by the vault: renaming or
// deleting it here would be undone by the next sync.
async function refuseIfSynced(prisma: any, serviceId: string, res: Response): Promise<boolean> {
  const synced = await prisma.serviceDeployment.count({ where: { serviceId } });
  if (!synced) return false;
  res.status(409).json({
    error: 'Conflict',
    message: 'This service is synced from the Config Vault. Change docker-compose.yml on the Configs page instead.',
  });
  return true;
}

// ── Vault -> catalog sync ──────────────────────────────────────────────────
// The latest docker-compose.yml of an environment + role (parsed by
// lib/composeSync.ts, with ${VAR}s from that role's .env) replaces that
// environment's images and published ports in the catalog. Every row it
// writes carries the vault file + version it came from, so a re-sync replaces
// its own rows instead of duplicating them. Legacy rows from the old manual
// import (no source file) are replaced for the services in the file.

// The tables 006_vault_sync.sql adds. Until it has run, Prisma reports a
// missing table (P2021) or column (P2022).
function isMissingVaultSyncSchema(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'P2021' || code === 'P2022';
}
const VAULT_SYNC_SCHEMA_MESSAGE = 'The database is missing the vault-sync tables. Run prisma/manual/006_vault_sync.sql in Supabase.';

type SyncOutcome =
  | {
      status: 'synced';
      environment: string;
      role: string;
      path: string;
      version: number;
      services: number;
      created: string[];
      ports: number;
      warnings: string[];
    }
  | { status: 'failed'; environment: string; role: string; path: string | null; error: string }
  | { status: 'skipped'; environment: string; role: string; reason: string };

async function latestConfigVersion(db: any, key: { environment: string; role: string; path: string }) {
  const file = await db.configFile.findUnique({
    where: { environment_role_path: key },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, content: true } } },
  });
  return file?.versions[0] ? { file, version: file.versions[0] } : null;
}

async function syncRoleFromVault(prisma: any, environment: string, role: string): Promise<SyncOutcome> {
  const siblings = await prisma.configFile.findMany({ where: { environment, role }, select: { path: true } });
  const path = primaryComposePath(siblings.map((f: any) => f.path));
  const compose = path ? await latestConfigVersion(prisma, { environment, role, path }) : null;
  if (!path || !compose) return { status: 'skipped', environment, role, reason: 'No compose file in the vault.' };

  const dotEnv = await latestConfigVersion(prisma, { environment, role, path: '.env' });
  const catalog = await prisma.service.findMany({ where: { server: role }, select: { name: true } });
  const plan = planComposeSync({
    compose: compose.version.content,
    dotEnv: dotEnv?.version.content ?? null,
    catalogNames: catalog.map((s: any) => s.name),
  });
  const { file, version } = compose;
  if (!plan.ok) {
    const error = plan.error ?? 'The compose file could not be read.';
    await prisma.configFile.update({ where: { id: file.id }, data: { syncError: error.slice(0, 500) } });
    return { status: 'failed', environment, role, path, error };
  }

  const host = role; // synced ports are labelled by role; the IP is in the server registry
  return prisma.$transaction(
    async (tx: any): Promise<SyncOutcome> => {
      // A newer version landed while this one was parsed: its own save syncs it.
      const head = await tx.configFileVersion.findFirst({
        where: { fileId: file.id },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (head?.id !== version.id) return { status: 'skipped', environment, role, reason: 'Superseded by a newer version.' };

      const names = plan.services.map((s) => s.name);
      const existing = await tx.service.findMany({ where: { server: role, name: { in: names } }, select: { name: true, image: true } });
      const before = new Map<string, string | null>(existing.map((s: any) => [s.name, s.image]));
      await tx.service.createMany({
        data: plan.services.filter((s) => !before.has(s.name)).map((s) => ({ server: role, name: s.name, image: s.image })),
        skipDuplicates: true,
      });
      const rows = await tx.service.findMany({ where: { server: role, name: { in: names } }, select: { id: true, name: true } });
      const idOf = new Map<string, string>(rows.map((s: any) => [s.name, s.id]));
      const ids = [...idOf.values()];

      // Per-environment images: replace what this file, or an earlier source
      // for these services in this environment, produced before.
      await tx.serviceDeployment.deleteMany({
        where: { OR: [{ sourceFileId: file.id }, { environment, serviceId: { in: ids } }] },
      });
      await tx.serviceDeployment.createMany({
        data: plan.services.map((s) => ({
          serviceId: idOf.get(s.name)!,
          environment,
          role,
          composeKey: s.composeKey,
          containerName: s.containerName,
          image: s.image,
          tag: s.tag,
          sourceFileId: file.id,
          sourceVersionId: version.id,
        })),
      });

      // Ports: drop this file's previous rows, plus legacy manual-import rows
      // of the same services in this environment (any host label).
      await tx.servicePort.deleteMany({
        where: { environment, OR: [{ sourceFileId: file.id }, { sourceFileId: null, serviceId: { in: ids } }] },
      });
      const portRows = plan.services.flatMap((s) =>
        s.ports.map((p) => ({
          ...p,
          environment,
          host,
          serviceId: idOf.get(s.name)!,
          sourceFileId: file.id,
          sourceVersionId: version.id,
        }))
      );
      if (portRows.length > 0) await tx.servicePort.createMany({ data: portRows, skipDuplicates: true });

      // Back-compat: Service.image keeps the most recently synced image.
      for (const s of plan.services) {
        if (s.image && before.has(s.name) && before.get(s.name) !== s.image) {
          await tx.service.update({ where: { id: idOf.get(s.name) }, data: { image: s.image } });
        }
      }

      // Shared host ports on this role (fine behind a reverse proxy) are saved
      // and reported, as the old import did.
      const others = await tx.servicePort.findMany({
        where: { environment, host, serviceId: { notIn: ids } },
        include: { service: { select: { name: true } } },
      });
      const clashes = findPortConflicts([
        ...others.map((p: any): PortBinding => ({ service: p.service.name, environment, host, hostPort: p.hostPort, protocol: p.protocol })),
        ...plan.services.flatMap((s) =>
          s.ports.map((p): PortBinding => ({ service: s.name, environment, host, hostPort: p.hostPort, protocol: p.protocol }))
        ),
      ]);

      await tx.configFile.update({
        where: { id: file.id },
        data: { syncedVersion: version.version, syncedAt: new Date(), syncError: null },
      });
      return {
        status: 'synced',
        environment,
        role,
        path,
        version: version.version,
        services: plan.services.length,
        created: names.filter((n) => !before.has(n)),
        ports: portRows.length,
        warnings: [
          ...plan.warnings,
          ...clashes.map((c) => `Host port ${c.hostPort}/${c.protocol} is shared by ${c.services.join(', ')}`),
        ],
      };
    },
    // Several round trips through the pooler; the 5s default is tight.
    { timeout: 20_000, maxWait: 10_000 }
  );
}

// Run after a vault save or delete. Never throws: the vault change already
// happened and must not be reported as failed because the catalog lagged.
async function syncAfterVaultChange(prisma: any, environment: string, role: string): Promise<SyncOutcome> {
  try {
    return await syncRoleFromVault(prisma, environment, role);
  } catch (err) {
    console.error('[vault-sync] failed:', (err as Error)?.name ?? 'Error'); // never log file contents
    return {
      status: 'failed',
      environment,
      role,
      path: null,
      error: isMissingVaultSyncSchema(err)
        ? VAULT_SYNC_SCHEMA_MESSAGE
        : 'Saved to the vault, but the catalog sync failed. Use "Resync from vault" on the Infrastructure page.',
    };
  }
}

// Sync state of each environment + role's primary compose file, for the
// badge on the Infrastructure page.
async function composeSyncState(prisma: any) {
  const files = await prisma.configFile.findMany({
    select: {
      id: true,
      environment: true,
      role: true,
      path: true,
      syncedVersion: true,
      syncedAt: true,
      syncError: true,
      versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, createdAt: true } },
    },
  });
  const groups = new Map<string, any[]>();
  for (const f of files) {
    const key = `${f.environment}\u0000${f.role}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const out = [];
  for (const list of groups.values()) {
    const path = primaryComposePath(list.map((f: any) => f.path));
    const f = list.find((x: any) => x.path === path);
    if (!f) continue;
    out.push({
      fileId: f.id,
      environment: f.environment,
      role: f.role,
      path: f.path,
      latestVersion: f.versions[0]?.version ?? null,
      latestAt: f.versions[0]?.createdAt ?? null,
      syncedVersion: f.syncedVersion,
      syncedAt: f.syncedAt,
      syncError: f.syncError,
    });
  }
  return out.sort(
    (a, b) => (ENV_ORDER[a.environment] ?? 9) - (ENV_ORDER[b.environment] ?? 9) || a.role.localeCompare(b.role)
  );
}

// ── Server registry ────────────────────────────────────────────────────────
// One row per environment + role (seeded by prisma/manual/002_server_registry.sql).
// Feeds the patch runbook: expected IP for the environment guard, compose
// folder, run-as account. Rows are edited, not created or deleted, here.

const SERVER_TEXT_FIELDS = ['ip', 'domain', 'composePath', 'runAs', 'access', 'toolkitVersion', 'notes'] as const;
const ENV_ORDER: Record<string, number> = { SIT: 0, UAT: 1, Prod: 2 };

router.get('/servers', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) {
      return res.json({ success: true, dataSource: 'memory', servers: [] });
    }
    const servers = await prisma.serverNode.findMany({ orderBy: [{ role: 'asc' }] });
    servers.sort((a: any, b: any) => (ENV_ORDER[a.environment] ?? 9) - (ENV_ORDER[b.environment] ?? 9));
    res.json({ success: true, dataSource: 'database', servers });
  } catch (err) {
    return sendDbError(res, err, 'load the server registry');
  }
});

router.patch('/servers/:id', async (req: Request, res: Response) => {
  const data: Record<string, unknown> = {};
  for (const key of SERVER_TEXT_FIELDS) {
    if (req.body?.[key] === undefined) continue;
    const raw = req.body[key];
    if (raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'Bad Request', message: `${key} must be text.` });
    }
    const v = raw === null ? '' : raw.trim();
    if (v.length > (key === 'notes' ? 1000 : 200)) {
      return res.status(400).json({ error: 'Bad Request', message: `${key} is too long.` });
    }
    data[key] = v || null; // blank = unknown
  }
  if (data.ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(data.ip))) {
    return res.status(400).json({ error: 'Bad Request', message: 'ip must be an IPv4 address like 10.42.42.250.' });
  }
  if (req.body?.envFiles !== undefined) {
    const files = req.body.envFiles;
    if (!Array.isArray(files) || files.length > 10 || files.some((f: unknown) => typeof f !== 'string' || !/^[\w.-]{1,60}$/.test(f))) {
      return res.status(400).json({ error: 'Bad Request', message: 'envFiles must be a list of file names like .env_fbl.' });
    }
    data.envFiles = files;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Nothing to update.' });
  }
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const server = await prisma.serverNode.update({ where: { id: req.params.id }, data });
    res.json({ success: true, server });
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: 'Server not found.' });
    }
    return sendDbError(res, err, 'update the server');
  }
});

// ── Config vault ───────────────────────────────────────────────────────────
// Copies of each server's docker-compose / env files per environment + role,
// with every save kept as a new version. Contents are stored exactly as sent
// and are never logged.

const CONFIG_MAX_BYTES = 1_000_000;
const CONFIG_PATH = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/; // a plain file name, no folders
const VERSION_META = {
  id: true,
  version: true,
  sha256: true,
  sizeBytes: true,
  source: true,
  note: true,
  createdBy: true,
  createdAt: true,
} as const;

router.get('/configs', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) return res.json({ success: true, dataSource: 'memory', files: [] });
    const files = await prisma.configFile.findMany({
      orderBy: [{ role: 'asc' }, { path: 'asc' }],
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1, select: VERSION_META },
        _count: { select: { versions: true } },
      },
    });
    res.json({
      success: true,
      dataSource: 'database',
      files: files.map((f: any) => ({
        id: f.id,
        environment: f.environment,
        role: f.role,
        path: f.path,
        latest: f.versions[0] ?? null,
        versionCount: f._count.versions,
      })),
    });
  } catch (err) {
    return sendDbError(res, err, 'load the config files');
  }
});

router.get('/configs/:fileId/versions', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const versions = await prisma.configFileVersion.findMany({
      where: { fileId: req.params.fileId },
      orderBy: { version: 'desc' },
      select: VERSION_META,
    });
    res.json({ success: true, versions });
  } catch (err) {
    return sendDbError(res, err, 'load the version history');
  }
});

router.get('/configs/versions/:id', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const version = await prisma.configFileVersion.findUnique({
      where: { id: req.params.id },
      include: { file: { select: { id: true, environment: true, role: true, path: true } } },
    });
    if (!version) return res.status(404).json({ error: 'Not Found', message: 'Version not found.' });
    res.json({ success: true, version });
  } catch (err) {
    return sendDbError(res, err, 'load the file');
  }
});

router.post('/configs', async (req: Request, res: Response) => {
  const environment = cleanLabel(req.body?.environment);
  const role = cleanLabel(req.body?.role);
  const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  const content = req.body?.content;
  const source = req.body?.source === 'edit' ? 'edit' : 'upload';
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;

  if (!environment || !CATALOG_ENVIRONMENTS.includes(environment)) {
    return res.status(400).json({ error: 'Bad Request', message: `environment must be one of ${CATALOG_ENVIRONMENTS.join(', ')}.` });
  }
  if (!role) return res.status(400).json({ error: 'Bad Request', message: 'role is required.' });
  if (!CONFIG_PATH.test(path)) {
    return res.status(400).json({ error: 'Bad Request', message: 'File name must be a plain name like docker-compose.yml or .env_fbl (no folders).' });
  }
  if (typeof content !== 'string') return res.status(400).json({ error: 'Bad Request', message: 'content must be text.' });
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  if (sizeBytes > CONFIG_MAX_BYTES) {
    return res.status(413).json({ error: 'Payload Too Large', message: 'Config files are limited to 1 MB.' });
  }
  if (content.includes('\u0000')) {
    return res.status(400).json({ error: 'Bad Request', message: 'That looks like a binary file, not a text config.' });
  }
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  const createdBy = req.user?.email || 'local-dev';

  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const result = await prisma.$transaction(async (tx: any) => {
      const file = await tx.configFile.upsert({
        where: { environment_role_path: { environment, role, path } },
        create: { environment, role, path },
        update: {},
      });
      const latest = await tx.configFileVersion.findFirst({
        where: { fileId: file.id },
        orderBy: { version: 'desc' },
        select: { ...VERSION_META, content: true },
      });
      if (latest && latest.sha256 === sha256) {
        const { content: _c, ...meta } = latest;
        return { file, version: meta, unchanged: true, previousContent: null };
      }
      const version = await tx.configFileVersion.create({
        data: { fileId: file.id, version: (latest?.version ?? 0) + 1, content, sha256, sizeBytes, source, note, createdBy },
        select: VERSION_META,
      });
      return { file, version, unchanged: false, previousContent: latest?.content ?? null };
    });
    // Single source of truth: a compose file, or the .env it reads ${VAR}s
    // from, feeds the catalog. Awaited, not fire-and-forget: Vercel freezes the
    // function once the response is sent. Re-saving an unchanged file still
    // syncs, so a re-upload retries a sync that failed before.
    const sync = isComposePath(path) || path === '.env' ? await syncAfterVaultChange(prisma, environment, role) : null;
    res.status(result.unchanged ? 200 : 201).json({
      success: true,
      unchanged: result.unchanged,
      file: { id: result.file.id, environment, role, path },
      version: result.version,
      // Lets the client list image-tag changes without a second request.
      previousContent: result.previousContent,
      sync,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Conflict', message: 'Someone saved this file at the same moment. Reload and try again.' });
    }
    return sendDbError(res, err, 'save the config file');
  }
});

// Re-apply the vault to the catalog: every environment + role, or one when
// the body names it. Backfills files saved before the sync existed and
// retries failed syncs.
router.post('/configs/sync', async (req: Request, res: Response) => {
  const environment = cleanLabel(req.body?.environment);
  const role = cleanLabel(req.body?.role);
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const pairs: { environment: string; role: string }[] =
      environment && role
        ? [{ environment, role }]
        : await prisma.configFile.findMany({ distinct: ['environment', 'role'], select: { environment: true, role: true } });
    const results: SyncOutcome[] = [];
    // Sequential: each sync holds one pooled connection for its transaction.
    for (const p of pairs) results.push(await syncAfterVaultChange(prisma, p.environment, p.role));
    res.json({ success: true, results });
  } catch (err) {
    return sendDbError(res, err, 'sync the catalog from the vault');
  }
});

router.delete('/configs/:fileId', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    // Deleting a compose file cascades to the deployments and ports it
    // produced; another compose file of that role (if any) then takes over.
    const file = await prisma.configFile.delete({ where: { id: req.params.fileId } });
    const sync = isComposePath(file.path) || file.path === '.env' ? await syncAfterVaultChange(prisma, file.environment, file.role) : null;
    res.json({ success: true, sync });
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json({ error: 'Not Found', message: 'File not found.' });
    return sendDbError(res, err, 'delete the config file');
  }
});

// ── Health reports ─────────────────────────────────────────────────────────
// ALARA toolkit output carried out of the air gap: .snapshot files and
// `alara_server.sh status` / `doctor` output. Parsed here (lib/toolkitParse)
// so only recognised output is stored; environment and role come from the
// content itself, never from the client.

const HEALTH_MAX_BYTES = 1_000_000;
const HEALTH_META = {
  id: true,
  environment: true,
  role: true,
  kind: true,
  reportedAt: true,
  host: true,
  uploadedBy: true,
  createdAt: true,
} as const;

router.get('/health-reports', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) return res.json({ success: true, dataSource: 'memory', reports: [] });
    // Latest report per environment + role + kind (parsed, without raw text).
    const reports = await prisma.healthReport.findMany({
      distinct: ['environment', 'role', 'kind'],
      orderBy: [{ environment: 'asc' }, { role: 'asc' }, { kind: 'asc' }, { reportedAt: 'desc' }],
      select: { ...HEALTH_META, parsed: true },
    });
    res.json({ success: true, dataSource: 'database', reports });
  } catch (err) {
    return sendDbError(res, err, 'load health reports');
  }
});

router.get('/health-reports/history', async (req: Request, res: Response) => {
  const where: Record<string, string> = {};
  for (const key of ['environment', 'role', 'kind'] as const) {
    if (typeof req.query[key] === 'string' && req.query[key]) where[key] = req.query[key] as string;
  }
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const reports = await prisma.healthReport.findMany({ where, orderBy: { reportedAt: 'desc' }, take: 50, select: HEALTH_META });
    res.json({ success: true, reports });
  } catch (err) {
    return sendDbError(res, err, 'load the report history');
  }
});

router.get('/health-reports/:id', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const report = await prisma.healthReport.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Not Found', message: 'Report not found.' });
    res.json({ success: true, report });
  } catch (err) {
    return sendDbError(res, err, 'load the report');
  }
});

router.post('/health-reports', async (req: Request, res: Response) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Bad Request', message: 'Paste or upload the toolkit output as text.' });
  }
  if (Buffer.byteLength(text, 'utf8') > HEALTH_MAX_BYTES) {
    return res.status(413).json({ error: 'Payload Too Large', message: 'Reports are limited to 1 MB.' });
  }
  if (looksLikeReceipt(text)) {
    return res.status(400).json({ error: 'Bad Request', message: 'This is a deployment receipt. Upload it as a receipt so it can close the matching release records.' });
  }
  let parsed;
  try {
    parsed = parseToolkitOutput(text);
  } catch (err) {
    return res.status(400).json({ error: 'Bad Request', message: (err as Error).message });
  }
  const generated = parsed.kind === 'snapshot' && parsed.generated ? new Date(parsed.generated) : null;
  const reportedAt = generated && !Number.isNaN(generated.getTime()) ? generated : new Date();
  const host = parsed.kind === 'snapshot' ? parsed.hostname : parsed.ip;

  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const existing = await prisma.healthReport.findFirst({
      where: { environment: parsed.environment, role: parsed.role, kind: parsed.kind, raw: text },
      select: HEALTH_META,
    });
    if (existing) return res.json({ success: true, unchanged: true, report: existing });
    const report = await prisma.healthReport.create({
      data: {
        environment: parsed.environment,
        role: parsed.role,
        kind: parsed.kind,
        reportedAt,
        host,
        parsed: parsed as any,
        raw: text,
        uploadedBy: req.user?.email || 'local-dev',
      },
      select: { ...HEALTH_META, parsed: true },
    });
    res.status(201).json({ success: true, unchanged: false, report });
  } catch (err) {
    return sendDbError(res, err, 'save the report');
  }
});

router.delete('/health-reports/:id', async (req: Request, res: Response) => {
  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    await prisma.healthReport.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (isRecordNotFound(err)) return res.status(404).json({ error: 'Not Found', message: 'Report not found.' });
    return sendDbError(res, err, 'delete the report');
  }
});

// ── Deployment receipts ─────────────────────────────────────────────────────
// A receipt is the small JSON file a generated script writes after
// `alara_server.sh patch apply` (see lib/receiptParse.ts). Uploading it:
//   preview: true  -> parse + match only, nothing is written
//   otherwise      -> store it (a HealthReport of kind "receipt", so its
//                     state.after also feeds the Health board and the Drift
//                     Matrix), set the matching PENDING records' status from the
//                     toolkit's RESULT, and optionally create records for applied
//                     images nobody had logged.
// The status is always derived here from the receipt's own content; the client
// only chooses WHICH of the server-found matches to apply.

const RECEIPT_RECORD_FIELDS = { id: true, environment: true, server: true, service: true, version: true, status: true, note: true } as const;

async function receiptCandidates(prisma: any, role: string) {
  return prisma.releaseRecord.findMany({ where: { server: role }, orderBy: { createdAt: 'desc' }, take: 2000, select: RECEIPT_RECORD_FIELDS });
}

router.post('/receipts', async (req: Request, res: Response) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Bad Request', message: 'Upload the receipt file (alara/receipts/*.json) as text.' });
  }
  if (Buffer.byteLength(text, 'utf8') > RECEIPT_MAX_BYTES) {
    return res.status(413).json({ error: 'Payload Too Large', message: 'Receipts are limited to 1 MB.' });
  }
  let receipt;
  try {
    receipt = parseReceipt(text);
  } catch (err) {
    return res.status(400).json({ error: 'Bad Request', message: (err as Error).message });
  }
  const preview = req.body?.preview === true;
  const pickIds = Array.isArray(req.body?.recordIds) ? new Set<string>(req.body.recordIds.filter((x: unknown) => typeof x === 'string')) : null;
  const createServices = Array.isArray(req.body?.createServices) ? new Set<string>(req.body.createServices.filter((x: unknown) => typeof x === 'string')) : new Set<string>();

  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;
    const existing = await prisma.healthReport.findFirst({
      where: { environment: receipt.environment, role: receipt.role, kind: 'receipt', raw: text },
      select: { id: true, createdAt: true, uploadedBy: true },
    });
    const found = matchReceipt(receipt, await receiptCandidates(prisma, receipt.role));
    const summary = {
      receipt: { ...receipt, composeDiff: undefined, containers: receipt.containers.length },
      duplicate: existing ? { id: existing.id, uploadedBy: existing.uploadedBy, createdAt: existing.createdAt } : null,
      matches: found.matches.map((m) => ({
        recordId: m.record.id,
        service: m.record.service,
        version: m.record.version,
        via: m.via,
        currentStatus: String(m.record.status).toUpperCase(),
        newStatus: m.newStatus,
      })),
      unmatchedImages: found.unmatchedImages.map((i) => ({ service: i.service, ref: i.newRef, version: imageTag(i.newRef) })),
      canCreate: receipt.verdict !== 'pending',
    };
    if (preview) return res.json({ success: true, preview: true, ...summary });
    if (existing) return res.json({ success: true, unchanged: true, ...summary, updated: [], created: [] });

    // Apply: only matches the server found itself, optionally narrowed by the client.
    const chosen = found.matches.filter((m) => !pickIds || pickIds.has(m.record.id));
    const status = receipt.verdict === 'success' ? 'SUCCESS' : receipt.verdict === 'failed' ? 'FAILED' : null;
    const line = receiptNote(receipt);
    const toCreate = status ? found.unmatchedImages.filter((i) => createServices.has(i.service)) : [];
    const who = req.user?.email || 'local-dev';

    const result = await prisma.$transaction(async (tx: any) => {
      const updated: any[] = [];
      for (const m of chosen) {
        const note = m.record.note ? `${m.record.note}\n${line}` : line;
        updated.push(
          await tx.releaseRecord.update({
            where: { id: m.record.id },
            data: { ...(m.newStatus ? { status: m.newStatus } : {}), note, updatedAt: new Date() },
          })
        );
      }
      const created: any[] = [];
      for (const img of toCreate) {
        created.push(
          await tx.releaseRecord.create({
            data: {
              environment: receipt.environment,
              server: receipt.role,
              service: img.service,
              version: imageTag(img.newRef) ?? img.newRef,
              developerName: DEFAULT_DEVELOPER,
              status,
              isBuildUpdate: true,
              note: `Logged from a deployment receipt (${receipt.patchId}).\n${line}`,
              source: 'Receipt',
              added_by: who,
              createdAt: new Date(receipt.finishedAt),
            },
          })
        );
      }
      const linked = [...updated, ...created].map((r) => r.id);
      const report = await tx.healthReport.create({
        data: {
          environment: receipt.environment,
          role: receipt.role,
          kind: 'receipt',
          reportedAt: new Date(receipt.finishedAt),
          host: receipt.host,
          parsed: { ...receipt, linkedRecordIds: linked } as any,
          raw: text,
          uploadedBy: who,
        },
        select: { id: true },
      });
      return { updated, created, receiptId: report.id };
    });
    res.status(201).json({ success: true, unchanged: false, ...summary, ...result });
  } catch (err) {
    return sendDbError(res, err, 'save the receipt');
  }
});

// Receipts linked to one release record (shown on its Audit Log card).
router.get('/receipts', async (req: Request, res: Response) => {
  const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : '';
  if (!recordId) return res.status(400).json({ error: 'Bad Request', message: 'recordId is required.' });
  try {
    const prisma = await getPrismaClient();
    if (!prisma) return res.json({ success: true, receipts: [] });
    const receipts = await prisma.healthReport.findMany({
      where: { kind: 'receipt', parsed: { path: ['linkedRecordIds'], array_contains: [recordId] } },
      orderBy: { reportedAt: 'desc' },
      take: 5,
      select: { id: true, reportedAt: true, host: true, uploadedBy: true, parsed: true },
    });
    res.json({ success: true, receipts });
  } catch (err) {
    return sendDbError(res, err, 'load receipts');
  }
});

// Mount the API. Vercel's rewrite may or may not preserve the /api prefix by the
// time the serverless function sees the URL, so mount both ways: whichever path
// arrives, exactly one mount matches and responds.
app.use('/api', router);
app.use(router);

export { app };
export default app;
