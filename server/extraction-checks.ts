import assert from 'node:assert/strict';
import sharp from 'sharp';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { runApiChecks, withTestServer } from './checks.js';
import { atomicJson } from './storage.js';
import { sha256 } from './extraction.js';
import { extractionCheckNames, type ExtractionJob, type ExtractionManifest } from '../shared/extraction.js';
import { type CheckResult, type Project } from '../shared/project.js';

export async function waitForExtraction(base: string, job: ExtractionJob) {
  const deadline = Date.now() + 30_000;
  let current = job;
  while (current.status === 'running') {
    if (Date.now() > deadline) throw new Error('Extraction did not complete within 30 seconds.');
    await new Promise(resolve => setTimeout(resolve, 25));
    const response = await fetch(`${base}/api/projects/${job.projectId}/extractions/${job.id}`);
    assert.equal(response.status, 200, await response.clone().text());
    current = await response.json() as ExtractionJob;
  }
  return current;
}

export async function runExtractionApiChecks(base: string, fixtureDirectory: string, dataDirectory: string) {
  const results: CheckResult[] = [];
  let portrait: Project | undefined, landscape: Project | undefined;
  let portraitManifest: ExtractionManifest | undefined, landscapeManifest: ExtractionManifest | undefined;
  const json = (route: string, method: string, body: unknown) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const uploadAndSave = async (filename: string, type: string) => {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtureDirectory, filename)))], { type }), filename);
    const response = await fetch(base + '/api/upload', { method: 'POST', body: form });
    assert.equal(response.status, 201, await response.clone().text());
    const project = await response.json() as Project;
    // Deliberate manual corrections prove extraction uses approved pixels, not new detection.
    project.panels = project.panels.map(p => ({ ...p, x: p.x + 2, y: p.y + 1, width: p.width - 4, height: p.height - 2 }));
    project.manuallyAdjusted = true;
    const save = await json(`/api/projects/${project.id}`, 'PUT', project);
    assert.equal(save.status, 200, await save.clone().text());
    return (await save.json() as { project: Project }).project;
  };
  const extract = async (project: Project) => {
    const response = await json(`/api/projects/${project.id}/extract`, 'POST', { expectedUpdatedAt: project.updatedAt });
    assert.equal(response.status, 202, await response.clone().text());
    const job = await waitForExtraction(base, await response.json() as ExtractionJob);
    assert.equal(job.status, 'complete', job.error ?? job.message);
    assert.equal(job.progress, 100);
    assert(job.manifest);
    return job.manifest;
  };
  const check = async (index: number, action: () => Promise<string>) => {
    try { results.push({ name: extractionCheckNames[index], status: 'PASS', detail: await action() }); }
    catch (error) { results.push({ name: extractionCheckNames[index], status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); }
  };
  const pngBytes = async (url: string) => {
    const response = await fetch(base + url); assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  };
  // The test oracle independently decodes the full source and indexes each approved pixel.
  async function assertPixels(project: Project, manifest: ExtractionManifest, filename: string) {
    const original = await sharp(await readFile(path.join(fixtureDirectory, filename))).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const tile of manifest.tiles) {
      const panel = project.panels.find(p => p.id === tile.number)!;
      const output = await sharp(await pngBytes(tile.imageUrl)).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(output.info.width, panel.width); assert.equal(output.info.height, panel.height);
      const expected = Buffer.alloc(panel.width * panel.height * 4);
      for (let y = 0; y < panel.height; y++) {
        const start = ((panel.y + y) * original.info.width + panel.x) * 4;
        original.data.subarray(start, start + panel.width * 4).copy(expected, y * panel.width * 4);
      }
      assert(output.data.equals(expected), `${filename}, tile ${tile.number}: decoded pixels differ.`);
      assert.equal(tile.decodedPixelSha256, sha256(expected));
      assert.equal(tile.sourceRegionPixelSha256, sha256(expected));
    }
  }

  await check(0, async () => {
    portrait = await uploadAndSave('sample-comic.png', 'image/png');
    assert.equal(portrait.layout, '2x3'); portraitManifest = await extract(portrait);
    assert.equal(portraitManifest.tiles.length, 6);
    return 'Six native-resolution PNGs extracted from the saved, manually corrected portrait.';
  });
  await check(1, async () => {
    landscape = await uploadAndSave('landscape-comic.jpg', 'image/jpeg');
    assert.equal(landscape.layout, '3x2'); landscapeManifest = await extract(landscape);
    assert.equal(landscapeManifest.tiles.length, 6);
    return 'Six native-resolution PNGs extracted in 3-column, 2-row reading order.';
  });
  await check(2, async () => {
    assert(portraitManifest && landscapeManifest);
    for (const manifest of [portraitManifest, landscapeManifest]) {
      const directory = path.join(dataDirectory, 'exports', manifest.projectId, 'runs', manifest.extractionId, 'tiles');
      assert.deepEqual((await readdir(directory)).sort(), ['tile_01.png', 'tile_02.png', 'tile_03.png', 'tile_04.png', 'tile_05.png', 'tile_06.png']);
      for (const tile of manifest.tiles) assert.equal((await sharp(await pngBytes(tile.imageUrl)).metadata()).format, 'png');
    }
    return 'Each output tiles directory contains exactly tile_01.png through tile_06.png.';
  });
  await check(3, async () => {
    assert(portrait && landscape && portraitManifest && landscapeManifest);
    for (const [project, manifest] of [[portrait, portraitManifest], [landscape, landscapeManifest]] as const) {
      for (const tile of manifest.tiles) {
        const panel = project.panels.find(p => p.id === tile.number)!;
        assert.deepEqual(tile.crop, panel);
        const metadata = await sharp(await pngBytes(tile.imageUrl)).metadata();
        assert.equal(metadata.width, panel.width); assert.equal(metadata.height, panel.height);
        assert.equal(tile.width, panel.width); assert.equal(tile.height, panel.height);
      }
    }
    return 'All twelve output dimensions and crop rectangles match the approved source pixels.';
  });
  await check(4, async () => {
    assert(portrait && landscape && portraitManifest && landscapeManifest);
    await assertPixels(portrait, portraitManifest, 'sample-comic.png');
    await assertPixels(landscape, landscapeManifest, 'landscape-comic.jpg');
    return 'Every decoded RGBA byte matches its original full-resolution source region.';
  });
  await check(5, async () => {
    assert(portrait && landscapeManifest);
    const shuffled = { ...portrait, panels: [...portrait.panels].reverse() };
    const saved = await json(`/api/projects/${portrait.id}`, 'PUT', shuffled);
    assert.equal(saved.status, 200); portrait = (await saved.json() as { project: Project }).project;
    const regenerated = await extract(portrait);
    for (const manifest of [regenerated, landscapeManifest]) {
      assert.deepEqual(manifest.tiles.map(t => t.number), [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(manifest.tiles.map(t => t.filename), ['tile_01.png', 'tile_02.png', 'tile_03.png', 'tile_04.png', 'tile_05.png', 'tile_06.png']);
    }
    await assertPixels(portrait, regenerated, 'sample-comic.png');
    return 'Tile IDs preserve reading order even when the saved rectangle array is shuffled.';
  });
  await check(6, async () => {
    assert(portrait);
    const filename = path.join(dataDirectory, 'projects', `${portrait.id}.json`);
    for (const patch of [{ x: -1 }, { width: portrait.input.width + 1 }, { x: 1.5 }, { height: 0 }]) {
      const invalid = structuredClone(portrait); Object.assign(invalid.panels[0], patch);
      await atomicJson(filename, invalid);
      try { assert.equal((await json(`/api/projects/${portrait.id}/extract`, 'POST', { expectedUpdatedAt: portrait.updatedAt })).status, 400); }
      finally { await atomicJson(filename, portrait); }
    }
    return 'Negative, out-of-bounds, fractional, and zero-area saved rectangles rejected.';
  });
  await check(7, async () => {
    assert(portrait);
    const invalid = structuredClone(portrait);
    invalid.panels[1] = { ...invalid.panels[0], id: invalid.panels[1].id };
    const filename = path.join(dataDirectory, 'projects', `${portrait.id}.json`);
    await atomicJson(filename, invalid);
    try {
      const response = await json(`/api/projects/${portrait.id}/extract`, 'POST', { expectedUpdatedAt: portrait.updatedAt });
      assert.equal(response.status, 400); assert.match((await response.json() as { error: string }).error, /overlap/);
    } finally { await atomicJson(filename, portrait); }
    return 'Overlapping persisted rectangles rejected before a job can start.';
  });
  await check(8, async () => {
    assert(portrait && portraitManifest);
    const response = await fetch(base + `/api/projects/${portrait.id}`); assert.equal(response.status, 200);
    const reloaded = await response.json() as Project;
    const reproduced = await extract(reloaded);
    assert.deepEqual(reproduced.tiles.map(t => t.pngSha256), portraitManifest.tiles.map(t => t.pngSha256));
    for (const tile of reproduced.tiles) assert.equal(sha256(await pngBytes(tile.imageUrl)), portraitManifest.tiles[tile.number - 1].pngSha256);
    return 'Disk reload and re-extraction reproduce byte-identical PNG files.';
  });
  await check(9, async () => {
    const moduleOne = await runApiChecks(base, fixtureDirectory);
    const failed = moduleOne.filter(r => r.status === 'FAIL');
    assert.deepEqual(failed, []);
    return 'All 10 original Module 1 API scenarios passed unchanged.';
  });
  await check(10, async () => {
    assert(portrait && landscape && portraitManifest && landscapeManifest);
    const webp = await uploadAndSave('portrait-comic.webp', 'image/webp');
    const manifest = await extract(webp);
    await assertPixels(webp, manifest, 'portrait-comic.webp');
    await assertPixels(portrait, portraitManifest, 'sample-comic.png');
    await assertPixels(landscape, landscapeManifest, 'landscape-comic.jpg');
    return 'PNG, JPG, and WEBP each produce six lossless PNG regions with exact decoded pixels.';
  });
  await check(11, async () => {
    assert(portraitManifest && landscapeManifest);
    for (const manifest of [portraitManifest, landscapeManifest]) {
      const zip = unzipSync(await pngBytes(manifest.zipUrl));
      assert.deepEqual(Object.keys(zip).sort(), ['tile_01.png', 'tile_02.png', 'tile_03.png', 'tile_04.png', 'tile_05.png', 'tile_06.png', 'tile_extraction_manifest.json']);
      assert.deepEqual(JSON.parse(Buffer.from(zip['tile_extraction_manifest.json']).toString('utf8')), manifest);
      for (const tile of manifest.tiles) assert.equal(sha256(zip[tile.filename]), tile.pngSha256);
      const response = await fetch(base + manifest.zipUrl);
      assert.match(response.headers.get('content-disposition') ?? '', /six_extracted_tiles\.zip/);
      await response.body?.cancel();
    }
    return 'Both ZIPs contain all six exact PNGs and the matching complete manifest.';
  });
  return results;
}

export async function runExtractionDiagnostics() {
  const { fixtureRoot } = await import('./app.js');
  const results = await withTestServer((base, directory) => runExtractionApiChecks(base, fixtureRoot, directory));
  return { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
}
