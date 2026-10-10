import { dimensions, validateProject, type Layout, type Panel, type Project } from './project';

export const tileFilename = (id: number) => `tile_${String(id).padStart(2, '0')}.png`;
export const extractionCheckNames = [
  'Extract six tiles from a 2 × 3 comic',
  'Extract six tiles from a 3 × 2 comic',
  'Create exactly six PNG files',
  'Match saved crop dimensions',
  'Match original decoded pixels exactly',
  'Preserve reading order',
  'Reject invalid crop coordinates',
  'Reject overlapping rectangles',
  'Reload and reproduce identical tile PNGs',
  'Preserve Module 1 acceptance checks',
  'Handle PNG, JPG, and WEBP inputs',
  'Include six images and manifest in ZIP',
] as const;

export interface ExtractedTile {
  number: number;
  crop: Panel;
  width: number;
  height: number;
  filename: string;
  status: 'complete';
  extractedAt: string;
  pngSha256: string;
  sourceRegionPixelSha256: string;
  decodedPixelSha256: string;
  pixelsMatch: true;
  validation: 'PASS';
  imageUrl: string;
  downloadUrl: string;
}
export interface ExtractionManifest {
  version: 1;
  module: 2;
  projectId: string;
  extractionId: string;
  configurationSha256: string;
  originalFilename: string;
  source: {
    inputId: string;
    filename: string;
    format: string;
    sha256: string;
    width: number;
    height: number;
    originalExifOrientation: number;
    retainedFile: string;
  };
  layout: Layout;
  coordinateSpace: 'oriented-original-pixels';
  pixelRepresentation: 'sRGB RGBA8' | 'sRGB RGBA16 little-endian';
  bitDepth: 8 | 16;
  status: 'complete';
  extractedAt: string;
  tiles: ExtractedTile[];
  validation: { status: 'PASS'; verifiedTiles: 6; method: 'decoded-byte-equality' };
  outputDirectory: string;
  manifestUrl: string;
  zipUrl: string;
}
export interface ExtractionJob {
  id: string;
  projectId: string;
  configurationSha256: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  completedTiles: number;
  totalTiles: 6;
  progress: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  error?: string;
  manifest?: ExtractionManifest;
}

// Module 1 uses integer, EXIF-oriented source pixels. No browser-size conversion is needed.
export function extractionConfiguration(project: Project) {
  return {
    projectId: project.id, inputId: project.input.id, sourceSha256: project.input.sha256,
    width: project.input.width, height: project.input.height,
    coordinateSpace: 'oriented-original-pixels', layout: project.layout,
    panels: [...project.panels].sort((a, b) => a.id - b.id),
  };
}

export function validateExtractionProject(project: Project): string[] {
  const errors = validateProject(project);
  if (errors.length) return errors;
  const ordered = [...project.panels].sort((a, b) => a.id - b.id);
  const { columns, rows } = dimensions(project.layout);
  let precedingRowBottom = -Infinity;
  for (let row = 0; row < rows; row++) {
    const panels = ordered.slice(row * columns, (row + 1) * columns);
    const centersY = panels.map(p => p.y + p.height / 2);
    if (Math.min(...centersY) <= precedingRowBottom) return ['Panel numbers must follow rows from top to bottom. Return to panel adjustment.'];
    precedingRowBottom = Math.max(...centersY);
    for (let i = 1; i < panels.length; i++) {
      if (panels[i].x + panels[i].width / 2 <= panels[i - 1].x + panels[i - 1].width / 2) return ['Panel numbers must follow columns from left to right. Return to panel adjustment.'];
    }
  }
  return [];
}
