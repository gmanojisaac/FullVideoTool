import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readJson } from './storage.js';
import { abortIfRequested, configurationHash, ExtractionError, extractTiles, sha256 } from './extraction.js';
import { validId, type Project } from '../shared/project.js';
import { validateExtractionProject, type ExtractionJob, type ExtractionManifest } from '../shared/extraction.js';

export function createExtractionJobs(dataRoot: string) {
  const exportsRoot = path.resolve(dataRoot, 'exports');
  const active = new Map<string, { job: ExtractionJob; controller: AbortController; persist: () => Promise<void>; isPublishing: () => boolean }>();
  const starting = new Set<string>();
  const projectDirectory = (id: string) => {
    if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.');
    return path.join(exportsRoot, id);
  };
  const jobFilename = (projectId: string, id: string) => {
    if (!validId(id)) throw new ExtractionError(400, 'Invalid extraction ID.');
    return path.join(projectDirectory(projectId), 'jobs', `${id}.json`);
  };

  async function getJob(projectId: string, id: string): Promise<ExtractionJob> {
    const live = active.get(projectId);
    if (live?.job.id === id) return structuredClone(live.job);
    let job: ExtractionJob;
    try { job = await readJson<ExtractionJob>(jobFilename(projectId, id)); }
    catch (error) {
      if (error instanceof ExtractionError) throw error;
      throw new ExtractionError(404, 'Extraction job not found.');
    }
    if (job.status === 'running') {
      job = { ...job, status: 'failed', error: 'The service stopped during extraction. Retry with the saved panel coordinates.', message: 'Extraction interrupted. Please retry.', updatedAt: new Date().toISOString() };
      await atomicJson(jobFilename(projectId, id), job);
    }
    return job;
  }

  async function start(project: Project, expectedUpdatedAt: unknown) {
    const errors = validateExtractionProject(project);
    if (errors.length) throw new ExtractionError(400, errors.join(' '));
    if (expectedUpdatedAt !== project.updatedAt) throw new ExtractionError(409, 'The saved project changed. Reopen it or save your reviewed boundaries before extracting.');
    if (active.has(project.id) || starting.has(project.id)) throw new ExtractionError(409, 'This project is already being extracted. Wait or cancel the current job.');
    starting.add(project.id);
    try {
      const source = await readFile(path.join(dataRoot, 'inputs', `${project.input.id}.${project.input.format}`));
      if (sha256(source) !== project.input.sha256) throw new ExtractionError(409, 'The original image checksum has changed. Upload the original again.');
      const id = randomUUID(), now = new Date().toISOString();
      const job: ExtractionJob = {
        id, projectId: project.id, configurationSha256: configurationHash(project), status: 'running', completedTiles: 0,
        totalTiles: 6, progress: 0, message: 'Preparing the approved panel rectangles…',
        startedAt: now, updatedAt: now, cancelRequested: false,
      };
      const controller = new AbortController();
      let publishing = false;
      let writes = Promise.resolve();
      function persist() {
        job.updatedAt = new Date().toISOString();
        const snapshot = structuredClone(job);
        writes = writes.then(() => atomicJson(jobFilename(project.id, id), snapshot));
        return writes;
      }
      await persist();
      await atomicJson(path.join(projectDirectory(project.id), 'active.json'), { id });
      active.set(project.id, { job, controller, persist, isPublishing: () => publishing });
      const directory = path.join(projectDirectory(project.id), 'runs', id);
      const displayDirectory = `data/exports/${project.id}/runs/${id}`;
      async function run() {
        try {
          const manifest = await extractTiles({
            project, source, runId: id, directory, displayDirectory, signal: controller.signal,
            onProgress: async (completedTiles, progress, message) => {
              Object.assign(job, { completedTiles, progress, message }); await persist();
            },
          });
          abortIfRequested(controller.signal);
          const current = await readJson<Project>(path.join(dataRoot, 'projects', `${project.id}.json`));
          if (configurationHash(current) !== manifest.configurationSha256) throw new ExtractionError(409, 'Panel coordinates changed during extraction. Review and re-extract the saved layout.');
          abortIfRequested(controller.signal);
          // Once verification has passed, publishing is a short, indivisible commit for cancellation.
          publishing = true;
          const complete: ExtractionJob = { ...job, manifest, progress: 100, completedTiles: 6, status: 'complete', message: 'Six tiles extracted. All decoded pixels match the original regions.', updatedAt: new Date().toISOString() };
          await atomicJson(jobFilename(project.id, id), complete);
          await atomicJson(path.join(projectDirectory(project.id), 'latest.json'), { id, configurationSha256: manifest.configurationSha256 });
          Object.assign(job, complete);
        } catch (error) {
          job.status = controller.signal.aborted ? 'cancelled' : 'failed';
          job.message = job.status === 'cancelled' ? 'Extraction cancelled. Your saved panel coordinates are unchanged.' : 'Extraction failed. You can retry with the same saved coordinates.';
          job.error = job.status === 'cancelled' ? undefined : error instanceof Error ? error.message : String(error);
          delete job.manifest;
          // Only remove this incomplete UUID run, after checking its absolute target.
          const resolved = path.resolve(directory), runsRoot = path.resolve(projectDirectory(project.id), 'runs');
          if (path.dirname(resolved) !== runsRoot || !validId(path.basename(resolved))) throw new Error('Unsafe extraction cleanup path.');
          await rm(resolved, { recursive: true, force: true });
          await persist();
        } finally { active.delete(project.id); }
      }
      // Yield to the HTTP response first; every asynchronous failure is recorded or logged.
      setImmediate(() => { void run().catch(error => { console.error('Could not finish extraction job:', error); active.delete(project.id); }); });
      return structuredClone(job);
    } finally { starting.delete(project.id); }
  }

  async function cancel(projectId: string, id: string) {
    const live = active.get(projectId);
    if (live?.job.id === id && live.job.status === 'running' && !live.isPublishing()) {
      live.controller.abort(); live.job.cancelRequested = true;
      live.job.message = 'Cancellation requested. Finishing the current image operation…';
      await live.persist(); return structuredClone(live.job);
    }
    return getJob(projectId, id);
  }

  async function current(project: Project) {
    const directory = projectDirectory(project.id), hash = configurationHash(project);
    let manifest: ExtractionManifest | null = null, job: ExtractionJob | null = null;
    try {
      const latest = await readJson<{ id: string; configurationSha256: string }>(path.join(directory, 'latest.json'));
      if (latest.configurationSha256 === hash) {
        const complete = await getJob(project.id, latest.id);
        if (complete.status === 'complete') manifest = complete.manifest ?? null;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof ExtractionError && error.status === 404)) throw error; }
    try {
      const reference = await readJson<{ id: string }>(path.join(directory, 'active.json'));
      const lastJob = await getJob(project.id, reference.id);
      if (lastJob.configurationSha256 === hash) job = lastJob;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof ExtractionError && error.status === 404)) throw error; }
    return { manifest, job };
  }

  async function file(projectId: string, id: string, filename: string) {
    const job = await getJob(projectId, id);
    if (job.status !== 'complete' || !job.manifest) throw new ExtractionError(409, 'Downloads are available only after all six tiles pass verification.');
    const relative = /^tile_0[1-6]\.png$/.test(filename) ? path.join('tiles', filename)
      : filename === 'tile_extraction_manifest.json' ? path.join('metadata', filename)
      : filename === 'six_extracted_tiles.zip' ? filename : null;
    if (!relative) throw new ExtractionError(404, 'Extraction file not found.');
    return path.join(projectDirectory(projectId), 'runs', id, relative);
  }

  return { start, getJob, cancel, current, file, isRunning: (id: string) => active.has(id) || starting.has(id) };
}
