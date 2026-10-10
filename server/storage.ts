import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicJson(filename: string, value: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    // Windows readers and virus scanners can briefly hold the destination open.
    // Retain atomic replacement: never remove the existing project metadata.
    const retryDelays = [25, 50, 100, 200, 400, 400, 400];
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, filename); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= retryDelays.length) throw error;
        await delay(retryDelays[attempt]);
      }
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await fs.readFile(filename, 'utf8')) as T;
}
