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
import { getPrismaClient } from './prisma.js';
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

// Helper: Bearer auth verification.
// Fails closed: a missing or malformed Authorization header, an empty token,
// or an unconfigured server secret all reject the request.
function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return false;
  }

  // No hardcoded fallback: writes are rejected until a secret is configured.
  const validSecret = process.env.API_SECRET_KEY || process.env.VITE_API_SECRET_KEY;
  if (!validSecret) {
    return false;
  }

  return token === validSecret;
}

// 1. Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. GET all release records
router.get('/records', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      const records = await prisma.releaseRecord.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ success: true, records });
    }
  } catch {
    // Graceful fallback to memoryRecords
  }
  res.json({ success: true, records: memoryRecords });
});

// 3. GET single release record
router.get('/records/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      const record = await prisma.releaseRecord.findUnique({ where: { id } });
      if (record) return res.json(record);
    }
  } catch {
    // Graceful fallback to memoryRecords
  }

  const record = memoryRecords.find((r) => r.id === id);
  if (!record) {
    return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
  }
  res.json(record);
});

// 4. POST create single or batch release records
router.post('/records', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing Bearer token.' });
  }

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
        memoryRecords.unshift(item);
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
        memoryRecords.unshift(record);
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
      memoryRecords.unshift(record);
    }

    // Try persisting to Prisma if available
    try {
      const prisma = await getPrismaClient();
      if (prisma && prisma.releaseRecord) {
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
    } catch {
      // Prisma create failed, records are preserved in memory
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
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing Bearer token.' });
  }

  const { id } = req.params;
  const body = req.body;

  const idx = memoryRecords.findIndex((r) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Not Found', message: `Record ${id} not found.` });
  }

  const updated = { ...memoryRecords[idx], ...body, updatedAt: new Date().toISOString() };
  if (body.status) {
    const raw = String(body.status).toUpperCase();
    if (['SUCCESS', 'FAILED', 'PENDING'].includes(raw)) {
      updated.status = raw as ReleaseStatus;
    }
  }
  memoryRecords[idx] = updated;

  try {
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      await prisma.releaseRecord.update({
        where: { id },
        data: {
          ...body,
          updatedAt: new Date(),
        },
      });
    }
  } catch {
    // Prisma update failed, updated in memory
  }

  res.json({ success: true, record: updated });
});

// 6. DELETE release record
router.delete('/records/:id', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing Bearer token.' });
  }

  const { id } = req.params;
  const idx = memoryRecords.findIndex((r) => r.id === id);
  if (idx !== -1) {
    memoryRecords.splice(idx, 1);
  }

  try {
    const prisma = await getPrismaClient();
    if (prisma && prisma.releaseRecord) {
      await prisma.releaseRecord.delete({ where: { id } });
    }
  } catch {
    // Prisma delete failed
  }

  res.json({ success: true, message: `Record ${id} deleted.` });
});

// Mount the API. Vercel's rewrite may or may not preserve the /api prefix by the
// time the serverless function sees the URL, so mount both ways: whichever path
// arrives, exactly one mount matches and responds.
app.use('/api', router);
app.use(router);

export { app };
export default app;
