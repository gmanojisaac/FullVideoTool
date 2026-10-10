import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicJson, readJson } from '../server/storage.js';

test('Atomic JSON retries a transient Windows lock and replaces the complete value', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'six-tile-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'project.json');
  await atomicJson(filename, { revision: 1 });
  const rename = fs.rename.bind(fs); let attempts = 0;
  t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (to === filename && ++attempts < 3) throw Object.assign(new Error('Transient lock'), { code: 'EPERM' });
    await rename(from, to);
  });
  await atomicJson(filename, { revision: 2, panels: Array.from({ length: 6 }, (_, n) => n + 1) });
  assert.equal(attempts, 3);
  assert.deepEqual(await readJson(filename), { revision: 2, panels: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(await fs.readdir(directory), ['project.json']);
});

test('Atomic JSON keeps prior metadata and removes temporary files after permanent failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'six-tile-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'project.json');
  await atomicJson(filename, { revision: 1 });
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => { attempts++; throw Object.assign(new Error('Invalid destination'), { code: 'EINVAL' }); });
  await assert.rejects(atomicJson(filename, { revision: 2 }), { code: 'EINVAL' });
  assert.equal(attempts, 1);
  assert.deepEqual(await readJson(filename), { revision: 1 });
  assert.deepEqual(await fs.readdir(directory), ['project.json']);
});
