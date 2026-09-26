// docker-compose.yml parsing and host-port conflict detection.
//
// Pure functions with no Node or browser APIs, so the same code runs in the
// Catalog page (preview while you paste) and in the API (re-validating what is
// saved). Only host-published ports matter for conflicts: `expose` and
// container-only ports are listed but never clash on the host.

import { parse } from 'yaml';

export interface ComposePort {
  hostPort: number;
  containerPort: number;
  protocol: string; // tcp | udp | sctp
  hostIp: string | null;
}

export interface ComposeService {
  name: string;
  image: string | null;
  containerName: string | null;
  ports: ComposePort[];
  // Ports reachable only inside the compose networks (expose, or a container
  // port published on a random host port). Shown for reference.
  internalPorts: string[];
  hostNetwork: boolean;
}

export interface ComposeParseResult {
  services: ComposeService[];
  warnings: string[];
}

export interface PortBinding {
  service: string;
  environment: string;
  host: string;
  hostPort: number;
  protocol: string;
}

export interface PortConflict {
  environment: string;
  host: string;
  hostPort: number;
  protocol: string;
  services: string[];
}

const MAX_RANGE = 1000;

// Resolve ${VAR:-default}, ${VAR-default}, ${VAR} and $VAR against `vars`.
// Returns null when a variable has neither a value nor a default.
export function interpolate(value: string, vars: Record<string, string> = {}): string | null {
  let unresolved = false;
  const out = value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_m, braced: string, op: string | undefined, def: string | undefined, bare: string) => {
      const name = braced || bare;
      const v = vars[name];
      if (op === ':-') return v ? v : def ?? '';
      if (op === '-') return v !== undefined ? v : def ?? '';
      if (v !== undefined) return v;
      unresolved = true;
      return '';
    }
  );
  return unresolved ? null : out;
}

function parseRange(spec: string): [number, number] | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  if (start < 1 || end > 65535 || end < start || end - start >= MAX_RANGE) return null;
  return [start, end];
}

function expand(hostSpec: string, containerSpec: string, protocol: string, hostIp: string | null,
  where: string, warnings: string[]): ComposePort[] {
  const host = parseRange(hostSpec);
  const container = parseRange(containerSpec);
  if (!host || !container) {
    warnings.push(`${where}: could not read port "${hostSpec}:${containerSpec}"`);
    return [];
  }
  const hostLen = host[1] - host[0];
  const containerLen = container[1] - container[0];
  if (hostLen !== containerLen && containerLen !== 0) {
    warnings.push(`${where}: host range ${hostSpec} and container range ${containerSpec} differ in size`);
    return [];
  }
  if (hostLen !== containerLen) {
    // "8000-8005:80" = Docker picks one free host port from the range.
    warnings.push(`${where}: ${hostSpec}:${containerSpec} lets Docker pick a host port; recorded as ${host[0]}`);
    return [{ hostPort: host[0], containerPort: container[0], protocol, hostIp }];
  }
  const ports: ComposePort[] = [];
  for (let i = 0; i <= hostLen; i++) {
    ports.push({ hostPort: host[0] + i, containerPort: container[0] + i, protocol, hostIp });
  }
  return ports;
}

// Short syntax: [HOST_IP:][HOST:]CONTAINER[/PROTOCOL]
function parseShortPort(raw: string, where: string, warnings: string[], internal: string[]): ComposePort[] {
  let spec = raw.trim();
  let protocol = 'tcp';
  const slash = spec.lastIndexOf('/');
  if (slash !== -1) {
    protocol = spec.slice(slash + 1).toLowerCase() || 'tcp';
    spec = spec.slice(0, slash);
  }

  let hostIp: string | null = null;
  const v6 = /^\[([^\]]+)\]:(.*)$/.exec(spec);
  if (v6) {
    hostIp = v6[1];
    spec = v6[2];
  }

  const parts = spec.split(':');
  if (parts.length === 1) {
    internal.push(`${parts[0]}/${protocol}`);
    return [];
  }
  if (parts.length === 3) {
    hostIp = parts[0] || null;
    parts.shift();
  } else if (parts.length !== 2) {
    warnings.push(`${where}: could not read port "${raw}"`);
    return [];
  }
  const [hostSpec, containerSpec] = parts;
  if (!hostSpec) {
    // "127.0.0.1::80" = random host port on that IP.
    internal.push(`${containerSpec}/${protocol}`);
    return [];
  }
  return expand(hostSpec, containerSpec, protocol, hostIp, where, warnings);
}

export function parseCompose(text: string, vars: Record<string, string> = {}): ComposeParseResult {
  const warnings: string[] = [];
  let doc: any;
  try {
    doc = parse(text, { merge: true });
  } catch (err) {
    return { services: [], warnings: [`Not valid YAML: ${(err as Error).message.split('\n')[0]}`] };
  }
  if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') {
    return { services: [], warnings: ['No top-level "services:" section found.'] };
  }

  const services: ComposeService[] = [];
  for (const [name, def] of Object.entries<any>(doc.services)) {
    const svc: ComposeService = {
      name,
      image: null,
      containerName: null,
      ports: [],
      internalPorts: [],
      hostNetwork: false,
    };
    const where = `service "${name}"`;

    if (def && typeof def === 'object') {
      if (typeof def.image === 'string') {
        const image = interpolate(def.image, vars);
        svc.image = image ?? def.image;
        if (image === null) warnings.push(`${where}: image "${def.image}" uses an unset variable`);
      }
      if (typeof def.container_name === 'string') svc.containerName = def.container_name;
      svc.hostNetwork = def.network_mode === 'host';
      if (svc.hostNetwork) {
        warnings.push(`${where}: network_mode: host binds ports straight on the host; they can't be read from the file`);
      }

      for (const entry of Array.isArray(def.ports) ? def.ports : []) {
        if (typeof entry === 'number') {
          svc.internalPorts.push(`${entry}/tcp`);
        } else if (typeof entry === 'string') {
          const resolved = interpolate(entry, vars);
          if (resolved === null) {
            warnings.push(`${where}: port "${entry}" uses an unset variable with no default; skipped`);
            continue;
          }
          svc.ports.push(...parseShortPort(resolved, where, warnings, svc.internalPorts));
        } else if (entry && typeof entry === 'object') {
          // Long syntax: { target, published, protocol, host_ip }
          const protocol = String(entry.protocol || 'tcp').toLowerCase();
          const target = interpolate(String(entry.target ?? ''), vars);
          const published = entry.published === undefined ? '' : interpolate(String(entry.published), vars);
          if (target === null || published === null) {
            warnings.push(`${where}: a long-syntax port uses an unset variable; skipped`);
            continue;
          }
          if (!published) {
            svc.internalPorts.push(`${target}/${protocol}`);
            continue;
          }
          const hostIp = entry.host_ip ? String(entry.host_ip) : null;
          svc.ports.push(...expand(published, target, protocol, hostIp, where, warnings));
        }
      }

      for (const entry of Array.isArray(def.expose) ? def.expose : []) {
        svc.internalPorts.push(String(entry));
      }
    }
    services.push(svc);
  }

  return { services, warnings };
}

// Host ports bound by more than one service on the same environment + host.
// Host IPs are ignored on purpose: 0.0.0.0 (the default) clashes with every
// specific IP, and flagging a rare false positive beats missing a real clash.
export function findPortConflicts(bindings: PortBinding[]): PortConflict[] {
  const byKey = new Map<string, PortConflict>();
  for (const b of bindings) {
    const protocol = (b.protocol || 'tcp').toLowerCase();
    const key = `${b.environment}\u0000${b.host}\u0000${b.hostPort}\u0000${protocol}`;
    let c = byKey.get(key);
    if (!c) {
      c = { environment: b.environment, host: b.host, hostPort: b.hostPort, protocol, services: [] };
      byKey.set(key, c);
    }
    if (!c.services.includes(b.service)) c.services.push(b.service);
  }
  return [...byKey.values()]
    .filter((c) => c.services.length > 1)
    .sort((a, b) => a.hostPort - b.hostPort);
}
