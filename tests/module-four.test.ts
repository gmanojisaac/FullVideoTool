import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runFocusDiagnostics } from '../server/focus-checks.js';
import { cameraTransform, canonicalFocusConfig, defaultFocusConfig, validateFocusConfig } from '../shared/focus.js';
import { renderFocusPixels } from '../shared/focus-render.js';
import type { LayoutManifest } from '../shared/layout.js';
import type { ExtractionManifest } from '../shared/extraction.js';

test('Module 4 acceptance checks', async t => {
  const report = await runFocusDiagnostics();
  for (const result of report.results) await t.test(result.name, () => {
    console.log(`${result.status} — ${result.name}: ${result.detail}`);
    assert.equal(result.status, 'PASS', result.detail);
  });
});
// No user data dependency: build the small manifest inputs required by geometry.
const source = { projectId: 'sample', extractionId: 'extraction', source: { inputId: 'comic' }, tiles: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, filename: `tile_0${i + 1}.png`, width: 400, height: 400 })) } as ExtractionManifest;
const output = (width: number, height: number, columns: number, rows: number) => ({ filename: 'grid.png', width, height, geometry: { panels: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, x: i % columns * width / columns, y: Math.floor(i / columns) * height / rows, width: width / columns, height: height / rows })) } });
const layout = { projectId: 'sample', generationId: 'layout', outputs: { mobile: output(1080, 1920, 2, 3), desktop: output(1920, 1080, 3, 2) } } as LayoutManifest;
test('Clamp native framing to source bounds across zoom, tile and format', () => {
  const config = defaultFocusConfig(layout, source);
  for (const view of config.views) for (const zoom of [0.25, 1, 3, 8]) for (const x of [-10, 0, 0.3, 1, 10]) {
    view.native.zoom = zoom; view.native.center = { x, y: x };
    const t = cameraTransform(view, 'native', layout, source), r = t.visibleSourceRectangle;
    assert(t.scale >= 1); assert(r.x >= -1e-7 && r.y >= -1e-7); assert(r.x + r.width <= t.sourceWidth + 1e-7); assert(r.y + r.height <= t.sourceHeight + 1e-7);
  }
});
test('Server canonicalization ignores supplied transform and detection claims', () => {
  const config = defaultFocusConfig(layout, source);
  config.views[0].transform.scale = 9999;
  config.views[0].autoDetection.reason = 'Pretend detected face';
  assert.deepEqual(validateFocusConfig(config, layout, source), []);
  const restored = canonicalFocusConfig(config, layout, source);
  assert.notEqual(restored.views[0].transform.scale, 9999); assert.equal(restored.views[0].autoDetection.detectedSubjects.length, 0); assert.match(restored.views[0].autoDetection.reason, /No local/);
});
test('Pixel-centre sampler uses one affine scale, exact identity and padding', () => {
  const t = defaultFocusConfig(layout, source).views[0].transform;
  const transform = { ...t, sourceWidth: 2, sourceHeight: 2, viewport: { width: 2, height: 2 }, scale: 1, translation: { x: 0, y: 0 }, paddingColor: '#123456' };
  const pixels = new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
  assert.deepEqual(renderFocusPixels(pixels, transform), pixels);
  const shifted = renderFocusPixels(pixels, { ...transform, translation: { x: 1, y: 0 } });
  assert.deepEqual([...shifted.subarray(0, 4)], [18,52,86,255]); assert.deepEqual([...shifted.subarray(4, 8)], [255,0,0,255]);
});
