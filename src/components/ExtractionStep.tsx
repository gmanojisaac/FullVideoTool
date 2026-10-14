import { apiUrl } from '../urls';
import { useEffect, useRef, useState } from 'react';
import { request, jsonOptions, type CheckReport } from '../api';
import { dimensions, layoutLabel, type Project } from '../../shared/project';
import { extractionCheckNames, type ExtractionJob, type ExtractionManifest } from '../../shared/extraction';
import Icon from './Icon';

export default function ExtractionStep({ project, dirty, valid, externalBusy, onRunningChange, onManifestChange, onBack }: {
  project: Project | null; dirty: boolean; valid: boolean; externalBusy: boolean;
  onRunningChange: (running: boolean) => void; onBack: () => void;
  onManifestChange: (manifest: ExtractionManifest | null) => void;
}) {
  const [manifest, setManifest] = useState<ExtractionManifest | null>(null);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [report, setReport] = useState<CheckReport | null>(null);
  const startLock = useRef(false);
  const running = starting || job?.status === 'running';
  const approved = !!project && valid && !dirty;
  const { columns } = dimensions(project?.layout ?? '2x3');

  useEffect(() => { onManifestChange(manifest); }, [manifest, onManifestChange]);

  useEffect(() => {
    onRunningChange(running);
    return () => onRunningChange(false);
  }, [running, onRunningChange]);

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null); setJob(null); setError('');
    if (project && !dirty) {
      request<{ manifest: ExtractionManifest | null; job: ExtractionJob | null }>(`/api/projects/${project.id}/extraction`, { signal: controller.signal })
        .then(current => {
          if (controller.signal.aborted) return;
          setManifest(current.manifest); setJob(current.job);
          if (current.job?.status === 'failed') setError(current.job.error ?? current.job.message);
        })
        .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'Saved extraction could not be loaded.'); });
    }
    return () => controller.abort();
  }, [project?.id, project?.updatedAt, dirty]);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const controller = new AbortController();
    const { projectId, id } = job;
    async function poll() {
      try {
        while (!controller.signal.aborted) {
          const current = await request<ExtractionJob>(`/api/projects/${projectId}/extractions/${id}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setJob(current);
          if (current.status === 'complete') { setManifest(current.manifest!); setError(''); return; }
          if (current.status === 'failed') { setError(current.error ?? current.message); return; }
          if (current.status === 'cancelled') return;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (problem) {
        if (!controller.signal.aborted) {
          setJob(previous => previous ? { ...previous, status: 'failed' } : null);
          setError(`${problem instanceof Error ? problem.message : 'Connection to the service was lost.'} Reopen this saved project to reconnect to the extraction job.`);
        }
      }
    }
    void poll();
    return () => controller.abort();
  }, [job?.id, job?.status]);

  async function begin() {
    if (!project || !approved || externalBusy || running || startLock.current) return;
    startLock.current = true; setStarting(true); setError('');
    try {
      const next = await request<ExtractionJob>(`/api/projects/${project.id}/extract`, jsonOptions('POST', { expectedUpdatedAt: project.updatedAt }));
      setJob(next);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Extraction could not start.'); }
    finally { setStarting(false); startLock.current = false; }
  }
  async function cancel() {
    if (!project || !job || job.status !== 'running') return;
    try { setJob(await request<ExtractionJob>(`/api/projects/${project.id}/extractions/${job.id}/cancel`, { method: 'POST' })); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Cancellation could not be requested.'); }
  }
  async function runChecks() {
    if (checking) return;
    setChecking(true); setCheckError('');
    try { setReport(await request<CheckReport>('/api/checks/module2', { method: 'POST' })); }
    catch (problem) { setCheckError(problem instanceof Error ? problem.message : 'Module 2 checks could not run.'); }
    finally { setChecking(false); }
  }

  return <>
    <section id="extract-six-tiles" className="extraction-card" aria-label="Step 2 extraction">
      <div className="extraction-heading"><div><div className="eyebrow">KEEP EVERY PIXEL. GIVE EACH FRAME ITS SPACE.</div><h2><span className="extraction-step-number">02</span> Step 2 — Extract Six Tiles</h2><p>Six lossless PNGs from your saved boundaries, at their original resolution.</p></div><span className="native-badge">NATIVE RESOLUTION</span></div>
      <div className={`approval-banner ${approved ? 'approved' : ''}`}><Icon name={approved ? 'check' : 'info'} size={17}/><div><strong>{approved ? `Saved ${layoutLabel(project!.layout)} layout · Six confirmed rectangles` : !project ? 'Start with your comic in Step 1.' : !valid ? 'Correct invalid panel boundaries in Step 1.' : 'Review your boundaries, then Save project to confirm them.'}</strong><p>{approved ? 'Extraction uses these exact original-image pixel coordinates.' : 'Extraction unlocks once all six valid rectangles are saved.'}</p></div></div>
      <div className="extraction-actions"><button className="button primary" onClick={() => void begin()} disabled={!approved || externalBusy || running}><Icon name={running ? 'refresh' : 'grid'}/>{running ? 'Extracting Six Tiles…' : job?.status === 'failed' ? 'Retry extraction' : manifest ? 'Re-extract' : 'Extract Six Tiles'}</button>
        {manifest && !running ? <a className="button secondary" href={apiUrl(manifest.zipUrl)} download="six_extracted_tiles.zip"><Icon name="download"/> Download All Tiles ZIP</a> : <button className="button secondary" disabled><Icon name="download"/> Download All Tiles ZIP</button>}
        <button className="text-button back-to-panels" onClick={onBack} disabled={running}><Icon name="arrow" size={15} style={{ transform: 'rotate(180deg)' }}/> Back to Panel Adjustment</button>
      </div>
      {error ? <div className="message error" role="alert"><Icon name="info"/>{error}</div> : null}
      {running ? <div className="extraction-progress" role="status"><div><span>{job?.message ?? 'Starting extraction…'}</span><strong>{job?.progress ?? 0}%</strong></div><div role="progressbar" aria-label="Extraction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress ?? 0}><span style={{ width: `${job?.progress ?? 0}%` }}/></div><div><span>{job?.completedTiles ?? 0} of 6 tiles verified</span><button className="text-button" onClick={() => void cancel()} disabled={!job || job.cancelRequested}>Cancel extraction</button></div></div> : null}
      {job?.status === 'cancelled' ? <div className="message" role="status"><Icon name="info"/>{job.message}</div> : null}
      {manifest ? <>
        <div className="extraction-complete" role="status"><span><Icon name="check" size={18}/><strong>6/6 pixel checks PASS</strong></span><span>{manifest.bitDepth}-bit PNG · No resizing · Reading order preserved</span></div>
        <div className="extracted-tiles" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{manifest.tiles.map(tile => <article className="extracted-tile" key={tile.number} data-testid={`extracted-tile-${tile.number}`}>
          <div className="tile-image-wrap"><img src={apiUrl(tile.imageUrl)} alt={`Extracted tile ${String(tile.number).padStart(2, '0')}`} loading="lazy"/><span className="tile-number">{String(tile.number).padStart(2, '0')}</span></div>
          <div className="tile-card-footer"><div><strong>{tile.filename}</strong><span>{tile.width} × {tile.height} px</span></div><a className="tile-download" href={apiUrl(tile.downloadUrl)} download={tile.filename} aria-label={`Download tile ${tile.number}`}><Icon name="download" size={17}/><span>PNG</span></a></div>
          <div className="tile-pixel-status"><Icon name="check" size={12}/><span>Exact pixels · PASS</span></div>
        </article>)}</div>
        <div className="extraction-metadata"><div><strong>Saved extraction</strong><span>{manifest.outputDirectory}</span></div><a className="text-button" href={apiUrl(manifest.manifestUrl)} download="tile_extraction_manifest.json"><Icon name="download" size={15}/> Download manifest</a></div>
      </> : <div className="extraction-empty"><div className="empty-tile-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i}><Icon name="image" size={24}/><small>{String(i + 1).padStart(2, '0')}</small></span>)}</div><strong>Your six original frames, ready to stand on their own.</strong><p>Only the gutter regions excluded by your saved boundaries are removed.</p></div>}
    </section>
    <section className="test-card" aria-label="Module 2 tests"><div className="test-card-heading"><div><span className="eyebrow">THE PIXEL CHECK</span><h2><Icon name="flask" size={21}/> Module 2 test bench</h2><p>Real files. Exact pixels. Both layouts. Complete downloads.</p></div><div className="test-actions">{report ? <span className={`test-total ${report.passed !== report.total ? 'failed' : ''}`}>{report.passed}/{report.total} PASS</span> : null}<button className="button secondary" disabled={checking} onClick={() => void runChecks()}><Icon name={checking ? 'refresh' : 'check'}/>{checking ? 'Running Module 2 checks…' : 'Run Module 2 checks'}</button></div></div>
      {checkError ? <div className="message error" role="alert">{checkError}</div> : null}
      <div className="test-grid">{(report?.results ?? extractionCheckNames.map(name => ({ name, status: null, detail: '' }))).map((result, index) => <div className="test-result module-two-result" key={result.name}><span className="test-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{result.name}</strong>{result.detail ? <p>{result.detail}</p> : null}</div><span className={`test-status ${result.status?.toLowerCase() ?? 'pending'}`}>{result.status ?? 'NOT RUN'}</span></div>)}</div>
      <div className="test-footer"><Icon name="info" size={14}/><span>These checks also run the original Module 1 API scenarios. All test outputs use an isolated temporary workspace.</span></div>
    </section>
  </>;
}
