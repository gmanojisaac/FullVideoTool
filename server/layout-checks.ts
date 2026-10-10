import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { runApiChecks, withTestServer } from './checks.js';
import { runExtractionApiChecks, waitForExtraction } from './extraction-checks.js';
import { sha256 } from './extraction.js';
import { defaultGridSettings, layoutCheckNames, outputFormats, resolveGeometry, type GridJob, type GridSettings, type LayoutManifest } from '../shared/layout.js';
import { validatePanels, type CheckResult, type Project } from '../shared/project.js';
import type { ExtractionJob, ExtractionManifest } from '../shared/extraction.js';

export async function waitForGrid(base: string, job: GridJob) {
  const deadline = Date.now() + 60_000;
  let current = job;
  while (current.status === 'running') {
    if (Date.now() > deadline) throw new Error('Grid generation did not finish within 60 seconds.');
    await new Promise(resolve => setTimeout(resolve, 40));
    const response = await fetch(`${base}/api/projects/${job.projectId}/layouts/${job.id}`);
    assert.equal(response.status, 200, await response.clone().text());
    current = await response.json() as GridJob;
  }
  assert.equal(current.status, 'complete', current.error ?? current.message);
  assert(current.manifest);
  return current.manifest;
}

export async function runLayoutApiChecks(base: string, fixtureDirectory: string, dataDirectory: string) {
  const results: CheckResult[] = [];
  const json = async <T>(route: string, method = 'GET', body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.equal(response.status, status, await response.clone().text());
    return await response.json() as T;
  };
  const bytes = async (url: string) => {
    const response = await fetch(base + url);
    assert.equal(response.status, 200, await response.clone().text());
    return Buffer.from(await response.arrayBuffer());
  };
  type Bundle = { project: Project; source: ExtractionManifest; manifest: LayoutManifest };
  const bundles = new Map<string, Promise<Bundle>>();
  async function generate(source: ExtractionManifest, settings: GridSettings) {
    return waitForGrid(base, await json<GridJob>(`/api/projects/${source.projectId}/layouts`, 'POST', { expectedExtractionId: source.extractionId, settings }, 202));
  }
  function bundle(kind: 'portrait' | 'landscape'): Promise<Bundle> {
    let promise = bundles.get(kind);
    if (!promise) {
      promise = (async () => {
        const filename = kind === 'portrait' ? 'sample-comic.png' : 'landscape-comic.jpg';
        const form = new FormData();
        form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtureDirectory, filename)))], { type: kind === 'portrait' ? 'image/png' : 'image/jpeg' }), filename);
        const upload = await fetch(base + '/api/upload', { method: 'POST', body: form });
        assert.equal(upload.status, 201, await upload.clone().text());
        const initial = await upload.json() as Project;
        const { project } = await json<{ project: Project }>(`/api/projects/${initial.id}`, 'PUT', initial);
        const job = await waitForExtraction(base, await json<ExtractionJob>(`/api/projects/${project.id}/extract`, 'POST', { expectedUpdatedAt: project.updatedAt }, 202));
        assert.equal(job.status, 'complete', job.error ?? job.message); assert(job.manifest);
        return { project, source: job.manifest, manifest: await generate(job.manifest, defaultGridSettings()) };
      })();
      bundles.set(kind, promise);
    }
    return promise;
  }
  async function check(index: number, action: () => Promise<string>) {
    try { results.push({ name: layoutCheckNames[index], status: 'PASS', detail: await action() }); }
    catch (error) { results.push({ name: layoutCheckNames[index], status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); }
  }
  for (const [index, kind, format] of [[0, 'portrait', 'mobile'], [1, 'portrait', 'desktop'], [2, 'landscape', 'mobile'], [3, 'landscape', 'desktop']] as const) {
    await check(index, async () => {
      const { manifest, source } = await bundle(kind), output = manifest.outputs[format];
      const metadata = await sharp(await bytes(output.imageUrl)).metadata();
      assert.equal(metadata.format, 'png'); assert.equal(metadata.width, output.width); assert.equal(metadata.height, output.height);
      assert.equal(source.layout, kind === 'portrait' ? '2x3' : '3x2');
      assert.equal(output.width, format === 'mobile' ? 1080 : 1920); assert.equal(output.height, format === 'mobile' ? 1920 : 1080);
      return `${kind} extracted tiles generated ${output.width} × ${output.height} ${format} PNG.`;
    });
  }
  async function eachOutput(action: (output: LayoutManifest['outputs']['mobile'], source: ExtractionManifest) => Promise<void> | void) {
    for (const kind of ['portrait', 'landscape'] as const) {
      const { manifest, source } = await bundle(kind);
      for (const format of outputFormats) await action(manifest.outputs[format], source);
    }
  }
  await check(4, async () => {
    await eachOutput(({ geometry: g }) => { assert.equal(g.panels.length, 6); for (const p of g.panels) { assert.equal(p.width, g.cellWidth); assert.equal(p.height, g.cellHeight); assert([p.x, p.y, p.width, p.height].every(Number.isSafeInteger)); } });
    return 'All four outputs contain six exactly equal integer panel cells.';
  });
  await check(5, async () => {
    await eachOutput(async (o, source) => {
      assert.deepEqual(o.tileOrder, [1, 2, 3, 4, 5, 6]);
      const png = await sharp(await bytes(o.imageUrl)).ensureAlpha().raw().toBuffer();
      for (const p of o.placements) {
        assert.equal(p.sourceFilename, `tile_0${p.number}.png`);
        const tile = source.tiles[p.number - 1], t = p.transform;
        const scaled = await sharp(await bytes(tile.imageUrl)).toColourspace('srgb').ensureAlpha().resize({ width: p.destination.width, height: p.destination.height, fit: 'inside', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
        // Compare an interior pixel of the actual placed tile, independently of metadata.
        const x = Math.floor(scaled.info.width / 2), y = Math.floor(scaled.info.height / 2);
        const from = (y * scaled.info.width + x) * 4;
        const to = ((p.destination.y + t.paddingTop + y) * o.width + p.destination.x + t.paddingLeft + x) * 4;
        assert.deepEqual(png.subarray(to, to + 4), scaled.data.subarray(from, from + 4));
      }
    });
    return 'Source filenames and actual placed image pixels follow reading order in both formats.';
  });
  await check(6, async () => {
    await eachOutput(({ geometry: g }) => {
      for (const [i, p] of g.panels.entries()) { assert.equal(p.x, g.outerMargin + i % g.columns * (g.cellWidth + g.internalGutter)); assert.equal(p.y, g.outerMargin + Math.floor(i / g.columns) * (g.cellHeight + g.internalGutter)); }
      const last = g.panels[5]; assert.equal(g.width - last.x - last.width, g.outerMargin); assert.equal(g.height - last.y - last.height, g.outerMargin);
    });
    return 'All row/column boundaries align and outer margins are symmetric.';
  });
  await check(7, async () => { await eachOutput(o => assert.deepEqual(validatePanels(o.geometry.panels, o.width, o.height), [])); return 'Six positive, in-bounds, non-overlapping cells in all outputs.'; });
  await check(8, async () => {
    await eachOutput(async o => { const m = await sharp(await bytes(o.imageUrl)).metadata(); assert.equal(m.width, o.width); assert.equal(m.height, o.height); });
    return 'Decoded PNG dimensions are exactly 1080 × 1920 and 1920 × 1080.';
  });
  await check(9, async () => {
    await eachOutput(o => { for (const p of o.placements) { const t = p.transform, scale = Math.min(p.destination.width / p.sourceWidth, p.destination.height / p.sourceHeight); assert.equal(t.uniformScale, scale); assert(Math.abs(t.scaledWidth - p.sourceWidth * scale) <= 1); assert(Math.abs(t.scaledHeight - p.sourceHeight * scale) <= 1); } });
    return 'One scale factor per artwork; raster rounding differs by at most one pixel.';
  });
  await check(10, async () => {
    await eachOutput(async (o, source) => {
      for (const p of o.placements) {
        assert.equal(p.transform.artworkRemoved, false); assert.equal(p.transform.cropLeft, 0); assert.equal(p.transform.cropTop, 0);
        assert.deepEqual(p.transform.visibleSource, { x: 0, y: 0, width: p.sourceWidth, height: p.sourceHeight });
        const actual = await sharp(await bytes(o.imageUrl)).extract({ left: p.destination.x + p.transform.paddingLeft, top: p.destination.y + p.transform.paddingTop, width: p.transform.scaledWidth, height: p.transform.scaledHeight }).ensureAlpha().raw().toBuffer();
        const expected = await sharp(await bytes(source.tiles[p.number - 1].imageUrl)).toColourspace('srgb').ensureAlpha().resize({ width: p.destination.width, height: p.destination.height, fit: 'inside', kernel: 'lanczos3' }).raw().toBuffer();
        assert.deepEqual(actual, expected);
      }
    });
    return 'Every resized FIT artwork region matches its entire source, with no crop.';
  });
  await check(11, async () => {
    const { source } = await bundle('portrait'), settings = defaultGridSettings();
    settings.mobile.mode = settings.desktop.mode = 'FILL'; settings.mobile.positions[0].x = 0; settings.desktop.positions[0].x = 1;
    const filled = await generate(source, settings);
    for (const format of outputFormats) {
      const o = filled.outputs[format]; assert(o.placements.some(p => p.transform.artworkRemoved));
      for (const p of o.placements) {
        const t = p.transform; assert(t.scaledWidth >= p.destination.width && t.scaledHeight >= p.destination.height);
        assert.equal(t.cropLeft, Math.round((t.scaledWidth - p.destination.width) * t.position.x));
        assert.equal(t.cropTop, Math.round((t.scaledHeight - p.destination.height) * t.position.y));
        const expected = await sharp(await bytes(source.tiles[p.number - 1].imageUrl)).toColourspace('srgb').ensureAlpha().resize({ width: p.destination.width, height: p.destination.height, fit: 'outside', kernel: 'lanczos3' }).png().toBuffer();
        const crop = await sharp(expected).extract({ left: t.cropLeft, top: t.cropTop, width: p.destination.width, height: p.destination.height }).ensureAlpha().raw().toBuffer();
        const actual = await sharp(await bytes(o.imageUrl)).extract({ left: p.destination.x, top: p.destination.y, width: p.destination.width, height: p.destination.height }).ensureAlpha().raw().toBuffer();
        assert.deepEqual(actual, crop);
      }
    }
    for (const tile of source.tiles) assert.equal(sha256(await bytes(tile.imageUrl)), tile.pngSha256);
    return 'FILL crops match configured positions; all six original PNG checksums remain unchanged.';
  });
  await check(12, async () => {
    const { source } = await bundle('portrait'), settings = defaultGridSettings();
    for (const f of outputFormats) Object.assign(settings[f], { outerMargin: 17, internalGutter: 11, gutterColor: '#123456', paddingColor: '#654321' });
    const m = await generate(source, settings);
    for (const f of outputFormats) {
      const o = m.outputs[f], g = o.geometry, raw = await sharp(await bytes(o.imageUrl)).ensureAlpha().raw().toBuffer();
      const pixel = (x: number, y: number) => [...raw.subarray((y * o.width + x) * 4, (y * o.width + x) * 4 + 4)];
      assert.deepEqual(pixel(0, 0), [18, 52, 86, 255]);
      for (let x = g.panels[0].x + g.cellWidth; x < g.panels[1].x; x++) assert.deepEqual(pixel(x, g.outerMargin + 1), [18, 52, 86, 255]);
      const padded = o.placements.find(p => p.transform.paddingLeft > 0 || p.transform.paddingTop > 0); assert(padded);
      assert.deepEqual(pixel(padded.destination.x, padded.destination.y), [101, 67, 33, 255]);
      assert.equal(g.internalGutter, resolveGeometry(f, settings[f]).internalGutter); assert.equal(g.outerMargin, 17);
    }
    return 'Decoded pixels match configured colours; effective gutters and symmetric margins match the manifest.';
  });
  await check(13, async () => {
    const { source } = await bundle('portrait');
    const current = await json<{ settings: GridSettings; manifest: LayoutManifest }>(`/api/projects/${source.projectId}/layouts`);
    assert(current.manifest);
    const saved = JSON.parse(await readFile(path.join(dataDirectory, 'exports', source.projectId, 'grid-settings.json'), 'utf8')) as GridSettings;
    assert.deepEqual(saved, current.settings);
    const first = current.manifest, repeated = await generate(source, saved);
    for (const f of outputFormats) { assert.equal(first.outputs[f].pngSha256, repeated.outputs[f].pngSha256); assert.deepEqual(first.outputs[f].geometry, repeated.outputs[f].geometry); }
    const manifest = await json<LayoutManifest>(repeated.manifestUrl);
    assert.deepEqual(manifest, repeated);
    const download = await fetch(base + repeated.outputs.mobile.downloadUrl); assert.match(download.headers.get('content-disposition') ?? '', /mobile_six_tile_grid\.png/);
    return 'Persisted settings and manifest reload exactly; regeneration yields identical PNG hashes.';
  });
  await check(14, async () => {
    const first = await runApiChecks(base, fixtureDirectory), second = await runExtractionApiChecks(base, fixtureDirectory, dataDirectory);
    const failures = [...first, ...second].filter(r => r.status !== 'PASS');
    assert.equal(failures.length, 0, failures.map(r => `${r.name}: ${r.detail}`).join('\n'));
    return `${first.length} Module 1 and ${second.length} Module 2 API scenarios passed.`;
  });
  return results;
}
export async function runLayoutDiagnostics() {
  const { fixtureRoot } = await import('./app.js');
  const results = await withTestServer((base, directory) => runLayoutApiChecks(base, fixtureRoot, directory));
  return { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
}
