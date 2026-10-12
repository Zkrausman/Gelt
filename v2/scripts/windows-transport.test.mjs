import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('direct native probe refuses unsupported runtime instead of a Linux success receipt', { skip: process.platform === 'win32' && process.arch === 'x64' && process.version.startsWith('v22.') }, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./windows-transport.mjs', import.meta.url))], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Native transport requires Windows x64 Node22; no native acceptance\n');
});
