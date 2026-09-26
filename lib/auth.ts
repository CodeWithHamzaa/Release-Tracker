// API authentication: every request must carry the Supabase access token of a
// signed-in user (Authorization: Bearer <jwt>).
//
// - The token is checked against Supabase Auth (auth.getUser), so a signed-out
//   or deleted user is rejected, not just an expired token.
// - ALLOWED_EMAILS (comma separated, optional) is a second lock on top of
//   disabling public sign-ups in Supabase.
// - Strict mode (production / Vercel) with Supabase not configured fails
//   closed with 503. Local dev with no Supabase configured skips auth, the
//   same way lib/prisma.ts falls back to mock records.

import type { NextFunction, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isStrictDatabaseMode } from './prisma.js';

export interface AuthUser {
  id: string;
  email: string;
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

function allowedEmails(): Set<string> | null {
  const raw = (process.env.ALLOWED_EMAILS || '').trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
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
  const client = getAuthClient();
  if (!client) {
    if (isStrictDatabaseMode()) {
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

  const allowed = allowedEmails();
  if (allowed && !allowed.has(user.email)) {
    return res.status(403).json({ error: 'Forbidden', message: `${user.email} is not allowed to use this tracker.` });
  }

  req.user = user;
  next();
}
