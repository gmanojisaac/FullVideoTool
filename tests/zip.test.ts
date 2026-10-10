import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { withTestServer } from '../server/checks.js';
import { bufferFile } from '../server/export-validation.js';
import { writeVerifiedZip, verifyStoredZip } from '../server/export-zip.js';

test('ZIP verification treats embedded ZIP signatures as binary payload, across multiple chunks', async () => {
  await withTestServer(async (_base, directory) => {
    const bytes = new Uint8Array(1024 * 1024 + 29); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + (i >>> 16)) & 255;
    for (const start of [21, 65534, 104238, 310000]) bytes.set([80,75,3,4,80,75,7,8,80,75,5,6], start);
    const file = bufferFile('video/binary.mp4', bytes), archive = path.join(directory, 'verified.zip'); await writeVerifiedZip(archive, [file], new AbortController().signal, () => {});
    assert.equal(await verifyStoredZip(archive, [file.entry]), 1); const reopened = unzipSync(new Uint8Array(await readFile(archive))); assert.deepEqual(reopened['six_tile_lesson_export/video/binary.mp4'], bytes);
  });
});
test('Cancelled ZIP leaves no partial archive or published download', async () => {
  await withTestServer(async (_base, directory) => { const controller = new AbortController(), file = bufferFile('file.bin', new Uint8Array(2 * 1024 * 1024)), archive = path.join(directory, 'cancelled.zip'); await assert.rejects(writeVerifiedZip(archive, [file], controller.signal, () => controller.abort())); await assert.rejects(stat(archive)); await assert.rejects(stat(archive + '.partial')); });
});
