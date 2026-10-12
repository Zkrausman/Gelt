import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { it, expect } from 'vitest';
import { storageFixture } from './storage-fixture.js';
import { writePrivateNew } from './private-files.js';
import { researchFixture } from './research-fixture.js';
import { provisionResearch } from './research-store.js';
function fixtureEnvironment(privateParent: string | undefined) {
  // Required fixed native helper prerequisites only; never spread process.env.
  return { NODE_ENV: 'test', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', GELT_WINDOWS_PRIVATE_PARENT: privateParent };
}
it('forwards only explicit nonsecret native helper prerequisites', () => {
  expect(fixtureEnvironment('C:\\fixture-parent')).toEqual({ NODE_ENV: 'test', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', GELT_WINDOWS_PRIVATE_PARENT: 'C:\\fixture-parent' });
});
async function child(operation: string, root: string, input: string): Promise<unknown> {
  const spawned = fork(resolve('worker/src/fixtures/research-process.ts'), [operation, root, input], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: fixtureEnvironment(process.env.GELT_WINDOWS_PRIVATE_PARENT),
  });
  let result: unknown, error: unknown;
  const timer = setTimeout(() => { error = new Error('research test deadline'); spawned.kill('SIGKILL'); }, 30000);
  return new Promise((done, reject) => {
    spawned.on('message', message => { result = message; });
    spawned.once('error', e => { error = e; });
    spawned.once('close', code => {
      clearTimeout(timer);
      if (error || code !== 0 || result === undefined) reject(error ?? new Error('test child unavailable'));
      else done(result);
    });
  });
}
it('committed byte evidence survives independent importer and reader process restarts', async () => {
  const roots = Array.from({ length: 7 }, () => storageFixture('research-process-'));
  const [root, source, ...excluded] = roots;
  try {
    provisionResearch(root, excluded);
    const path = join(source, 'input.json'), evidence = researchFixture();
    writePrivateNew(path, JSON.stringify(evidence));
    expect(await child('import', root, path)).toEqual({ state: 'imported' });
    expect(await child('read', root, evidence.evidenceId)).toMatchObject({ state: 'available', record: { evidence, geltChecks: { scientificReproduction: 'not_run' } } });
    expect(await child('import', root, path)).toEqual({ state: 'identical' });
    writePrivateNew(join(root, 'research-writer.lock'), 'test-owned interrupted writer');
    expect(await child('read', root, evidence.evidenceId)).toEqual({ state: 'unavailable' });
    expect(await child('import', root, path)).toEqual({ state: 'unavailable' });
  } finally { for (const path of roots) fs.rmSync(path, { recursive: true, force: true }); }
});
