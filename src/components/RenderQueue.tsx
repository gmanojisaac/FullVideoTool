import { useEffect, useState } from 'react';
import type { AnimationJob } from '../../shared/animation';
import { request } from '../api';

export default function RenderQueue({ busy }: { busy: boolean }) {
  const [state, setState] = useState<{ maximumFfmpegProcesses: number; active: number; jobs: (AnimationJob & { queueState: string })[] } | null>(null);
  useEffect(() => { const c = new AbortController(); const load = () => { void request<typeof state>('/api/render-queue', { signal: c.signal }).then(setState).catch(() => {}); }; load(); const timer = setInterval(load, busy ? 800 : 5000); return () => { clearInterval(timer); c.abort(); }; }, [busy]);
  return <details className="render-queue"><summary>Local render queue · {state?.active || 0} active · at most {state?.maximumFfmpegProcesses || 2} FFmpeg processes</summary>{state?.jobs.length ? state.jobs.slice(0, 8).map(j => <p key={j.id}><strong>{j.status === 'running' ? j.queueState : j.status}</strong> · {j.projectId.slice(0, 8)} · {j.progress}% · {j.message}</p>) : <p>No queued camera renders.</p>}</details>;
}
