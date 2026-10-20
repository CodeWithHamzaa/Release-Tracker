// Patch planner API: environment comparison (and, later, patch plans).
//
// Comparison and plans are read-only. Everything is computed from what the tracker already stores
// (release records, the vault, the catalog, the server registry and health
// reports); nothing here writes to the database or reaches any server.
// Config values are only returned to admins, and always redacted
// (lib/redact.ts), so no secret leaves the API through the planner.
// The /changes routes are the one writable part: manual feature/fix-to-build
// mapping (prisma/manual/007_change_mapping.sql).

import express, { Request, Response } from 'express';
import { getPrismaClient } from './prisma.js';
import { sendDbError, isMissingSchema } from './httpErrors.js';
import { compareEnvironments, EnvironmentComparison, PlanningData } from './envCompare.js';
import { checkPromotionPair, ENVIRONMENTS, sameEnvironment } from './environments.js';
import { buildChangeIndex, changesForBuild, knownBuilds, CHANGE_KEY, ChangeBuildRow, ChangeIndex, ChangeRow, MappingRecord } from './changeMap.js';
import { requireRole } from './auth.js';
import { parseScopeInput, resolveScope } from './patchScope.js';
import { buildPatchPlan, defaultPatchId } from './patchPlan.js';
import { renderRunbook, renderSteps } from './patchRender.js';
import { primaryComposePath } from './composeSync.js';

export const planningRouter = express.Router();

// Every spelling an environment may have been saved with (records predate
// canonical names), for the database filter.
const spellings = (envs: string[]) => [...new Set(envs.flatMap((e) => [e, e.toUpperCase(), e.toLowerCase()]))];

export async function loadPlanningData(prisma: any, envs: string[]): Promise<PlanningData> {
  const inEnvs = { in: spellings(envs) };
  const [records, deployments, servers, reports, files] = await Promise.all([
    // All environments: build history (first-seen order, change mapping)
    // spans them. The comparison itself filters by environment.
    prisma.releaseRecord.findMany({
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

const CHANGES_SCHEMA_MESSAGE = 'Change mapping needs prisma/manual/007_change_mapping.sql. Run it in Supabase.';

// Manual change mapping. Missing 007 tables are not an error for the planner:
// it works without mapping and says so (available: false).
export async function loadChangeRows(prisma: any): Promise<{ changes: ChangeRow[]; links: ChangeBuildRow[]; available: boolean }> {
  try {
    const [changes, links] = await Promise.all([prisma.change.findMany({ orderBy: { key: 'asc' } }), prisma.changeBuild.findMany()]);
    return { changes: changes ?? [], links: links ?? [], available: true };
  } catch (err) {
    if (isMissingSchema(err) || !prisma.change) return { changes: [], links: [], available: false };
    throw err;
  }
}

// For each compared service: builds you can pick, and the changes linked to
// it with what the source build says about each.
export function planningContext(comparison: EnvironmentComparison, index: ChangeIndex, records: MappingRecord[]) {
  const services: Record<string, { builds: ReturnType<typeof knownBuilds>; changes: ReturnType<typeof changesForBuild> }> = {};
  for (const row of comparison.roles.flatMap((r) => r.services)) {
    const tag = row.desired?.tag;
    services[row.key] = {
      builds: knownBuilds(records, row.role, row.service).slice(0, 30),
      changes: tag ? changesForBuild(index, { role: row.role, service: row.service, version: tag }) : [],
    };
  }
  const changes = [...index.changes.values()].map((c) => ({ key: c.key, title: c.title, kind: c.kind, introduced: c.introduced }));
  return { services, changes };
}

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
    const rows = prisma ? await loadChangeRows(prisma) : { changes: [], links: [], available: false };
    const comparison = compareEnvironments(data, { sourceEnv: pair.source, targetEnv: pair.target, includeValues });
    const index = buildChangeIndex({ changes: rows.changes, links: rows.links, records: data.records as MappingRecord[] });
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      dataSource: prisma ? 'database' : 'memory',
      warning: pair.warning,
      environments: ENVIRONMENTS,
      changeMapping: rows.available,
      comparison,
      context: planningContext(comparison, index, data.records as MappingRecord[]),
    });
  } catch (err) {
    if (isMissingSchema(err)) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'The database is missing tables the planner reads. Run the prisma/manual/*.sql files in order in Supabase.' });
    }
    return sendDbError(res, err, 'compare the environments');
  }
});

// POST /patch-plans/preview { source, target, scope, patchId?, tarDir? }
// Resolves the scope and returns the plan with both outputs. Nothing is
// stored: plans are generated on request and downloaded.
planningRouter.post('/patch-plans/preview', async (req: Request, res: Response) => {
  const pair = checkPromotionPair(req.body?.source, req.body?.target);
  if (pair.ok === false) return res.status(400).json({ error: 'Bad Request', message: pair.message });
  const parsed = parseScopeInput(req.body?.scope);
  if (parsed.ok === false) return res.status(400).json({ error: 'Bad Request', message: parsed.message });
  for (const k of ['patchId', 'tarDir'] as const) {
    const v = req.body?.[k];
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 260)) return res.status(400).json({ error: 'Bad Request', message: `${k} must be text.` });
  }
  const includeValues = !req.user || req.user.role === 'admin';
  try {
    const prisma = await getPrismaClient();
    const data = prisma ? await loadPlanningData(prisma, [pair.source, pair.target]) : EMPTY;
    const rows = prisma ? await loadChangeRows(prisma) : { changes: [], links: [], available: false };
    const comparison = compareEnvironments(data, { sourceEnv: pair.source, targetEnv: pair.target, includeValues });
    const records = data.records as MappingRecord[];
    const index = buildChangeIndex({ changes: rows.changes, links: rows.links, records });
    const scope = resolveScope(comparison, parsed.scope, index, records);

    const composeTexts: Record<string, { source: string | null; target: string | null }> = {};
    const composeOf = (env: string, role: string) => {
      const files = data.vaultFiles.filter((f) => sameEnvironment(f.environment, env) && f.role === role);
      const path = primaryComposePath(files.map((f) => f.path));
      return files.find((f) => f.path === path)?.content ?? null;
    };
    for (const r of comparison.roles) composeTexts[r.role] = { source: composeOf(pair.source, r.role), target: composeOf(pair.target, r.role) };

    const plan = buildPatchPlan({
      comparison,
      scope,
      patchId: typeof req.body?.patchId === 'string' && req.body.patchId.trim() ? req.body.patchId : defaultPatchId(pair.source, pair.target),
      tarDir: req.body?.tarDir ?? null,
      composeTexts,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, warning: pair.warning, changeMapping: rows.available, scope, plan, markdown: { steps: renderSteps(plan), runbook: renderRunbook(plan) } });
  } catch (err) {
    if (isMissingSchema(err)) {
      return res.status(503).json({ error: 'Service Unavailable', message: 'The database is missing tables the planner reads. Run the prisma/manual/*.sql files in order in Supabase.' });
    }
    return sendDbError(res, err, 'build the patch plan');
  }
});

// ── Changes (feature / fix to build mapping) ────────────────────────────────

const CHANGE_KINDS = ['feature', 'fix', 'change'];

function text(v: unknown, max: number, required: boolean): { ok: boolean; value: string | null; message?: string } {
  if (v === undefined || v === null || v === '') return required ? { ok: false, value: null, message: 'is required' } : { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, value: null, message: 'must be text' };
  const t = v.trim();
  if (!t) return required ? { ok: false, value: null, message: 'is required' } : { ok: true, value: null };
  if (t.length > max) return { ok: false, value: null, message: `must be at most ${max} characters` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000]/.test(t)) return { ok: false, value: null, message: 'must not contain null characters' };
  return { ok: true, value: t };
}

function changesError(res: Response, err: unknown, action: string) {
  if (isMissingSchema(err)) return res.status(503).json({ error: 'Service Unavailable', message: CHANGES_SCHEMA_MESSAGE });
  if ((err as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'Conflict', message: 'That mapping already exists.' });
  if ((err as { code?: string })?.code === 'P2025') return res.status(404).json({ error: 'Not Found', message: 'Not found.' });
  return sendDbError(res, err, action);
}

async function changesDb(res: Response) {
  const prisma = await getPrismaClient();
  if (!prisma) {
    res.status(503).json({ error: 'Service Unavailable', message: 'Change mapping needs a database. Set DATABASE_URL.' });
    return null;
  }
  return prisma;
}

// All changes: the manual ones and the keys release-record notes mention, with
// their evidence.
planningRouter.get('/changes', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) return res.json({ success: true, available: false, changes: [] });
    const [rows, records] = await Promise.all([
      loadChangeRows(prisma),
      prisma.releaseRecord.findMany({ select: { id: true, environment: true, server: true, service: true, version: true, status: true, note: true, createdAt: true, isBuildUpdate: true } }),
    ]);
    const index = buildChangeIndex({ changes: rows.changes, links: rows.links, records });
    const linkById = new Map(rows.links.map((l) => [`${l.changeId}::${l.role}::${l.service}::${l.version}`, l.id]));
    res.json({
      success: true,
      available: rows.available,
      changes: [...index.changes.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((c) => ({
          ...c,
          evidence: c.evidence.map((e) => ({ ...e, linkId: e.source === 'manual' ? linkById.get(`${c.id}::${e.role}::${e.service}::${e.version}`) ?? null : null })),
        })),
    });
  } catch (err) {
    return changesError(res, err, 'load changes');
  }
});

// Create a change, or update the title / kind / notes of an existing key.
planningRouter.post('/changes', async (req: Request, res: Response) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase() : '';
  if (!CHANGE_KEY.test(key)) return res.status(400).json({ error: 'Bad Request', message: 'key must look like JIRA-123.' });
  const title = text(req.body?.title, 200, true);
  if (!title.ok) return res.status(400).json({ error: 'Bad Request', message: `title ${title.message}.` });
  const notes = text(req.body?.notes, 2000, false);
  if (!notes.ok) return res.status(400).json({ error: 'Bad Request', message: `notes ${notes.message}.` });
  const kind = req.body?.kind ?? 'fix';
  if (!CHANGE_KINDS.includes(kind)) return res.status(400).json({ error: 'Bad Request', message: `kind must be one of ${CHANGE_KINDS.join(', ')}.` });
  try {
    const prisma = await changesDb(res);
    if (!prisma) return;
    const change = await prisma.change.upsert({
      where: { key },
      create: { key, title: title.value, kind, notes: notes.value, createdBy: req.user?.email || 'local-dev' },
      update: { title: title.value, kind, notes: notes.value },
    });
    res.status(201).json({ success: true, change });
  } catch (err) {
    return changesError(res, err, 'save the change');
  }
});

// Link a build to a change. Always starts unverified.
planningRouter.post('/changes/:id/builds', async (req: Request, res: Response) => {
  const fields: Record<string, string> = {};
  for (const k of ['role', 'service', 'version'] as const) {
    const v = text(req.body?.[k], 100, true);
    if (!v.ok) return res.status(400).json({ error: 'Bad Request', message: `${k} ${v.message}.` });
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v.value!)) return res.status(400).json({ error: 'Bad Request', message: `${k} must be a single line.` });
    fields[k] = v.value!;
  }
  const relation = req.body?.relation ?? 'introduced';
  if (relation !== 'introduced' && relation !== 'included') return res.status(400).json({ error: 'Bad Request', message: "relation must be 'introduced' or 'included'." });
  const evidence = text(req.body?.evidence, 2000, false);
  if (!evidence.ok) return res.status(400).json({ error: 'Bad Request', message: `evidence ${evidence.message}.` });
  try {
    const prisma = await changesDb(res);
    if (!prisma) return;
    const link = await prisma.changeBuild.create({
      data: { changeId: req.params.id, ...fields, relation, evidence: evidence.value, verified: false, createdBy: req.user?.email || 'local-dev' },
    });
    res.status(201).json({ success: true, link });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2003') return res.status(404).json({ error: 'Not Found', message: 'Change not found.' });
    return changesError(res, err, 'link the build');
  }
});

// Mark a mapping verified (with evidence) or back to unverified.
planningRouter.patch('/changes/builds/:id', async (req: Request, res: Response) => {
  if (typeof req.body?.verified !== 'boolean') return res.status(400).json({ error: 'Bad Request', message: 'verified must be true or false.' });
  const evidence = text(req.body?.evidence, 2000, false);
  if (!evidence.ok) return res.status(400).json({ error: 'Bad Request', message: `evidence ${evidence.message}.` });
  if (req.body.verified && !evidence.value) {
    return res.status(400).json({ error: 'Bad Request', message: 'Say what proves it (evidence) when marking a mapping verified.' });
  }
  try {
    const prisma = await changesDb(res);
    if (!prisma) return;
    const link = await prisma.changeBuild.update({
      where: { id: req.params.id },
      data: req.body.verified
        ? { verified: true, evidence: evidence.value, verifiedBy: req.user?.email || 'local-dev', verifiedAt: new Date() }
        : { verified: false, verifiedBy: null, verifiedAt: null, ...(evidence.value ? { evidence: evidence.value } : {}) },
    });
    res.json({ success: true, link });
  } catch (err) {
    return changesError(res, err, 'update the mapping');
  }
});

planningRouter.delete('/changes/builds/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const prisma = await changesDb(res);
    if (!prisma) return;
    await prisma.changeBuild.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    return changesError(res, err, 'delete the mapping');
  }
});

planningRouter.delete('/changes/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const prisma = await changesDb(res);
    if (!prisma) return;
    await prisma.change.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    return changesError(res, err, 'delete the change');
  }
});
