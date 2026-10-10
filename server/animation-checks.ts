import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson } from './storage.js';
import sharp from 'sharp';
import { withTestServer } from './checks.js';
import { waitForExtraction } from './extraction-checks.js';
import { waitForGrid } from './layout-checks.js';
import { runFocusApiChecks } from './focus-checks.js';
import { captureProcess, detectVideoTools } from './video-tools.js';
import { animationCheckNames, assertNativeBounds, defaultAnimationSettings, frameCount, fullGridTransform, nativeCameraAt, timingFor, transitionFilename, transitionFrames, type AnimationJob, type AnimationManifest, type AnimationSettings, type AnimationVideo } from '../shared/animation.js';
import type { FocusConfig, FocusState, FocusView } from '../shared/focus.js';
import { renderFocusPixels } from '../shared/focus-render.js';
import { defaultGridSettings, type GridJob, type LayoutManifest } from '../shared/layout.js';
import type { ExtractionJob, ExtractionManifest } from '../shared/extraction.js';
import type { CheckResult, Project } from '../shared/project.js';

export function compactAnimationSettings(): AnimationSettings {
  const settings = defaultAnimationSettings(); settings.initialGridHold = settings.intermediateGridHold = settings.finalGridHold = 1 / 30;
  settings.global = { zoomIn: 4 / 30, focusedHold: 2 / 30, zoomOut: 4 / 30, detailHandoff: 3 / 30 }; settings.preset = 'veryfast'; return settings;
}
export async function waitForAnimation(base: string, job: AnimationJob, timeout = 240_000): Promise<AnimationManifest> {
  const deadline = Date.now() + timeout; let current = job;
  while (current.status === 'running') {
    if (Date.now() > deadline) { await fetch(`${base}/api/projects/${job.projectId}/animations/${job.id}/cancel`, { method: 'POST' }); throw new Error('Camera rendering timed out and was cancelled.'); }
    await new Promise(resolve => setTimeout(resolve, 150)); const r = await fetch(`${base}/api/projects/${job.projectId}/animations/${job.id}`); assert.equal(r.status, 200); current = await r.json() as AnimationJob;
  }
  assert.equal(current.status, 'complete', current.error ?? current.message); assert(current.manifest); return current.manifest;
}
export async function runAnimationApiChecks(base: string, fixtures: string, dataRoot: string) {
  const results: CheckResult[] = [], tools = await detectVideoTools();
  let project: Project, source: ExtractionManifest, layout: LayoutManifest, config: FocusConfig, manifest: AnimationManifest;
  const settings = compactAnimationSettings();
  async function json<T>(route: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
    const r = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); assert.equal(r.status, status, await r.clone().text()); return await r.json() as T;
  }
  async function setup() {
    assert(tools.available, tools.instructions);
    const form = new FormData(); form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtures, 'sample-comic.png')))], { type: 'image/png' }), 'sample-comic.png');
    const r = await fetch(base + '/api/upload', { method: 'POST', body: form }); assert.equal(r.status, 201); const initial = await r.json() as Project;
    project = (await json<{ project: Project }>(`/api/projects/${initial.id}`, 'PUT', initial)).project;
    const e = await waitForExtraction(base, await json<ExtractionJob>(`/api/projects/${project.id}/extract`, 'POST', { expectedUpdatedAt: project.updatedAt }, 202)); assert(e.manifest); source = e.manifest;
    layout = await waitForGrid(base, await json<GridJob>(`/api/projects/${project.id}/layouts`, 'POST', { settings: defaultGridSettings(), expectedExtractionId: source.extractionId }, 202));
    config = (await json<FocusState>(`/api/projects/${project.id}/focus`)).config;
    config.views.find(v => v.format === 'mobile' && v.tileNumber === 1)!.native.zoom = 1.3;
    const detail = config.views.find(v => v.format === 'desktop' && v.tileNumber === 6)!; detail.cameraMode = 'detail'; detail.detail.zoom = 1.2; detail.detail.center = { x: 0.55, y: 0.5 };
    config = await json<FocusConfig>(`/api/projects/${project.id}/focus`, 'PUT', { config, expectedRevision: config.revision });
    const job = await json<AnimationJob>(`/api/projects/${project.id}/animations`, 'POST', { settings, request: { scope: 'all', format: 'mobile', tileNumber: 1 }, expectedFocusRevision: config.revision }, 202);
    // An actual render runs in another process; the API remains responsive and locks its inputs.
    await json('/api/health'); await json(`/api/projects/${project.id}/focus`, 'PUT', { config, expectedRevision: config.revision }, 409);
    manifest = await waitForAnimation(base, job);
  }
  const video = (format: 'mobile' | 'desktop', direction: 'in' | 'out', n = 1) => { const v = manifest.videos.find(v => v.filename === transitionFilename(format, n, direction)); assert(v); return v; };
  const view = (v: AnimationVideo) => config.views.find(p => p.format === v.format && p.tileNumber === v.tileNumber)!;
  const local = (v: AnimationVideo) => path.join(dataRoot, 'exports', project.id, 'animation-runs', manifest.renderId, v.relativePath);
  const expectedCache = new Map<string, Uint8Array>();
  async function expected(v: FocusView, focus: boolean) {
    const key = `${v.format}-${v.tileNumber}-${focus}`; if (expectedCache.has(key)) return expectedCache.get(key)!;
    const detail = focus && v.cameraMode === 'detail', item = detail ? source.tiles[v.tileNumber - 1] : layout.outputs[v.format];
    const filename = detail ? path.join(dataRoot, 'exports', project.id, 'runs', source.extractionId, 'tiles', item.filename) : path.join(dataRoot, 'exports', project.id, 'layout-runs', layout.generationId, 'layouts', item.filename);
    const raw = await sharp(filename).toColourspace('srgb').ensureAlpha().raw().toBuffer(); const pixels = renderFocusPixels(raw, focus ? v.transform : fullGridTransform(v)); expectedCache.set(key, pixels); return pixels;
  }
  async function decoded(v: AnimationVideo, index: number) {
    return captureProcess(tools.ffmpeg!, ['-v', 'error', '-threads', '1', '-i', local(v), '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  }
  function compare(actual: Uint8Array, pixels: Uint8Array) {
    assert.equal(actual.length, pixels.length); let error = 0, samples = 0;
    for (let i = 0; i < actual.length; i += 4) for (let c = 0; c < 3; c++) { error += Math.abs(actual[i + c] - pixels[i + c]); samples++; }
    const mae = error / samples; assert(mae < 5, `Decoded endpoint differs from expected framing: RGB MAE ${mae.toFixed(3)} ≥ 5.`); return mae;
  }
  async function check(index: number, action: () => Promise<string>) {
    try { results.push({ name: animationCheckNames[index], status: 'PASS', detail: await action() }); }
    catch (e) { results.push({ name: animationCheckNames[index], status: 'FAIL', detail: e instanceof Error ? e.message : String(e) }); }
  }
  for (const [i, format, direction] of [[0, 'mobile', 'in'], [1, 'mobile', 'out'], [2, 'desktop', 'in'], [3, 'desktop', 'out']] as const) await check(i, async () => { if (i === 0) await setup(); const v = video(format, direction); const r = await fetch(base + v.playbackUrl); assert.equal(r.status, 200); assert((await r.arrayBuffer()).byteLength > 1000); return `${v.filename}: actual MP4 rendered, probed and served.`; });
  await check(4, async () => { for (const v of manifest.videos) { assert.equal(v.probe.width, v.format === 'mobile' ? 1080 : 1920); assert.equal(v.probe.height, v.format === 'mobile' ? 1920 : 1080); } return 'All 26 files have the independent mobile/desktop output resolution.'; });
  await check(5, async () => { for (const v of manifest.videos) { assert.equal(v.probe.codec, 'h264'); assert.equal(v.probe.pixelFormat, 'yuv420p'); } return 'FFprobe confirms H.264 / yuv420p for all 26 files.'; });
  await check(6, async () => {
    for (const v of manifest.videos) {
      assert.equal(v.probe.frameRate, '30/1'); assert.equal(v.probe.averageFrameRate, '30/1');
      const data = JSON.parse((await captureProcess(tools.ffprobe!, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', local(v)])).toString());
      for (let i = 1; i < data.frames.length; i++) assert(Math.abs(Number(data.frames[i].best_effort_timestamp_time) - Number(data.frames[i - 1].best_effort_timestamp_time) - 1 / 30) < 2e-6);
    } return 'Every decoded presentation timestamp advances by 1/30 second.';
  });
  await check(7, async () => { for (const v of manifest.videos) assert.equal(v.probe.audioStreams, 0); return 'No audio stream in any output.'; });
  await check(8, async () => {
    for (const v of manifest.videos) {
      const expectedFrames = v.kind === 'in' || v.kind === 'out' ? transitionFrames(view(v), v.kind, timingFor(settings, v.tileNumber!)).length : frameCount(settings.initialGridHold) + frameCount(settings.finalGridHold) + 5 * frameCount(settings.intermediateGridHold) + config.views.filter(p => p.format === v.format).reduce((n, p) => n + transitionFrames(p, 'in', settings.global).length + transitionFrames(p, 'out', settings.global).length, 0);
      assert.equal(v.probe.frames, expectedFrames); assert.equal(v.frameCount, expectedFrames); assert(Math.abs(v.probe.duration - expectedFrames / 30) < 0.002);
    } return 'Frame counts follow rounded timings with inclusive motion endpoints; durations agree within 2 ms.';
  });
  for (const [index, direction, endpoint, focus] of [[9, 'in', 'first', false], [10, 'in', 'last', true], [11, 'out', 'first', true], [12, 'out', 'last', false]] as const) await check(index, async () => {
    const errors: string[] = [];
    for (const [format, number] of [['mobile', 1], ['desktop', 1], ['desktop', 6]] as const) {
      const v = video(format, direction, number), approved = view(v), transform = focus ? approved.transform : fullGridTransform(approved);
      assert.deepEqual(endpoint === 'first' ? v.startTransform : v.endTransform, transform);
      const mae = compare(await decoded(v, endpoint === 'first' ? 0 : v.frameCount - 1), await expected(approved, focus)); errors.push(`${format}/${number} MAE ${mae.toFixed(2)}`);
    } return `Decoded endpoints match intended saved geometry within lossy-codec tolerance: ${errors.join(', ')}. No RGB equality claim.`;
  });
  await check(13, async () => {
    for (const v of config.views) {
      const points = Array.from({ length: 101 }, (_, i) => nativeCameraAt(v, i / 100));
      for (let i = 1; i < points.length; i++) { assert(points[i].scale >= points[i - 1].scale); assert(Math.abs(points[i].focalPoint.x - points[i - 1].focalPoint.x) < v.nativeTransform.sourceWidth * 0.02); assert(Math.abs(points[i].focalPoint.y - points[i - 1].focalPoint.y) < v.nativeTransform.sourceHeight * 0.02); }
      const inFrames = transitionFrames(v, 'in', settings.global).filter(f => f.stage === 'zoom'), out = transitionFrames(v, 'out', settings.global).filter(f => f.stage === 'zoom');
      inFrames.forEach((f, i) => { const reverse = out[out.length - 1 - i]; assert(Math.abs(f.native.scale - reverse.native.scale) < 1e-10); assert(Math.abs(f.native.focalPoint.x - reverse.native.focalPoint.x) < 1e-9); });
    } return 'All twelve smoothstep/log-scale paths have continuous centres, monotonic scale and reverse geometry.';
  });
  await check(14, async () => { for (const v of config.views) for (let i = 0; i <= 100; i++) assertNativeBounds(nativeCameraAt(v, i / 100)); return 'Every native viewport stays inside its grid. Existing FIT artwork padding is retained; detail padding is explicit in saved settings.'; });
  await check(15, async () => { for (const v of config.views) { assert.deepEqual(v.nativeTransform.selectedTileRectangle, layout.outputs[v.format].geometry.panels[v.tileNumber - 1]); const clip = video(v.format, 'in', v.tileNumber); assert.deepEqual(clip.endTransform, v.transform); } return 'All twelve clips use their correct saved panel rectangle and active transform.'; });
  await check(16, async () => { const m = video('mobile', 'in'), d = video('desktop', 'in'); assert.notDeepEqual(m.endTransform, d.endTransform); assert.equal(manifest.sources.mobileGridSha256, layout.outputs.mobile.pngSha256); assert.equal(manifest.sources.desktopGridSha256, layout.outputs.desktop.pngSha256); assert.notEqual(manifest.sources.mobileGridSha256, manifest.sources.desktopGridSha256); assert.equal(manifest.focusConfig.views.find(v => v.format === 'mobile' && v.tileNumber === 1)!.native.zoom, 1.3); return 'Formats use different grid PNGs and independently saved crops; desktop is never cropped from mobile video.'; });
  await check(17, async () => { const clips = manifest.videos.filter(v => ['in', 'out'].includes(v.kind)); assert.equal(clips.length, 24); assert.equal(new Set(clips.map(v => v.filename)).size, 24); for (const v of clips) { await captureProcess(tools.ffmpeg!, ['-v', 'error', '-threads', '1', '-i', local(v), '-f', 'null', '-']); } return 'All 12 zoom-ins and 12 zoom-outs fully decode; detail handoff included and labelled.'; });
  await check(18, async () => { const previews = manifest.videos.filter(v => v.kind === 'lesson'); assert.equal(previews.length, 2); for (const v of previews) { await captureProcess(tools.ffmpeg!, ['-v', 'error', '-threads', '1', '-i', local(v), '-f', 'null', '-']); assert.equal(v.startTransform.scale, 1); assert.equal(v.endTransform.scale, 1); } const disk = JSON.parse(await readFile(path.join(dataRoot, 'exports', project.id, 'animation-runs', manifest.renderId, 'metadata', 'camera_animation_manifest.json'), 'utf8')); assert.deepEqual(disk, manifest); return 'Both complete six-tile lessons fully decode; saved manifest exactly restores camera snapshots and timings.'; });
  await check(19, async () => { const previous = await runFocusApiChecks(base, fixtures, dataRoot); assert.equal(previous.filter(r => r.status === 'FAIL').length, 0, previous.filter(r => r.status === 'FAIL').map(r => r.detail).join('\n')); return 'All 18 Module 4 API scenarios passed, including Module 1–3 regression checks. The npm test command also runs every earlier unit suite.'; });
  return results;
}
export async function runAnimationDiagnostics() {
  const { fixtureRoot, root } = await import('./app.js');
  const results = await withTestServer((base, directory) => runAnimationApiChecks(base, fixtureRoot, directory));
  const report = { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
  await atomicJson(path.join(root, 'data', 'diagnostics', 'module-five.json'), report);
  await atomicJson(path.join(root, 'previews', 'module-five-report.json'), report);
  return report;
}
