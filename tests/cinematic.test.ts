import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicEasings, cinematicFov, cinematicPose, cinematicPresetNames, cinematicPresets, cinematicRanges, defaultCinematicSettings, distanceForScale, ease, shutterProgress, validateCinematicSettings, type CinematicSettings, type CinematicTarget } from '../shared/cinematic.js';
import { defaultAssemblyConfig, validateAssemblyConfig } from '../shared/assembly.js';

const target: CinematicTarget = { gridWidth: 1080, gridHeight: 1920, viewportWidth: 1080, viewportHeight: 1920, endScale: 2.0225, endFocal: { x: 267, y: 474.7 }, lateralSign: -1 };
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !≈ ${b}`);
const all = cinematicPresetNames.map(n => [n, cinematicPresets[n].settings] as const);

test('every preset is valid and ends exactly straight-on with every effect at zero', () => {
  for (const [name, s] of all) {
    assert.deepEqual(validateCinematicSettings(s), [], name);
    const start = cinematicPose(target, s, 0), end = cinematicPose(target, s, 1);
    near(start.scale, 1); near(start.centerX, 540); near(start.centerY, 960);
    near(end.scale, target.endScale); near(end.centerX, 267); near(end.centerY, 474.7);
    for (const p of [start, end]) {
      for (const k of ['offsetX', 'offsetY', 'roll', 'lift', 'shadow', 'blurOpacity', 'vignette', 'warmth', 'contrast', 'sweepStrength'] as const) assert.equal(p[k], 0, `${name} ${k}`);
      near(p.liftScale, 1); near(p.offsetZ, p.distance);
    }
  }
});
test('camera distance gives exactly the viewport height at scale 1', () => {
  near(2 * distanceForScale(1920, 1) * Math.tan(cinematicFov * Math.PI / 360), 1920, 1e-6);
  near(distanceForScale(1920, 2) * 2, distanceForScale(1920, 1), 1e-9);
});
test('camera keeps its distance when it orbits, and the move is continuous', () => {
  for (const [name, s] of all) {
    let lastX = 0, lastY = 0; const travel = Math.hypot(target.endFocal.x - target.gridWidth / 2, target.endFocal.y - target.gridHeight / 2);
    for (let i = 0; i <= 36; i++) {
      const p = cinematicPose(target, s, i / 36);
      near(Math.hypot(p.offsetX, p.offsetY, p.offsetZ), p.distance, 1e-6);
      if (i) assert.ok(Math.hypot(p.centerX - lastX, p.centerY - lastY) < travel * .3, `${name} jump at ${i}`); // a whip may cover up to 30% of the travel in one frame
      lastX = p.centerX; lastY = p.centerY;
    }
  }
});
test('easings run 0→1 and are monotonic', () => {
  for (const e of cinematicEasings) { let last = -1; near(ease(e, 0), 0); near(ease(e, 1), 1); for (let i = 0; i <= 50; i++) { const v = ease(e, i / 50); assert.ok(v >= last - 1e-12, `${e} at ${i}`); last = v; } }
});
test('orbit side follows the tile, and overshoot passes the target before settling', () => {
  const s: CinematicSettings = { ...cinematicPresets['cinematic-orbit'].settings };
  assert.ok(cinematicPose(target, s, .5).offsetX < 0);
  assert.ok(cinematicPose({ ...target, lateralSign: 1 }, s, .5).offsetX > 0);
  const o: CinematicSettings = { ...defaultCinematicSettings(), preset: 'custom', overshoot: .1 };
  const peak = Math.max(...Array.from({ length: 37 }, (_, i) => cinematicPose(target, o, i / 36).scale));
  assert.ok(peak > target.endScale, 'overshoot should exceed the final scale');
  assert.ok(Math.max(...Array.from({ length: 37 }, (_, i) => cinematicPose(target, defaultCinematicSettings(), i / 36).scale)) <= target.endScale + 1e-9);
});
test('motion blur samples straddle the frame and clamp at the ends', () => {
  assert.deepEqual(shutterProgress(.5, .03, 0), [.5]);
  const s = shutterProgress(.5, .03, 1, 5); assert.equal(s.length, 5); near(s[2], .5); assert.ok(s[0] < .5 && s[4] > .5);
  assert.ok(shutterProgress(0, .03, 1).every(v => v >= 0)); assert.ok(shutterProgress(1, .03, 1).every(v => v <= 1));
});
test('settings validation rejects out-of-range values; presets cover the documented ranges', () => {
  assert.ok(validateCinematicSettings({ ...defaultCinematicSettings(), orbitDegrees: 90 }).length);
  assert.ok(validateCinematicSettings({ ...defaultCinematicSettings(), easing: 'bounce' as never }).length);
  assert.ok(validateCinematicSettings({ ...defaultCinematicSettings(), preset: 'custom', depthBlur: 10 }).length === 0);
  for (const [, s] of all) for (const [k, r] of Object.entries(cinematicRanges)) { const v = s[k as keyof CinematicSettings] as number; assert.ok(v >= r.min && v <= r.max, k); }
});
test('assembly config accepts and validates cinematic settings', () => {
  const c = defaultAssemblyConfig('11111111-1111-4111-8111-111111111111');
  assert.deepEqual(validateAssemblyConfig(c), []);
  assert.deepEqual(validateAssemblyConfig({ ...c, cameraEngine: 'three', cinematic: cinematicPresets['dutch-whip'].settings }), []);
  assert.ok(validateAssemblyConfig({ ...c, cameraEngine: 'webgpu' as never }).length);
  assert.ok(validateAssemblyConfig({ ...c, cinematic: { ...defaultCinematicSettings(), depthBlur: 99 } }).length);
});

test('landing slides to the tile centre at constant scale while the grid fades out', async () => {
  const { cinematicLandingPose, adaptiveSamples } = await import('../shared/cinematic.js');
  const s = cinematicPresets['cinematic-orbit'].settings, centre = { x: 1604, y: 267 }, t = { ...target, endFocal: { x: 1445.33, y: 267 } };
  const start = cinematicLandingPose(t, s, 0, centre), mid = cinematicLandingPose(t, s, .5, centre), end = cinematicLandingPose(t, s, 1, centre);
  near(start.centerX, 1445.33); near(end.centerX, 1604); near(end.centerY, 267);
  for (const p of [start, mid, end]) { near(p.scale, t.endScale); assert.equal(p.lift, 0); assert.equal(p.offsetX, 0); assert.equal(p.vignette, 0); }
  assert.equal(start.groundFade, 0); assert.ok(mid.groundFade > 0 && mid.groundFade < 1); near(end.groundFade, 1);
  assert.ok(start.centerX < mid.centerX && mid.centerX < end.centerX);
  assert.equal(cinematicPose(t, s, .5).groundFade, 0);
  // motion-blur sample count grows with speed, never exceeds the cap, and is 1 with the shutter closed
  const a = cinematicPose(target, cinematicPresets['dutch-whip'].settings, .4), b = cinematicPose(target, cinematicPresets['dutch-whip'].settings, .45);
  assert.equal(adaptiveSamples(a, b, 0), 1);
  const fast = adaptiveSamples(a, b, .9), slow = adaptiveSamples(cinematicPose(target, s, .01), cinematicPose(target, s, .02), .5);
  assert.ok(fast >= slow && fast <= 24 && slow >= 2, `fast ${fast} slow ${slow}`);
});
test('landingFor only applies to consistent detail framings', async () => {
  const { landingFor } = await import('../server/cinematic-render.js');
  const tf = (o: Record<string, unknown>) => ({ selectedTileRectangle: { id: 3, x: 1288, y: 0, width: 632, height: 534 }, viewport: { width: 1920, height: 1080 }, sourceWidth: 632, sourceHeight: 534, scale: 2.0224719, ...o }) as never;
  const view = (cameraMode: string, detail: Record<string, unknown> = {}) => ({ cameraMode, nativeTransform: tf({ sourceWidth: 1920, sourceHeight: 1080 }), detailTransform: tf(detail) });
  assert.deepEqual(landingFor(view('detail'), 9), { frames: 9, tileCentre: { x: 1604, y: 267 } });
  assert.equal(landingFor(view('native'), 9), undefined);
  assert.equal(landingFor(view('detail', { scale: 3 }), 9), undefined);
  assert.equal(landingFor(view('detail'), 1), undefined);
});
