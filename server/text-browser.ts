import { TextEngine } from '../shared/text-engine';
import type { TextEffect } from '../shared/text-effects';
declare global { interface Window { sixTileText: { initialize:(objects:TextEffect[],width:number,height:number)=>Promise<void>; frame:(n:number)=>string; dispose:()=>void } } }
let engine:TextEngine|undefined;
window.sixTileText={initialize:async(objects,width,height)=>{engine?.dispose();const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);engine=new TextEngine(canvas,width,height);await engine.setObjects(objects);},frame:n=>{if(!engine)throw new Error('Text renderer not initialized.');engine.render(n);return engine.png();},dispose:()=>engine?.dispose()};
