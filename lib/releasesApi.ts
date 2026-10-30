// Release bundles API (prisma/manual/008_release_bundles.sql).
//
//   GET    /releases                  every bundle (records come from /records)
//   POST   /releases                  one bundle + one record per service, with
//                                     an optional backdated releasedAt
//   PATCH  /releases/:id              title, status, date, config flag, note;
//                                     applyStatusToRecords also sets the records
//   DELETE /releases/:id              admin: the bundle and its records
//   POST   /releases/:id/promote      copy into the target environment as
//                                     PLANNED (or refresh a still-PLANNED copy)
//   POST   /releases/:id/revert       undo a promotion while it is still PLANNED
//
// A promotion only writes tracker rows. It never touches a server, and PLANNED
// records do not count as deployed (lib/currentVersions.ts), so promoting
// does not change what the target environment is shown to run.

import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { getPrismaClient } from './prisma.js';
import { sendDbError, isMissingSchema } from './httpErrors.js';
import { requireRole } from './auth.js';
import { isFail } from './recordInput.js';
import { normalizeNewRelease, normalizeReleasePatch } from './releaseInput.js';
import { canonicalEnvironment, envLabel, sameEnvironment } from './environments.js';
import { DEFAULT_DEVELOPER } from './developers.js';
import type { Release, ReleaseRecord } from './types.js';

const SCHEMA_MESSAGE = 'The database is missing the release-bundle table. Run prisma/manual/008_release_bundles.sql in Supabase.';

// Record fields a promotion copies (everything but identity, status, dates
// and who logged it).
const COPIED_FIELDS = [
  'server', 'service', 'version', 'developerName', 'isBuildUpdate', 'isEnvUpdate', 'envDetails',
  'isConfigUpdate', 'configDetails', 'hasCommands', 'commandDetails',
] as const;

type UndoState =
  | { kind: 'created' }
  | { kind: 'updated'; release: Pick<Release, 'title' | 'hasConfigChange' | 'configDetails' | 'note' | 'releasedAt'>; records: any[] };

const upper = (s: unknown) => String(s ?? '').toUpperCase();

// What the client sees: undoState stays on the server, canUndo says whether
// Undo is offered.
function publicRelease(r: any): Release {
  const { undoState, ...rest } = r;
  return { ...rest, canUndo: !!undoState && upper(r.status) === 'PLANNED' };
}

function dbFail(res: Response, err: unknown, action: string) {
  if (isMissingSchema(err)) return res.status(503).json({ error: 'Service Unavailable', message: SCHEMA_MESSAGE });
  return sendDbError(res, err, action);
}

function needsDb(res: Response) {
  return res.status(503).json({ error: 'Service Unavailable', message: 'Promoting and reverting releases need a database. Set DATABASE_URL.' });
}

const recordData = (r: ReleaseRecord, releaseId: string) => ({
  id: r.id,
  environment: r.environment,
  server: r.server,
  service: r.service,
  version: r.version,
  developerName: r.developerName,
  status: r.status,
  isBuildUpdate: r.isBuildUpdate,
  isEnvUpdate: r.isEnvUpdate,
  envDetails: r.envDetails ?? null,
  isConfigUpdate: r.isConfigUpdate,
  configDetails: r.configDetails ?? null,
  hasCommands: r.hasCommands,
  commandDetails: r.commandDetails ?? null,
  note: r.note ?? null,
  source: r.source ?? 'Teams Group',
  added_by: r.added_by,
  createdAt: new Date(r.createdAt),
  updatedAt: new Date(r.updatedAt),
  releaseId,
});

// Local dev with no database keeps bundles in memory next to the records, so
// the Add Record form and the feed work there too. Promotion needs a database.
export function releasesRouter(memoryRecords: ReleaseRecord[]) {
  const router = express.Router();
  const memoryReleases: Release[] = [];

  router.get('/releases', async (req: Request, res: Response) => {
    try {
      const prisma = await getPrismaClient();
      if (!prisma) return res.json({ success: true, dataSource: 'memory', releases: memoryReleases });
      const releases = await prisma.release.findMany({ orderBy: { releasedAt: 'desc' } });
      res.json({ success: true, dataSource: 'database', releases: releases.map(publicRelease) });
    } catch (err) {
      return dbFail(res, err, 'load releases');
    }
  });

  router.post('/releases', async (req: Request, res: Response) => {
    const who = req.user?.email || 'local-dev';
    const parsed = normalizeNewRelease(req.body, { addedBy: who, defaultDeveloper: DEFAULT_DEVELOPER });
    if (isFail(parsed)) return res.status(400).json({ error: 'Bad Request', message: parsed.message });
    const { release: fields, records } = parsed;
    const id = crypto.randomUUID();
    const linked = records.map((r) => ({ ...r, releaseId: id }));

    try {
      const prisma = await getPrismaClient();
      if (!prisma) {
        const now = new Date().toISOString();
        const release: Release = { id, ...fields, releasedAt: fields.releasedAt.toISOString(), createdBy: who, createdAt: now, updatedAt: now, canUndo: false };
        memoryReleases.unshift(release);
        memoryRecords.unshift(...linked);
        return res.status(201).json({ success: true, release, records: linked });
      }
      const release = await prisma.$transaction(async (tx: any) => {
        const created = await tx.release.create({ data: { id, ...fields, createdBy: who } });
        await tx.releaseRecord.createMany({ data: linked.map((r) => recordData(r, id)) });
        return created;
      });
      res.status(201).json({ success: true, release: publicRelease(release), records: linked });
    } catch (err) {
      return dbFail(res, err, 'save the release');
    }
  });

  router.patch('/releases/:id', async (req: Request, res: Response) => {
    const patch = normalizeReleasePatch(req.body);
    if (isFail(patch)) return res.status(400).json({ error: 'Bad Request', message: patch.message });
    const { data, applyStatusToRecords } = patch;
    const recordChanges: Record<string, unknown> = {};
    if (applyStatusToRecords) recordChanges.status = data.status;
    if (data.releasedAt) recordChanges.createdAt = data.releasedAt; // backdating the bundle moves its records

    try {
      const prisma = await getPrismaClient();
      if (!prisma) {
        const release = memoryReleases.find((r) => r.id === req.params.id);
        if (!release) return res.status(404).json({ error: 'Not Found', message: 'Release not found.' });
        Object.assign(release, data, data.releasedAt ? { releasedAt: data.releasedAt.toISOString() } : {}, { updatedAt: new Date().toISOString() });
        const records = memoryRecords.filter((r) => r.releaseId === release.id);
        for (const r of records) {
          if (recordChanges.status) r.status = recordChanges.status as string;
          if (data.releasedAt) r.createdAt = data.releasedAt.toISOString();
        }
        return res.json({ success: true, release, records });
      }
      const result = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.release.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!existing) return null;
        // A PLANNED copy that moves on can no longer be undone.
        const leavesPlanned = data.status && data.status !== 'PLANNED';
        const release = await tx.release.update({
          where: { id: req.params.id },
          data: { ...data, ...(leavesPlanned ? { undoState: null } : {}) },
        });
        if (Object.keys(recordChanges).length) {
          await tx.releaseRecord.updateMany({ where: { releaseId: release.id }, data: { ...recordChanges, updatedAt: new Date() } });
        }
        const records = await tx.releaseRecord.findMany({ where: { releaseId: release.id } });
        return { release, records };
      });
      if (!result) return res.status(404).json({ error: 'Not Found', message: 'Release not found.' });
      res.json({ success: true, release: publicRelease(result.release), records: result.records });
    } catch (err) {
      return dbFail(res, err, 'update the release');
    }
  });

  router.delete('/releases/:id', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const prisma = await getPrismaClient();
      if (!prisma) {
        const i = memoryReleases.findIndex((r) => r.id === req.params.id);
        if (i === -1) return res.status(404).json({ error: 'Not Found', message: 'Release not found.' });
        memoryReleases.splice(i, 1);
        const ids = memoryRecords.filter((r) => r.releaseId === req.params.id).map((r) => r.id);
        for (const rid of ids) memoryRecords.splice(memoryRecords.findIndex((r) => r.id === rid), 1);
        return res.json({ success: true, deletedRecordIds: ids });
      }
      const ids = (await prisma.releaseRecord.findMany({ where: { releaseId: req.params.id }, select: { id: true } })).map((r: any) => r.id);
      await prisma.release.delete({ where: { id: req.params.id } }); // cascades to its records
      res.json({ success: true, deletedRecordIds: ids });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2025') return res.status(404).json({ error: 'Not Found', message: 'Release not found.' });
      return dbFail(res, err, 'delete the release');
    }
  });

  router.post('/releases/:id/promote', async (req: Request, res: Response) => {
    const target = canonicalEnvironment(req.body?.targetEnvironment);
    if (!target) return res.status(400).json({ error: 'Bad Request', message: 'targetEnvironment must be SIT, UAT or Prod.' });
    const who = req.user?.email || 'local-dev';
    try {
      const prisma = await getPrismaClient();
      if (!prisma) return needsDb(res);
      const result = await prisma.$transaction(
        async (tx: any) => {
          const source = await tx.release.findUnique({ where: { id: req.params.id }, include: { records: true } });
          if (!source) return { status: 404, message: 'Release not found.' };
          if (sameEnvironment(source.environment, target)) return { status: 400, message: `This release is already in ${envLabel(target)}.` };
          // FAILED builds are not promoted.
          const builds = source.records.filter((r: any) => upper(r.status) !== 'FAILED');
          if (builds.length === 0) return { status: 409, message: 'Every build in this release FAILED; there is nothing to promote.' };

          const now = new Date();
          const note = `Promoted from ${envLabel(source.environment)} release "${source.title}" (${source.id}).${source.note ? `\n${source.note}` : ''}`;
          const copies = builds.map((r: any) => ({
            ...Object.fromEntries(COPIED_FIELDS.map((k) => [k, r[k]])),
            id: `rel-${crypto.randomUUID()}`,
            environment: target,
            status: 'PLANNED',
            note,
            source: 'Promotion',
            added_by: who,
            createdAt: now,
            updatedAt: now,
          }));
          const fields = {
            title: source.title,
            hasConfigChange: source.hasConfigChange,
            configDetails: source.configDetails,
            note,
            releasedAt: now,
          };

          // Refresh an earlier copy that has not moved on yet, instead of
          // stacking a second PLANNED copy of the same release.
          const existing = await tx.release.findFirst({
            where: { promotedFromId: source.id, environment: target, status: 'PLANNED' },
            include: { records: true },
            orderBy: { createdAt: 'desc' },
          });
          if (existing && existing.records.every((r: any) => upper(r.status) === 'PLANNED')) {
            const undo: UndoState = existing.undoState?.kind === 'created'
              ? { kind: 'created' } // undoing still removes the copy entirely
              : {
                  kind: 'updated',
                  release: { title: existing.title, hasConfigChange: existing.hasConfigChange, configDetails: existing.configDetails, note: existing.note, releasedAt: existing.releasedAt },
                  records: existing.records,
                };
            await tx.releaseRecord.deleteMany({ where: { releaseId: existing.id } });
            const release = await tx.release.update({ where: { id: existing.id }, data: { ...fields, undoState: undo as any } });
            await tx.releaseRecord.createMany({ data: copies.map((c: any) => ({ ...c, releaseId: existing.id })) });
            return {
              status: 200,
              action: 'updated',
              release,
              records: copies.map((c: any) => ({ ...c, releaseId: existing.id })),
              removedRecordIds: existing.records.map((r: any) => r.id),
            };
          }

          const release = await tx.release.create({
            data: { ...fields, environment: target, status: 'PLANNED', promotedFromId: source.id, undoState: { kind: 'created' }, createdBy: who },
          });
          await tx.releaseRecord.createMany({ data: copies.map((c: any) => ({ ...c, releaseId: release.id })) });
          return { status: 201, action: 'created', release, records: copies.map((c: any) => ({ ...c, releaseId: release.id })), removedRecordIds: [] as string[] };
        },
        { timeout: 20_000, maxWait: 10_000 }
      );
      if (!('release' in result)) return res.status(result.status).json({ error: result.status === 404 ? 'Not Found' : result.status === 409 ? 'Conflict' : 'Bad Request', message: result.message });
      res.status(result.status).json({
        success: true,
        action: result.action,
        release: publicRelease(result.release),
        records: result.records,
        removedRecordIds: result.removedRecordIds,
      });
    } catch (err) {
      return dbFail(res, err, 'promote the release');
    }
  });

  router.post('/releases/:id/revert', async (req: Request, res: Response) => {
    try {
      const prisma = await getPrismaClient();
      if (!prisma) return needsDb(res);
      const result = await prisma.$transaction(async (tx: any) => {
        const release = await tx.release.findUnique({ where: { id: req.params.id }, include: { records: true } });
        if (!release) return { status: 404, message: 'Release not found.' };
        const undo = release.undoState as UndoState | null;
        if (!undo) {
          return {
            status: 409,
            message: !release.promotedFromId
              ? 'This release is not a promotion that can be undone.'
              : upper(release.status) === 'PLANNED'
              ? 'Nothing left to undo for this promotion.'
              : 'This promotion has moved on from PLANNED (deployed or closed by a receipt), so it can no longer be undone. Edit or delete it instead.',
          };
        }
        if (upper(release.status) !== 'PLANNED' || release.records.some((r: any) => upper(r.status) !== 'PLANNED')) {
          return { status: 409, message: 'This promotion has moved on from PLANNED (deployed or closed by a receipt), so it can no longer be undone. Edit or delete it instead.' };
        }
        if (undo.kind === 'created') {
          await tx.release.delete({ where: { id: release.id } }); // cascades to its records
          return { status: 200, action: 'deleted', removedRecordIds: release.records.map((r: any) => r.id), release: null, records: [] };
        }
        await tx.releaseRecord.deleteMany({ where: { releaseId: release.id } });
        await tx.releaseRecord.createMany({
          data: undo.records.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) })),
        });
        const restored = await tx.release.update({
          where: { id: release.id },
          data: { ...undo.release, releasedAt: new Date(undo.release.releasedAt), undoState: null },
        });
        return { status: 200, action: 'restored', removedRecordIds: release.records.map((r: any) => r.id), release: restored, records: undo.records };
      });
      if (!('action' in result)) return res.status(result.status).json({ error: result.status === 404 ? 'Not Found' : 'Conflict', message: result.message });
      res.json({
        success: true,
        action: result.action,
        release: result.release ? publicRelease(result.release) : null,
        removedRecordIds: result.removedRecordIds,
        records: result.records,
      });
    } catch (err) {
      return dbFail(res, err, 'undo the promotion');
    }
  });

  return router;
}
