/**
 * The committed service-worker.js is what its sources build to.
 *
 * Chrome loads the bundle, not `src/background/`, so an edit there without
 * `npm run build --workspace=extension` ships nothing — the commonest way a
 * fix "did not work" here. Built in memory with the same options as the
 * build script, and compared byte for byte (v8.7, run by CI on every push).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('service-worker.js is the build of src/background/', async () => {
  const out = await build({
    entryPoints: [resolve(ROOT, 'src/background/main.js')],
    bundle: true, write: false, logLevel: 'silent', absWorkingDir: ROOT,
  });
  const built = out.outputFiles[0].text;
  const committed = readFileSync(resolve(ROOT, 'service-worker.js'), 'utf8');
  assert.ok(
    built === committed,
    'service-worker.js is stale — run `npm run build --workspace=extension` and commit it',
  );
});
