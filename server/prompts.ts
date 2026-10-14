import path from 'node:path';
import { atomicJson, readJson } from './storage.js';
import { ExtractionError } from './extraction.js';
import { validId } from '../shared/project.js';
import { defaultPromptSet, promptsText, validatePromptSet, type MotionPromptSet } from '../shared/prompts.js';

export function createPromptService(dataRoot: string) {
  const file = (id: string) => { if (!validId(id)) throw new ExtractionError(400, 'Invalid project ID.'); return path.join(dataRoot, 'exports', id, 'metadata', 'motion_prompts.json'); };
  async function saved(id: string): Promise<MotionPromptSet | null> {
    try { return await readJson<MotionPromptSet>(file(id)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async function current(id: string) { const s = await saved(id); return { prompts: s || defaultPromptSet(id), saved: !!s }; }
  async function save(id: string, value: MotionPromptSet) {
    const errors = validatePromptSet(value); if (errors.length) throw new ExtractionError(400, errors.join(' '));
    const next: MotionPromptSet = { version: 1, module: 8, projectId: id, updatedAt: new Date().toISOString(), tiles: [...value.tiles].sort((a, b) => a.tileNumber - b.tileNumber).map(t => ({ tileNumber: t.tileNumber, motion: t.motion.trim() })) };
    await atomicJson(file(id), next); return next;
  }
  /** Text bundled into the export package, or undefined while the author has not saved prompts. */
  async function exportText(id: string, title: string) { const s = await saved(id); return s ? promptsText(s, title) : undefined; }
  return { current, save, saved, exportText };
}
