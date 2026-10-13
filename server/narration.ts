import path from 'node:path';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError } from './extraction.js';
import { validId } from '../shared/project.js';
import type { ImportedMedia } from '../shared/assembly.js';
import { defaultNarrationScript, validateNarrationScript, type GeneratedNarration, type NarrationScript, type NarrationState } from '../shared/narration.js';

export const speechEndpoint = 'https://api.openai.com/v1/audio/speech';
export const maxSpeechBytes = 64 * 1024 * 1024;
type Importer = (id: string, tileNumber: number, temporary: string, originalName: string, signal?: AbortSignal) => Promise<ImportedMedia>;
interface Options { importAudio: Importer; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }

/**
 * Optional text-to-speech narration. The API key is read from OPENAI_API_KEY at request time and is never
 * stored, logged or returned. Narration text is sent to OpenAI only when a person presses Generate.
 */
export function createNarrationService(dataRoot: string, { importAudio, fetchImpl = fetch, env = process.env }: Options) {
  const file = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.join(dataRoot, 'exports', id, 'metadata', 'narration_script.json'); };
  const keyConfigured = () => !!env.OPENAI_API_KEY?.trim();
  async function saved(id: string): Promise<NarrationScript | null> {
    try { return await readJson<NarrationScript>(file(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async function current(id: string): Promise<NarrationState> { const s = await saved(id); return { script: s || defaultNarrationScript(id), saved: !!s, keyConfigured: keyConfigured() }; }
  async function save(id: string, value: NarrationScript): Promise<NarrationState> {
    const errors = validateNarrationScript(value); if (errors.length) throw new ExtractionError(400, errors.join(' '));
    const next: NarrationScript = { version: 1, module: 'narration', projectId: id, updatedAt: new Date().toISOString(), voice: value.voice, model: value.model, instructions: value.instructions.trim(), tiles: [...value.tiles].sort((a, b) => a.tileNumber - b.tileNumber).map(t => ({ tileNumber: t.tileNumber, text: t.text.trim() })) };
    await atomicJson(file(id), next); return { script: next, saved: true, keyConfigured: keyConfigured() };
  }
  async function synthesize(script: NarrationScript, text: string, signal?: AbortSignal): Promise<Buffer> {
    const key = env.OPENAI_API_KEY?.trim(); if (!key) throw new ExtractionError(503, 'No OpenAI key is configured. Set the OPENAI_API_KEY environment variable and restart the local service.');
    const body: Record<string, unknown> = { model: script.model, voice: script.voice, input: text, response_format: 'wav' };
    if (script.model.startsWith('gpt-4o') && script.instructions) body.instructions = script.instructions;
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
  async function generate(id: string, tileNumbers: number[], signal?: AbortSignal): Promise<GeneratedNarration[]> {
    const script = await saved(id); if (!script) throw new ExtractionError(409, 'Save the narration script before generating audio.');
    if (!tileNumbers.length || tileNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 6) || new Set(tileNumbers).size !== tileNumbers.length) throw new ExtractionError(400, 'Choose between one and six unique tiles.');
    if (!keyConfigured()) throw new ExtractionError(503, 'No OpenAI key is configured. Set the OPENAI_API_KEY environment variable and restart the local service.');
    const folder = path.join(dataRoot, '.uploads'); await mkdir(folder, { recursive: true }); const results: GeneratedNarration[] = [];
    for (const tile of tileNumbers) {
      const text = script.tiles.find(t => t.tileNumber === tile)!.text, temporary = path.join(folder, `${randomUUID()}.wav`);
      try {
        await writeFile(temporary, await synthesize(script, text, signal));
        const media = await importAudio(id, tile, temporary, `tile_${String(tile).padStart(2, '0')}_openai_${script.voice}.wav`, signal);
        results.push({ tileNumber: tile, mediaId: media.id, filename: media.filename, duration: media.duration });
      } finally { await unlink(temporary).catch(() => {}); }
    }
    return results;
  }
  return { current, save, generate, keyConfigured };
}
