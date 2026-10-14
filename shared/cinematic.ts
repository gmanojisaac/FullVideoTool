// Cinematic camera for the optional Three.js engine. Pure maths, shared by the browser scene, the server and the tests.
// World units are grid pixels, origin at the grid centre, +x right, +y up. The camera always looks at a point on the
// grid plane (z = 0). At progress 0 and 1 every effect is exactly zero and the view is straight-on, so the first and
// last frames coincide with the classic (pixel-exact) renderer's frames at the same transform.

export const cinematicFov = 30; // vertical degrees
export const cinematicVersion = 'three-camera-v2';
export const cinematicEasings = ['smootherstep', 'cubic', 'expo', 'outCubic', 'linear'] as const;
export type CinematicEasing = typeof cinematicEasings[number];
export const cinematicPresetNames = ['classic-arc', 'gentle-drift', 'documentary', 'cinematic-orbit', 'dramatic-crane', 'dutch-whip', 'dreamy-glow'] as const;
export type CinematicPresetName = typeof cinematicPresetNames[number];

export interface CinematicSettings {
  version: 1; preset: CinematicPresetName | 'custom';
  easing: CinematicEasing;
  /** 1 = pan and zoom together; above 1 the camera centres on the tile before the zoom completes. */
  panLead: number;
  /** Fraction of extra zoom passed near the end before settling back (0 = none). */
  overshoot: number;
  /** Camera orbit around the tile at the middle of the move, degrees. */
  orbitDegrees: number;
  /** Camera rises (pitches) at the middle of the move, degrees. */
  craneDegrees: number;
  /** Dutch roll at the middle of the move, degrees. */
  rollDegrees: number;
  /** Floating tile height as a fraction of camera distance, and its shadow strength. */
  lift: number; shadow: number;
  /** Background blur in grid pixels (depth-of-field look) and shutter angle as a fraction of a frame (motion blur). */
  depthBlur: number; motionBlur: number;
  vignette: number; warmth: number; contrast: number; lightSweep: number;
  /** Shapes the envelope that drives all effects; 1 = sine, below 1 holds the effects longer. */
  arcShape: number;
}
export type CinematicNumericKey = Exclude<{ [K in keyof CinematicSettings]: CinematicSettings[K] extends number ? K : never }[keyof CinematicSettings], 'version'>;
export const cinematicRanges: Record<CinematicNumericKey, { min: number; max: number; step: number; label: string }> = {
  panLead: { min: 1, max: 1.6, step: .05, label: 'Pan lead' },
  overshoot: { min: 0, max: .12, step: .01, label: 'Settle overshoot' },
  orbitDegrees: { min: 0, max: 30, step: 1, label: 'Orbit (°)' },
  craneDegrees: { min: 0, max: 20, step: 1, label: 'Crane / tilt (°)' },
  rollDegrees: { min: 0, max: 8, step: .5, label: 'Dutch roll (°)' },
  lift: { min: 0, max: .3, step: .01, label: 'Tile lift' },
  shadow: { min: 0, max: .8, step: .05, label: 'Shadow' },
  depthBlur: { min: 0, max: 24, step: 1, label: 'Background blur (px)' },
  motionBlur: { min: 0, max: 1, step: .05, label: 'Motion blur' },
  vignette: { min: 0, max: .7, step: .05, label: 'Vignette' },
  warmth: { min: 0, max: .4, step: .02, label: 'Warmth' },
  contrast: { min: 0, max: .3, step: .02, label: 'Contrast' },
  lightSweep: { min: 0, max: 1, step: .05, label: 'Light sweep' },
  arcShape: { min: .5, max: 2, step: .1, label: 'Effect envelope' },
};
const base: Omit<CinematicSettings, 'preset'> = { version: 1, easing: 'smootherstep', panLead: 1.15, overshoot: 0, orbitDegrees: 5, craneDegrees: 2, rollDegrees: 0, lift: .16, shadow: .42, depthBlur: 0, motionBlur: 0, vignette: 0, warmth: 0, contrast: 0, lightSweep: 0, arcShape: 1 };
export const cinematicPresets: Record<CinematicPresetName, { label: string; description: string; settings: CinematicSettings }> = {
  'classic-arc': { label: 'Classic arc', description: 'The first Three.js move: small tilt, floating tile, no post effects.', settings: { ...base, preset: 'classic-arc' } },
  'gentle-drift': { label: 'Gentle drift', description: 'Very soft tilt and a light motion blur. Safe for faces and calm lessons.', settings: { ...base, preset: 'gentle-drift', orbitDegrees: 3, craneDegrees: 1, lift: .08, shadow: .3, motionBlur: .3, vignette: .15 } },
  documentary: { label: 'Documentary', description: 'Almost flat push-in with a quiet vignette and a touch of motion blur; no floating tile.', settings: { ...base, preset: 'documentary', easing: 'cubic', orbitDegrees: 2, craneDegrees: 0, lift: 0, shadow: 0, motionBlur: .2, vignette: .1 } },
  'cinematic-orbit': { label: 'Cinematic orbit', description: 'Wider orbit with depth-of-field, motion blur, warm grade and a light sweep across the tile.', settings: { ...base, preset: 'cinematic-orbit', easing: 'cubic', orbitDegrees: 14, craneDegrees: 5, rollDegrees: 1.5, lift: .2, shadow: .5, depthBlur: 8, motionBlur: .5, vignette: .35, warmth: .12, contrast: .1, lightSweep: .5, overshoot: .03 } },
  'dramatic-crane': { label: 'Dramatic crane', description: 'Camera rises over the grid as it pushes in; strong vignette and contrast.', settings: { ...base, preset: 'dramatic-crane', easing: 'expo', orbitDegrees: 6, craneDegrees: 14, lift: .24, shadow: .55, depthBlur: 12, motionBlur: .6, vignette: .45, warmth: .08, contrast: .15 } },
  'dutch-whip': { label: 'Dutch whip', description: 'Fast expo ease with dutch roll and heavy motion blur. Energetic; use sparingly.', settings: { ...base, preset: 'dutch-whip', easing: 'expo', panLead: 1.4, overshoot: .06, orbitDegrees: 10, craneDegrees: 3, rollDegrees: 5, lift: .12, depthBlur: 4, motionBlur: .9, vignette: .3 } },
  'dreamy-glow': { label: 'Dreamy glow', description: 'Strong background blur, warm grade and a slow light sweep for reflective moments.', settings: { ...base, preset: 'dreamy-glow', orbitDegrees: 8, craneDegrees: 3, lift: .14, shadow: .35, depthBlur: 16, motionBlur: .4, vignette: .4, warmth: .25, contrast: .06, lightSweep: .8, arcShape: .8 } },
};
export const defaultCinematicSettings = (): CinematicSettings => ({ ...cinematicPresets['classic-arc'].settings });
export function validateCinematicSettings(s: unknown): string[] {
  const v = s as CinematicSettings;
  if (!v || typeof v !== 'object' || v.version !== 1 || (v.preset !== 'custom' && !(cinematicPresetNames as readonly string[]).includes(v.preset)) || !(cinematicEasings as readonly string[]).includes(v.easing)) return ['Choose a supported cinematic preset and easing.'];
  for (const [key, r] of Object.entries(cinematicRanges)) { const n = v[key as CinematicNumericKey]; if (typeof n !== 'number' || !Number.isFinite(n) || n < r.min - 1e-9 || n > r.max + 1e-9) return [`${r.label} must be between ${r.min} and ${r.max}.`]; }
  return [];
}

export interface CinematicTarget { gridWidth: number; gridHeight: number; viewportWidth: number; viewportHeight: number; endScale: number; endFocal: { x: number; y: number }; lateralSign: -1 | 1 }
export interface CinematicPose {
  centerX: number; centerY: number; scale: number;
  /** Straight-line distance from the look-at point; also the reference for lift. */
  distance: number;
  /** Camera position relative to the look-at point, world units. */
  offsetX: number; offsetY: number; offsetZ: number;
  /** Radians. */
  roll: number;
  lift: number; liftScale: number; shadow: number;
  /** Post and look parameters, already scaled by the envelope so they are zero at both ends. */
  /** 0–1 opacity of a padding-colour plane hiding the grid (used only while landing on the detail framing). */
  groundFade: number;
  blur: number; blurOpacity: number; vignette: number; warmth: number; contrast: number; sweepPosition: number; sweepStrength: number;
}
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smootherstep = (t: number) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export function ease(kind: CinematicEasing, t: number) {
  const x = clamp01(t);
  switch (kind) {
    case 'linear': return x;
    case 'cubic': return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'outCubic': return 1 - Math.pow(1 - x, 3);
    case 'expo': return x === 0 ? 0 : x === 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
    default: return smootherstep(x);
  }
}
export const distanceForScale = (viewportHeight: number, scale: number) => viewportHeight / (2 * scale * Math.tan(cinematicFov * Math.PI / 360));
const rad = (d: number) => d * Math.PI / 180;

/** progress: 0 = full grid, 1 = native tile view. Callers reverse it for zoom-out. */
export function cinematicPose(target: CinematicTarget, s: CinematicSettings, progress: number): CinematicPose {
  const p = clamp01(progress), exact = p <= 0 || p >= 1;
  const eased = ease(s.easing, p), c1 = 17.0158 * s.overshoot; // back-out curve: about 10% past the target at 0.1
  const scaleEase = exact || s.overshoot <= 0 ? eased : 1 + (c1 + 1) * Math.pow(eased - 1, 3) + c1 * Math.pow(eased - 1, 2);
  const panEase = ease(s.easing, p * s.panLead);
  const scale = Math.exp(Math.log(target.endScale) * scaleEase);
  const centerX = target.gridWidth / 2 + (target.endFocal.x - target.gridWidth / 2) * panEase, centerY = target.gridHeight / 2 + (target.endFocal.y - target.gridHeight / 2) * panEase;
  const distance = distanceForScale(target.viewportHeight, scale), z = (n: number) => n === 0 ? 0 : n; // never emit -0
  const envelope = exact ? 0 : Math.pow(Math.sin(Math.PI * p), s.arcShape), fx = exact ? 0 : Math.pow(Math.sin(Math.PI * p), .7);
  const yaw = target.lateralSign * rad(s.orbitDegrees) * envelope, pitch = rad(s.craneDegrees) * envelope, lift = s.lift * distance * envelope;
  return {
    centerX, centerY, scale, distance,
    offsetX: z(distance * Math.sin(yaw) * Math.cos(pitch)), offsetY: z(distance * Math.sin(pitch)), offsetZ: distance * Math.cos(yaw) * Math.cos(pitch),
    roll: z(rad(s.rollDegrees) * envelope * target.lateralSign),
    lift, liftScale: (distance - lift) / distance, shadow: s.shadow * envelope,
    groundFade: 0, blur: s.depthBlur, blurOpacity: s.depthBlur > 0 ? envelope : 0,
    vignette: s.vignette * fx, warmth: s.warmth * fx, contrast: s.contrast * fx,
    sweepPosition: p, sweepStrength: exact ? 0 : s.lightSweep * Math.sin(Math.PI * p) ** 2,
  };
}
/** Sub-frame progress values across the shutter for motion blur. One value (no blur) when the shutter is closed. */
export function shutterProgress(progress: number, progressPerFrame: number, motionBlur: number, samples = 5): number[] {
  if (motionBlur <= 0 || samples < 2) return [progress];
  return Array.from({ length: samples }, (_, k) => clamp01(progress + (k / (samples - 1) - .5) * motionBlur * progressPerFrame));
}

/**
 * Landing on the detail framing. Detail mode shows the tile alone, centred, on padding colour, whereas the native
 * view can be clamped against the grid edge with neighbours visible. q: 0 = native end pose, 1 = detail pose.
 * The scale is unchanged; the camera slides to the tile centre and the neighbouring grid fades to the padding colour.
 */
export function cinematicLandingPose(target: CinematicTarget, s: CinematicSettings, q: number, tileCentre: { x: number; y: number }): CinematicPose {
  const end = cinematicPose(target, s, 1), e = ease('smootherstep', q);
  return { ...end, centerX: end.centerX + (tileCentre.x - end.centerX) * e, centerY: end.centerY + (tileCentre.y - end.centerY) * e, groundFade: e };
}
/** Number of motion-blur samples so neighbouring samples are about 4 screen pixels apart (2–24). */
export function adaptiveSamples(a: CinematicPose, b: CinematicPose, motionBlur: number): number {
  if (motionBlur <= 0) return 1;
  const travel = Math.hypot(b.centerX - a.centerX, b.centerY - a.centerY) * Math.max(a.scale, b.scale) + Math.abs(Math.log(b.scale / a.scale)) * 600 + Math.hypot(b.offsetX - a.offsetX, b.offsetY - a.offsetY) * Math.max(a.scale, b.scale);
  return Math.max(2, Math.min(24, Math.ceil(travel * motionBlur / 4)));
}
