import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { moveGridEdge, validatePanels, validateProject, type CheckResult, type Project } from '../shared/project.js';

export async function runApiChecks(base: string, fixtureDirectory: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let portrait: Project | undefined, landscape: Project | undefined;
  const json = async (route: string, method: string, body: unknown) => fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const upload = async (filename: string, type: string, buffer?: Buffer) => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(buffer ?? await readFile(path.join(fixtureDirectory, filename)))], { type }), filename);
    return fetch(base + '/api/upload', { method: 'POST', body: form });
  };
  const check = async (name: string, action: () => Promise<string>) => {
    try { results.push({ name, status: 'PASS', detail: await action() }); }
    catch (error) { results.push({ name, status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); }
  };

  await check('Upload valid portrait comic (PNG)', async () => {
    const res = await upload('sample-comic.png', 'image/png');
    assert.equal(res.status, 201, await res.clone().text());
    portrait = await res.json() as Project;
    assert.equal(portrait.layout, '2x3');
    assert.equal(portrait.input.width, 848); assert.equal(portrait.input.height, 1264);
    assert.deepEqual(validateProject(portrait), []);
    return 'Original sample accepted; 848 × 1264, 2 columns × 3 rows.';
  });
  await check('Upload valid landscape comic (JPG)', async () => {
    const res = await upload('landscape-comic.jpg', 'image/jpeg');
    assert.equal(res.status, 201, await res.clone().text());
    landscape = await res.json() as Project;
    assert.equal(landscape.layout, '3x2');
    assert(landscape.input.width > landscape.input.height);
    return 'Landscape accepted; 3 columns × 2 rows.';
  });
  await check('Upload WEBP image', async () => {
    const res = await upload('portrait-comic.webp', 'image/webp');
    assert.equal(res.status, 201, await res.clone().text());
    const project = await res.json() as Project;
    assert.equal(project.input.format, 'webp'); assert.equal(project.layout, '2x3');
    return 'WEBP decoded and detected correctly.';
  });
  await check('Detect six regions and gutter boundaries', async () => {
    assert(portrait && landscape, 'Portrait and landscape uploads must pass first.');
    const truth = JSON.parse(await readFile(path.join(fixtureDirectory, 'ground-truth.json'), 'utf8'));
    for (const [project, expected] of [[portrait, truth.portrait], [landscape, truth.landscape]] as const) {
      assert.equal(project.panels.length, 6); assert.deepEqual(validatePanels(project.panels, project.input.width, project.input.height), []);
      for (let i = 0; i < 6; i++) {
        for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
          assert(Math.abs(project.panels[i][coordinate] - expected.panels[i][coordinate]) <= 5, `Panel ${i + 1} ${coordinate} differs from independently measured boundaries.`);
        }
      }
      assert(project.detection.confidence >= 0.85);
    }
    return 'Both fixtures: six non-overlapping regions, within 5 px of ground truth.';
  });
  await check('Adjust gutters manually and save', async () => {
    assert(portrait);
    const adjusted = moveGridEdge(portrait, 'x', 0, 1, portrait.grid.x[0][1] - 5);
    assert.equal(adjusted.panels[0].width, portrait.panels[0].width - 5);
    assert.equal(adjusted.panels[2].width, portrait.panels[2].width - 5);
    assert.equal(adjusted.manuallyAdjusted, true);
    assert.deepEqual(validateProject(adjusted), []);
    const res = await json(`/api/projects/${adjusted.id}`, 'PUT', adjusted);
    assert.equal(res.status, 200, await res.clone().text());
    portrait = (await res.json() as { project: Project }).project;
    return 'Gutter edge moved by 5 px; corresponding panels updated and JSON saved.';
  });
  await check('Reject unsupported and corrupt images', async () => {
    const unsupported = await upload('unsupported.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    assert.equal(unsupported.status, 415);
    const corrupt = await upload('corrupt.png', 'image/png', Buffer.from('not a PNG image'));
    assert.equal(corrupt.status, 400);
    const truncated = await upload('truncated.png', 'image/png', (await readFile(path.join(fixtureDirectory, 'sample-comic.png'))).subarray(0, 500));
    assert.equal(truncated.status, 400);
    const spoofed = await upload('disguised.webp', 'image/webp', await readFile(path.join(fixtureDirectory, 'sample-comic.png')));
    assert.equal(spoofed.status, 415);
    return 'Unsupported, corrupt, truncated, and disguised image content rejected.';
  });
  await check('Reload saved layout coordinates', async () => {
    assert(portrait);
    const res = await fetch(base + `/api/projects/${portrait.id}`);
    assert.equal(res.status, 200);
    const loaded = await res.json() as Project;
    assert.deepEqual(loaded.panels, portrait.panels); assert.deepEqual(loaded.grid, portrait.grid);
    assert.equal(loaded.input.sha256, portrait.input.sha256);
    const imported = await json('/api/projects/import', 'POST', loaded);
    assert.equal(imported.status, 200);
    assert.deepEqual((await imported.json() as Project).panels, loaded.panels);
    return 'Disk reload and JSON import preserve the corrected coordinates exactly.';
  });
  await check('Switch between 2 × 3 and 3 × 2', async () => {
    assert(portrait);
    for (const layout of ['3x2', '2x3']) {
      const res = await json('/api/detect', 'POST', { inputId: portrait.input.id, layout });
      assert.equal(res.status, 200);
      const detected = await res.json() as Project;
      assert.equal(detected.layout, layout); assert.equal(detected.panels.length, 6);
      assert.deepEqual(validatePanels(detected.panels, portrait.input.width, portrait.input.height), []);
    }
    return 'Manual layout selection returns six valid panels in either orientation.';
  });
  await check('Reject overlapping and invalid project coordinates', async () => {
    assert(portrait);
    const invalid = structuredClone(portrait);
    invalid.panels[1] = { ...invalid.panels[0], id: 2 };
    const overlapping = await json(`/api/projects/${invalid.id}`, 'PUT', invalid);
    assert.equal(overlapping.status, 400);
    assert.match((await overlapping.json() as { error: string }).error, /overlap/);
    const missing = { ...portrait, panels: portrait.panels.slice(0, 5) };
    assert.equal((await json('/api/projects/import', 'POST', missing)).status, 400);
    invalid.panels[0].x = -1;
    assert.equal((await json('/api/projects/import', 'POST', invalid)).status, 400);
    const tampered = { ...portrait, input: { ...portrait.input, width: portrait.input.width + 100 } };
    assert.equal((await json(`/api/projects/${portrait.id}`, 'PUT', tampered)).status, 400);
    return 'Overlap, five panels, negative coordinates, and changed metadata rejected.';
  });
  await check('Respect EXIF orientation', async () => {
    const res = await upload('exif-portrait.jpg', 'image/jpeg');
    assert.equal(res.status, 201, await res.clone().text());
    const project = await res.json() as Project;
    assert.equal(project.input.width, 848); assert.equal(project.input.height, 1264); assert.equal(project.layout, '2x3');
    return 'Coordinates match the displayed portrait even when JPEG pixels are rotated.';
  });
  return results;
}

export async function withTestServer<T>(action: (base: string, dataDirectory: string, server: Server) => Promise<T>) {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, 'sixframe-module-one-'));
  const { createApp } = await import('./app.js');
  const server = createApp(directory, false).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try { return await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, directory, server); }
  finally {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // All assertions have finished. Do not let an unread test-download body keep this temporary server alive.
    server.closeAllConnections(); await closed;
    // Verify the resolved deletion target is inside the intended temporary root.
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('sixframe-module-one-')) throw new Error('Unsafe temporary cleanup path.');
    await rm(resolved, { recursive: true, force: true });
  }
}

export async function runDiagnostics() {
  const { fixtureRoot } = await import('./app.js');
  const results = await withTestServer(base => runApiChecks(base, fixtureRoot));
  return { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
}
