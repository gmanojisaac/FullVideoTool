import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { atomicJson } from '../server/storage.js';
import { captureProcess,detectVideoTools } from '../server/video-tools.js';
import { importAssemblyFixture,waitForAssembly } from '../server/assembly-checks.js';
import { testJson } from '../server/frame-checks.js';
import type { AssemblyState,AssemblyJob } from '../shared/assembly.js';
const id='03080222-5f86-4423-a624-07ae2ec0698f',base='http://127.0.0.1:3001',folder=path.resolve('previews/assembly-demo-narration'),tools=await detectVideoTools();if(!tools.available)throw new Error(tools.instructions);
await mkdir(folder,{recursive:true});const route=`/api/projects/${id}/assembly`;
for(let n=1;n<=6;n++){const file=path.join(folder,`tile_${String(n).padStart(2,'0')}_synthetic_test_tone.wav`);await captureProcess(tools.ffmpeg!,['-y','-v','error','-f','lavfi','-i',`sine=frequency=${220+55*n}:sample_rate=48000:duration=${n===1?'8.4':'0.6'}`,'-ac','2','-c:a','pcm_s16le',file]);await importAssemblyFixture(base,id,file,'audio',n);}
const state=await testJson<AssemblyState>(base,route);state.config.lessonTitle='DEMO: supplied comic / verified still frames / synthetic test tones';for(const f of ['mobile','desktop'] as const)for(const t of state.config[f].tiles){t.stillFallback=true;t.silentOverride=false;t.bridge='none';t.volume=.5;}
await testJson(base,route+'/settings','PUT',{config:state.config,expectedRevision:state.config.revision});
const start=await testJson<AssemblyJob>(base,route+'/jobs','POST',{formats:['mobile','desktop'],scope:'full',tileNumber:1},202);console.log('Sample assembly job '+start.id);const job=await waitForAssembly(base,start);await atomicJson(path.resolve('previews/module-ten-sample-manifest.json'),job.manifest);console.log(JSON.stringify({outputs:job.manifest?.outputs,timeline:job.manifest?.timelineUrl,editingZip:job.manifest?.editingZipUrl,provenance:'User supplied comic; explicit verified-still fallbacks and generated synthetic sine test tones. No Gemini motion or human speech.'},null,2));
