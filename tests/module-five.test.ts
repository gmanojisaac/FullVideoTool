import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnimationDiagnostics } from '../server/animation-checks.js';
import { defaultAnimationSettings, frameCount, smoothstep, validateAnimationSettings } from '../shared/animation.js';
import { detectVideoTools } from '../server/video-tools.js';

test('Module 5 acceptance checks', async t => {
  const report = await runAnimationDiagnostics();
  for (const r of report.results) await t.test(r.name, () => { console.log(`${r.status} — ${r.name}: ${r.detail}`); assert.equal(r.status, 'PASS', r.detail); });
});
test('Timing validation, defaults, inclusive minimum and deterministic rounding', () => {
  const s = defaultAnimationSettings(); assert.deepEqual(validateAnimationSettings(s), []);
  assert.equal(frameCount(s.global.zoomIn), 36); assert.equal(frameCount(s.global.zoomOut), 30);
  assert.equal(s.initialGridHold, 1.5); assert.equal(s.finalGridHold, 2); assert.equal(s.global.focusedHold, 1);
  assert.equal(smoothstep(0), 0); assert.equal(smoothstep(1), 1); assert.equal(smoothstep(0.5), 0.5);
  s.global.zoomIn = 1 / 30; assert(validateAnimationSettings(s).length); s.global.zoomIn = 2 / 30; assert.deepEqual(validateAnimationSettings(s), []);
  s.tiles[0].tileNumber = 2; assert(validateAnimationSettings(s).length);
});
test('Explicit missing video tools report actionable setup without fallback', async () => {
  const oldM = process.env.FFMPEG_PATH, oldP = process.env.FFPROBE_PATH;
  try { process.env.FFMPEG_PATH = 'missing-module-five-ffmpeg.exe'; process.env.FFPROBE_PATH = 'missing-module-five-ffprobe.exe'; const tools = await detectVideoTools(); assert.equal(tools.available, false); assert.equal(tools.ffmpeg, null); assert.match(tools.instructions, /FFMPEG_PATH/); }
  finally { if (oldM === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = oldM; if (oldP === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = oldP; }
});
