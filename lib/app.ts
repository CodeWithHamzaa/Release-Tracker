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
router.use(['/records', '/catalog'], requireAuth);

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
// Servers (groups) and services for the Add Record form, plus the host ports
// each service publishes per environment + host (from docker-compose imports).
// Local dev without a database has no catalog: GET answers dataSource
// 'memory' with no services and the UI falls back to config/services.json.

const CATALOG_ENVIRONMENTS = ['SIT', 'UAT', 'Prod'];
const CATALOG_PROTOCOLS = ['tcp', 'udp', 'sctp'];

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

function cleanLabel(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v && v.length <= max ? v : null;
}

function isPort(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 65535;
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
      return res.json({ success: true, dataSource: 'memory', services: [] });
    }
    const services = await prisma.service.findMany({
      orderBy: [{ server: 'asc' }, { name: 'asc' }],
      include: {
        ports: { orderBy: [{ environment: 'asc' }, { host: 'asc' }, { hostPort: 'asc' }] },
      },
    });
    res.json({ success: true, dataSource: 'database', services });
  } catch (err) {
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
    await prisma.service.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    if (isRecordNotFound(err)) {
      return res.status(404).json({ error: 'Not Found', message: 'Service not found.' });
    }
    return sendDbError(res, err, 'delete the service');
  }
});

// Save a parsed docker-compose file: upsert its services and replace their
// published ports on this environment + host. Ports of services NOT in the
// file are kept (one host can run several compose files); if the file would
// reuse one of those ports, nothing is saved and the clash is returned (409).
router.post('/catalog/import', async (req: Request, res: Response) => {
  const environment = cleanLabel(req.body?.environment);
  const host = cleanLabel(req.body?.host);
  const incoming = Array.isArray(req.body?.services) ? req.body.services : null;
  if (!environment || !CATALOG_ENVIRONMENTS.includes(environment)) {
    return res.status(400).json({ error: 'Bad Request', message: `environment must be one of ${CATALOG_ENVIRONMENTS.join(', ')}.` });
  }
  if (!host) {
    return res.status(400).json({ error: 'Bad Request', message: 'host is required (max 100 characters).' });
  }
  if (!incoming || incoming.length === 0 || incoming.length > 200) {
    return res.status(400).json({ error: 'Bad Request', message: 'services must list 1-200 services.' });
  }

  type ImportPort = { hostPort: number; containerPort: number; protocol: string; hostIp: string | null };
  const services: { server: string; name: string; image: string | null; ports: ImportPort[] }[] = [];
  for (const raw of incoming) {
    const server = cleanLabel(raw?.server);
    const name = cleanLabel(raw?.name);
    if (!server || !name) {
      return res.status(400).json({ error: 'Bad Request', message: 'Every service needs a server (group) and name.' });
    }
    if (services.some((s) => s.name === name && s.server === server)) {
      return res.status(400).json({ error: 'Bad Request', message: `${name} is listed twice.` });
    }
    const ports: ImportPort[] = [];
    for (const p of Array.isArray(raw.ports) ? raw.ports : []) {
      const protocol = String(p?.protocol || 'tcp').toLowerCase();
      if (!isPort(p?.hostPort) || !isPort(p?.containerPort) || !CATALOG_PROTOCOLS.includes(protocol)) {
        return res.status(400).json({ error: 'Bad Request', message: `${name} has an invalid port.` });
      }
      // The same binding listed twice in one service is harmless; keep one.
      if (!ports.some((q) => q.hostPort === p.hostPort && q.protocol === protocol)) {
        ports.push({ hostPort: p.hostPort, containerPort: p.containerPort, protocol, hostIp: cleanLabel(p.hostIp) });
      }
    }
    services.push({ server, name, image: cleanLabel(raw.image, 300), ports });
  }

  const inFile = findPortConflicts(
    services.flatMap((s) => s.ports.map((p): PortBinding => ({ service: s.name, environment, host, hostPort: p.hostPort, protocol: p.protocol })))
  );
  if (inFile.length > 0) {
    return res.status(409).json({ error: 'Conflict', message: 'The file binds the same host port twice.', conflicts: inFile });
  }

  try {
    const prisma = await requireCatalogDb(res);
    if (!prisma) return;

    const result = await prisma.$transaction(
      async (tx: any) => {
        const keys = services.map((s) => ({ server: s.server, name: s.name }));
        const existing = await tx.service.findMany({ where: { OR: keys } });
        const existingKey = new Set(existing.map((s: any) => `${s.server}\u0000${s.name}`));
        const toCreate = services.filter((s) => !existingKey.has(`${s.server}\u0000${s.name}`));
        if (toCreate.length > 0) {
          await tx.service.createMany({
            data: toCreate.map((s) => ({ server: s.server, name: s.name, image: s.image })),
            skipDuplicates: true,
          });
        }
        const rows = await tx.service.findMany({ where: { OR: keys } });
        const idOf = new Map<string, string>(rows.map((s: any) => [`${s.server}\u0000${s.name}`, s.id]));
        const imageOf = new Map<string, string | null>(rows.map((s: any) => [s.id, s.image]));
        const ids = [...idOf.values()];

        // Clashes with ports already saved for OTHER services on this host.
        const others = await tx.servicePort.findMany({
          where: { environment, host, serviceId: { notIn: ids } },
          include: { service: { select: { name: true } } },
        });
        const clashes = findPortConflicts([
          ...others.map((p: any): PortBinding => ({ service: p.service.name, environment, host, hostPort: p.hostPort, protocol: p.protocol })),
          ...services.flatMap((s) => s.ports.map((p): PortBinding => ({ service: s.name, environment, host, hostPort: p.hostPort, protocol: p.protocol }))),
        ]);
        if (clashes.length > 0) return { clashes };

        for (const s of services) {
          const id = idOf.get(`${s.server}\u0000${s.name}`)!;
          if (s.image && imageOf.get(id) !== s.image) {
            await tx.service.update({ where: { id }, data: { image: s.image } });
          }
        }
        await tx.servicePort.deleteMany({ where: { environment, host, serviceId: { in: ids } } });
        const portRows = services.flatMap((s) =>
          s.ports.map((p) => ({ ...p, environment, host, serviceId: idOf.get(`${s.server}\u0000${s.name}`)! }))
        );
        if (portRows.length > 0) {
          await tx.servicePort.createMany({ data: portRows });
        }
        return { created: toCreate.map((s) => s.name), ports: portRows.length };
      },
      // Several round trips through the pooler; the 5s default is tight.
      { timeout: 20_000, maxWait: 10_000 }
    );

    if ('clashes' in result) {
      return res.status(409).json({
        error: 'Conflict',
        message: `Port already used by another service on ${environment} / ${host}.`,
        conflicts: result.clashes,
      });
    }
    res.json({ success: true, services: services.length, created: result.created, ports: result.ports });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Conflict', message: 'A port was taken by another save at the same moment. Try again.' });
    }
    return sendDbError(res, err, 'import the compose file');
  }
});

// Mount the API. Vercel's rewrite may or may not preserve the /api prefix by the
// time the serverless function sees the URL, so mount both ways: whichever path
// arrives, exactly one mount matches and responds.
app.use('/api', router);
app.use(router);

export { app };
export default app;
