import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { adaptiveSamples, cinematicLandingPose, cinematicPose, shutterProgress, type CinematicPose, type CinematicSettings, type CinematicTarget } from '../shared/cinematic.js';
import { textBrowserPath } from './text-render.js';
import type { CameraTransform } from '../shared/focus.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
let bundle: Promise<string> | undefined;
function browserBundle() {
  bundle ??= build({ entryPoints: [path.join(projectRoot, 'server', 'cinematic-browser.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true })
    .then(r => r.outputFiles[0].text).catch(e => { bundle = undefined; throw e; });
  return bundle;
}

export interface CinematicClipTask {
  ffmpeg: string; gridFile: string; classicClip: string; output: string;
  gridWidth: number; gridHeight: number; tile: { x: number; y: number; width: number; height: number };
  dimensions: { width: number; height: number }; background: string;
  direction: 'in' | 'out';
  /** Frames rendered with Three.js. */
  zoomFrames: number;
  /** Frames of the classic clip that these replace. Equal to zoomFrames in lessons; the showreel may use a longer move. */
  classicZoomFrames: number;
  /** Frame count of the classic clip. */
  totalFrames: number;
  endScale: number; endFocal: { x: number; y: number };
  settings: CinematicSettings;
  /**
   * Detail framing handoff. When present, Three.js also renders the classic clip's dissolve frames as a camera landing
   * (slide to the tile centre while the grid fades to the padding colour), which removes the double exposure.
   */
  landing?: { frames: number; tileCentre: { x: number; y: number } };
  /** Optional burned-in caption, for review reels only. */
  caption?: string;
}
const replaced = (t: Pick<CinematicClipTask, 'classicZoomFrames' | 'landing'>) => t.classicZoomFrames + (t.landing?.frames || 0);
const rendered = (t: Pick<CinematicClipTask, 'zoomFrames' | 'landing'>) => t.zoomFrames + (t.landing?.frames || 0);
export const outputFrameCount = (t: Pick<CinematicClipTask, 'totalFrames' | 'classicZoomFrames' | 'zoomFrames' | 'landing'>) => t.totalFrames - replaced(t) + rendered(t);
/**
 * Renders the zoom portion of one transition with the Three.js camera, then splices it with the remaining frames of the
 * verified classic clip (dissolve and focused hold for zoom-in; dissolve for zoom-out). Frame timestamps are fixed, so
 * rendering the same inputs twice gives the same frames.
 */
export async function renderCinematicClip(task: CinematicClipTask, signal: AbortSignal) {
  signal.throwIfAborted(); const script = await browserBundle(), { width, height } = task.dimensions, frames = outputFrameCount(task);
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="/camera.js"></script></body></html>'); }
    else if (url.pathname === '/camera.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); }
    else if (url.pathname === '/grid.png') { res.setHeader('Content-Type', 'image/png'); createReadStream(task.gridFile).on('error', () => res.destroy()).pipe(res); }
    else { res.statusCode = 404; res.end(); }
  });
  let browser: Browser | undefined; const abort = () => { void browser?.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const zoom = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=bicubic,format=yuv420p', rest = `scale=${width}:${height}:flags=bicubic,format=yuv420p`;
  const caption = task.caption ? `,drawtext=fontfile='C\\:/Windows/Fonts/segoeui.ttf':text='${task.caption.replace(/[^A-Za-z0-9 ·\-+]/g, '')}':fontcolor=white:fontsize=${Math.round(height / 38)}:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=h-text_h-${Math.round(height / 22)}` : '';
  const keep = task.totalFrames - replaced(task);
  const filter = keep <= 0 ? `[0:v]setpts=PTS-STARTPTS,${zoom}${caption}[v]`
    : task.direction === 'in'
      ? `[0:v]setpts=PTS-STARTPTS,${zoom}[z];[1:v]trim=start_frame=${replaced(task)},setpts=PTS-STARTPTS,${rest}[r];[z][r]concat=n=2:v=1:a=0${caption}[v]`
      : `[1:v]trim=end_frame=${keep},setpts=PTS-STARTPTS,${rest}[r];[0:v]setpts=PTS-STARTPTS,${zoom}[z];[r][z]concat=n=2:v=1:a=0${caption}[v]`;
  const args = ['-y', '-v', 'error', '-xerror', '-threads', '1', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0', '-i', task.classicClip, '-filter_complex', filter, '-map', '[v]',
    '-an', '-frames:v', String(frames), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', task.output];
  const child = spawn(task.ffmpeg, args, { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', failure: Error | undefined; child.stderr.on('data', b => { stderr = (stderr + String(b)).slice(-4000); }); child.stdin.on('error', () => {});
  const closed = new Promise<void>(resolve => child.on('close', code => { if (code !== 0 && !failure) failure = new Error(`FFmpeg exited ${code}: ${stderr}`); resolve(); }));
  const target: CinematicTarget = { gridWidth: task.gridWidth, gridHeight: task.gridHeight, viewportWidth: task.gridWidth, viewportHeight: task.gridHeight, endScale: task.endScale, endFocal: task.endFocal,
    lateralSign: task.tile.x + task.tile.width / 2 >= task.gridWidth / 2 ? 1 : -1 };
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); signal.throwIfAborted();
    try { browser = await chromium.launch({ headless: true, executablePath: textBrowserPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], timeout: 30000 }); }
    catch (e) { throw new Error(`Cinematic camera needs Chrome, Edge or Playwright Chromium. Install one or set TEXT_CHROME_PATH. ${(e as Error).message}`); }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort()); await page.goto(origin, { waitUntil: 'load' });
    if (await page.evaluate(() => window.sixTileCamera.webgl()) !== 'ok') throw new Error('WebGL is unavailable in the local browser.');
    await page.evaluate(s => window.sixTileCamera.initialize(s), { imageUrl: '/grid.png', gridWidth: task.gridWidth, gridHeight: task.gridHeight, width, height, tile: task.tile, background: task.background, depthBlur: task.settings.depthBlur });
    const perFrame = 1 / Math.max(1, task.zoomFrames - 1), land = task.landing;
    type Step = { kind: 'zoom'; progress: number } | { kind: 'land'; q: number };
    const zoomSteps: Step[] = Array.from({ length: task.zoomFrames }, (_, i) => { const q = i / (task.zoomFrames - 1); return { kind: 'zoom', progress: task.direction === 'in' ? q : 1 - q }; });
    const landSteps: Step[] = land ? Array.from({ length: land.frames }, (_, j) => { const q = j / Math.max(1, land.frames - 1); return { kind: 'land', q: task.direction === 'in' ? q : 1 - q }; }) : [];
    const steps = task.direction === 'in' ? [...zoomSteps, ...landSteps] : [...landSteps, ...zoomSteps];
    for (const step of steps) {
      signal.throwIfAborted(); if (failure) throw failure;
      let poses: CinematicPose[];
      if (step.kind === 'land') poses = [cinematicLandingPose(target, task.settings, step.q, land!.tileCentre)];
      else {
        const n = adaptiveSamples(cinematicPose(target, task.settings, Math.max(0, step.progress - perFrame / 2)), cinematicPose(target, task.settings, Math.min(1, step.progress + perFrame / 2)), task.settings.motionBlur);
        poses = shutterProgress(step.progress, perFrame, task.settings.motionBlur, n).map(p => cinematicPose(target, task.settings, p));
      }
      const png = await page.evaluate(p => window.sixTileCamera.frame(p), poses), bytes = Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
      if (!child.stdin.write(bytes)) await once(child.stdin, 'drain');
    }
    child.stdin.end(); await closed; if (failure) throw failure;
  } finally {
    signal.removeEventListener('abort', abort); if (child.exitCode === null) { child.stdin.destroy(); child.kill(); } await closed.catch(() => {});
    await browser?.close().catch(() => {}); server.closeAllConnections(); if (server.listening) await new Promise<void>(r => server.close(() => r()));
  }
}

/**
 * Landing for Reframed Detail views, or undefined (keep the classic dissolve) when the view is native or when the
 * detail framing is not a pure slide of the native one: the detail scale must equal native scale times the FIT factor.
 */
export function landingFor(view: { cameraMode: string; nativeTransform: CameraTransform; detailTransform: CameraTransform }, handoffFrames: number): CinematicClipTask['landing'] {
  if (view.cameraMode !== 'detail' || handoffFrames < 2) return undefined;
  const n = view.nativeTransform, d = view.detailTransform, cell = n.selectedTileRectangle;
  const fit = Math.min(cell.width / d.sourceWidth, cell.height / d.sourceHeight);
  if (Math.abs(d.scale - n.scale * fit) > 0.005 * d.scale || d.viewport.width !== n.viewport.width || d.viewport.height !== n.viewport.height) return undefined;
  return { frames: handoffFrames, tileCentre: { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 } };
}
