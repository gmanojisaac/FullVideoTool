import { defaultAnimationSettings, type AnimationJob, type AnimationManifest, type AnimationSettings } from '../shared/animation.js';
import type { FocusState } from '../shared/focus.js';
import { validId } from '../shared/project.js';
import { atomicJson } from '../server/storage.js';
import path from 'node:path';

const projectId = process.argv[2], base = 'http://127.0.0.1:3001';
if (!validId(projectId)) throw new Error('Usage: npm run render-animations -- <saved-project-UUID> [--defaults]');
async function json<T>(route: string, body?: unknown): Promise<T> {
  const r = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await r.json(); if (!r.ok) throw new Error(result.error); return result;
}
const focus = await json<FocusState>(`/api/projects/${projectId}/focus`);
const state = await json<{ settings: AnimationSettings }>(`/api/projects/${projectId}/animations`);
const settings = process.argv.includes('--defaults') ? defaultAnimationSettings() : state.settings;
let job = await json<AnimationJob>(`/api/projects/${projectId}/animations`, { settings, request: { scope: 'all', format: 'mobile', tileNumber: 1 }, expectedFocusRevision: focus.config.revision });
let lastProgress = -1;
while (job.status === 'running') {
  if (job.progress !== lastProgress) { console.log(`${job.progress}% · ${job.message} · ${job.framesDone}/${job.framesTotal}`); lastProgress = job.progress; }
  await new Promise(resolve => setTimeout(resolve, 1000)); job = await json(`/api/projects/${projectId}/animations/${job.id}`);
}
if (job.status !== 'complete' || !job.manifest) throw new Error(job.error ?? job.message);
const manifest: AnimationManifest = job.manifest; await atomicJson(path.resolve('previews/module-five-sample-manifest.json'), manifest);
console.log(`PASS: ${manifest.videos.length} verified MP4s. ${manifest.outputDirectory}`);
for (const v of manifest.videos.filter(v => v.kind === 'lesson')) console.log(`${v.filename}: ${v.frameCount} frames / ${v.duration}s / ${base}${v.playbackUrl}`);
