import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the project's optional .env file into process.env. Values already present in the real environment win,
 * so a shell variable still overrides the file. Import this module first from every service entry point.
 */
const file = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '.env');
if (existsSync(file)) {
  try { process.loadEnvFile(file); }
  catch (error) { console.warn(`Could not read ${file}: ${(error as Error).message}`); }
}
