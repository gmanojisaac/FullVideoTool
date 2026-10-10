import path from 'node:path';
import { hashFile } from './export-zip.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import { atomicJson, readJson } from './storage.js';
import { abortIfRequested, ExtractionError, sha256 } from './extraction.js';
import { captureProcess, detectVideoTools, probeVideo } from './video-tools.js';
import { cameraGeometryMatches, decodeDisplayedRgb, pixelDifference, probeFrameSource, rgbDecodeArguments, verifyPngAgainstVideo } from './frame-decode.js';
import { validId } from '../shared/project.js';
import { outputFormats, type OutputFormat } from '../shared/layout.js';
import { frameKey, geminiFrameFilename, type FrameJob, type FrameRequest, type FrameSettings, type FrameState, type FrameValidation, type FrameValidationReport } from '../shared/frames.js';
import type { AnimationManifest, AnimationVideo } from '../shared/animation.js';

export function validateFrameSourceManifest(source: AnimationManifest) {
  if (source.status !== 'complete' || source.request.scope !== 'all' || !validId(source.projectId) || !validId(source.renderId) || source.focusConfig.views.length !== 12) throw new ExtractionError(409, 'Render all tiles in both formats in Step 5 first.');
  for (const format of outputFormats) for (let n = 1; n <= 6; n++) for (const kind of ['in', 'out'] as const) {
    const matches = source.videos.filter(v => v.format === format && v.tileNumber === n && v.kind === kind);
    if (matches.length !== 1 || !matches[0].startTransform || !matches[0].endTransform || !source.focusConfig.views.some(v => v.format === format && v.tileNumber === n)) throw new ExtractionError(409, 'Camera manifest has missing or inconsistent tile numbering or framing.');
  }
}
export function createFrameService(dataRoot: string, getSource: (id: string) => Promise<AnimationManifest>) {
  const active = new Map<string, { job: FrameJob; controller: AbortController; persist: () => Promise<void> }>(), starting = new Set<string>();
  const root = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.resolve(dataRoot, 'exports', id); };
  const runRoot = (id: string, run: string) => { if (!validId(run)) throw new ExtractionError(400, 'Invalid frame generation ID.'); return path.join(root(id), 'frame-runs', run); };
  const jobFile = (id: string, run: string) => { runRoot(id, run); return path.join(root(id), 'frame-jobs', run + '.json'); };
  const reportFile = (id: string, run: string) => path.join(runRoot(id, run), 'metadata', 'frame_validation_report.json');
  const isRunning = (id: string) => active.has(id) || starting.has(id);
  async function settings(id: string): Promise<FrameSettings> { try { return await readJson(path.join(root(id), 'metadata', 'frame_settings.json')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { bridgeDuration: 0.3 }; throw e; } }
  async function getJob(id: string, run: string): Promise<FrameJob> {
    const file = jobFile(id, run), live = active.get(id); if (live?.job.id === run) return structuredClone(live.job);
    let job: FrameJob; try { job = await readJson(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ExtractionError(404, 'Frame job not found.'); throw e; }
    if (job.status === 'running') { job.status = 'failed'; job.error = 'Frame processing interrupted by service restart. Retry.'; job.message = job.error; await atomicJson(file, job); } return job;
  }
  async function latest(id: string): Promise<FrameValidationReport | null> { try { const ref = await readJson<{ id: string }>(path.join(root(id), 'latest-frames.json')); return await readJson(reportFile(id, ref.id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }
  async function current(id: string): Promise<FrameState> {
    const state: FrameState = { source: null, report: null, job: null, tools: await detectVideoTools(), settings: await settings(id) };
    try { state.source = await getSource(id); validateFrameSourceManifest(state.source); }
    catch (e) { if (e instanceof ExtractionError || (e as { status?: number }).status === 409) { state.reason = (e as Error).message; return state; } throw e; }
    const report = await latest(id); if (report?.animationRenderId === state.source.renderId) state.report = report;
    try { const ref = await readJson<{ id: string }>(path.join(root(id), 'active-frames.json')); state.job = await getJob(id, ref.id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return state;
  }
  function videoPath(source: AnimationManifest, v: AnimationVideo) {
    const base = path.resolve(root(source.projectId), 'animation-runs', source.renderId), file = path.resolve(base, v.relativePath);
    if (!file.startsWith(base + path.sep) || path.basename(file) !== v.filename || !/^(mobile|desktop)_(zoom_to_tile_0[1-6]|tile_0[1-6]_to_grid)\.mp4$/.test(v.filename)) throw new ExtractionError(400, 'Invalid camera video path.'); return file;
  }
  async function start(id: string, request: FrameRequest): Promise<FrameJob> {
    if (isRunning(id)) throw new ExtractionError(409, 'Frame processing is already running. Wait or cancel it.');
    if (!request || !['extract', 'verify', 'bridge'].includes(request.operation) || !['all', 'tile'].includes(request.scope) || !outputFormats.includes(request.format) || !Number.isInteger(request.tileNumber) || request.tileNumber < 1 || request.tileNumber > 6 || !Number.isFinite(request.bridgeDuration) || request.bridgeDuration < 1 / 30 || request.bridgeDuration > 3) throw new ExtractionError(400, 'Choose valid frame operation, tile and bridge duration (0.034–3 seconds).');
    starting.add(id);
    try {
      const source = await getSource(id); validateFrameSourceManifest(source); if (source.renderId !== request.expectedAnimationRenderId) throw new ExtractionError(409, 'Camera videos changed. Reload before extracting frames.');
      const tools = await detectVideoTools(); if (!tools.available) throw new ExtractionError(503, tools.instructions);
      const previous = await latest(id), usePrevious = previous?.animationRenderId === source.renderId;
      if (request.operation !== 'extract' && !usePrevious) throw new ExtractionError(409, 'Extract first frames from the current camera videos first.');
      const generationId = usePrevious ? previous.generationId : randomUUID(), run = randomUUID(), now = new Date().toISOString();
      const directory = runRoot(id, generationId), url = `/api/projects/${id}/frames/${generationId}/files/`;
      const report: FrameValidationReport = usePrevious ? structuredClone(previous) : {
        version: 1, module: 6, projectId: id, generationId, animationRenderId: source.renderId, animationConfigurationSha256: source.configurationSha256,
        updatedAt: now, frames: [], failures: [], bridges: [], outputDirectory: `data/exports/${id}/frame-runs/${generationId}`, reportUrl: url + 'frame_validation_report.json?download=1', allFramesDownloadUrl: `/api/projects/${id}/frames/${generationId}/all-first-frames.zip`,
        decodePipeline: { version: 1, name: 'sequential-presentation-rgb24', ffmpegVersion: tools.ffmpegVersion!, ffprobeVersion: tools.ffprobeVersion!, arguments: rgbDecodeArguments('{completed-zoom-in.mp4}'), selection: 'Decode every displayed frame in order. Retain final full RGB24 buffer. FFprobe frame timestamps identify its actual presentation time; no seek or duration subtraction.', verification: 'Encode lossless RGB PNG, reopen PNG as RGB24, launch a new FFmpeg process and decode the completed MP4 again. Compare every RGB pixel and SHA-256. No source comic, tile, focus sampler or screenshot is read.' },
      };
      await atomicJson(path.join(root(id), 'metadata', 'frame_settings.json'), { bridgeDuration: request.bridgeDuration });
      const job: FrameJob = { id: run, projectId: id, operation: request.operation, status: 'running', progress: 0, message: 'Opening completed camera MP4s…', startedAt: now, updatedAt: now, cancelRequested: false };
      let writes = Promise.resolve(); const persist = () => { job.updatedAt = new Date().toISOString(); const snapshot = structuredClone(job); writes = writes.then(() => atomicJson(jobFile(id, run), snapshot)); return writes; };
      const live = { job, controller: new AbortController(), persist };
      await persist();
      try { await atomicJson(path.join(root(id), 'active-frames.json'), { id: run }); }
      catch (error) {
        job.status = 'failed'; job.error = 'Frame processing could not start. Retry.'; job.message = job.error;
        await persist().catch(() => undefined);
        throw error;
      }
      active.set(id, live);
      const selected = source.focusConfig.views.filter(v => request.scope === 'all' || (v.format === request.format && v.tileNumber === request.tileNumber));
      const signal = live.controller.signal;
      async function processFrame(format: OutputFormat, tileNumber: number) {
        const incoming = source.videos.find(v => v.format === format && v.tileNumber === tileNumber && v.kind === 'in')!, outgoing = source.videos.find(v => v.format === format && v.tileNumber === tileNumber && v.kind === 'out')!;
        const inFile = videoPath(source, incoming), outFile = videoPath(source, outgoing);
        if (await hashFile(inFile, signal) !== incoming.sha256 || await hashFile(outFile, signal) !== outgoing.sha256) throw new Error('Source MP4 checksum changed. Render the affected camera videos again.');
        const filename = geminiFrameFilename(format, tileNumber), relativePath = `${format}/gemini_frames/${filename}`, png = path.join(directory, relativePath);
        let extractionDecodeId = report.frames.find(f => f.format === format && f.tileNumber === tileNumber)?.extractionDecodeId ?? '';
        if (request.operation === 'extract') {
          const probe = await probeFrameSource(tools, inFile, format, signal), decoded = await decodeDisplayedRgb(tools, inFile, probe.video.width, probe.video.height, signal);
          if (decoded.frameCount !== probe.video.frames || decoded.frameCount !== incoming.frameCount) throw new Error('Sequential extraction frame count disagrees with completed camera manifest.');
          extractionDecodeId = decoded.decodeId; await mkdir(path.dirname(png), { recursive: true });
          const pngBytes = await sharp(decoded.last, { raw: { width: probe.video.width, height: probe.video.height, channels: 3 } }).png().toBuffer();
          const temporary = png + '.' + randomUUID() + '.tmp'; await writeFile(temporary, pngBytes); await rename(temporary, png);
        }
        const verified = await verifyPngAgainstVideo(tools, png, inFile, format, signal);
        const outProbe = await probeFrameSource(tools, outFile, format, signal), out = await decodeDisplayedRgb(tools, outFile, outProbe.video.width, outProbe.video.height, signal);
        if (out.frameCount !== outgoing.frameCount) throw new Error('Zoom-out decoded frame count disagrees with camera manifest.');
        const difference = pixelDifference(verified.decoded.last, out.first), approved = source.focusConfig.views.find(v => v.format === format && v.tileNumber === tileNumber)!;
        const geometry = cameraGeometryMatches(incoming.endTransform, outgoing.startTransform) && cameraGeometryMatches(incoming.endTransform, approved.transform);
        const outStartName = `${format}_tile_${String(tileNumber).padStart(2, '0')}_zoom_out_start.png`, previewPath = path.join(directory, format, 'validation_previews', outStartName); await mkdir(path.dirname(previewPath), { recursive: true });
        await sharp(out.first, { raw: { width: outProbe.video.width, height: outProbe.video.height, channels: 3 } }).png().toFile(previewPath);
        const warnings: string[] = []; if (!verified.pass) warnings.push('Extracted PNG differs from the independently decoded final video frame. Regenerate this tile.');
        if (!geometry) warnings.push('Zoom-out camera geometry differs from saved focus. Correct and rerender camera clips before editing.');
        if (difference.differingPixels > 0) warnings.push('Separately encoded zoom-out pixels differ. Geometry may still match; inspect the handoff and use a bridge or short dissolve if needed.');
        const result: FrameValidation = { projectId: id, tileNumber, format, zoomInFilename: incoming.filename, zoomOutFilename: outgoing.filename, geminiPngFilename: filename, relativePath,
          video: verified.source.video, pngResolution: verified.pngResolution, lastFrameIndex: verified.decoded.frameCount - 1, lastPresentationTimestamp: verified.source.lastPresentationTimestamp, lastFrameIsKeyframe: verified.source.lastFrameIsKeyframe,
          pngFileSha256: verified.pngFileSha256, pngRgbSha256: verified.pngRgbSha256, videoRgbSha256: verified.videoRgbSha256, zoomOutRgbSha256: sha256(out.first),
          exactDecodedPixelMatch: verified.pass ? 'PASS' : 'FAIL', zoomOutGeometryMatch: geometry ? 'PASS' : 'FAIL', zoomOutDecodedPixelMatch: difference.differingPixels === 0 ? 'PASS' : 'FAIL',
          pixelDifference: verified.difference, zoomOutPixelDifference: difference, readyForGemini: verified.pass, warnings, validatedAt: new Date().toISOString(), extractionDecodeId, verificationDecodeId: verified.decoded.decodeId,
          sourceZoomInSha256: incoming.sha256, sourceZoomOutSha256: outgoing.sha256, imageUrl: url + filename, downloadUrl: url + filename + '?download=1', zoomOutStartImageUrl: url + outStartName,
          zoomInPlaybackUrl: incoming.playbackUrl, zoomOutPlaybackUrl: outgoing.playbackUrl, focusedTransform: incoming.endTransform, zoomOutStartTransform: outgoing.startTransform };
        report.frames = report.frames.filter(f => frameKey(f) !== frameKey(result)).concat(result).sort((a, b) => outputFormats.indexOf(a.format) - outputFormats.indexOf(b.format) || a.tileNumber - b.tileNumber);
        report.failures = report.failures.filter(f => frameKey(f) !== frameKey(result));
        report.bridges = report.bridges.filter(b => frameKey(b) !== frameKey(result) || b.sourcePngSha256 === result.pngFileSha256);
      }
      async function bridge(format: OutputFormat, tileNumber: number) {
        const item = report.frames.find(f => f.format === format && f.tileNumber === tileNumber); if (!item?.readyForGemini) throw new Error('Verify the authoritative PNG before generating a bridge.');
        const png = path.join(directory, item.relativePath); if (sha256(await readFile(png)) !== item.pngFileSha256) throw new Error('PNG changed. Verify or regenerate it before creating a bridge.');
        const filename = `${format}_tile_${String(tileNumber).padStart(2, '0')}_bridge.mp4`, relativePath = `${format}/optional_bridges/${filename}`, file = path.join(directory, relativePath); await mkdir(path.dirname(file), { recursive: true });
        const frames = Math.round(request.bridgeDuration * 30), temporary = file + '.' + randomUUID() + '.tmp.mp4';
        await captureProcess(tools.ffmpeg!, ['-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', png, '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '2', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-r', '30', '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', temporary], signal);
        const probe = await probeVideo(tools.ffprobe!, temporary, signal); if (probe.frames !== frames || probe.width !== item.video.width || probe.height !== item.video.height || probe.codec !== 'h264' || probe.pixelFormat !== 'yuv420p' || probe.frameRate !== '30/1' || probe.audioStreams !== 0) throw new Error('Bridge encoding validation failed.');
        await rename(temporary, file); report.bridges = report.bridges.filter(b => b.format !== format || b.tileNumber !== tileNumber).concat({ format, tileNumber, filename, relativePath, frameCount: frames, duration: frames / 30, sourcePngSha256: item.pngFileSha256, videoSha256: await hashFile(file, signal), probe, playbackUrl: url + filename, downloadUrl: url + filename + '?download=1' });
      }
      async function process() {
        try {
          for (const [i, v] of selected.entries()) {
            abortIfRequested(signal); job.message = `${request.operation === 'bridge' ? 'Generating bridge' : request.operation === 'verify' ? 'Independently verifying' : 'Extracting and verifying'} ${v.format} tile ${v.tileNumber}…`; await persist();
            try { if (request.operation === 'bridge') await bridge(v.format, v.tileNumber); else await processFrame(v.format, v.tileNumber); }
            catch (e) { if (signal.aborted) throw e; if (request.operation === 'bridge') throw e; const failure = { format: v.format, tileNumber: v.tileNumber, error: e instanceof Error ? e.message : String(e), validatedAt: new Date().toISOString() }; report.frames = report.frames.filter(f => frameKey(f) !== frameKey(v)); report.failures = report.failures.filter(f => frameKey(f) !== frameKey(v)).concat(failure); }
            job.progress = Math.round((i + 1) / selected.length * 95); await persist(); await new Promise<void>(resolve => setImmediate(resolve));
          }
          abortIfRequested(signal); if ((await getSource(id)).renderId !== source.renderId) throw new Error('Camera render changed during extraction. Retry with the current videos.');
          report.updatedAt = new Date().toISOString(); await atomicJson(reportFile(id, generationId), report); await atomicJson(path.join(root(id), 'latest-frames.json'), { id: generationId });
          const status = report.failures.length || report.frames.some(f => !f.readyForGemini) ? 'failed' : 'complete';
          const complete: FrameJob = { ...job, report, status, progress: 100, updatedAt: new Date().toISOString(), message: status === 'complete' ? `${report.frames.filter(f => f.readyForGemini).length}/12 authoritative PNGs verified${request.operation === 'bridge' ? ' · bridge ready' : ''}.` : 'Frame verification has failures. Regenerate the affected tiles.', ...(status === 'failed' ? { error: report.failures.map(f => `${f.format} tile ${f.tileNumber}: ${f.error}`).join(' ') || 'PNG pixel verification failed.' } : { error: undefined }) };
          await writes; await atomicJson(jobFile(id, run), complete); Object.assign(job, complete);
        } catch (e) { job.status = signal.aborted ? 'cancelled' : 'failed'; job.message = signal.aborted ? 'Frame processing cancelled.' : 'Frame processing failed. Retry.'; job.error = signal.aborted ? undefined : e instanceof Error ? e.message : String(e); await persist(); }
        finally { active.delete(id); }
      }
      setImmediate(() => { void process().catch(e => { console.error('Frame processing persistence failed:', e); active.delete(id); }); }); return structuredClone(job);
    } finally { starting.delete(id); }
  }
  async function cancel(id: string, run: string) { jobFile(id, run); const live = active.get(id); if (live?.job.id === run) { live.job.cancelRequested = true; live.controller.abort(); live.job.message = 'Stopping frame decoding…'; await live.persist(); return structuredClone(live.job); } return getJob(id, run); }
  async function file(id: string, run: string, name: string, download = false) {
    const report = await readJson<FrameValidationReport>(reportFile(id, run));
    const frame = report.frames.find(f => f.geminiPngFilename === name), preview = /^(mobile|desktop)_tile_0[1-6]_zoom_out_start\.png$/.test(name), bridge = report.bridges.find(b => b.filename === name);
    const relative = name === 'frame_validation_report.json' ? 'metadata/frame_validation_report.json' : frame?.relativePath ?? (preview ? `${name.startsWith('mobile') ? 'mobile' : 'desktop'}/validation_previews/${name}` : bridge?.relativePath);
    if (!relative) throw new ExtractionError(404, 'Frame asset not found.');
    const directory = runRoot(id, run), result = path.resolve(directory, relative); if (!result.startsWith(directory + path.sep)) throw new ExtractionError(400, 'Invalid frame asset path.');
    if (frame && download && (!frame.readyForGemini || sha256(await readFile(result)) !== frame.pngFileSha256)) throw new ExtractionError(409, 'PNG is not currently verified. Verify or regenerate this tile first.'); return result;
  }
  async function allFrames(id: string, run: string) {
    const report = await readJson<FrameValidationReport>(reportFile(id, run));
    if (report.frames.length !== 12 || report.failures.length || report.frames.some(f => !f.readyForGemini)) throw new ExtractionError(409, 'Verify all twelve first-frame PNGs before downloading them together.');
    const files: Record<string, Uint8Array> = {};
    for (const f of report.frames) { const b = await readFile(await file(id, run, f.geminiPngFilename, true)); files[f.relativePath] = b; }
    // This download contains only the twelve PNGs. Full streaming lesson packaging is Module 7.
    return Buffer.from(zipSync(files, { level: 0 }));
  }
  return { current, start, cancel, getJob, file, allFrames, isRunning };
}
