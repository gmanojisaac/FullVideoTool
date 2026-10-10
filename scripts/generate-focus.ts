import { validId } from '../shared/project.js';
import type { FocusJob, FocusState } from '../shared/focus.js';

const id = process.argv[2], base = 'http://127.0.0.1:3001';
if (!validId(id)) throw new Error('Usage: npm run focus-previews -- <saved-project-id> (start the local service first).');
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`); return value as T;
}
const state = await request<FocusState>(`/api/projects/${id}/focus`);
let job = await request<FocusJob>(`/api/projects/${id}/focus-previews`, { expectedRevision: state.config.revision });
const deadline = Date.now() + 90_000;
while (job.status === 'running') {
  if (Date.now() > deadline) throw new Error('Rendering is still running. Reopen the project in Step 4 to follow progress.');
  await new Promise(resolve => setTimeout(resolve, 250)); job = await request<FocusJob>(`/api/projects/${id}/focus-previews/${job.id}`);
}
if (job.status !== 'complete' || !job.manifest) throw new Error(job.error ?? job.message);
console.log(JSON.stringify({ status: job.status, projectId: id, generationId: job.id, provisional: true, directory: job.manifest.outputDirectory, previews: job.manifest.previews.map(p => ({ filename: p.filename, width: p.width, height: p.height, cameraMode: p.cameraMode, imageUrl: base + p.imageUrl })) }, null, 2));
