import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, atomicJson } from './storage.js';
import { assemblyRoot } from './assembly-media.js';
import { validId } from '../shared/project.js';
import { outputSpec, type OutputFormat } from '../shared/layout.js';
import { appliesTo, type TextExportJob } from '../shared/text-effects.js';
import type { AssemblyConfig } from '../shared/assembly.js';
import { exportTextSequence } from './text-render.js';
import { ExtractionError } from './extraction.js';
import { hashFile } from './export-zip.js';
import { rm, unlink } from 'node:fs/promises';

export function createTextJobs(dataRoot:string,getConfig:(id:string)=>Promise<AssemblyConfig>){
  const jobs=new Map<string,TextExportJob>(),active=new Map<string,AbortController>();
  const directory=(id:string,run:string)=>{if(!validId(run))throw new ExtractionError(400,'Invalid text export ID.');return path.join(assemblyRoot(dataRoot,id),'text-runs',run);};
  const isRunning=(id?:string)=>id?active.has(id):active.size>0;
  async function get(id:string,run:string){let job=jobs.get(run);if(!job){try{job=await readJson<TextExportJob>(path.join(directory(id,run),'job.json'));}catch{throw new ExtractionError(404,'Text export not found.');}if(job.projectId!==id)throw new ExtractionError(404,'Text export not found.');if(job.status==='running'){const base=path.resolve(directory(id,run)),frames=path.resolve(base,'frames');if(path.dirname(frames)!==base)throw new Error('Unsafe interrupted text cleanup.');await rm(frames,{recursive:true,force:true});await unlink(path.join(base,'transparent_text_frames.zip.partial')).catch(e=>{if(e.code!=='ENOENT')throw e;});job={...job,status:'failed',message:'Text export was interrupted. Retry; prior successful archives are retained.',error:'The local application stopped during export.'};await atomicJson(path.join(base,'job.json'),job);}jobs.set(run,job);}if(job.projectId!==id)throw new ExtractionError(404,'Text export not found.');return job;}
  async function latest(id:string){try{const ref=await readJson<{id:string}>(path.join(assemblyRoot(dataRoot,id),'latest_text_export.json'));return await get(id,ref.id);}catch{return null;}}
  async function start(id:string,request:{objectId?:string;format?:OutputFormat;expectedRevision?:number}){
    if(isRunning())throw new ExtractionError(409,'Wait or cancel the current text export.');const controller=new AbortController();active.set(id,controller);
    try{const config=await getConfig(id),object=config.textEffects?.objects.find(o=>o.id===request.objectId),format=request.format;if(!object||!format||!['mobile','desktop'].includes(format)||!appliesTo(object,format))throw new ExtractionError(400,'Select a saved text object and matching output format.');if(config.revision!==request.expectedRevision)throw new ExtractionError(409,'Save current text settings before export.');
      const run=randomUUID(),job:TextExportJob={id:run,projectId:id,format,objectId:object.id,settingsRevision:config.revision,status:'running',progress:0,message:'Preparing local transparent renderer…'};await atomicJson(path.join(directory(id,run),'job.json'),job);await atomicJson(path.join(assemblyRoot(dataRoot,id),'latest_text_export.json'),{id:run});jobs.set(run,job);
      void(async()=>{try{const result=await exportTextSequence(dataRoot,id,run,object,outputSpec[format],controller.signal,n=>{job.progress=n;job.message=`Rendering transparent ${format} frames · ${n}%`;});controller.signal.throwIfAborted();job.status='complete';job.progress=100;job.message='Transparent PNG sequence rendered and ZIP independently verified.';job.frameCount=result.manifest.frameCount;job.sha256=result.sha256;job.downloadUrl=`/api/projects/${id}/assembly/text-jobs/${run}/files/transparent_text_frames.zip`;job.manifestUrl=`/api/projects/${id}/assembly/text-jobs/${run}/files/text_sequence_manifest.json`;}catch(e){job.status=controller.signal.aborted?'cancelled':'failed';job.error=(e as Error).message;job.message=controller.signal.aborted?'Text export cancelled. Prior completed outputs retained.':'Text export failed. Correct the reported issue and retry.';}finally{await atomicJson(path.join(directory(id,run),'job.json'),job).catch(()=>{});active.delete(id);}})();return job;
    }catch(e){active.delete(id);throw e;}
  }
  async function cancel(id:string,run:string){const job=await get(id,run);if(job.status==='running')active.get(id)?.abort();return job;}
  async function file(id:string,run:string,name:string){const job=await get(id,run);if(job.status!=='complete'||!['transparent_text_frames.zip','text_sequence_manifest.json'].includes(name))throw new ExtractionError(409,'Text export file is not ready.');const filename=path.join(directory(id,run),name);if(name.endsWith('.zip')&&await hashFile(filename)!==job.sha256)throw new ExtractionError(409,'Text archive checksum changed. Export again.');return filename;}
  return {get,latest,start,cancel,file,isRunning};
}
