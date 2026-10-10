import type { CameraTransform, FocusConfig, FocusView } from './focus';
import type { OutputFormat } from './layout';

export const animationFps = 30;
export interface TileTiming { zoomIn: number; focusedHold: number; zoomOut: number; detailHandoff: number }
export interface AnimationSettings {
  version: 1; easing: 'smoothstep-log'; initialGridHold: number; intermediateGridHold: number; finalGridHold: number;
  timingMode: 'global' | 'individual'; global: TileTiming; tiles: (TileTiming & { tileNumber: number })[];
  crf: number; preset: 'fast' | 'veryfast';
}
export interface AnimationRequest { scope: 'all' | 'format' | 'selected' | 'preview'; format: OutputFormat; tileNumber: number }
export function defaultAnimationSettings(): AnimationSettings {
  const global = { zoomIn: 1.2, focusedHold: 1, zoomOut: 1, detailHandoff: 0.3 };
  return { version: 1, easing: 'smoothstep-log', initialGridHold: 1.5, intermediateGridHold: 0.5, finalGridHold: 2,
    timingMode: 'global', global, tiles: Array.from({ length: 6 }, (_, i) => ({ tileNumber: i + 1, ...global })), crf: 18, preset: 'fast' };
}
export function validateAnimationSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Animation settings are required.'];
  const s = value as AnimationSettings;
  if (s.version !== 1 || s.easing !== 'smoothstep-log' || !['global', 'individual'].includes(s.timingMode) || !['fast', 'veryfast'].includes(s.preset) || !Number.isInteger(s.crf) || s.crf < 17 || s.crf > 20) return ['Choose smoothstep easing, valid timing mode, encoder preset and CRF 17–20.'];
  if (![s.initialGridHold, s.intermediateGridHold, s.finalGridHold].every(n => Number.isFinite(n) && n >= 0 && n <= 15)) return ['Grid holds must be 0–15 seconds.'];
  if (!Array.isArray(s.tiles) || s.tiles.length !== 6 || new Set(s.tiles.map(t => t?.tileNumber)).size !== 6 || s.tiles.some(t => !t || !Number.isInteger(t.tileNumber) || t.tileNumber < 1 || t.tileNumber > 6)) return ['Define timings for exactly six tiles.'];
  for (const t of [s.global, ...s.tiles]) {
    if (!t || ![t.zoomIn, t.zoomOut].every(n => Number.isFinite(n) && n >= 2 / 30 && n <= 10) || !Number.isFinite(t.focusedHold) || t.focusedHold < 0 || t.focusedHold > 15 || !Number.isFinite(t.detailHandoff) || t.detailHandoff < 2 / 30 || t.detailHandoff > 2) return ['Zoom durations must be 0.067–10 seconds, focused hold 0–15, and detail dissolve 0.067–2.'];
  }
  return [];
}
export function canonicalAnimationSettings(s: AnimationSettings): AnimationSettings {
  const copy = (t: TileTiming) => ({ zoomIn: t.zoomIn, focusedHold: t.focusedHold, zoomOut: t.zoomOut, detailHandoff: t.detailHandoff });
  return { version: 1, easing: 'smoothstep-log', initialGridHold: s.initialGridHold, intermediateGridHold: s.intermediateGridHold, finalGridHold: s.finalGridHold,
    timingMode: s.timingMode, global: copy(s.global), tiles: [...s.tiles].sort((a, b) => a.tileNumber - b.tileNumber).map(t => ({ tileNumber: t.tileNumber, ...copy(t) })), crf: s.crf, preset: s.preset };
}
export function validAnimationRequest(r: AnimationRequest): boolean { return !!r && ['all', 'format', 'selected', 'preview'].includes(r.scope) && ['mobile', 'desktop'].includes(r.format) && Number.isInteger(r.tileNumber) && r.tileNumber >= 1 && r.tileNumber <= 6; }
export const frameCount = (seconds: number) => Math.round(seconds * animationFps);
export const smoothstep = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
export const timingFor = (s: AnimationSettings, n: number): TileTiming => s.timingMode === 'global' ? s.global : s.tiles.find(t => t.tileNumber === n)!;
export function fullGridTransform(v: FocusView): CameraTransform {
  const t = v.nativeTransform, w = t.sourceWidth, h = t.sourceHeight, rectangle = { x: 0, y: 0, width: w, height: h };
  return { ...t, focalPoint: { x: w / 2, y: h / 2 }, normalizedFocalPoint: { x: 0.5, y: 0.5 }, zoom: 1, scale: 1, translation: { x: 0, y: 0 },
    visibleSourceRectangle: rectangle, clippedSourceRectangle: rectangle, selectedContentRemovedPercent: 0, neighboursOrGuttersVisible: true, requiresControlledTransition: false };
}
export function nativeCameraAt(v: FocusView, progress: number): CameraTransform {
  if (progress <= 0) return fullGridTransform(v);
  if (progress >= 1) return structuredClone(v.nativeTransform);
  const t = v.nativeTransform, e = smoothstep(progress), scale = Math.exp(Math.log(t.scale) * e);
  const x = t.sourceWidth / 2 + (t.focalPoint.x - t.sourceWidth / 2) * e, y = t.sourceHeight / 2 + (t.focalPoint.y - t.sourceHeight / 2) * e;
  const width = t.viewport.width / scale, height = t.viewport.height / scale;
  const r = { x: x - width / 2, y: y - height / 2, width, height };
  return { ...t, scale, focalPoint: { x, y }, normalizedFocalPoint: { x: x / t.sourceWidth, y: y / t.sourceHeight },
    translation: { x: t.viewport.width / 2 - x * scale, y: t.viewport.height / 2 - y * scale }, visibleSourceRectangle: r, clippedSourceRectangle: r };
}
export function assertNativeBounds(t: CameraTransform) {
  const r = t.visibleSourceRectangle;
  if (t.coordinateSpace !== 'grid-pixels' || !Number.isFinite(t.scale) || t.scale < 1 || r.x < -1e-6 || r.y < -1e-6 || r.x + r.width > t.sourceWidth + 1e-6 || r.y + r.height > t.sourceHeight + 1e-6) throw new Error('Native camera extends beyond the source grid. Correct Step 4 framing before rendering.');
}
export interface CameraFrame { stage: 'zoom' | 'detail-dissolve' | 'focused-hold'; native: CameraTransform; detailBlend: number }
export function transitionFrames(v: FocusView, direction: 'in' | 'out', timing: TileTiming): CameraFrame[] {
  const result: CameraFrame[] = [], count = frameCount(direction === 'in' ? timing.zoomIn : timing.zoomOut);
  const zoom = () => { for (let i = 0; i < count; i++) { const p = i / (count - 1); const native = nativeCameraAt(v, direction === 'in' ? p : 1 - p); assertNativeBounds(native); result.push({ stage: 'zoom', native, detailBlend: 0 }); } };
  const dissolve = () => { if (v.cameraMode === 'detail') { const n = frameCount(timing.detailHandoff); for (let i = 0; i < n; i++) { const p = smoothstep(i / (n - 1)); result.push({ stage: 'detail-dissolve', native: v.nativeTransform, detailBlend: direction === 'in' ? p : 1 - p }); } } };
  if (direction === 'in') { zoom(); dissolve(); for (let i = 0; i < frameCount(timing.focusedHold); i++) result.push({ stage: 'focused-hold', native: v.nativeTransform, detailBlend: v.cameraMode === 'detail' ? 1 : 0 }); }
  else { dissolve(); zoom(); }
  return result;
}
export const transitionFilename = (format: OutputFormat, n: number, direction: 'in' | 'out') => direction === 'in' ? `${format}_zoom_to_tile_${String(n).padStart(2, '0')}.mp4` : `${format}_tile_${String(n).padStart(2, '0')}_to_grid.mp4`;
export interface VideoTools { available: boolean; ffmpeg: string | null; ffprobe: string | null; ffmpegVersion: string | null; ffprobeVersion: string | null; instructions: string }
export interface VideoProbe { width: number; height: number; codec: string; pixelFormat: string; frameRate: string; averageFrameRate: string; frames: number; duration: number; audioStreams: number }
export interface AnimationVideo {
  filename: string; relativePath: string; format: OutputFormat; tileNumber: number | null; kind: 'in' | 'out' | 'lesson' | 'cycle';
  cameraMode: 'native' | 'detail' | 'mixed'; sourceGridFilename: string; frameCount: number; duration: number; sha256: string; probe: VideoProbe;
  startTransform: CameraTransform; endTransform: CameraTransform; timings: TileTiming | null; playbackUrl: string; downloadUrl: string;
  commandArguments: string[];
}
export interface AnimationManifest {
  version: 1; module: 5; status: 'complete'; projectId: string; renderId: string; layoutGenerationId: string; extractionId: string;
  configurationSha256: string; renderedAt: string; outputDirectory: string; frameRate: 30; easing: 'smoothstep-log'; settings: AnimationSettings;
  request: AnimationRequest; focusConfig: FocusConfig; videos: AnimationVideo[]; manifestUrl: string;
  encoder: { name: 'ffmpeg'; version: string; codec: 'libx264'; pixelFormat: 'yuv420p'; crf: number; preset: string; audio: false; commandArguments: string[] };
  geometry: { sampler: 'bilinear-pixel-centres-v1'; endpointPolicy: string; pathFormula: string; detailPolicy: string; decodedPixelPolicy: string };
  sources: { mobileGridSha256: string; desktopGridSha256: string; tilePngSha256: string[] };
}
export interface AnimationJob {
  id: string; projectId: string; status: 'running' | 'complete' | 'failed' | 'cancelled'; progress: number; framesDone: number; framesTotal: number;
  message: string; startedAt: string; updatedAt: string; cancelRequested: boolean; error?: string; manifest?: AnimationManifest;
}
export interface AnimationState { tools: VideoTools; settings: AnimationSettings; manifest: AnimationManifest | null; fullManifest?: AnimationManifest | null; job: AnimationJob | null }
export const animationCheckNames = [
  'Render mobile tile 1 zoom in', 'Render mobile tile 1 zoom out', 'Render desktop tile 1 zoom in', 'Render desktop tile 1 zoom out',
  'Correct output resolutions', 'H.264 codec and yuv420p', 'Constant 30 fps', 'No audio stream', 'Exact frame counts and durations',
  'Zoom in starts at full grid', 'Zoom in ends at saved focus', 'Zoom out starts at saved focus', 'Zoom out ends at full grid',
  'Continuous camera positions', 'No unexpected edge borders', 'Correct selected panel', 'Independent format framing',
  'All 24 transition clips render', 'Both lesson previews play', 'Module 1–4 regression checks',
] as const;
