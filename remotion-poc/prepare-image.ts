// Photo in -> assets out. Detects the six panels automatically, upscales the photo for a sharper camera move, copies the
// narration (and measures its loudness per frame), and makes the character loop clip for every tile.
// Usage (from the project root):
//   npx tsx remotion-poc/prepare-image.ts --image <photo> --audio <dir of tile_0N_*.wav> --out remotion-poc/public-mobile --format mobile
//     [--title "A Calm Evening"] [--lines lines.json] [--loops <dir of tile_0N*.mp4>]
// Loops: pass --loops with real clips (for example from Gemini) and they are cropped to the card and used as they are.
// Without --loops a clearly labelled placeholder is generated: a seamless breathing drift of the tile, not real acting.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import { detectLayout } from '../server/detection.js';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const need = (k: string) => { const v = args.get(k); if (!v) throw new Error(`Missing --${k}`); return v; };
const image = path.resolve(need('image')), audioDir = path.resolve(need('audio')), out = path.resolve(need('out')), format = (args.get('format') || 'mobile') as 'mobile' | 'desktop', title = args.get('title') || 'A Calm Evening';
const scale = Number(args.get('upscale') || 2.5), ffprobe = process.env.FFPROBE || 'ffprobe', ffmpeg = process.env.FFMPEG || 'ffmpeg', loopsDir = args.get('loops') ? path.resolve(args.get('loops')!) : null;
const lines: string[] = args.has('lines') ? JSON.parse(readFileSync(path.resolve(args.get('lines')!), 'utf8')) : [
  'After a long day, he finally sits down. The house is quiet, and for the first time in hours, nobody needs anything from him.',
  'He walks to the window and lets his shoulders drop. The light outside is soft, and the tension he has carried all day begins to ease.',
  'At his desk, he pours a cup of tea and opens his notebook. Writing things down makes them feel a little lighter.',
  'His phone buzzes, and he almost reaches for it. Instead, he puts it down. Whatever it is can wait until tomorrow.',
  'In the kitchen, he fills a glass of water slowly. A small, kind thing to do for himself, and it feels like enough.',
  'On the balcony, the evening settles over the city. He takes one long breath, and lets the day go.',
];
if (lines.length !== 6) throw new Error('Provide exactly six transcript lines.');
if (!existsSync(image) || !existsSync(audioDir)) throw new Error('Image or audio folder not found.');
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const buffer = readFileSync(image), detected = await detectLayout(buffer);
console.log(`layout ${detected.layout}, confidence ${detected.detection.confidence}, source ${detected.width}x${detected.height}`);
if (detected.panels.length !== 6) throw new Error('Expected six panels.');

mkdirSync(path.join(out, 'audio'), { recursive: true }); mkdirSync(path.join(out, 'loops'), { recursive: true });
const gridWidth = Math.round(detected.width * scale), gridHeight = Math.round(detected.height * scale), gridFile = path.join(out, 'photo_grid.png');
await sharp(buffer).rotate().resize(gridWidth, gridHeight, { kernel: 'lanczos3' }).png().toFile(gridFile);
const cells = detected.panels.map(p => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale), width: Math.round(p.width * scale), height: Math.round(p.height * scale) }));

// Card size: identical to the composition (one card for every tile, from the average artwork shape).
const area = format === 'mobile' ? { w: 960, h: 900 } : { w: 1080, h: 912 };
const aspect = cells.reduce((a, c) => a + c.width / c.height, 0) / cells.length;
const card = { width: even(Math.min(area.w, Math.round(area.h * aspect))), height: area.h };

const wavs = readdirSync(audioDir).filter(f => /^tile_0[1-6]_.*\.wav$/i.test(f)).sort();
if (wavs.length !== 6) throw new Error(`Expected six tile_0N_*.wav files, found ${wavs.length}.`);
const realLoops = loopsDir ? readdirSync(loopsDir).filter(f => /^tile_0[1-6].*\.(mp4|mov|webm)$/i.test(f)).sort() : [];
const frameCount = (file: string) => Number(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim());
/** Narration loudness per video frame (RMS, normalised to the loudest frame). */
function levelsFor(wav: string) {
  const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', wav, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 }), per = Math.round(8000 / 30), frames = Math.floor(pcm.length / 2 / per), rms: number[] = [];
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < per; i++) { const v = pcm.readInt16LE((f * per + i) * 2) / 32768; s += v * v; } rms.push(Math.sqrt(s / per)); }
  const peak = Math.max(...rms, 1e-6); return rms.map(v => Math.round(Math.min(1, v / peak) * 1000) / 1000);
}

const tiles = [];
for (const [i, file] of wavs.entries()) {
  const n = i + 1, c = cells[i], wav = path.join(audioDir, file), loop = path.join(out, 'loops', `tile_0${n}.mp4`), still = path.join(out, 'loops', `tile_0${n}_still.png`);
  copyFileSync(wav, path.join(out, 'audio', `tile_0${n}.wav`));
  const seconds = Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
  // The still the composition shows when the camera has settled: the cell, cover-fitted to the card.
  await sharp(gridFile).extract({ left: c.x, top: c.y, width: Math.min(c.width, gridWidth - c.x), height: Math.min(c.height, gridHeight - c.y) })
    .resize(card.width, card.height, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).png().toFile(still);
  const real = realLoops.find(f => f.startsWith(`tile_0${n}`));
  if (real) {
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', path.join(loopsDir!, real), '-vf', `scale=${card.width}:${card.height}:force_original_aspect_ratio=increase,crop=${card.width}:${card.height},fps=30,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '16', '-movflags', '+faststart', loop]);
  } else {
    // Placeholder: seamless 4 s breathing drift. Zoom and sway are exactly zero at frame 0, so frame 0 equals the still.
    const z = `1+0.035*(1-cos(2*PI*on/120))/2`, sx = `iw/2-(iw/zoom/2)+${(card.width * 0.012).toFixed(2)}*sin(2*PI*on/120)`, sy = `ih/2-(ih/zoom/2)-${(card.height * 0.010).toFixed(2)}*(1-cos(2*PI*on/120))/2`;
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-loop', '1', '-i', still, '-vf', `scale=iw*2:ih*2:flags=lanczos,zoompan=z='${z}':x='${sx}':y='${sy}':d=1:s=${card.width}x${card.height}:fps=30,format=yuv420p`,
      '-frames:v', '120', '-an', '-c:v', 'libx264', '-crf', '16', '-movflags', '+faststart', loop]);
  }
  tiles.push({
    number: n, text: lines[i], audio: `audio/tile_0${n}.wav`, image: '', seconds, tileWidth: c.width, tileHeight: c.height, art: { x: 0, y: 0, width: c.width, height: c.height },
    loop: { src: `loops/tile_0${n}.mp4`, frames: frameCount(loop), placeholder: !real }, levels: levelsFor(wav),
  });
}
writeFileSync(path.join(out, 'data.json'), JSON.stringify({ title, format, card, grid: 'photo_grid.png', gridWidth, gridHeight, cells, tiles }));
console.log('prepared', format, `grid ${gridWidth}x${gridHeight}`, `card ${card.width}x${card.height}`, 'loops', tiles.map(t => `${t.loop.frames}f${t.loop.placeholder ? '(placeholder)' : ''}`).join(' '), 'audio', tiles.reduce((a, t) => a + t.seconds, 0).toFixed(1), 's');
