import { apiUrl } from '../urls';
import { useEffect, useRef, useState } from 'react';
import { jsonOptions, request, type CheckReport } from '../api';
import type { Project } from '../../shared/project';
import type { ExtractionManifest } from '../../shared/extraction';
import { canonicalSettings, defaultGridSettings, layoutCheckNames, outputFormats, outputSpec, resolveGeometry, validateGridSettings, type FormatSettings, type GridJob, type GridSettings, type GridState, type LayoutManifest, type OutputFormat } from '../../shared/layout';
import Icon from './Icon';

export default function GridStep({ project, source, dirty, externalBusy, onRunningChange, onManifestChange }: {
  project: Project | null; source: ExtractionManifest | null; dirty: boolean; externalBusy: boolean;
  onRunningChange: (running: boolean) => void;
  onManifestChange: (manifest: LayoutManifest | null) => void;
}) {
  const [settings, setSettings] = useState(defaultGridSettings);
  const [format, setFormat] = useState<OutputFormat>('mobile');
  const [selectedTile, setSelectedTile] = useState(1);
  const [manifest, setManifest] = useState<LayoutManifest | null>(null);
  const [job, setJob] = useState<GridJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checkError, setCheckError] = useState('');
  const startLock = useRef(false);
  const running = starting || job?.status === 'running';
  const ready = !!project && !!source && source.projectId === project.id && !dirty;
  const locked = !ready || externalBusy || running || loading || saving;
  const s = settings[format], position = s.positions[selectedTile - 1];
  const settingsErrors = validateGridSettings(settings);
  const currentManifest = ready && manifest?.extractionId === source.extractionId && JSON.stringify(canonicalSettings(settings)) === JSON.stringify(manifest.settings) ? manifest : null;
  useEffect(() => { onManifestChange(currentManifest); }, [currentManifest, onManifestChange]);
  const fillFormats = outputFormats.filter(f => settings[f].mode === 'FILL' && source?.tiles.some(t => {
    const g = resolveGeometry(f, settings[f]);
    return Math.abs(t.width / t.height - g.cellWidth / g.cellHeight) > 1e-6;
  }));

  useEffect(() => { onRunningChange(running || saving); return () => onRunningChange(false); }, [running, saving, onRunningChange]);
  useEffect(() => {
    const controller = new AbortController();
    setManifest(null); setJob(null); setError(''); setNotice(''); setSettingsDirty(false);
    setSettings(defaultGridSettings());
    if (!project || dirty || !source || source.projectId !== project.id) { setLoading(false); return; }
    setLoading(true);
    request<GridState>(`/api/projects/${project.id}/layouts`, { signal: controller.signal })
      .then(state => {
        if (controller.signal.aborted) return;
        setSettings(state.settings); setManifest(state.manifest); setJob(state.job);
        if (state.job?.status === 'failed') setError(state.job.error ?? state.job.message);
      }).catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Saved layouts could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project?.id, source?.extractionId, dirty]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const controller = new AbortController(), { projectId, id } = job;
    async function poll() {
      try {
        while (!controller.signal.aborted) {
          const next = await request<GridJob>(`/api/projects/${projectId}/layouts/${id}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setJob(next);
          if (next.status === 'complete') { setManifest(next.manifest!); setError(''); setNotice('Both exported PNGs are ready. These previews display the saved files.'); return; }
          if (next.status === 'failed') { setError(next.error ?? next.message); return; }
          if (next.status === 'cancelled') return;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch (problem) {
        if (!controller.signal.aborted) { setJob(previous => previous ? { ...previous, status: 'failed' } : null); setError(`${problem instanceof Error ? problem.message : 'Connection lost.'} Reopen the saved project to reconnect to generation.`); }
      }
    }
    void poll(); return () => controller.abort();
  }, [job?.id, job?.status]);

  function update<K extends keyof Omit<FormatSettings, 'positions'>>(key: K, value: FormatSettings[K]) {
    setSettings(previous => ({ ...previous, [format]: { ...previous[format], [key]: value }, ...(previous.linked ? { [format === 'mobile' ? 'desktop' : 'mobile']: { ...previous[format === 'mobile' ? 'desktop' : 'mobile'], [key]: value } } : {}) }));
    setSettingsDirty(true); setNotice('');
  }
  function link(value: boolean) {
    setSettings(previous => {
      const other = format === 'mobile' ? 'desktop' : 'mobile';
      return { ...previous, linked: value, ...(value ? { [other]: { ...previous[format], positions: previous[other].positions } } : {}) };
    });
    setSettingsDirty(true); setNotice('');
  }
  function pan(axis: 'x' | 'y', value: number) {
    setSettings(previous => ({ ...previous, [format]: { ...previous[format], positions: previous[format].positions.map(p => p.number === selectedTile ? { ...p, [axis]: value } : p) } }));
    setSettingsDirty(true); setNotice('');
  }
  async function save() {
    if (!project || locked || settingsErrors.length) return;
    setSaving(true); setError('');
    try { setSettings(await request<GridSettings>(`/api/projects/${project.id}/layout-settings`, jsonOptions('PUT', settings))); setSettingsDirty(false); setNotice('Grid settings saved locally. Generate to update the previews.'); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  }
  async function begin() {
    if (!project || !source || locked || startLock.current || settingsErrors.length) return;
    startLock.current = true; setStarting(true); setError(''); setNotice('');
    try { setJob(await request<GridJob>(`/api/projects/${project.id}/layouts`, jsonOptions('POST', { settings, expectedExtractionId: source.extractionId }))); setSettingsDirty(false); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Grid generation could not start.'); }
    finally { setStarting(false); startLock.current = false; }
  }
  async function cancel() {
    if (!project || !job || job.status !== 'running') return;
    try { setJob(await request<GridJob>(`/api/projects/${project.id}/layouts/${job.id}/cancel`, { method: 'POST' })); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Cancellation failed.'); }
  }
  async function runChecks() {
    if (checking) return;
    setChecking(true); setCheckError('');
    try { setReport(await request<CheckReport>('/api/checks/module3', { method: 'POST' })); }
    catch (problem) { setCheckError(problem instanceof Error ? problem.message : 'Module 3 checks could not run.'); }
    finally { setChecking(false); }
  }
  return <>
    <section id="create-six-tile-grids" className="extraction-card grid-card" aria-label="Step 3 grid reconstruction">
      <div className="extraction-heading"><div><div className="eyebrow">ONE STORY. TWO INDEPENDENT FORMATS.</div><h2><span className="extraction-step-number">03</span> Step 3 — Create Mobile &amp; Desktop Grids</h2><p>Rebuild your six extracted tiles for each screen. Keep the artwork in proportion.</p></div><span className="native-badge">PNG OUTPUT</span></div>
      {!ready ? <div className="approval-banner"><Icon name="info"/><div><strong>Complete and save your six-tile extraction in Step 2.</strong><p>Both grids use the extracted PNG tiles in reading order.</p></div></div> : <div className="grid-source-strip" aria-label="Six source tiles">{source.tiles.map(tile => <button key={tile.number} className={`grid-source-tile ${selectedTile === tile.number ? 'selected' : ''}`} aria-label={`Position tile ${tile.number}`} aria-pressed={selectedTile === tile.number} onClick={() => setSelectedTile(tile.number)} disabled={locked}><img src={apiUrl(tile.imageUrl)} alt={`Extracted source tile ${tile.number}`}/><span>{String(tile.number).padStart(2, '0')}</span></button>)}</div>}
      <div className="grid-controls"><div className="grid-control-heading"><label className="grid-link"><input type="checkbox" checked={settings.linked} onChange={e => link(e.target.checked)} disabled={locked}/> Common settings for both formats</label><div className="segmented grid-format-tabs">{outputFormats.map(f => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f === 'mobile' ? 'Mobile' : 'Desktop'}</button>)}</div></div>
        <div className="grid-fields"><label><span>Artwork fitting</span><select aria-label="Artwork fitting" value={s.mode} disabled={locked} onChange={e => update('mode', e.target.value as 'FIT' | 'FILL')}><option value="FIT">FIT · Whole scene</option><option value="FILL">FILL · Crop to cell</option></select></label>
          <label><span>Outer margin · px</span><input aria-label="Outer margin" type="number" min="0" max="200" step="1" value={s.outerMargin} disabled={locked} onChange={e => { if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) update('outerMargin', Math.min(200, Math.max(0, Math.round(Number(e.target.value))))); }}/></label>
          <label><span>Internal gutter · px</span><input aria-label="Internal gutter" type="number" min="0" max="120" step="1" value={s.internalGutter} disabled={locked} onChange={e => { if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) update('internalGutter', Math.min(120, Math.max(0, Math.round(Number(e.target.value))))); }}/></label>
          <label><span>Gutter colour</span><input type="color" aria-label="Gutter colour" value={s.gutterColor} disabled={locked} onChange={e => update('gutterColor', e.target.value)}/></label><label><span>Panel padding colour</span><input type="color" aria-label="Panel padding colour" value={s.paddingColor} disabled={locked} onChange={e => update('paddingColor', e.target.value)}/></label>
        </div>
        <div className="grid-geometry-notes">{outputFormats.map(f => { const g = resolveGeometry(f, settings[f]); return <div key={f}><strong>{f === 'mobile' ? 'Mobile' : 'Desktop'} · {g.cellWidth} × {g.cellHeight} px cells</strong><span>Applied gutter: {g.internalGutter} px{g.internalGutter !== g.requestedGutter ? ` (requested ${g.requestedGutter} px; adjusted for six equal cells)` : ''} · Outer margin: {g.outerMargin} px</span></div>; })}</div>
        {fillFormats.length ? <div className="grid-fill-warning" role="status"><Icon name="info" size={17}/><span>FILL removes original artwork in {fillFormats.join(' and ')}. Select a tile above and adjust its position for the selected format; generate again to inspect the exported crop.</span></div> : <p className="grid-fit-note">FIT preserves the full scene with padding where needed. Artwork is uniformly scaled.</p>}
        {s.mode === 'FILL' ? <div className="grid-pan-controls"><strong>{format === 'mobile' ? 'Mobile' : 'Desktop'} · Tile {selectedTile} crop position</strong>{(['x', 'y'] as const).map(axis => <label key={axis}><span>{axis === 'x' ? 'Horizontal' : 'Vertical'}</span><input type="range" aria-label={`Tile ${selectedTile} ${axis} position`} min="0" max="1" step="0.01" value={position[axis]} disabled={locked} onChange={e => pan(axis, Number(e.target.value))}/><output>{Math.round(position[axis] * 100)}%</output></label>)}<button className="text-button" disabled={locked} onClick={() => { pan('x', 0.5); pan('y', 0.5); }}>Centre tile</button></div> : null}
      </div>
      {error ? <div className="message error" role="alert"><Icon name="info"/>{error}</div> : null}
      {notice ? <div className="message success" role="status"><Icon name="check"/>{notice}</div> : null}
      {running || job?.status === 'cancelled' ? <div className="extraction-progress"><div><strong>{running ? 'Generating both grids' : 'Generation cancelled'}</strong><span>{job?.progress ?? 0}%</span></div><div role="progressbar" aria-label="Grid generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress ?? 0}><span style={{ width: `${job?.progress ?? 0}%` }}/></div><div><span>{job?.message ?? 'Preparing grids…'}</span>{running ? <button className="text-button" disabled={!job || job.cancelRequested} onClick={() => void cancel()}>{job?.cancelRequested ? 'Cancelling…' : 'Cancel'}</button> : null}</div></div> : null}
      <div className="extraction-actions"><button className="button primary" disabled={locked || settingsErrors.length > 0} onClick={() => void begin()}><Icon name={running ? 'refresh' : 'grid'}/>{loading ? 'Loading layouts…' : running ? 'Generating Grids…' : job?.status === 'failed' ? 'Retry generation' : manifest ? 'Regenerate' : 'Generate Grids'}</button><button className="button secondary" disabled={locked || !settingsDirty || settingsErrors.length > 0} onClick={() => void save()}><Icon name="save"/>{saving ? 'Saving…' : 'Save grid settings'}</button><span className="grid-settings-status">{settingsDirty ? 'Settings changed · Generate to refresh previews' : 'Settings are saved when you generate'}</span></div>
      <div className="grid-previews">{outputFormats.map(f => { const spec = outputSpec[f], output = currentManifest?.outputs[f]; return <article className={`grid-preview ${f}`} key={f}><div className="grid-preview-heading"><strong>{f === 'mobile' ? 'Mobile' : 'Desktop'} grid</strong><span>{spec.aspect} · {spec.width} × {spec.height} px · {spec.columns} × {spec.rows}</span></div><div className="grid-preview-stage"><div style={{ aspectRatio: `${spec.width} / ${spec.height}` }} className="grid-preview-frame">{output ? <img src={apiUrl(output.imageUrl)} alt={`${f} six-tile grid, ${spec.width} by ${spec.height} pixels`} width={spec.width} height={spec.height}/> : <div className="grid-preview-placeholder"><Icon name="grid" size={30}/><strong>{manifest ? 'Regenerate to preview these settings' : 'Your six-tile grid will appear here'}</strong><span>{spec.width} × {spec.height}</span></div>}</div></div><div className="grid-preview-footer"><span>{output ? `${output.settings.mode} · ${output.geometry.cellWidth} × ${output.geometry.cellHeight} px equal cells` : 'Preview displays the actual exported PNG'}</span>{output && !running ? <a className="button secondary" href={apiUrl(output.downloadUrl)} download={output.filename}><Icon name="download" size={15}/> Download {f === 'mobile' ? 'Mobile' : 'Desktop'} PNG</a> : <button className="button secondary" disabled><Icon name="download" size={15}/> Download {f === 'mobile' ? 'Mobile' : 'Desktop'} PNG</button>}</div>{output?.placements.some(p => p.transform.artworkRemoved) ? <p className="grid-crop-report">Artwork cropped: {output.placements.filter(p => p.transform.artworkRemoved).map(p => `tile ${p.number} (${p.transform.removedAreaPercent.toFixed(1)}%)`).join(', ')}.</p> : null}</article>; })}</div>
      {currentManifest ? <div className="extraction-metadata"><div><strong>Layout coordinates and settings saved</strong><span>{currentManifest.outputDirectory}/metadata/layout_manifest.json</span></div><a className="text-button" href={apiUrl(currentManifest.manifestUrl)} download="layout_manifest.json"><Icon name="download" size={14}/> Layout manifest JSON</a></div> : null}
      <div className="grid-future"><span>Next: focus and camera framing · Module 4</span><button className="button secondary" disabled={!currentManifest || running} onClick={() => document.getElementById('camera-focus')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Continue to Module 4 <Icon name="arrow" size={15}/></button></div>
    </section>
    <section className="test-card" aria-label="Module 3 tests"><div className="test-card-heading"><div><span className="eyebrow">RUN WHEN YOU ARE READY</span><h2><Icon name="flask" size={21}/> Module 3 test bench</h2><p>Fifteen reconstruction scenarios. Tests run only when requested.</p></div><div className="test-actions">{report ? <span className={`test-total ${report.passed !== report.total ? 'failed' : ''}`}>{report.passed}/{report.total} PASS</span> : null}<button className="button secondary" disabled={checking || running || externalBusy} onClick={() => void runChecks()}><Icon name={checking ? 'refresh' : 'check'}/>{checking ? 'Running checks…' : 'Run Module 3 checks'}</button></div></div>{checkError ? <div className="message error" role="alert">{checkError}</div> : null}<div className="test-grid">{(report?.results ?? layoutCheckNames.map(name => ({ name, status: null, detail: '' }))).map((result, i) => <div className="test-result" key={result.name}><span className="test-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{result.name}</strong>{result.detail ? <p>{result.detail}</p> : null}</div><span className={`test-status ${result.status?.toLowerCase() ?? 'pending'}`}>{result.status ?? 'NOT RUN'}</span></div>)}</div><div className="test-footer"><Icon name="info" size={14}/><span>Checks use a temporary workspace and leave your saved projects untouched.</span></div></section>
  </>;
}
