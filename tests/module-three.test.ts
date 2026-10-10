import test from 'node:test';
import assert from 'node:assert/strict';
import { runLayoutDiagnostics } from '../server/layout-checks.js';
import { defaultGridSettings, outputFormats, resolveGeometry, validateGridSettings } from '../shared/layout.js';
import { validatePanels } from '../shared/project.js';

test('Module 3 acceptance checks', async t => {
  const report = await runLayoutDiagnostics();
  for (const result of report.results) await t.test(result.name, () => {
    console.log(`${result.status} — ${result.name}: ${result.detail}`);
    assert.equal(result.status, 'PASS', result.detail);
  });
});
test('Closest valid gutter for all supported margin/gutter combinations', () => {
  for (const format of outputFormats) for (let margin = 0; margin <= 200; margin++) for (let requested = 0; requested <= 120; requested++) {
    const settings = defaultGridSettings()[format]; settings.outerMargin = margin; settings.internalGutter = requested;
    const g = resolveGeometry(format, settings);
    assert.deepEqual(validatePanels(g.panels, g.width, g.height), []);
    assert.equal(g.width - g.panels[5].x - g.cellWidth, margin);
    assert.equal(g.height - g.panels[5].y - g.cellHeight, margin);
    assert(Math.abs(g.internalGutter - requested) <= 4);
    for (let candidate = Math.max(0, requested - 6); candidate <= requested + 6; candidate++) {
      const valid = (g.width - 2 * margin - (g.columns - 1) * candidate) % g.columns === 0 && (g.height - 2 * margin - (g.rows - 1) * candidate) % g.rows === 0;
      if (valid) assert(Math.abs(candidate - requested) >= Math.abs(g.internalGutter - requested));
    }
  }
});
test('Zero-gutter native cell sizes and default applied gutter', () => {
  for (const format of outputFormats) {
    const settings = defaultGridSettings()[format];
    assert.equal(resolveGeometry(format, settings).internalGutter, 12);
    settings.internalGutter = 0;
    const g = resolveGeometry(format, settings);
    assert.equal(g.cellWidth, format === 'mobile' ? 540 : 640); assert.equal(g.cellHeight, format === 'mobile' ? 640 : 540);
  }
});
test('Reject invalid settings and linked format disagreement', () => {
  assert.deepEqual(validateGridSettings(defaultGridSettings()), []);
  for (const mutation of [(s: ReturnType<typeof defaultGridSettings>) => { s.mobile.outerMargin = -1; }, (s: ReturnType<typeof defaultGridSettings>) => { s.mobile.internalGutter = 1.5; }, (s: ReturnType<typeof defaultGridSettings>) => { s.desktop.paddingColor = 'red'; }, (s: ReturnType<typeof defaultGridSettings>) => { s.mobile.positions[0].x = NaN; }, (s: ReturnType<typeof defaultGridSettings>) => { s.mobile.mode = 'FILL'; }]) {
    const s = defaultGridSettings(); mutation(s); assert(validateGridSettings(s).length > 0);
  }
});
