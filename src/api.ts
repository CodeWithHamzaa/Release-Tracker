import { getSupabaseClient } from '@/lib/supabase';

// fetch() for the tracker API: attaches the signed-in user's Supabase access
// token (refreshed by supabase-js when it is close to expiry). A 401 means the
// session is gone server-side, so sign out locally and let App show the login
// screen instead of a page of errors.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && supabase) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
  return res;
}

// The API's error body is { error, message, reason? }; fall back to the status.
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  const reason = data?.reason ? ` (${data.reason})` : '';
  return `${data?.message || `${fallback} (HTTP ${res.status})`}${reason}`;
}
