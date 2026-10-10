import type { ExtractionManifest } from './extraction';
import type { Panel, Layout } from './project';

export type OutputFormat = 'mobile' | 'desktop';
export type FitMode = 'FIT' | 'FILL';
export interface TilePosition { number: number; x: number; y: number }
export interface FormatSettings {
  outerMargin: number; internalGutter: number; gutterColor: string;
  paddingColor: string; mode: FitMode; positions: TilePosition[];
}
export interface GridSettings { linked: boolean; mobile: FormatSettings; desktop: FormatSettings }
export const outputFormats: OutputFormat[] = ['mobile', 'desktop'];
export const outputSpec = {
  mobile: { width: 1080, height: 1920, columns: 2, rows: 3, layout: '2x3' as Layout, aspect: '9:16' },
  desktop: { width: 1920, height: 1080, columns: 3, rows: 2, layout: '3x2' as Layout, aspect: '16:9' },
};
export function defaultGridSettings(): GridSettings {
  const format = (): FormatSettings => ({ outerMargin: 0, internalGutter: 10, gutterColor: '#ffffff', paddingColor: '#2b2b2b', mode: 'FIT', positions: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, x: 0.5, y: 0.5 })) });
  return { linked: true, mobile: format(), desktop: format() };
}
export function validateGridSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Grid settings are required.'];
  const settings = value as GridSettings;
  if (typeof settings.linked !== 'boolean') return ['Choose linked or separate grid settings.'];
  for (const name of outputFormats) {
    const s = settings[name];
    if (!s || !Number.isSafeInteger(s.outerMargin) || s.outerMargin < 0 || s.outerMargin > 200 || !Number.isSafeInteger(s.internalGutter) || s.internalGutter < 0 || s.internalGutter > 120) return ['Outer margin must be 0–200 integer pixels; gutter must be 0–120 integer pixels.'];
    if (s.mode !== 'FIT' && s.mode !== 'FILL') return ['Fitting mode must be FIT or FILL.'];
    if (![s.gutterColor, s.paddingColor].every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return ['Colours must use six-digit hexadecimal values.'];
    if (!Array.isArray(s.positions) || s.positions.length !== 6 || new Set(s.positions.map(p => p?.number)).size !== 6 || s.positions.some(p => !p || !Number.isInteger(p.number) || p.number < 1 || p.number > 6 || ![p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1))) return ['Each tile needs a unique position with X and Y between 0 and 1.'];
  }
  if (settings.linked && (['outerMargin', 'internalGutter', 'gutterColor', 'paddingColor', 'mode'] as const).some(key => settings.mobile[key] !== settings.desktop[key])) return ['Linked formats must share gutter, margin, colours, and fitting mode.'];
  return [];
}
// Canonical property/order representation also ignores unrelated JSON properties.
export function canonicalSettings(settings: GridSettings): GridSettings {
  const copy = (s: FormatSettings): FormatSettings => ({ outerMargin: s.outerMargin, internalGutter: s.internalGutter, gutterColor: s.gutterColor.toLowerCase(), paddingColor: s.paddingColor.toLowerCase(), mode: s.mode, positions: [...s.positions].sort((a, b) => a.number - b.number).map(p => ({ number: p.number, x: p.x, y: p.y })) });
  return { linked: settings.linked, mobile: copy(settings.mobile), desktop: copy(settings.desktop) };
}
export interface GridGeometry {
  width: number; height: number; columns: number; rows: number;
  outerMargin: number; requestedGutter: number; internalGutter: number;
  cellWidth: number; cellHeight: number; panels: Panel[];
}
export function resolveGeometry(format: OutputFormat, settings: FormatSettings): GridGeometry {
  const { width, height, columns, rows } = outputSpec[format], margin = settings.outerMargin;
  // Both fixed formats have the same divisibility conditions. Keep the requested
  // symmetric margin; choose the closest valid common gutter, preferring up on ties.
  let gutter = -1;
  for (let distance = 0; distance <= 6 && gutter < 0; distance++) {
    for (const candidate of [settings.internalGutter + distance, settings.internalGutter - distance]) {
      const w = width - 2 * margin - (columns - 1) * candidate;
      const h = height - 2 * margin - (rows - 1) * candidate;
      if (candidate >= 0 && w > 0 && h > 0 && w % columns === 0 && h % rows === 0) { gutter = candidate; break; }
    }
  }
  if (gutter < 0) throw new Error('These settings cannot produce equal integer panel cells.');
  const cellWidth = (width - 2 * margin - (columns - 1) * gutter) / columns;
  const cellHeight = (height - 2 * margin - (rows - 1) * gutter) / rows;
  const panels = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, x: margin + i % columns * (cellWidth + gutter), y: margin + Math.floor(i / columns) * (cellHeight + gutter), width: cellWidth, height: cellHeight }));
  return { width, height, columns, rows, outerMargin: margin, requestedGutter: settings.internalGutter, internalGutter: gutter, cellWidth, cellHeight, panels };
}
export interface TilePlacement {
  number: number; sourceFilename: string; sourcePngSha256: string;
  sourceWidth: number; sourceHeight: number; destination: Panel; mode: FitMode;
  transform: {
    uniformScale: number; scaledWidth: number; scaledHeight: number;
    paddingLeft: number; paddingTop: number; cropLeft: number; cropTop: number;
    position: TilePosition; visibleSource: { x: number; y: number; width: number; height: number };
    artworkRemoved: boolean; removedAreaPercent: number;
  };
}
export interface GridOutput {
  format: OutputFormat; layout: Layout; width: number; height: number; tileOrder: number[];
  geometry: GridGeometry; settings: FormatSettings; placements: TilePlacement[];
  filename: string; pngSha256: string; imageUrl: string; downloadUrl: string;
}
export interface LayoutManifest {
  version: 1; module: 3; projectId: string; generationId: string; sourceComicId: string;
  sourceComicSha256: string; sourceLayout: Layout; extractionId: string;
  extractionConfigurationSha256: string; configurationSha256: string;
  coordinateSpace: 'output-image-pixels'; pixelRepresentation: 'sRGB RGBA8';
  renderer: { name: 'sharp'; version: string; kernel: 'lanczos3' };
  settings: GridSettings; generatedAt: string; outputs: Record<OutputFormat, GridOutput>;
  outputDirectory: string; manifestUrl: string;
}
export interface GridJob {
  id: string; projectId: string; extractionId: string; configurationSha256: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled'; progress: number;
  message: string; startedAt: string; updatedAt: string; cancelRequested: boolean;
  error?: string; manifest?: LayoutManifest;
}
export interface GridState { settings: GridSettings; manifest: LayoutManifest | null; job: GridJob | null }
export function layoutConfiguration(source: ExtractionManifest, settings: GridSettings) {
  return { projectId: source.projectId, extractionId: source.extractionId, extractionConfigurationSha256: source.configurationSha256, sourceComicSha256: source.source.sha256, tiles: [...source.tiles].sort((a, b) => a.number - b.number).map(t => ({ number: t.number, filename: t.filename, width: t.width, height: t.height, pngSha256: t.pngSha256 })), settings: canonicalSettings(settings) };
}
export const layoutCheckNames = [
  'Portrait source → mobile PNG', 'Portrait source → desktop PNG',
  'Landscape source → mobile PNG', 'Landscape source → desktop PNG',
  'Six equal integer cells', 'Reading order in both formats', 'Aligned panel boundaries',
  'No overlapping cells', 'Exact output dimensions', 'Uniform artwork scaling',
  'FIT preserves the complete artwork', 'FILL crops without changing source tiles',
  'Applied colours, padding, margins and gutters', 'Reload and regenerate consistently',
  'Module 1 and Module 2 regression checks',
] as const;
