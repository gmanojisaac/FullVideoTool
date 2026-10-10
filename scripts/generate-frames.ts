import { validId } from '../shared/project.js';
import type { FrameJob, FrameState } from '../shared/frames.js';
import { atomicJson } from '../server/storage.js';
import path from 'node:path';
const id = process.argv[2], base = 'http://127.0.0.1:3001'; if (!validId(id)) throw new Error('Usage: npm run first-frames -- <project-UUID> [--verify] [--bridge]');
async function json<T>(route: string, body?: unknown): Promise<T> { const r = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); const result = await r.json(); if (!r.ok) throw new Error(result.error); return result; }
const state = await json<FrameState>(`/api/projects/${id}/frames`); if (!state.source) throw new Error(state.reason ?? 'Render all camera clips first.');
const operation = process.argv.includes('--bridge') ? 'bridge' : process.argv.includes('--verify') ? 'verify' : 'extract';
let job = await json<FrameJob>(`/api/projects/${id}/frames`, { operation, scope: operation === 'bridge' ? 'tile' : 'all', format: 'mobile', tileNumber: 1, expectedAnimationRenderId: state.source.renderId, bridgeDuration: state.settings.bridgeDuration });
let last = -1; while (job.status === 'running') { if (job.progress !== last) { console.log(`${job.progress}% · ${job.message}`); last = job.progress; } await new Promise(resolve => setTimeout(resolve, 1000)); job = await json(`/api/projects/${id}/frame-jobs/${job.id}`); }
if (job.status !== 'complete' || !job.report) throw new Error(job.error ?? job.message);
await atomicJson(path.resolve('previews/module-six-sample-report.json'), job.report);
console.log(`PASS: ${job.report.frames.filter(f => f.readyForGemini).length}/12 exact PNG/video RGB matches. ${job.report.outputDirectory}`);
console.log(`Geometry: ${job.report.frames.filter(f => f.zoomOutGeometryMatch === 'PASS').length}/12. Separate clip exact pixel matches: ${job.report.frames.filter(f => f.zoomOutDecodedPixelMatch === 'PASS').length}/12.`);
