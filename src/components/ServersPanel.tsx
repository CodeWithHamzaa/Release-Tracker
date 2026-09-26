import React, { useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Server, X } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../api';
import type { ServerNode } from '../useServers';

const ENVS = ['SIT', 'UAT', 'Prod'];
const ROLES = ['Bot-Builder', 'ChatBot / NLU', 'Database', 'Chat-Service'];

const inputClass =
  'w-full px-2.5 py-1.5 bg-[#1f1f23] border border-zinc-700/80 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500';

const Unverified = () => <span className="text-amber-400/80">unverified</span>;

type Draft = Record<'ip' | 'domain' | 'composePath' | 'runAs' | 'access' | 'toolkitVersion' | 'notes' | 'envFiles', string>;

const FIELDS: { key: keyof Draft; label: string; mono?: boolean; placeholder?: string }[] = [
  { key: 'ip', label: 'IP', mono: true, placeholder: '10.42.42.250' },
  { key: 'composePath', label: 'Compose folder', mono: true, placeholder: '/root/ISSM/...' },
  { key: 'runAs', label: 'Run as', mono: true, placeholder: 'root / chatbotuat' },
  { key: 'toolkitVersion', label: 'Toolkit version', placeholder: 'from ./alara_server.sh doctor' },
  { key: 'envFiles', label: 'Env files (comma separated)', mono: true, placeholder: '.env_fbl, .env' },
  { key: 'domain', label: 'Domain', mono: true },
  { key: 'access', label: 'Access' },
  { key: 'notes', label: 'Notes' },
];

// Environment x role grid of the server registry, with edit in a small form.
export const ServersPanel: React.FC<{
  servers: ServerNode[];
  warning: string | null;
  onReload: () => Promise<void> | void;
}> = ({ servers, warning, onReload }) => {
  const [editing, setEditing] = useState<ServerNode | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cell = (env: string, role: string) => servers.find((s) => s.environment === env && s.role === role);

  const startEdit = (s: ServerNode) => {
    setEditing(s);
    setError(null);
    setDraft({
      ip: s.ip || '',
      domain: s.domain || '',
      composePath: s.composePath || '',
      runAs: s.runAs || '',
      access: s.access || '',
      toolkitVersion: s.toolkitVersion || '',
      notes: s.notes || '',
      envFiles: (s.envFiles || []).join(', '),
    });
  };

  const save = async () => {
    if (!editing || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const { envFiles, ...text } = draft;
      const res = await apiFetch(`/api/servers/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...text,
          envFiles: envFiles.split(',').map((f) => f.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Could not save'));
        return;
      }
      await onReload();
      setEditing(null);
    } catch {
      setError('Could not reach the API. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Servers</h2>
        <span className="text-xs text-zinc-500">used by the patch runbook: environment guard, folder, account</span>
      </div>

      {warning && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {warning}
        </p>
      )}

      {servers.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-white/[0.03] text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Role</th>
                {ENVS.map((e) => (
                  <th key={e} className="px-3 py-2 font-semibold">{e.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ROLES.map((role) => (
                <tr key={role}>
                  <td className="px-3 py-2 font-semibold text-zinc-200">{role}</td>
                  {ENVS.map((env) => {
                    const s = cell(env, role);
                    if (!s) return <td key={env} className="px-3 py-2 text-zinc-600">—</td>;
                    return (
                      <td key={env} className="px-3 py-2 align-top">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-mono text-zinc-200">{s.ip || <Unverified />}</div>
                            <div className="text-zinc-500">
                              as <span className="font-mono">{s.runAs || <Unverified />}</span>
                            </div>
                            <div className="truncate font-mono text-zinc-500" title={s.composePath || undefined}>
                              {s.composePath || <>folder <Unverified /></>}
                            </div>
                            {s.toolkitVersion && <div className="text-zinc-500">toolkit {s.toolkitVersion}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() => startEdit(s)}
                            className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
                            aria-label={`Edit ${env} ${role}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && draft && (
        <div className="space-y-3 rounded-xl border border-emerald-900/60 bg-emerald-950/10 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {editing.environment.toUpperCase()} / {editing.role}
            </h3>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md p-1 text-zinc-400 hover:text-white" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{f.label}</span>
                <input
                  value={draft[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  className={`${inputClass} ${f.mono ? 'font-mono' : ''}`}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500">Leave a field blank if you don't know it; it shows as unverified.</p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </section>
  );
};
