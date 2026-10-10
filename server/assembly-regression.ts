import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
export async function runAvailableAssemblyRegressions(){
  const filename=path.resolve('previews/module-ten-regressions.log'),log=createWriteStream(filename),environment={...process.env};
  // A nested node:test process must start a fresh runner, not inherit the parent worker context.
  delete environment.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','--test','--test-concurrency=1',...['module-one','module-two','module-three','module-four','module-five','module-six','module-seven','integration','zip','assembly-timeline'].map(n=>`tests/${n}.test.ts`)],{windowsHide:true,env:environment,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>log.write(b));child.stderr.on('data',b=>log.write(b));const [code]=await once(child,'close');await new Promise<void>(r=>log.end(r));
  const output=await readFile(filename,'utf8'),tests=Number(output.match(/# tests (\d+)/)?.[1]||0),passed=Number(output.match(/# pass (\d+)/)?.[1]||0),failed=Number(output.match(/# fail (\d+)/)?.[1]||0),skipped=Number(output.match(/# skipped (\d+)/)?.[1]||0);
  const status: 'PASS'|'FAIL'=code===0&&tests>=147&&passed===tests&&failed===0&&skipped===0&&!output.includes('skipping running files')?'PASS':'FAIL';
  return {name:'25. Available Module 1–9 regressions',status,detail:`Executed ${tests} available earlier/ZIP/timing tests: ${passed} pass, ${failed} fail, ${skipped} skipped; exit ${code}. Module 8 pending; no unrun Module 8 check is counted as passed. Evidence: previews/module-ten-regressions.log.`};
}
