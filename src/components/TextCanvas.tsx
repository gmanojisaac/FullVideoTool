import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../urls';
import type { TextEffect } from '../../shared/text-effects';
import type { TextEngine } from '../../shared/text-engine';

interface Props { objects:TextEffect[]; frame:number; width:number; height:number; quality:'low'|'high'; projectId?:string }
export default function TextCanvas({objects,frame,width,height,quality,projectId}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<TextEngine|null>(null),latestFrame=useRef(frame),[error,setError]=useState(''),[ready,setReady]=useState(0);latestFrame.current=frame;
  const w=quality==='low'?Math.round(width/2):width,h=quality==='low'?Math.round(height/2):height;
  useEffect(()=>{let disposed=false;setError('');const node=canvas.current;void import('../../shared/text-engine').then(({TextEngine})=>{if(disposed||!node)return;try{engine.current=new TextEngine(node,w,h);setReady(v=>v+1);}catch(e){setError(`WebGL preview unavailable: ${(e as Error).message}`);}}).catch(e=>{if(!disposed)setError(e.message);});const lost=(e:Event)=>{e.preventDefault();setError('WebGL context lost. Close and reopen 3D Text Effects to retry.');};node?.addEventListener('webglcontextlost',lost);return()=>{disposed=true;node?.removeEventListener('webglcontextlost',lost);engine.current?.dispose();engine.current=null;};},[w,h]);
  useEffect(()=>{let disposed=false;const active=engine.current;if(!active)return;setError('');void active.setObjects(objects,id=>apiUrl(`/api/projects/${projectId}/assembly/text-environments/${id}`)).then(()=>{if(!disposed)active.render(latestFrame.current);}).catch(e=>{if(!disposed)setError((e as Error).message);});return()=>{disposed=true;};},[objects,projectId,ready]);
  useEffect(()=>{try{engine.current?.render(frame);}catch(e){setError((e as Error).message);}},[frame]);
  return <><canvas key={`${w}x${h}`} ref={canvas} className="text-webgl" aria-label="Transparent 3D text overlay"/>{error?<p className="text-preview-error" role="alert">{error}</p>:null}</>;
}
