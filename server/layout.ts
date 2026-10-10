import sharp from 'sharp';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { abortIfRequested, ExtractionError, sha256 } from './extraction.js';
import { atomicJson } from './storage.js';
import type { ExtractionManifest } from '../shared/extraction.js';
import { canonicalSettings, layoutConfiguration, outputFormats, outputSpec, resolveGeometry, type GridOutput, type GridSettings, type LayoutManifest, type TilePlacement } from '../shared/layout.js';

export const layoutHash = (source: ExtractionManifest, settings: GridSettings) => sha256(JSON.stringify(layoutConfiguration(source, settings)));

export async function reconstructGrids(options: {
  source: ExtractionManifest; settings: GridSettings; generationId: string;
  tileDirectory: string; directory: string; displayDirectory: string;
  signal?: AbortSignal; onProgress?: (progress: number, message: string) => Promise<void>;
}): Promise<LayoutManifest> {
  const { source, generationId, tileDirectory, directory, displayDirectory, signal } = options;
  const settings = canonicalSettings(options.settings);
  if (source.tiles.length !== 6 || source.tiles.some((t, i) => t.number !== i + 1 || t.filename !== `tile_0${i + 1}.png` || !t.pixelsMatch)) throw new ExtractionError(409, 'A complete, ordered six-tile extraction is required.');
  const sources: Buffer[] = [];
  for (const tile of source.tiles) {
    abortIfRequested(signal);
    let bytes: Buffer;
    try { bytes = await readFile(path.join(tileDirectory, tile.filename)); }
    catch { throw new ExtractionError(409, `Missing ${tile.filename}. Re-extract the approved panels.`); }
    if (sha256(bytes) !== tile.pngSha256) throw new ExtractionError(409, `${tile.filename} changed. Re-extract the approved panels.`);
    const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
    if (metadata.format !== 'png' || metadata.width !== tile.width || metadata.height !== tile.height) throw new ExtractionError(409, `Invalid extracted tile: ${tile.filename}.`);
    sources.push(bytes);
  }
  await mkdir(path.join(directory, 'layouts'), { recursive: true });
  const outputs = {} as Record<'mobile' | 'desktop', GridOutput>;
  let completed = 0;
  for (const format of outputFormats) {
    const s = settings[format], geometry = resolveGeometry(format, s), placements: TilePlacement[] = [];
    const composites: sharp.OverlayOptions[] = [];
    for (const [i, tile] of source.tiles.entries()) {
      abortIfRequested(signal);
      const cell = geometry.panels[i], position = s.positions[i];
      // inside/outside preserve aspect ratio. Never use Sharp's stretching fit:'fill'.
      const resized = await sharp(sources[i]).toColourspace('srgb').ensureAlpha().resize({ width: cell.width, height: cell.height, fit: s.mode === 'FIT' ? 'inside' : 'outside', kernel: 'lanczos3' }).png().toBuffer({ resolveWithObject: true });
      const scaledWidth = resized.info.width, scaledHeight = resized.info.height;
      const paddingLeft = s.mode === 'FIT' ? Math.floor((cell.width - scaledWidth) / 2) : 0;
      const paddingTop = s.mode === 'FIT' ? Math.floor((cell.height - scaledHeight) / 2) : 0;
      const cropLeft = s.mode === 'FILL' ? Math.round((scaledWidth - cell.width) * position.x) : 0;
      const cropTop = s.mode === 'FILL' ? Math.round((scaledHeight - cell.height) * position.y) : 0;
      const artwork = s.mode === 'FIT' ? resized.data : await sharp(resized.data).extract({ left: cropLeft, top: cropTop, width: cell.width, height: cell.height }).png().toBuffer();
      const cellPng = await sharp({ create: { width: cell.width, height: cell.height, channels: 4, background: s.paddingColor } }).composite([{ input: artwork, left: paddingLeft, top: paddingTop }]).png().toBuffer();
      composites.push({ input: cellPng, left: cell.x, top: cell.y });
      const uniformScale = (s.mode === 'FIT' ? Math.min : Math.max)(cell.width / tile.width, cell.height / tile.height);
      const artworkRemoved = s.mode === 'FILL' && (scaledWidth > cell.width || scaledHeight > cell.height);
      placements.push({ number: tile.number, sourceFilename: tile.filename, sourcePngSha256: tile.pngSha256, sourceWidth: tile.width, sourceHeight: tile.height, destination: cell, mode: s.mode, transform: {
        uniformScale, scaledWidth, scaledHeight, paddingLeft, paddingTop, cropLeft, cropTop, position,
        // Actual raster rounding is recorded for exact future reconstruction.
        visibleSource: s.mode === 'FIT' ? { x: 0, y: 0, width: tile.width, height: tile.height } : { x: cropLeft * tile.width / scaledWidth, y: cropTop * tile.height / scaledHeight, width: cell.width * tile.width / scaledWidth, height: cell.height * tile.height / scaledHeight },
        artworkRemoved, removedAreaPercent: artworkRemoved ? 100 * (1 - cell.width * cell.height / (scaledWidth * scaledHeight)) : 0,
      } });
      completed++;
      await options.onProgress?.(Math.round(completed / 14 * 100), `Placing tile ${tile.number} in the ${format} grid…`);
    }
    abortIfRequested(signal);
    const png = await sharp({ create: { width: geometry.width, height: geometry.height, channels: 4, background: s.gutterColor } }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
    const filename = `${format}_six_tile_grid.png`;
    await writeFile(path.join(directory, 'layouts', filename), png);
    const imageUrl = `/api/projects/${source.projectId}/layouts/${generationId}/files/${filename}`;
    outputs[format] = { format, layout: outputSpec[format].layout, width: geometry.width, height: geometry.height, tileOrder: source.tiles.map(t => t.number), geometry, settings: s, placements, filename, pngSha256: sha256(png), imageUrl, downloadUrl: `${imageUrl}?download=1` };
    completed++;
    await options.onProgress?.(Math.round(completed / 14 * 100), `${format === 'mobile' ? 'Mobile' : 'Desktop'} PNG written.`);
  }
  abortIfRequested(signal);
  const manifest: LayoutManifest = { version: 1, module: 3, projectId: source.projectId, generationId, sourceComicId: source.source.inputId, sourceComicSha256: source.source.sha256, sourceLayout: source.layout, extractionId: source.extractionId, extractionConfigurationSha256: source.configurationSha256, configurationSha256: layoutHash(source, settings), coordinateSpace: 'output-image-pixels', pixelRepresentation: 'sRGB RGBA8', renderer: { name: 'sharp', version: sharp.versions.sharp, kernel: 'lanczos3' }, settings, generatedAt: new Date().toISOString(), outputs, outputDirectory: displayDirectory, manifestUrl: `/api/projects/${source.projectId}/layouts/${generationId}/files/layout_manifest.json?download=1` };
  await atomicJson(path.join(directory, 'metadata', 'layout_manifest.json'), manifest);
  return manifest;
}
