import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { atomicJson } from './storage.js';
import { sha256, abortIfRequested } from './extraction.js';
import { probeVideo } from './video-tools.js';
import { renderFocusPixels } from '../shared/focus-render.js';
import { outputFormats, type OutputFormat } from '../shared/layout.js';
import type { FocusView } from '../shared/focus.js';
import type { AnimationContext } from './animation-jobs.js';
import { frameCount, fullGridTransform, timingFor, transitionFilename, transitionFrames, type AnimationManifest, type AnimationRequest, type AnimationSettings, type AnimationVideo, type CameraFrame, type VideoTools } from '../shared/animation.js';

export interface RenderTask { dataRoot: string; id: string; context: AnimationContext; settings: AnimationSettings; request: AnimationRequest; tools: VideoTools; configurationSha256: string }
export function encoderArguments(width: number, height: number, settings: AnimationSettings, filename: string) {
  return ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', '30', '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-preset', settings.preset, '-crf', String(settings.crf), '-threads', '2',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-r', '30', '-fps_mode', 'cfr',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', filename];
}
function encoder(tools: VideoTools, args: string[], signal: AbortSignal) {
  const child = spawn(tools.ffmpeg!, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
  let stderr = '', failure: Error | null = null;
  const abort = () => child.kill(); signal.addEventListener('abort', abort, { once: true });
  child.stdout.resume(); child.stderr.on('data', b => { stderr = (stderr + String(b)).slice(-8000); });
  child.stdin.on('error', e => { failure = e; });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject); child.on('close', code => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(new Error('Render cancelled.')); else if (code !== 0 || failure) reject(new Error(`FFmpeg failed: ${failure?.message ?? stderr}`)); else resolve(); });
  });
  void done.catch(() => {});
  return {
    filename: args.at(-1)!,
    async write(pixels: Uint8Array) {
      abortIfRequested(signal); if (child.exitCode !== null || failure || child.stdin.destroyed) { await done; throw new Error('Encoder closed unexpectedly.'); }
      if (!child.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) await Promise.race([once(child.stdin, 'drain'), done.then(() => { throw new Error('Encoder closed before accepting frame.'); })]);
    },
    async finish() { child.stdin.end(); await done; }, async stop() { child.kill(); await done.catch(() => {}); },
  };
}
async function fileHash(filename: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(filename)) h.update(chunk); return h.digest('hex'); }
export async function renderAnimations(task: RenderTask, signal: AbortSignal, progress: (done: number, total: number, message: string) => void): Promise<AnimationManifest> {
  const { context, settings, request, tools, id } = task, { layout, source, config } = context;
  const base = path.resolve(task.dataRoot, 'exports', config.projectId), directory = path.join(base, 'animation-runs', id);
  const formats = request.scope === 'all' ? outputFormats : [request.format];
  const allViews = request.scope === 'all' || request.scope === 'format';
  const viewsFor = (format: OutputFormat) => config.views.filter(v => v.format === format && (allViews || v.tileNumber === request.tileNumber)).sort((a, b) => a.tileNumber - b.tileNumber);
  const total = formats.reduce((sum, f) => sum + frameCount(settings.initialGridHold) + frameCount(settings.finalGridHold) + (viewsFor(f).length - 1) * frameCount(settings.intermediateGridHold) + viewsFor(f).reduce((n, v) => n + transitionFrames(v, 'in', timingFor(settings, v.tileNumber)).length + transitionFrames(v, 'out', timingFor(settings, v.tileNumber)).length, 0), 0);
  let done = 0, lastProgress = 0; const encoders = new Set<ReturnType<typeof encoder>>();
  const notify = (message: string, force = false) => { if (force || Date.now() - lastProgress > 200) { progress(done, total, message); lastProgress = Date.now(); } };
  const manifest: AnimationManifest = {
    version: 1, module: 5, status: 'complete', projectId: config.projectId, renderId: id, layoutGenerationId: layout.generationId, extractionId: source.extractionId,
    configurationSha256: task.configurationSha256, renderedAt: new Date().toISOString(), outputDirectory: `data/exports/${config.projectId}/animation-runs/${id}`, frameRate: 30, easing: settings.easing, settings, request, focusConfig: config, videos: [],
    manifestUrl: `/api/projects/${config.projectId}/animations/${id}/files/camera_animation_manifest.json?download=1`,
    encoder: { name: 'ffmpeg', version: tools.ffmpegVersion!, codec: 'libx264', pixelFormat: 'yuv420p', crf: settings.crf, preset: settings.preset, audio: false, commandArguments: encoderArguments(1080, 1920, settings, '{output.mp4}') },
    geometry: { sampler: 'bilinear-pixel-centres-v1', endpointPolicy: 'Motion uses N=round(seconds*30) frames, inclusive i/(N-1) endpoints. In clips include placeholder focused hold; grid holds belong to previews. Out reverses the same geometric curve, sampled at its own duration.',
      pathFormula: 'e=3t²−2t³; centre=gridCentre+(savedCentre-gridCentre)*e; scale=exp(log(savedScale)*e); translation=viewport/2-centre*scale', detailPolicy: 'Native grid zoom, then explicitly labelled smoothstep dissolve to saved tile-pixel detail framing; reverse dissolve before zoom out.',
      decodedPixelPolicy: 'Exact intended transforms and Module 4 sampler. H.264 is lossy: separately encoded endpoints are not claimed to be RGB-identical. No authoritative Gemini PNGs are extracted in Module 5.' },
    sources: { mobileGridSha256: layout.outputs.mobile.pngSha256, desktopGridSha256: layout.outputs.desktop.pngSha256, tilePngSha256: source.tiles.map(t => t.pngSha256) },
  };
  async function load(filename: string, expectedHash: string, width: number, height: number) {
    abortIfRequested(signal); const b = await readFile(filename); if (sha256(b) !== expectedHash) throw new Error('Source PNG changed. Regenerate its preceding stage.');
    const raw = await sharp(b).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (raw.info.width !== width || raw.info.height !== height) throw new Error('Source PNG dimensions changed.'); return raw.data;
  }
  async function open(format: OutputFormat, relativePath: string) {
    const spec = layout.outputs[format], filename = path.join(directory, relativePath); await mkdir(path.dirname(filename), { recursive: true });
    const e = encoder(tools, encoderArguments(spec.width, spec.height, settings, filename + '.partial.mp4'), signal); encoders.add(e); return e;
  }
  async function commit(e: ReturnType<typeof encoder>, video: Omit<AnimationVideo, 'probe' | 'sha256' | 'playbackUrl' | 'downloadUrl' | 'duration' | 'commandArguments'>) {
    await e.finish(); abortIfRequested(signal);
    const filename = path.join(directory, video.relativePath), probe = await probeVideo(tools.ffprobe!, e.filename, signal), spec = layout.outputs[video.format];
    if (probe.width !== spec.width || probe.height !== spec.height || probe.codec !== 'h264' || probe.pixelFormat !== 'yuv420p' || probe.frameRate !== '30/1' || probe.averageFrameRate !== '30/1' || probe.audioStreams !== 0 || probe.frames !== video.frameCount || Math.abs(probe.duration - video.frameCount / 30) > 0.002) throw new Error(`FFprobe validation failed for ${video.filename}: ${JSON.stringify(probe)}`);
    await rename(e.filename, filename);
    encoders.delete(e);
    const playbackUrl = `/api/projects/${config.projectId}/animations/${id}/files/${video.filename}`;
    manifest.videos.push({ ...video, probe, duration: video.frameCount / 30, sha256: await fileHash(filename), playbackUrl, downloadUrl: playbackUrl + '?download=1', commandArguments: encoderArguments(spec.width, spec.height, settings, video.relativePath) });
  }
  try {
    notify('Loading saved camera surfaces…', true);
    for (const format of formats) {
      const output = layout.outputs[format], views = viewsFor(format), gridTransform = fullGridTransform(views[0]);
      const grid = await load(path.join(base, 'layout-runs', layout.generationId, 'layouts', output.filename), output.pngSha256, output.width, output.height);
      const gridPixels = renderFocusPixels(grid, gridTransform);
      const previewName = allViews ? `${format}_lesson_preview.mp4` : `${format}_tile_${String(request.tileNumber).padStart(2, '0')}_animation_preview.mp4`;
      const preview = await open(format, previewName); let previewFrames = 0;
      const feedPreview = async (pixels: Uint8Array, message: string) => { await preview.write(pixels); done++; previewFrames++; notify(message); };
      const gridHold = async (seconds: number) => { for (let i = 0; i < frameCount(seconds); i++) await feedPreview(gridPixels, `${format}: full-grid hold`); };
      await gridHold(settings.initialGridHold);
      for (const [index, view] of views.entries()) {
        const timing = timingFor(settings, view.tileNumber), nativePixels = renderFocusPixels(grid, view.nativeTransform), viewGrid = fullGridTransform(view);
        let detailPixels: Uint8Array | null = null;
        if (view.cameraMode === 'detail') { const tile = source.tiles[view.tileNumber - 1]; const raw = await load(path.join(base, 'runs', source.extractionId, 'tiles', tile.filename), tile.pngSha256, tile.width, tile.height); detailPixels = renderFocusPixels(raw, view.detailTransform); }
        function pixelsFor(frame: CameraFrame) {
          if (frame.detailBlend === 1) return detailPixels!;
          const native = frame.native.scale === 1 ? gridPixels : frame.native === view.nativeTransform || frame.stage !== 'zoom' ? nativePixels : renderFocusPixels(grid, frame.native);
          if (frame.detailBlend === 0) return native;
          const blended = new Uint8Array(native.length), a = frame.detailBlend;
          for (let i = 0; i < native.length; i += 4) { blended[i] = Math.round(native[i] * (1 - a) + detailPixels![i] * a); blended[i + 1] = Math.round(native[i + 1] * (1 - a) + detailPixels![i + 1] * a); blended[i + 2] = Math.round(native[i + 2] * (1 - a) + detailPixels![i + 2] * a); blended[i + 3] = 255; }
          return blended;
        }
        for (const direction of ['in', 'out'] as const) {
          const frames = transitionFrames(view, direction, timing), filename = transitionFilename(format, view.tileNumber, direction), relativePath = `${format}/transitions/${filename}`;
          const clip = request.scope === 'preview' ? null : await open(format, relativePath);
          for (const frame of frames) { abortIfRequested(signal); const pixels = pixelsFor(frame); if (clip) await clip.write(pixels); await feedPreview(pixels, `${format} tile ${view.tileNumber}: ${frame.stage === 'zoom' ? `zoom ${direction}` : frame.stage}`); }
          if (clip) await commit(clip, { filename, relativePath, format, tileNumber: view.tileNumber, kind: direction, cameraMode: view.cameraMode, sourceGridFilename: output.filename, frameCount: frames.length,
            startTransform: direction === 'in' ? viewGrid : view.transform, endTransform: direction === 'in' ? view.transform : viewGrid, timings: timing });
        }
        if (index < views.length - 1) await gridHold(settings.intermediateGridHold);
      }
      await gridHold(settings.finalGridHold);
      await commit(preview, { filename: previewName, relativePath: previewName, format, tileNumber: allViews ? null : request.tileNumber, kind: allViews ? 'lesson' : 'cycle', cameraMode: views.every(v => v.cameraMode === 'native') ? 'native' : views.every(v => v.cameraMode === 'detail') ? 'detail' : 'mixed', sourceGridFilename: output.filename,
        frameCount: previewFrames, startTransform: gridTransform, endTransform: gridTransform, timings: allViews ? null : timingFor(settings, request.tileNumber) });
    }
    abortIfRequested(signal); await atomicJson(path.join(directory, 'metadata', 'camera_animation_manifest.json'), manifest);
    notify('All MP4 files passed FFprobe validation.', true); return manifest;
  } finally { for (const e of encoders) { await e.stop(); await unlink(e.filename).catch(() => {}); } }
}
