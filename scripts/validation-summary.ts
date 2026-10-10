import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson, readJson } from '../server/storage.js';
import type { LessonRenderManifest } from '../shared/assembly.js';

const results: { name: string; expected: string; actual: unknown; status: 'PASS' | 'FAIL' | 'SKIPPED'; evidence: string }[] = [];
async function readLog(filename: string) {
  const bytes = await readFile(filename);
  // Windows PowerShell redirection writes UTF-16LE; direct Node logs use UTF-8.
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}
const media = await readJson<{ passed: number; total: number; failed: number; skipped: number }>('previews/module-ten-report.json');
results.push({ name: 'Module 10 acceptance', expected: '25 executed checks pass', actual: media, status: media.total === 25 && media.passed === 25 && media.failed === 0 && media.skipped === 0 ? 'PASS' : 'FAIL', evidence: 'previews/module-ten-report.json' });
for (const [name, filename, count] of [['Earlier available service regressions', 'module-ten-regressions.log', 154], ['ZIP/timing/startup/recovery/storage units', 'module-ten-unit-tests.log', 11]] as const) {
  const log = await readLog(path.join('previews', filename));
  const actual = { tests: Number(log.match(/# tests (\d+)/)?.[1]), passed: Number(log.match(/# pass (\d+)/)?.[1]), failed: Number(log.match(/# fail (\d+)/)?.[1]), skipped: Number(log.match(/# skipped (\d+)/)?.[1]) };
  results.push({ name, expected: `${count} executed tests pass; zero failures/skips`, actual, status: actual.tests === count && actual.passed === count && actual.failed === 0 && actual.skipped === 0 ? 'PASS' : 'FAIL', evidence: 'previews/' + filename });
}
function browserCounts(log: string) {
  return { passed: Number(log.match(/(?:^|\n)\s*(\d+) passed\b/)?.[1] || 0), failed: Number(log.match(/(?:^|\n)\s*(\d+) failed\b/)?.[1] || 0) };
}
const assemblyBrowser = browserCounts(await readLog('previews/module-ten-assembly-browser-tests.log'));
results.push({ name: 'Assembly and startup browser', expected: '5 browser tests pass', actual: assemblyBrowser, status: assemblyBrowser.passed === 5 && assemblyBrowser.failed === 0 ? 'PASS' : 'FAIL', evidence: 'previews/module-ten-assembly-browser-tests.log' });
const earlierLog = await readLog('previews/module-ten-earlier-browser-tests.log');
const earlierBrowser = browserCounts(earlierLog), correctedBrowser = browserCounts(await readLog('previews/module-ten-frame-cancel-browser-test.log'));
const recovered = earlierBrowser.passed === 32 && earlierBrowser.failed === 1 && correctedBrowser.passed === 1 && correctedBrowser.failed === 0 && /1 failed\s+tests\\browser\\frames\.spec\.ts:\d+:\d+.*Cancel verification/.test(earlierLog);
results.push({ name: 'Earlier browser regressions and corrected cancellation check', expected: 'All 33 distinct browser checks pass across the suite and targeted rerun', actual: { initial: earlierBrowser, correctedCancellation: correctedBrowser, recovered, uniquePassingChecks: recovered ? 33 : earlierBrowser.passed }, status: recovered ? 'PASS' : 'FAIL', evidence: 'previews/module-ten-earlier-browser-tests.log; previews/module-ten-frame-cancel-browser-test.log' });
const build = await readLog('previews/module-ten-build.log');
results.push({ name: 'Production build', expected: 'TypeScript and Vite complete', actual: build.includes('built in'), status: build.includes('built in') ? 'PASS' : 'FAIL', evidence: 'previews/module-ten-build.log' });
const manifest = await readJson<LessonRenderManifest>('previews/module-ten-sample-manifest.json');
for (const format of ['mobile', 'desktop'] as const) {
  const output = manifest.outputs.find(o => o.format === format);
  results.push({ name: `Supplied comic ${format} demo`, expected: `${format === 'mobile' ? '1080×1920' : '1920×1080'} / 30 fps H.264 yuv420p / 48 kHz stereo AAC; decoded validation PASS`, actual: output, status: output?.validation === 'PASS' && output.width === (format === 'mobile' ? 1080 : 1920) && output.height === (format === 'mobile' ? 1920 : 1080) ? 'PASS' : 'FAIL', evidence: manifest.validationUrl });
}
results.push({ name: 'Module 8 / complete Module 9 acceptance', expected: 'Twelve editable motion prompts and complete integrated prompt workflow', actual: 'Remaining Module 8 specification pending; not implemented or counted as passing', status: 'SKIPPED', evidence: 'User clarification; TEST_REPORT.md' });
const report = { version: 1, application: 'Six-Tile Lesson Video Builder', timestamp: new Date().toISOString(), module10Status: results.some(r => r.status === 'FAIL') ? 'FAIL' : 'PASS', applicationCoverage: 'PARTIAL: Module 8 and complete Module 9 acceptance pending', browserChecks: assemblyBrowser.passed + (recovered ? 33 : earlierBrowser.passed), results, sampleProvenance: 'User supplied comic; twelve explicitly selected verified-still fallbacks and six labeled synthetic sine test tones. No actual Gemini motion or spoken narration supplied.' };
await atomicJson('previews/application-validation.json', report);
console.log(JSON.stringify(report, null, 2));
if (report.module10Status === 'FAIL') process.exitCode = 1;
