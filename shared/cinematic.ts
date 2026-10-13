// Cinematic camera path for the optional Three.js engine. Pure maths, shared by the browser scene and the tests.
// World units are grid pixels, origin at the grid centre, +x right, +y up. The camera always looks at a point on
// the grid plane (z = 0). At progress 0 and 1 the view is exactly straight-on with no arc, so the first and last
// frames coincide with the classic (pixel-exact) renderer's frames at the same transform.

export const cinematicFov = 30; // vertical degrees
export const cinematicVersion = 'three-camera-v1';
export interface CinematicTarget { gridWidth: number; gridHeight: number; viewportWidth: number; viewportHeight: number; endScale: number; endFocal: { x: number; y: number }; lateralSign: -1 | 1 }
export interface CinematicPose {
  /** Look-at point on the grid plane, in grid pixels from the top-left. */
  centerX: number; centerY: number;
  scale: number; distance: number;
  /** Camera offset from the look-at axis, in world units (+x right, +y up). Zero at both ends. */
  offsetX: number; offsetY: number;
  /** Height of the floating tile layer above the grid, and the factor it is scaled by about the view axis. */
  lift: number; liftScale: number;
  /** 0–1 strength of the soft shadow under the floating tile. */
  shadow: number;
}
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smootherstep = (t: number) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };
export const distanceForScale = (viewportHeight: number, scale: number) => viewportHeight / (2 * scale * Math.tan(cinematicFov * Math.PI / 360));

/** progress: 0 = full grid, 1 = native tile view. Callers reverse it for zoom-out. */
export function cinematicPose(target: CinematicTarget, progress: number): CinematicPose {
  const p = clamp01(progress), scaleEase = smootherstep(p), panEase = smootherstep(p * 1.15), arc = Math.sin(Math.PI * p);
  const scale = Math.exp(Math.log(target.endScale) * scaleEase);
  const centerX = target.gridWidth / 2 + (target.endFocal.x - target.gridWidth / 2) * panEase, centerY = target.gridHeight / 2 + (target.endFocal.y - target.gridHeight / 2) * panEase;
  const distance = distanceForScale(target.viewportHeight, scale);
  const exact = p <= 0 || p >= 1, lift = exact ? 0 : 0.16 * distance * arc;
  return {
    centerX, centerY, scale, distance,
    offsetX: exact ? 0 : target.lateralSign * 0.09 * distance * arc, offsetY: exact ? 0 : 0.035 * distance * arc,
    lift, liftScale: (distance - lift) / distance, shadow: exact ? 0 : 0.42 * arc,
  };
}
