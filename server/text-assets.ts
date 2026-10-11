import path from 'node:path';
import { readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { hdrPath } from './text-render.js';
import { atomicJson, readJson } from './storage.js';
import { hashFile } from './export-zip.js';
import { ExtractionError } from './extraction.js';
export async function importTextHdr(dataRoot:string,id:string,filename:string,originalName:string){
  if(path.extname(originalName).toLowerCase()!=='.hdr')throw new ExtractionError(415,'Choose a local Radiance .hdr environment.');const bytes=(await stat(filename)).size;if(bytes>16*1024*1024)throw new ExtractionError(413,'HDR environments are limited to 16 MB.');const buffer=await readFile(filename),header=buffer.subarray(0,4096).toString('ascii'),size=header.match(/[+-]Y\s+(\d+)\s+[+-]X\s+(\d+)/);if(!/^#\?(RADIANCE|RGBE)/.test(header)||!size||Number(size[1])>4096||Number(size[2])>4096||Number(size[1])*Number(size[2])>16*1024*1024)throw new ExtractionError(400,'HDR header or dimensions are unsupported (maximum 4096 × 4096).');try{new HDRLoader().parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer);}catch(e){throw new ExtractionError(400,`Invalid HDR environment: ${(e as Error).message}`);}
  const assetId=randomUUID(),target=hdrPath(dataRoot,id,assetId);await mkdir(path.dirname(target),{recursive:true});await copyFile(filename,target);const asset={id:assetId,sha256:await hashFile(target),filename:originalName,bytes};await atomicJson(target+'.json',asset);return asset;
}
export async function textHdrFile(dataRoot:string,id:string,assetId:string){const filename=hdrPath(dataRoot,id,assetId),asset=await readJson<{sha256:string}>(filename+'.json');if(await hashFile(filename)!==asset.sha256)throw new ExtractionError(409,'HDR checksum changed. Import it again.');return filename;}
