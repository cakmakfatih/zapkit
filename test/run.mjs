// Bundles test/*.test.ts with esbuild (the sources use bundler-style imports)
// and runs them with the Node test runner.
import { build } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '.test-dist');
const filter = process.argv[2];
const entries = readdirSync(here)
  .filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter)))
  .map((f) => join(here, f));

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: entries,
  outdir: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: 'inline',
  external: ['jsdom'],
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  // package.json says sideEffects: false; test/setup.ts must still run.
  ignoreAnnotations: true,
});

const files = readdirSync(out).filter((f) => f.endsWith('.mjs')).map((f) => join(out, f));
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
