import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Zip, ZipPassThrough } from 'fflate';
import type { ExportEntry } from '../shared/export.js';

export interface PackageFile { entry: ExportEntry; filename?: string; bytes?: Uint8Array }
export function safeZipPath(name: string) {
  if (!name || name.length > 500 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe ZIP path: ${name}`);
  return name;
}
export async function hashFile(filename: string, signal?: AbortSignal) { const h = createHash('sha256'); for await (const chunk of createReadStream(filename, { highWaterMark: 65536, signal })) h.update(chunk); return h.digest('hex'); }
export async function verifyStoredZip(filename: string, entries: ExportEntry[], signal?: AbortSignal) {
  const expected = new Map(entries.map(e => [safeZipPath('six_tile_lesson_export/' + e.path), e])), found = new Set<string>(), handle = await open(filename, 'r');
  const table = Array.from({ length: 256 }, (_, i) => { let n = i; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  async function readAt(position: number, length: number) { const bytes = Buffer.alloc(length); let offset = 0; while (offset < length) { const r = await handle.read(bytes, offset, length - offset, position + offset); if (!r.bytesRead) throw new Error('Truncated ZIP.'); offset += r.bytesRead; } return bytes; }
  try {
    const size = (await handle.stat()).size, tailSize = Math.min(size, 65557), tail = await readAt(size - tailSize, tailSize); let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw new Error('Invalid or multi-disk ZIP.');
    const count = tail.readUInt16LE(end + 10), directorySize = tail.readUInt32LE(end + 12), directoryStart = tail.readUInt32LE(end + 16);
    if (count !== expected.size || directorySize > 16 * 1024 * 1024 || directoryStart + directorySize !== size - tailSize + end) throw new Error('ZIP central directory is incomplete.');
    const central = await readAt(directoryStart, directorySize); let position = 0;
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted(); if (position + 46 > central.length || central.readUInt32LE(position) !== 0x02014b50 || central.readUInt16LE(position + 10) !== 0) throw new Error('Invalid stored ZIP entry.');
      const crcExpected = central.readUInt32LE(position + 16), compressed = central.readUInt32LE(position + 20), unpacked = central.readUInt32LE(position + 24), nameLength = central.readUInt16LE(position + 28), extra = central.readUInt16LE(position + 30), comment = central.readUInt16LE(position + 32), localOffset = central.readUInt32LE(position + 42);
      const name = central.subarray(position + 46, position + 46 + nameLength).toString('utf8'), e = expected.get(safeZipPath(name)); if (!e || found.has(name) || compressed !== unpacked || unpacked !== e.size) throw new Error(`Unexpected, duplicate or incorrectly sized ZIP entry: ${name}`); found.add(name);
      const local = await readAt(localOffset, 30); if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== 0) throw new Error('Invalid ZIP local header.');
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28); if (dataStart + compressed > directoryStart) throw new Error('ZIP entry escapes payload area.');
      const h = createHash('sha256'); let crc = 0xffffffff, bytes = 0;
      if (compressed) for await (const chunk of createReadStream(filename, { start: dataStart, end: dataStart + compressed - 1, highWaterMark: 65536, signal })) { h.update(chunk); bytes += chunk.length; for (const b of chunk) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); }
      if (bytes !== e.size || h.digest('hex') !== e.sha256 || ((crc ^ 0xffffffff) >>> 0) !== crcExpected) throw new Error(`ZIP checksum mismatch: ${name}`);
      position += 46 + nameLength + extra + comment;
    }
    if (position !== central.length) throw new Error('Unexpected ZIP directory data.'); return found.size;
  } finally { await handle.close(); }
}
export async function writeVerifiedZip(filename: string, files: PackageFile[], signal: AbortSignal, progress: (n: number) => void) {
  const names = new Set<string>(); let total = 0;
  for (const f of files) { const name = safeZipPath(f.entry.path).toLowerCase(); if (names.has(name)) throw new Error(`Duplicate ZIP path: ${name}`); names.add(name); total += f.entry.size; }
  if (total > 0xffff0000 || files.some(f => f.entry.size > 0xffff0000)) throw new Error('This ZIP exceeds the supported 4 GB limit. Export each format separately.');
  const temporary = filename + '.partial'; const output = await open(temporary, 'wx'); let writing = Promise.resolve(); let failure: Error | undefined; let bytes = 0, maxChunk = 0; const archiveHash = createHash('sha256');
  const zip = new Zip((error, chunk) => { if (error) { failure = error; return; } const copy = Buffer.from(chunk); archiveHash.update(copy); bytes += copy.length; writing = writing.then(async () => { let offset = 0; while (offset < copy.length) { const result = await output.write(copy, offset, copy.length - offset); if (!result.bytesWritten) throw new Error('ZIP write made no progress.'); offset += result.bytesWritten; } }); });
  try {
    for (const [i, f] of files.entries()) {
      signal.throwIfAborted(); const member = new ZipPassThrough('six_tile_lesson_export/' + f.entry.path); zip.add(member); await writing; const h = createHash('sha256'); let size = 0;
      function* bufferChunks(bytes:Uint8Array){for(let start=0;start<bytes.byteLength;start+=65536)yield bytes.subarray(start,Math.min(start+65536,bytes.byteLength));}
      const chunks = f.filename ? createReadStream(f.filename, { highWaterMark: 65536, signal }) : bufferChunks(f.bytes!);
      for await (const chunk of chunks) { signal.throwIfAborted(); maxChunk = Math.max(maxChunk, chunk.byteLength); h.update(chunk); size += chunk.byteLength; member.push(new Uint8Array(chunk)); await writing; if (failure) throw failure; }
      member.push(new Uint8Array(), true); await writing; if (size !== f.entry.size || h.digest('hex') !== f.entry.sha256) throw new Error(`Asset changed while packaging: ${f.entry.path}`); progress((i + 1) / files.length);
    }
    zip.end(); await writing; if (failure) throw failure; signal.throwIfAborted(); await output.sync(); await output.close();
    const count = await verifyStoredZip(temporary, files.map(f => f.entry), signal); signal.throwIfAborted(); await rename(temporary, filename);
    return { archiveSha256: archiveHash.digest('hex'), archiveBytes: bytes, fileCount: count, maximumInputChunkBytes: maxChunk };
  } catch (e) { zip.terminate(); await writing.catch(() => {}); await output.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw e; }
}
