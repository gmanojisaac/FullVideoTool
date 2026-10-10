import test from 'node:test';
import assert from 'node:assert/strict';
import { runAssemblyDiagnostics } from '../server/assembly-checks.js';
test('Module 10 actual assembly acceptance checks',async t=>{const report=await runAssemblyDiagnostics();for(const r of report.results)await t.test(r.name,child=>{console.log(`${r.status} — ${r.name}: ${r.detail}`);if(r.status==='SKIPPED'){child.skip(r.detail);return;}assert.equal(r.status,'PASS',r.detail);});});
