import React, { useRef, useState } from 'react';
import { CheckCircle2, FileCode2, Loader2, Upload } from 'lucide-react';
import { parseAlaraCommon, registryChanges, ParsedCommon, RegistryChange } from '@/lib/alaraCommonParse';
import { apiFetch, apiErrorMessage } from '../api';
import type { ServerNode } from '../useServers';

const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';
const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50';
const primary =
  'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50';

const envLabel = (e: string) => (e.toUpperCase() === 'PROD' ? 'PROD' : e);

// Check (and optionally fill) the server registry from the toolkit's own
// alara_common.sh: IPs, domains and env files. The file is only read as text.
export const CommonSyncPanel: React.FC<{ servers: ServerNode[]; onApplied: () => Promise<void> | void }> = ({ servers, onApplied }) => {
  const [text, setText] = useState('');
  const [common, setCommon] = useState<ParsedCommon | null>(null);
  const [changes, setChanges] = useState<RegistryChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyse = (source: string) => {
    setMsg(null);
    const parsed = parseAlaraCommon(source);
    if (parsed.roles.length === 0) {
      setCommon(null);
      setChanges([]);
      setMsg({ kind: 'error', text: 'No ALARA_IP_TABLE found. Paste the contents of alara/alara_common.sh.' });
      return;
    }
    setCommon(parsed);
    setChanges(registryChanges(parsed, servers));
  };

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // One PATCH per registry row, with all of that row's changes together.
      const byId = new Map<string, RegistryChange['patch']>();
      for (const c of changes) byId.set(c.id, { ...(byId.get(c.id) ?? {}), ...c.patch });
      for (const [id, patch] of byId) {
        const res = await apiFetch(`/api/servers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not update the registry'));
      }
      await onApplied();
      setChanges([]);
      setMsg({ kind: 'ok', text: `Registry updated: ${byId.size} server(s).` });
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.message || 'Could not reach the API. Nothing more was saved.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-label="Check the registry against the toolkit">
      <div className="flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Check against the toolkit</h2>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        The toolkit's <span className="font-mono">alara/alara_common.sh</span> is the source of truth for IPs, domains and env files. Paste it
        (or choose the file) to see where this registry differs, and fill it in. Nothing is written back to the toolkit, and the file is only read as
        text.
      </p>
      <textarea
        aria-label="alara_common.sh contents"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Paste alara_common.sh here..."
        className="mt-3 w-full rounded-xl border border-zinc-700/80 bg-surface-overlay px-3 py-2 font-mono text-xs text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={primary} disabled={!text.trim()} onClick={() => analyse(text)}>
          Compare
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".sh,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const t = await f.text();
            setText(t);
            analyse(t);
            e.target.value = '';
          }}
        />
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> Choose file
        </button>
        {text && (
          <button type="button" className={btn} onClick={() => { setText(''); setCommon(null); setChanges([]); setMsg(null); }}>
            Clear
          </button>
        )}
      </div>

      {msg && (
        <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-xs ${msg.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
          {msg.text}
        </p>
      )}

      {common && (
        <div className="mt-4 space-y-3 text-xs">
          <p className="text-zinc-300">
            Toolkit file{common.version ? ` v${common.version}` : ''}: {common.roles.length} roles, {common.domains.length} domain row(s)
            {common.expectedKeyFp ? `, shared key fingerprint ${common.expectedKeyFp}` : ', no shared-key fingerprint stamped yet'}.
          </p>
          {servers.length === 0 && <p className="text-amber-300">The registry is empty, so there is nothing to compare. Run prisma/manual/002_server_registry.sql first.</p>}
          {servers.length > 0 && changes.length === 0 && (
            <p className="flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> The registry already agrees with the toolkit.
            </p>
          )}
          {changes.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead>
                    <tr className="border-b border-white/15 text-[11px] uppercase tracking-wider text-zinc-400">
                      <th className="px-2 py-1.5 font-semibold">Server</th>
                      <th className="px-2 py-1.5 font-semibold">Field</th>
                      <th className="px-2 py-1.5 font-semibold">Registry now</th>
                      <th className="px-2 py-1.5 font-semibold">Toolkit says</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {changes.map((c) => (
                      <tr key={`${c.id}-${c.field}`}>
                        <td className="px-2 py-1.5 text-zinc-200">{envLabel(c.environment)} · {c.role}</td>
                        <td className="px-2 py-1.5 text-zinc-300">{c.field === 'envFiles' ? 'env files' : c.field}</td>
                        <td className="px-2 py-1.5 font-mono text-zinc-400">{c.current ?? 'empty'}</td>
                        <td className="px-2 py-1.5 font-mono text-emerald-300">{c.fromToolkit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className={primary} disabled={busy} onClick={apply}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Update registry ({changes.length} change{changes.length === 1 ? '' : 's'})
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
};
