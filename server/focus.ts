import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { atomicJson, readJson } from './storage.js';
import { abortIfRequested, ExtractionError, sha256 } from './extraction.js';
import { validId } from '../shared/project.js';
import type { ExtractionManifest } from '../shared/extraction.js';
import type { LayoutManifest } from '../shared/layout.js';
import { canonicalFocusConfig, defaultFocusConfig, focusFilename, focusKey, focusPixelConfiguration, validateFocusConfig, type FocusConfig, type FocusJob, type FocusPreviewManifest, type FocusState } from '../shared/focus.js';
import { renderFocusPixels } from '../shared/focus-render.js';

export interface FocusContext { layout: LayoutManifest; source: ExtractionManifest }
export const focusHash = (config: FocusConfig) => sha256(JSON.stringify(focusPixelConfiguration(config)));

export function createFocusService(dataRoot: string, getContext: (id: string) => Promise<FocusContext>) {
  const active = new Map<string, { job: FocusJob; controller: AbortController; persist: () => Promise<void>; publishing: boolean }>();
  const mutations = new Set<string>();
  const projectRoot = (id: string) => {
    if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.');
    return path.resolve(dataRoot, 'exports', id);
  };
  const configFile = (id: string) => path.join(projectRoot(id), 'metadata', 'focus_config.json');
  const jobFile = (id: string, run: string) => {
    if (!validId(run)) throw new ExtractionError(400, 'Invalid focus preview ID.');
    return path.join(projectRoot(id), 'focus-jobs', `${run}.json`);
  };
  const isRunning = (id: string) => active.has(id) || mutations.has(id);
  async function loadConfig(context: FocusContext): Promise<FocusConfig> {
    const { layout, source } = context;
    try {
      const config = await readJson<FocusConfig>(configFile(layout.projectId));
      // New grid geometry requires fresh framing, while the previous file remains
      // intact until the user saves new edits. Old exported previews are retained.
      if (config.layoutGenerationId !== layout.generationId) return defaultFocusConfig(layout, source);
      const errors = validateFocusConfig(config, layout, source);
      if (errors.length) throw new ExtractionError(409, errors.join(' '));
      return canonicalFocusConfig(config, layout, source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const defaults = defaultFocusConfig(layout, source);
        try {
          const recipe = await readJson<FocusConfig>(path.join(projectRoot(layout.projectId), 'metadata', 'duplicate_focus_recipe.json'));
          const rebased = { ...defaults, views: defaults.views.map(v => { const previous = recipe.views.find(p => p.format === v.format && p.tileNumber === v.tileNumber); return previous ? { ...v, cameraMode: previous.cameraMode, native: previous.native, detail: previous.detail, manualOverride: previous.manualOverride, approved: false, lastSavedAt: null } : v; }) };
          return canonicalFocusConfig(rebased, layout, source);
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        return defaults;
      }
      throw error;
    }
  }
  async function save(id: string, value: unknown, expectedRevision: unknown, approvedKey?: unknown) {
    if (isRunning(id)) throw new ExtractionError(409, 'A framing save or preview render is in progress. Retry after it finishes.');
    mutations.add(id);
    try {
      const context = await getContext(id), errors = validateFocusConfig(value, context.layout, context.source);
      if (errors.length) throw new ExtractionError(400, errors.join(' '));
      const previous = await loadConfig(context);
      if (expectedRevision !== previous.revision) throw new ExtractionError(409, 'Framing changed in another editor. Reload this project before saving.');
      if (approvedKey !== undefined && (typeof approvedKey !== 'string' || !/^(mobile|desktop)-[1-6]$/.test(approvedKey))) throw new ExtractionError(400, 'Invalid framing approval.');
      const next = canonicalFocusConfig(value as FocusConfig, context.layout, context.source), now = new Date().toISOString();
      next.views = next.views.map(v => {
        const old = previous.views.find(p => focusKey(p) === focusKey(v));
        const changed = !old || JSON.stringify({ mode: old.cameraMode, native: old.native, detail: old.detail }) !== JSON.stringify({ mode: v.cameraMode, native: v.native, detail: v.detail });
        return { ...v, approved: approvedKey === focusKey(v) ? true : changed ? false : old?.approved ?? false, lastSavedAt: changed || approvedKey === focusKey(v) ? now : old?.lastSavedAt ?? now };
      });
      next.revision = previous.revision + 1; next.updatedAt = now;
      await atomicJson(configFile(id), next);
      return next;
    } finally { mutations.delete(id); }
  }
  async function getJob(id: string, run: string): Promise<FocusJob> {
    const filename = jobFile(id, run), live = active.get(id);
    if (live?.job.id === run) return structuredClone(live.job);
    let job: FocusJob;
    try { job = await readJson<FocusJob>(filename); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ExtractionError(404, 'Focus preview job not found.'); throw error; }
    if (job.status === 'running') { job = { ...job, status: 'failed', error: 'The service stopped during preview rendering. Generate the previews again.', message: 'Rendering interrupted. Retry.', updatedAt: new Date().toISOString() }; await atomicJson(filename, job); }
    return job;
  }
  async function current(id: string): Promise<FocusState> {
    const context = await getContext(id), config = await loadConfig(context), state: FocusState = { config, manifest: null, job: null };
    for (const name of ['latest-focus.json', 'active-focus.json']) {
      try {
        const reference = await readJson<{ id: string }>(path.join(projectRoot(id), name));
        const job = await getJob(id, reference.id);
        if (job.layoutGenerationId !== context.layout.generationId) continue;
        if (name === 'active-focus.json') state.job = job;
        if (name === 'latest-focus.json' && job.status === 'complete' && job.manifest?.configurationSha256 === focusHash(config)) state.manifest = job.manifest;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof ExtractionError && error.status === 404)) throw error; }
    }
    return state;
  }
  async function sourcePixels(context: FocusContext, mode: 'native' | 'detail', format: string, number: number) {
    const { layout, source } = context;
    const item = mode === 'native' ? layout.outputs[format as 'mobile' | 'desktop'] : source.tiles[number - 1];
    const filename = mode === 'native' ? path.join(projectRoot(layout.projectId), 'layout-runs', layout.generationId, 'layouts', item.filename) : path.join(projectRoot(layout.projectId), 'runs', source.extractionId, 'tiles', item.filename);
    const bytes = await readFile(filename);
    if (sha256(bytes) !== item.pngSha256) throw new ExtractionError(409, `Source ${item.filename} changed. Regenerate its preceding stage.`);
    const raw = await sharp(bytes, { failOn: 'warning' }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (raw.info.width !== item.width || raw.info.height !== item.height) throw new ExtractionError(409, 'Source image dimensions changed.');
    return raw.data;
  }
  async function start(id: string, expectedRevision: unknown) {
    if (isRunning(id)) throw new ExtractionError(409, 'Wait or cancel the current focus operation.');
    mutations.add(id);
    try {
      const context = await getContext(id), config = await loadConfig(context);
      if (expectedRevision !== config.revision) throw new ExtractionError(409, 'Save your latest framing before generating previews.');
      // Persist all twelve defaults too, even when no individual view was edited.
      if (!config.updatedAt) { config.updatedAt = new Date().toISOString(); config.views.forEach(v => { v.lastSavedAt = config.updatedAt; }); await atomicJson(configFile(id), config); }
      const run = randomUUID(), now = new Date().toISOString();
      const job: FocusJob = { id: run, projectId: id, layoutGenerationId: context.layout.generationId, status: 'running', progress: 0, message: 'Loading the approved grid surfaces…', cancelRequested: false, startedAt: now, updatedAt: now };
      let writes = Promise.resolve();
      const persist = () => { job.updatedAt = new Date().toISOString(); const snapshot = structuredClone(job); writes = writes.then(() => atomicJson(jobFile(id, run), snapshot)); return writes; };
      const live = { job, persist, controller: new AbortController(), publishing: false };
      await persist(); await atomicJson(path.join(projectRoot(id), 'active-focus.json'), { id: run }); active.set(id, live);
      async function render() {
        try {
          const directory = path.join(projectRoot(id), 'focus-runs', run);
          await mkdir(path.join(directory, 'previews'), { recursive: true });
          const cache = new Map<string, Buffer>();
          const manifest: FocusPreviewManifest = { version: 1, module: 4, provisional: true, projectId: id, generationId: run, layoutGenerationId: context.layout.generationId, configurationSha256: focusHash(config), generatedAt: now, outputDirectory: `data/exports/${id}/focus-runs/${run}`, previews: [], configUrl: `/api/projects/${id}/focus-previews/${run}/files/focus_config.json?download=1` };
          for (const [i, view] of config.views.entries()) {
            abortIfRequested(live.controller.signal);
            const key = view.cameraMode === 'native' ? `grid-${view.format}` : `tile-${view.tileNumber}`;
            let raw = cache.get(key);
            if (!raw) { raw = await sourcePixels(context, view.cameraMode, view.format, view.tileNumber); cache.set(key, raw); }
            const pixels = renderFocusPixels(raw, view.transform);
            const png = await sharp(pixels, { raw: { width: view.transform.viewport.width, height: view.transform.viewport.height, channels: 4 } }).png().toBuffer();
            const filename = focusFilename(view.format, view.tileNumber), url = `/api/projects/${id}/focus-previews/${run}/files/${filename}`;
            await writeFile(path.join(directory, 'previews', filename), png);
            manifest.previews.push({ tileNumber: view.tileNumber, format: view.format, filename, width: view.transform.viewport.width, height: view.transform.viewport.height, cameraMode: view.cameraMode, pngSha256: sha256(png), imageUrl: url, downloadUrl: `${url}?download=1` });
            job.progress = Math.round((i + 1) / 12 * 95); job.message = `Rendered ${i + 1}/12 provisional stills.`; await persist();
            // Cancellation, progress polling and autosave requests get event-loop time.
            await new Promise<void>(resolve => setImmediate(resolve));
          }
          abortIfRequested(live.controller.signal);
          const currentContext = await getContext(id), currentConfig = await loadConfig(currentContext);
          if (currentContext.layout.generationId !== context.layout.generationId || focusHash(currentConfig) !== manifest.configurationSha256) throw new ExtractionError(409, 'Grid or focus settings changed during rendering. Regenerate.');
          abortIfRequested(live.controller.signal); live.publishing = true;
          await atomicJson(path.join(directory, 'metadata', 'focus_config.json'), config);
          await atomicJson(path.join(directory, 'metadata', 'focus_preview_manifest.json'), manifest);
          const complete: FocusJob = { ...job, manifest, status: 'complete', progress: 100, message: 'Twelve provisional focus stills are ready.', updatedAt: new Date().toISOString() };
          await atomicJson(jobFile(id, run), complete); await atomicJson(path.join(projectRoot(id), 'latest-focus.json'), { id: run }); Object.assign(job, complete);
        } catch (error) { job.status = live.controller.signal.aborted ? 'cancelled' : 'failed'; job.message = job.status === 'cancelled' ? 'Focus preview generation cancelled.' : 'Focus preview generation failed. Retry.'; job.error = job.status === 'cancelled' ? undefined : error instanceof Error ? error.message : String(error); await persist(); }
        finally { active.delete(id); }
      }
      setImmediate(() => { void render().catch(error => { console.error('Could not finish focus previews:', error); active.delete(id); }); });
      return structuredClone(job);
    } finally { mutations.delete(id); }
  }
  async function cancel(id: string, run: string) {
    const live = active.get(id);
    if (live?.job.id === run && !live.publishing && live.job.status === 'running') { live.controller.abort(); live.job.cancelRequested = true; live.job.message = 'Cancelling after the current still…'; await live.persist(); return structuredClone(live.job); }
    return getJob(id, run);
  }
  async function file(id: string, run: string, name: string) {
    const job = await getJob(id, run);
    if (job.status !== 'complete') throw new ExtractionError(409, 'Downloads are available once all twelve previews finish.');
    const folder = /^(mobile|desktop)_tile_0[1-6]_focus_preview\.png$/.test(name) ? 'previews' : ['focus_config.json', 'focus_preview_manifest.json'].includes(name) ? 'metadata' : null;
    if (!folder) throw new ExtractionError(404, 'Focus preview file not found.');
    return path.join(projectRoot(id), 'focus-runs', run, folder, name);
  }
  return { current, save, start, cancel, getJob, file, isRunning };
}
