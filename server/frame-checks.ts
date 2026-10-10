import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { withTestServer } from './checks.js';
import { atomicJson } from './storage.js';
import { waitForExtraction } from './extraction-checks.js';
import { waitForGrid } from './layout-checks.js';
import { compactAnimationSettings, runAnimationApiChecks, waitForAnimation } from './animation-checks.js';
import { cameraGeometryMatches, decodeDisplayedRgb, pixelDifference, probeFrameSource, verifyPngAgainstVideo } from './frame-decode.js';
import { detectVideoTools } from './video-tools.js';
import { validateFrameSourceManifest } from './frames.js';
import { sha256 } from './extraction.js';
import { defaultGridSettings, type GridJob } from '../shared/layout.js';
import { frameCheckNames, geminiFrameFilename, type FrameJob, type FrameSettings, type FrameState, type FrameValidationReport } from '../shared/frames.js';
import type { FocusConfig, FocusState } from '../shared/focus.js';
import type { AnimationJob } from '../shared/animation.js';
import type { ExtractionJob } from '../shared/extraction.js';
import type { CheckResult, Project } from '../shared/project.js';

export async function testJson<T>(base: string, route: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const r = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); assert.equal(r.status, status, await r.clone().text()); return await r.json() as T;
}
export async function prepareCameraProject(base: string, fixtures: string, filename = 'sample-comic.png') {
  const type = filename.endsWith('.jpg') ? 'image/jpeg' : filename.endsWith('.webp') ? 'image/webp' : 'image/png';
  const form = new FormData(); form.append('image', new Blob([new Uint8Array(await readFile(path.join(fixtures, filename)))], { type }), filename);
  const r = await fetch(base + '/api/upload', { method: 'POST', body: form }); assert.equal(r.status, 201); const initial = await r.json() as Project;
  const project = (await testJson<{ project: Project }>(base, `/api/projects/${initial.id}`, 'PUT', initial)).project;
  const extracted = await waitForExtraction(base, await testJson<ExtractionJob>(base, `/api/projects/${project.id}/extract`, 'POST', { expectedUpdatedAt: project.updatedAt }, 202)); assert(extracted.manifest); const source = extracted.manifest;
  const layout = await waitForGrid(base, await testJson<GridJob>(base, `/api/projects/${project.id}/layouts`, 'POST', { expectedExtractionId: source.extractionId, settings: defaultGridSettings() }, 202));
  let config = (await testJson<FocusState>(base, `/api/projects/${project.id}/focus`)).config;
  config = await testJson<FocusConfig>(base, `/api/projects/${project.id}/focus`, 'PUT', { config, expectedRevision: config.revision });
  const animation = await waitForAnimation(base, await testJson<AnimationJob>(base, `/api/projects/${project.id}/animations`, 'POST', { settings: compactAnimationSettings(), request: { scope: 'all', format: 'mobile', tileNumber: 1 }, expectedFocusRevision: config.revision }, 202));
  return { project, source, layout, config, animation };
}
export async function waitForFrames(base: string, job: FrameJob, expected: FrameJob['status'] = 'complete') {
  let current = job; const deadline = Date.now() + 240_000;
  while (current.status === 'running') { assert(Date.now() < deadline, 'Frame processing timed out.'); await new Promise(resolve => setTimeout(resolve, 150)); current = await testJson(base, `/api/projects/${job.projectId}/frame-jobs/${job.id}`); }
  assert.equal(current.status, expected, current.error ?? current.message); assert(current.report); return current.report;
}
export async function extractTestFrames(base: string, projectId: string, animationRenderId: string) {
  return waitForFrames(base, await testJson<FrameJob>(base, `/api/projects/${projectId}/frames`, 'POST', { operation: 'extract', scope: 'all', format: 'mobile', tileNumber: 1, expectedAnimationRenderId: animationRenderId, bridgeDuration: 0.3 }, 202));
}
export async function runFrameApiChecks(base: string, fixtures: string, dataRoot: string) {
  const results: CheckResult[] = [], tools = await detectVideoTools(); let context: Awaited<ReturnType<typeof prepareCameraProject>>, report: FrameValidationReport;
  const frame = (format: 'mobile' | 'desktop', n = 1) => { const f = report.frames.find(f => f.format === format && f.tileNumber === n); assert(f); return f; };
  const png = (format: 'mobile' | 'desktop', n = 1) => path.join(dataRoot, 'exports', context.project.id, 'frame-runs', report.generationId, frame(format, n).relativePath);
  const video = (format: 'mobile' | 'desktop', kind: 'in' | 'out') => { const v = context.animation.videos.find(v => v.format === format && v.tileNumber === 1 && v.kind === kind)!; return path.join(dataRoot, 'exports', context.project.id, 'animation-runs', context.animation.renderId, v.relativePath); };
  async function check(i: number, action: () => Promise<string>) { try { results.push({ name: frameCheckNames[i], status: 'PASS', detail: await action() }); } catch (e) { results.push({ name: frameCheckNames[i], status: 'FAIL', detail: e instanceof Error ? e.message : String(e) }); } }
  await check(0, async () => { context = await prepareCameraProject(base, fixtures); validateFrameSourceManifest(context.animation); report = await extractTestFrames(base, context.project.id, context.animation.renderId); assert.equal(frame('mobile').readyForGemini, true); return 'Actual mobile tile 1 PNG extracted from the completed MP4 and independently verified.'; });
  await check(1, async () => { assert.equal(frame('desktop').readyForGemini, true); return 'Actual desktop tile 1 PNG extracted and independently verified.'; });
  for (const [i, format, width, height] of [[2, 'mobile', 1080, 1920], [3, 'desktop', 1920, 1080]] as const) await check(i, async () => { for (let n = 1; n <= 6; n++) { const m = await sharp(png(format, n)).metadata(); assert.equal(m.width, width); assert.equal(m.height, height); assert.equal(m.format, 'png'); } return `All six lossless ${format} PNGs decode at ${width} × ${height}.`; });
  await check(4, async () => { for (const f of report.frames) { assert.equal(f.exactDecodedPixelMatch, 'PASS'); assert.equal(f.pixelDifference.differingPixels, 0); assert.equal(f.pixelDifference.maxAbsoluteDifference, 0); assert.notEqual(f.extractionDecodeId, f.verificationDecodeId); } return 'All twelve PNGs have zero RGB pixel/channel differences against new video decoder processes.'; });
  await check(5, async () => { for (const f of report.frames) { assert.equal(f.pngRgbSha256, f.videoRgbSha256); assert.equal(f.pngFileSha256, sha256(await readFile(png(f.format, f.tileNumber)))); assert.notEqual(f.pngFileSha256, f.pngRgbSha256); } return 'Independent decoded RGB SHA-256 hashes match; PNG container hashes are separately accurate.'; });
  await check(6, async () => {
    const file = png('mobile'), original = await readFile(file), raw = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true }); raw.data[0] = (raw.data[0] + 1) % 256;
    await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 3 } }).png().toFile(file);
    const verified = await verifyPngAgainstVideo(tools, file, video('mobile', 'in'), 'mobile'); assert.equal(verified.pass, false); assert.equal(verified.difference.differingPixels, 1);
    assert.equal((await fetch(base + frame('mobile').downloadUrl)).status, 409);
    report = await waitForFrames(base, await testJson<FrameJob>(base, `/api/projects/${context.project.id}/frames`, 'POST', { operation: 'verify', scope: 'tile', format: 'mobile', tileNumber: 1, expectedAnimationRenderId: context.animation.renderId, bridgeDuration: 0.3 }, 202), 'failed'); assert.equal(frame('mobile').readyForGemini, false);
    const before = frame('desktop').pngFileSha256;
    report = await waitForFrames(base, await testJson<FrameJob>(base, `/api/projects/${context.project.id}/frames`, 'POST', { operation: 'extract', scope: 'tile', format: 'mobile', tileNumber: 1, expectedAnimationRenderId: context.animation.renderId, bridgeDuration: 0.3 }, 202)); assert.equal(frame('mobile').readyForGemini, true); assert.equal(frame('desktop').pngFileSha256, before); return 'One changed RGB pixel fails validation and download, then selected-tile regeneration restores equality without changing other frames.';
  });
  await check(7, async () => { const file = path.join(dataRoot, 'corrupt-frame-test.mp4'); await writeFile(file, 'corrupt'); await assert.rejects(() => probeFrameSource(tools, file, 'mobile')); return 'Corrupt MP4 rejected by actual video probing.'; });
  await check(8, async () => { await assert.rejects(() => probeFrameSource(tools, path.join(dataRoot, 'missing.mp4'), 'mobile'), /missing/); return 'Missing MP4 rejected before extraction.'; });
  await check(9, async () => { const f = frame('mobile'), probe = await probeFrameSource(tools, video('mobile', 'in'), 'mobile'); const lastKey = probe.frames.reduce((n, f, i) => f.key_frame === 1 ? i : n, -1); assert.equal(f.lastFrameIndex, probe.frames.length - 1); assert(f.lastFrameIndex > lastKey); assert.equal(f.lastFrameIsKeyframe, false); assert.equal(f.lastPresentationTimestamp, Number(probe.frames.at(-1)!.best_effort_timestamp_time)); return `Sequentially selected displayed frame ${f.lastFrameIndex}, after keyframe ${lastKey}, using its probed PTS ${f.lastPresentationTimestamp}s.`; });
  await check(10, async () => { for (const f of report.frames) { assert.equal(f.zoomOutGeometryMatch, 'PASS'); assert(cameraGeometryMatches(f.focusedTransform, f.zoomOutStartTransform)); } return 'All twelve start/end geometry records match approved focus metadata exactly.'; });
  await check(11, async () => { const f = frame('mobile'); const wrong = structuredClone(f.zoomOutStartTransform); wrong.translation.x += 10; assert.equal(cameraGeometryMatches(f.focusedTransform, wrong), false); const source = await decodeDisplayedRgb(tools, video('mobile', 'in'), 1080, 1920), mismatch = pixelDifference(source.last, source.first); assert(mismatch.differingPixels > 0); assert.notEqual(sha256(source.first), f.videoRgbSha256); return 'A deliberately shifted transform fails geometry matching; a deliberately wrong start image reports nonzero decoded RGB differences.'; });
  for (const [i, format] of [[12, 'mobile'], [13, 'desktop']] as const) await check(i, async () => { assert.equal(report.frames.filter(f => f.format === format && f.readyForGemini).length, 6); return `All six ${format} authoritative PNGs are verified and ready.`; });
  await check(14, async () => { const r = await fetch(base + report.allFramesDownloadUrl); assert.equal(r.status, 200); const zip = unzipSync(new Uint8Array(await r.arrayBuffer())); assert.equal(Object.keys(zip).length, 12); for (const f of report.frames) { assert.equal(f.geminiPngFilename, geminiFrameFilename(f.format, f.tileNumber)); assert.equal(f.relativePath, `${f.format}/gemini_frames/${f.geminiPngFilename}`); assert.equal(sha256(zip[f.relativePath]), f.pngFileSha256); } return 'First-frame-only download contains twelve correctly named PNGs with unchanged hashes.'; });
  await check(15, async () => { const before = frame('mobile').pngFileSha256; report = await waitForFrames(base, await testJson<FrameJob>(base, `/api/projects/${context.project.id}/frames`, 'POST', { operation: 'bridge', scope: 'tile', format: 'mobile', tileNumber: 1, expectedAnimationRenderId: context.animation.renderId, bridgeDuration: 0.3 }, 202)); const bridge = report.bridges[0]; assert.equal(bridge.frameCount, 9); assert.equal(bridge.probe.codec, 'h264'); assert.equal(bridge.probe.frameRate, '30/1'); assert.equal(bridge.probe.audioStreams, 0); assert.equal(sha256(await readFile(png('mobile'))), before); return 'Optional 9-frame / 0.3s H.264 bridge generated separately without modifying the authoritative PNG.'; });
  await check(16, async () => { const r = await fetch(base + report.reportUrl); assert.equal(r.status, 200); assert.deepEqual(await r.json(), report); assert.equal(report.frames.length, 12); for (const f of report.frames) { assert.equal(f.zoomOutDecodedPixelMatch, f.zoomOutPixelDifference.differingPixels === 0 ? 'PASS' : 'FAIL'); if (f.zoomOutDecodedPixelMatch === 'FAIL') assert(f.warnings.length > 0); } return 'Saved report contains actual hashes, presentation times, dimensions, independent decoder identifiers and honest lossy zoom-out differences.'; });
  await check(17, async () => { const { createApp } = await import('./app.js'); const server = createApp(dataRoot, false).listen(0, '127.0.0.1'); await once(server, 'listening'); try { const state = await testJson<FrameState>(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, `/api/projects/${context.project.id}/frames`); assert.deepEqual(state.report, report); assert.equal(state.settings.bridgeDuration, 0.3); assert.deepEqual(state.source?.focusConfig, context.config); } finally { await new Promise<void>(resolve => server.close(() => resolve())); } return 'A fresh service restores all results, bridge duration and unchanged saved framing.'; });
  await check(18, async () => { const earlier = await runAnimationApiChecks(base, fixtures, dataRoot); assert.equal(earlier.filter(r => r.status === 'FAIL').length, 0, earlier.filter(r => r.status === 'FAIL').map(r => r.detail).join('\n')); return 'All twenty Module 5 acceptance scenarios pass, including actual Module 1–4 API regressions. npm test additionally runs all earlier unit suites.'; });
  return results;
}
export async function runFrameDiagnostics() {
  const { fixtureRoot, root } = await import('./app.js'); const results = await withTestServer((base, directory) => runFrameApiChecks(base, fixtureRoot, directory));
  const report = { results, passed: results.filter(r => r.status === 'PASS').length, total: results.length, completedAt: new Date().toISOString() };
  await atomicJson(path.join(root, 'data', 'diagnostics', 'module-six.json'), report); await atomicJson(path.join(root, 'previews', 'module-six-report.json'), report); return report;
}
