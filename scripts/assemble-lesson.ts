import { validId } from '../shared/project.js';
import type { AssemblyJob } from '../shared/assembly.js';
const [id,format='both']=process.argv.slice(2),base=process.env.SIX_TILE_URL||'http://127.0.0.1:3001';
if(!validId(id)||!['mobile','desktop','both'].includes(format))throw new Error('Usage: npm run assemble-lesson -- <project UUID> [mobile|desktop|both]');
async function json(url:string,options?:RequestInit){const r=await fetch(base+url,options),body=await r.json();if(!r.ok)throw new Error(body.error||'Local service request failed.');return body;}
let job:AssemblyJob=await json(`/api/projects/${id}/assembly/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formats:format==='both'?['mobile','desktop']:[format],scope:'full',tileNumber:1})});
while(job.status==='running'){console.log(`${job.progress}% ${job.message}`);await new Promise(r=>setTimeout(r,1500));job=await json(`/api/projects/${id}/assembly/jobs/${job.id}`);}
if(job.status!=='complete')throw new Error(job.error||job.message);
console.log(JSON.stringify({renderId:job.id,outputs:job.manifest?.outputs,manifest:job.manifest?.manifestUrl,timeline:job.manifest?.timelineUrl,editingZip:job.manifest?.editingZipUrl},null,2));
