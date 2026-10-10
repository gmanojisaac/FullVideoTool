import path from 'node:path';
import { stat } from 'node:fs/promises';
import { validId, type Project } from '../shared/project.js';
import type { ExtractionManifest } from '../shared/extraction.js';
import type { LayoutManifest } from '../shared/layout.js';
import type { FocusConfig } from '../shared/focus.js';
import type { AnimationManifest } from '../shared/animation.js';
import type { FrameValidationReport } from '../shared/frames.js';
import type { AssemblyState, LessonRenderManifest } from '../shared/assembly.js';
import type { ProjectDashboard, AssetStatus } from '../shared/integration.js';
import { outputFormats } from '../shared/layout.js';
import { readJson } from './storage.js';
import { fileWithin } from './export-validation.js';

export interface CurrentAssets { project: Project; extraction: ExtractionManifest | null; layout: LayoutManifest | null; focus: FocusConfig | null; animation: AnimationManifest | null; frames: FrameValidationReport | null; assembly?: AssemblyState }
export async function projectDashboard(dataRoot: string, c: CurrentAssets): Promise<ProjectDashboard> {
  const id = c.project.id, base = path.join(dataRoot, 'exports', id), result: ProjectDashboard = { version: 1, projectId: id, refreshedAt: new Date().toISOString(), assets: [], warnings: ['Ready identifies current generation and file presence; final export performs full decode, checksum and pixel validation.', 'Module 8 specification is incomplete. Prompt assets are pending.'] };
  async function previous<T>(reference: string, relative: (run: string) => string): Promise<T | null> { try { const ref = await readJson<{ id: string }>(path.join(base, reference)); if (!validId(ref.id)) return null; return await readJson(path.join(base, relative(ref.id))); } catch { return null; } }
  async function add(filename: string, type: string, disk: string | undefined, status: AssetStatus, downloadUrl?: string, resolution?: { width: number; height: number }, generatedAt?: string, detail?: string) {
    if (disk) try { const s = await stat(disk); if (!s.isFile()) status = 'Missing'; } catch { status = 'Missing'; }
    result.assets.push({ filename, type, status, downloadUrl: status === 'Missing' ? undefined : downloadUrl, resolution, generatedAt, detail });
  }
  await add(c.project.input.filename, 'Original', path.join(dataRoot, 'inputs', `${c.project.input.id}.${c.project.input.format}`), 'Ready', c.project.input.imageUrl, c.project.input, c.project.input.uploadedAt);
  const extraction = c.extraction || (await previous<{ manifest?: ExtractionManifest }>('latest.json', run => `jobs/${run}.json`))?.manifest;
  for (let n = 1; n <= 6; n++) { const t = extraction?.tiles.find(t => t.number === n); await add(`tile_0${n}.png`, 'Extracted tile', t ? fileWithin(path.join(base, 'runs', extraction!.extractionId), `tiles/${t.filename}`) : undefined, t ? c.extraction ? 'Ready' : 'Outdated' : 'Missing', t?.downloadUrl, t, t?.extractedAt); }
  const layout = c.layout || (await previous<{ manifest?: LayoutManifest }>('latest-layout.json', run => `layout-jobs/${run}.json`))?.manifest;
  for (const format of outputFormats) { const g = layout?.outputs[format]; await add(`${format}_six_tile_grid.png`, 'Grid', g ? fileWithin(path.join(base, 'layout-runs', layout!.generationId), `layouts/${g.filename}`) : undefined, g ? c.layout ? 'Ready' : 'Outdated' : 'Missing', g?.downloadUrl, g, layout?.generatedAt); }
  let focus = c.focus; if (!focus) try { focus = await readJson(path.join(base, 'metadata', 'focus_config.json')); } catch { /* Missing saved focus. */ }
  for (const format of outputFormats) for (let n = 1; n <= 6; n++) { const v = focus?.views.find(v => v.format === format && v.tileNumber === n); await add(`${format}_tile_0${n}_focus.json`, 'Camera configuration', undefined, !v ? 'Missing' : !c.focus || !focus?.updatedAt || !v.approved ? 'Requires Review' : 'Ready', v ? `/api/projects/${id}/assets/focus/${format}-${n}` : undefined, v?.transform.viewport, v?.lastSavedAt || undefined); }
  const animation = c.animation || (await previous<{ manifest?: AnimationManifest }>('latest-animation.json', run => `animation-jobs/${run}.json`))?.manifest;
  for (const format of outputFormats) for (const kind of ['lesson', 'in', 'out'] as const) for (const n of kind === 'lesson' ? [0] : [1,2,3,4,5,6]) { const v = animation?.videos.find(v => v.format === format && v.kind === kind && (kind === 'lesson' || v.tileNumber === n)), filename = kind === 'lesson' ? `${format}_lesson_preview.mp4` : kind === 'in' ? `${format}_zoom_to_tile_0${n}.mp4` : `${format}_tile_0${n}_to_grid.mp4`; await add(filename, 'Video', v ? fileWithin(path.join(base, 'animation-runs', animation!.renderId), v.relativePath) : undefined, v ? c.animation ? 'Ready' : 'Outdated' : 'Missing', v?.downloadUrl, v?.probe, animation?.renderedAt); }
  const frames = c.frames || await previous<FrameValidationReport>('latest-frames.json', run => `frame-runs/${run}/metadata/frame_validation_report.json`);
  for (const format of outputFormats) for (let n = 1; n <= 6; n++) { const f = frames?.frames.find(f => f.format === format && f.tileNumber === n); await add(`${format}_tile_0${n}_gemini_first_frame.png`, 'Gemini first frame', f ? fileWithin(path.join(base, 'frame-runs', frames!.generationId), f.relativePath) : undefined, f ? !f.readyForGemini ? 'Failed' : c.frames ? 'Ready' : 'Outdated' : 'Missing', f?.downloadUrl, f?.pngResolution, f?.validatedAt); await add(`${format}_tile_0${n}_motion_prompt.txt`, 'Gemini prompt', undefined, 'Missing'); }
  for (const b of frames?.bridges || []) await add(b.filename, 'Optional bridge', fileWithin(path.join(base, 'frame-runs', frames!.generationId), b.relativePath), c.frames ? 'Ready' : 'Outdated', b.downloadUrl, b.probe, frames?.updatedAt);
  for (const [filename, url, module] of [['project.json', `/api/projects/${id}`, 1], ['tile_extraction_manifest.json', extraction?.manifestUrl, 2], ['layout_manifest.json', layout?.manifestUrl, 3], ['focus_config.json', `/api/projects/${id}/focus`, 4], ['camera_animation_manifest.json', animation?.manifestUrl, 5], ['frame_validation_report.json', frames?.reportUrl, 6]] as const) await add(filename, module === 6 ? 'Validation report' : 'Manifest', undefined, url ? 'Ready' : 'Missing', url, undefined, c.project.updatedAt);
  if(c.assembly){const a=c.assembly;
    for(const format of outputFormats)for(let n=1;n<=6;n++){const v=a.media.videos.find(v=>v.format===format&&v.tileNumber===n);await add(v?.filename||`${format}_tile_0${n}_imported_loop`, 'Imported Gemini video',v?fileWithin(path.join(base,'assembly'),v.relativePath):undefined,v?'Ready':'Missing',v?.downloadUrl,v?.width&&v.height?{width:v.width,height:v.height}:undefined,v?.importedAt);}
    for(let n=1;n<=6;n++){const v=a.media.audio.find(v=>v.tileNumber===n);await add(v?.filename||`tile_0${n}_narration`,'Imported narration',v?fileWithin(path.join(base,'assembly'),v.relativePath):undefined,v?'Ready':'Missing',v?.downloadUrl,undefined,v?.importedAt,v?`${v.duration.toFixed(3)} seconds / ${v.audioSamples} samples`:undefined);}
    for(const format of outputFormats){let m=a.finals?.find(m=>m.formats.includes(format)),fresh=!!m;if(!m)m=(await previous<LessonRenderManifest>(`assembly/latest_full_${format}.json`,run=>`assembly/runs/${run}/metadata/lesson_render_manifest.json`))||undefined;const o=m?.outputs.find(o=>o.format===format);await add(o?.filename||`lesson_${format}_${format==='mobile'?'9x16':'16x9'}.mp4`,'Finished lesson',o?fileWithin(path.join(base,'assembly','runs',m!.renderId),o.relativePath):undefined,o?fresh?'Ready':'Outdated':'Missing',o?.downloadUrl,o,m?.renderedAt);}
  }
  return result;
}
