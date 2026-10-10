import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { Zip, ZipPassThrough } from 'fflate';
import { atomicJson } from './storage.js';
import { extractionConfiguration, tileFilename, validateExtractionProject, type ExtractionManifest, type ExtractedTile } from '../shared/extraction.js';
import type { Panel, Project } from '../shared/project.js';

export const sha256 = (bytes: Buffer | Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const configurationHash = (project: Project) => sha256(JSON.stringify(extractionConfiguration(project)));

export class ExtractionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function abortIfRequested(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Extraction cancelled.', 'AbortError');
}

export async function decodeOriginal(buffer: Buffer, bitDepth?: 8 | 16) {
  const metadata = await sharp(buffer, { failOn: 'warning', limitInputPixels: 40_000_000 }).metadata();
  const depth = bitDepth ?? (metadata.depth === 'ushort' ? 16 : 8);
  let pipeline = sharp(buffer, { failOn: 'warning', limitInputPixels: 40_000_000 }).autoOrient();
  if (depth === 16 && metadata.icc) pipeline = pipeline.pipelineColourspace('rgb16').withIccProfile('srgb', { attach: false });
  const result = await pipeline.toColourspace(depth === 16 ? 'rgb16' : 'srgb').ensureAlpha()
    .raw({ depth: depth === 16 ? 'ushort' : 'uchar' }).toBuffer({ resolveWithObject: true });
  return { ...result, bitDepth: depth, bytesPerPixel: depth === 16 ? 8 : 4, metadata };
}

// Copy contiguous source rows directly. No interpolation, resize, or image enhancement occurs.
export function copyRegion(data: Buffer, sourceWidth: number, panel: Panel, bytesPerPixel: number): Buffer {
  const stride = panel.width * bytesPerPixel;
  const cropped = Buffer.allocUnsafe(stride * panel.height);
  for (let row = 0; row < panel.height; row++) {
    const from = ((panel.y + row) * sourceWidth + panel.x) * bytesPerPixel;
    data.copy(cropped, row * stride, from, from + stride);
  }
  return cropped;
}

async function writeZip(filename: string, entries: { name: string; path: string }[], signal?: AbortSignal) {
  const output = createWriteStream(filename);
  const completion = finished(output);
  void completion.catch(() => {});
  const archive = new Zip((error, chunk, final) => {
    if (error) { output.destroy(error); return; }
    output.write(chunk);
    if (final) output.end();
  });
  try {
    for (const entry of entries) {
      abortIfRequested(signal);
      const stream = new ZipPassThrough(entry.name);
      stream.mtime = new Date('1980-01-01T00:00:00Z');
      archive.add(stream);
      for await (const chunk of createReadStream(entry.path, { highWaterMark: 64 * 1024, signal })) {
        abortIfRequested(signal);
        stream.push(new Uint8Array(chunk), false);
        if (output.writableNeedDrain) await once(output, 'drain');
        if (output.destroyed) throw new Error('ZIP output could not be written.');
      }
      stream.push(new Uint8Array(), true);
    }
    archive.end();
    await completion;
  } catch (error) {
    archive.terminate(); output.destroy(); await completion.catch(() => {}); throw error;
  }
}

export async function extractTiles(options: {
  project: Project; source: Buffer; runId: string; directory: string; displayDirectory: string;
  signal?: AbortSignal;
  onProgress?: (completedTiles: number, progress: number, message: string) => Promise<void>;
}): Promise<ExtractionManifest> {
  const { project, source, runId, directory, displayDirectory, signal, onProgress } = options;
  const errors = validateExtractionProject(project);
  if (errors.length) throw new ExtractionError(400, errors.join(' '));
  if (sha256(source) !== project.input.sha256) throw new ExtractionError(409, 'The original image checksum has changed. Upload the original again.');
  abortIfRequested(signal);
  await onProgress?.(0, 3, 'Decoding the original image at full resolution…');
  const decoded = await decodeOriginal(source);
  if (decoded.info.width !== project.input.width || decoded.info.height !== project.input.height || decoded.info.channels !== 4) throw new ExtractionError(400, 'Saved coordinates do not match the decoded original image dimensions.');
  abortIfRequested(signal);
  const tilesDirectory = path.join(directory, 'tiles'), metadataDirectory = path.join(directory, 'metadata');
  await Promise.all([mkdir(tilesDirectory, { recursive: true }), mkdir(metadataDirectory, { recursive: true }), mkdir(path.join(directory, 'source'), { recursive: true })]);
  const sourceExtension = project.input.format === 'jpeg' ? 'jpg' : project.input.format;
  const retainedFile = `source/original_comic.${sourceExtension}`;
  await writeFile(path.join(directory, retainedFile), source);
  await atomicJson(path.join(metadataDirectory, 'project.json'), project);
  const extractedAt = new Date().toISOString();
  const fileBase = `/api/projects/${project.id}/extractions/${runId}/files`;
  const tiles: ExtractedTile[] = [];
  for (const panel of [...project.panels].sort((a, b) => a.id - b.id)) {
    abortIfRequested(signal);
    const region = copyRegion(decoded.data, decoded.info.width, panel, decoded.bytesPerPixel);
    const raw = decoded.bitDepth === 16 ? new Uint16Array(region.buffer, region.byteOffset, region.byteLength / 2) : region;
    const png = await sharp(raw, { raw: { width: panel.width, height: panel.height, channels: 4 } })
      .toColourspace(decoded.bitDepth === 16 ? 'rgb16' : 'srgb')
      .png({ compressionLevel: 9, palette: false, adaptiveFiltering: false }).toBuffer();
    abortIfRequested(signal);
    const filename = tileFilename(panel.id);
    const tilePath = path.join(tilesDirectory, filename);
    await writeFile(tilePath, png);
    // Verify the actual file written to disk against the corresponding full-source region.
    const roundtrip = await decodeOriginal(await readFile(tilePath), decoded.bitDepth);
    if (roundtrip.info.width !== panel.width || roundtrip.info.height !== panel.height || !roundtrip.data.equals(region)) throw new ExtractionError(500, `Pixel verification failed for tile ${panel.id}. No extraction will be published.`);
    tiles.push({
      number: panel.id, crop: { ...panel }, width: panel.width, height: panel.height,
      filename, status: 'complete', extractedAt, pngSha256: sha256(png),
      sourceRegionPixelSha256: sha256(region), decodedPixelSha256: sha256(roundtrip.data),
      pixelsMatch: true, validation: 'PASS', imageUrl: `${fileBase}/${filename}`, downloadUrl: `${fileBase}/${filename}?download=1`,
    });
    await onProgress?.(tiles.length, Math.round(8 + tiles.length / 6 * 78), `Tile ${panel.id} of 6 extracted and pixel-verified.`);
  }
  abortIfRequested(signal);
  const manifest: ExtractionManifest = {
    version: 1, module: 2, projectId: project.id, extractionId: runId,
    configurationSha256: configurationHash(project), originalFilename: project.input.filename,
    source: { inputId: project.input.id, filename: project.input.filename, format: project.input.format, sha256: project.input.sha256, width: decoded.info.width, height: decoded.info.height, originalExifOrientation: decoded.metadata.orientation ?? 1, retainedFile },
    layout: project.layout, coordinateSpace: 'oriented-original-pixels',
    pixelRepresentation: decoded.bitDepth === 16 ? 'sRGB RGBA16 little-endian' : 'sRGB RGBA8', bitDepth: decoded.bitDepth,
    status: 'complete', extractedAt, tiles,
    validation: { status: 'PASS', verifiedTiles: 6, method: 'decoded-byte-equality' },
    outputDirectory: displayDirectory,
    manifestUrl: `${fileBase}/tile_extraction_manifest.json?download=1`,
    zipUrl: `${fileBase}/six_extracted_tiles.zip?download=1`,
  };
  const manifestPath = path.join(metadataDirectory, 'tile_extraction_manifest.json');
  await atomicJson(manifestPath, manifest);
  await onProgress?.(6, 92, 'Packaging six original-resolution PNGs and their manifest…');
  await writeZip(path.join(directory, 'six_extracted_tiles.zip'), [
    ...tiles.map(tile => ({ name: tile.filename, path: path.join(tilesDirectory, tile.filename) })),
    { name: 'tile_extraction_manifest.json', path: manifestPath },
  ], signal);
  abortIfRequested(signal);
  return manifest;
}
