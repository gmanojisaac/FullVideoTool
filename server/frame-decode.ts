import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { captureProcess, probeVideo } from './video-tools.js';
import { ExtractionError, sha256 } from './extraction.js';
import { outputSpec, type OutputFormat } from '../shared/layout.js';
import type { CameraTransform } from '../shared/focus.js';
import type { PixelDifference } from '../shared/frames.js';
import type { VideoTools } from '../shared/animation.js';

export function rgbDecodeArguments(filename: string) {
  return ['-v', 'error', '-xerror', '-err_detect', 'explode', '-threads', '1', '-i', filename, '-map', '0:v:0', '-an', '-sn', '-dn', '-fps_mode', 'passthrough', '-sws_flags', 'accurate_rnd+bitexact', '-pix_fmt', 'rgb24', '-c:v', 'rawvideo', '-threads', '1', '-f', 'rawvideo', 'pipe:1'];
}
export async function probeFrameSource(tools: VideoTools, filename: string, format: OutputFormat, signal?: AbortSignal) {
  try { const s = await stat(filename); if (!s.isFile() || s.size === 0) throw new Error('Empty video.'); }
  catch { throw new ExtractionError(400, 'Source MP4 is missing or empty. Render the camera clip again.'); }
  const video = await probeVideo(tools.ffprobe!, filename, signal), spec = outputSpec[format];
  if (video.codec !== 'h264' || video.pixelFormat !== 'yuv420p') throw new ExtractionError(400, 'Unsupported video codec or pixel format. Expected H.264 yuv420p.');
  if (video.width !== spec.width || video.height !== spec.height) throw new ExtractionError(400, 'Incorrect video resolution for the selected format.');
  if (video.frameRate !== '30/1' || video.averageFrameRate !== '30/1' || video.audioStreams !== 0 || !Number.isSafeInteger(video.frames) || video.frames < 1) throw new ExtractionError(400, 'Expected a decodable silent 30 fps video.');
  const data = JSON.parse((await captureProcess(tools.ffprobe!, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,key_frame', '-of', 'json', filename], signal, 4 * 1024 * 1024)).toString());
  const frames = data.frames as { best_effort_timestamp_time?: string; key_frame: number }[];
  if (!frames?.length || frames.length !== video.frames) throw new ExtractionError(400, 'Video contains incomplete or no displayed frames.');
  const timestamps = frames.map(f => Number(f.best_effort_timestamp_time));
  if (timestamps.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= timestamps[i - 1]))) throw new ExtractionError(400, 'Video frame presentation timestamps are missing or not strictly ordered.');
  return { video, frames, lastPresentationTimestamp: timestamps.at(-1)!, lastFrameIsKeyframe: frames.at(-1)!.key_frame === 1 };
}
// Consume all decoder output in display order. Keep only the first and last full
// RGB24 frames; memory usage stays bounded independently of video duration.
export async function decodeDisplayedRgb(tools: VideoTools, filename: string, width: number, height: number, signal?: AbortSignal) {
  const decodeId = randomUUID(), bytesPerFrame = width * height * 3, working = Buffer.allocUnsafe(bytesPerFrame);
  let offset = 0, frameCount = 0, first: Buffer | null = null, last: Buffer | null = null, stderr = '', spawnError: Error | null = null;
  const child = spawn(tools.ffmpeg!, rgbDecodeArguments(filename), { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  child.stderr.on('data', b => { stderr = (stderr + String(b)).slice(-8000); });
  const closed = new Promise<number | null>(resolve => { child.on('error', e => { spawnError = e; }); child.on('close', resolve); });
  try {
    for await (const chunk of child.stdout) {
      const bytes = chunk as Buffer; let position = 0;
      while (position < bytes.length) {
        const count = Math.min(bytesPerFrame - offset, bytes.length - position); bytes.copy(working, offset, position, position + count); offset += count; position += count;
        if (offset === bytesPerFrame) { last = Buffer.from(working); if (!first) first = last; frameCount++; offset = 0; }
      }
    }
    const code = await closed;
    if (signal?.aborted) throw new Error('Frame decoding cancelled.');
    if (spawnError || code !== 0 || offset !== 0 || !first || !last) throw new ExtractionError(400, `Video could not be fully decoded: ${spawnError ? (spawnError as Error).message : stderr || 'No complete RGB frames.'}`);
    return { first, last, frameCount, decodeId };
  } finally { signal?.removeEventListener('abort', abort); if (child.exitCode === null) child.kill(); }
}
export function pixelDifference(a: Uint8Array, b: Uint8Array): PixelDifference {
  if (a.length !== b.length || a.length % 3 !== 0) throw new Error('RGB24 buffers have different dimensions or channel layouts.');
  let differingPixels = 0, differingChannels = 0, maxAbsoluteDifference = 0, absolute = 0, square = 0;
  for (let i = 0; i < a.length; i += 3) { let different = false; for (let c = 0; c < 3; c++) { const delta = Math.abs(a[i + c] - b[i + c]); if (delta) { differingChannels++; different = true; } maxAbsoluteDifference = Math.max(maxAbsoluteDifference, delta); absolute += delta; square += delta * delta; } if (different) differingPixels++; }
  return { differingPixels, differingChannels, maxAbsoluteDifference, meanAbsoluteDifference: absolute / a.length, rootMeanSquareDifference: Math.sqrt(square / a.length) };
}
export function cameraGeometryMatches(a: CameraTransform | undefined, b: CameraTransform | undefined) {
  if (!a || !b) return false;
  const keys = ['coordinateSpace', 'sourceWidth', 'sourceHeight', 'sourceGridDimensions', 'selectedTileRectangle', 'viewport', 'focalPoint', 'scale', 'translation', 'visibleSourceRectangle'] as const;
  return keys.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}
export async function verifyPngAgainstVideo(tools: VideoTools, png: string, video: string, format: OutputFormat, signal?: AbortSignal) {
  const source = await probeFrameSource(tools, video, format, signal);
  // New child process, no extraction-buffer reuse: video is decoded again.
  const decoded = await decodeDisplayedRgb(tools, video, source.video.width, source.video.height, signal);
  if (decoded.frameCount !== source.video.frames) throw new ExtractionError(400, 'Independent decode frame count differs from the video probe.');
  const pngBytes = await readFile(png), raw = await sharp(pngBytes, { failOn: 'warning' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (raw.info.width !== source.video.width || raw.info.height !== source.video.height || raw.info.channels !== 3) throw new ExtractionError(400, 'Extracted PNG dimensions or RGB channels do not match the video.');
  const difference = pixelDifference(raw.data, decoded.last);
  return { source, decoded, difference, pngFileSha256: sha256(pngBytes), pngRgbSha256: sha256(raw.data), videoRgbSha256: sha256(decoded.last), pngResolution: { width: raw.info.width, height: raw.info.height }, pass: difference.differingPixels === 0 };
}
