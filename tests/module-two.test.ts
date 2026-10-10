import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { runExtractionDiagnostics, waitForExtraction } from '../server/extraction-checks.js';
import { withTestServer } from '../server/checks.js';
import { fixtureRoot, createApp } from '../server/app.js';
import { sha256, decodeOriginal, copyRegion } from '../server/extraction.js';
import { configurationHash } from '../server/extraction.js';
import type { ExtractionJob, ExtractionManifest } from '../shared/extraction.js';
import type { Project } from '../shared/project.js';
import type { AddressInfo } from 'node:net';
import { atomicJson } from '../server/storage.js';

test('Module 2 acceptance checks', async t => {
  const report = await runExtractionDiagnostics();
  for (const result of report.results) await t.test(result.name, () => {
    console.log(`${result.status} — ${result.name}: ${result.detail}`);
    assert.equal(result.status, 'PASS', result.detail);
  });
});

async function upload(base: string, filename: string, type: string, bytes?: Buffer) {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes ?? await readFile(path.join(fixtureRoot, filename)))], { type }), filename);
  const response = await fetch(base + '/api/upload', { method: 'POST', body: form });
  assert.equal(response.status, 201, await response.clone().text());
  return await response.json() as Project;
}
const post = (base: string, route: string, body: unknown, method = 'POST') => fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function save(base: string, project: Project) {
  const response = await post(base, `/api/projects/${project.id}`, project, 'PUT');
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json() as { project: Project }).project;
}
async function extract(base: string, project: Project) {
  const response = await post(base, `/api/projects/${project.id}/extract`, { expectedUpdatedAt: project.updatedAt });
  assert.equal(response.status, 202, await response.clone().text());
  return await waitForExtraction(base, await response.json() as ExtractionJob);
}

test('Require saved confirmation and reject stale approvals; hide obsolete previews', async () => {
  await withTestServer(async base => {
    let project = await upload(base, 'sample-comic.png', 'image/png');
    assert.equal((await post(base, `/api/projects/${project.id}/extract`, { expectedUpdatedAt: project.updatedAt })).status, 404);
    project = await save(base, project);
    assert.equal((await post(base, `/api/projects/${project.id}/extract`, { expectedUpdatedAt: 'old-version' })).status, 409);
    assert.equal((await extract(base, project)).status, 'complete');
    const changed = { ...project, panels: project.panels.map(p => p.id === 1 ? { ...p, width: p.width - 3 } : p), manuallyAdjusted: true };
    project = await save(base, changed);
    const current = await fetch(base + `/api/projects/${project.id}/extraction`);
    assert.equal((await current.json() as { manifest: unknown }).manifest, null);
    console.log('PASS — Unsaved/stale extraction rejected; changed crop coordinates invalidate old previews.');
  });
});

test('EXIF orientation and transparent alpha preserve exact selected pixels', async () => {
  await withTestServer(async base => {
    const rgba = Buffer.alloc(240 * 360 * 4);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 240; x++) {
      const i = (y * 240 + x) * 4;
      rgba[i] = x % 256; rgba[i + 1] = y % 256; rgba[i + 2] = (x + y) % 256; rgba[i + 3] = (x * 3 + y) % 256;
    }
    const transparent = await sharp(rgba, { raw: { width: 240, height: 360, channels: 4 } }).png().toBuffer();
    for (const [filename, type, source] of [['alpha.png', 'image/png', transparent], ['exif-portrait.jpg', 'image/jpeg', await readFile(path.join(fixtureRoot, 'exif-portrait.jpg'))]] as const) {
      const project = await save(base, await upload(base, filename, type, source));
      const job = await extract(base, project); assert.equal(job.status, 'complete', job.error);
      const original = await decodeOriginal(source);
      for (const tile of job.manifest!.tiles) {
        const response = await fetch(base + tile.imageUrl);
        const png = await decodeOriginal(Buffer.from(await response.arrayBuffer()));
        assert(png.data.equals(copyRegion(original.data, original.info.width, tile.crop, 4)));
      }
    }
    console.log('PASS — EXIF-oriented coordinates and transparent RGBA pixels remain exact.');
  });
});

test('Keep 16-bit PNG sample precision', async () => {
  await withTestServer(async base => {
    const raw = new Uint16Array(240 * 360 * 4);
    for (let i = 0; i < raw.length; i += 4) { raw[i] = i % 65536; raw[i + 1] = (i * 13) % 65536; raw[i + 2] = 32123; raw[i + 3] = (i * 7) % 65536; }
    const source = await sharp(raw, { raw: { width: 240, height: 360, channels: 4 } }).toColourspace('rgb16').png().toBuffer();
    const project = await save(base, await upload(base, 'sixteen-bit.png', 'image/png', source));
    const job = await extract(base, project); assert.equal(job.status, 'complete', job.error);
    assert.equal(job.manifest!.bitDepth, 16);
    const original = await decodeOriginal(source);
    assert.equal(original.bitDepth, 16);
    for (const tile of job.manifest!.tiles) {
      const response = await fetch(base + tile.imageUrl);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal((await sharp(bytes).metadata()).depth, 'ushort');
      assert((await decodeOriginal(bytes)).data.equals(copyRegion(original.data, original.info.width, tile.crop, 8)));
    }
    console.log('PASS — All 16 bits per RGBA sample are preserved in PNG extraction.');
  });
});

test('Cancel extraction without publishing partial results; retry succeeds', async () => {
  await withTestServer(async (base, directory) => {
    const project = await save(base, await upload(base, 'sample-comic.png', 'image/png'));
    const response = await post(base, `/api/projects/${project.id}/extract`, { expectedUpdatedAt: project.updatedAt });
    const initial = await response.json() as ExtractionJob;
    const cancelled = await post(base, `/api/projects/${project.id}/extractions/${initial.id}/cancel`, {});
    assert.equal(cancelled.status, 200);
    const terminal = await waitForExtraction(base, await cancelled.json() as ExtractionJob);
    assert.equal(terminal.status, 'cancelled');
    assert.equal((await fetch(base + `/api/projects/${project.id}/extraction`).then(r => r.json())).manifest, null);
    assert.equal((await fetch(base + `/api/projects/${project.id}/extractions/${initial.id}/files/tile_01.png`)).status, 409);
    const runs = path.join(directory, 'exports', project.id, 'runs');
    assert(!(await readdir(runs).catch((): string[] => [])).includes(initial.id));
    assert.equal((await extract(base, project)).status, 'complete');
    console.log('PASS — Cancellation removes only the incomplete run; saved coordinates can be retried.');
  });
});

test('Completed extraction downloads and interrupted job state survive service recreation', async () => {
  await withTestServer(async (base, directory) => {
    const project = await save(base, await upload(base, 'sample-comic.png', 'image/png'));
    const original = await extract(base, project); assert.equal(original.status, 'complete');
    const interruptedId = randomUUID();
    const interrupted: ExtractionJob = { id: interruptedId, projectId: project.id, configurationSha256: configurationHash(project), status: 'running', completedTiles: 2, totalTiles: 6, progress: 34, message: 'Interrupted test', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelRequested: false };
    await atomicJson(path.join(directory, 'exports', project.id, 'jobs', `${interruptedId}.json`), interrupted);
    const second = createApp(directory, false).listen(0, '127.0.0.1');
    await new Promise<void>(resolve => second.once('listening', resolve));
    const restartedBase = `http://127.0.0.1:${(second.address() as AddressInfo).port}`;
    try {
      const current = await fetch(restartedBase + `/api/projects/${project.id}/extraction`).then(r => r.json()) as { manifest: ExtractionManifest };
      assert.equal(current.manifest.extractionId, original.id);
      const tile = await fetch(restartedBase + current.manifest.tiles[0].imageUrl);
      assert.equal(sha256(Buffer.from(await tile.arrayBuffer())), current.manifest.tiles[0].pngSha256);
      const interrupted = await fetch(restartedBase + `/api/projects/${project.id}/extractions/${interruptedId}`).then(r => r.json()) as ExtractionJob;
      assert.equal(interrupted.status, 'failed'); assert.match(interrupted.error!, /service stopped/);
    } finally { await new Promise<void>(resolve => second.close(() => resolve())); }
    console.log('PASS — Completed results survive a restart; interrupted jobs report a retryable failure.');
  });
});
