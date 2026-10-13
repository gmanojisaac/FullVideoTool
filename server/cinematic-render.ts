import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { cinematicPose, type CinematicTarget } from '../shared/cinematic.js';
import { textBrowserPath } from './text-render.js';

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
  direction: 'in' | 'out'; zoomFrames: number; totalFrames: number;
  endScale: number; endFocal: { x: number; y: number };
}
/**
 * Renders the zoom portion of one transition with the Three.js camera, then splices it with the remaining frames of the
 * verified classic clip (dissolve and focused hold for zoom-in; dissolve for zoom-out). Output is the same frame count
 * as the classic clip. Frame timestamps are fixed, so rendering the same inputs twice gives the same frames.
 */
export async function renderCinematicClip(task: CinematicClipTask, signal: AbortSignal) {
  signal.throwIfAborted(); const script = await browserBundle(), { width, height } = task.dimensions;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script src="/camera.js"></script></body></html>'); }
    else if (url.pathname === '/camera.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); }
    else if (url.pathname === '/grid.png') { res.setHeader('Content-Type', 'image/png'); createReadStream(task.gridFile).on('error', () => res.destroy()).pipe(res); }
    else { res.statusCode = 404; res.end(); }
  });
  let browser: Browser | undefined; const abort = () => { void browser?.close().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const zoom = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=bicubic,format=yuv420p', rest = `scale=${width}:${height}:flags=bicubic,format=yuv420p`;
  const filter = task.direction === 'in'
    ? `[0:v]setpts=PTS-STARTPTS,${zoom}[z];[1:v]trim=start_frame=${task.zoomFrames},setpts=PTS-STARTPTS,${rest}[r];[z][r]concat=n=2:v=1:a=0[v]`
    : `[1:v]trim=end_frame=${task.totalFrames - task.zoomFrames},setpts=PTS-STARTPTS,${rest}[r];[0:v]setpts=PTS-STARTPTS,${zoom}[z];[r][z]concat=n=2:v=1:a=0[v]`;
  const args = ['-y', '-v', 'error', '-xerror', '-threads', '1', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0', '-i', task.classicClip, '-filter_complex', filter, '-map', '[v]',
    '-an', '-frames:v', String(task.totalFrames), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', task.output];
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
    await page.evaluate(s => window.sixTileCamera.initialize(s), { imageUrl: '/grid.png', gridWidth: task.gridWidth, gridHeight: task.gridHeight, width, height, tile: task.tile, background: task.background });
    for (let i = 0; i < task.zoomFrames; i++) {
      signal.throwIfAborted(); if (failure) throw failure;
      const q = i / (task.zoomFrames - 1), progress = task.direction === 'in' ? q : 1 - q;
      const png = await page.evaluate(pose => window.sixTileCamera.frame(pose), cinematicPose(target, progress)), bytes = Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
      if (!child.stdin.write(bytes)) await once(child.stdin, 'drain');
    }
    child.stdin.end(); await closed; if (failure) throw failure;
  } finally {
    signal.removeEventListener('abort', abort); if (child.exitCode === null) { child.stdin.destroy(); child.kill(); } await closed.catch(() => {});
    await browser?.close().catch(() => {}); server.closeAllConnections(); if (server.listening) await new Promise<void>(r => server.close(() => r()));
  }
}
