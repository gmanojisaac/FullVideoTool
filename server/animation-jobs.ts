import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError, sha256 } from './extraction.js';
import { detectVideoTools } from './video-tools.js';
import type { FocusContext } from './focus.js';
import type { FocusConfig } from '../shared/focus.js';
import { validId } from '../shared/project.js';
import { canonicalAnimationSettings, defaultAnimationSettings, validAnimationRequest, validateAnimationSettings, type AnimationJob, type AnimationManifest, type AnimationRequest, type AnimationSettings, type AnimationState } from '../shared/animation.js';

export interface AnimationContext extends FocusContext { config: FocusConfig }
export const animationHash = (c: AnimationContext, s: AnimationSettings) => sha256(JSON.stringify({ layout: c.layout.generationId, source: c.source.extractionId, config: c.config, settings: s }));
export function createAnimationJobs(dataRoot: string, getContext: (id: string) => Promise<AnimationContext>) {
  const active = new Map<string, { job: AnimationJob; worker: ChildProcess; persist: () => Promise<void>; publishing: boolean }>(), mutations = new Set<string>();
  const root = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.resolve(dataRoot, 'exports', id); };
  const jobFile = (id: string, run: string) => { if (!validId(run)) throw new ExtractionError(400, 'Invalid animation render ID.'); return path.join(root(id), 'animation-jobs', `${run}.json`); };
  const settingsFile = (id: string) => path.join(root(id), 'metadata', 'animation_settings.json');
  const isRunning = (id: string) => active.has(id) || mutations.has(id);
  async function settings(id: string) {
    try { const value = await readJson<AnimationSettings>(settingsFile(id)); const errors = validateAnimationSettings(value); if (errors.length) throw new ExtractionError(400, errors.join(' ')); return canonicalAnimationSettings(value); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultAnimationSettings(); throw e; }
  }
  async function getJob(id: string, run: string): Promise<AnimationJob> {
    const file = jobFile(id, run), live = active.get(id); if (live?.job.id === run) return structuredClone(live.job);
    let job: AnimationJob;
    try { job = await readJson(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ExtractionError(404, 'Animation render not found.'); throw e; }
    if (job.status === 'running') { job.status = 'failed'; job.message = 'Render interrupted by service restart. Retry.'; job.error = job.message; job.updatedAt = new Date().toISOString(); await atomicJson(file, job); }
    return job;
  }
  async function current(id: string): Promise<AnimationState> {
    const context = await getContext(id), value = await settings(id), state: AnimationState = { tools: await detectVideoTools(), settings: value, manifest: null, job: null };
    for (const name of ['latest-animation.json', 'active-animation.json']) try {
      const ref = await readJson<{ id: string }>(path.join(root(id), name)), job = await getJob(id, ref.id);
      if (name === 'active-animation.json') state.job = job;
      if (name === 'latest-animation.json' && job.status === 'complete' && job.manifest?.configurationSha256 === animationHash(context, value)) state.manifest = job.manifest;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof ExtractionError && e.status === 404)) throw e; }
    state.fullManifest = state.manifest?.request.scope === 'all' ? state.manifest : null;
    try { const ref = await readJson<{ id: string }>(path.join(root(id), 'latest-full-animation.json')), job = await getJob(id, ref.id); if (job.manifest?.request.scope === 'all' && job.manifest.configurationSha256 === animationHash(context, value)) state.fullManifest = job.manifest; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return state;
  }
  async function saveSettings(id: string, value: unknown) {
    if (isRunning(id)) throw new ExtractionError(409, 'Wait or cancel the camera render before editing its timing.');
    const errors = validateAnimationSettings(value); if (errors.length) throw new ExtractionError(400, errors.join(' '));
    mutations.add(id); try { await getContext(id); const next = canonicalAnimationSettings(value as AnimationSettings); await atomicJson(settingsFile(id), next); return next; } finally { mutations.delete(id); }
  }
  async function start(id: string, value: unknown, request: AnimationRequest, expectedRevision: unknown): Promise<AnimationJob> {
    if (isRunning(id)) throw new ExtractionError(409, 'An animation render is already running. Wait or cancel it.');
    const errors = validateAnimationSettings(value); if (errors.length) throw new ExtractionError(400, errors.join(' '));
    if (!validAnimationRequest(request)) throw new ExtractionError(400, 'Choose a valid render scope, format and tile.');
    mutations.add(id);
    try {
      const context = await getContext(id);
      if (!context.config.updatedAt || context.config.revision !== expectedRevision) throw new ExtractionError(409, 'Save the current Step 4 framing before rendering camera animation.');
      const tools = await detectVideoTools(); if (!tools.available) throw new ExtractionError(503, 'FFmpeg or FFprobe is missing. ' + tools.instructions);
      const next = canonicalAnimationSettings(value as AnimationSettings), configurationSha256 = animationHash(context, next);
      await atomicJson(settingsFile(id), next);
      const run = randomUUID(), now = new Date().toISOString();
      const job: AnimationJob = { id: run, projectId: id, status: 'running', progress: 0, framesDone: 0, framesTotal: 0, message: 'Starting camera renderer…', startedAt: now, updatedAt: now, cancelRequested: false };
      let writes = Promise.resolve();
      const persist = () => { job.updatedAt = new Date().toISOString(); const snapshot = structuredClone(job); writes = writes.then(() => atomicJson(jobFile(id, run), snapshot)); return writes; };
      await persist(); await atomicJson(path.join(root(id), 'active-animation.json'), { id: run });
      const worker = fork(fileURLToPath(new URL('./animation-worker.mjs', import.meta.url)), [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let stderr = ''; worker.stderr?.on('data', b => { stderr = (stderr + String(b)).slice(-4000); });
      const live = { job, worker, persist, publishing: false }; active.set(id, live);
      let finishing = false;
      async function finish(manifest?: AnimationManifest, error?: string, cancelled = false) {
        if (finishing) return; finishing = true;
        try {
          if (manifest && !job.cancelRequested) {
            if (animationHash(await getContext(id), next) !== configurationSha256) throw new Error('Source grid or focus changed during rendering. Retry.');
            live.publishing = true;
            const completed: AnimationJob = { ...job, status: 'complete', progress: 100, manifest, message: `${manifest.videos.length} MP4 files rendered and verified.`, updatedAt: new Date().toISOString() };
            await writes; await atomicJson(jobFile(id, run), completed); await atomicJson(path.join(root(id), 'latest-animation.json'), { id: run }); if (manifest.request.scope === 'all') await atomicJson(path.join(root(id), 'latest-full-animation.json'), { id: run }); Object.assign(job, completed);
          } else { job.status = job.cancelRequested || cancelled ? 'cancelled' : 'failed'; job.message = job.status === 'cancelled' ? 'Camera rendering cancelled. Previous completed files are retained.' : 'Camera rendering failed. Retry.'; job.error = job.status === 'failed' ? (error ?? (stderr || 'Renderer stopped unexpectedly.')) : undefined; await persist(); }
        } catch (e) { job.status = 'failed'; job.error = e instanceof Error ? e.message : String(e); job.message = 'Could not publish camera render. Retry.'; await persist(); }
        finally { active.delete(id); }
      }
      worker.on('message', message => {
        const m = message as { type: string; framesDone: number; framesTotal: number; message: string; manifest: AnimationManifest; error: string; cancelled: boolean };
        if (m.type === 'ready') {
          worker.send({ type: 'render', task: { dataRoot: path.resolve(dataRoot), id: run, context, settings: next, request, tools, configurationSha256 } });
          if (job.cancelRequested) worker.send({ type: 'cancel' });
        }
        if (m.type === 'progress' && !finishing) { job.framesDone = m.framesDone; job.framesTotal = m.framesTotal; job.progress = Math.min(98, Math.round(m.framesDone / Math.max(1, m.framesTotal) * 98)); if (!job.cancelRequested) job.message = m.message; void persist().catch(e => { console.error(e); worker.send({ type: 'cancel' }); }); }
        if (m.type === 'complete') void finish(m.manifest);
        if (m.type === 'error') void finish(undefined, m.error, m.cancelled);
      });
      worker.on('error', e => { void finish(undefined, e.message); });
      worker.on('close', (code, signal) => { if (!finishing) void finish(undefined, stderr || `Renderer process stopped (exit ${code}, signal ${signal ?? 'none'}).`); });
      return structuredClone(job);
    } finally { mutations.delete(id); }
  }
  async function cancel(id: string, run: string) {
    jobFile(id, run); const live = active.get(id);
    if (live?.job.id === run && !live.publishing && live.job.status === 'running') { live.job.cancelRequested = true; live.job.message = 'Stopping camera renderer…'; if (live.worker.connected) live.worker.send({ type: 'cancel' }); await live.persist(); return structuredClone(live.job); }
    return getJob(id, run);
  }
  async function file(id: string, run: string, name: string) {
    const job = await getJob(id, run); if (job.status !== 'complete' || !job.manifest) throw new ExtractionError(409, 'Downloads are available after the render completes and passes verification.');
    const relative = name === 'camera_animation_manifest.json' ? 'metadata/camera_animation_manifest.json' : job.manifest.videos.find(v => v.filename === name)?.relativePath;
    if (!relative) throw new ExtractionError(404, 'Animation file not found.');
    const directory = path.resolve(root(id), 'animation-runs', run), result = path.resolve(directory, relative);
    if (!result.startsWith(directory + path.sep)) throw new ExtractionError(400, 'Invalid animation path.'); return result;
  }
  return { current, saveSettings, start, cancel, getJob, file, isRunning };
}
