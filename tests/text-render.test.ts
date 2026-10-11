import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { defaultTextEffect } from '../shared/text-effects';
import { exportTextSequence } from '../server/text-render';
import { outputSpec } from '../shared/layout';

async function workspace(action:(root:string)=>Promise<void>){const parent=path.resolve(tmpdir()),root=await mkdtemp(path.join(parent,'six-tile-text-render-'));try{await action(root);}finally{if(path.dirname(root)!==parent||!path.basename(root).startsWith('six-tile-text-render-'))throw new Error('Unsafe text-test cleanup');await rm(root,{recursive:true,force:true});}}
for(const [format,preset] of [['mobile','particle-assembly'],['desktop','camera-fly-through'],['desktop','environmental']] as const)test(`Actual transparent ${format} ${preset} PNG sequence, exact filenames and alpha`,{timeout:180000},async()=>workspace(async root=>{
  const o={...defaultTextEffect('word',format),preset,start:12,visibilityDuration:4},dimensions=outputSpec[format],result=await exportTextSequence(root,randomUUID(),randomUUID(),o,dimensions,new AbortController().signal,()=>{}),archive=unzipSync(new Uint8Array(await readFile(result.archive))),prefix='six_tile_lesson_export/',names=Object.keys(archive),pngs=names.filter(n=>n.endsWith('.png')).sort();assert.equal(pngs.length,30);assert.equal(pngs[0],prefix+'text_000000.png');assert.equal(pngs.at(-1),prefix+'text_000029.png');assert.equal(result.manifest.compositionStartFrame,360);assert.equal(result.manifest.lastCompositionFrame,389);assert.equal(result.manifest.validation.deterministicRepeat,true);const bytes=archive[pngs.at(-1)!],{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,dimensions.width);assert.equal(info.height,dimensions.height);assert.equal(info.channels,4);assert.equal(data[3],0);let visible=0,partial=0;for(let i=3;i<data.length;i+=4){if(data[i]>200)visible++;if(data[i]>0&&data[i]<200)partial++;}assert(visible>1000);assert(partial>0);assert.equal(names.length,31);assert.equal(result.manifest.frames.length,30);
}));
test('Cancellation interrupts local browser export and removes temporary frames',{timeout:60000},async()=>workspace(async root=>{const id=randomUUID(),run=randomUUID(),c=new AbortController();await assert.rejects(exportTextSequence(root,id,run,defaultTextEffect('word'),{width:640,height:360},c.signal,n=>{if(n>0)c.abort();}));await assert.rejects(stat(path.join(root,'exports',id,'assembly','text-runs',run,'frames')),{code:'ENOENT'});await assert.rejects(stat(path.join(root,'exports',id,'assembly','text-runs',run,'transparent_text_frames.zip')),{code:'ENOENT'});}));
