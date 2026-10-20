// Patch planner API: environment comparison (and, later, patch plans).
//
// Read-only. Everything is computed from what the tracker already stores
// (release records, the vault, the catalog, the server registry and health
// reports); nothing here writes to the database or reaches any server.
// Config values are only returned to admins, and always redacted
// (lib/redact.ts), so no secret leaves the API through the planner.

import express, { Request, Response } from 'express';
import { getPrismaClient } from './prisma.js';
import { sendDbError, isMissingSchema } from './httpErrors.js';
import { compareEnvironments, PlanningData } from './envCompare.js';
import { checkPromotionPair, ENVIRONMENTS, sameEnvironment } from './environments.js';

export const planningRouter = express.Router();

// Every spelling an environment may have been saved with (records predate
// canonical names), for the database filter.
const spellings = (envs: string[]) => [...new Set(envs.flatMap((e) => [e, e.toUpperCase(), e.toLowerCase()]))];

export async function loadPlanningData(prisma: any, envs: string[]): Promise<PlanningData> {
  const inEnvs = { in: spellings(envs) };
  const [records, deployments, servers, reports, files] = await Promise.all([
    prisma.releaseRecord.findMany({
      where: { environment: inEnvs },
      select: {
        id: true, environment: true, server: true, service: true, version: true, status: true, createdAt: true,
        isBuildUpdate: true, isEnvUpdate: true, isConfigUpdate: true, note: true, developerName: true,
      },
    }),
    prisma.serviceDeployment.findMany({
      where: { environment: inEnvs },
      select: {
        environment: true, role: true, composeKey: true, containerName: true, image: true, tag: true,
        service: { select: { name: true } },
        sourceFile: { select: { path: true } },
        sourceVersion: { select: { version: true, createdAt: true } },
      },
    }),
    prisma.serverNode.findMany(),
    prisma.healthReport.findMany({
      where: { environment: inEnvs },
      distinct: ['environment', 'role', 'kind'],
      orderBy: [{ environment: 'asc' }, { role: 'asc' }, { kind: 'asc' }, { reportedAt: 'desc' }],
      select: { id: true, environment: true, role: true, kind: true, reportedAt: true, host: true, uploadedBy: true, createdAt: true, parsed: true },
    }),
    prisma.configFile.findMany({
      where: { environment: inEnvs },
      select: {
        environment: true, role: true, path: true,
        versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, createdAt: true, content: true } },
      },
    }),
  ]);

  const isoOf = (v: any) => (v ? new Date(v).toISOString() : null);
  return {
    records: (records ?? []).map((r: any) => ({ ...r, createdAt: isoOf(r.createdAt) })),
    deployments: (deployments ?? []).map((d: any) => ({
      service: d.service?.name ?? d.composeKey,
      role: d.role,
      environment: d.environment,
      composeKey: d.composeKey,
      containerName: d.containerName ?? null,
      image: d.image ?? null,
      tag: d.tag ?? null,
      composeFile: d.sourceFile?.path ?? null,
      vaultVersion: d.sourceVersion?.version ?? null,
      vaultAt: isoOf(d.sourceVersion?.createdAt),
    })),
    servers: (servers ?? [])
      .filter((s: any) => envs.some((e) => sameEnvironment(e, s.environment)))
      .map((s: any) => ({
        environment: s.environment, role: s.role, ip: s.ip ?? null, domain: s.domain ?? null, composePath: s.composePath ?? null,
        runAs: s.runAs ?? null, access: s.access ?? null, envFiles: s.envFiles ?? [], toolkitVersion: s.toolkitVersion ?? null,
      })),
    reports: (reports ?? []).map((r: any) => ({ ...r, reportedAt: isoOf(r.reportedAt), createdAt: isoOf(r.createdAt) })),
    vaultFiles: (files ?? [])
      .filter((f: any) => f.versions?.length)
      .map((f: any) => ({
        environment: f.environment, role: f.role, path: f.path,
        version: f.versions[0].version, createdAt: isoOf(f.versions[0].createdAt), content: f.versions[0].content,
      })),
  };
}

const EMPTY: PlanningData = { records: [], deployments: [], reports: [], servers: [], vaultFiles: [] };

// GET /environments/compare?source=SIT&target=UAT
planningRouter.get('/environments/compare', async (req: Request, res: Response) => {
  const pair = checkPromotionPair(req.query.source, req.query.target);
  if (pair.ok === false) return res.status(400).json({ error: 'Bad Request', message: pair.message });
  // Config values (redacted) for admins only; operators see which keys differ.
  // With auth disabled (local dev) there is no user and nothing to protect.
  const includeValues = !req.user || req.user.role === 'admin';
  try {
    const prisma = await getPrismaClient();
    const data = prisma ? await loadPlanningData(prisma, [pair.source, pair.target]) : EMPTY;
    const comparison = compareEnvironments(data, { sourceEnv: pair.source, targetEnv: pair.target, includeValues });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, dataSource: prisma ? 'database' : 'memory', warning: pair.warning, environments: ENVIRONMENTS, comparison });
  } catch (err) {
    if (isMissingSchema(err)) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'The database is missing tables the planner reads. Run the prisma/manual/*.sql files in order in Supabase.' });
    }
    return sendDbError(res, err, 'compare the environments');
  }
});
