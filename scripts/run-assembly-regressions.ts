import path from 'node:path';
import { readJson,atomicJson } from '../server/storage.js';
import { runAvailableAssemblyRegressions } from '../server/assembly-regression.js';
const result=await runAvailableAssemblyRegressions(), filename=path.resolve('previews/module-ten-report.json'), report=await readJson<{results:{name:string;status:string;detail:string}[];[key:string]:unknown}>(filename);
report.results=report.results.filter(r=>!r.name.startsWith('25.')).concat(result);Object.assign(report,{timestamp:new Date().toISOString(),passed:report.results.filter(r=>r.status==='PASS').length,failed:report.results.filter(r=>r.status==='FAIL').length,skipped:report.results.filter(r=>r.status==='SKIPPED').length});await atomicJson(filename,report);console.log(result);if(result.status!=='PASS')process.exitCode=1;
