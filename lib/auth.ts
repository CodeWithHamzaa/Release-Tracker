// API authentication: every request must carry the Supabase access token of a
// signed-in user (Authorization: Bearer <jwt>).
//
// - The token is checked against Supabase Auth (auth.getUser), so a signed-out
//   or deleted user is rejected, not just an expired token.
// - Access is an allowlist, not "any signed-in user":
//     ALLOWED_EMAILS  operators: may read and add/edit records, services,
//                     servers and health reports.
//     ADMIN_EMAILS    admins (implicitly allowed): additionally read Config
//                     Vault file contents (plaintext secrets), write the
//                     vault, and delete anything.
//   Both are comma separated. See docs/security-env.md.
// - Strict mode (production / Vercel) fails closed with 503 when Supabase is
//   not configured OR when neither list is set, instead of admitting every
//   account that can sign up. Local dev with nothing configured skips auth,
//   the same way lib/prisma.ts falls back to mock records.
// - Lock-out guard: if ADMIN_EMAILS is unset, everyone in ALLOWED_EMAILS keeps
//   admin rights (how the app behaved before roles existed) and a warning is
//   logged. Set ADMIN_EMAILS to separate the roles.

import type { NextFunction, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isStrictDatabaseMode } from './prisma.js';

export type Role = 'admin' | 'operator';

export interface AuthUser {
  id: string;
  email: string;
  role?: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Verified tokens are remembered briefly so a page load (records + catalog)
// doesn't make one Supabase round trip per request.
const TOKEN_CACHE_MS = 60_000;
const TOKEN_CACHE_MAX = 200;
const tokenCache = new Map<string, { user: AuthUser; expiresAt: number }>();

let authClient: SupabaseClient | null = null;
let warnedUnconfigured = false;
let warnedNoAdmins = false;

function getAuthClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return null;
  if (!authClient) {
    authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return authClient;
}

function emailList(raw: string | undefined): Set<string> | null {
  const items = (raw || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

export type Access =
  | { status: 'ok'; role: Role }
  | { status: 'forbidden' }
  | { status: 'misconfigured' };

// Pure: who may do what, from the two env lists. Exported for tests.
export function resolveAccess(
  email: string,
  env: { ALLOWED_EMAILS?: string; ADMIN_EMAILS?: string },
  strict: boolean
): Access {
  const allowed = emailList(env.ALLOWED_EMAILS);
  const admins = emailList(env.ADMIN_EMAILS);
  const who = email.trim().toLowerCase();

  if (!allowed && !admins) {
    // Nothing configured: dev is open, production refuses everyone.
    return strict ? { status: 'misconfigured' } : { status: 'ok', role: 'admin' };
  }
  if (!who) return { status: 'forbidden' };
  if (admins) {
    if (admins.has(who)) return { status: 'ok', role: 'admin' };
    return allowed?.has(who) ? { status: 'ok', role: 'operator' } : { status: 'forbidden' };
  }
  // ALLOWED_EMAILS only: no separate admins, so the allowlist is the admin list.
  return allowed!.has(who) ? { status: 'ok', role: 'admin' } : { status: 'forbidden' };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.substring(7).trim();
  return token || null;
}

async function verifyToken(client: SupabaseClient, token: string): Promise<AuthUser | null> {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) return cached.user;
  if (cached) tokenCache.delete(token);

  const { data, error } = await client.auth.getUser(token);
  if (error) {
    // 4xx = Supabase rejected the token. Anything else (network failure, 5xx)
    // is our problem, not the user's: surface it as 503, not "signed out".
    const status = (error as { status?: number }).status;
    if (status && status >= 400 && status < 500) return null;
    throw error;
  }
  if (!data?.user) return null;

  const user: AuthUser = { id: data.user.id, email: (data.user.email || '').toLowerCase() };
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(token, { user, expiresAt: now + TOKEN_CACHE_MS });
  return user;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const strict = isStrictDatabaseMode();
  const client = getAuthClient();
  if (!client) {
    if (strict) {
      console.error('[auth] SUPABASE_URL / SUPABASE_ANON_KEY missing; rejecting all API requests');
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Authentication is not configured on the server.',
      });
    }
    if (!warnedUnconfigured) {
      console.warn('[auth] Supabase not configured: API auth is DISABLED (local dev only)');
      warnedUnconfigured = true;
    }
    return next();
  }

  // Fail closed before spending a Supabase round trip: with no allowlist at all
  // there is nobody to authorize.
  if (strict && !emailList(process.env.ALLOWED_EMAILS) && !emailList(process.env.ADMIN_EMAILS)) {
    console.error('[auth] ALLOWED_EMAILS and ADMIN_EMAILS are both unset; rejecting all API requests');
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Access control is not configured on the server (set ADMIN_EMAILS and/or ALLOWED_EMAILS).',
    });
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sign in required.' });
  }

  let user: AuthUser | null;
  try {
    user = await verifyToken(client, token);
  } catch (err) {
    console.error('[auth] token verification failed:', (err as Error)?.message || err);
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Could not verify your session. Try again shortly.',
    });
  }
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Session is invalid or expired. Sign in again.' });
  }

  const access = resolveAccess(user.email, process.env, strict);
  if (access.status !== 'ok') {
    return res.status(403).json({ error: 'Forbidden', message: `${user.email || 'This account'} is not allowed to use this tracker.` });
  }
  if (!emailList(process.env.ADMIN_EMAILS) && !warnedNoAdmins) {
    console.warn('[auth] ADMIN_EMAILS is unset: every ALLOWED_EMAILS user is an admin. Set ADMIN_EMAILS to restrict vault contents and deletes.');
    warnedNoAdmins = true;
  }

  // Copy: verifyToken hands out the cached object, and roles are re-read from
  // the env on every request so a changed list takes effect without a restart.
  req.user = { ...user, role: access.role };
  next();
}

// Gate a route to one role. Runs after requireAuth. With auth disabled (local
// dev, no Supabase) there is no user and the route stays open; in strict mode a
// missing user is refused, never waved through.
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      if (isStrictDatabaseMode()) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Sign in required.' });
      }
      return next();
    }
    if (role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This action needs an administrator (ADMIN_EMAILS).',
      });
    }
    next();
  };
}
