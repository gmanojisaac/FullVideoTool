import { useEffect, useState } from 'react';
import type { Project } from '../../shared/project';
import { maxNarrationInstructions, maxNarrationText, narrationModels, narrationVoices, validateNarrationScript, type GeneratedNarration, type NarrationScript, type NarrationState } from '../../shared/narration';
import { jsonOptions, request } from '../api';

interface Props { project: Project | null; externalBusy: boolean; onGenerated: () => void; onRunningChange: (running: boolean) => void }
export default function NarrationStep({ project, externalBusy, onGenerated, onRunningChange }: Props) {
  const id = project?.id, [state, setState] = useState<NarrationState | null>(null), [script, setScript] = useState<NarrationScript | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { onRunningChange(!!busy); return () => onRunningChange(false); }, [busy]);
  useEffect(() => {
    setState(null); setScript(null); setDirty(false); setError(''); setNotice(''); if (!id) return;
    const c = new AbortController();
    request<NarrationState>(`/api/projects/${id}/narration`, { signal: c.signal }).then(s => { setState(s); setScript(s.script); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
    return () => c.abort();
  }, [id]);
  const errors = script ? validateNarrationScript(script) : [], locked = !!busy || externalBusy;
  const edit = (patch: Partial<NarrationScript>) => { setScript(s => s && { ...s, ...patch }); setDirty(true); setNotice(''); };
  const editTile = (n: number, text: string) => { setScript(s => s && { ...s, tiles: s.tiles.map(t => t.tileNumber === n ? { ...t, text } : t) }); setDirty(true); setNotice(''); };
  async function save() {
    if (!id || !script || errors.length || locked) return false; setBusy('Saving narration script…'); setError('');
    try { const s = await request<NarrationState>(`/api/projects/${id}/narration`, jsonOptions('PUT', script)); setState(s); setScript(s.script); setDirty(false); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(''); }
  }
  async function generate(tiles: number[]) {
    if (!id || !script || errors.length || locked) return;
    if (dirty && !(await save())) return;
    setBusy(`Generating ${tiles.length === 1 ? `tile ${tiles[0]}` : 'all six'} narration…`); setError(''); setNotice('');
    try {
      const r = await request<{ generated: GeneratedNarration[]; state: NarrationState }>(`/api/projects/${id}/narration/generate`, jsonOptions('POST', { tileNumbers: tiles }));
      setState(r.state); setNotice(`Imported ${r.generated.length} narration file${r.generated.length === 1 ? '' : 's'} (${r.generated.map(g => `tile ${g.tileNumber}: ${g.duration.toFixed(1)} s`).join(', ')}). Review them in Step 10, then render.`); onGenerated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className="stage-card narration-step" id="narration-voice" aria-labelledby="narration-heading">
    <span className="eyebrow">OPTIONAL · AI VOICE</span>
    <h2 id="narration-heading">Narration voice</h2>
    <p>Write one line per tile and generate the voice-over with OpenAI text-to-speech. Generated audio is imported into Step 10 as that tile’s narration, replacing any file already there. You can still upload your own recordings instead.</p>
    {!project ? <p className="empty-coordinates">Save a project to write narration.</p> : !script || !state ? <p>Loading narration script…</p> : <>
      <div className={`message ${state.keyConfigured ? 'success' : 'error'}`} role="status">{state.keyConfigured ? 'OpenAI key detected on this computer. Text is sent to OpenAI only when you press Generate.' : 'No OpenAI key found. Set the OPENAI_API_KEY environment variable and restart the local service to enable generation. You can still edit and save the script.'}</div>
      <div className="narration-settings">
        <label>Voice<select value={script.voice} disabled={locked} onChange={e => edit({ voice: e.target.value as NarrationScript['voice'] })}>{narrationVoices.map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        <label>Model<select value={script.model} disabled={locked} onChange={e => edit({ model: e.target.value as NarrationScript['model'] })}>{narrationModels.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="narration-instructions">Delivery instructions <small>(gpt-4o models only)</small><textarea rows={2} maxLength={maxNarrationInstructions} value={script.instructions} disabled={locked || !script.model.startsWith('gpt-4o')} onChange={e => edit({ instructions: e.target.value })}/></label>
      </div>
      <div className="narration-lines">
        {script.tiles.map(t => <article key={t.tileNumber}><label><strong>Tile {String(t.tileNumber).padStart(2, '0')}</strong><textarea aria-label={`Tile ${t.tileNumber} narration`} rows={3} maxLength={maxNarrationText} value={t.text} disabled={locked} onChange={e => editTile(t.tileNumber, e.target.value)}/></label>
          <button className="button secondary" disabled={locked || !state.keyConfigured || !!errors.length} onClick={() => void generate([t.tileNumber])}>Generate tile {t.tileNumber}</button></article>)}
      </div>
      <p className="muted">Disclosure: voices generated this way are AI-generated. Tell your audience where that applies.</p>
      {errors.length ? <div className="message error" role="alert">{errors.join(' ')}</div> : null}
      {error ? <div className="message error" role="alert">{error}</div> : null}
      {notice ? <div className="message success" role="status">{notice}</div> : null}
      {busy ? <p role="status">{busy}</p> : null}
      <div className="stage-actions">
        <button className="button secondary" disabled={!dirty || !!errors.length || locked} onClick={() => void save()}>Save script</button>
        <button className="button primary" disabled={locked || !state.keyConfigured || !!errors.length} onClick={() => void generate([1, 2, 3, 4, 5, 6])}>Generate all six</button>
        <span className="muted">{state.saved ? (dirty ? 'Unsaved edits.' : 'Script saved.') : 'Not saved yet — default lines shown.'}</span>
      </div>
    </>}
  </section>;
}
