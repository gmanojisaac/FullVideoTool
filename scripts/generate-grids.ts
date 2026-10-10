import type { ExtractionManifest } from '../shared/extraction.js';
import type { GridJob, GridState } from '../shared/layout.js';
import { validId } from '../shared/project.js';

const id = process.argv[2], base = 'http://127.0.0.1:3001';
if (!validId(id)) throw new Error('Usage: npm run grids -- <saved-project-id> (start npm run dev first).');
async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(base + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value as T;
}
const { manifest: source } = await request<{ manifest: ExtractionManifest | null }>(`/api/projects/${id}/extraction`);
if (!source) throw new Error('Save the project and complete Step 2 extraction first.');
const { settings } = await request<GridState>(`/api/projects/${id}/layouts`);
let job = await request<GridJob>(`/api/projects/${id}/layouts`, { settings, expectedExtractionId: source.extractionId });
const deadline = Date.now() + 60_000;
while (job.status === 'running') {
  if (Date.now() > deadline) throw new Error('Generation is still running. Reopen the project in the editor to follow its progress.');
  await new Promise(resolve => setTimeout(resolve, 250));
  job = await request<GridJob>(`/api/projects/${id}/layouts/${job.id}`);
}
if (job.status !== 'complete' || !job.manifest) throw new Error(job.error ?? job.message);
console.log(JSON.stringify({ status: job.status, projectId: id, generationId: job.id, directory: job.manifest.outputDirectory, outputs: Object.values(job.manifest.outputs).map(o => ({ format: o.format, filename: o.filename, width: o.width, height: o.height, equalCells: `${o.geometry.cellWidth}x${o.geometry.cellHeight}`, appliedGutter: o.geometry.internalGutter, imageUrl: base + o.imageUrl })) }, null, 2));
