import { apiUrl } from '../urls';
import { useEffect, useRef } from 'react';
import TextCanvas from './TextCanvas';
import { displayedTextFrame, type TextEffect } from '../../shared/text-effects';
import type { OutputFormat } from '../../shared/layout';

interface Props { objects:TextEffect[]; format:OutputFormat; projectId:string; frame:number; onFrame:(n:number)=>void; playing:boolean; onPlaying:(value:boolean)=>void; duration:number; quality:'low'|'high'; checkerboard:boolean; videoUrl?:string; imageUrl?:string }
export default function TextCompositionPreview({objects,format,projectId,frame,onFrame,playing,onPlaying,duration,quality,checkerboard,videoUrl,imageUrl}:Props){
  const video=useRef<HTMLVideoElement>(null),pendingSeek=useRef<number|null>(null),clock=useRef({frame,onFrame,onPlaying,duration});clock.current={frame,onFrame,onPlaying,duration};
  useEffect(()=>{const v=video.current;if(!v)return;if(!playing&&Math.abs(v.currentTime-frame/30)>.015){pendingSeek.current=frame;v.currentTime=frame/30;}},[frame,playing,videoUrl,checkerboard]);
  useEffect(()=>{const v=video.current;let raf=0;const beginning=performance.now(),start=clock.current.frame;
    if(!playing){v?.pause();return;}if(v){pendingSeek.current=start;v.currentTime=start/30;void v.play().catch(()=>clock.current.onPlaying(false));}
    const tick=()=>{const now=v?v.currentTime*30:start+(performance.now()-beginning)*.03;const n=Math.min(displayedTextFrame(now/30),Math.max(0,Math.ceil(clock.current.duration*30)-1));clock.current.onFrame(n);if(now>=clock.current.duration*30){clock.current.onPlaying(false);return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  },[playing,videoUrl,checkerboard]);
  const width=format==='mobile'?360:640,height=format==='mobile'?640:360;
  return <div className={`text-composition ${checkerboard?'checkerboard':''}`} style={{aspectRatio:`${width}/${height}`,maxWidth:width}}>
    {videoUrl&&!checkerboard?<video ref={video} src={apiUrl(videoUrl)} playsInline controls preload="metadata" aria-label="Composition footage with synchronized narration" onPlay={()=>onPlaying(true)} onPause={()=>onPlaying(false)} onSeeked={e=>{const pending=pendingSeek.current,time=e.currentTarget.currentTime;pendingSeek.current=null;onFrame(pending!==null&&Math.abs(time*30-pending)<.1?pending:displayedTextFrame(time));}} onEnded={()=>onPlaying(false)}/>:null}
    {!videoUrl&&imageUrl&&!checkerboard?<img src={apiUrl(imageUrl)} alt="Current reconstructed grid"/>:null}
    <TextCanvas objects={objects} frame={frame} width={width} height={height} quality={quality} projectId={projectId}/>
  </div>;
}
