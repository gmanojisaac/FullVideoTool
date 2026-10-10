import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { abortIfRequested, ExtractionError } from './extraction.js';
import { layoutHash, reconstructGrids } from './layout.js';
import { validId } from '../shared/project.js';
import type { ExtractionManifest } from '../shared/extraction.js';
import { canonicalSettings, defaultGridSettings, validateGridSettings, type GridJob, type GridSettings, type GridState } from '../shared/layout.js';

export function createLayoutJobs(dataRoot: string, getCurrentSource: (projectId: string) => Promise<ExtractionManifest | null>) {
  const active = new Map<string, { job: GridJob; controller: AbortController; persist: () => Promise<void>; publishing: boolean }>();
  const starting = new Set<string>();
  function projectRoot(id: string) {
    if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.');
    return path.resolve(dataRoot, 'exports', id);
  }
  function jobFile(projectId: string, id: string) {
    if (!validId(id)) throw new ExtractionError(400, 'Invalid grid generation ID.');
    return path.join(projectRoot(projectId), 'layout-jobs', `${id}.json`);
  }
  const settingsFile = (id: string) => path.join(projectRoot(id), 'grid-settings.json');
  async function getSettings(id: string) {
    try {
      const settings = await readJson<GridSettings>(settingsFile(id));
      if (validateGridSettings(settings).length) throw new ExtractionError(409, 'Saved grid settings are invalid. Save new settings to recover.');
      return canonicalSettings(settings);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultGridSettings(); throw error; }
  }
  async function getJob(projectId: string, id: string): Promise<GridJob> {
    const live = active.get(projectId);
    if (live?.job.id === id) return structuredClone(live.job);
    let job: GridJob;
    const filename = jobFile(projectId, id);
    try { job = await readJson<GridJob>(filename); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ExtractionError(404, 'Grid generation not found.'); throw error; }
    if (job.status === 'running') {
      job = { ...job, status: 'failed', error: 'The service stopped during grid generation. Regenerate from your saved settings.', message: 'Generation interrupted. Please retry.', updatedAt: new Date().toISOString() };
      await atomicJson(filename, job);
    }
    return job;
  }
  const isRunning = (id: string) => active.has(id) || starting.has(id);
  async function saveSettings(id: string, value: unknown) {
    if (isRunning(id)) throw new ExtractionError(409, 'Wait or cancel grid generation before editing its saved settings.');
    const errors = validateGridSettings(value);
    if (errors.length) throw new ExtractionError(400, errors.join(' '));
    const settings = canonicalSettings(value as GridSettings);
    await atomicJson(settingsFile(id), settings);
    return settings;
  }
  async function start(source: ExtractionManifest, value: unknown, expectedExtractionId: unknown) {
    if (expectedExtractionId !== source.extractionId) throw new ExtractionError(409, 'Extracted tiles changed. Reopen the project before generating grids.');
    const errors = validateGridSettings(value);
    if (errors.length) throw new ExtractionError(400, errors.join(' '));
    if (isRunning(source.projectId)) throw new ExtractionError(409, 'This project is already generating grids. Wait or cancel.');
    starting.add(source.projectId);
    try {
      const settings = canonicalSettings(value as GridSettings), id = randomUUID(), now = new Date().toISOString();
      const job: GridJob = { id, projectId: source.projectId, extractionId: source.extractionId, configurationSha256: layoutHash(source, settings), status: 'running', progress: 0, message: 'Checking the six extracted PNGs…', startedAt: now, updatedAt: now, cancelRequested: false };
      let writes = Promise.resolve();
      const persist = () => {
        job.updatedAt = new Date().toISOString();
        const snapshot = structuredClone(job);
        writes = writes.then(() => atomicJson(jobFile(source.projectId, id), snapshot));
        return writes;
      };
      const live = { job, controller: new AbortController(), persist, publishing: false };
      await atomicJson(settingsFile(source.projectId), settings);
      await persist();
      await atomicJson(path.join(projectRoot(source.projectId), 'active-layout.json'), { id });
      active.set(source.projectId, live);
      async function run() {
        try {
          const manifest = await reconstructGrids({ source, settings, generationId: id, tileDirectory: path.join(projectRoot(source.projectId), 'runs', source.extractionId, 'tiles'), directory: path.join(projectRoot(source.projectId), 'layout-runs', id), displayDirectory: `data/exports/${source.projectId}/layout-runs/${id}`, signal: live.controller.signal, onProgress: async (progress, message) => { Object.assign(job, { progress, message }); await persist(); } });
          abortIfRequested(live.controller.signal);
          const current = await getCurrentSource(source.projectId);
          if (current?.extractionId !== source.extractionId || current.configurationSha256 !== source.configurationSha256) throw new ExtractionError(409, 'Source panels changed during generation. Re-extract and regenerate.');
          abortIfRequested(live.controller.signal);
          live.publishing = true;
          const complete: GridJob = { ...job, status: 'complete', progress: 100, message: 'Mobile and desktop PNG grids are ready.', manifest, updatedAt: new Date().toISOString() };
          await atomicJson(jobFile(source.projectId, id), complete);
          await atomicJson(path.join(projectRoot(source.projectId), 'latest-layout.json'), { id });
          Object.assign(job, complete);
        } catch (error) {
          job.status = live.controller.signal.aborted ? 'cancelled' : 'failed';
          job.message = job.status === 'cancelled' ? 'Grid generation cancelled. Previous exports are preserved.' : 'Grid generation failed. You can retry with the saved settings.';
          job.error = job.status === 'cancelled' ? undefined : error instanceof Error ? error.message : String(error);
          delete job.manifest;
          await persist();
        } finally { active.delete(source.projectId); }
      }
      setImmediate(() => { void run().catch(error => { console.error('Could not finish grid generation:', error); active.delete(source.projectId); }); });
      return structuredClone(job);
    } finally { starting.delete(source.projectId); }
  }
  async function cancel(projectId: string, id: string) {
    const live = active.get(projectId);
    if (live?.job.id === id && live.job.status === 'running' && !live.publishing) {
      live.controller.abort(); live.job.cancelRequested = true;
      live.job.message = 'Cancellation requested. Finishing the current image operation…';
      await live.persist(); return structuredClone(live.job);
    }
    return getJob(projectId, id);
  }
  async function current(projectId: string, source: ExtractionManifest | null): Promise<GridState> {
    const settings = await getSettings(projectId), state: GridState = { settings, manifest: null, job: null };
    if (!source) return state;
    const fingerprint = layoutHash(source, settings);
    for (const name of ['latest-layout.json', 'active-layout.json']) {
      try {
        const reference = await readJson<{ id: string }>(path.join(projectRoot(projectId), name));
        const job = await getJob(projectId, reference.id);
        if (job.configurationSha256 !== fingerprint) continue;
        if (name === 'latest-layout.json' && job.status === 'complete') state.manifest = job.manifest ?? null;
        if (name === 'active-layout.json') state.job = job;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof ExtractionError && error.status === 404)) throw error; }
    }
    return state;
  }
  async function file(projectId: string, id: string, filename: string) {
    const job = await getJob(projectId, id);
    if (job.status !== 'complete' || !job.manifest) throw new ExtractionError(409, 'Downloads unlock after both grids finish.');
    const folder = ['mobile_six_tile_grid.png', 'desktop_six_tile_grid.png'].includes(filename) ? 'layouts' : filename === 'layout_manifest.json' ? 'metadata' : null;
    if (!folder) throw new ExtractionError(404, 'Grid file not found.');
    return path.join(projectRoot(projectId), 'layout-runs', id, folder, filename);
  }
  return { start, getJob, current, cancel, file, saveSettings, isRunning };
}
