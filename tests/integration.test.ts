import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { withTestServer } from '../server/checks.js';
import { prepareCameraProject, extractTestFrames, testJson } from '../server/frame-checks.js';
import { waitForExport } from '../server/export-checks.js';
import { createApp } from '../server/app.js';
import type { ExportJob, ExportState } from '../shared/export.js';
import type { Project } from '../shared/project.js';
import type { ProjectDashboard } from '../shared/integration.js';
import type { FocusState } from '../shared/focus.js';
import type { AnimationJob } from '../shared/animation.js';
import { waitForAnimation } from '../server/animation-checks.js';
import { createRenderQueue } from '../server/render-queue.js';

test('Module 9 available integration: landscape pipeline, recovery, lifecycle and dependency tracking', async t => {
  await withTestServer(async (base, dataRoot) => {
    const context = await prepareCameraProject(base, path.resolve('tests/fixtures'), 'landscape-comic.jpg'), id = context.project.id;
    await t.test('Landscape reading order and independent output formats', () => { assert.equal(context.project.layout, '3x2'); assert.equal(context.layout.outputs.mobile.layout, '2x3'); assert.equal(context.layout.outputs.desktop.layout, '3x2'); assert.equal(context.config.views.length, 12); assert.equal(context.animation.videos.length, 26); });
    const frames = await extractTestFrames(base, id, context.animation.renderId);
    await t.test('Twelve actual displayed RGB first frames validate', () => { assert.equal(frames.frames.length, 12); assert(frames.frames.every(f => f.readyForGemini && f.pixelDifference.differingPixels === 0)); });
    const job = await waitForExport(base, await testJson<ExportJob>(base, `/api/projects/${id}/exports`, 'POST', { scope: 'complete' }, 202));
    await t.test('Landscape full ZIP validates', () => { assert.equal(job.receipt?.zipValidation, 'PASS'); assert.equal(job.receipt?.fileCount, 57); });
    await testJson(base, `/api/projects/${id}/session`, 'PUT', { lastStage: 9 });
    await t.test('Service recreation restores coordinates, framing, timing and completed outputs', async () => { const restarted = createApp(dataRoot, false).listen(0, '127.0.0.1'); await once(restarted, 'listening'); try { const next = `http://127.0.0.1:${(restarted.address() as AddressInfo).port}`; const p = await testJson<Project>(next, `/api/projects/${id}`); assert.deepEqual(p.panels, context.project.panels); const focus = await testJson<FocusState>(next, `/api/projects/${id}/focus`); assert.deepEqual(focus.config, context.config); const saved = await testJson<{ lastStage: number }>(next, `/api/projects/${id}/session`); assert.equal(saved.lastStage, 9); const pack = await testJson<ExportState>(next, `/api/projects/${id}/exports`); assert.equal(pack.current, true); assert.equal(pack.receipt!.archiveSha256, job.receipt!.archiveSha256); } finally { await new Promise<void>(resolve => restarted.close(() => resolve())); } });
    await t.test('Asset dashboard describes real generations', async () => { const d = await testJson<ProjectDashboard>(base, `/api/projects/${id}/assets`); assert.equal(d.assets.filter(a => a.type === 'Video' && a.status === 'Ready').length, 26); assert.equal(d.assets.filter(a => a.type === 'Gemini first frame' && a.status === 'Ready').length, 12); assert.equal(d.assets.filter(a => a.type === 'Gemini prompt' && a.status === 'Missing').length, 12); });
    await t.test('Duplicate has unique IDs and preserves settings recipe', async () => { const copy = await testJson<Project>(base, `/api/projects/${id}/duplicate`, 'POST', undefined, 201); assert.notEqual(copy.id, id); assert.notEqual(copy.input.id, context.project.input.id); assert.deepEqual(copy.panels, context.project.panels); assert.equal(copy.input.sha256, context.project.input.sha256); await testJson(base, `/api/projects/${copy.id}`, 'DELETE', { confirmedTitle: 'wrong' }, 400); await testJson(base, `/api/projects/${copy.id}`, 'DELETE', { confirmedTitle: copy.title }); await testJson(base, `/api/projects/${copy.id}`, 'GET', undefined, 404); assert((await testJson<Project>(base, `/api/projects/${id}`)).id === id); });
    await t.test('One-format scope generates all six independent transitions', async () => { const render = await waitForAnimation(base, await testJson<AnimationJob>(base, `/api/projects/${id}/animations`, 'POST', { settings: context.animation.settings, request: { scope: 'format', format: 'desktop', tileNumber: 1 }, expectedFocusRevision: context.config.revision }, 202)); assert.equal(render.videos.length, 13); assert(render.videos.every(v => v.format === 'desktop')); });
    await t.test('Panel edits invalidate downstream generations while retaining prior files', async () => { const edited = structuredClone(context.project); edited.panels[0].width--; await testJson(base, `/api/projects/${id}`, 'PUT', edited); const extraction = await testJson<{ manifest: unknown }>(base, `/api/projects/${id}/extraction`); assert.equal(extraction.manifest, null); const d = await testJson<ProjectDashboard>(base, `/api/projects/${id}/assets`); assert(d.assets.some(a => a.type === 'Extracted tile' && a.status === 'Outdated')); assert(d.assets.some(a => a.type === 'Grid' && a.status === 'Outdated')); assert(d.assets.some(a => a.type === 'Gemini first frame' && a.status === 'Outdated')); const download = await fetch(base + job.receipt!.downloadUrl); assert.equal(download.status, 200); await download.arrayBuffer(); });
  });
});

test('Render queue limits concurrency and cancels waiting work', async () => {
  await withTestServer(async (_base, dataRoot) => {
    let busy = true; const queue = createRenderQueue(dataRoot, { start: async () => { throw new Error('Test renderer failure'); }, getJob: async () => { throw new Error('Not started'); }, cancel: async () => { throw new Error('Not started'); } }, () => busy, 2);
    const id = '00000000-0000-4000-8000-000000000001', settings = (await import('../shared/animation.js')).defaultAnimationSettings(); const job = await queue.enqueue(id, settings, { scope: 'all', format: 'mobile', tileNumber: 1 }, 0); assert.equal((await queue.list()).jobs[0].queueState, 'queued'); assert.equal((await queue.cancel(id, job.id))!.status, 'cancelled');
    const failed = await queue.enqueue(id, settings, { scope: 'all', format: 'mobile', tileNumber: 1 }, 0); busy = false; const deadline = Date.now() + 5000; while ((await queue.getJob(id, failed.id))?.status === 'running') { assert(Date.now() < deadline); await new Promise(r => setTimeout(r, 50)); } assert.equal((await queue.getJob(id, failed.id))?.status, 'failed'); assert.equal((await queue.list()).maximumFfmpegProcesses, 2);
  });
});
