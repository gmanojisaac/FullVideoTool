import { apiUrl } from '../urls';
import { useEffect, useState } from 'react';
import { jsonOptions, request, type CheckReport } from '../api';
import type { FocusConfig } from '../../shared/focus';
import type { OutputFormat } from '../../shared/layout';
import { animationCheckNames, defaultAnimationSettings, frameCount, timingFor, validateAnimationSettings, type AnimationJob, type AnimationManifest, type AnimationSettings, type AnimationState, type TileTiming, type VideoTools } from '../../shared/animation';
import Icon from './Icon';

export default function AnimationStep({ config, externalBusy, onRunningChange, onManifestChange }: {
  config: FocusConfig | null; externalBusy: boolean; onRunningChange: (value: boolean) => void; onManifestChange: (manifest: AnimationManifest | null) => void;
}) {
  const [format, setFormat] = useState<OutputFormat>('mobile'), [number, setNumber] = useState(1);
  const [settings, setSettings] = useState(defaultAnimationSettings), [tools, setTools] = useState<VideoTools | null>(null);
  const [manifest, setManifest] = useState<AnimationManifest | null>(null), [job, setJob] = useState<AnimationJob | null>(null);
  const [completedAll, setCompletedAll] = useState<AnimationManifest | null>(null);
  const [loading, setLoading] = useState(false), [starting, setStarting] = useState(false), [saving, setSaving] = useState(false), [unsaved, setUnsaved] = useState(false);
  const [error, setError] = useState(''), [report, setReport] = useState<CheckReport | null>(null), [checking, setChecking] = useState(false), [checkError, setCheckError] = useState('');
  const ready = !!config?.updatedAt, running = starting || job?.status === 'running';
  const locked = !ready || loading || running || saving || externalBusy;
  const errors = validateAnimationSettings(settings), timing = timingFor(settings, number), view = config?.views.find(v => v.format === format && v.tileNumber === number);
  const fresh = manifest && config && manifest.focusConfig.revision === config.revision && manifest.layoutGenerationId === config.layoutGenerationId && JSON.stringify(manifest.settings) === JSON.stringify(settings) && !unsaved ? manifest : null;
  const preview = fresh?.videos.find(v => v.format === format && (v.kind === 'lesson' || (v.kind === 'cycle' && v.tileNumber === number)));
  const clips = fresh?.videos.filter(v => v.format === format && v.tileNumber === number && ['in', 'out'].includes(v.kind)) ?? [];
  const complete = fresh?.request.scope === 'all' ? fresh : completedAll && config && completedAll.focusConfig.revision === config.revision && completedAll.layoutGenerationId === config.layoutGenerationId && JSON.stringify(completedAll.settings) === JSON.stringify(settings) && !unsaved ? completedAll : null;
  useEffect(() => { onManifestChange(!running ? complete : null); }, [complete, running, onManifestChange]);
  useEffect(() => { onRunningChange(running || saving); return () => onRunningChange(false); }, [running, saving, onRunningChange]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(ready); setError(''); setManifest(null); setCompletedAll(null); setJob(null); setUnsaved(false);
    const url = ready && config ? `/api/projects/${config.projectId}/animations` : '/api/video-tools';
    request<AnimationState | VideoTools>(url, { signal: controller.signal }).then(state => {
      if (controller.signal.aborted) return;
      if ('settings' in state) { setSettings(state.settings); setTools(state.tools); setManifest(state.manifest); setCompletedAll(state.fullManifest || null); setJob(state.job); if (state.job?.status === 'failed') setError(state.job.error ?? state.job.message); }
      else setTools(state);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [config?.projectId, config?.layoutGenerationId, config?.revision, ready]);
  useEffect(() => {
    const controller = new AbortController();
    request<CheckReport | null>('/api/checks/module5/latest', { signal: controller.signal }).then(setReport).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!unsaved || !config || locked || errors.length) return;
    const controller = new AbortController(), captured = config.projectId;
    const timer = setTimeout(() => {
      setSaving(true);
      request<AnimationSettings>(`/api/projects/${captured}/animation-settings`, { ...jsonOptions('PUT', settings), signal: controller.signal }).then(() => { if (!controller.signal.aborted) { setUnsaved(false); setError(''); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { setSaving(false); });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
    // Saving is intentionally excluded: setting saving=true must not abort its own request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved, settings, config?.projectId, loading, running, externalBusy, errors.length]);
  useEffect(() => {
    if (!job || job.status !== 'running' || !config) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await request<AnimationJob>(`/api/projects/${config!.projectId}/animations/${job!.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return; setJob(current);
        if (current.status === 'complete') { setManifest(current.manifest ?? null); if (current.manifest?.request.scope === 'all') setCompletedAll(current.manifest); }
        else if (current.status === 'failed') setError(current.error ?? current.message);
        else if (current.status === 'running') timer = setTimeout(poll, 700);
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Progress unavailable. Reopen the project to reconnect.'); timer = setTimeout(poll, 1500); } }
    }
    timer = setTimeout(poll, 400); return () => { clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.status, config?.projectId]);
  function change(next: AnimationSettings) { setSettings(next); setUnsaved(true); setError(''); }
  function duration(key: keyof TileTiming, value: number) {
    change(settings.timingMode === 'global' ? { ...settings, global: { ...settings.global, [key]: value } } : { ...settings, tiles: settings.tiles.map(t => t.tileNumber === number ? { ...t, [key]: value } : t) });
  }
  async function render(scope: 'all' | 'format' | 'selected' | 'preview') {
    if (!config || locked || errors.length) return; setStarting(true); setError('');
    try { const next = await request<AnimationJob>(`/api/projects/${config.projectId}/animations`, jsonOptions('POST', { settings, request: { scope, format, tileNumber: number }, expectedFocusRevision: config.revision })); setUnsaved(false); setJob(next); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start rendering.'); }
    finally { setStarting(false); }
  }
  async function cancel() { if (!config || !job) return; try { setJob(await request<AnimationJob>(`/api/projects/${config.projectId}/animations/${job.id}/cancel`, { method: 'POST' })); } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel.'); } }
  async function runChecks() { setChecking(true); setCheckError(''); try { setReport(await request<CheckReport>('/api/checks/module5', { method: 'POST' })); } catch (e) { setCheckError(e instanceof Error ? e.message : 'Checks failed.'); } finally { setChecking(false); } }
  return <>
    <section id="camera-animation" className="extraction-card animation-card" aria-label="Camera animation">
      <div className="extraction-heading"><div><div className="eyebrow">GIVE EVERY MOMENT ROOM TO BREATHE.</div><h2><span className="extraction-step-number">05</span> Step 5 — Camera Animation</h2><p>Full grid to saved focus, a temporary hold, and a smooth return. Silent MP4s for both formats.</p></div><span className="native-badge">30 FPS · H.264</span></div>
      {!ready ? <div className="message"><Icon name="info" size={16}/> Save Step 4 framing or generate its previews to enable camera rendering.</div> : null}
      {tools && !tools.available ? <div className="message error" role="alert">FFmpeg / FFprobe missing. {tools.instructions}</div> : null}
      {error ? <div className="message error" role="alert">{error}</div> : null}
      <div className="animation-controls">
        <div className="animation-selection"><label>Output format<select aria-label="Animation format" value={format} disabled={running} onChange={e => setFormat(e.target.value as OutputFormat)}><option value="mobile">Mobile · 1080 × 1920</option><option value="desktop">Desktop · 1920 × 1080</option></select></label><label>Tile<select aria-label="Animation tile" value={number} disabled={running} onChange={e => setNumber(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => <option value={i + 1} key={i}>Tile {i + 1}</option>)}</select></label><div className="animation-mode"><span>Saved camera mode</span><strong>{view?.cameraMode === 'detail' ? 'Reframed Detail' : 'Native Camera'}</strong><small>{view?.approved ? 'Approved framing' : ready ? 'Saved framing · review before final use' : 'Awaiting saved framing'}</small></div></div>
        {view?.cameraMode === 'detail' ? <p className="animation-detail-notice" role="status">Reframed Detail uses a native grid zoom followed by a controlled dissolve to the saved tile crop. Zoom out reverses this handoff.</p> : <p className="animation-detail-notice">Native Camera uses continuous scale and translation over this format’s reconstructed grid.</p>}
        <div className="animation-timing-heading"><label>Timing mode<select aria-label="Animation timing mode" disabled={locked} value={settings.timingMode} onChange={e => change({ ...settings, timingMode: e.target.value as 'global' | 'individual', ...(e.target.value === 'individual' && settings.timingMode === 'global' ? { tiles: settings.tiles.map(t => ({ tileNumber: t.tileNumber, ...settings.global })) } : {}) })}><option value="global">Global · all six tiles</option><option value="individual">Individual · edit selected tile</option></select></label><label>Easing<select aria-label="Animation easing" value="smoothstep-log" disabled={locked}><option value="smoothstep-log">Cubic smoothstep · logarithmic zoom</option></select></label></div>
        <div className="animation-durations">
          {([['zoomIn', 'Zoom-in duration'], ['focusedHold', 'Focused hold duration'], ['zoomOut', 'Zoom-out duration'], ['detailHandoff', 'Detail dissolve duration']] as const).map(([key, label]) => <label key={key}>{label}<div><input type="number" aria-label={label} value={timing[key]} min={key === 'focusedHold' ? 0 : 2 / 30} max={key === 'detailHandoff' ? 2 : key === 'focusedHold' ? 15 : 10} step="0.1" disabled={locked} onChange={e => duration(key, Number(e.target.value))}/><span>s</span></div><small>{frameCount(timing[key])} frames{key === 'detailHandoff' ? ' · Detail mode only' : ''}</small></label>)}
          {([['initialGridHold', 'Initial grid hold'], ['intermediateGridHold', 'Intermediate grid hold'], ['finalGridHold', 'Final grid hold']] as const).map(([key, label]) => <label key={key}>{label}<div><input type="number" aria-label={label} value={settings[key]} min="0" max="15" step="0.1" disabled={locked} onChange={e => change({ ...settings, [key]: Number(e.target.value) })}/><span>s</span></div><small>{frameCount(settings[key])} frames · previews</small></label>)}
        </div>
        {errors.length ? <p className="message error" role="alert">{errors.join(' ')}</p> : null}
        <div className="animation-timeline" aria-label="Animation timeline"><span>Grid <small>{settings.initialGridHold}s</small></span><i>→</i><span>Zoom In <small>{timing.zoomIn}s</small></span><i>→</i><span>Hold <small>{timing.focusedHold}s</small></span><i>→</i><span>Zoom Out <small>{timing.zoomOut}s</small></span><i>→</i><span>Grid <small>{settings.finalGridHold}s</small></span></div>
        <p className="animation-help">The focused hold is a placeholder for later editing. Detail dissolves add time when enabled. Durations round to whole frames at 30 fps; grid holds are included in previews.</p>
        <div className="animation-actions"><button className="button secondary" disabled={locked || errors.length > 0 || !tools?.available} onClick={() => void render('preview')}>Preview</button><button className="button secondary" disabled={locked || errors.length > 0 || !tools?.available} onClick={() => void render('selected')}>Render Selected Tile</button><button className="button secondary" disabled={locked || errors.length > 0 || !tools?.available} onClick={() => void render('format')}>Render All {format === 'mobile' ? 'Mobile' : 'Desktop'} Tiles</button><button className="button primary" disabled={locked || errors.length > 0 || !tools?.available} onClick={() => void render('all')}>Render All Tiles</button><button className="button secondary" disabled={starting || job?.status !== 'running' || !!job.cancelRequested} onClick={() => void cancel()}>Cancel Render</button>{job?.status === 'failed' ? <button className="button secondary" disabled={locked} onClick={() => void render('all')}>Retry failed render</button> : null}<span role="status">{loading ? 'Loading saved animation…' : saving ? 'Saving timing…' : unsaved ? 'Timing changes awaiting save' : ready ? 'Timing saved locally' : 'Complete framing first'}</span></div>
      </div>
      {job && !starting ? <div className="animation-progress" role="status"><div><strong>{job.status === 'complete' ? 'Render complete' : job.status === 'cancelled' ? 'Render cancelled' : job.status === 'failed' ? 'Render failed' : `Rendering · ${job.progress}%`}</strong><span>{job.message}</span></div><progress aria-label="Animation render progress" max="100" value={job.progress}/>{job.framesTotal ? <small>{job.framesDone} / {job.framesTotal} preview frames · clips share the same frames</small> : null}</div> : null}
      {preview ? <div className={`animation-playback ${format}`}><div><span className="eyebrow">ACTUAL RENDERED MP4</span><h3>{preview.kind === 'lesson' ? 'Six-tile lesson preview' : `Tile ${number} camera preview`}</h3><p>{preview.probe.width} × {preview.probe.height} · {preview.frameCount} frames · {preview.duration.toFixed(2)}s · no audio</p><a className="button secondary" href={apiUrl(preview.downloadUrl)} download={preview.filename}><Icon name="download" size={15}/> Download preview</a></div><video key={preview.playbackUrl} src={apiUrl(preview.playbackUrl)} controls playsInline preload="metadata" aria-label="Rendered camera preview"/></div> : null}
      {clips.length ? <div className="animation-clip-downloads">{clips.map(clip => <div key={clip.filename}><strong>{clip.kind === 'in' ? 'Zoom in + focused placeholder hold' : 'Return to full grid'}</strong><span>{clip.frameCount} frames · {clip.duration.toFixed(2)}s · {clip.cameraMode === 'detail' ? 'Reframed Detail' : 'Native Camera'}</span><a className="text-button" href={apiUrl(clip.downloadUrl)} download={clip.filename}><Icon name="download" size={15}/> {clip.filename}</a><video src={apiUrl(clip.playbackUrl)} controls playsInline preload="none" aria-label={clip.kind === 'in' ? 'Rendered zoom in' : 'Rendered zoom out'}/></div>)}</div> : null}
      {fresh ? <details className="animation-files"><summary>{fresh.videos.length} rendered files · Download MP4s and manifest</summary><div>{fresh.videos.map(v => <a key={v.filename} href={apiUrl(v.downloadUrl)} download={v.filename}>{v.filename}</a>)}<a href={apiUrl(fresh.manifestUrl)} download="camera_animation_manifest.json">Camera animation manifest JSON</a></div><p>{fresh.outputDirectory}</p></details> : null}
      <div className="grid-future"><span>Next: extract authoritative video frames</span><button className="button secondary" disabled={!fresh || fresh.request.scope !== 'all' || running} onClick={() => document.getElementById('gemini-first-frames')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Continue to Frame Handoff</button></div>
    </section>
    <section className="test-card" aria-label="Module 5 tests"><div className="test-card-heading"><div><span className="eyebrow">CAMERA AND VIDEO CHECKS</span><h2><Icon name="flask" size={21}/> Module 5 test bench</h2><p>Actual MP4 encoding, decoding, geometry and earlier module regression checks. Compact test timings keep checks practical.</p></div><div className="test-actions">{report ? <span className={`test-total ${report.passed !== report.total ? 'failed' : ''}`}>{report.passed}/{report.total} PASS</span> : null}<button className="button secondary" disabled={checking || running || externalBusy} onClick={() => void runChecks()}>{checking ? 'Rendering and checking…' : 'Run Module 5 checks'}</button></div></div>{checkError ? <div className="message error" role="alert">{checkError}</div> : null}{report ? <p className="animation-check-time">Actual run completed {new Date(report.completedAt).toLocaleString()}</p> : null}<div className="test-grid">{(report?.results ?? animationCheckNames.map(name => ({ name, status: null, detail: '' }))).map((r, i) => <div className="test-result" key={r.name}><span className="test-number">{String(i + 1).padStart(2, '0')}</span><div><strong>{r.name}</strong>{r.detail ? <p>{r.detail}</p> : null}</div><span className={`test-status ${r.status?.toLowerCase() ?? 'pending'}`}>{r.status ?? 'NOT RUN'}</span></div>)}</div></section>
  </>;
}
