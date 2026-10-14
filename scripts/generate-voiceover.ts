// Generates the six narration clips with OpenAI text-to-speech and takes the next voice in the four-voice rotation
// (coral → nova → shimmer → sage → coral …), one voice per video. Output feeds remotion-poc/prepare-image.ts --audio.
// Usage: npx tsx scripts/generate-voiceover.ts --out <dir> [--lines lines.json] [--voice auto|coral|nova|shimmer|sage|…]
//          [--model gpt-4o-mini-tts] [--instructions "Warm, empathetic Indian English female narrator."] [--project label] [--dry-run]
import '../server/load-env.js';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { createVoiceRotation, normalizeLoudness, synthesizeSpeech, targetLufs } from '../server/narration.js';
import { detectVideoTools } from '../server/video-tools.js';
import { defaultNarrationLines, deliveryInstructions, narrationModels, narrationVoices, voiceRotation, type NarrationModel, type NarrationVoice } from '../shared/narration.js';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[++i]); }
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'data'), out = path.resolve(args.get('out') || 'voiceover');
const tools = await detectVideoTools(); if (!tools.available || !tools.ffmpeg) throw new Error('FFmpeg is required for loudness normalisation.');
// Fix clips that already exist (no API call, no cost): raw copies are kept in <dir>/raw, normalised clips replace them.
if (args.has('normalize-only')) {
  const dir = path.resolve(args.get('normalize-only')!), raw = path.join(dir, 'raw'); await mkdir(raw, { recursive: true });
  for (const name of (await readdir(dir)).filter(n => /^tile_0[1-6].*\.wav$/i.test(n)).sort()) {
    const source = await readFile(path.join(dir, name)), fixed = normalizeLoudness(source, tools.ffmpeg, targetLufs);
    await writeFile(path.join(raw, name), source); await writeFile(path.join(dir, name), fixed.audio);
    console.log(`${name}: ${fixed.beforeLufs.toFixed(1)} LUFS -> ${targetLufs} LUFS (gain ${fixed.gainDb >= 0 ? '+' : ''}${fixed.gainDb.toFixed(1)} dB)`);
  }
  process.exit(0);
}
const lines: string[] = args.has('lines') ? JSON.parse(await readFile(path.resolve(args.get('lines')!), 'utf8')) : defaultNarrationLines;
if (lines.length !== 6 || lines.some(l => typeof l !== 'string' || !l.trim())) throw new Error('Provide exactly six non-empty transcript lines.');
const model = (args.get('model') || 'gpt-4o-mini-tts') as NarrationModel; if (!(narrationModels as readonly string[]).includes(model)) throw new Error(`Unsupported model: ${model}`);
const base = args.get('instructions') ?? 'Warm, empathetic Indian English female narrator.';
const rotation = createVoiceRotation(root), requested = args.get('voice') || 'auto';
if (requested !== 'auto' && !(narrationVoices as readonly string[]).includes(requested)) throw new Error(`Unsupported voice: ${requested}`);
const voice = (requested === 'auto' ? await rotation.peek() : requested) as NarrationVoice;
const plan = lines.map((text, i) => ({ tile: i + 1, text, instructions: deliveryInstructions(voice, base, i, lines.length) }));
console.log(`voice: ${voice}${requested === 'auto' ? ` (rotation turn; pool ${voiceRotation.join(' → ')})` : ' (fixed)'} · model ${model}`);
if (args.get('dry-run') === 'true') { for (const p of plan) console.log(`tile ${p.tile}: ${p.instructions}`); process.exit(0); }

await mkdir(out, { recursive: true }); const files: string[] = [];
for (const p of plan) {
  const spoken = await synthesizeSpeech({ apiKey: process.env.OPENAI_API_KEY, text: p.text, voice, model, instructions: p.instructions });
  const audio = normalizeLoudness(spoken, tools.ffmpeg, targetLufs).audio; // constant gain to the narration target; dynamics untouched
  const file = path.join(out, `tile_0${p.tile}_openai_${voice}.wav`); await writeFile(file, audio); files.push(file);
  if (p.tile === 1 && requested === 'auto') await rotation.commit(voice as (typeof voiceRotation)[number], args.get('project') || 'cli'); // the first clip worked: this video owns the turn
  console.log(`tile ${p.tile}: ${(audio.length / 1024).toFixed(0)} KB -> ${path.basename(file)}`);
}
await writeFile(path.join(out, 'voiceover.json'), JSON.stringify({ voice, model, instructions: plan.map(p => p.instructions), lines, generatedAt: new Date().toISOString() }, null, 2));
console.log('next voice in rotation:', await rotation.peek());
