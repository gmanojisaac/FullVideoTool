import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createNarrationService, createVoiceRotation } from '../server/narration.js';
import { defaultNarrationScript, deliveryInstructions, positionHint, validateNarrationScript, voiceProfiles, voiceRotation, type NarrationScript } from '../shared/narration.js';
import type { ImportedMedia } from '../shared/assembly.js';

const project = '22222222-2222-4222-8222-222222222222';
const fakeMedia = (tile: number, name: string): ImportedMedia => ({ version: 1, id: `m${tile}`, projectId: project, tileNumber: tile, kind: 'audio', filename: name, relativePath: '', sha256: '', bytes: 1, importedAt: '', codec: 'pcm_s16le', duration: 4, audioStreams: 1, downloadUrl: '', playbackUrl: '' });
const harness = (root: string, env: Record<string, string | undefined>) => {
  const calls: { body: Record<string, unknown>; auth: string }[] = [], imported: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => { calls.push({ body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization }); return new Response(Buffer.from('RIFFfake'), { status: 200 }); }) as unknown as typeof fetch;
  const importAudio = async (_id: string, tile: number, _tmp: string, name: string) => { imported.push(name); return fakeMedia(tile, name); };
  return { calls, imported, service: createNarrationService(root, { importAudio, fetchImpl, env }) };
};

test('default script rotates voices and validates; bad input is rejected', () => {
  const s = defaultNarrationScript(project);
  assert.equal(s.voice, 'auto'); assert.deepEqual(validateNarrationScript(s), []);
  assert.ok(validateNarrationScript({ ...s, voice: 'nobody' as never }).length);
  assert.ok(validateNarrationScript({ ...s, assignedVoice: 'onyx' as never }).length, 'assigned voice must come from the pool');
  assert.ok(validateNarrationScript({ ...s, tiles: s.tiles.slice(1) }).length);
});
test('delivery instructions combine pool voice, author style, natural prosody and position in the lesson', () => {
  const first = deliveryInstructions('coral', 'Warm Indian English narrator.', 0), last = deliveryInstructions('sage', 'Warm Indian English narrator.', 5);
  assert.ok(first.includes('Warm Indian English narrator.') && first.includes(voiceProfiles.coral) && first.includes('never monotone') && first.includes(positionHint(0, 6)));
  assert.ok(last.includes(voiceProfiles.sage) && last.includes('final sentence') && !last.includes(voiceProfiles.coral));
  assert.notEqual(deliveryInstructions('nova', 'x', 1), deliveryInstructions('nova', 'x', 2) + 'z');
  assert.equal(new Set(voiceRotation.map(v => voiceProfiles[v])).size, 4, 'the four voices have distinct characters');
});
test('rotation goes round the four voices, one per video, and only advances on success', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rotation-'));
  try {
    const rotation = createVoiceRotation(root), seen: string[] = [];
    assert.equal(await rotation.peek(), 'coral');
    for (let i = 0; i < 6; i++) { const v = await rotation.peek(); assert.equal(await rotation.peek(), v, 'peek does not advance'); seen.push(v); await rotation.commit(v, `p${i}`); }
    assert.deepEqual(seen, ['coral', 'nova', 'shimmer', 'sage', 'coral', 'nova']);
    assert.equal(await createVoiceRotation(root).peek(), 'shimmer', 'position survives a restart');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('each full generation uses the next voice; re-takes keep the video voice; failures do not burn a turn', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'narration-'));
  try {
    const { service, calls, imported } = harness(root, { OPENAI_API_KEY: 'sk-test-secret' });
    await service.save(project, defaultNarrationScript(project));
    const voices: string[] = [];
    for (let video = 0; video < 5; video++) { const before = calls.length; await service.generate(project, [1, 2, 3, 4, 5, 6]); voices.push(String(calls[before].body.voice)); assert.ok(calls.slice(before).every(c => c.body.voice === calls[before].body.voice), 'one voice for the whole video'); }
    assert.deepEqual(voices, ['coral', 'nova', 'shimmer', 'sage', 'coral']);
    // A re-take of one tile keeps the voice the project was assigned (coral), without taking a turn.
    const before = calls.length; await service.generate(project, [3]);
    assert.equal(calls[before].body.voice, 'coral'); assert.equal(await createVoiceRotation(root).peek(), 'nova');
    assert.ok(imported.at(-1)!.endsWith('_openai_coral.wav'));
    // Position-aware delivery reached the API for each tile, never containing the key.
    const first = calls[0].body.instructions as string, last = calls[5].body.instructions as string;
    assert.ok(first.includes('Open gently') && last.includes('final sentence') && !JSON.stringify(calls).includes('"sk-test-secret"'));
    assert.equal(calls[0].body.model, 'gpt-4o-mini-tts'); assert.equal(calls[0].body.response_format, 'wav'); assert.equal(calls[0].auth, 'Bearer sk-test-secret');

    // A failed attempt must not advance the rotation.
    const failing = createNarrationService(root, { importAudio: async () => { throw new Error('nope'); }, fetchImpl: (async () => new Response('{"error":{"message":"bad"}}', { status: 500 })) as unknown as typeof fetch, env: { OPENAI_API_KEY: 'sk-test-secret' } });
    await assert.rejects(failing.generate(project, [1, 2, 3, 4, 5, 6]));
    assert.equal(await createVoiceRotation(root).peek(), 'nova');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('a fixed voice is honoured and never touches the rotation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'narration-'));
  try {
    const { service, calls } = harness(root, { OPENAI_API_KEY: 'sk-test-secret' });
    const script: NarrationScript = { ...defaultNarrationScript(project), voice: 'onyx' };
    await service.save(project, script); await service.generate(project, [1, 2, 3, 4, 5, 6]);
    assert.ok(calls.every(c => c.body.voice === 'onyx')); assert.equal(await createVoiceRotation(root).peek(), 'coral');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('generation requires a saved script and a configured key, and never leaks the key', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'narration-'));
  try {
    const noKey = harness(root, {});
    assert.equal((await noKey.service.current(project)).keyConfigured, false);
    await assert.rejects(noKey.service.generate(project, [1]), /Save the narration script/);
    await noKey.service.save(project, defaultNarrationScript(project));
    await assert.rejects(noKey.service.generate(project, [1]), /OPENAI_API_KEY/);
    assert.equal(noKey.calls.length, 0);
    const keyed = harness(root, { OPENAI_API_KEY: 'sk-test-secret' });
    assert.ok(!JSON.stringify(await keyed.service.current(project)).includes('sk-test-secret'));
    await assert.rejects(keyed.service.generate(project, [7]), /unique tiles/);
    await assert.rejects(keyed.service.generate(project, [1, 1]), /unique tiles/);
    const state = JSON.parse(await readFile(path.join(root, 'exports', project, 'metadata', 'narration_script.json'), 'utf8'));
    assert.equal(state.voice, 'auto');
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

test('loudness normalisation applies one constant gain and lands on the target', async t => {
  const { detectVideoTools } = await import('../server/video-tools.js'), { normalizeLoudness, targetLufs } = await import('../server/narration.js');
  const tools = await detectVideoTools(); if (!tools.available || !tools.ffmpeg) return t.skip('FFmpeg is not installed.');
  const { spawnSync } = await import('node:child_process');
  // A quiet, amplitude-modulated tone stands in for speech (about -30 LUFS), so there is real level variation to preserve.
  const made = spawnSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=24000:duration=6', '-af', 'tremolo=f=3:d=0.7,volume=0.6', '-c:a', 'pcm_s16le', '-f', 'wav', '-'], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(made.status, 0);
  const result = normalizeLoudness(made.stdout, tools.ffmpeg);
  assert.ok(result.beforeLufs < -24, `fixture should be quiet, was ${result.beforeLufs}`);
  const measure = (wav: Buffer) => { const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-nostats', '-i', 'pipe:0', '-af', 'ebur128', '-f', 'null', '-'], { input: wav, encoding: 'utf8' }).stderr; return Number(r.slice(r.lastIndexOf('Summary')).match(/I:\s+(-?[0-9.]+) LUFS/)![1]); };
  assert.ok(Math.abs(measure(result.audio) - targetLufs) < 0.8, `after: ${measure(result.audio)} LUFS`);
  assert.ok(Math.abs(result.gainDb - (targetLufs - result.beforeLufs)) < 0.01, 'gain equals target minus measured');
  // Constant gain: the ratio between loud and quiet moments is unchanged (modulation preserved), within a small tolerance.
  const peaks = (wav: Buffer) => { const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-nostats', '-i', 'pipe:0', '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'], { input: wav, encoding: 'utf8' }).stderr; return Number((r.match(/Peak level dB:\s+(-?[0-9.]+)/g) || []).pop()!.match(/(-?[0-9.]+)$/)![1]); };
  assert.ok(Math.abs((peaks(result.audio) - peaks(made.stdout)) - result.gainDb) < 1.0, 'peaks moved by the same gain');
});
