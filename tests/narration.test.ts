import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createNarrationService } from '../server/narration.js';
import { defaultNarrationScript, validateNarrationScript } from '../shared/narration.js';
import type { ImportedMedia } from '../shared/assembly.js';

const project = '22222222-2222-4222-8222-222222222222';
const fakeMedia = (tile: number, name: string): ImportedMedia => ({ version: 1, id: `m${tile}`, projectId: project, tileNumber: tile, kind: 'audio', filename: name, relativePath: '', sha256: '', bytes: 1, importedAt: '', codec: 'pcm_s16le', duration: 4, audioStreams: 1, downloadUrl: '', playbackUrl: '' });

test('default narration script validates; bad input is rejected', () => {
  const s = defaultNarrationScript(project);
  assert.deepEqual(validateNarrationScript(s), []);
  assert.ok(validateNarrationScript({ ...s, voice: 'nobody' as never }).length);
  assert.ok(validateNarrationScript({ ...s, tiles: s.tiles.slice(1) }).length);
  assert.ok(validateNarrationScript({ ...s, tiles: s.tiles.map((t, i) => i ? t : { ...t, text: ' ' }) }).length);
});
test('generation requires a saved script and a configured key, and never leaks the key', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'narration-'));
  try {
    const calls: { url: string; init: RequestInit }[] = [];
    const imported: { tile: number; name: string; bytes: number }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(Buffer.from('RIFFfake'), { status: 200 }); }) as unknown as typeof fetch;
    const importAudio = async (_id: string, tile: number, temporary: string, name: string) => { imported.push({ tile, name, bytes: (await readFile(temporary)).length }); return fakeMedia(tile, name); };
    const noKey = createNarrationService(root, { importAudio, fetchImpl, env: {} });
    assert.equal((await noKey.current(project)).keyConfigured, false);
    await assert.rejects(noKey.generate(project, [1]), /Save the narration script/);
    await noKey.save(project, defaultNarrationScript(project));
    await assert.rejects(noKey.generate(project, [1]), /OPENAI_API_KEY/);
    assert.equal(calls.length, 0);

    const service = createNarrationService(root, { importAudio, fetchImpl, env: { OPENAI_API_KEY: 'sk-test-secret' } });
    assert.equal((await service.current(project)).keyConfigured, true);
    assert.ok(!JSON.stringify(await service.current(project)).includes('sk-test-secret'));
    const done = await service.generate(project, [2, 5]);
    assert.deepEqual(done.map(d => d.tileNumber), [2, 5]);
    assert.equal(calls.length, 2);
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(body.response_format, 'wav'); assert.ok(body.input.includes('window')); assert.ok(body.instructions);
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer sk-test-secret');
    assert.deepEqual(imported.map(i => i.name), ['tile_02_openai_ash.wav', 'tile_05_openai_ash.wav']);
    await assert.rejects(service.generate(project, [7]), /unique tiles/);
    await assert.rejects(service.generate(project, [1, 1]), /unique tiles/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('service errors are reported without exposing the key', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'narration-'));
  try {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-test-secret.' } }), { status: 401 })) as unknown as typeof fetch;
    const service = createNarrationService(root, { importAudio: async () => { throw new Error('should not import'); }, fetchImpl, env: { OPENAI_API_KEY: 'sk-test-secret' } });
    await service.save(project, defaultNarrationScript(project));
    await assert.rejects(service.generate(project, [1]), (e: Error) => /401/.test(e.message) && !e.message.includes('sk-test-secret'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
