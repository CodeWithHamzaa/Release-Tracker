import React, { useMemo, useState } from 'react';
import { AlertTriangle, Network } from 'lucide-react';
import { findPortConflicts } from '@/lib/compose';
import type { CatalogService } from '../useCatalog';

const ENVS = ['SIT', 'UAT', 'Prod'] as const;

const card = 'rounded-2xl border border-white/15 bg-white/[0.02] p-5 sm:p-6';

interface PortRow {
  environment: string;
  host: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
  service: string;
  group: string;
  shared: boolean; // another service on this env + host publishes the same host port
}

// Host-port map synced from the Config Vault compose files: which service
// publishes which port, on which role (host), in which environment. Rows from
// the old manual import keep their host label until the first sync. Shared
// ports are flagged (fine behind a reverse proxy, otherwise one container
// will not start).
export const PortMapPanel: React.FC<{ services: CatalogService[] }> = ({ services }) => {
  const [env, setEnv] = useState<string>('All');
  const [query, setQuery] = useState('');

  const { rows, sharedCount } = useMemo(() => {
    const bindings = services.flatMap((s) =>
      s.ports.map((p) => ({ service: s.name, environment: p.environment, host: p.host, hostPort: p.hostPort, protocol: p.protocol }))
    );
    const conflicts = findPortConflicts(bindings);
    const key = (e: string, h: string, port: number, proto: string) => `${e}\u0000${h}\u0000${port}\u0000${(proto || 'tcp').toLowerCase()}`;
    const shared = new Set(conflicts.map((c) => key(c.environment, c.host, c.hostPort, c.protocol)));
    const out: PortRow[] = services.flatMap((s) =>
      s.ports.map((p) => ({
        environment: p.environment,
        host: p.host,
        hostPort: p.hostPort,
        containerPort: p.containerPort,
        protocol: p.protocol,
        service: s.name,
        group: s.server,
        shared: shared.has(key(p.environment, p.host, p.hostPort, p.protocol)),
      }))
    );
    out.sort(
      (a, b) =>
        ENVS.indexOf(a.environment as (typeof ENVS)[number]) - ENVS.indexOf(b.environment as (typeof ENVS)[number]) ||
        a.host.localeCompare(b.host) ||
        a.hostPort - b.hostPort ||
        a.service.localeCompare(b.service)
    );
    return { rows: out, sharedCount: conflicts.length };
  }, [services]);

  const shown = rows.filter((r) => {
    if (env !== 'All' && r.environment !== env) return false;
    const q = query.trim().toLowerCase();
    return !q || `${r.service} ${r.host} ${r.hostPort} ${r.containerPort} ${r.group}`.toLowerCase().includes(q);
  });

  return (
    <section className={card} aria-label="Port map">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Port map</h2>
          <span className="text-xs text-zinc-400">
            {rows.length} published port(s)
            {sharedCount > 0 && <span className="ml-1 text-amber-300">· {sharedCount} shared</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Port map environment" className="flex gap-1">
            {['All', ...ENVS].map((e) => (
              <button
                key={e}
                type="button"
                role="tab"
                aria-selected={env === e}
                onClick={() => setEnv(e)}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                  env === e
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
                    : 'border-white/15 bg-white/[0.03] text-zinc-300 hover:border-white/30 hover:text-white'
                }`}
              >
                {e === 'Prod' ? 'PROD' : e}
              </button>
            ))}
          </div>
          <input
            aria-label="Filter ports"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="service, host or port"
            className="w-44 rounded-lg border border-zinc-700/80 bg-surface-overlay px-2.5 py-1.5 text-xs text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-zinc-400">
          No ports saved yet. Import a docker-compose.yml above to fill the port map.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-white/15 text-[11px] uppercase tracking-wider text-zinc-400">
                <th className="px-2 py-2 font-semibold">Env</th>
                <th className="px-2 py-2 font-semibold">Host</th>
                <th className="px-2 py-2 font-semibold">Host port</th>
                <th className="px-2 py-2 font-semibold">Container</th>
                <th className="px-2 py-2 font-semibold">Service</th>
                <th className="px-2 py-2 font-semibold">Group</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {shown.map((r, i) => (
                <tr key={`${r.environment}-${r.host}-${r.hostPort}-${r.protocol}-${r.service}-${i}`} className={r.shared ? 'bg-amber-500/5' : undefined}>
                  <td className="px-2 py-1.5 font-semibold text-zinc-200">{r.environment === 'Prod' ? 'PROD' : r.environment}</td>
                  <td className="px-2 py-1.5 font-mono text-zinc-300">{r.host}</td>
                  <td className="px-2 py-1.5 font-mono text-zinc-100">
                    {r.hostPort}
                    {r.protocol !== 'tcp' && <span className="text-zinc-400">/{r.protocol}</span>}
                    {r.shared && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded border border-amber-500/30 px-1 text-[10px] text-amber-300" title="Another service on this host publishes the same host port">
                        <AlertTriangle className="h-3 w-3" /> shared
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-zinc-300">{r.containerPort}</td>
                  <td className="px-2 py-1.5 font-mono text-zinc-100">{r.service}</td>
                  <td className="px-2 py-1.5 text-zinc-300">{r.group}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-zinc-400">
                    No ports match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
