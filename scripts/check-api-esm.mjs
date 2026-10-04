// Loads the API the way Vercel runs it, to catch module errors before deploy.
//
// @vercel/node compiles each .ts file on its own (no bundling) and keeps every
// import specifier as written; plain Node ESM then resolves them. Vite and tsx
// are more forgiving (path aliases, extensionless imports), so the dev server
// and the tests can pass while the deployed function crashes on load. This
// script compiles api/ and lib/ file by file with esbuild and imports
// api/index.js under plain Node, so these fail here instead of in production:
//   - '@/...' aliases (Node reads them as npm package names)
//   - relative imports without the .js extension
//   - JSON imports without `with { type: 'json' }`
//
// Output goes under node_modules/ so npm packages still resolve.

import { transform } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'node_modules', '.cache', 'api-esm-check');
rmSync(out, { recursive: true, force: true });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

for (const dir of ['api', 'lib']) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file);
    if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue;
    const { code } = await transform(readFileSync(file, 'utf8'), { loader: 'ts', format: 'esm', platform: 'node', target: 'node22' });
    const dest = join(out, rel.replace(/\.ts$/, '.js'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, code);
  }
}
cpSync(join(root, 'config'), join(out, 'config'), { recursive: true });
writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }));

try {
  const mod = await import(pathToFileURL(join(out, 'api', 'index.js')).href);
  if (typeof mod.default !== 'function') throw new Error('api/index.js does not export a request handler');
  console.log('check:api ok: api/index.js loads under plain Node ESM');
} catch (err) {
  console.error('check:api FAILED: the deployed API would crash on load.\n');
  console.error(err);
  process.exit(1);
}
