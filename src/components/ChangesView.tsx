// Changes: features and fixes, and which builds contain them.
//
// Two kinds of evidence are shown side by side and never merged:
//   - release-record notes that name the key (read from the audit log),
//   - mappings added here by hand, unverified until someone states what
//     proves them.
// Inclusion in later builds is computed by the planner; this page holds the
// facts it reasons from.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GitBranch, Link2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../api';
import { ROLES } from '@/lib/environments';
import type { CatalogService } from '../useCatalog';
import { btn, card, EmptyState, inputClass, labelClass, Message, PageHeader, Pill, primaryBtn, selectClass } from './ui';

interface Evidence {
  role: string;
  service: string;
  version: string;
  source: 'record' | 'manual';
  relation: 'introduced' | 'included';
  verified: boolean;
  recordId: string | null;
  environment: string | null;
  at: string | null;
  evidence: string | null;
  linkId: string | null;
}
interface ChangeEntry {
  key: string;
  title: string | null;
  kind: string | null;
  id: string | null;
  evidence: Evidence[];
  introduced: { role: string; service: string; version: string }[];
}

const KIND_TONE: Record<string, 'info' | 'ok' | 'muted'> = { feature: 'info', fix: 'ok', change: 'muted' };

export const ChangesView: React.FC<{ services: CatalogService[] }> = ({ services }) => {
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ key: '', title: '', kind: 'fix' });
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [link, setLink] = useState({ role: ROLES[0] as string, service: '', version: '', relation: 'introduced', evidence: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/changes');
      if (!res.ok) {
        setMessage({ kind: 'error', text: await apiErrorMessage(res, 'Could not load changes') });
        return;
      }
      const data = await res.json();
      setChanges(data.changes ?? []);
      setAvailable(!!data.available);
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the API.' });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const send = async (path: string, method: string, body?: unknown, ok?: string) => {
    setMessage(null);
    const res = await apiFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) {
      setMessage({ kind: 'error', text: await apiErrorMessage(res, 'Request failed') });
      return false;
    }
    if (ok) setMessage({ kind: 'ok', text: ok });
    await load();
    return true;
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (changes as ChangeEntry[]).filter((c) => !q || c.key.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q) || c.evidence.some((e) => e.service.toLowerCase().includes(q)));
  }, [changes, filter]);

  const servicesForRole = (services as CatalogService[]).filter((s) => s.server === link.role).map((s) => s.name);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={GitBranch}
        title="Changes"
        subtitle="Features and fixes, and the builds that carry them. Keys named in release-record notes (e.g. JIRA-123) appear here automatically."
        actions={<button type="button" className={btn} onClick={load} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh</button>}
      />

      {!available && <Message kind="warn">Manual mapping needs <span className="font-mono">prisma/manual/007_change_mapping.sql</span> run in Supabase. Until then only release-record notes are read.</Message>}
      {message && <Message kind={message.kind}>{message.text}</Message>}

      <section className={`${card} space-y-3`} aria-label="Add a change">
        <h2 className="text-sm font-semibold text-white">Add or rename a change</h2>
        <form
          className="grid gap-3 sm:grid-cols-[10rem_1fr_8rem_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send('/api/changes', 'POST', form, `Saved ${form.key.toUpperCase()}.`)) setForm({ key: '', title: '', kind: form.kind });
          }}
        >
          <label className="text-xs"><span className={labelClass}>Key</span><input required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="JIRA-123" className={`${inputClass} font-mono`} /></label>
          <label className="text-xs"><span className={labelClass}>Title</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What it does" className={inputClass} /></label>
          <label className="text-xs"><span className={labelClass}>Type</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={`${selectClass} w-full py-2`}>
              <option value="fix">Fix</option><option value="feature">Feature</option><option value="change">Change</option>
            </select>
          </label>
          <button type="submit" className={`${primaryBtn} self-end`} disabled={!available}><Plus className="h-4 w-4" /> Save</button>
        </form>
      </section>

      <div className="flex items-center gap-2">
        <input aria-label="Filter changes" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by key, title or service" className={`${inputClass} max-w-sm`} />
        <span className="text-xs text-zinc-400">{shown.length} change(s)</span>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={loading ? 'Loading…' : 'No changes yet'}>Add one above, or name a key like JIRA-123 in a release record note.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.key} className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-white">{c.key}</span>
                {c.kind && <Pill tone={KIND_TONE[c.kind] ?? 'muted'}>{c.kind}</Pill>}
                <span className="text-sm text-zinc-200">{c.title ?? <span className="text-zinc-400">only in release notes</span>}</span>
                <span className="flex-1" />
                {c.id && (
                  <button type="button" className={btn} onClick={() => { setLinkFor(linkFor === c.key ? null : c.key); setLink({ ...link, version: '', evidence: '' }); }}>
                    <Link2 className="h-3.5 w-3.5" /> Link a build
                  </button>
                )}
                {!c.id && available && (
                  <button type="button" className={btn} onClick={() => setForm({ key: c.key, title: '', kind: 'fix' })}>Give it a title</button>
                )}
                {c.id && (
                  <button type="button" className={btn} title="Administrators only" onClick={() => window.confirm(`Delete ${c.key} and its manual mappings? Release records are not touched.`) && send(`/api/changes/${c.id}`, 'DELETE', undefined, `Deleted ${c.key}.`)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {c.introduced.length > 0 && (
                <p className="text-xs text-zinc-300">Introduced in {c.introduced.map((i) => <span key={`${i.role}${i.service}`} className="font-mono text-zinc-100">{i.service} {i.version} </span>)}</p>
              )}
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wider text-zinc-400">
                    <tr><th className="px-2 py-1.5">Build</th><th className="px-2 py-1.5">Relation</th><th className="px-2 py-1.5">Evidence</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5"><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {c.evidence.map((e, i) => (
                      <tr key={i} className="border-t border-white/10 align-top">
                        <td className="px-2 py-1.5 font-mono text-zinc-100">{e.role} / {e.service} <span className="text-emerald-200">{e.version}</span></td>
                        <td className="px-2 py-1.5 text-zinc-300">{e.relation}</td>
                        <td className="px-2 py-1.5 text-zinc-300">{e.source === 'record' ? `Release record (${e.environment})` : e.evidence || 'Mapped by hand'}</td>
                        <td className="px-2 py-1.5">
                          {e.source === 'record' ? <Pill tone="ok">in release note</Pill> : e.verified ? <Pill tone="ok"><CheckCircle2 className="h-3 w-3" /> verified</Pill> : <Pill tone="warn">unverified</Pill>}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {e.linkId && !e.verified && (
                            <button type="button" className={btn} onClick={() => {
                              const proof = window.prompt('What proves this build contains the change? (commit, build log, test report)');
                              if (proof && proof.trim()) send(`/api/changes/builds/${e.linkId}`, 'PATCH', { verified: true, evidence: proof.trim() }, 'Marked verified.');
                            }}>Mark verified</button>
                          )}
                          {e.linkId && e.verified && (
                            <button type="button" className={btn} onClick={() => send(`/api/changes/builds/${e.linkId}`, 'PATCH', { verified: false }, 'Marked unverified.')}>Unverify</button>
                          )}
                          {e.linkId && (
                            <button type="button" className={`${btn} ml-1`} title="Administrators only" aria-label="Remove mapping" onClick={() => send(`/api/changes/builds/${e.linkId}`, 'DELETE', undefined, 'Mapping removed.')}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {c.evidence.length === 0 && <tr><td colSpan={5} className="px-2 py-2 text-zinc-400">No builds linked yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              {linkFor === c.key && c.id && (
                <form
                  className="grid gap-2 rounded-xl border border-white/10 p-3 sm:grid-cols-[11rem_1fr_9rem_9rem_1fr_auto]"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    if (await send(`/api/changes/${c.id}/builds`, 'POST', link, `Linked ${link.service} ${link.version} (unverified).`)) setLinkFor(null);
                  }}
                >
                  <select aria-label="Role" value={link.role} onChange={(e) => setLink({ ...link, role: e.target.value, service: '' })} className={selectClass}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <input required aria-label="Service" list={`svc-${c.key}`} value={link.service} onChange={(e) => setLink({ ...link, service: e.target.value })} placeholder="service" className={`${inputClass} font-mono`} />
                  <datalist id={`svc-${c.key}`}>{servicesForRole.map((n) => <option key={n} value={n} />)}</datalist>
                  <input required aria-label="Build" value={link.version} onChange={(e) => setLink({ ...link, version: e.target.value })} placeholder="v1.4.2" className={`${inputClass} font-mono`} />
                  <select aria-label="Relation" value={link.relation} onChange={(e) => setLink({ ...link, relation: e.target.value })} className={selectClass}>
                    <option value="introduced">introduced in</option><option value="included">also contains</option>
                  </select>
                  <input aria-label="Evidence" value={link.evidence} onChange={(e) => setLink({ ...link, evidence: e.target.value })} placeholder="evidence (optional)" className={inputClass} />
                  <button type="submit" className={primaryBtn}>Link</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
