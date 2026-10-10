import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { detectLayout } from './detection.js';
import { atomicJson, readJson } from './storage.js';
import { runDiagnostics } from './checks.js';
import { createExtractionJobs } from './extraction-jobs.js';
import { createLayoutJobs } from './layout-jobs.js';
import { runLayoutDiagnostics } from './layout-checks.js';
import { createFocusService } from './focus.js';
import { runFocusDiagnostics } from './focus-checks.js';
import { createAnimationJobs } from './animation-jobs.js';
import { detectVideoTools } from './video-tools.js';
import { runAnimationDiagnostics } from './animation-checks.js';
import { createFrameService } from './frames.js';
import { runFrameDiagnostics } from './frame-checks.js';
import { createExportService } from './exports.js';
import { exportInstructions } from './export-validation.js';
import type { ExportContext } from '../shared/export.js';
import { createProjectManagement } from './project-management.js';
import { projectDashboard } from './assets.js';
import { runExportDiagnostics } from './export-checks.js';
import { createRenderQueue } from './render-queue.js';
import { createAssemblyService } from './assembly.js';
import type { OutputFormat } from '../shared/layout.js';
import { validateAnimationSettings, validAnimationRequest, type AnimationSettings } from '../shared/animation.js';
import { ExtractionError } from './extraction.js';
import { runExtractionDiagnostics } from './extraction-checks.js';
import { validId, validateProject, type InputMetadata, type Project } from '../shared/project.js';

export const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const fixtureRoot = path.join(root, 'tests', 'fixtures');
export const maxUpload = 20 * 1024 * 1024;
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function createApp(dataRoot = path.join(root, 'data'), diagnostics = true) {
  const app = express();
  const inputs = path.join(dataRoot, 'inputs'), projects = path.join(dataRoot, 'projects');
  const extraction = createExtractionJobs(dataRoot);
  const layouts = createLayoutJobs(dataRoot, async id => (await extraction.current(await getSavedProject(id))).manifest);
  const getFocusContext = async (id: string) => {
    const project = await getSavedProject(id), extracted = await extraction.current(project);
    if (!extracted.manifest || extracted.job?.status === 'running') throw new HttpError(409, 'Finish extraction before camera framing.');
    const grids = await layouts.current(id, extracted.manifest);
    if (!grids.manifest || grids.job?.status === 'running') throw new HttpError(409, 'Generate the current mobile and desktop grids before camera framing.');
    return { source: extracted.manifest, layout: grids.manifest };
  };
  const focus = createFocusService(dataRoot, getFocusContext);
  const animations = createAnimationJobs(dataRoot, async id => ({ ...await getFocusContext(id), config: (await focus.current(id)).config }));
  const frames = createFrameService(dataRoot, async id => { const state = await animations.current(id), source = state.fullManifest || state.manifest; if (!source) throw new HttpError(409, 'Render all current camera videos in Step 5 first.'); return source; });
  const getExportContext = async (id: string): Promise<ExportContext> => {
    const project = await getSavedProject(id), context = await getFocusContext(id), config = (await focus.current(id)).config, state = await animations.current(id), camera = state.fullManifest || state.manifest, report = (await frames.current(id)).report;
    if (!camera || camera.request.scope !== 'all' || !report || report.animationRenderId !== camera.renderId) throw new HttpError(409, 'Render and verify all current camera assets before export.');
    return { project, extraction: context.source, layout: context.layout, focus: config, animation: camera, frames: report };
  };
  const packages = createExportService(dataRoot, getExportContext);
  const assembly = createAssemblyService(dataRoot, async id => { const c = await getExportContext(id); return {layout:c.layout,animation:c.animation,frames:c.frames}; });
  const uploadingMedia = new Set<string>();
  const processingProjects = new Set<string>();
  const queue = createRenderQueue(dataRoot, animations, () => assembly.isRunning() || uploadingMedia.size > 0 || [...processingProjects].some(id => frames.isRunning(id) || packages.isRunning(id)));
  const guardPackage = (id: string) => { assembly.guard(id); if (uploadingMedia.has(id)) throw new HttpError(409,'Wait for the media upload to finish.'); if (packages.isRunning(id)) throw new HttpError(409, 'Wait or cancel packaging before changing this project.'); };
  const guardAnimation = (id: string) => { guardPackage(id); if (queue.isPending(id) || animations.isRunning(id) || frames.isRunning(id)) throw new HttpError(409, 'Wait or cancel camera/frame processing before changing its source or framing.'); };
  const guardProject = (id: string) => { guardAnimation(id); if (extraction.isRunning(id) || layouts.isRunning(id) || focus.isRunning(id)) throw new HttpError(409, 'Wait or cancel this project’s processing before changing it.'); };
  const management = createProjectManagement(dataRoot, getSavedProject, guardProject);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUpload, files: 1, fields: 2 } });
  const mediaPaths = new WeakMap<object,string>();
  const mediaUpload = multer({ storage: multer.diskStorage({ destination: (_req,_file,cb) => { const folder=path.join(dataRoot,'.uploads'); void mkdir(folder,{recursive:true}).then(()=>cb(null,folder),e=>cb(e,'')); }, filename: (req,_file,cb) => { const name=randomUUID()+'.upload';mediaPaths.set(req,path.join(dataRoot,'.uploads',name));cb(null,name); } }), limits:{fileSize:512*1024*1024,files:1,fields:3} });
  function admitAssembly(id:string) { guardProject(id); if(queue.isRunning() || assembly.isRunning() || uploadingMedia.size || [...processingProjects].some(p=>frames.isRunning(p)||packages.isRunning(p))) throw new HttpError(409,'Finish or cancel current video processing before lesson assembly.'); }
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    // This service is local. Browser writes are restricted to its own frontend origins.
    const origin = req.get('origin');
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin)) return res.status(403).json({ error: 'Only the local editor can access this service.' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  async function getInput(id: unknown) {
    if (!validId(id)) throw new HttpError(400, 'Invalid image ID.');
    try { return await readJson<InputMetadata>(path.join(inputs, `${id}.json`)); }
    catch { throw new HttpError(404, 'The original image is missing. Upload it again in this local workspace.'); }
  }

  async function verifyStoredInput(project: Project) {
    const input = await getInput(project.input.id);
    const keys: (keyof InputMetadata)[] = ['sha256', 'width', 'height', 'format', 'mime', 'bytes', 'filename', 'imageUrl', 'uploadedAt'];
    if (keys.some(key => input[key] !== project.input[key])) throw new HttpError(400, 'Project input metadata does not match the original image.');
    return input;
  }

  async function getSavedProject(id: unknown) {
    if (!validId(id)) throw new HttpError(400, 'Invalid project ID.');
    let project: Project;
    try { project = await readJson<Project>(path.join(projects, `${id}.json`)); }
    catch { throw new HttpError(404, 'Save and confirm the panel layout before extracting.'); }
    const errors = validateProject(project);
    if (errors.length) throw new HttpError(400, errors.join(' '));
    await verifyStoredInput(project);
    return project;
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', module: 10, modules: [1, 2, 3, 4, 5, 6, 7, 10], integration: 'Module 9 partial; Module 8 specification pending' }));
  app.get('/api/video-tools', async (_req, res) => res.json(await detectVideoTools()));

  app.post('/api/upload', upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Choose a PNG, JPG, or WEBP image.');
    const extension = path.extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new HttpError(415, 'Unsupported image. Use PNG, JPG, or WEBP.');
    let metadata: sharp.Metadata;
    let result: Awaited<ReturnType<typeof detectLayout>>;
    try {
      metadata = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: 40_000_000 }).metadata();
      if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new HttpError(415, 'Unsupported image content. Use PNG, JPG, or WEBP.');
      if ((metadata.pages ?? 1) > 1) throw new HttpError(415, 'Animated images are not supported; upload a still image.');
      const expected = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' }[extension];
      const expectedMime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[metadata.format as 'png' | 'jpeg' | 'webp'];
      if (metadata.format !== expected || (file.mimetype !== expectedMime && file.mimetype !== 'application/octet-stream')) throw new HttpError(415, 'The filename or MIME type does not match the image content.');
      if (!metadata.width || !metadata.height || metadata.width < 120 || metadata.height < 120) throw new HttpError(400, 'Image must be at least 120 × 120 pixels.');
      result = await detectLayout(file.buffer);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Image could not be decoded. It may be corrupt or exceed the 40 megapixel limit.');
    }
    const now = new Date().toISOString(), id = randomUUID();
    const format = metadata.format as InputMetadata['format'];
    const input: InputMetadata = {
      id, filename: path.basename(file.originalname).slice(0, 255), format,
      mime: { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format],
      width: result.width, height: result.height, bytes: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      imageUrl: `/api/images/${id}`, uploadedAt: now,
    };
    const project: Project = {
      version: 1, id: randomUUID(), title: path.parse(input.filename).name,
      createdAt: now, updatedAt: now, input,
      layout: result.layout, grid: result.grid, panels: result.panels,
      detection: result.detection, manuallyAdjusted: false,
    };
    const errors = validateProject(project);
    if (errors.length) throw new HttpError(400, errors.join(' '));
    await mkdir(inputs, { recursive: true });
    await writeFile(path.join(inputs, `${id}.${format}`), file.buffer);
    await atomicJson(path.join(inputs, `${id}.json`), input);
    res.status(201).json(project);
  });

  app.get('/api/images/:id', async (req, res) => {
    const input = await getInput(req.params.id);
    res.type(input.mime).send(await readFile(path.join(inputs, `${input.id}.${input.format}`)));
  });

  app.post('/api/detect', async (req, res) => {
    const layout = req.body?.layout;
    if (layout !== undefined && layout !== '2x3' && layout !== '3x2') throw new HttpError(400, 'Layout must be 2x3 or 3x2.');
    const input = await getInput(req.body?.inputId);
    const result = await detectLayout(await readFile(path.join(inputs, `${input.id}.${input.format}`)), layout);
    res.json(result);
  });

  app.put('/api/projects/:id', async (req, res) => {
    guardProject(req.params.id);
    const errors = validateProject(req.body);
    if (errors.length) throw new HttpError(400, errors.join(' '));
    const project = req.body as Project;
    if (req.params.id !== project.id) throw new HttpError(400, 'Project ID does not match the save destination.');
    const input = await verifyStoredInput(project);
    const saved = { ...project, input, updatedAt: new Date().toISOString() };
    await atomicJson(path.join(projects, `${project.id}.json`), saved);
    res.json({ project: saved, path: `data/projects/${project.id}.json` });
  });

  app.get('/api/projects', async (_req, res) => {
    await mkdir(projects, { recursive: true });
    const files = (await readdir(projects)).filter(file => validId(file.replace(/\.json$/, '')) && file.endsWith('.json'));
    const list = (await Promise.all(files.map(async file => {
      try { const p = await readJson<Project>(path.join(projects, file)); if (validateProject(p).length) return null; return { id: p.id, title: p.title, lessonTitle: p.lessonTitle || '', updatedAt: p.updatedAt, layout: p.layout }; } catch { return null; }
    }))).filter(p => p !== null);
    res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });

  app.get('/api/projects/:id', async (req, res) => {
    res.json(await getSavedProject(req.params.id));
  });
  app.post('/api/projects/:id/duplicate', async (req, res) => { res.status(201).json(await management.duplicate(req.params.id)); });
  app.delete('/api/projects/:id', async (req, res) => { res.json(await management.remove(req.params.id, req.body?.confirmedTitle)); });
  app.get('/api/projects/:id/session', async (req, res) => { res.json(await management.session(req.params.id)); });
  app.put('/api/projects/:id/session', async (req, res) => { res.json(await management.saveSession(req.params.id, req.body?.lastStage)); });
  app.get('/api/projects/:id/assets', async (req, res) => {
    const project = await getSavedProject(req.params.id), e = (await extraction.current(project)).manifest, l = (await layouts.current(project.id, e)).manifest;
    let f = null, a = null, r = null;
    if (e && l) { f = (await focus.current(project.id)).config; const camera = await animations.current(project.id); a = camera.fullManifest || camera.manifest; r = (await frames.current(project.id)).report; }
    res.json(await projectDashboard(dataRoot, { project, extraction: e, layout: l, focus: f, animation: a, frames: r, assembly: await assembly.current(project.id) }));
  });
  app.get('/api/projects/:id/assets/focus/:key', async (req, res) => { if (!/^(mobile|desktop)-[1-6]$/.test(req.params.key)) throw new HttpError(400, 'Invalid focus key.'); const config = (await focus.current(req.params.id)).config; res.attachment(req.params.key + '_focus.json').json(config.views.find(v => `${v.format}-${v.tileNumber}` === req.params.key)); });

  app.post('/api/projects/:id/extract', async (req, res) => {
    const project = await getSavedProject(req.params.id);
    guardAnimation(project.id);
    if (layouts.isRunning(project.id)) throw new HttpError(409, 'Wait or cancel grid generation before re-extracting tiles.');
    if (focus.isRunning(project.id)) throw new HttpError(409, 'Wait or cancel focus rendering before re-extracting tiles.');
    res.status(202).json(await extraction.start(project, req.body?.expectedUpdatedAt));
  });
  app.get('/api/projects/:id/extraction', async (req, res) => {
    res.json(await extraction.current(await getSavedProject(req.params.id)));
  });
  app.get('/api/projects/:id/extractions/:runId', async (req, res) => {
    res.json(await extraction.getJob(req.params.id, req.params.runId));
  });
  app.post('/api/projects/:id/extractions/:runId/cancel', async (req, res) => {
    res.json(await extraction.cancel(req.params.id, req.params.runId));
  });
  app.get('/api/projects/:id/extractions/:runId/files/:name', async (req, res) => {
    const filename = await extraction.file(req.params.id, req.params.runId, req.params.name);
    if (req.query.download === '1') res.attachment(req.params.name);
    res.sendFile(filename);
  });

  app.get('/api/projects/:id/layouts', async (req, res) => {
    const project = await getSavedProject(req.params.id);
    res.json(await layouts.current(project.id, (await extraction.current(project)).manifest));
  });
  app.put('/api/projects/:id/layout-settings', async (req, res) => {
    const project = await getSavedProject(req.params.id);
    guardAnimation(project.id);
    if (focus.isRunning(project.id)) throw new HttpError(409, 'Wait or cancel focus rendering before changing grid settings.');
    res.json(await layouts.saveSettings(project.id, req.body));
  });
  app.post('/api/projects/:id/layouts', async (req, res) => {
    const project = await getSavedProject(req.params.id), current = await extraction.current(project);
    guardAnimation(project.id);
    if (focus.isRunning(project.id)) throw new HttpError(409, 'Wait or cancel focus rendering before regenerating grids.');
    if (current.job?.status === 'running') throw new HttpError(409, 'Wait for tile extraction to finish before generating grids.');
    if (!current.manifest) throw new HttpError(409, 'Complete Step 2 with these saved panel coordinates first.');
    res.status(202).json(await layouts.start(current.manifest, req.body?.settings, req.body?.expectedExtractionId));
  });
  app.get('/api/projects/:id/layouts/:runId', async (req, res) => {
    res.json(await layouts.getJob(req.params.id, req.params.runId));
  });
  app.post('/api/projects/:id/layouts/:runId/cancel', async (req, res) => {
    res.json(await layouts.cancel(req.params.id, req.params.runId));
  });
  app.get('/api/projects/:id/layouts/:runId/files/:name', async (req, res) => {
    const filename = await layouts.file(req.params.id, req.params.runId, req.params.name);
    if (req.query.download === '1') res.attachment(req.params.name);
    res.sendFile(filename);
  });

  app.get('/api/projects/:id/focus', async (req, res) => { res.json(await focus.current(req.params.id)); });
  app.put('/api/projects/:id/focus', async (req, res) => { guardAnimation(req.params.id); res.json(await focus.save(req.params.id, req.body?.config, req.body?.expectedRevision, req.body?.approveView)); });
  app.post('/api/projects/:id/focus-previews', async (req, res) => { guardAnimation(req.params.id); res.status(202).json(await focus.start(req.params.id, req.body?.expectedRevision)); });
  app.get('/api/projects/:id/focus-previews/:runId', async (req, res) => { res.json(await focus.getJob(req.params.id, req.params.runId)); });
  app.post('/api/projects/:id/focus-previews/:runId/cancel', async (req, res) => { res.json(await focus.cancel(req.params.id, req.params.runId)); });
  app.get('/api/projects/:id/focus-previews/:runId/files/:name', async (req, res) => {
    const filename = await focus.file(req.params.id, req.params.runId, req.params.name);
    if (req.query.download === '1') res.attachment(req.params.name);
    res.sendFile(filename);
  });

  app.get('/api/render-queue', async (_req, res) => { res.json(await queue.list()); });
  app.get('/api/projects/:id/animations', async (req, res) => { const state = await animations.current(req.params.id); const queued = queue.current(req.params.id); if (queued) state.job = queued; res.json(state); });
  app.put('/api/projects/:id/animation-settings', async (req, res) => { guardPackage(req.params.id); if (queue.isPending(req.params.id) || frames.isRunning(req.params.id)) throw new HttpError(409, 'Wait or cancel frame/camera processing.'); res.json(await animations.saveSettings(req.params.id, req.body)); });
  app.post('/api/projects/:id/animations', async (req, res) => {
    guardPackage(req.params.id);
    if (frames.isRunning(req.params.id)) throw new HttpError(409, 'Wait or cancel frame processing before rendering camera videos.');
    if (focus.isRunning(req.params.id)) throw new HttpError(409, 'Wait for the focus save or preview render to finish.');
    const errors = validateAnimationSettings(req.body?.settings); if (errors.length) throw new HttpError(400, errors.join(' ')); if (!validAnimationRequest(req.body?.request)) throw new HttpError(400, 'Choose a valid render scope, format and tile.');
    const context = await getFocusContext(req.params.id), config = (await focus.current(req.params.id)).config;
    if (!context || !config.updatedAt || config.revision !== req.body?.expectedFocusRevision) throw new HttpError(409, 'Save current camera framing before rendering.');
    const tools = await detectVideoTools(); if (!tools.available) throw new HttpError(503, tools.instructions);
    res.status(202).json(await queue.enqueue(req.params.id, req.body.settings as AnimationSettings, req.body.request, config.revision));
  });
  app.get('/api/projects/:id/animations/:runId', async (req, res) => { res.json(await queue.getJob(req.params.id, req.params.runId) || await animations.getJob(req.params.id, req.params.runId)); });
  app.post('/api/projects/:id/animations/:runId/cancel', async (req, res) => { res.json(await queue.cancel(req.params.id, req.params.runId) || await animations.cancel(req.params.id, req.params.runId)); });
  app.get('/api/projects/:id/animations/:runId/files/:name', async (req, res) => {
    const queued = await queue.getJob(req.params.id, req.params.runId); if (queued && (queued.status !== 'complete' || !queued.manifest)) throw new HttpError(409, 'Downloads are available after the queued render completes.');
    const filename = await animations.file(req.params.id, queued?.manifest?.renderId || req.params.runId, req.params.name);
    if (req.query.download === '1') res.attachment(req.params.name);
    res.sendFile(filename);
  });

  app.get('/api/projects/:id/frames', async (req, res) => { res.json(await frames.current(req.params.id)); });
  app.post('/api/projects/:id/frames', async (req, res) => { guardPackage(req.params.id); if (assembly.isRunning() || uploadingMedia.size || queue.isPending(req.params.id) || queue.isRunning() || [...processingProjects].some(id => id !== req.params.id && (frames.isRunning(id) || packages.isRunning(id)))) throw new HttpError(409, 'Finish current video processing first.'); processingProjects.add(req.params.id); res.status(202).json(await frames.start(req.params.id, req.body)); });
  app.get('/api/projects/:id/frame-jobs/:runId', async (req, res) => { res.json(await frames.getJob(req.params.id, req.params.runId)); });
  app.post('/api/projects/:id/frame-jobs/:runId/cancel', async (req, res) => { res.json(await frames.cancel(req.params.id, req.params.runId)); });
  app.get('/api/projects/:id/frames/:runId/files/:name', async (req, res) => { const filename = await frames.file(req.params.id, req.params.runId, req.params.name, req.query.download === '1'); if (req.query.download === '1') res.attachment(req.params.name); res.sendFile(filename); });
  app.get('/api/projects/:id/frames/:runId/all-first-frames.zip', async (req, res) => { res.type('application/zip').attachment('six_tile_first_frames.zip').send(await frames.allFrames(req.params.id, req.params.runId)); });

  app.get('/api/projects/:id/exports', async (req, res) => { await getSavedProject(req.params.id); res.json(await packages.current(req.params.id)); });
  app.put('/api/projects/:id/export-settings', async (req, res) => { await getSavedProject(req.params.id); res.json(await packages.saveSettings(req.params.id, req.body)); });
  app.post('/api/projects/:id/exports', async (req, res) => { const id = req.params.id; if (assembly.isRunning() || uploadingMedia.size || queue.isPending(id) || queue.isRunning() || extraction.isRunning(id) || layouts.isRunning(id) || focus.isRunning(id) || animations.isRunning(id) || [...processingProjects].some(p => frames.isRunning(p) || packages.isRunning(p))) throw new HttpError(409, 'Finish or cancel processing before packaging.'); processingProjects.add(id); res.status(202).json(await packages.start(id, req.body?.scope)); });
  app.get('/api/projects/:id/exports/:runId', async (req, res) => { res.json(await packages.getJob(req.params.id, req.params.runId)); });
  app.post('/api/projects/:id/exports/:runId/cancel', async (req, res) => { res.json(await packages.cancel(req.params.id, req.params.runId)); });
  app.get('/api/projects/:id/exports/:runId/files/:name', async (req, res) => { res.attachment(req.params.name).sendFile(await packages.file(req.params.id, req.params.runId, req.params.name)); });
  app.get('/api/projects/:id/export-instructions', async (req, res) => { res.json(exportInstructions(await getExportContext(req.params.id), await packages.settings(req.params.id))); });

  app.get('/api/projects/:id/assembly', async(req,res)=>{await getSavedProject(req.params.id);res.json(await assembly.current(req.params.id));});
  app.put('/api/projects/:id/assembly/settings',async(req,res)=>{await getSavedProject(req.params.id);guardPackage(req.params.id);res.json(await assembly.save(req.params.id,req.body?.config,req.body?.expectedRevision));});
  app.post('/api/projects/:id/assembly/media',async(req,res,next)=>{try{const projectId=String(req.params.id);await getSavedProject(projectId);admitAssembly(projectId);uploadingMedia.add(projectId);const cleanup=()=>{uploadingMedia.delete(projectId);const file=mediaPaths.get(req);if(file)void unlink(file).catch(()=>{});};res.on('finish',cleanup);res.on('close',cleanup);next();}catch(e){next(e);}},mediaUpload.single('file'),async(req,res)=>{
    if(!req.file)throw new HttpError(400,'Choose a media file.');const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort();});
    const item=await assembly.media.importFile(String(req.params.id),req.body.kind,Number(req.body.tileNumber),req.body.format as OutputFormat,req.file.path,req.file.originalname,controller.signal);res.status(201).json(item);
  });
  app.delete('/api/projects/:id/assembly/media',async(req,res)=>{await getSavedProject(req.params.id);guardPackage(req.params.id);if(!Number.isInteger(req.body?.tileNumber)||req.body.tileNumber<1||req.body.tileNumber>6||(req.body.kind==='video'&&!['mobile','desktop'].includes(req.body.format)))throw new HttpError(400,'Invalid media selection.');res.json(await assembly.media.remove(req.params.id,req.body.kind,req.body.tileNumber,req.body.format));});
  app.get('/api/projects/:id/assembly/media/:mediaId',async(req,res)=>{const file=await assembly.media.file(req.params.id,req.params.mediaId);if(req.query.download==='1')res.attachment(file.item.filename);res.sendFile(file.filename);});
  app.post('/api/projects/:id/assembly/jobs',async(req,res)=>{await getSavedProject(req.params.id);admitAssembly(req.params.id);res.status(202).json(await assembly.start(req.params.id,req.body));});
  app.get('/api/projects/:id/assembly/jobs/:runId',async(req,res)=>res.json(await assembly.getJob(req.params.id,req.params.runId)));
  app.post('/api/projects/:id/assembly/jobs/:runId/cancel',async(req,res)=>res.json(await assembly.cancel(req.params.id,req.params.runId)));
  app.get('/api/projects/:id/assembly/runs/:runId/files/:name',async(req,res)=>{const file=await assembly.file(req.params.id,req.params.runId,req.params.name);if(req.query.download==='1')res.attachment(req.params.name);res.sendFile(file);});
  app.get('/api/projects/:id/assembly/analysis/:key/:name',async(req,res)=>res.sendFile(await assembly.analysisFile(req.params.id,req.params.key,req.params.name)));

  app.post('/api/projects/import', async (req, res) => {
    const errors = validateProject(req.body);
    if (errors.length) throw new HttpError(400, errors.join(' '));
    const project = req.body as Project;
    await verifyStoredInput(project);
    // Import restores coordinates verbatim, never reruns detection.
    res.json(project);
  });

  app.get('/api/fixtures/:name', async (req, res) => {
    const allowed = ['sample-comic.png', 'landscape-comic.jpg', 'portrait-comic.webp'];
    if (!allowed.includes(req.params.name)) throw new HttpError(404, 'Fixture not found.');
    try { res.type(path.extname(req.params.name)).send(await readFile(path.join(fixtureRoot, req.params.name))); }
    catch { throw new HttpError(404, 'Fixture missing. Run npm run fixtures first.'); }
  });

  let checking = false;
  if (diagnostics) app.post('/api/checks', async (_req, res) => {
    if (checking) throw new HttpError(409, 'Checks are already running.');
    checking = true;
    try { res.json(await runDiagnostics()); } finally { checking = false; }
  });
  let checkingExtraction = false;
  if (diagnostics) app.post('/api/checks/module2', async (_req, res) => {
    if (checkingExtraction) throw new HttpError(409, 'Module 2 checks are already running.');
    checkingExtraction = true;
    try { res.json(await runExtractionDiagnostics()); } finally { checkingExtraction = false; }
  });
  let checkingLayout = false;
  if (diagnostics) app.post('/api/checks/module3', async (_req, res) => {
    if (checkingLayout) throw new HttpError(409, 'Module 3 checks are already running.');
    checkingLayout = true;
    try { res.json(await runLayoutDiagnostics()); } finally { checkingLayout = false; }
  });
  let checkingFocus = false;
  if (diagnostics) app.post('/api/checks/module4', async (_req, res) => {
    if (checkingFocus) throw new HttpError(409, 'Module 4 checks are already running.');
    checkingFocus = true;
    try { res.json(await runFocusDiagnostics()); } finally { checkingFocus = false; }
  });
  let checkingAnimation = false;
  if (diagnostics) app.get('/api/checks/module5/latest', async (_req, res) => {
    try { res.json(await readJson(path.join(root, 'data', 'diagnostics', 'module-five.json'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') res.json(null); else throw e; }
  });
  if (diagnostics) app.post('/api/checks/module5', async (_req, res) => {
    if (checkingAnimation) throw new HttpError(409, 'Module 5 checks are already running.');
    checkingAnimation = true;
    try { res.json(await runAnimationDiagnostics()); } finally { checkingAnimation = false; }
  });
  let checkingFrames = false;
  let checkingExport = false;
  if (diagnostics) app.get('/api/checks/module7/latest', async (_req, res) => { try { res.json(await readJson(path.join(root, 'previews', 'module-seven-report.json'))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') res.json(null); else throw e; } });
  if (diagnostics) app.get('/api/checks/module10/latest',async(_req,res)=>{try{res.json(await readJson(path.join(root,'previews','module-ten-report.json')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')res.json(null);else throw e;}});
  if (diagnostics) app.post('/api/checks/module7', async (_req, res) => { if (checkingExport) throw new HttpError(409, 'Module 7 checks are already running.'); checkingExport = true; try { res.json(await runExportDiagnostics()); } finally { checkingExport = false; } });
  if (diagnostics) app.get('/api/checks/module6/latest', async (_req, res) => { try { res.json(await readJson(path.join(root, 'data', 'diagnostics', 'module-six.json'))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') res.json(null); else throw e; } });
  if (diagnostics) app.post('/api/checks/module6', async (_req, res) => { if (checkingFrames) throw new HttpError(409, 'Module 6 checks are already running.'); checkingFrames = true; try { res.json(await runFrameDiagnostics()); } finally { checkingFrames = false; } });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Upload exceeds the size limit: 20 MB images / 512 MB video or audio.' : 'Upload exactly one file in the required field.' }); return;
    }
    if (error instanceof HttpError || error instanceof ExtractionError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError || error?.type === 'entity.too.large') { res.status(400).json({ error: 'Invalid or oversized project JSON.' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Local processing failed. See the service terminal for details.' });
  };
  app.use(errorHandler);
  return app;
}
