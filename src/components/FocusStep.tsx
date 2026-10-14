import { apiUrl } from '../urls';
import { useEffect, useRef, useState } from 'react';
import { request, jsonOptions, type CheckReport } from '../api';
import type { Project } from '../../shared/project';
import type { ExtractionManifest } from '../../shared/extraction';
import { outputFormats, outputSpec, type LayoutManifest, type OutputFormat } from '../../shared/layout';
import { applyAutomaticSuggestion, defaultFocusView, focusCheckNames, focusKey, focusPixelConfiguration, resolveFocusView, type CameraSettings, type FocusConfig, type FocusJob, type FocusPreviewManifest, type FocusState, type FocusView } from '../../shared/focus';
import FocusCanvas from './FocusCanvas';
import Icon from './Icon';

export default function FocusStep({ project, source, layout, dirty, externalBusy, onRunningChange, onConfigChange }: {
  project: Project | null; source: ExtractionManifest | null; layout: LayoutManifest | null; dirty: boolean;
  externalBusy: boolean; onRunningChange: (running: boolean) => void;
  onConfigChange: (config: FocusConfig | null) => void;
}) {
  const [config, setConfig] = useState<FocusConfig | null>(null);
  const configRef = useRef<FocusConfig | null>(null);
  const [format, setFormat] = useState<OutputFormat>('mobile'), [number, setNumber] = useState(1);
  const [manifest, setManifest] = useState<FocusPreviewManifest | null>(null), [job, setJob] = useState<FocusJob | null>(null);
  const [manifestSignature, setManifestSignature] = useState('');
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [starting, setStarting] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [safeArea, setSafeArea] = useState(true), [thirds, setThirds] = useState(true);
  const [unsaved, setUnsaved] = useState(false), [editVersion, setEditVersion] = useState(0);
  const version = useRef(0), savedVersion = useRef(0), epoch = useRef(0);
  const savePromise = useRef<Promise<FocusConfig | null> | null>(null);
  const [undo, setUndo] = useState<FocusView[][]>([]), [redo, setRedo] = useState<FocusView[][]>([]);
  const [report, setReport] = useState<CheckReport | null>(null), [checking, setChecking] = useState(false), [checkError, setCheckError] = useState('');
  const running = starting || job?.status === 'running';
  const ready = !!project && !!source && !!layout && !dirty && layout.projectId === project.id && layout.extractionId === source.extractionId;
  const locked = !ready || !config || loading || running || externalBusy;
  const view = config?.views.find(v => v.format === format && v.tileNumber === number);
  const active = view?.[view.cameraMode], transform = view?.transform;
  const freshManifest = ready && config && !unsaved && manifest?.layoutGenerationId === layout.generationId && manifestSignature === JSON.stringify(focusPixelConfiguration(config)) && job?.status !== 'running' ? manifest : null;

  function install(next: FocusConfig | null) { configRef.current = next; setConfig(next); }
  useEffect(() => { onConfigChange(ready && config?.updatedAt && !unsaved && !saving ? config : null); }, [ready, config, unsaved, saving, onConfigChange]);
  useEffect(() => { onRunningChange(running || saving || (unsaved && !error)); return () => onRunningChange(false); }, [running, saving, unsaved, error, onRunningChange]);
  useEffect(() => {
    const controller = new AbortController(); epoch.current++;
    install(null); setManifest(null); setJob(null); setError(''); setNotice(''); setUndo([]); setRedo([]); setUnsaved(false); version.current = savedVersion.current = 0;
    if (!ready || !project) { setLoading(false); return; }
    setLoading(true);
    request<FocusState>(`/api/projects/${project.id}/focus`, { signal: controller.signal }).then(state => {
      if (controller.signal.aborted) return;
      install(state.config); setManifest(state.manifest); setJob(state.job);
      setManifestSignature(state.manifest ? JSON.stringify(focusPixelConfiguration(state.config)) : '');
      if (state.job?.status === 'failed') setError(state.job.error ?? state.job.message);
    }).catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Focus settings could not be loaded.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project?.id, layout?.generationId, source?.extractionId, dirty, ready]);

  function checkpoint() {
    if (!configRef.current || locked) return;
    setUndo(history => [...history.slice(-79), structuredClone(configRef.current!.views)]); setRedo([]);
  }
  function replaceViews(views: FocusView[]) {
    const current = configRef.current; if (!current) return;
    install({ ...current, views }); version.current++; setEditVersion(version.current); setUnsaved(true); setNotice('');
  }
  function changeView(next: FocusView, history = true) {
    if (!layout || !source || !configRef.current || locked) return;
    if (history) checkpoint();
    const resolved = resolveFocusView(next, layout, source);
    replaceViews(configRef.current.views.map(v => focusKey(v) === focusKey(next) ? resolved : v));
  }
  function updateSettings(next: CameraSettings, history = true) {
    if (!view) return;
    changeView({ ...view, [view.cameraMode]: next, manualOverride: true, approved: false }, history);
  }
  function historyMove(direction: 'undo' | 'redo') {
    const current = configRef.current, history = direction === 'undo' ? undo : redo;
    if (!current || !history.length || locked) return;
    const restored = structuredClone(history[history.length - 1]).map(v => ({ ...v, approved: false }));
    if (direction === 'undo') { setUndo(history.slice(0, -1)); setRedo(h => [...h, structuredClone(current.views)]); }
    else { setRedo(history.slice(0, -1)); setUndo(h => [...h, structuredClone(current.views)]); }
    replaceViews(restored);
  }
  async function saveNow(approval?: string): Promise<FocusConfig | null> {
    if (savePromise.current) await savePromise.current;
    const current = configRef.current;
    if (!current || !project || !ready) return null;
    if (savedVersion.current === version.current && !approval && current.updatedAt) return current;
    const capturedVersion = version.current, capturedEpoch = epoch.current;
    setSaving(true); setError('');
    const pending = request<FocusConfig>(`/api/projects/${project.id}/focus`, jsonOptions('PUT', { config: current, expectedRevision: current.revision, ...(approval ? { approveView: approval } : {}) })).then(saved => {
      if (capturedEpoch !== epoch.current) return null;
      const latest = configRef.current;
      install(capturedVersion === version.current ? saved : latest ? { ...latest, revision: saved.revision, updatedAt: saved.updatedAt } : saved);
      savedVersion.current = capturedVersion; setUnsaved(capturedVersion !== version.current);
      if (approval) setNotice('Current framing saved and approved. Automatic suggestions will preserve it.');
      return saved;
    }).catch(problem => { if (capturedEpoch === epoch.current) setError(problem instanceof Error ? problem.message : 'Focus settings could not be saved.'); return null; }).finally(() => { savePromise.current = null; setSaving(false); });
    savePromise.current = pending;
    return pending;
  }
  useEffect(() => {
    if (!unsaved || !ready || running || externalBusy) return;
    const timer = setTimeout(() => { void saveNow(); }, 650);
    return () => clearTimeout(timer);
  }, [editVersion, config?.revision, unsaved, ready, running, externalBusy]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const controller = new AbortController(), { projectId, id } = job;
    async function poll() {
      try {
        while (!controller.signal.aborted) {
          const next = await request<FocusJob>(`/api/projects/${projectId}/focus-previews/${id}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setJob(next);
          if (next.status === 'complete') { setManifest(next.manifest!); setManifestSignature(configRef.current ? JSON.stringify(focusPixelConfiguration(configRef.current)) : ''); setNotice('12 provisional still previews are ready. Guides are excluded.'); return; }
          if (next.status === 'failed') { setError(next.error ?? next.message); return; }
          if (next.status === 'cancelled') return;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch (problem) { if (!controller.signal.aborted) { setJob(j => j ? { ...j, status: 'failed' } : null); setError(`${problem instanceof Error ? problem.message : 'Connection lost.'} Reopen this project to reconnect.`); } }
    }
    void poll(); return () => controller.abort();
  }, [job?.id, job?.status]);
  async function generate() {
    if (locked || !project) return;
    setStarting(true); setError('');
    try {
      const saved = await saveNow(); if (!saved) return;
      setJob(await request<FocusJob>(`/api/projects/${project.id}/focus-previews`, jsonOptions('POST', { expectedRevision: saved.revision })));
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Preview generation could not start.'); }
    finally { setStarting(false); }
  }
  async function cancel() {
    if (!job) return;
    try { setJob(await request<FocusJob>(`/api/projects/${job.projectId}/focus-previews/${job.id}/cancel`, { method: 'POST' })); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Cancellation failed.'); }
  }
  function reset() {
    if (!view || !layout || !source) return;
    changeView(defaultFocusView(format, number, layout, source));
  }
  function centre(fit = active?.fit) {
    if (!view || !layout || !source || !active) return;
    const defaults = defaultFocusView(format, number, layout, source);
    updateSettings({ ...active, center: defaults[view.cameraMode].center, ...(fit ? { fit } : {}) });
  }
  function fit(mode: 'FIT' | 'FILL') { if (active) { const defaults = layout && source ? defaultFocusView(format, number, layout, source) : null; updateSettings({ ...active, fit: mode, zoom: 1, center: defaults && view ? defaults[view.cameraMode].center : active.center }); } }
  async function runChecks() {
    setChecking(true); setCheckError('');
    try { setReport(await request<CheckReport>('/api/checks/module4', { method: 'POST' })); }
    catch (problem) { setCheckError(problem instanceof Error ? problem.message : 'Checks failed to run.'); }
    finally { setChecking(false); }
  }
  return <>
    <section id="camera-focus" className="extraction-card focus-card" aria-label="Step 4 camera focus">
      <div className="extraction-heading"><div><div className="eyebrow">CHOOSE WHAT EACH MOMENT HOLDS.</div><h2><span className="extraction-step-number">04</span> Step 4 — Camera Focus and Framing</h2><p>Twelve independent compositions. Native grid cameras and clearly labelled tile details.</p></div><span className="native-badge">PROVISIONAL STILLS</span></div>
      {!ready || !config || !view || !active || !transform ? <div className="approval-banner"><Icon name="info"/><div><strong>{loading ? 'Loading saved focus settings…' : 'Generate the approved mobile and desktop grids in Step 3.'}</strong><p>Framing is tied to those exact grids and extracted tiles.</p></div></div> : <>
        <div className="focus-workspace"><aside className="focus-selection"><div className="segmented">{outputFormats.map(f => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f === 'mobile' ? 'Mobile' : 'Desktop'}</button>)}</div><div className="focus-thumbnails">{source.tiles.map(tile => <button className={number === tile.number ? 'selected' : ''} key={tile.number} aria-label={`Focus tile ${tile.number}`} aria-pressed={number === tile.number} onClick={() => setNumber(tile.number)}><img src={apiUrl(tile.imageUrl)} alt={`Source tile ${tile.number}`}/><span>Tile {tile.number}</span><small>{config.views.find(v => v.tileNumber === tile.number && v.format === format)?.approved ? 'Approved' : 'Editable'}</small></button>)}</div><p>Mobile and desktop framing are saved independently.</p></aside>
          <div className="focus-preview-area"><div className="focus-preview-label"><strong>{format === 'mobile' ? 'Mobile' : 'Desktop'} · Tile {number}</strong><span>{outputSpec[format].aspect} · {transform.viewport.width} × {transform.viewport.height}</span></div><div className={`focus-stage ${format}`}><FocusCanvas transform={transform} settings={active} imageUrl={view.cameraMode === 'native' ? layout.outputs[format].imageUrl : source.tiles[number - 1].imageUrl} safeArea={safeArea} thirds={thirds} disabled={locked} onCheckpoint={checkpoint} onChange={next => updateSettings(next, false)}/></div><div className="focus-guide-controls"><label><input type="checkbox" checked={safeArea} onChange={e => setSafeArea(e.target.checked)}/> Safe area</label><label><input type="checkbox" checked={thirds} onChange={e => setThirds(e.target.checked)}/> Rule of thirds</label><button className="text-button" disabled={locked || !undo.length} onClick={() => historyMove('undo')}>Undo</button><button className="text-button" disabled={locked || !redo.length} onClick={() => historyMove('redo')}>Redo</button></div><p className="focus-help">Drag to pan · Wheel or +/− to zoom · Arrow keys to move · Shift for larger steps</p><div className="focus-geometry" data-testid="focus-geometry"><span>Scale {transform.scale.toFixed(4)} · X {transform.focalPoint.x.toFixed(2)} · Y {transform.focalPoint.y.toFixed(2)}</span><span>Visible source: {transform.visibleSourceRectangle.width.toFixed(2)} × {transform.visibleSourceRectangle.height.toFixed(2)} px</span></div></div>
          <aside className="focus-controls"><label><span>Camera mode</span><select aria-label="Camera mode" value={view.cameraMode} disabled={locked} onChange={e => changeView({ ...view, cameraMode: e.target.value as 'native' | 'detail', manualOverride: true, approved: false })}><option value="native">Native Camera</option><option value="detail">Reframed Detail</option></select></label><label><span>Zoom · {active.zoom.toFixed(2)}×</span><input aria-label="Focus zoom" type="range" min="0.25" max="8" step="0.01" value={active.zoom} disabled={locked} onChange={e => updateSettings({ ...active, zoom: Number(e.target.value) })}/></label>{(['x', 'y'] as const).map(axis => <label key={axis}><span>{axis === 'x' ? 'Horizontal' : 'Vertical'} focus · {Math.round(active.center[axis] * 100)}%</span><input aria-label={`${axis === 'x' ? 'Horizontal' : 'Vertical'} focus`} type="range" min="0" max="1" step="0.001" value={active.center[axis]} disabled={locked} onChange={e => updateSettings({ ...active, center: { ...active.center, [axis]: Number(e.target.value) } })}/></label>)}<label><span>Padding colour</span><input type="color" aria-label="Focus padding colour" value={active.paddingColor} disabled={locked} onChange={e => updateSettings({ ...active, paddingColor: e.target.value })}/></label><div className="focus-buttons"><button className="button secondary" disabled={locked} onClick={() => { if (view.manualOverride || view.approved) setNotice('Manual framing retained. Use Reset to automatic to replace it.'); else if (layout && source) changeView(applyAutomaticSuggestion(view, layout, source)); }}>Auto Focus</button><button className="button secondary" disabled={locked} onClick={() => centre()}>Centre</button><button className="button secondary" disabled={locked} onClick={() => fit('FIT')}>Fit entire scene</button><button className="button secondary" disabled={locked} onClick={() => fit('FILL')}>Fill output frame</button><button className="button secondary" disabled={locked} onClick={reset}>Reset to automatic</button><button className="button primary" disabled={locked || saving} onClick={() => void saveNow(focusKey(view))}>{saving ? 'Saving…' : 'Save current framing'}</button></div><p className="focus-save-status" role="status">{saving ? 'Autosaving framing…' : unsaved ? 'Changes awaiting autosave' : config.updatedAt ? `Saved locally · Revision ${config.revision}` : 'Default framing · Save or edit to persist'}</p></aside>
        </div>
        <div className="focus-detection-note"><Icon name="info" size={16}/><span><strong>Unverified centre suggestion.</strong> {view.autoDetection.reason}</span></div>
        {view.cameraMode === 'detail' ? <div className="grid-fill-warning" role="status"><Icon name="info" size={17}/><span><strong>Reframed Detail.</strong> This isolated tile composition may require a controlled transition in Module 5. It is separate from a continuous native grid zoom.</span></div> : <div className="focus-native-note"><Icon name="grid" size={16}/>{transform.neighboursOrGuttersVisible ? 'Native Camera: neighbouring tiles or gutters are visible at this framing. Increase zoom or adjust position to change the view.' : 'Native Camera: this frame is a crop and uniform scale of the approved grid.'}</div>}
        {transform.selectedContentRemovedPercent > 10 ? <div className="grid-fill-warning" role="status"><Icon name="info" size={17}/><span>{transform.selectedContentRemovedPercent.toFixed(1)}% of the selected {view.cameraMode === 'native' ? 'grid cell' : 'source artwork'} is outside this frame. Inspect faces, eyes, hands, objects, posture and headroom manually.</span></div> : null}
      </>}
      {error ? <div className="message error" role="alert"><Icon name="info"/>{error}</div> : null}{notice ? <div className="message success" role="status"><Icon name="check"/>{notice}</div> : null}
      {running || job?.status === 'cancelled' ? <div className="extraction-progress"><div><strong>{running ? 'Rendering provisional stills' : 'Preview rendering cancelled'}</strong><span>{job?.progress ?? 0}%</span></div><div role="progressbar" aria-label="Focus preview progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress ?? 0}><span style={{ width: `${job?.progress ?? 0}%` }}/></div><div><span>{job?.message ?? 'Saving focus settings…'}</span>{job?.status === 'running' ? <button className="text-button" disabled={job.cancelRequested} onClick={() => void cancel()}>Cancel</button> : null}</div></div> : null}
      <div className="extraction-actions"><button className="button secondary" disabled={!ready || number === 1} onClick={() => setNumber(n => n - 1)}>Previous Tile</button><button className="button secondary" disabled={!ready || number === 6} onClick={() => setNumber(n => n + 1)}>Next Tile</button><button className="button primary" disabled={locked || saving} onClick={() => void generate()}><Icon name={running ? 'refresh' : 'image'}/>{running ? 'Generating Focus Previews…' : job?.status === 'failed' ? 'Retry Focus Previews' : 'Generate Focus Previews'}</button></div>
      <div className="focus-comparison">{outputFormats.map(f => { const p = freshManifest?.previews.find(p => p.format === f && p.tileNumber === number), v = config?.views.find(v => v.format === f && v.tileNumber === number); return <article key={f}><div><strong>{f === 'mobile' ? 'Mobile' : 'Desktop'} · Tile {number}</strong><span>{outputSpec[f].width} × {outputSpec[f].height} · {v?.cameraMode === 'detail' ? 'Reframed Detail' : 'Native Camera'}</span></div><div className={`focus-comparison-image ${f}`} style={{ aspectRatio: `${outputSpec[f].width}/${outputSpec[f].height}` }}>{p ? <img src={apiUrl(p.imageUrl)} alt={`${f} tile ${number} provisional focus preview`}/> : <p>{unsaved || manifest ? 'Generate updated focus previews' : 'Provisional still preview will appear here'}</p>}</div>{p ? <a className="button secondary" href={apiUrl(p.downloadUrl)} download={p.filename}><Icon name="download" size={15}/> Download provisional {f} PNG</a> : null}</article>; })}</div>
      <div className="focus-provisional-note">These provisional stills are for framing review. Final Gemini start frames will come from decoded MP4 frames in a later module.</div>
      {freshManifest ? <div className="extraction-metadata"><div><strong>All 12 provisional stills generated</strong><span>{freshManifest.outputDirectory}</span></div><a className="text-button" href={apiUrl(freshManifest.configUrl)} download="focus_config.json"><Icon name="download" size={15}/> Focus config JSON</a></div> : null}
      <div className="grid-future"><span>Next: animate the saved camera framing</span><button className="button secondary" disabled={!ready || !config?.updatedAt || unsaved || saving} onClick={() => document.getElementById('camera-animation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Continue to Camera Animation <Icon name="arrow" size={15}/></button></div>
    </section>
    <section className="test-card" aria-label="Module 4 tests"><div className="test-card-heading"><div><span className="eyebrow">FRAMING AND PERSISTENCE CHECKS</span><h2><Icon name="flask" size={21}/> Module 4 test bench</h2><p>Eighteen service scenarios, including earlier module regression checks.</p></div><div className="test-actions">{report ? <span className={`test-total ${report.passed !== report.total ? 'failed' : ''}`}>{report.passed}/{report.total} PASS</span> : null}<button className="button secondary" disabled={checking || running || externalBusy} onClick={() => void runChecks()}>{checking ? 'Running checks…' : 'Run Module 4 checks'}</button></div></div>{checkError ? <div className="message error" role="alert">{checkError}</div> : null}<div className="test-grid">{(report?.results ?? focusCheckNames.map(name => ({ name, status: null, detail: '' }))).map((r, i) => <div className="test-result" key={r.name}><span className="test-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{r.name}</strong>{r.detail ? <p>{r.detail}</p> : null}</div><span className={`test-status ${r.status?.toLowerCase() ?? 'pending'}`}>{r.status ?? 'NOT RUN'}</span></div>)}</div></section>
  </>;
}
