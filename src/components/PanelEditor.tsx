import { useRef, type PointerEvent, type KeyboardEvent } from 'react';
import { dimensions, moveGridEdge, type Panel, type Project } from '../../shared/project';

type Edge = 'left' | 'right' | 'top' | 'bottom';
type Drag = { kind: 'grid'; axis: 'x' | 'y'; index: number; edge: 0 | 1 } | { kind: 'panel'; id: number; edge: Edge };

export function movePanelEdge(project: Project, id: number, edge: Edge, value: number): Project {
  const panel = project.panels.find(p => p.id === id)!;
  const coordinate = Math.round(value);
  const right = panel.x + panel.width, bottom = panel.y + panel.height;
  let patch: Partial<Panel> = {};
  if (edge === 'left') { const x = Math.max(0, Math.min(coordinate, right - 1)); patch = { x, width: right - x }; }
  if (edge === 'right') patch = { width: Math.max(1, Math.min(project.input.width, coordinate) - panel.x) };
  if (edge === 'top') { const y = Math.max(0, Math.min(coordinate, bottom - 1)); patch = { y, height: bottom - y }; }
  if (edge === 'bottom') patch = { height: Math.max(1, Math.min(project.input.height, coordinate) - panel.y) };
  return { ...project, panels: project.panels.map(p => p.id === id ? { ...p, ...patch } : p), manuallyAdjusted: true };
}

export default function PanelEditor({ project, selected, guides, mode, disabled, onSelect, onChange }: {
  project: Project; selected: number; guides: boolean; mode: 'gutters' | 'panel'; disabled: boolean;
  onSelect: (id: number) => void; onChange: (project: Project) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const { width, height } = project.input;
  const scale = Math.max(width, height) / 900;
  const { columns } = dimensions(project.layout);
  const panel = project.panels.find(p => p.id === selected)!;
  const start = (event: PointerEvent<SVGElement>, next: Drag) => {
    if (disabled) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = next; event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current || disabled) return;
    const matrix = svgRef.current.getScreenCTM();
    if (!matrix) return;
    // Inverse SVG matrix accounts for responsive scaling, zoom, scrolling, and letterboxing.
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const active = drag.current;
    onChange(active.kind === 'grid'
      ? moveGridEdge(project, active.axis, active.index, active.edge, active.axis === 'x' ? point.x : point.y)
      : movePanelEdge(project, active.id, active.edge, active.edge === 'left' || active.edge === 'right' ? point.x : point.y));
  };
  const key = (event: KeyboardEvent<SVGLineElement>, target: Drag, position: number) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const change = (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 10 : 1);
    onChange(target.kind === 'grid' ? moveGridEdge(project, target.axis, target.index, target.edge, position + change) : movePanelEdge(project, target.id, target.edge, position + change));
  };
  const handle = (x1: number, y1: number, x2: number, y2: number, target: Drag, label: string, position: number, axis: 'x' | 'y') => <g key={label} className={`drag-edge ${axis === 'x' ? 'vertical' : 'horizontal'}`}>
    <line x1={x1} y1={y1} x2={x2} y2={y2} className="edge-visible" strokeWidth={1.5 * scale} />
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12 * scale} tabIndex={disabled ? -1 : 0} role="slider"
      aria-label={label} aria-valuenow={position} aria-valuemin={0} aria-valuemax={axis === 'x' ? width : height} aria-orientation={axis === 'x' ? 'horizontal' : 'vertical'}
      onPointerDown={event => start(event, target)} onKeyDown={event => key(event, target, position)} />
    <rect x={(x1 + x2) / 2 - (axis === 'x' ? 3 : 15) * scale} y={(y1 + y2) / 2 - (axis === 'x' ? 15 : 3) * scale}
      width={(axis === 'x' ? 6 : 30) * scale} height={(axis === 'x' ? 30 : 6) * scale} rx={3 * scale} className="edge-grip" pointerEvents="none" />
  </g>;
  return <div className="comic-stage" style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, ${730 * width / height}px)` }}>
    <img src={project.input.imageUrl} alt={`Uploaded comic: ${project.input.filename}`} draggable={false} />
    {guides ? <svg ref={svgRef} className={`panel-overlay ${disabled ? 'locked' : ''}`} viewBox={`0 0 ${width} ${height}`}
      aria-label="Comic panel boundary editor" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {project.panels.map(p => <g key={p.id}>
        <rect data-testid={`panel-guide-${p.id}`} x={p.x} y={p.y} width={p.width} height={p.height}
          className={selected === p.id ? 'panel-guide selected' : 'panel-guide'} strokeWidth={1.7 * scale}
          onClick={() => onSelect(p.id)} />
        <g transform={`translate(${p.x + 15 * scale}, ${p.y + 15 * scale})`} className="panel-number" onClick={() => onSelect(p.id)}>
          <rect width={30 * scale} height={30 * scale} rx={7 * scale} />
          <text x={15 * scale} y={20 * scale} fontSize={15 * scale} textAnchor="middle">{String(p.id).padStart(2, '0')}</text>
        </g>
      </g>)}
      {mode === 'gutters' ? (['x', 'y'] as const).flatMap(axis => project.grid[axis].flatMap(([a, b], index) => ([0, 1] as const).map(edge => {
        const position = edge === 0 ? a : b;
        return handle(axis === 'x' ? position : 0, axis === 'y' ? position : 0, axis === 'x' ? position : width, axis === 'y' ? position : height,
          { kind: 'grid', axis, index, edge }, `${axis === 'x' ? 'Column' : 'Row'} ${index + 1} ${edge === 0 ? 'start' : 'end'} boundary`, position, axis);
      }))) : <>
        {handle(panel.x, panel.y, panel.x, panel.y + panel.height, { kind: 'panel', id: selected, edge: 'left' }, `Panel ${selected} left boundary`, panel.x, 'x')}
        {handle(panel.x + panel.width, panel.y, panel.x + panel.width, panel.y + panel.height, { kind: 'panel', id: selected, edge: 'right' }, `Panel ${selected} right boundary`, panel.x + panel.width, 'x')}
        {handle(panel.x, panel.y, panel.x + panel.width, panel.y, { kind: 'panel', id: selected, edge: 'top' }, `Panel ${selected} top boundary`, panel.y, 'y')}
        {handle(panel.x, panel.y + panel.height, panel.x + panel.width, panel.y + panel.height, { kind: 'panel', id: selected, edge: 'bottom' }, `Panel ${selected} bottom boundary`, panel.y + panel.height, 'y')}
      </>}
      <title>{columns} columns, six panels. Drag an edge or focus a boundary and use arrow keys.</title>
    </svg> : null}
  </div>;
}
