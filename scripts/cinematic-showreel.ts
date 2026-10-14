// Renders every cinematic preset on one tile and joins them into a captioned reel for visual review.
// Usage: tsx scripts/cinematic-showreel.ts --format desktop --tile 3 --out <dir> [--project <id>] [--presets a,b] [--zoom-frames 54]
import path from 'node:path';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cinematicPresetNames, cinematicPresets, type CinematicPresetName } from '../shared/cinematic.js';
import { landingFor, outputFrameCount, renderCinematicClip } from '../server/cinematic-render.js';
import { detectVideoTools } from '../server/video-tools.js';

const args = new Map<string, string>(); for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const format = (args.get('format') || 'desktop') as 'mobile' | 'desktop', tileNumber = Number(args.get('tile') || 3), zoomFrames = Number(args.get('zoom-frames') || 54);
const out = path.resolve(args.get('out') || 'showreel'), root = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'data', 'exports');
const names = (args.get('presets')?.split(',') || cinematicPresetNames) as CinematicPresetName[];
const project = args.get('project') || (await readdir(root))[0], base = path.join(root, project);
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const latest = async (reference: string, folder: string) => (await json(path.join(base, folder, (await json(path.join(base, reference))).id + '.json'))).manifest;

const focus = await json(path.join(base, 'metadata', 'focus_config.json')), animation = await latest('latest-full-animation.json', 'animation-jobs'), layout = await latest('latest-layout.json', 'layout-jobs');
const view = focus.views.find((v: { format: string; tileNumber: number }) => v.format === format && v.tileNumber === tileNumber), t = view.nativeTransform;
const classic = animation.videos.find((v: { format: string; tileNumber: number; kind: string }) => v.format === format && v.tileNumber === tileNumber && v.kind === 'in');
const grid = layout.outputs[format], dimensions = format === 'mobile' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const tools = await detectVideoTools(); if (!tools.available) throw new Error(tools.instructions);
await mkdir(out, { recursive: true });
const controller = new AbortController(), clips: string[] = [];
for (const name of names) {
  const preset = cinematicPresets[name], file = path.join(out, `${String(clips.length + 1).padStart(2, '0')}_${name}.mp4`), started = Date.now();
  const task = {
    ffmpeg: tools.ffmpeg!, gridFile: path.join(base, 'layout-runs', layout.generationId, 'layouts', grid.filename), classicClip: path.join(base, 'animation-runs', animation.renderId, classic.relativePath), output: file,
    gridWidth: t.sourceWidth, gridHeight: t.sourceHeight, tile: t.selectedTileRectangle, dimensions, background: t.paddingColor, direction: 'in' as const,
    zoomFrames, classicZoomFrames: 36, totalFrames: classic.frameCount, endScale: t.scale, endFocal: t.focalPoint, settings: preset.settings, caption: preset.label, landing: landingFor(view, Math.round(animation.settings.global.detailHandoff * 30)),
  };
  await renderCinematicClip(task, controller.signal);
  clips.push(file); console.log(`${name}: ${outputFrameCount(task)} frames in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
const list = path.join(out, 'reel.txt'); await writeFile(list, clips.map(c => `file '${path.basename(c)}'`).join('\n') + '\n');
const reel = path.join(out, `showreel_${format}_tile${tileNumber}.mp4`);
await new Promise<void>((resolve, reject) => { const c = spawn(tools.ffmpeg!, ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', list, '-c', 'copy', reel]); c.on('close', code => code === 0 ? resolve() : reject(new Error(`concat exited ${code}`))); });
console.log('reel:', reel, (await stat(reel)).size, 'bytes');
