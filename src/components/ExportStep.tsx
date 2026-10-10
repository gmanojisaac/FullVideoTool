import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/project';
import type { FrameValidationReport } from '../../shared/frames';
import type { ExportJob, ExportScope, ExportSettings, ExportState } from '../../shared/export';
import { jsonOptions, request } from '../api';

interface Props { project: Project | null; frames: FrameValidationReport | null; externalBusy: boolean; onRunningChange: (running: boolean) => void }
export default function ExportStep({ project, frames, externalBusy, onRunningChange }: Props) {
  const [state, setState] = useState<ExportState | null>(null), [settings, setSettings] = useState<ExportSettings>({ version: 1, projectName: '', lessonTitle: '' }), [error, setError] = useState(''), [starting, setStarting] = useState(false), [instructions, setInstructions] = useState<{ clipchamp: string; gemini: string } | null>(null);
  const callback = useRef(onRunningChange); callback.current = onRunningChange;
  const [checks, setChecks] = useState<{ passed: number; total: number; timestamp: string; results: { name: string; status: string; detail: string }[] } | null>(null);
  useEffect(() => { const c = new AbortController(); void request<typeof checks>('/api/checks/module7/latest', { signal: c.signal }).then(setChecks).catch(() => {}); return () => c.abort(); }, []);
  const id = project?.id, running = starting || state?.job?.status === 'running', ready = !!frames && frames.frames.length === 12 && !frames.failures.length && frames.frames.every(f => f.readyForGemini && f.exactDecodedPixelMatch === 'PASS' && f.zoomOutGeometryMatch === 'PASS');
  useEffect(() => { callback.current(!!running); return () => callback.current(false); }, [running]);
  useEffect(() => {
    const controller = new AbortController(); setState(null); setError(''); setInstructions(null);
    if (id) request<ExportState>(`/api/projects/${id}/exports`, { signal: controller.signal }).then(s => { setState(s); setSettings({ ...s.settings, projectName: s.settings.projectName || project?.title || '' }); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, frames?.updatedAt, project?.updatedAt, project?.title]);
  useEffect(() => {
    if (!id || state?.job?.status !== 'running') return; const controller = new AbortController();
    const timer = setInterval(() => { void request<ExportJob>(`/api/projects/${id}/exports/${state.job!.id}`, { signal: controller.signal }).then(job => { setState(s => s ? { ...s, job, receipt: job.receipt || s.receipt, current: job.status === 'complete' } : s); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); }, 650);
    return () => { clearInterval(timer); controller.abort(); };
  }, [id, state?.job?.id, state?.job?.status]);
  async function save() { if (!id) return; try { const saved = await request<ExportSettings>(`/api/projects/${id}/export-settings`, jsonOptions('PUT', settings)); setSettings(saved); setState(s => s ? { ...s, current: false } : s); setError(''); } catch (e) { setError((e as Error).message); } }
  async function start(scope: ExportScope) {
    if (!id || running || externalBusy) return; setStarting(true); setError('');
    try { await request(`/api/projects/${id}/export-settings`, jsonOptions('PUT', settings)); const job = await request<ExportJob>(`/api/projects/${id}/exports`, jsonOptions('POST', { scope })); setState(s => ({ settings, receipt: s?.receipt || null, current: false, job })); }
    catch (e) { setError((e as Error).message); } finally { setStarting(false); }
  }
  async function cancel() { if (!id || !state?.job) return; try { const job = await request<ExportJob>(`/api/projects/${id}/exports/${state.job.id}/cancel`, { method: 'POST' }); setState(s => s ? { ...s, job } : s); } catch (e) { setError((e as Error).message); } }
  async function showInstructions() { if (!id) return; try { setInstructions(await request(`/api/projects/${id}/export-instructions`)); } catch (e) { setError((e as Error).message); } }
  return <section className="stage-card" id="export-package" aria-label="Export for Clipchamp">
    <div className="stage-heading"><div><span className="eyebrow">LOCAL DELIVERY</span><h2>Step 7 — Export for Clipchamp</h2><p>Validate current assets and package separate mobile, desktop or combined lessons.</p></div><span className="small-tag">{running ? 'PROCESSING' : state?.current ? 'ZIP VERIFIED' : ready ? 'VALIDATION REQUIRED' : 'AWAITING FRAMES'}</span></div>
    <div className="export-fields"><label>Export project name<input aria-label="Export project name" maxLength={200} value={settings.projectName} disabled={running || externalBusy} onChange={e => { setSettings({ ...settings, projectName: e.target.value }); setState(s => s ? { ...s, current: false } : s); }}/></label><label>Lesson title<input aria-label="Lesson title" maxLength={200} value={settings.lessonTitle} disabled={running || externalBusy} onChange={e => { setSettings({ ...settings, lessonTitle: e.target.value }); setState(s => s ? { ...s, current: false } : s); }}/></label><button className="button secondary" disabled={!id || running || externalBusy} onClick={() => void save()}>Save export details</button></div>
    <div className="export-summaries">{(['mobile', 'desktop'] as const).map(format => <div className="settings-card" key={format}><h3>{format === 'mobile' ? 'Mobile · 9:16' : 'Desktop · 16:9'}</h3><p>{format === 'mobile' ? '1080 × 1920' : '1920 × 1080'} · H.264 · 30 fps · silent</p><p>1 grid · 12 transitions · 1 preview · {frames?.frames.filter(f => f.format === format && f.readyForGemini).length || 0}/6 verified PNGs</p></div>)}</div>
    <p>Readiness is confirmed by a fresh file check at export. Saved reports alone do not establish that files are present or valid.</p>
    {!ready ? <p className="quiet-note">Render all camera videos and verify twelve first-frame PNGs to enable packaging.</p> : null}
    {error || state?.job?.error ? <div className="message error" role="alert"><pre>{error || state?.job?.error}</pre></div> : null}
    {state?.job ? <div role="status"><p>{state.job.message}</p><progress value={state.job.progress} max={100}/><span> {state.job.progress}%</span></div> : null}
    <div className="stage-actions"><button className="button secondary" onClick={() => document.getElementById('gemini-first-frames')?.scrollIntoView()}>Previous</button>{(['mobile', 'desktop', 'complete'] as const).map(scope => <button className="button primary" key={scope} disabled={!ready || running || externalBusy} onClick={() => void start(scope)}>{scope === 'complete' ? 'Export Complete Package' : `Export Selected ${scope === 'mobile' ? 'Mobile' : 'Desktop'} Assets`}</button>)}{running ? <button className="button secondary" disabled={starting || state?.job?.status !== 'running'} onClick={() => void cancel()}>Cancel export</button> : null}</div>
    {state?.receipt ? <div className="stage-actions"><a className="button primary" href={state.receipt.downloadUrl}>Download ZIP{state.current ? '' : ' (previous run)'}</a><a className="button secondary" href={state.receipt.manifestUrl}>View Export Manifest</a><a className="button secondary" href={state.receipt.receiptUrl}>Download verification receipt</a></div> : null}
    <button className="text-button" disabled={!ready} onClick={() => void showInstructions()}>View Clipchamp Instructions / View Gemini Instructions</button>
    {instructions ? <div className="export-summaries"><details open><summary>Clipchamp Instructions</summary><pre className="instruction-text">{instructions.clipchamp}</pre></details><details open><summary>Gemini Instructions</summary><pre className="instruction-text">{instructions.gemini}</pre></details></div> : null}
    {state?.job?.validation ? <details><summary>Current validation: {state.job.validation.status}</summary>{state.job.validation.results.map(r => <p key={r.filename}><strong>{r.status}</strong> {r.filename} — {r.reason}</p>)}</details> : null}
    <details aria-label="Module 7 test results"><summary>Module 7 tests — {checks ? `${checks.passed}/${checks.total} PASS` : 'NOT RUN'}</summary>{checks ? <><p>Executed {new Date(checks.timestamp).toLocaleString()}</p>{checks.results.map(r => <p key={r.name}><strong>{r.status}</strong> {r.name}: {r.detail}</p>)}</> : <p>Run npm run test:module7 to record actual outcomes.</p>}</details>
  </section>;
}
