import assert from 'node:assert/strict';
import sharp from 'sharp';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { runLayoutApiChecks, waitForGrid } from './layout-checks.js';
import { waitForExtraction } from './extraction-checks.js';
import { withTestServer } from './checks.js';
import { sha256 } from './extraction.js';
import { applyAutomaticSuggestion, cameraTransform, defaultFocusView, focusCheckNames, focusFilename, focusKey, resolveFocusView, type FocusConfig, type FocusJob, type FocusState } from '../shared/focus.js';
import { defaultGridSettings, type GridJob, type LayoutManifest } from '../shared/layout.js';
import type { ExtractionJob, ExtractionManifest } from '../shared/extraction.js';
import type { CheckResult, Project } from '../shared/project.js';

export async function waitForFocus(base: string, job: FocusJob) {
  const deadline = Date.now() + 90_000;
  let current = job;
  while (current.status === 'running') {
    if (Date.now() > deadline) throw new Error('Focus previews did not finish within 90 seconds.');
    await new Promise(resolve => setTimeout(resolve, 60));
    const response = await fetch(`${base}/api/projects/${job.projectId}/focus-previews/${job.id}`);
    assert.equal(response.status, 200, await response.clone().text()); current = await response.json() as FocusJob;
  }
  assert.equal(current.status, 'complete', current.error ?? current.message); assert(current.manifest);
  return current.manifest;
}
export async function runFocusApiChecks(base: string, fixtureDirectory: string, dataDirectory: string) {
  const results: CheckResult[] = [];
  async function json<T>(route: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
    const response = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.equal(response.status, status, await response.clone().text()); return await response.json() as T;
  }
  async function bytes(url: string) { const response = await fetch(base + url); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()); }
  let project: Project, source: ExtractionManifest, layout: LayoutManifest, config: FocusConfig;
  let preview: Awaited<ReturnType<typeof waitForFocus>>;
  const setup = async () => {
    const form = new FormData(); form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtureDirectory, 'sample-comic.png')))], { type: 'image/png' }), 'sample-comic.png');
    const response = await fetch(base + '/api/upload', { method: 'POST', body: form }); assert.equal(response.status, 201);
    const initial = await response.json() as Project;
    project = (await json<{ project: Project }>(`/api/projects/${initial.id}`, 'PUT', initial)).project;
    const extraction = await waitForExtraction(base, await json<ExtractionJob>(`/api/projects/${project.id}/extract`, 'POST', { expectedUpdatedAt: project.updatedAt }, 202));
    assert(extraction.manifest); source = extraction.manifest;
    layout = await waitForGrid(base, await json<GridJob>(`/api/projects/${project.id}/layouts`, 'POST', { expectedExtractionId: source.extractionId, settings: defaultGridSettings() }, 202));
    config = (await json<FocusState>(`/api/projects/${project.id}/focus`)).config;
  };
  async function save(next = config, approveView?: string) {
    config = await json<FocusConfig>(`/api/projects/${project.id}/focus`, 'PUT', { config: next, expectedRevision: config.revision, ...(approveView ? { approveView } : {}) }); return config;
  }
  async function generate() { return waitForFocus(base, await json<FocusJob>(`/api/projects/${project.id}/focus-previews`, 'POST', { expectedRevision: config.revision }, 202)); }
  async function check(index: number, action: () => Promise<string>) {
    try { results.push({ name: focusCheckNames[index], status: 'PASS', detail: await action() }); }
    catch (error) { results.push({ name: focusCheckNames[index], status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); }
  }
  await check(0, async () => { await setup(); for (const tile of source.tiles) { const b = await bytes(tile.imageUrl); assert.equal(sha256(b), tile.pngSha256); assert.equal((await sharp(b).metadata()).format, 'png'); } return 'Six native-resolution extracted PNGs loaded with matching checksums.'; });
  for (const [index, format] of [[1, 'mobile'], [2, 'desktop']] as const) await check(index, async () => { const o = layout.outputs[format], b = await bytes(o.imageUrl); assert.equal(sha256(b), o.pngSha256); const m = await sharp(b).metadata(); assert.equal(m.width, o.width); assert.equal(m.height, o.height); return `${format} grid loaded with correct dimensions and checksum.`; });
  await check(3, async () => {
    // One full-grid native view per format verifies real neighbours. One separate
    // detail view demonstrates isolation without silently changing native views.
    const next = structuredClone(config);
    for (const v of next.views) {
      if (v.tileNumber === 1) v.native.zoom = 0.25;
      if (v.tileNumber === 2 && v.format === 'desktop') v.cameraMode = 'detail';
    }
    await save(next); preview = await generate();
    assert.equal(preview.previews.filter(p => p.format === 'mobile').length, 6);
    assert.equal(preview.provisional, true); return 'Six provisional mobile stills generated.';
  });
  await check(4, async () => { assert.equal(preview.previews.filter(p => p.format === 'desktop').length, 6); for (const p of preview.previews) { assert.equal(p.filename, focusFilename(p.format, p.tileNumber)); assert.equal(sha256(await bytes(p.imageUrl)), p.pngSha256); } return 'Six provisional desktop stills with correct filenames and actual PNG checksums.'; });
  for (const [index, format, width, height] of [[5, 'mobile', 1080, 1920], [6, 'desktop', 1920, 1080]] as const) await check(index, async () => { for (const p of preview.previews.filter(p => p.format === format)) { const m = await sharp(await bytes(p.imageUrl)).metadata(); assert.equal(m.width, width); assert.equal(m.height, height); } return `All six ${format} PNGs decode at ${width} × ${height}.`; });
  await check(7, async () => { for (const v of config.views) { const t = v.transform; assert(t.scale > 0); assert(Math.abs(t.visibleSourceRectangle.width * t.scale - t.viewport.width) < 1e-8); assert(Math.abs(t.visibleSourceRectangle.height * t.scale - t.viewport.height) < 1e-8); assert.equal(t.translation.x, t.viewport.width / 2 - t.focalPoint.x * t.scale); assert.equal(t.translation.y, t.viewport.height / 2 - t.focalPoint.y * t.scale); } return 'One identical X/Y scale and deterministic pixel-space translation per view.'; });
  await check(8, async () => { const before = structuredClone(config.views.find(v => focusKey(v) === 'desktop-3')); const next = structuredClone(config); const v = next.views.find(v => focusKey(v) === 'mobile-3')!; v.native.zoom = 2.4; v.native.center.x = 0.35; v.manualOverride = true; await save(next); assert.deepEqual(config.views.find(v => focusKey(v) === 'desktop-3'), before); assert.equal(config.views.find(v => focusKey(v) === 'mobile-3')!.native.zoom, 2.4); return 'Editing mobile tile 3 leaves its desktop configuration unchanged.'; });
  await check(9, async () => { const next = structuredClone(config), v = next.views.find(v => focusKey(v) === 'mobile-4')!; const before = v.transform; v.native.zoom = 3; v.native.center = { x: 0.68, y: 0.51 }; v.manualOverride = true; await save(next); const restored = (await json<FocusState>(`/api/projects/${project.id}/focus`)).config; const changed = restored.views.find(v => focusKey(v) === 'mobile-4')!; assert.notEqual(changed.transform.scale, before.scale); assert.notDeepEqual(changed.transform.translation, before.translation); assert.deepEqual(changed.transform, cameraTransform(changed, 'native', layout, source)); return 'Changed source-pixel centre and zoom reload as the recomputed transform.'; });
  await check(10, async () => {
    const { createApp } = await import('./app.js');
    const server = createApp(dataDirectory, false).listen(0, '127.0.0.1'); await once(server, 'listening');
    try { const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${project.id}/focus`); assert.equal(response.status, 200); const restored = await response.json() as FocusState; assert.deepEqual(restored.config, config); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    const disk = JSON.parse(await readFile(path.join(dataDirectory, 'exports', project.id, 'metadata', 'focus_config.json'), 'utf8'));
    assert.deepEqual(disk, config); return 'A fresh service instance and on-disk focus_config restore all twelve views exactly.';
  });
  await check(11, async () => { const next = structuredClone(config), index = next.views.findIndex(v => focusKey(v) === 'mobile-4'); next.views[index] = defaultFocusView('mobile', 4, layout, source); await save(next); const current = config.views[index], defaults = defaultFocusView('mobile', 4, layout, source); assert.deepEqual(current.native, defaults.native); assert.deepEqual(current.detail, defaults.detail); assert.equal(current.manualOverride, false); return 'Reset restores default native/detail framing for only the selected view.'; });
  await check(12, async () => { const next = structuredClone(config), v = next.views.find(v => focusKey(v) === 'mobile-3')!; v.manualOverride = true; await save(next, 'mobile-3'); const manual = config.views.find(v => focusKey(v) === 'mobile-3')!; assert.equal(manual.approved, true); assert.deepEqual(applyAutomaticSuggestion(manual, layout, source), manual); assert.equal(manual.autoDetection.status, 'unverified'); assert.deepEqual(manual.autoDetection.detectedSubjects, []); return 'Approved manual crop is untouched by automatic suggestions; no detection is invented.'; });
  await check(13, async () => {
    for (const format of ['mobile', 'desktop'] as const) {
      const p = preview.previews.find(p => p.format === format && p.tileNumber === 1)!;
      const focused = await sharp(await bytes(p.imageUrl)).ensureAlpha().raw().toBuffer(), grid = await sharp(await bytes(layout.outputs[format].imageUrl)).ensureAlpha().raw().toBuffer();
      assert.deepEqual(focused, grid);
    }
    return 'Native scale=1 renders exact decoded grid RGBA pixels, including every neighbouring tile.';
  });
  await check(14, async () => { const v = config.views.find(v => focusKey(v) === 'desktop-2')!; assert.equal(v.cameraMode, 'detail'); assert.equal(v.detailTransform.coordinateSpace, 'tile-pixels'); assert.equal(v.nativeTransform.coordinateSpace, 'grid-pixels'); assert.equal(v.transform.requiresControlledTransition, true); assert.deepEqual(v.transform, v.detailTransform); assert.equal(preview.previews.find(p => p.format === 'desktop' && p.tileNumber === 2)!.cameraMode, 'detail'); return 'Detail configuration and output labels retain the separate native transform and controlled-transition flag.'; });
  await check(15, async () => { for (const format of ['mobile', 'desktop'] as const) { const v = config.views.find(v => v.format === format && v.tileNumber === 1)!; assert.equal(v.transform.neighboursOrGuttersVisible, true); } for (const tile of source.tiles) assert.equal(sha256(await bytes(tile.imageUrl)), tile.pngSha256); return 'Visible neighbours are disclosed; original tile PNGs are unchanged and no artwork is generated.'; });
  await check(16, async () => {
    const invalid = structuredClone(config); invalid.views[0].native.zoom = -1;
    await json(`/api/projects/${project.id}/focus`, 'PUT', { config: invalid, expectedRevision: config.revision }, 400);
    const finite = structuredClone(config); finite.views[0].native.center = { x: -5, y: 8 }; await save(finite);
    const t = config.views[0].transform, r = t.visibleSourceRectangle;
    assert(r.x >= -1e-7 && r.y >= -1e-7 && r.x + r.width <= t.sourceWidth + 1e-7 && r.y + r.height <= t.sourceHeight + 1e-7);
    await json(`/api/projects/${project.id}/focus`, 'PUT', { config, expectedRevision: config.revision - 1 }, 409);
    return 'Invalid zoom rejected; finite out-of-bounds positions clamped to real native grid bounds; stale revisions rejected.';
  });
  await check(17, async () => { const previous = await runLayoutApiChecks(base, fixtureDirectory, dataDirectory); const failures = previous.filter(r => r.status !== 'PASS'); assert.equal(failures.length, 0, failures.map(r => `${r.name}: ${r.detail}`).join('\n')); return `${previous.length} Module 3 scenarios passed, including Module 1–2 API regression checks.`; });
  return results;
}
export async function runFocusDiagnostics() {
  const { fixtureRoot } = await import('./app.js');
  const results = await withTestServer((base, directory) => runFocusApiChecks(base, fixtureRoot, directory));
  return { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
}
