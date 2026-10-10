import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import type { ExportContext, ExportEntry, ExportScope, ExportSettings, ExportValidation } from '../shared/export.js';
import { outputFormats, outputSpec } from '../shared/layout.js';
import { detectVideoTools, captureProcess } from './video-tools.js';
import { cameraGeometryMatches, decodeDisplayedRgb, probeFrameSource, verifyPngAgainstVideo } from './frame-decode.js';
import { hashFile, safeZipPath, type PackageFile } from './export-zip.js';

export const exportFingerprint = (c: ExportContext) => createHash('sha256').update(JSON.stringify({ project: c.project, extraction: c.extraction.extractionId, layout: c.layout.generationId, focus: c.focus, animation: c.animation.renderId, frames: c.frames })).digest('hex');
export function fileWithin(base: string, relative: string) { safeZipPath(relative); const absolute = path.resolve(base, relative); if (!absolute.startsWith(path.resolve(base) + path.sep)) throw new Error('Asset path escapes its project.'); return absolute; }
export function bufferFile(name: string, bytes: Uint8Array, category = 'metadata', module = 7): PackageFile { return { bytes, entry: { path: safeZipPath(name), size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), category, module, mandatory: true, validation: 'PASS' } }; }
export const jsonFile = (name: string, value: unknown, module = 7) => bufferFile(name, Buffer.from(JSON.stringify(value, null, 2) + '\n'), 'metadata', module);
export function exportInstructions(c: ExportContext, settings: ExportSettings) {
  return {
    clipchamp: `${settings.lessonTitle || settings.projectName}\nCLIPCHAMP ASSEMBLY\n\nCreate separate mobile 9:16 and desktop 16:9 projects. Import the corresponding full_grid.png, individual transitions, Gemini clips generated manually later, and your own narration. The lesson_preview.mp4 is for checking choreography.\n\nPlace full_grid.png as an opening still for ${c.animation.settings.initialGridHold} seconds. For tiles 1 through 6: place transitions/zoom_to_tile_NN.mp4; insert the matching Gemini micro-motion video; repeat or trim a usable motion segment to the voice-over duration; put narration on a separate audio track; place transitions/tile_NN_to_grid.mp4. Between tiles place full_grid.png for ${c.animation.settings.intermediateGridHold} seconds. After tile 6 place full_grid.png for ${c.animation.settings.finalGridHold} seconds. Set each still's duration explicitly in Clipchamp.\n\nIndividual zoom-in clips include a configured focused placeholder hold, but do not include the preview's grid holds. Placeholder holds do not constrain narration duration. If trimming or reencoding a transition, its last decoded pixels can change; the authoritative Gemini PNG corresponds to the original completed file. Inspect continuity after editing.\n\nExternal Gemini video may finish in a different pose. Inspect it; use an optional still bridge, hold or short crossfade before zoom-out when needed. The original PNG is exact against its source video, but independently encoded zoom-out pixels may differ. No external Gemini loop has been verified as seamless.\n`,
    gemini: `${settings.lessonTitle || settings.projectName}\nMANUAL GEMINI HANDOFF\n\nOpen Gemini's image-to-video workflow manually. Choose gemini_frames/tile_NN_first_frame.png for the correct tile and format (mobile 9:16 or desktop 16:9). Use this exact supplied first-frame image as the starting visual reference. Describe only subtle emotional/physical movement. Preserve character identity, face, proportions, clothing, hair, objects, furniture, background, lighting, camera angle, perspective and framing. Keep the camera locked; do not add characters, props, captions, logos, speech bubbles, subtitles or speech. Avoid lighting changes and exaggerated emotion.\n\nGenerate the clip externally and inspect it before Clipchamp use. A one-second target is a preference: Gemini may return a longer video. Select a suitable portion and trim/repeat it in Clipchamp. Do not assume a mathematically seamless loop or identical ending pose. Use a bridge, hold or short crossfade when needed.\n\nNative camera FIT views can include surrounding gutters and neighbours. Preserve the whole provided frame. To change framing, edit the camera in the application, rerender, and extract/verify its new last displayed frame. Do not independently recrop the authoritative PNG.\n`,
  };
}
export async function collectValidatedFiles(dataRoot: string, c: ExportContext, scope: ExportScope, settings: ExportSettings, signal: AbortSignal, progress: (message: string, fraction: number) => void) {
  const report: ExportValidation = { timestamp: new Date().toISOString(), scope, status: 'PASS', results: [], warnings: [] }, files: PackageFile[] = [], id = c.project.id;
  const base = path.join(dataRoot, 'exports', id), extracted = path.join(base, 'runs', c.extraction.extractionId), layout = path.join(base, 'layout-runs', c.layout.generationId), animation = path.join(base, 'animation-runs', c.animation.renderId), frames = path.join(base, 'frame-runs', c.frames.generationId);
  if ([c.extraction.projectId, c.layout.projectId, c.focus.projectId, c.animation.projectId, c.frames.projectId].some(p => p !== id) || c.layout.extractionId !== c.extraction.extractionId || c.animation.layoutGenerationId !== c.layout.generationId || c.animation.extractionId !== c.extraction.extractionId || c.frames.animationRenderId !== c.animation.renderId || c.frames.animationConfigurationSha256 !== c.animation.configurationSha256) throw new Error('Required manifests belong to different or outdated generations. Regenerate downstream outputs.');
  const tools = await detectVideoTools(); if (!tools.available) throw new Error(tools.instructions); let processed = 0;
  async function check(name: string, action: () => Promise<void>, optional = false) {
    signal.throwIfAborted(); progress(`Validating ${name}`, Math.min(++processed / 60, 1));
    try { await action(); report.results.push({ filename: name, status: 'PASS', reason: 'Current bytes validated.' }); }
    catch (e) { signal.throwIfAborted(); const reason = e instanceof Error ? e.message : String(e); report.results.push({ filename: name, status: optional ? 'SKIPPED' : 'FAIL', reason }); if (optional) report.warnings.push(`${name}: ${reason}`); else report.status = 'FAIL'; }
  }
  async function add(filename: string, name: string, category: string, module: number, expected: string | undefined, props: Partial<ExportEntry> = {}) {
    const size = (await stat(filename)).size, sha256 = await hashFile(filename, signal); if (expected && expected !== sha256) throw new Error('Checksum differs from approved manifest.');
    files.push({ filename, entry: { path: safeZipPath(name), category, module, size, sha256, mandatory: true, validation: 'PASS', sourceFilename: path.basename(filename), ...props } });
  }
  async function png(filename: string, width: number, height: number) { const m = await sharp(filename, { failOn: 'warning' }).metadata(); if (m.format !== 'png' || m.width !== width || m.height !== height) throw new Error(`Expected lossless PNG ${width}×${height}.`); await sharp(filename, { failOn: 'warning' }).stats(); }
  async function video(filename: string, format: 'mobile' | 'desktop', count: number) {
    const container = JSON.parse((await captureProcess(tools.ffprobe!, ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'json', filename], signal)).toString()); if (!String(container.format?.format_name).split(',').includes('mp4')) throw new Error('Expected MP4 container.');
    const p = await probeFrameSource(tools, filename, format, signal), d = await decodeDisplayedRgb(tools, filename, p.video.width, p.video.height, signal); if (d.frameCount !== count || d.frameCount !== p.video.frames) throw new Error('Decoded frame count differs from manifest.');
  }
  const sourceName = c.extraction.source.format === 'png' ? 'original_comic.png' : path.basename(c.extraction.source.filename);
  await check(`source/${sourceName}`, async () => { const filename = fileWithin(extracted, c.extraction.source.retainedFile); await sharp(filename, { failOn: 'warning' }).stats(); await add(filename, `source/${sourceName}`, 'source', 1, c.project.input.sha256); });
  if (c.extraction.tiles.length !== 6 || new Set(c.extraction.tiles.map(t => t.number)).size !== 6) throw new Error('Exactly six unique source tiles are required.');
  for (const t of c.extraction.tiles) await check(`extracted_tiles/${t.filename}`, async () => { const f = fileWithin(extracted, `tiles/${t.filename}`); await png(f, t.width, t.height); await add(f, `extracted_tiles/${t.filename}`, 'tile', 2, t.pngSha256, { tileNumber: t.number, resolution: { width: t.width, height: t.height } }); });
  for (const format of outputFormats.filter(f => scope === 'complete' || scope === f)) {
    const spec = outputSpec[format], g = c.layout.outputs[format];
    await check(`${format}/full_grid.png`, async () => { const f = fileWithin(layout, `layouts/${g.filename}`); await png(f, spec.width, spec.height); await add(f, `${format}/full_grid.png`, 'grid', 3, g.pngSha256, { format, resolution: spec }); });
    const videos = c.animation.videos.filter(v => v.format === format && ['in', 'out', 'lesson'].includes(v.kind));
    if (videos.length !== 13 || videos.filter(v => v.kind === 'lesson').length !== 1) throw new Error(`${format}: twelve transitions and one preview required.`);
    for (const v of videos) {
      const n = String(v.tileNumber).padStart(2, '0'), name = v.kind === 'lesson' ? `${format}/lesson_preview.mp4` : `${format}/transitions/${v.kind === 'in' ? `zoom_to_tile_${n}` : `tile_${n}_to_grid`}.mp4`;
      await check(name, async () => { const f = fileWithin(animation, v.relativePath); await video(f, format, v.frameCount); await add(f, name, 'video', 5, v.sha256, { format, ...(v.tileNumber ? { tileNumber: v.tileNumber } : {}), duration: v.duration, resolution: spec }); });
    }
    for (let n = 1; n <= 6; n++) {
      const name = `${format}/gemini_frames/tile_${String(n).padStart(2, '0')}_first_frame.png`;
      await check(name, async () => {
        const f = c.frames.frames.find(f => f.format === format && f.tileNumber === n), incoming = videos.find(v => v.kind === 'in' && v.tileNumber === n), outgoing = videos.find(v => v.kind === 'out' && v.tileNumber === n), approved = c.focus.views.find(v => v.format === format && v.tileNumber === n);
        if (!f?.readyForGemini || f.exactDecodedPixelMatch !== 'PASS' || f.zoomOutGeometryMatch !== 'PASS' || c.frames.failures.some(e => e.format === format && e.tileNumber === n) || !incoming || !outgoing || !approved) throw new Error('Mandatory first-frame or geometry validation has not passed.');
        if (!cameraGeometryMatches(approved.transform, incoming.endTransform) || !cameraGeometryMatches(incoming.endTransform, outgoing.startTransform)) throw new Error('Saved camera geometry disagrees with rendered endpoints.');
        const filename = fileWithin(frames, f.relativePath); await png(filename, spec.width, spec.height); const verification = await verifyPngAgainstVideo(tools, filename, fileWithin(animation, incoming.relativePath), format, signal); if (!verification.pass || verification.pngFileSha256 !== f.pngFileSha256) throw new Error('Current PNG is not exactly equal to an independent source video decode.');
        await add(filename, name, 'gemini-frame', 6, f.pngFileSha256, { format, tileNumber: n, resolution: spec });
      });
    }
    for (const b of c.frames.bridges.filter(b => b.format === format)) await check(`${format}/optional_bridges/${b.filename}`, async () => { const f = fileWithin(frames, b.relativePath); await video(f, format, b.frameCount); await add(f, `${format}/optional_bridges/${b.filename}`, 'bridge', 6, b.videoSha256, { mandatory: false, format, tileNumber: b.tileNumber, resolution: spec, duration: b.duration }); }, true);
  }
  const metadata: [string, string, unknown, number][] = [
    ['project.json', path.join(dataRoot, 'projects', id + '.json'), c.project, 1], ['tile_extraction_manifest.json', path.join(extracted, 'metadata', 'tile_extraction_manifest.json'), c.extraction, 2],
    ['layout_manifest.json', path.join(layout, 'metadata', 'layout_manifest.json'), c.layout, 3], ['focus_config.json', path.join(base, 'metadata', 'focus_config.json'), c.focus, 4],
    ['camera_animation_manifest.json', path.join(animation, 'metadata', 'camera_animation_manifest.json'), c.animation, 5], ['frame_validation_report.json', path.join(frames, 'metadata', 'frame_validation_report.json'), c.frames, 6],
  ];
  for (const [name, filename, expected, module] of metadata) await check('metadata/' + name, async () => { const saved = JSON.parse(await readFile(filename, 'utf8')); if (!isDeepStrictEqual(saved, expected)) throw new Error('Stored metadata differs from the current approved snapshot.'); await add(filename, 'metadata/' + name, 'metadata', module, undefined); });
  files.push(jsonFile('metadata/tiles_geometry.json', { version: 1, sourceCoordinateSpace: 'EXIF-oriented original pixels; integer, half-open rectangles', sourcePanels: c.project.panels, tiles: c.extraction.tiles.map(t => ({ number: t.number, crop: t.crop })), grids: Object.fromEntries(outputFormats.map(f => [f, c.layout.outputs[f].geometry])), cameraConvention: 'Uniform scale plus translation: viewport = source * scale + translation. Pixel centres at x+0.5,y+0.5; normalized focal = source focal/source dimensions. Tile coordinates start at crop origin. Saved focus transforms are authoritative.' }));
  const instructions = exportInstructions(c, settings); files.push(bufferFile('README_CLIPCHAMP.txt', Buffer.from(instructions.clipchamp), 'instructions'), bufferFile('README_GEMINI.txt', Buffer.from(instructions.gemini), 'instructions'));
  return { files, report };
}
