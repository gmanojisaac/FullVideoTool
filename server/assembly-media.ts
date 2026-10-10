import path from 'node:path';
import { mkdir, rename, unlink, stat, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { captureProcess, detectVideoTools } from './video-tools.js';
import { hashFile } from './export-zip.js';
import { ExtractionError } from './extraction.js';
import { validId } from '../shared/project.js';
import type { AssemblyMedia, ImportedMedia } from '../shared/assembly.js';
import type { OutputFormat } from '../shared/layout.js';

export const assemblyRoot = (dataRoot: string, id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.resolve(dataRoot, 'exports', id, 'assembly'); };
export function normalizeVideoFilter(width: number, height: number) { return `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bicubic:out_color_matrix=bt709:out_range=tv,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x2b2b2b,setsar=1,fps=30`; }
export async function probeImportedMedia(filename: string, signal?: AbortSignal) {
  const tools = await detectVideoTools(); if (!tools.available) throw new ExtractionError(503, tools.instructions);
  const data = JSON.parse((await captureProcess(tools.ffprobe!, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], signal, 2 * 1024 * 1024)).toString());
  return { tools, data, video: data.streams.find((s: { codec_type: string }) => s.codec_type === 'video'), audio: data.streams.find((s: { codec_type: string }) => s.codec_type === 'audio') };
}
export function createAssemblyMedia(dataRoot: string) {
  const busy = new Set<string>();
  const indexFile = (id: string) => path.join(assemblyRoot(dataRoot, id), 'media_index.json');
  async function current(id: string): Promise<AssemblyMedia> { try { return await readJson(indexFile(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projectId: id, videos: [], audio: [] }; throw e; } }
  async function importFile(id: string, kind: 'video' | 'audio', tileNumber: number, format: OutputFormat | undefined, temporary: string, original: string, signal?: AbortSignal): Promise<ImportedMedia> {
    if (busy.has(id)) throw new ExtractionError(409, 'Media processing is already running. Retry after it finishes.');
    if (!Number.isInteger(tileNumber) || tileNumber < 1 || tileNumber > 6 || !['video', 'audio'].includes(kind) || (kind === 'video' && format !== 'mobile' && format !== 'desktop')) throw new ExtractionError(400, 'Choose a valid media type, format and tile.');
    busy.add(id); let directory = '';
    try {
      const extension = path.extname(original).toLowerCase(); if (!(kind === 'video' ? ['.mp4','.mov','.webm'] : ['.mp3','.wav','.m4a','.aac']).includes(extension)) throw new ExtractionError(415, kind === 'video' ? 'Upload MP4, MOV or WebM video.' : 'Upload MP3, WAV, M4A or AAC narration.');
      const inspected = await probeImportedMedia(temporary, signal), { tools, data, video, audio } = inspected, duration = Number((kind === 'video' ? video : audio)?.duration || data.format?.duration);
      const containers=String(data.format?.format_name||'').split(','), allowed:Record<string,string[]>={'.mp4':['mov','mp4'],'.mov':['mov','mp4'],'.webm':['webm'],'.mp3':['mp3'],'.wav':['wav'],'.m4a':['mov','mp4','m4a'],'.aac':['aac']};
      if(!allowed[extension].some(n=>containers.includes(n))||(extension==='.webm'&&!['vp8','vp9','av1'].includes(video?.codec_name)))throw new ExtractionError(415,'The media container does not match its supported filename extension.');
      if (!Number.isFinite(duration) || duration < 2 / 30 || duration > 600 || (kind === 'video' && (!video || video.width * video.height > 8_500_000)) || (kind === 'audio' && (!audio || video))) throw new ExtractionError(400, 'Unreadable media, unsupported dimensions, or duration outside 0.067–600 seconds. Audio files must contain only narration audio.');
      const run = randomUUID(), filename = path.basename(original).slice(0, 255); directory = path.join(assemblyRoot(dataRoot, id), 'media', run); await mkdir(directory, { recursive: true }); const stored = path.join(directory, 'original' + extension);
      await captureProcess(tools.ffmpeg!, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-threads', '1', '-i', temporary, '-map', kind === 'video' ? '0:v:0' : '0:a:0', ...(kind === 'video' ? ['-an'] : ['-vn']), '-f', 'null', '-'], signal, 1024);
      await rename(temporary, stored); const fileStat = await stat(stored), baseUrl = `/api/projects/${id}/assembly/media/${run}`;
      const result: ImportedMedia = { version: 1, id: run, projectId: id, tileNumber, ...(kind === 'video' ? { format } : {}), kind, filename, relativePath: `media/${run}/original${extension}`, sha256: await hashFile(stored, signal), bytes: fileStat.size, importedAt: new Date().toISOString(), codec: String((kind === 'video' ? video : audio).codec_name), duration, ...(video ? { width: video.width, height: video.height, frameRate: video.avg_frame_rate } : {}), audioStreams: data.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio').length, downloadUrl: baseUrl + '?download=1', playbackUrl: baseUrl };
      if (kind === 'audio') {
        const raw = path.join(directory, 'narration_48k_stereo.s16le'); await captureProcess(tools.ffmpeg!, ['-y', '-v', 'error', '-xerror', '-threads', '1', '-i', stored, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 's16le', raw], signal, 1024);
        const samples = (await stat(raw)).size / 4; if (!Number.isSafeInteger(samples) || samples <= 0) throw new ExtractionError(400, 'Narration decoded to an invalid sample count.'); let peak = 0;
        for await (const chunk of createReadStream(raw, { highWaterMark: 65536, signal })) for (let i = 0; i < chunk.length; i += 2) peak = Math.max(peak, Math.abs(chunk.readInt16LE(i)) / 32768);
        Object.assign(result, { normalizedAudioPath: `media/${run}/narration_48k_stereo.s16le`, normalizedAudioSha256: await hashFile(raw, signal), audioSamples: samples, duration: samples / 48000, sampleRate: 48000, channels: 2, peakAmplitude: peak });
      }
      await atomicJson(path.join(directory, 'media.json'), result); const index = await current(id); if (kind === 'audio') index.audio = index.audio.filter(a => a.tileNumber !== tileNumber).concat(result); else index.videos = index.videos.filter(v => v.format !== format || v.tileNumber !== tileNumber).concat(result); await atomicJson(indexFile(id), index); return result;
    } catch (e) { await unlink(temporary).catch(() => {}); if (directory && path.resolve(directory).startsWith(path.join(assemblyRoot(dataRoot, id), 'media') + path.sep)) await rm(directory, { recursive: true, force: true }); if (e instanceof ExtractionError) throw e; throw new ExtractionError(400, `Media could not be decoded: ${(e as Error).message}`); }
    finally { busy.delete(id); }
  }
  async function remove(id: string, kind: string, tile: number, format?: string) { if (busy.has(id)) throw new ExtractionError(409, 'Wait for media processing.'); const index = await current(id); if (kind === 'audio') index.audio = index.audio.filter(a => a.tileNumber !== tile); else if (kind === 'video') index.videos = index.videos.filter(v => v.tileNumber !== tile || v.format !== format); else throw new ExtractionError(400, 'Invalid media type.'); await atomicJson(indexFile(id), index); return index; }
  async function file(id: string, mediaId: string) { if (!validId(mediaId)) throw new ExtractionError(400, 'Invalid imported media ID.'); const directory = path.join(assemblyRoot(dataRoot, id), 'media', mediaId); let item: ImportedMedia; try { item = await readJson(path.join(directory, 'media.json')); } catch { throw new ExtractionError(404, 'Imported media not found.'); } if (item.projectId !== id || item.id !== mediaId || !/^media\/[0-9a-f-]+\/original\.(mp4|mov|webm|mp3|wav|m4a|aac)$/.test(item.relativePath)) throw new ExtractionError(400, 'Invalid imported media path.'); return { item, filename: path.join(assemblyRoot(dataRoot, id), item.relativePath) }; }
  return { current, importFile, remove, file, isRunning: (id?: string) => id ? busy.has(id) : busy.size > 0 };
}
