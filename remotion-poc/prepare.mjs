// Copies the inputs the composition needs into public/ and writes public/data.json.
// Inputs: the six extracted tiles and desktop grid (from an export ZIP), six narration WAVs, and the transcript lines.
// Usage: node prepare.mjs [--zip <export.zip>] [--audio <dir>] [--lines <lines.json>] [--title "A Calm Evening"]
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const args = new Map(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const zip = path.resolve(args.get('zip') || path.join(root, 'output', 'Calm-Evening-Demo_complete.zip'));
const audioDir = path.resolve(args.get('audio') || path.join(root, 'output', 'inputs_used', 'narration'));
const title = args.get('title') || 'A Calm Evening';
const lines = args.has('lines') ? JSON.parse(readFileSync(path.resolve(args.get('lines')), 'utf8')) : [
  'After a long day, he finally sits down. The house is quiet, and for the first time in hours, nobody needs anything from him.',
  'He walks to the window and lets his shoulders drop. The light outside is soft, and the tension he has carried all day begins to ease.',
  'At his desk, he pours a cup of tea and opens his notebook. Writing things down makes them feel a little lighter.',
  'His phone buzzes, and he almost reaches for it. Instead, he puts it down. Whatever it is can wait until tomorrow.',
  'In the kitchen, he fills a glass of water slowly. A small, kind thing to do for himself, and it feels like enough.',
  'On the balcony, the evening settles over the city. He takes one long breath, and lets the day go.',
];
if (lines.length !== 6) throw new Error('Provide exactly six transcript lines.');
for (const p of [zip, audioDir]) if (!existsSync(p)) throw new Error(`Missing input: ${p}`);

const pub = path.join(here, 'public'); mkdirSync(path.join(pub, 'tiles'), { recursive: true }); mkdirSync(path.join(pub, 'audio'), { recursive: true });
// unzip only what we need (the tiles and the desktop grid)
execFileSync('unzip', ['-o', '-j', '-q', zip, 'six_tile_lesson_export/extracted_tiles/*', '-d', path.join(pub, 'tiles')]);
execFileSync('unzip', ['-o', '-j', '-q', zip, 'six_tile_lesson_export/desktop/full_grid.png', '-d', pub]);
const ffprobe = process.env.FFPROBE || 'ffprobe';
const wavs = readdirSync(audioDir).filter(f => /^tile_0[1-6]_.*\.wav$/i.test(f)).sort();
if (wavs.length !== 6) throw new Error(`Expected six tile_0N_*.wav files in ${audioDir}, found ${wavs.length}.`);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const sharp = createRequire(path.join(root, 'package.json'))('sharp');
/** Automatic crop: trims the dark margin around the artwork inside a tile PNG (sharp trim). Falls back to the whole tile. */
async function cropFor(png, tileWidth, tileHeight) {
  const whole = { x: 0, y: 0, width: tileWidth, height: tileHeight };
  try {
    const { info } = await sharp(png).flatten({ background: '#2b2b2b' }).trim({ background: '#2b2b2b', threshold: 28 }).toBuffer({ resolveWithObject: true });
    const crop = { x: -(info.trimOffsetLeft || 0), y: -(info.trimOffsetTop || 0), width: info.width, height: info.height };
    // Trust the crop only when it is a sensible trim: at least 60% of each side is kept.
    return crop.width >= tileWidth * .6 && crop.height >= tileHeight * .6 ? crop : whole;
  } catch { return whole; }
}
const tiles = [];
for (const [i, file] of wavs.entries()) {
  copyFileSync(path.join(audioDir, file), path.join(pub, 'audio', `tile_0${i + 1}.wav`));
  const seconds = Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(audioDir, file)]).toString().trim());
  const png = path.join(pub, 'tiles', `tile_0${i + 1}.png`);
  const [tileWidth, tileHeight] = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', png]).toString().trim().split('x').map(Number);
  tiles.push({ number: i + 1, text: lines[i], audio: `audio/tile_0${i + 1}.wav`, image: `tiles/tile_0${i + 1}.png`, seconds, tileWidth, tileHeight, art: await cropFor(png, tileWidth, tileHeight) });
}
writeFileSync(path.join(pub, 'data.json'), JSON.stringify({ title, grid: 'full_grid.png', gridWidth: 1920, gridHeight: 1080, cells: [[0, 0], [644, 0], [1288, 0], [0, 546], [644, 546], [1288, 546]].map(([x, y]) => ({ x, y, width: 632, height: 534 })), tiles }, null, 2));
console.log('prepared', tiles.map(t => `${t.number}:${t.seconds.toFixed(1)}s`).join(' '), 'total', tiles.reduce((a, t) => a + t.seconds, 0).toFixed(1), 's');
