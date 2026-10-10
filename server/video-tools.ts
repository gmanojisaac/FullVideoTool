import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VideoProbe, VideoTools } from '../shared/animation.js';

export async function captureProcess(command: string, args: string[], signal?: AbortSignal, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let count = 0, stderr = '', failure: Error | undefined;
    const abort = () => { failure = new Error('Render cancelled.'); child.kill(); };
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stdout.on('data', (b: Buffer) => { count += b.length; if (count > maxBytes) { failure = new Error('Process output exceeded its limit.'); child.kill(); } else chunks.push(b); });
    child.stderr.on('data', b => { stderr = (stderr + String(b)).slice(-8000); });
    child.on('error', error => { failure = error; });
    child.on('close', code => { signal?.removeEventListener('abort', abort); if (failure || code !== 0) reject(failure ?? new Error(`Video tool exited ${code}: ${stderr}`)); else resolve(Buffer.concat(chunks)); });
  });
}
export async function detectVideoTools(): Promise<VideoTools> {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  async function locate(name: 'ffmpeg' | 'ffprobe', override?: string) {
    const candidates = override ? [override] : [name, path.join(projectRoot, '.tools', 'ffmpeg', 'bin', name + (process.platform === 'win32' ? '.exe' : ''))];
    for (const filename of candidates) try { const version = (await captureProcess(filename, ['-version'], AbortSignal.timeout(5000), 128 * 1024)).toString().split(/\r?\n/)[0]; return { filename, version }; } catch { /* next installed location */ }
    return { filename: null, version: null };
  }
  const [ffmpeg, ffprobe] = await Promise.all([locate('ffmpeg', process.env.FFMPEG_PATH), locate('ffprobe', process.env.FFPROBE_PATH)]);
  return { available: !!ffmpeg.filename && !!ffprobe.filename, ffmpeg: ffmpeg.filename, ffprobe: ffprobe.filename, ffmpegVersion: ffmpeg.version, ffprobeVersion: ffprobe.version,
    instructions: 'Install FFmpeg and FFprobe on PATH, place both executables in .tools/ffmpeg/bin, or set FFMPEG_PATH and FFPROBE_PATH to their absolute executable paths. Restart the local service and retry.' };
}
export async function probeVideo(ffprobe: string, filename: string, signal?: AbortSignal): Promise<VideoProbe> {
  const result = JSON.parse((await captureProcess(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', filename], signal, 1024 * 1024)).toString());
  const v = result.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!v) throw new Error('Rendered MP4 has no video stream.');
  return { width: v.width, height: v.height, codec: v.codec_name, pixelFormat: v.pix_fmt, frameRate: v.r_frame_rate, averageFrameRate: v.avg_frame_rate,
    frames: Number(v.nb_read_frames), duration: Number(v.duration ?? result.format.duration), audioStreams: result.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio').length };
}
