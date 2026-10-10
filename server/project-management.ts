import path from 'node:path';
import { mkdir, copyFile, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Project, InputMetadata } from '../shared/project.js';
import { validId } from '../shared/project.js';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError } from './extraction.js';
import type { AssemblyConfig, AssemblyMedia } from '../shared/assembly.js';
import { fileWithin } from './export-validation.js';
import { hashFile } from './export-zip.js';

export interface ProjectSession { version: 1; projectId: string; lastStage: number; updatedAt: string }
export function createProjectManagement(dataRoot: string, getProject: (id: string) => Promise<Project>, guard: (id: string) => void) {
  const directory = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.resolve(dataRoot, 'exports', id); };
  async function session(id: string): Promise<ProjectSession> { await getProject(id); try { return await readJson(path.join(directory(id), 'metadata', 'project_session.json')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, projectId: id, lastStage: 2, updatedAt: new Date().toISOString() }; throw e; } }
  async function saveSession(id: string, stage: unknown) { await getProject(id); if (!Number.isInteger(stage) || Number(stage) < 1 || Number(stage) > 10) throw new ExtractionError(400, 'Stage must be 1–10.'); const next: ProjectSession = { version: 1, projectId: id, lastStage: Number(stage), updatedAt: new Date().toISOString() }; await atomicJson(path.join(directory(id), 'metadata', 'project_session.json'), next); return next; }
  async function duplicate(id: string) {
    guard(id); const source = await getProject(id), now = new Date().toISOString(), nextId = randomUUID(), inputId = randomUUID();
    const input: InputMetadata = { ...source.input, id: inputId, uploadedAt: now, imageUrl: `/api/images/${inputId}` }, next: Project = { ...source, id: nextId, title: (source.title.slice(0, 190) + ' copy'), input, createdAt: now, updatedAt: now };
    await mkdir(path.join(dataRoot, 'inputs'), { recursive: true }); await copyFile(path.join(dataRoot, 'inputs', `${source.input.id}.${source.input.format}`), path.join(dataRoot, 'inputs', `${inputId}.${input.format}`)); await atomicJson(path.join(dataRoot, 'inputs', inputId + '.json'), input);
    for (const relative of ['grid-settings.json', 'metadata/focus_config.json', 'metadata/animation_settings.json', 'metadata/frame_settings.json', 'metadata/export_settings.json', 'metadata/motion_prompts.json']) {
      try { const value = await readJson(path.join(directory(id), relative)); await atomicJson(path.join(directory(nextId), relative === 'metadata/focus_config.json' ? 'metadata/duplicate_focus_recipe.json' : relative), value); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    try{const config=await readJson<AssemblyConfig>(path.join(directory(id),'assembly','assembly_config.json'));await atomicJson(path.join(directory(nextId),'assembly','assembly_config.json'),{...config,projectId:nextId,revision:0,updatedAt:now});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    try{const media=await readJson<AssemblyMedia>(path.join(directory(id),'assembly','media_index.json'));const copy=async(item:AssemblyMedia['audio'][number])=>{const original=fileWithin(path.join(directory(id),'assembly'),item.relativePath);if(await hashFile(original)!==item.sha256)throw new Error('Imported source checksum changed; cannot duplicate.');const target=fileWithin(path.join(directory(nextId),'assembly'),item.relativePath);await mkdir(path.dirname(target),{recursive:true});await copyFile(original,target);if(item.normalizedAudioPath){const raw=fileWithin(path.join(directory(id),'assembly'),item.normalizedAudioPath);if(await hashFile(raw)!==item.normalizedAudioSha256)throw new Error('Normalized narration changed; cannot duplicate.');await copyFile(raw,fileWithin(path.join(directory(nextId),'assembly'),item.normalizedAudioPath));}const baseUrl=`/api/projects/${nextId}/assembly/media/${item.id}`,value={...item,projectId:nextId,downloadUrl:baseUrl+'?download=1',playbackUrl:baseUrl};await atomicJson(path.join(path.dirname(target),'media.json'),value);return value;};const audio=[],videos=[];for(const a of media.audio)audio.push(await copy(a));for(const v of media.videos)videos.push(await copy(v));await atomicJson(path.join(directory(nextId),'assembly','media_index.json'),{version:1,projectId:nextId,audio,videos});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    await atomicJson(path.join(dataRoot, 'projects', nextId + '.json'), next); await saveSession(nextId, 3); return next;
  }
  async function remove(id: string, confirmedTitle: unknown) {
    guard(id); const project = await getProject(id); if (confirmedTitle !== project.title) throw new ExtractionError(400, 'Confirm deletion using the exact project title.');
    // Recoverable deletion: move only this UUID's directory and project record to a local trash directory.
    const trash = path.resolve(dataRoot, 'trash', id + '-' + randomUUID()); await mkdir(trash, { recursive: true });
    const source = directory(id), expected = path.resolve(dataRoot, 'exports') + path.sep; if (!source.startsWith(expected)) throw new Error('Invalid project directory.');
    try { await stat(source); await rename(source, path.join(trash, 'assets')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await rename(path.join(dataRoot, 'projects', id + '.json'), path.join(trash, 'project.json')); return { deleted: true, projectId: id };
  }
  return { session, saveSession, duplicate, remove };
}
