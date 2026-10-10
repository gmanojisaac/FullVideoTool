import { validId } from '../shared/project.js';
import type { ExportJob, ExportScope } from '../shared/export.js';
import { atomicJson } from '../server/storage.js';
import path from 'node:path';
const id = process.argv[2], scope = (process.argv[3] || 'complete') as ExportScope, base = 'http://127.0.0.1:3001';
if (!validId(id) || !['complete', 'mobile', 'desktop'].includes(scope)) throw new Error('Usage: npm run export-package -- <project-UUID> [complete|mobile|desktop]');
async function json<T>(route: string, body?: unknown): Promise<T> { const r = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
let job = await json<ExportJob>(`/api/projects/${id}/exports`, { scope }); let last = -1;
while (job.status === 'running') { if (job.progress !== last) { console.log(`${job.progress}% · ${job.message}`); last = job.progress; } await new Promise(r => setTimeout(r, 1000)); job = await json(`/api/projects/${id}/exports/${job.id}`); }
if (!job.receipt || job.status !== 'complete') throw new Error(job.error || job.message);
await atomicJson(path.resolve('previews/module-seven-sample-receipt.json'), job.receipt);
const response = await fetch(base + job.receipt.manifestUrl); if (!response.ok) throw new Error('Manifest unavailable.'); await atomicJson(path.resolve('previews/module-seven-sample-manifest.json'), await response.json());
console.log(`PASS: ${job.receipt.fileCount} files. ZIP SHA-256 ${job.receipt.archiveSha256}`);
console.log(`data/exports/${id}/package-runs/${job.id}/${job.receipt.filename}`);
