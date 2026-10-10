import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson } from './storage.js';
import type { AnimationJob, AnimationRequest, AnimationSettings } from '../shared/animation.js';
import { validId } from '../shared/project.js';
import { ExtractionError } from './extraction.js';

interface QueueRecord { version: 1; job: AnimationJob; settings: AnimationSettings; request: AnimationRequest; revision: number; queueState: 'queued' | 'running' | 'finished'; innerId?: string }
interface Processor { start(id: string, settings: AnimationSettings, request: AnimationRequest, revision: number): Promise<AnimationJob>; getJob(id: string, run: string): Promise<AnimationJob>; cancel(id: string, run: string): Promise<AnimationJob> }
export function createRenderQueue(dataRoot: string, processor: Processor, externalBusy: () => boolean, requestedProcesses = Number(process.env.FFMPEG_MAX_PROCESSES || 2)) {
  const maxProcesses = Number.isInteger(requestedProcesses) && requestedProcesses >= 2 && requestedProcesses <= 8 ? requestedProcesses : 2, maxJobs = Math.floor(maxProcesses / 2), records = new Map<string, QueueRecord>(), pending = new Set<string>(); let active = 0;
  const directory = path.join(dataRoot, 'render-queue'), filename = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid queue job ID.'); return path.join(directory, id + '.json'); };
  const ready = (async () => { await mkdir(directory, { recursive: true }); for (const f of await readdir(directory)) { if (!validId(f.replace(/\.json$/, ''))) continue; try { const r = await readJson<QueueRecord>(path.join(directory, f)); if (r.job.status === 'running') { r.queueState = 'finished'; r.job.status = 'failed'; r.job.error = 'Render queue interrupted by restart. Retry; completed assets are retained.'; r.job.message = r.job.error; await atomicJson(filename(r.job.id), r); } records.set(r.job.id, r); } catch { /* Ignore an unreadable queue record; it cannot publish media. */ } } })();
  async function run(record: QueueRecord) {
    active++; record.queueState = 'running';
    try { const inner = await processor.start(record.job.projectId, record.settings, record.request, record.revision); record.innerId = inner.id; if (record.job.cancelRequested) await processor.cancel(inner.projectId, inner.id); await atomicJson(filename(record.job.id), record);
      let current = inner; while (current.status === 'running') { await new Promise(r => setTimeout(r, 300)); current = await processor.getJob(inner.projectId, inner.id); if (current.status === 'running') record.job = { ...current, id: record.job.id }; }
      const completed = { ...record, queueState: 'finished' as const, job: { ...current, id: record.job.id } }; await atomicJson(filename(record.job.id), completed); Object.assign(record, completed);
    } catch (e) { record.queueState = 'finished'; record.job.status = 'failed'; record.job.error = (e as Error).message; record.job.message = 'Queued render failed. Retry with current settings.'; record.job.updatedAt = new Date().toISOString(); await atomicJson(filename(record.job.id), record); }
    finally { active--; pending.delete(record.job.projectId); pump(); }
  }
  function pump() { if (externalBusy()) { if ([...records.values()].some(r => r.queueState === 'queued')) { const timer = setTimeout(pump, 500); timer.unref(); } return; } for (const record of records.values()) { if (active >= maxJobs) break; if (record.queueState === 'queued') void run(record); } }
  async function enqueue(id: string, settings: AnimationSettings, request: AnimationRequest, revision: number) { await ready; if (pending.has(id)) throw new ExtractionError(409, 'This project already has a queued or running camera render.'); const now = new Date().toISOString(), runId = randomUUID(); const record: QueueRecord = { version: 1, settings: structuredClone(settings), request, revision, queueState: 'queued', job: { id: runId, projectId: id, status: 'running', progress: 0, framesDone: 0, framesTotal: 0, startedAt: now, updatedAt: now, cancelRequested: false, message: 'Queued for the local renderer…' } }; pending.add(id); records.set(runId, record); try { await atomicJson(filename(runId), record); } catch (e) { records.delete(runId); pending.delete(id); throw e; } setImmediate(pump); return structuredClone(record.job); }
  async function getJob(id: string, run: string) { await ready; filename(run); const record = records.get(run); if (!record || record.job.projectId !== id) return null; return structuredClone(record.job); }
  async function cancel(id: string, run: string) { await ready; const record = records.get(run); if (!record || record.job.projectId !== id) return null; if (record.queueState === 'queued') { record.queueState = 'finished'; record.job.status = 'cancelled'; record.job.message = 'Queued render cancelled.'; pending.delete(id); await atomicJson(filename(run), record); } else if (record.queueState === 'running') { record.job.cancelRequested = true; if (record.innerId) await processor.cancel(id, record.innerId); } return structuredClone(record.job); }
  async function list() { await ready; return { maximumFfmpegProcesses: maxProcesses, maximumCameraJobs: maxJobs, active, jobs: [...records.values()].reverse().slice(0, 50).map(r => ({ ...r.job, queueState: r.queueState, request: r.request })) }; }
  const isPending = (id: string) => pending.has(id);
  const current = (id: string) => [...records.values()].find(r => r.job.projectId === id && r.job.status === 'running')?.job;
  return { enqueue, getJob, cancel, list, isPending, current, isRunning: () => active > 0 };
}
