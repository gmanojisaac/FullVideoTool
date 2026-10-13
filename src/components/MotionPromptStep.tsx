import { useEffect, useState } from 'react';
import type { Project } from '../../shared/project';
import type { FrameValidationReport } from '../../shared/frames';
import { assemblePrompt, defaultPromptSet, maxMotionLength, promptGuardrails, validatePromptSet, type MotionPromptSet } from '../../shared/prompts';
import { jsonOptions, request } from '../api';

interface Props { project: Project | null; frames: FrameValidationReport | null; externalBusy: boolean }
export default function MotionPromptStep({ project, frames, externalBusy }: Props) {
  const id = project?.id, [set, setSet] = useState<MotionPromptSet | null>(null), [saved, setSaved] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    setSet(null); setSaved(false); setDirty(false); setError(''); setNotice(''); if (!id) return;
    const c = new AbortController();
    request<{ prompts: MotionPromptSet; saved: boolean }>(`/api/projects/${id}/motion-prompts`, { signal: c.signal }).then(r => { setSet(r.prompts); setSaved(r.saved); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
    return () => c.abort();
  }, [id]);
  const edit = (n: number, motion: string) => { setSet(s => s && { ...s, tiles: s.tiles.map(t => t.tileNumber === n ? { ...t, motion } : t) }); setDirty(true); setNotice(''); };
  const errors = set ? validatePromptSet(set) : [];
  async function save() {
    if (!id || !set || errors.length || busy) return; setBusy(true); setError('');
    try { const r = await request<{ prompts: MotionPromptSet }>(`/api/projects/${id}/motion-prompts`, jsonOptions('PUT', set)); setSet(r.prompts); setSaved(true); setDirty(false); setNotice('Prompts saved. They will be included in the next export package.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function copy(n: number) { const t = set?.tiles.find(t => t.tileNumber === n); if (!t) return; try { await navigator.clipboard.writeText(assemblePrompt(t.motion)); setNotice(`Tile ${n} prompt copied.`); } catch { setError('Copy is not available in this browser. Select the prompt text manually.'); } }
  const frameFor = (n: number) => frames?.frames.find(f => f.format === 'mobile' && f.tileNumber === n && f.readyForGemini);
  return <section className="stage-card prompt-step" id="gemini-motion" aria-labelledby="prompt-heading">
    <span className="eyebrow">MANUAL GEMINI HANDOFF</span>
    <h2 id="prompt-heading">Step 8 — Gemini Emotional Motion</h2>
    <p>Describe a small, natural movement for each tile. The fixed safety instructions below are appended automatically so the camera, character and lighting stay unchanged. The same prompt is used for the mobile and desktop first frame.</p>
    {!project ? <p className="empty-coordinates">Save a project to write prompts.</p> : !set ? <p>Loading prompts…</p> : <>
      <details className="prompt-guardrails"><summary>Fixed instructions appended to every prompt</summary><p>{promptGuardrails}</p></details>
      <div className="prompt-grid">
        {set.tiles.map(t => { const f = frameFor(t.tileNumber); return <article className="prompt-card" key={t.tileNumber}>
          <header><strong>Tile {String(t.tileNumber).padStart(2, '0')}</strong><span className={`test-status ${f ? 'pass' : 'pending'}`}>{f ? 'FIRST FRAME READY' : 'NO VERIFIED FRAME'}</span></header>
          {f ? <img className="prompt-thumb" alt={`Tile ${t.tileNumber} Gemini first frame`} src={f.downloadUrl}/> : null}
          <label>Motion description<textarea aria-label={`Tile ${t.tileNumber} motion description`} rows={4} maxLength={maxMotionLength} value={t.motion} disabled={busy || externalBusy} onChange={e => edit(t.tileNumber, e.target.value)}/></label>
          <div className="prompt-actions"><small>{t.motion.length}/{maxMotionLength}</small>
            <button className="button secondary" type="button" onClick={() => edit(t.tileNumber, defaultPromptSet('').tiles[t.tileNumber - 1].motion)} disabled={busy || externalBusy}>Reset</button>
            <button className="button secondary" type="button" onClick={() => void copy(t.tileNumber)}>Copy full prompt</button></div>
        </article>; })}
      </div>
      {errors.length ? <div className="message error" role="alert">{errors.join(' ')}</div> : null}
      {error ? <div className="message error" role="alert">{error}</div> : null}
      {notice ? <div className="message success" role="status">{notice}</div> : null}
      <div className="stage-actions">
        <button className="button primary" onClick={() => void save()} disabled={!dirty || !!errors.length || busy || externalBusy}>{busy ? 'Saving…' : 'Save prompts'}</button>
        {saved && id ? <a className="button secondary" href={`/api/projects/${id}/motion-prompts.txt`} download>Download all prompts (.txt)</a> : null}
        <span className="muted">{saved ? (dirty ? 'Unsaved edits.' : 'Saved.') : 'Not saved yet — defaults shown.'}</span>
      </div>
    </>}
  </section>;
}
