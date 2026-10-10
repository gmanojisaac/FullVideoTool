import { outputFormats, outputSpec, type FitMode, type LayoutManifest, type OutputFormat } from './layout';
import type { ExtractionManifest } from './extraction';
import type { Panel } from './project';

export type CameraMode = 'native' | 'detail';
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface CameraSettings { fit: FitMode; zoom: number; center: Point; paddingColor: string }
export interface AutoSuggestion {
  status: 'unverified'; method: 'centre-fallback'; detectedSubjects: [];
  reason: string; sourceFocalPoint: Point;
}
export interface CameraTransform {
  version: 1; coordinateSpace: 'grid-pixels' | 'tile-pixels';
  sourceWidth: number; sourceHeight: number; sourceGridDimensions: { width: number; height: number };
  selectedTileRectangle: Panel; viewport: { width: number; height: number };
  focalPoint: Point; normalizedFocalPoint: Point; zoom: number; scale: number;
  translation: Point; visibleSourceRectangle: Rect; clippedSourceRectangle: Rect;
  fit: FitMode; paddingColor: string; selectedContentRemovedPercent: number;
  neighboursOrGuttersVisible: boolean; requiresControlledTransition: boolean;
  sampling: 'bilinear-pixel-centres-v1';
}
export interface FocusView {
  tileNumber: number; format: OutputFormat; cameraMode: CameraMode;
  sourceTileFilename: string; gridFilename: string;
  native: CameraSettings; detail: CameraSettings;
  nativeTransform: CameraTransform; detailTransform: CameraTransform; transform: CameraTransform;
  autoDetection: AutoSuggestion; manualOverride: boolean; approved: boolean; lastSavedAt: string | null;
}
export interface FocusConfig {
  version: 1; module: 4; projectId: string; layoutGenerationId: string; extractionId: string;
  sourceComicId: string; coordinateVersion: 1; revision: number; updatedAt: string | null;
  views: FocusView[];
}
export interface FocusPreviewManifest {
  version: 1; module: 4; provisional: true; projectId: string; generationId: string;
  layoutGenerationId: string; configurationSha256: string; generatedAt: string; outputDirectory: string;
  previews: { tileNumber: number; format: OutputFormat; filename: string; width: number; height: number; cameraMode: CameraMode; pngSha256: string; imageUrl: string; downloadUrl: string }[];
  configUrl: string;
}
export interface FocusJob {
  id: string; projectId: string; layoutGenerationId: string; status: 'running' | 'complete' | 'failed' | 'cancelled';
  progress: number; message: string; cancelRequested: boolean; startedAt: string; updatedAt: string;
  error?: string; manifest?: FocusPreviewManifest;
}
export interface FocusState { config: FocusConfig; manifest: FocusPreviewManifest | null; job: FocusJob | null }
export const focusKey = (view: Pick<FocusView, 'format' | 'tileNumber'>) => `${view.format}-${view.tileNumber}`;
export const focusFilename = (format: OutputFormat, number: number) => `${format}_tile_${String(number).padStart(2, '0')}_focus_preview.png`;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
export function cameraTransform(view: Pick<FocusView, 'tileNumber' | 'format' | 'native' | 'detail'>, mode: CameraMode, layout: LayoutManifest, source: ExtractionManifest): CameraTransform {
  const output = layout.outputs[view.format], tile = source.tiles[view.tileNumber - 1], rectangle = output.geometry.panels[view.tileNumber - 1];
  const s = view[mode], viewport = { width: output.width, height: output.height };
  const sourceWidth = mode === 'native' ? output.width : tile.width, sourceHeight = mode === 'native' ? output.height : tile.height;
  const base = (s.fit === 'FIT' ? Math.min : Math.max)(viewport.width / (mode === 'native' ? rectangle.width : tile.width), viewport.height / (mode === 'native' ? rectangle.height : tile.height));
  const scale = mode === 'native' ? Math.max(1, base * s.zoom) : base * s.zoom;
  const visibleWidth = viewport.width / scale, visibleHeight = viewport.height / scale;
  let x = clamp(s.center.x, 0, 1) * sourceWidth, y = clamp(s.center.y, 0, 1) * sourceHeight;
  if (mode === 'native' || s.fit === 'FILL') {
    x = visibleWidth <= sourceWidth ? clamp(x, visibleWidth / 2, sourceWidth - visibleWidth / 2) : sourceWidth / 2;
    y = visibleHeight <= sourceHeight ? clamp(y, visibleHeight / 2, sourceHeight - visibleHeight / 2) : sourceHeight / 2;
  }
  const visible = { x: x - visibleWidth / 2, y: y - visibleHeight / 2, width: visibleWidth, height: visibleHeight };
  const target: Rect = mode === 'native' ? rectangle : { x: 0, y: 0, width: tile.width, height: tile.height };
  const kept = intersection(visible, target), removed = 100 * (1 - kept.width * kept.height / (target.width * target.height));
  return { version: 1, coordinateSpace: mode === 'native' ? 'grid-pixels' : 'tile-pixels', sourceWidth, sourceHeight, sourceGridDimensions: { width: output.width, height: output.height }, selectedTileRectangle: rectangle, viewport, focalPoint: { x, y }, normalizedFocalPoint: { x: x / sourceWidth, y: y / sourceHeight }, zoom: s.zoom, scale, translation: { x: viewport.width / 2 - x * scale, y: viewport.height / 2 - y * scale }, visibleSourceRectangle: visible, clippedSourceRectangle: intersection(visible, { x: 0, y: 0, width: sourceWidth, height: sourceHeight }), fit: s.fit, paddingColor: s.paddingColor, selectedContentRemovedPercent: clamp(removed, 0, 100), neighboursOrGuttersVisible: mode === 'native' && (visible.x < rectangle.x - 1e-6 || visible.y < rectangle.y - 1e-6 || visible.x + visible.width > rectangle.x + rectangle.width + 1e-6 || visible.y + visible.height > rectangle.y + rectangle.height + 1e-6), requiresControlledTransition: mode === 'detail', sampling: 'bilinear-pixel-centres-v1' };
}
export function resolveFocusView(view: FocusView, layout: LayoutManifest, source: ExtractionManifest): FocusView {
  const nativeTransform = cameraTransform(view, 'native', layout, source), detailTransform = cameraTransform(view, 'detail', layout, source);
  return { ...view, sourceTileFilename: source.tiles[view.tileNumber - 1].filename, gridFilename: layout.outputs[view.format].filename, native: { ...view.native, center: nativeTransform.normalizedFocalPoint }, detail: { ...view.detail, center: detailTransform.normalizedFocalPoint }, nativeTransform, detailTransform, transform: view.cameraMode === 'native' ? nativeTransform : detailTransform };
}
export function defaultFocusView(format: OutputFormat, tileNumber: number, layout: LayoutManifest, source: ExtractionManifest): FocusView {
  const output = layout.outputs[format], rectangle = output.geometry.panels[tileNumber - 1];
  const common = { fit: 'FIT' as const, zoom: 1, paddingColor: '#2b2b2b' };
  const view = { tileNumber, format, cameraMode: 'native' as const, sourceTileFilename: source.tiles[tileNumber - 1].filename, gridFilename: output.filename,
    native: { ...common, center: { x: (rectangle.x + rectangle.width / 2) / output.width, y: (rectangle.y + rectangle.height / 2) / output.height } }, detail: { ...common, center: { x: 0.5, y: 0.5 } },
    autoDetection: { status: 'unverified' as const, method: 'centre-fallback' as const, detectedSubjects: [] as [], reason: 'No local face/eye/hand/object detector is installed. Image centre is an unverified suggestion; inspect and adjust manually.', sourceFocalPoint: { x: 0.5, y: 0.5 } }, manualOverride: false, approved: false, lastSavedAt: null,
  } as FocusView;
  return resolveFocusView(view, layout, source);
}
export function defaultFocusConfig(layout: LayoutManifest, source: ExtractionManifest): FocusConfig {
  return { version: 1, module: 4, projectId: layout.projectId, layoutGenerationId: layout.generationId, extractionId: source.extractionId, sourceComicId: source.source.inputId, coordinateVersion: 1, revision: 0, updatedAt: null, views: outputFormats.flatMap(format => Array.from({ length: 6 }, (_, i) => defaultFocusView(format, i + 1, layout, source))) };
}
export function applyAutomaticSuggestion(view: FocusView, layout: LayoutManifest, source: ExtractionManifest): FocusView {
  if (view.manualOverride || view.approved) return view;
  return defaultFocusView(view.format, view.tileNumber, layout, source);
}
export function validateFocusConfig(value: unknown, layout: LayoutManifest, source: ExtractionManifest): string[] {
  if (!value || typeof value !== 'object') return ['Focus configuration is required.'];
  const c = value as FocusConfig;
  if (c.version !== 1 || c.module !== 4 || c.coordinateVersion !== 1 || c.projectId !== layout.projectId || c.layoutGenerationId !== layout.generationId || c.extractionId !== source.extractionId || c.sourceComicId !== source.source.inputId) return ['Focus configuration references an obsolete or different grid. Reopen this project.'];
  if (!Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.views) || c.views.length !== 12) return ['Define exactly twelve focused views and a valid revision.'];
  const keys = new Set<string>();
  for (const v of c.views) {
    if (!v || !outputFormats.includes(v.format) || !Number.isInteger(v.tileNumber) || v.tileNumber < 1 || v.tileNumber > 6 || !['native', 'detail'].includes(v.cameraMode) || typeof v.manualOverride !== 'boolean' || typeof v.approved !== 'boolean') return ['Invalid tile, output format, camera mode or approval flag.'];
    const key = focusKey(v); if (keys.has(key)) return ['Each tile/format must have one independent configuration.']; keys.add(key);
    for (const s of [v.native, v.detail]) if (!s || !['FIT', 'FILL'].includes(s.fit) || !Number.isFinite(s.zoom) || s.zoom < 0.25 || s.zoom > 8 || !s.center || ![s.center.x, s.center.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6) || typeof s.paddingColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(s.paddingColor)) return ['Zoom must be 0.25–8; positions must be finite and padding must be a hex colour.'];
  }
  return [];
}
export function canonicalFocusConfig(config: FocusConfig, layout: LayoutManifest, source: ExtractionManifest): FocusConfig {
  const defaults = defaultFocusConfig(layout, source);
  const views = defaults.views.map(defaultView => {
    const v = config.views.find(v => focusKey(v) === focusKey(defaultView))!;
    const copy = (s: CameraSettings) => ({ fit: s.fit, zoom: s.zoom, center: { x: s.center.x, y: s.center.y }, paddingColor: s.paddingColor.toLowerCase() });
    return resolveFocusView({ ...defaultView, cameraMode: v.cameraMode, native: copy(v.native), detail: copy(v.detail), manualOverride: v.manualOverride, approved: v.approved, lastSavedAt: v.lastSavedAt }, layout, source);
  });
  return { ...defaults, revision: config.revision, updatedAt: config.updatedAt, views };
}
// Timestamps, approvals and revision do not change pixels.
export function focusPixelConfiguration(config: FocusConfig) {
  return { version: config.coordinateVersion, projectId: config.projectId, layoutGenerationId: config.layoutGenerationId, extractionId: config.extractionId, views: config.views.map(v => ({ tileNumber: v.tileNumber, format: v.format, cameraMode: v.cameraMode, transform: v.transform })) };
}
export const focusCheckNames = [
  'Load six source tile PNGs', 'Load mobile reconstructed grid', 'Load desktop reconstructed grid',
  'Generate six mobile provisional previews', 'Generate six desktop provisional previews',
  'Mobile previews are 1080 × 1920', 'Desktop previews are 1920 × 1080',
  'Uniform image scaling', 'Independent mobile and desktop framing', 'Pan and zoom persist geometry',
  'Restore settings after service restart', 'Reset restores default framing', 'Manual framing takes priority over automatic suggestions',
  'Native camera maps to real grid pixels', 'Detail mode is separate and labelled', 'Native view preserves neighbours and gutters',
  'Reject invalid / safely clamp out-of-bounds transforms', 'Module 1–3 regression checks',
] as const;
