import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { type AddressInfo } from 'node:net';
import { runDiagnostics, withTestServer } from '../server/checks.js';
import { createApp, fixtureRoot } from '../server/app.js';
import { validateProject, type Project } from '../shared/project.js';

test('Module 1 acceptance checks', async t => {
  const report = await runDiagnostics();
  for (const result of report.results) {
    await t.test(result.name, () => {
      console.log(`${result.status} — ${result.name}: ${result.detail}`);
      assert.equal(result.status, 'PASS', result.detail);
    });
  }
});

test('Saved project survives service recreation', async () => {
  await withTestServer(async (base, directory) => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtureRoot, 'sample-comic.png')))], { type: 'image/png' }), 'sample-comic.png');
    const upload = await fetch(base + '/api/upload', { method: 'POST', body: form });
    const project = await upload.json() as Project;
    const save = await fetch(base + `/api/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) });
    assert.equal(save.status, 200);
    const second = createApp(directory, false).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => second.once('listening', resolve));
    try {
      const loaded = await fetch(`http://127.0.0.1:${(second.address() as AddressInfo).port}/api/projects/${project.id}`);
      assert.equal(loaded.status, 200);
      const restored = await loaded.json() as Project;
      assert.deepEqual(restored.panels, project.panels);
      assert.equal((await fetch(`http://127.0.0.1:${(second.address() as AddressInfo).port}${restored.input.imageUrl}`)).status, 200);
      console.log('PASS — Project and original image survive service recreation.');
    } finally { await new Promise<void>(resolve => second.close(() => resolve())); }
  });
});

test('Malformed project shapes fail without throwing', () => {
  for (const value of [null, [], {}, { version: 1 }, { version: 1, input: null }]) assert(validateProject(value).length > 0);
  console.log('PASS — Malformed project JSON returns validation errors.');
});
