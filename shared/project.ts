export type Layout = '2x3' | '3x2';
export type Span = [number, number];
export interface Grid { x: Span[]; y: Span[] }
export interface Panel { id: number; x: number; y: number; width: number; height: number }
export interface InputMetadata {
  id: string;
  filename: string;
  format: 'png' | 'jpeg' | 'webp';
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  imageUrl: string;
  uploadedAt: string;
}
export interface Detection {
  confidence: number;
  method: 'gutter-projection';
  notes: string[];
}
export interface Project {
  version: 1;
  id: string;
  title: string;
  lessonTitle?: string;
  createdAt: string;
  updatedAt: string;
  input: InputMetadata;
  layout: Layout;
  grid: Grid;
  panels: Panel[];
  detection: Detection;
  manuallyAdjusted: boolean;
}
export interface CheckResult { name: string; status: 'PASS' | 'FAIL'; detail: string }
export const dimensions = (layout: Layout) => layout === '2x3' ? { columns: 2, rows: 3 } : { columns: 3, rows: 2 };
export const layoutLabel = (layout: Layout) => layout === '2x3' ? '2 × 3' : '3 × 2';

export function panelsFromGrid(grid: Grid): Panel[] {
  return grid.y.flatMap(([top, bottom], row) => grid.x.map(([left, right], col) => ({
    id: row * grid.x.length + col + 1, x: left, y: top, width: right - left, height: bottom - top,
  })));
}

export function validatePanels(panels: unknown, width: number, height: number): string[] {
  if (!Array.isArray(panels) || panels.length !== 6) return ['Exactly six rectangular panels are required.'];
  const errors: string[] = [];
  const ids = new Set<number>();
  for (const panel of panels) {
    if (!panel || typeof panel !== 'object') { errors.push('Panel coordinates must be objects.'); continue; }
    const p = panel as Panel;
    if (![p.id, p.x, p.y, p.width, p.height].every(Number.isSafeInteger)) {
      errors.push('Every panel ID and coordinate must be a finite integer.'); continue;
    }
    if (p.id < 1 || p.id > 6 || ids.has(p.id)) errors.push('Panel IDs must be unique numbers from 1 to 6.');
    ids.add(p.id);
    if (p.width <= 0 || p.height <= 0) errors.push(`Panel ${p.id} must have positive width and height.`);
    if (p.x < 0 || p.y < 0 || p.x + p.width > width || p.y + p.height > height) errors.push(`Panel ${p.id} is outside the image.`);
  }
  if (errors.length) return [...new Set(errors)];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i] as Panel, b = panels[j] as Panel;
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) {
        errors.push(`Panels ${a.id} and ${b.id} overlap.`);
      }
    }
  }
  return errors;
}

export function validateGrid(grid: unknown, layout: Layout, width: number, height: number): string[] {
  const g = grid as Grid | null;
  if (!g || !Array.isArray(g.x) || !Array.isArray(g.y)) return ['Grid must define horizontal and vertical spans.'];
  const { columns, rows } = dimensions(layout);
  if (g.x.length !== columns || g.y.length !== rows) return ['Grid dimensions do not match the selected layout.'];
  for (const [spans, limit] of [[g.x, width], [g.y, height]] as const) {
    let previous = 0;
    for (const span of spans) {
      if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isSafeInteger)) return ['Grid spans must contain two integer coordinates.'];
      if (span[0] < previous || span[1] <= span[0] || span[1] > limit) return ['Grid spans must be positive, ordered, inside the image, and non-overlapping.'];
      previous = span[1];
    }
  }
  return [];
}

export const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export function validateProject(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Project must be a JSON object.'];
  const p = value as Project;
  if (p.version !== 1) return ['Unsupported project version; expected version 1.'];
  if (!validId(p.id) || !validId(p.input?.id)) return ['Invalid project or input ID.'];
  if (p.layout !== '2x3' && p.layout !== '3x2') return ['Layout must be 2x3 or 3x2 (columns × rows).'];
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) return ['Project title must contain 1–200 characters.'];
  if (p.lessonTitle !== undefined && (typeof p.lessonTitle !== 'string' || p.lessonTitle.length > 200)) return ['Lesson title must be at most 200 characters.'];
  if (typeof p.createdAt !== 'string' || !Number.isFinite(Date.parse(p.createdAt)) || typeof p.updatedAt !== 'string' || !Number.isFinite(Date.parse(p.updatedAt))) return ['Project timestamps are invalid.'];
  const input = p.input;
  if (![input.width, input.height, input.bytes].every(n => Number.isSafeInteger(n) && n > 0) || input.width * input.height > 40_000_000) return ['Invalid image dimensions or file size.'];
  if (!['png', 'jpeg', 'webp'].includes(input.format) || input.mime !== { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[input.format]) return ['Invalid input format or MIME type.'];
  if (typeof input.filename !== 'string' || !input.filename || input.filename.length > 255 || typeof input.uploadedAt !== 'string' || !Number.isFinite(Date.parse(input.uploadedAt))) return ['Invalid input filename or timestamp.'];
  if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256) || input.imageUrl !== `/api/images/${input.id}`) return ['Invalid input checksum or image reference.'];
  if (!p.detection || p.detection.method !== 'gutter-projection' || !Number.isFinite(p.detection.confidence) || p.detection.confidence < 0 || p.detection.confidence > 1 || !Array.isArray(p.detection.notes) || !p.detection.notes.every(n => typeof n === 'string')) return ['Invalid detection metadata.'];
  if (typeof p.manuallyAdjusted !== 'boolean') return ['Invalid adjustment flag.'];
  return [...validateGrid(p.grid, p.layout, input.width, input.height), ...validatePanels(p.panels, input.width, input.height)];
}

// Dragging a grid edge also updates all corresponding panel edges, while preserving individual edits.
export function moveGridEdge(project: Project, axis: 'x' | 'y', index: number, edge: 0 | 1, value: number): Project {
  const spans = project.grid[axis].map(span => [...span] as Span);
  const span = spans[index];
  const limit = axis === 'x' ? project.input.width : project.input.height;
  const min = edge === 0 ? (index > 0 ? spans[index - 1][1] : 0) : span[0] + 1;
  const max = edge === 0 ? span[1] - 1 : (index + 1 < spans.length ? spans[index + 1][0] : limit);
  const position = Math.max(min, Math.min(max, Math.round(value)));
  const old = span[edge];
  span[edge] = position;
  const panels = project.panels.map(panel => {
    const { columns } = dimensions(project.layout);
    const cell = axis === 'x' ? (panel.id - 1) % columns : Math.floor((panel.id - 1) / columns);
    if (cell !== index) return panel;
    const start = axis === 'x' ? panel.x : panel.y;
    const size = axis === 'x' ? panel.width : panel.height;
    const current = edge === 0 ? start : start + size;
    const next = current + position - old;
    if (axis === 'x') return edge === 0 ? { ...panel, x: next, width: start + size - next } : { ...panel, width: next - start };
    return edge === 0 ? { ...panel, y: next, height: start + size - next } : { ...panel, height: next - start };
  });
  return { ...project, grid: { ...project.grid, [axis]: spans }, panels, manuallyAdjusted: true };
}
