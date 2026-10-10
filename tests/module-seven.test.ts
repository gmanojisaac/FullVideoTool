import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportDiagnostics } from '../server/export-checks.js';
test('Module 7 acceptance checks', async t => { const report = await runExportDiagnostics(); for (const r of report.results) await t.test(r.name, () => { console.log(`${r.status} — ${r.name}: ${r.detail}`); assert.equal(r.status, 'PASS', r.detail); }); });
