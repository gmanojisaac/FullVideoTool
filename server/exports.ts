import path from 'node:path';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError } from './extraction.js';
import { validId } from '../shared/project.js';
import type { ExportContext, ExportJob, ExportManifest, ExportReceipt, ExportScope, ExportSettings, ExportState } from '../shared/export.js';
import { collectValidatedFiles, exportFingerprint, jsonFile } from './export-validation.js';
import { writeVerifiedZip, hashFile } from './export-zip.js';

export function createExportService(dataRoot: string, getContext: (id: string) => Promise<ExportContext>) {
  const active = new Map<string, { job: ExportJob; controller: AbortController }>(), starting = new Set<string>();
  const root = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.join(dataRoot, 'exports', id); };
  const runRoot = (id: string, run: string) => { if (!validId(run)) throw new ExtractionError(400, 'Invalid export ID.'); return path.join(root(id), 'package-runs', run); };
  const jobFile = (id: string, run: string) => path.join(runRoot(id, run), 'job.json');
  const isRunning = (id: string) => active.has(id) || starting.has(id);
  async function settings(id: string): Promise<ExportSettings> { try { return await readJson(path.join(root(id), 'metadata', 'export_settings.json')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projectName: '', lessonTitle: '' }; throw e; } }
  async function saveSettings(id: string, value: ExportSettings) {
    if (isRunning(id)) throw new ExtractionError(409, 'Wait or cancel packaging before editing export settings.');
    if (!value || value.version !== 1 || typeof value.projectName !== 'string' || typeof value.lessonTitle !== 'string' || value.projectName.length > 200 || value.lessonTitle.length > 200) throw new ExtractionError(400, 'Project name and lesson title must be at most 200 characters.');
    const next: ExportSettings = { version: 1, projectName: value.projectName.trim(), lessonTitle: value.lessonTitle.trim() }; await atomicJson(path.join(root(id), 'metadata', 'export_settings.json'), next); return next;
  }
  async function getJob(id: string, run: string): Promise<ExportJob> {
    const filename = jobFile(id, run), live = active.get(id); if (live?.job.id === run) return structuredClone(live.job);
    let job: ExportJob; try { job = await readJson(filename); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ExtractionError(404, 'Export job not found.'); throw e; }
    if (job.status === 'running') { job.status = 'failed'; job.error = 'Packaging interrupted by service restart. Retry.'; job.message = job.error; await atomicJson(filename, job); for (const name of await readdir(runRoot(id, run))) if (name.endsWith('.partial')) await unlink(path.join(runRoot(id, run), name)); }
    return job;
  }
  async function current(id: string): Promise<ExportState> {
    const value = await settings(id), state: ExportState = { settings: value, job: null, receipt: null, current: false }; let context: ExportContext | undefined;
    try { context = await getContext(id); } catch (e) { state.reason = e instanceof Error ? e.message : String(e); }
    try { const ref = await readJson<{ id: string }>(path.join(root(id), 'active-export.json')); state.job = await getJob(id, ref.id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof ExtractionError && e.status === 404)) throw e; }
    try { const ref = await readJson<{ id: string }>(path.join(root(id), 'latest-export.json')); const job = await getJob(id, ref.id); if (job.receipt) { state.receipt = job.receipt; const m = await readJson<ExportManifest>(path.join(runRoot(id, ref.id), 'export_manifest.json')); state.current = !!context && m.configurationSha256 === fingerprint(context, value); } } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return state;
  }
  const fingerprint = (c: ExportContext, s: ExportSettings) => createHash('sha256').update(exportFingerprint(c) + JSON.stringify(s)).digest('hex');
  async function start(id: string, scope: ExportScope): Promise<ExportJob> {
    if (isRunning(id)) throw new ExtractionError(409, 'An export is already running.'); if (!['complete', 'mobile', 'desktop'].includes(scope)) throw new ExtractionError(400, 'Choose mobile, desktop or complete export.');
    starting.add(id);
    try {
      const context = await getContext(id), value = await settings(id), configuration = fingerprint(context, value), run = randomUUID(), now = new Date().toISOString(), directory = runRoot(id, run);
      await mkdir(directory, { recursive: true }); const job: ExportJob = { id: run, projectId: id, scope, status: 'running', progress: 0, message: 'Validating current assets…', startedAt: now, updatedAt: now }, controller = new AbortController();
      await atomicJson(jobFile(id, run), job); await atomicJson(path.join(root(id), 'active-export.json'), { id: run }); active.set(id, { job, controller });
      async function process() {
        try {
          const validated = await collectValidatedFiles(dataRoot, context, scope, value, controller.signal, (message, n) => { job.message = message; job.progress = Math.round(n * 65); }); job.validation = validated.report;
          if (validated.report.status !== 'PASS') throw new Error(validated.report.results.filter(r => r.status === 'FAIL').map(r => `${r.filename}: ${r.reason}`).join('\n'));
          const manifest: ExportManifest = { version: 1, packageVersion: 1, applicationVersion: '2.0.0', module: 7, projectId: id, exportId: run, projectName: value.projectName || context.project.title, lessonTitle: value.lessonTitle, scope, exportedAt: now, configurationSha256: configuration, totalFileCount: validated.files.length + 1, overallValidation: 'PASS', files: validated.files.map(f => f.entry), validation: validated.report, manifestCoverage: 'Every payload file is listed. The manifest cannot hash itself; its exact SHA-256 and the archive SHA-256 are recorded in the separately downloadable export receipt.' };
          const manifestFile = jsonFile('metadata/export_manifest.json', manifest); await atomicJson(path.join(directory, 'export_manifest.json'), manifest);
          const slug = (value.projectName || context.project.title).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'six-tile-lesson', filename = `${slug}_${scope}.zip`;
          job.message = 'Streaming and independently verifying ZIP…'; const archive = await writeVerifiedZip(path.join(directory, filename), [...validated.files, manifestFile], controller.signal, n => { job.progress = 65 + Math.round(n * 30); });
          controller.signal.throwIfAborted(); if (fingerprint(await getContext(id), await settings(id)) !== configuration) throw new Error('Project assets or settings changed during packaging. Retry.');
          const url = `/api/projects/${id}/exports/${run}/files/`, receipt: ExportReceipt = { version: 1, exportId: run, projectId: id, filename, ...archive, manifestSha256: manifestFile.entry.sha256, zipValidation: 'PASS', completedAt: new Date().toISOString(), downloadUrl: url + filename, manifestUrl: url + 'export_manifest.json', receiptUrl: url + 'export_receipt.json' };
          await atomicJson(path.join(directory, 'export_receipt.json'), receipt); const completed: ExportJob = { ...job, status: 'complete', progress: 100, message: `${archive.fileCount} files packaged; ZIP checksums PASS.`, updatedAt: receipt.completedAt, receipt }; await atomicJson(jobFile(id, run), completed); await atomicJson(path.join(root(id), 'latest-export.json'), { id: run }); Object.assign(job, completed);
        } catch (e) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.message = job.status === 'cancelled' ? 'Export cancelled. Previous completed packages are retained.' : 'Export failed. Correct the listed assets and retry.'; job.error = job.status === 'failed' ? e instanceof Error ? e.message : String(e) : undefined; job.updatedAt = new Date().toISOString(); await atomicJson(jobFile(id, run), job); }
        finally { active.delete(id); }
      }
      setImmediate(() => void process().catch(e => { console.error(e); active.delete(id); })); return structuredClone(job);
    } finally { starting.delete(id); }
  }
  async function cancel(id: string, run: string) { jobFile(id, run); const live = active.get(id); if (live?.job.id === run) { live.controller.abort(); live.job.message = 'Cancelling export…'; return structuredClone(live.job); } return getJob(id, run); }
  async function file(id: string, run: string, name: string) {
    const job = await getJob(id, run); if (!job.receipt || job.status !== 'complete') throw new ExtractionError(409, 'Export has not completed successfully.'); const receipt = job.receipt;
    if (![receipt.filename, 'export_manifest.json', 'export_receipt.json'].includes(name)) throw new ExtractionError(404, 'Export asset not found.');
    const filename = path.join(runRoot(id, run), name); if (name === receipt.filename && await hashFile(filename) !== receipt.archiveSha256) throw new ExtractionError(409, 'Archive checksum changed. Generate a new export.'); return filename;
  }
  return { current, settings, saveSettings, getJob, start, cancel, file, isRunning };
}
