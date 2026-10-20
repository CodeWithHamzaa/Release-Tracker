// Test harness for the real Express app (lib/app.ts) in strict/production
// mode. Nothing leaves the process: Supabase Auth is a local HTTP stub of
// GET /auth/v1/user, and the database is a fake Prisma client injected through
// the globalThis.prismaGlobal hook that lib/prisma.ts already honours.
// Used by the *.test.ts files only.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const TEST_USERS: Record<string, string> = {
  'admin-token': 'admin@x.com',
  'operator-token': 'operator@x.com',
  'stranger-token': 'stranger@x.com',
};

export interface ApiHarness {
  call: (method: string, path: string, token?: string, body?: unknown, raw?: string) => Promise<Response>;
  supabaseUrl: string;
  close: () => void;
}

// Starts the stub and the app. SUPABASE_URL is left unset on purpose (a test
// may want to prove strict mode fails closed); set it from `supabaseUrl`, or
// pass { withSupabase: true }.
export async function startApi(prisma: unknown, opts: { withSupabase?: boolean } = {}): Promise<ApiHarness> {
  const supabase = http.createServer((req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const email = TEST_USERS[token];
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/auth/v1/user') && email) {
      res.end(JSON.stringify({ id: `id-${token}`, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ msg: 'invalid JWT', code: 401 }));
    }
  });
  await new Promise<void>((r) => supabase.listen(0, '127.0.0.1', r));
  const supabaseUrl = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`;

  process.env.VERCEL = '1'; // strict mode, as in production
  process.env.DATABASE_URL = '';
  (globalThis as any).prismaGlobal = prisma;
  process.env.SUPABASE_ANON_KEY = 'anon';
  if (opts.withSupabase) process.env.SUPABASE_URL = supabaseUrl;
  process.env.ALLOWED_EMAILS = 'operator@x.com';
  process.env.ADMIN_EMAILS = 'admin@x.com';

  const { default: app } = await import('./app.js');
  const api = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => api.once('listening', r));
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const call = (method: string, path: string, token?: string, body?: unknown, raw?: string) =>
    fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

  return {
    call,
    supabaseUrl,
    close: () => {
      supabase.close();
      api.close();
    },
  };
}
