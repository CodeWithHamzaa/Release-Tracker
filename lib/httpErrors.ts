// Database failures as API responses, shared by every route module.

import type { Response } from 'express';
import { DatabaseUnavailableError } from './prisma.js';

// An unreachable or unconfigured database is a 503; anything else (a failed
// query) is a 500. Never falls back to mock data -- that fallback is only for
// local dev with no database configured, where getPrismaClient() returns null.
export function sendDbError(res: Response, err: unknown, action: string) {
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

// Prisma: a table or column the code expects does not exist yet (a manual
// prisma/manual/*.sql file has not been run).
export function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'P2021' || code === 'P2022';
}
