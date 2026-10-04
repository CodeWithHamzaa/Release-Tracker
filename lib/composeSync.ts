// Turns the latest vault docker-compose.yml for one environment + role into
// catalog rows: services, per-environment images and published host ports.
//
// Pure functions with no Node or browser APIs, so the parsing rules are
// unit-tested without a database. lib/app.ts does the writes; the client uses
// primaryComposePath so the Health page and the catalog read the same file.

import { parseCompose, ComposePort } from './compose.js';
import { parseEnvFile } from './envFile.js';
import { imageRepo, imageTag } from './configDrift.js';

export const isComposePath = (path: string) => /compose.*\.ya?ml$/i.test(path);

// One compose file per environment + role feeds the catalog: docker-compose.yml
// when present, else the first compose-named file by name.
export function primaryComposePath(paths: string[]): string | null {
  const compose = paths.filter(isComposePath).sort();
  return compose.includes('docker-compose.yml') ? 'docker-compose.yml' : compose[0] ?? null;
}

export interface SyncService {
  name: string; // catalog name
  composeKey: string; // key under services:
  containerName: string | null;
  image: string | null;
  tag: string | null;
  ports: ComposePort[];
}

// ok=false: the file can't be applied (error says why) and nothing is synced.
export interface SyncPlan {
  ok: boolean;
  error: string | null;
  services: SyncService[];
  warnings: string[];
}

export function planComposeSync(input: { compose: string; dotEnv: string | null; catalogNames: string[] }): SyncPlan {
  // docker compose fills ${VAR} from the project's .env only (env_file: values
  // go into the container, not into the YAML). ENC[...] values can't be used,
  // so ports that need them are reported as unset by parseCompose.
  const vars: Record<string, string> = {};
  for (const e of input.dotEnv ? parseEnvFile(input.dotEnv).entries : []) {
    if (!e.encrypted) vars[e.key] = e.value;
  }
  const { services, warnings } = parseCompose(input.compose, vars);
  if (services.length === 0) {
    // Never wipe a role's catalog because of an unreadable file.
    return { ok: false, error: warnings[0] ?? 'No services found in the compose file.', services: [], warnings };
  }

  // A compose key that is itself a catalog name keeps it; no other service may
  // borrow it through its container name or image.
  const taken = new Set<string>(services.map((s) => s.name).filter((n) => input.catalogNames.includes(n)));
  const out: SyncService[] = services.map((s) => {
    // Keep the catalog name when the compose key differs (alara-ui2 vs
    // alara-ui) -- the same rule as the image-change logger on the Configs page.
    const name = taken.has(s.name)
      ? s.name
      : [s.containerName, imageRepo(s.image)].find(
          (n): n is string => !!n && input.catalogNames.includes(n) && !taken.has(n)
        ) ?? s.name;
    taken.add(name);
    const ports: ComposePort[] = [];
    for (const p of s.ports) {
      if (!ports.some((q) => q.hostPort === p.hostPort && q.protocol === p.protocol)) ports.push(p);
    }
    return { name, composeKey: s.name, containerName: s.containerName, image: s.image, tag: imageTag(s.image), ports };
  });
  return { ok: true, error: null, services: out, warnings };
}
