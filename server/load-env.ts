import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

/**
 * Loads the project's optional .env file into process.env. A real environment variable normally wins over the file, so a
 * shell can still override it. The exception is a leftover placeholder (empty, "sk-...", "<your key>", or far too short to
 * be a real secret): that is replaced by the value in .env instead of silently shadowing it.
 */
export const looksLikePlaceholder = (value: string | undefined) => !value || value.trim().length < 20 || /\.\.\.|[<>]|your[-_ ]?(api[-_ ]?)?key/i.test(value);

export function loadLocalEnv(file = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '.env'), env: NodeJS.ProcessEnv = process.env) {
  if (!existsSync(file)) return { loaded: 0, replacedPlaceholders: [] as string[] };
  const replacedPlaceholders: string[] = []; let loaded = 0;
  try {
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (!value) continue;
      const existing = env[key];
      if (existing === undefined) { env[key] = value; loaded++; }
      else if (/_API_KEY$|_TOKEN$|_SECRET$/.test(key) && looksLikePlaceholder(existing) && !looksLikePlaceholder(value)) { env[key] = value; replacedPlaceholders.push(key); loaded++; }
    }
  } catch (error) { console.warn(`Could not read ${file}: ${(error as Error).message}`); }
  if (replacedPlaceholders.length) console.warn(`Ignored a placeholder value of ${replacedPlaceholders.join(', ')} in the environment and used the one in .env.`);
  return { loaded, replacedPlaceholders };
}

loadLocalEnv();
