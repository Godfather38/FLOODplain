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
