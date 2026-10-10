import { useEffect, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import type { CameraSettings, CameraTransform } from '../../shared/focus';

export default function FocusCanvas({ transform: t, settings, imageUrl, safeArea, thirds, disabled, onCheckpoint, onChange }: {
  transform: CameraTransform; settings: CameraSettings; imageUrl: string; safeArea: boolean; thirds: boolean; disabled: boolean;
  onCheckpoint: () => void; onChange: (settings: CameraSettings) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; settings: CameraSettings; transform: CameraTransform } | null>(null);
  const latest = useRef({ settings, disabled, onCheckpoint, onChange }); latest.current = { settings, disabled, onCheckpoint, onChange };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (latest.current.disabled) return;
      event.preventDefault(); latest.current.onCheckpoint();
      const s = latest.current.settings;
      latest.current.onChange({ ...s, zoom: Math.max(0.25, Math.min(8, s.zoom * Math.exp(-event.deltaY * 0.001))) });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function point(event: PointerEvent<SVGSVGElement>) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    const p = point(event); if (!p) return;
    event.preventDefault(); event.currentTarget.focus(); onCheckpoint();
    drag.current = { x: p.x, y: p.y, settings: structuredClone(settings), transform: t };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const p = point(event), d = drag.current;
    if (!d || !p || disabled) return;
    onChange({ ...d.settings, center: { x: (d.transform.focalPoint.x - (p.x - d.x) / d.transform.scale) / d.transform.sourceWidth, y: (d.transform.focalPoint.y - (p.y - d.y) / d.transform.scale) / d.transform.sourceHeight } });
  }
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (disabled) return;
    const step = event.shiftKey ? 20 : 4;
    let dx = 0, dy = 0, zoom = settings.zoom;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else if (event.key === '+' || event.key === '=') zoom = Math.min(8, zoom * 1.1);
    else if (event.key === '-') zoom = Math.max(0.25, zoom / 1.1);
    else return;
    event.preventDefault(); onCheckpoint();
    onChange({ ...settings, zoom, center: { x: (t.focalPoint.x + dx / t.scale) / t.sourceWidth, y: (t.focalPoint.y + dy / t.scale) / t.sourceHeight } });
  }
  const { width: w, height: h } = t.viewport;
  return <svg ref={svg} className={`focus-canvas ${disabled ? 'disabled' : ''}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Interactive camera framing. Drag to pan, wheel to zoom, arrow keys to move." tabIndex={disabled ? -1 : 0} onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={key} data-scale={t.scale} data-translation-x={t.translation.x} data-translation-y={t.translation.y}>
    <rect width={w} height={h} fill={t.paddingColor}/>
    <image href={imageUrl} width={t.sourceWidth} height={t.sourceHeight} transform={`matrix(${t.scale} 0 0 ${t.scale} ${t.translation.x} ${t.translation.y})`} preserveAspectRatio="none"/>
    {thirds ? <g className="focus-third-guides" pointerEvents="none">{[1, 2].map(i => <g key={i}><line x1={w * i / 3} x2={w * i / 3} y1={0} y2={h}/><line x1={0} x2={w} y1={h * i / 3} y2={h * i / 3}/></g>)}</g> : null}
    {safeArea ? <g className="focus-safe-guide" pointerEvents="none"><rect x={w * 0.08} y={h * 0.08} width={w * 0.84} height={h * 0.84}/><text x={w * 0.1} y={h * 0.11} fontSize={Math.min(w, h) * 0.023}>SAFE AREA · INSPECT SUBJECT MANUALLY</text></g> : null}
  </svg>;
}
