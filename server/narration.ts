import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError } from './extraction.js';
import { validId } from '../shared/project.js';
import { detectVideoTools } from './video-tools.js';
import type { ImportedMedia } from '../shared/assembly.js';
import { defaultNarrationScript, deliveryInstructions, validateNarrationScript, voiceRotation, type GeneratedNarration, type NarrationModel, type NarrationScript, type NarrationState, type NarrationVoice, type RotationVoice } from '../shared/narration.js';

export const speechEndpoint = 'https://api.openai.com/v1/audio/speech';
export const maxSpeechBytes = 64 * 1024 * 1024;
type Importer = (id: string, tileNumber: number, temporary: string, originalName: string, signal?: AbortSignal) => Promise<ImportedMedia>;
interface Options { importAudio: Importer; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }
interface RotationFile { version: 1; next: number; history: { voice: RotationVoice; at: string; project: string }[] }

export interface SpeechRequest { apiKey: string | undefined; text: string; voice: NarrationVoice; model: NarrationModel; instructions?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }
/** One text-to-speech call. The key is only used for the Authorization header and is redacted from any error text. */
export async function synthesizeSpeech({ apiKey, text, voice, model, instructions, fetchImpl = fetch, signal }: SpeechRequest): Promise<Buffer> {
  const key = apiKey?.trim(); if (!key) throw new ExtractionError(503, 'No OpenAI key is configured. Set the OPENAI_API_KEY environment variable and restart the local service.');
  const body: Record<string, unknown> = { model, voice, input: text, response_format: 'wav' };
  if (model.startsWith('gpt-4o') && instructions) body.instructions = instructions;
  let response: Response;
  try { response = await fetchImpl(speechEndpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]) }); }
  catch (e) { throw new ExtractionError(502, `Could not reach the speech service: ${(e as Error).message}`); }
  if (!response.ok) {
    let detail = ''; try { detail = String((await response.json() as { error?: { message?: string } }).error?.message || ''); } catch { /* No JSON body. */ }
    throw new ExtractionError(response.status === 401 ? 401 : 502, `Speech service refused the request (${response.status})${detail ? `: ${detail.replaceAll(key, '[key]').slice(0, 300)}` : '.'}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length || bytes.length > maxSpeechBytes) throw new ExtractionError(502, 'Speech service returned an empty or oversized audio file.');
  return bytes;
}

/** Target loudness for narration: standard for spoken word on phones and social video. */
export const targetLufs = -16;
/**
 * Brings a speech clip to the target integrated loudness with a single, constant gain, so the voice's own pitch and level
 * modulation is untouched (unlike dynamic normalisers). A limiter only guards the peaks. Clips arrive at about -29 LUFS.
 */
export function normalizeLoudness(wav: Buffer, ffmpeg: string, target = targetLufs): { audio: Buffer; beforeLufs: number; gainDb: number } {
  const dir = path.join(tmpdir(), 'sixframe-loudness-' + randomUUID()), input = path.join(dir, 'in.wav'), output = path.join(dir, 'out.wav');
  try {
    mkdirSync(dir, { recursive: true }); writeFileSync(input, wav);
    const measured = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', input, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
    const summary = measured.slice(measured.lastIndexOf('Summary')), match = summary.match(/I:\s+(-?[0-9.]+) LUFS/);
    if (!match) throw new Error('Could not measure the loudness of the speech clip.');
    const beforeLufs = Number(match[1]), gainDb = Math.max(-20, Math.min(30, target - beforeLufs));
    const run = spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', input, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.89:level=disabled`, '-c:a', 'pcm_s16le', output], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error('Loudness normalisation failed: ' + String(run.stderr).slice(0, 200));
    return { audio: readFileSync(output), beforeLufs, gainDb };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Round-robin over the four pool voices, one turn per video created. The position is stored in data/narration_rotation.json
 * and only advances when a generation actually produced audio, so a failed attempt does not burn a voice.
 */
export function createVoiceRotation(dataRoot: string) {
  const file = path.join(dataRoot, 'narration_rotation.json');
  async function read(): Promise<RotationFile> {
    try { const r = await readJson<RotationFile>(file); return r?.version === 1 && Number.isInteger(r.next) ? r : { version: 1, next: 0, history: [] }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, next: 0, history: [] }; throw e; }
  }
  const voiceAt = (n: number): RotationVoice => voiceRotation[((n % voiceRotation.length) + voiceRotation.length) % voiceRotation.length];
  return {
    /** The voice the next video will use; does not advance. */
    async peek(): Promise<RotationVoice> { return voiceAt((await read()).next); },
    /** Record that `voice` was used for a video; the next video gets the following voice. */
    async commit(voice: RotationVoice, project: string): Promise<void> {
      const state = await read(), index = voiceRotation.indexOf(voice);
      await atomicJson(file, { version: 1, next: (index + 1) % voiceRotation.length, history: [...state.history, { voice, at: new Date().toISOString(), project }].slice(-50) } satisfies RotationFile);
    },
  };
}

/**
 * Optional text-to-speech narration. The API key is read from OPENAI_API_KEY at request time and is never
 * stored, logged or returned. Narration text is sent to OpenAI only when a person presses Generate.
 */
export function createNarrationService(dataRoot: string, { importAudio, fetchImpl = fetch, env = process.env }: Options) {
  const file = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.join(dataRoot, 'exports', id, 'metadata', 'narration_script.json'); };
  const rotation = createVoiceRotation(dataRoot), keyConfigured = () => !!env.OPENAI_API_KEY?.trim();
  async function saved(id: string): Promise<NarrationScript | null> {
    try { return await readJson<NarrationScript>(file(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async function current(id: string): Promise<NarrationState> { const s = await saved(id); return { script: s || defaultNarrationScript(id), saved: !!s, keyConfigured: keyConfigured(), nextVoice: await rotation.peek() }; }
  async function save(id: string, value: NarrationScript): Promise<NarrationState> {
    const errors = validateNarrationScript(value); if (errors.length) throw new ExtractionError(400, errors.join(' '));
    const next: NarrationScript = { version: 1, module: 'narration', projectId: id, updatedAt: new Date().toISOString(), voice: value.voice, model: value.model, instructions: value.instructions.trim(), tiles: [...value.tiles].sort((a, b) => a.tileNumber - b.tileNumber).map(t => ({ tileNumber: t.tileNumber, text: t.text.trim() })), ...(value.assignedVoice ? { assignedVoice: value.assignedVoice } : {}) };
    await atomicJson(file(id), next); return { script: next, saved: true, keyConfigured: keyConfigured(), nextVoice: await rotation.peek() };
  }
  async function generate(id: string, tileNumbers: number[], signal?: AbortSignal): Promise<GeneratedNarration[]> {
    const script = await saved(id); if (!script) throw new ExtractionError(409, 'Save the narration script before generating audio.');
    if (!tileNumbers.length || tileNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 6) || new Set(tileNumbers).size !== tileNumbers.length) throw new ExtractionError(400, 'Choose between one and six unique tiles.');
    if (!keyConfigured()) throw new ExtractionError(503, 'No OpenAI key is configured. Set the OPENAI_API_KEY environment variable and restart the local service.');
    // Voice for this video. A full run of six takes the next voice in the rotation; a single re-take keeps the project's voice.
    const fullRun = tileNumbers.length === 6; let voice: NarrationVoice, takesTurn = false;
    if (script.voice !== 'auto') voice = script.voice;
    else if (fullRun || !script.assignedVoice) { voice = await rotation.peek(); takesTurn = true; }
    else voice = script.assignedVoice;
    const folder = path.join(dataRoot, '.uploads'); await mkdir(folder, { recursive: true }); const results: GeneratedNarration[] = [];
    for (const tile of tileNumbers) {
      const index = script.tiles.findIndex(t => t.tileNumber === tile), text = script.tiles[index].text, temporary = path.join(folder, `${randomUUID()}.wav`);
      try {
        const audio = await synthesizeSpeech({ apiKey: env.OPENAI_API_KEY, text, voice, model: script.model, instructions: deliveryInstructions(voice, script.instructions, index, script.tiles.length), fetchImpl, signal });
        // Loudness is brought to the target before import. If it cannot be measured (for example the file is not decodable),
        // the clip goes on unchanged and the importer's own decode check decides whether it is usable.
        const tools = await detectVideoTools(); let ready = audio;
        if (tools.available && tools.ffmpeg) { try { ready = normalizeLoudness(audio, tools.ffmpeg).audio; } catch { /* keep the raw clip */ } }
        await writeFile(temporary, ready);
        const media = await importAudio(id, tile, temporary, `tile_${String(tile).padStart(2, '0')}_openai_${voice}.wav`, signal);
        results.push({ tileNumber: tile, mediaId: media.id, filename: media.filename, duration: media.duration, voice });
        if (takesTurn && results.length === 1) { // first clip succeeded: this video now owns the turn
          takesTurn = false; if ((voiceRotation as readonly string[]).includes(voice)) await rotation.commit(voice as RotationVoice, id);
          await atomicJson(file(id), { ...script, assignedVoice: voice });
        }
      } finally { await unlink(temporary).catch(() => {}); }
    }
    return results;
  }
  return { current, save, generate, keyConfigured };
}
