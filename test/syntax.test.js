import { fileURLToPath } from 'node:url';
// Every app file must at least parse (a typo here blanks the whole app).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('app files parse', () => {
  for (const f of readdirSync(new URL('../public/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`../public/${f}`, import.meta.url))]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

// The renderer is compiled from tools/simulation into the public bundle, so a
// typo there also blanks the 3D map — and it is only caught at build time.
test('renderer and simulation sources parse', () => {
  for (const dir of ['../tools/simulation/', '../public/simulation/']) {
    for (const f of readdirSync(new URL(dir, import.meta.url)).filter((x) => x.endsWith('.js') || x.endsWith('.mjs'))) {
      const r = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(`${dir}${f}`, import.meta.url))]);
      assert.equal(r.status, 0, `${dir}${f}: ${r.stderr}`);
    }
  }
});
