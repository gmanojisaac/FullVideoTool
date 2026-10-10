import test from 'node:test';
import assert from 'node:assert/strict';
import { runFrameDiagnostics } from '../server/frame-checks.js';
import { pixelDifference } from '../server/frame-decode.js';
test('Module 6 acceptance checks', async t => { const report = await runFrameDiagnostics(); for (const r of report.results) await t.test(r.name, () => { console.log(`${r.status} — ${r.name}: ${r.detail}`); assert.equal(r.status, 'PASS', r.detail); }); });
test('RGB difference statistics distinguish pixels from channels', () => { const a = new Uint8Array([1,2,3,4,5,6]), b = new Uint8Array([2,3,3,4,5,6]); const d = pixelDifference(a, b); assert.equal(d.differingPixels, 1); assert.equal(d.differingChannels, 2); assert.equal(d.maxAbsoluteDifference, 1); assert.equal(d.meanAbsoluteDifference, 2 / 6); assert.throws(() => pixelDifference(a, new Uint8Array(3))); });
