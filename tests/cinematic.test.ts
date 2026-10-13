import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicFov, cinematicPose, distanceForScale, smootherstep, type CinematicTarget } from '../shared/cinematic.js';
import { defaultAssemblyConfig, validateAssemblyConfig } from '../shared/assembly.js';

const target: CinematicTarget = { gridWidth: 1080, gridHeight: 1920, viewportWidth: 1080, viewportHeight: 1920, endScale: 2.0225, endFocal: { x: 267, y: 474.7 }, lateralSign: -1 };
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !≈ ${b}`);

test('both ends are exactly straight-on with no arc, matching the saved camera', () => {
  const start = cinematicPose(target, 0), end = cinematicPose(target, 1);
  near(start.scale, 1); near(start.centerX, 540); near(start.centerY, 960);
  near(end.scale, target.endScale); near(end.centerX, 267); near(end.centerY, 474.7);
  for (const p of [start, end]) { assert.equal(p.offsetX, 0); assert.equal(p.offsetY, 0); assert.equal(p.lift, 0); assert.equal(p.shadow, 0); near(p.liftScale, 1); }
});
test('camera distance gives exactly the viewport height at scale 1', () => {
  near(2 * distanceForScale(1920, 1) * Math.tan(cinematicFov * Math.PI / 360), 1920, 1e-6);
  near(distanceForScale(1920, 2) * 2, distanceForScale(1920, 1), 1e-9);
});
test('scale rises monotonically and the arc (relative to distance) peaks mid-move', () => {
  let last = 0, peak = 0, peakAt = 0;
  for (let i = 0; i <= 36; i++) { const p = cinematicPose(target, i / 36); assert.ok(p.scale >= last - 1e-12); last = p.scale; const relative = p.lift / p.distance; if (relative > peak) { peak = relative; peakAt = i; } assert.ok(p.liftScale <= 1 && p.liftScale > 0.8); }
  assert.ok(peakAt >= 15 && peakAt <= 21, `relative arc peak at frame ${peakAt}`);
});
test('easing is smooth at both ends and parallax is lateral only', () => {
  near(smootherstep(0), 0); near(smootherstep(1), 1); assert.ok(smootherstep(0.02) < 0.001);
  const mid = cinematicPose(target, 0.5); assert.ok(mid.offsetX < 0 && mid.offsetY > 0);
  assert.ok(cinematicPose({ ...target, lateralSign: 1 }, 0.5).offsetX > 0);
});
test('assembly config validates the camera engine choice', () => {
  const c = defaultAssemblyConfig('11111111-1111-4111-8111-111111111111');
  assert.deepEqual(validateAssemblyConfig(c), []);
  assert.deepEqual(validateAssemblyConfig({ ...c, cameraEngine: 'three' }), []);
  assert.ok(validateAssemblyConfig({ ...c, cameraEngine: 'webgpu' as never }).length);
});
