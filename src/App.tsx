import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { jsonOptions, request, uploadImage, type CheckReport, type SavedProject } from './api';
import { apiBaseUrl, apiUrl } from './urls';
import { dimensions, layoutLabel, moveGridEdge, validId, validateProject, type Layout, type Panel, type Project } from '../shared/project';
import Icon from './components/Icon';
import PanelEditor from './components/PanelEditor';
import ExtractionStep from './components/ExtractionStep';
import GridStep from './components/GridStep';
import FocusStep from './components/FocusStep';
import AnimationStep from './components/AnimationStep';
import FrameStep from './components/FrameStep';
import ExportStep from './components/ExportStep';
import AssemblyStep from './components/AssemblyStep';
import MotionPromptStep from './components/MotionPromptStep';
import NarrationStep from './components/NarrationStep';
import ProjectManager from './components/ProjectManager';
import AssetDashboard from './components/AssetDashboard';
import RenderQueue from './components/RenderQueue';
import type { AnimationManifest } from '../shared/animation';
import type { FrameValidationReport } from '../shared/frames';
import type { FocusConfig } from '../shared/focus';
import type { ExtractionManifest } from '../shared/extraction';
import type { LayoutManifest } from '../shared/layout';

const testNames = ['Upload valid portrait comic (PNG)', 'Upload valid landscape comic (JPG)', 'Upload WEBP image', 'Detect six regions and gutter boundaries', 'Adjust gutters manually and save', 'Reject unsupported and corrupt images', 'Reload saved layout coordinates', 'Switch between 2 × 3 and 3 × 2', 'Reject overlapping and invalid project coordinates', 'Respect EXIF orientation'];

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState(1);
  const [operation, setBusy] = useState('');
  const [extractionRunning, setExtractionRunning] = useState(false);
  const [gridRunning, setGridRunning] = useState(false);
  const [focusRunning, setFocusRunning] = useState(false);
  const [animationRunning, setAnimationRunning] = useState(false);
  const [frameRunning, setFrameRunning] = useState(false);
  const [exportRunning, setExportRunning] = useState(false);
  const [assemblyRunning, setAssemblyRunning] = useState(false), [narrationRunning, setNarrationRunning] = useState(false), [narrationStamp, setNarrationStamp] = useState(0);
  const [animationManifest, setAnimationManifest] = useState<AnimationManifest | null>(null);
  const [frameReport, setFrameReport] = useState<FrameValidationReport | null>(null);
  const [focusConfig, setFocusConfig] = useState<FocusConfig | null>(null);
  const [extractionManifest, setExtractionManifest] = useState<ExtractionManifest | null>(null);
  const [layoutManifest, setLayoutManifest] = useState<LayoutManifest | null>(null);
  const busy = operation || (extractionRunning ? 'Extracting six tiles…' : gridRunning ? 'Creating mobile and desktop grids…' : focusRunning ? 'Saving / rendering focus framing…' : animationRunning ? 'Rendering camera animation…' : frameRunning ? 'Verifying authoritative video frames…' : exportRunning ? 'Validating and packaging assets…' : assemblyRunning ? 'Assembling final lesson…' : '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [guides, setGuides] = useState(true);
  const [mode, setMode] = useState<'gutters' | 'panel'>('gutters');
  const [dragOver, setDragOver] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [savePath, setSavePath] = useState('');
  const [service, setService] = useState<'checking' | 'online' | 'offline'>('checking');
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const errors = project ? validateProject(project) : [];
  const chosen = project?.panels.find(p => p.id === selected);
  const stageAnchors = ['upload-comic', 'panel-adjustment', 'extract-six-tiles', 'create-six-tile-grids', 'camera-focus', 'camera-animation', 'gemini-first-frames', 'gemini-motion', 'export-package', 'assemble-lesson'];
  const stageLabels = ['Upload', 'Panels', 'Extract', 'Grids', 'Framing', 'Camera', 'Verify frames', 'Motion prompts', 'Export', 'Assemble'];
  const completion = [!!project, !!project && !dirty && !errors.length, !!extractionManifest, !!layoutManifest, !!focusConfig?.updatedAt, !!animationManifest, !!frameReport && frameReport.frames.length === 12 && frameReport.frames.every(f => f.readyForGemini), false, false, false];
  const allowed = [true, !!project, completion[1], completion[2], completion[3], completion[4], completion[5], completion[6], completion[6], completion[6]];
  const [activeStage, setActiveStage] = useState(1);
  const [resumeStage, setResumeStage] = useState<number | null>(null);

  useEffect(() => { const controller = new AbortController(); if (project && !dirty) request<{ lastStage: number }>(`/api/projects/${project.id}/session`, { signal: controller.signal }).then(s => setResumeStage(s.lastStage)).catch(() => {}); return () => controller.abort(); }, [project?.id]);
  useEffect(() => { if (resumeStage && allowed[resumeStage - 1]) { setActiveStage(resumeStage); document.getElementById(stageAnchors[resumeStage - 1])?.scrollIntoView(); setResumeStage(null); } }, [resumeStage, extractionManifest, layoutManifest, focusConfig, animationManifest, frameReport]);
  function navigate(stage: number) { if (!allowed[stage - 1]) return; setActiveStage(stage); document.getElementById(stageAnchors[stage - 1])?.scrollIntoView({ block: 'start' }); if (project && !dirty) void request(`/api/projects/${project.id}/session`, jsonOptions('PUT', { lastStage: stage })).catch(() => {}); }
  function clearAssets(){setExtractionManifest(null);setLayoutManifest(null);setFocusConfig(null);setAnimationManifest(null);setFrameReport(null);}
  function newProject() { if (dirty && !window.confirm('Discard unsaved panel changes and create a new project?')) return; clearAssets();setProject(null); setDirty(false); setNotice('Choose a comic to create a new project.'); setError(''); setActiveStage(1); setResumeStage(null); }

  useEffect(() => {
    const abort = new AbortController();
    request<{ status: string }>('/api/health', { signal: abort.signal }).then(() => setService('online')).catch(() => { if (!abort.signal.aborted) setService('offline'); });
    request<SavedProject[]>('/api/projects', { signal: abort.signal }).then(setSavedProjects).catch(() => {});
    const linkedProject = new URLSearchParams(window.location.search).get('project');
    if (validId(linkedProject)) request<Project>(`/api/projects/${linkedProject}`, { signal: abort.signal })
      .then(next => { if (!abort.signal.aborted) activate(next, 'Saved project opened from its local link.'); })
      .catch(problem => { if (!abort.signal.aborted) setError(problem instanceof Error ? problem.message : 'The linked project could not be opened.'); });
    return () => abort.abort();
  }, []);

  async function work(label: string, operation: () => Promise<void>) {
    if (working.current || extractionRunning || gridRunning || focusRunning || animationRunning || frameRunning || exportRunning || assemblyRunning) return;
    working.current = true; setBusy(label); setError(''); setNotice('');
    try { await operation(); setService('online'); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Something went wrong. Try again.'); }
    finally { setBusy(''); working.current = false; }
  }
  function activate(next: Project, message: string, changed = false) {
    if(next.id!==project?.id)clearAssets();
    setProject(next); setSelected(1); setGuides(true); setDirty(changed); setSavePath(''); setNotice(message); setResumeStage(null);
    void request<SavedProject[]>('/api/projects').then(setSavedProjects).catch(() => {});
  }
  function edit(next: Project) { setProject(next); setDirty(true); setNotice(''); }
  function receive(file?: File) {
    if (!file) return;
    void work('Detecting panels…', async () => activate(await uploadImage(file), 'Comic uploaded. Review the six numbered guides.', true));
  }
  function onImage(event: ChangeEvent<HTMLInputElement>) { receive(event.target.files?.[0]); event.target.value = ''; }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragOver(false);
    if (busy) return;
    if (event.dataTransfer.files.length !== 1) { setError('Drop exactly one comic image.'); return; }
    receive(event.dataTransfer.files[0]);
  }
  function sample(filename: string, type: string) {
    void work('Loading sample…', async () => {
      const response = await fetch(apiUrl(`/api/fixtures/${filename}`));
      if (!response.ok) throw new Error('Fixture missing. Run npm run fixtures first.');
      const file = new File([await response.blob()], filename, { type });
      activate(await uploadImage(file), 'Sample loaded. Drag a guide to refine its boundaries.', true);
    });
  }
  function detect(layout?: Layout) {
    if (!project) return;
    void work('Detecting panels…', async () => {
      const next = await request<Pick<Project, 'layout' | 'grid' | 'panels' | 'detection'>>('/api/detect', jsonOptions('POST', { inputId: project.input.id, ...(layout ? { layout } : {}) }));
      edit({ ...project, ...next, manuallyAdjusted: false }); setSelected(1);
      setNotice(layout ? `${layoutLabel(layout)} layout applied. Review the updated guides.` : 'Automatic detection refreshed.');
    });
  }
  async function save(download = false) {
    if (!project || errors.length) return;
    await work('Saving project…', async () => {
      const saved = await request<{ project: Project; path: string }>(`/api/projects/${project.id}`, jsonOptions('PUT', project));
      setProject(saved.project); setDirty(false); setSavePath(saved.path);
      setSavedProjects(await request<SavedProject[]>('/api/projects'));
      setNotice('Project saved locally with all six panel coordinates.');
      if (download) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(saved.project, null, 2) + '\n'], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = `${saved.project.title.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'sixframe-project'}.json`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    await work('Opening project…', async () => {
      if (file.size > 1024 * 1024) throw new Error('Project JSON exceeds the 1 MB limit.');
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid project JSON.'); }
      const validation = validateProject(parsed);
      if (validation.length) throw new Error(validation.join(' '));
      activate(await request<Project>('/api/projects/import', jsonOptions('POST', parsed)), 'Project reopened with its saved coordinates.', true);
    });
  }
  function reopen(id: string) {
    if (!id) return;
    void work('Opening project…', async () => activate(await request<Project>(`/api/projects/${id}`), 'Saved project reopened. Coordinates restored exactly.'));
  }
  function updatePanel(key: 'x' | 'y' | 'width' | 'height', value: string) {
    if (!project || !chosen || value === '') return;
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return;
    edit({ ...project, panels: project.panels.map(p => p.id === selected ? { ...p, [key]: number } : p), manuallyAdjusted: true });
  }
  async function runChecks() {
    if (checking) return;
    setChecking(true); setCheckError('');
    try { setReport(await request<CheckReport>('/api/checks', { method: 'POST' })); }
    catch (problem) { setCheckError(problem instanceof Error ? problem.message : 'Checks could not run.'); }
    finally { setChecking(false); }
  }

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="Sixframe home"><span className="brand-mark"><span/><span/><span/><span/><span/><span/></span>sixframe<span className="brand-dot">.</span></a>
      <div className="header-divider"/><span className="product-label">LESSON VIDEO BUILDER</span>
      <span className={`local-status ${service}`}><span className="status-dot"/>{service === 'online' ? 'Local service connected' : service === 'offline' ? 'Service unavailable' : 'Connecting to local service'}</span>
      <span className="module-badge">LOCAL LESSON WORKFLOW</span>
    </header>
    <nav className="workspace-nav workflow-navigation" aria-label="Lesson workflow">{stageLabels.map((label, i) => <button key={label} className={activeStage === i + 1 ? 'nav-active' : 'nav-step'} aria-current={activeStage === i + 1 ? 'step' : undefined} disabled={!allowed[i]} onClick={() => navigate(i + 1)}><span className="step-number">{String(i + 1).padStart(2, '0')}</span>{label}<small>{completion[i] ? 'Ready' : allowed[i] ? 'Review' : 'Missing'}</small></button>)}</nav>
    <main>
      {apiBaseUrl && service !== 'online' ? <div className="message loading" role="status"><Icon name="info"/><div><strong>Connect this computer’s processing service.</strong><p>Keep the local processing service running. If your browser asks, allow this editor to connect to your computer.</p></div><button className="button secondary" disabled={service === 'checking'} onClick={() => { setService('checking'); void request('/api/health').then(() => { setService('online'); return request<SavedProject[]>('/api/projects'); }).then(setSavedProjects).catch(() => setService('offline')); }}>Reconnect</button></div> : null}
      <section className="page-intro" id="upload-comic">
        <div><div className="eyebrow">SIX PANELS. ONE STORY.</div><h1>Prepare your comic<span>.</span></h1><p>Bring your story in. Find each frame. Make the boundaries yours.</p></div>
        <div className="intro-actions"><button className="button secondary" onClick={() => jsonInput.current?.click()} disabled={!!busy}><Icon name="folder"/> Open JSON</button><button className="button primary" onClick={() => void save()} disabled={!project || !!busy || errors.length > 0}><Icon name="save"/> Save project</button></div>
      </section>
      <ProjectManager project={project} disabled={!!busy} unsaved={dirty} onNew={newProject} onActivate={p => activate(p, 'Project duplicated. Panel coordinates and settings were retained. Regenerate assets; saved camera settings return when new grids are ready.')} onRemoved={() => { newProject(); void request<SavedProject[]>('/api/projects').then(setSavedProjects); }}/>
      <RenderQueue busy={!!busy}/>
      <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Upload comic" onChange={onImage} disabled={!!busy}/>
      <input ref={jsonInput} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Open project JSON" onChange={event => void importJson(event)} disabled={!!busy}/>
      {error ? <div className="message error" role="alert"><Icon name="info"/>{error}<button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16}/></button></div> : null}
      {notice || busy ? <div className={`message ${busy ? 'loading' : 'success'}`} role="status"><Icon name={busy ? 'refresh' : 'check'}/>{busy || notice}</div> : null}
      <div className="editor-layout" id="panel-adjustment">
        <section className="canvas-card" aria-label="Comic workspace">
          <div className="canvas-toolbar"><div className="file-heading"><span className="file-icon"><Icon name="image"/></span><div><strong>{project ? project.input.filename : 'Your story goes here'}</strong><span>{project ? `${project.input.width} × ${project.input.height} px · ${project.input.format.toUpperCase()} · ${(project.input.bytes / 1024 / 1024).toFixed(2)} MB` : 'A single image, six connected moments'}</span></div></div>
            {project ? <button className="text-button" disabled={!!busy} onClick={() => imageInput.current?.click()}><Icon name="upload" size={15}/> Replace</button> : <span className="mini-label">SOURCE IMAGE</span>}
          </div>
          <div className={`canvas-area ${project ? 'has-comic' : 'empty-canvas'} ${dragOver ? 'drag-over' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={drop}>
            {project ? <PanelEditor project={project} selected={selected} guides={guides} mode={mode} disabled={!!busy} onSelect={setSelected} onChange={edit}/> : <div className="upload-content">
              <div className="upload-illustration" aria-hidden="true"><div className="mini-comic"><span/><span/><span/><span/><span/><span/></div><span className="floating-plus"><Icon name="plus" size={22}/></span></div>
              <span className="eyebrow">START WITH YOUR COMIC</span><h2>A little space for<br/>your next story.</h2><p>Drop a six-panel comic here, or choose an image.<br/>We’ll find the layout and its gutters for you.</p>
              <button className="button primary" disabled={!!busy} onClick={() => imageInput.current?.click()}><Icon name="upload"/> Upload comic <Icon name="arrow" size={16}/></button>
              <span className="upload-formats">PNG, JPG or WEBP · Up to 20 MB</span>
              <div className="sample-links"><span>Try the supplied sample</span><button disabled={!!busy} onClick={() => sample('sample-comic.png', 'image/png')}>Portrait <Icon name="arrow" size={14}/></button><button disabled={!!busy} onClick={() => sample('landscape-comic.jpg', 'image/jpeg')}>Landscape <Icon name="arrow" size={14}/></button></div>
            </div>}
          </div>
          <div className="canvas-footer"><span><span className="guide-swatch"/>{project ? 'Drag a boundary · Arrow keys for precision' : 'Your original image stays in its original proportions'}</span>{project ? <label className="guide-toggle"><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)}/> Show guides</label> : <span>100% local</span>}</div>
        </section>
        <aside className="inspector" aria-label="Panel settings">
          <section className="settings-card">
            <div className="section-heading"><span className="section-index">01</span><h2>Panel layout</h2><span className="small-tag">6 TILES</span></div>
            <p className="section-description">Choose columns × rows. We’ll look for the spaces between your panels.</p>
            <div className="layout-options">{(['2x3', '3x2'] as Layout[]).map(layout => {
              const { columns, rows } = dimensions(layout);
              return <button key={layout} aria-label={`Use ${columns} columns by ${rows} rows`} aria-pressed={project?.layout === layout} disabled={!project || !!busy} className={`layout-option ${project?.layout === layout ? 'active' : ''}`} onClick={() => detect(layout)}>
                <span className="layout-preview" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>{Array.from({ length: 6 }, (_, i) => <i key={i}/>)}</span><strong>{layoutLabel(layout)}</strong><span>{layout === '2x3' ? 'Portrait' : 'Landscape'}</span>{project?.layout === layout ? <span className="layout-check"><Icon name="check" size={12}/></span> : null}
              </button>;
            })}</div>
            {project ? <div className={`detection-summary ${project.detection.confidence < 0.7 ? 'uncertain' : ''}`}><span className="status-dot"/><strong>{Math.round(project.detection.confidence * 100)}% detection confidence</strong><span>{project.manuallyAdjusted ? 'Manually refined' : 'Automatically detected'}</span></div> : <div className="quiet-note"><Icon name="info" size={15}/> Layout detection begins after upload.</div>}
            {project && project.detection.confidence < 0.7 ? <p className="confidence-note">{project.detection.notes[0]}</p> : null}
          </section>
          <section className="settings-card panel-settings">
            <div className="section-heading"><span className="section-index">02</span><h2>Refine boundaries</h2><span className="coordinate-label">PX</span></div>
            <div className="segmented" aria-label="Boundary editing mode"><button aria-pressed={mode === 'gutters'} onClick={() => setMode('gutters')}>Gutters</button><button aria-pressed={mode === 'panel'} onClick={() => setMode('panel')}>Individual panel</button></div>
            <p className="section-description">{mode === 'gutters' ? 'Move a shared edge to adjust a whole row or column.' : 'Select a panel, then drag any of its four edges.'}</p>
            <div className="panel-list" aria-label="Panel coordinates"><div className="panel-list-header"><span>PANEL</span><span>POSITION</span><span>SIZE</span></div>
              {Array.from({ length: 6 }, (_, i) => {
                const p = project?.panels[i];
                return <button className={`panel-row ${project && selected === i + 1 ? 'active' : ''}`} key={i} disabled={!project} onClick={() => setSelected(i + 1)} aria-label={`Select panel ${i + 1}`} aria-pressed={!!project && selected === i + 1}><span className="panel-id">{String(i + 1).padStart(2, '0')}</span><span>{p ? `${p.x}, ${p.y}` : '—, —'}</span><span>{p ? `${p.width} × ${p.height}` : '— × —'}</span></button>;
              })}
            </div>
            {project && chosen ? <><div className="coordinate-heading"><strong>Panel {String(selected).padStart(2, '0')}</strong><span>Original-image pixels</span></div><div className="coordinate-inputs">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}><span>{key === 'width' ? 'Width' : key === 'height' ? 'Height' : key.toUpperCase()}</span><input type="number" step="1" aria-label={`Panel ${selected} ${key}`} value={chosen[key]} disabled={!!busy} onChange={event => updatePanel(key, event.target.value)}/></label>)}</div>
              {mode === 'gutters' ? <details className="gutter-details"><summary>Gutter coordinates</summary>{(['x', 'y'] as const).flatMap(axis => project.grid[axis].slice(0, -1).map((span, i) => <div className="gutter-input-row" key={`${axis}${i}`}><span>{axis === 'x' ? 'Column' : 'Row'} gap {i + 1}</span><label><span className="visually-hidden">{axis} gutter {i + 1} start</span><input type="number" aria-label={`${axis} gutter ${i + 1} start`} value={span[1]} disabled={!!busy} onChange={event => { if (event.target.value !== '' && Number.isSafeInteger(Number(event.target.value))) edit(moveGridEdge(project, axis, i, 1, Number(event.target.value))); }}/></label><span>to</span><label><span className="visually-hidden">{axis} gutter {i + 1} end</span><input type="number" aria-label={`${axis} gutter ${i + 1} end`} value={project.grid[axis][i + 1][0]} disabled={!!busy} onChange={event => { if (event.target.value !== '' && Number.isSafeInteger(Number(event.target.value))) edit(moveGridEdge(project, axis, i + 1, 0, Number(event.target.value))); }}/></label></div>))}</details> : null}
            </> : <p className="empty-coordinates">Your six panel coordinates will appear here.</p>}
            <button className="redetect-button" disabled={!project || !!busy} onClick={() => detect()}><Icon name="refresh" size={15}/> Reset & auto-detect</button>
          </section>
          <div className={`validation-card ${errors.length ? 'invalid' : ''}`} role="status"><span className="validation-icon"><Icon name={errors.length ? 'info' : 'check'} size={18}/></span><div><strong>{!project ? 'Ready when you are' : errors.length ? 'Boundaries need attention' : 'Six valid panels'}</strong><p>{!project ? 'Upload a comic to validate its panels.' : errors.length ? errors.join(' ') : 'Rectangular, inside the image, no overlaps.'}</p></div></div>
        </aside>
      </div>
      <section className="project-strip" aria-label="Project file"><div className="project-strip-icon"><Icon name="folder" size={23}/></div><div className="project-description"><strong>{project ? (dirty ? 'Unsaved changes' : 'Project ready') : 'A project you can come back to.'}</strong><span>{savePath || 'Save your source metadata, layout, and coordinates together in a project JSON.'}</span></div>
        {project ? <label className="project-name"><span>PROJECT NAME</span><input aria-label="Project name" maxLength={200} value={project.title} disabled={!!busy} onChange={event => edit({ ...project, title: event.target.value })}/></label> : null}
        <button className="button secondary" disabled={!project || !!busy || errors.length > 0} onClick={() => void save(true)}><Icon name="download" size={16}/> Download JSON</button>
      </section>
      {project ? <label className="project-lesson-title">Lesson title<input aria-label="Project lesson title" maxLength={200} value={project.lessonTitle || ''} disabled={!!busy} onChange={e => edit({ ...project, lessonTitle: e.target.value })}/></label> : null}
      {savedProjects.length ? <div className="saved-projects"><label htmlFor="saved-project">Reopen a local project</label><select id="saved-project" value="" disabled={!!busy} onChange={event => reopen(event.target.value)}><option value="">Choose saved project…</option>{savedProjects.map(p => <option key={p.id} value={p.id}>{p.title} · {layoutLabel(p.layout)}</option>)}</select></div> : null}
      <ExtractionStep project={project} dirty={dirty} valid={!!project && errors.length === 0} externalBusy={!!operation || gridRunning || focusRunning || animationRunning || frameRunning || exportRunning || assemblyRunning} onRunningChange={setExtractionRunning} onManifestChange={setExtractionManifest} onBack={() => document.getElementById('panel-adjustment')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}/>
      <GridStep project={project} source={extractionManifest} dirty={dirty} externalBusy={!!operation || extractionRunning || focusRunning || animationRunning || frameRunning || exportRunning || assemblyRunning} onRunningChange={setGridRunning} onManifestChange={setLayoutManifest}/>
      <FocusStep project={project} source={extractionManifest} layout={layoutManifest} dirty={dirty} externalBusy={!!operation || extractionRunning || gridRunning || animationRunning || frameRunning || exportRunning || assemblyRunning} onRunningChange={setFocusRunning} onConfigChange={setFocusConfig}/>
      <AnimationStep config={dirty ? null : focusConfig} externalBusy={!!operation || extractionRunning || gridRunning || focusRunning || frameRunning || exportRunning || assemblyRunning} onRunningChange={setAnimationRunning} onManifestChange={setAnimationManifest}/>
      <FrameStep source={animationManifest} externalBusy={!!operation || extractionRunning || gridRunning || focusRunning || animationRunning || exportRunning || assemblyRunning} onRunningChange={setFrameRunning} onReportChange={setFrameReport}/>
      <MotionPromptStep project={project&&!dirty?project:null} frames={dirty?null:frameReport} externalBusy={!!operation||extractionRunning||gridRunning||focusRunning||animationRunning||frameRunning||exportRunning||assemblyRunning}/>
      <ExportStep project={project} frames={dirty ? null : frameReport} externalBusy={!!operation || extractionRunning || gridRunning || focusRunning || animationRunning || frameRunning || assemblyRunning} onRunningChange={setExportRunning}/>
      <NarrationStep project={project&&!dirty?project:null} externalBusy={!!operation||extractionRunning||gridRunning||focusRunning||animationRunning||frameRunning||exportRunning||assemblyRunning} onGenerated={()=>setNarrationStamp(Date.now())} onRunningChange={setNarrationRunning}/>
      <AssemblyStep project={project&&!dirty?project:null} projects={savedProjects} sourceKey={`${frameReport?.updatedAt}|${narrationStamp}`} externalBusy={!!operation||extractionRunning||gridRunning||focusRunning||animationRunning||frameRunning||exportRunning||narrationRunning} onRunningChange={setAssemblyRunning} onProjectChange={reopen}/>
      <div className="stage-actions"><button className="button secondary" disabled={activeStage <= 1} onClick={() => navigate(activeStage - 1)}>Previous stage</button><button className="button secondary" disabled={!project || !!busy || errors.length > 0} onClick={() => void save()}>Save changes</button><button className="button primary" disabled={activeStage >= 10 || !allowed[activeStage]} onClick={() => navigate(activeStage + 1)}>Next stage</button></div>
      <AssetDashboard projectId={project && !dirty ? project.id : undefined} refreshKey={[project?.updatedAt, extractionManifest?.extractionId, layoutManifest?.generationId, focusConfig?.revision, animationManifest?.renderId, frameReport?.updatedAt, exportRunning, assemblyRunning].join(':')}/>
      <section className="test-card" aria-label="Module 1 tests"><div className="test-card-heading"><div><span className="eyebrow">THE CONFIDENCE CHECK</span><h2><Icon name="flask" size={21}/> Module 1 test bench</h2><p>The supplied comic, both layouts, and the full save–reload flow.</p></div><div className="test-actions">{report ? <span className={`test-total ${report.passed !== report.total ? 'failed' : ''}`}>{report.passed}/{report.total} PASS</span> : null}<button className="button secondary" disabled={checking} onClick={() => void runChecks()}><Icon name={checking ? 'refresh' : 'check'}/>{checking ? 'Running checks…' : 'Run checks'}</button></div></div>
        {checkError ? <div className="message error" role="alert">{checkError}</div> : null}
        <div className="test-grid">{(report?.results ?? testNames.map(name => ({ name, status: null, detail: 'Run checks to test this scenario.' }))).map((result, i) => <div className="test-result" key={result.name}><span className="test-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{result.name}</strong>{report ? <p>{result.detail}</p> : null}</div><span className={`test-status ${result.status?.toLowerCase() ?? 'pending'}`}>{result.status ?? 'NOT RUN'}</span></div>)}</div>
        <div className="test-footer"><Icon name="info" size={14}/><span>Checks use a temporary workspace. Your active comic and saved projects stay untouched.</span></div>
      </section>
      <footer className="page-footer"><span>sixframe<span>.</span> <small>Small frames. Meaningful stories.</small></span><span>LOCAL COMIC TO CLIPCHAMP ASSETS</span></footer>
    </main>
  </div>;
}
