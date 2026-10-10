import sharp from 'sharp';
import { dimensions, panelsFromGrid, type Grid, type Layout, type Span, type Detection } from '../shared/project.js';

interface AxisEstimate { spans: Span[]; evidence: number; found: number }

// Each projection measures how much of a full row/column is a uniform light or dark gutter.
// A full-length gap carries much more evidence than a bright object within one panel.
function projection(data: Buffer, width: number, height: number, axis: 'x' | 'y'): number[] {
  const length = axis === 'x' ? width : height;
  const cross = axis === 'x' ? height : width;
  return Array.from({ length }, (_, position) => {
    let light = 0, dark = 0, sum = 0, squares = 0;
    for (let i = 0; i < cross; i++) {
      const x = axis === 'x' ? position : i, y = axis === 'y' ? position : i;
      const offset = (y * width + x) * 3;
      const r = data[offset], g = data[offset + 1], b = data[offset + 2];
      const luminance = (r + g + b) / 3;
      if (Math.min(r, g, b) > 229) light++;
      if (Math.max(r, g, b) < 42) dark++;
      sum += luminance;
      squares += luminance * luminance;
    }
    const variance = Math.max(0, squares / cross - (sum / cross) ** 2);
    const uniform = Math.exp(-variance / 100);
    return Math.max(light / cross, dark / cross) * 0.85 + uniform * 0.15;
  });
}

function estimateAxis(scores: number[], count: number, originalSize: number): AxisEstimate {
  const length = scores.length;
  const bands: Span[] = [];
  let evidence = 0, found = 0;
  for (let split = 1; split < count; split++) {
    const expected = length * split / count;
    const radius = length * 0.34 / count;
    const min = Math.max(1, Math.floor(expected - radius));
    const max = Math.min(length - 2, Math.ceil(expected + radius));
    let best = Math.round(expected), quality = -Infinity;
    for (let i = min; i <= max; i++) {
      const candidate = scores[i] - Math.abs(i - expected) / length * 0.12;
      if (candidate > quality) { best = i; quality = candidate; }
    }
    if (scores[best] > 0.86) {
      let start = best, end = best + 1;
      while (start > min && scores[start - 1] > 0.86) start--;
      while (end < max && scores[end] > 0.86) end++;
      // Large empty areas are ambiguous, not a reliable gutter.
      if (end - start < length * 0.11) {
        bands.push([start, end]);
        evidence += scores[best];
        found++;
        continue;
      }
    }
    bands.push([Math.round(expected), Math.round(expected)]);
    evidence += Math.min(scores[best], 0.4) * 0.3;
  }
  let outerStart = 0, outerEnd = length;
  while (outerStart < length * 0.07 && scores[outerStart] > 0.86) outerStart++;
  while (outerEnd > length * 0.93 && scores[outerEnd - 1] > 0.86) outerEnd--;
  if (outerStart >= length * 0.07) outerStart = 0;
  if (outerEnd <= length * 0.93) outerEnd = length;
  const cuts = [outerStart, ...bands.flat(), outerEnd];
  const scale = originalSize / length;
  const spans = Array.from({ length: count }, (_, i) => [Math.round(cuts[i * 2] * scale), Math.round(cuts[i * 2 + 1] * scale)] as Span);
  return { spans, evidence: evidence / (count - 1), found };
}

export async function detectLayout(buffer: Buffer, forced?: Layout) {
  const { data, info } = await sharp(buffer, { failOn: 'warning', limitInputPixels: 40_000_000 })
    .rotate().flatten({ background: '#ffffff' }).toColourspace('srgb')
    .resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(buffer).metadata();
  const swapped = metadata.orientation !== undefined && metadata.orientation >= 5;
  const width = swapped ? metadata.height! : metadata.width!;
  const height = swapped ? metadata.width! : metadata.height!;
  const x = projection(data, info.width, info.height, 'x');
  const y = projection(data, info.width, info.height, 'y');
  const candidates = (['2x3', '3x2'] as Layout[]).map(layout => {
    const { columns, rows } = dimensions(layout);
    const horizontal = estimateAxis(x, columns, width), vertical = estimateAxis(y, rows, height);
    const score = (horizontal.evidence + vertical.evidence) / 2;
    const aspectPrior = (layout === '2x3' ? height >= width : width >= height) ? 0.035 : 0;
    return { layout, grid: { x: horizontal.spans, y: vertical.spans } as Grid, score, rank: score + aspectPrior, found: horizontal.found + vertical.found };
  });
  const chosen = forced ? candidates.find(c => c.layout === forced)! : candidates.sort((a, b) => b.rank - a.rank)[0];
  const confidence = Math.round(Math.min(0.99, Math.max(0.15, chosen.score)) * 100) / 100;
  const detection: Detection = {
    confidence, method: 'gutter-projection',
    notes: chosen.found === 3
      ? ['Three internal gutters detected. Review the guides before saving.']
      : [`Found ${chosen.found} of 3 expected gutters. Equal divisions estimate missing boundaries; adjust the guides manually.`],
  };
  return { layout: chosen.layout, grid: chosen.grid, panels: panelsFromGrid(chosen.grid), detection, width, height };
}
