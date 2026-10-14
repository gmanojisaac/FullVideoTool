import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { assemblePrompt, defaultPromptSet, maxMotionLength, promptGuardrails, promptsText, validatePromptSet } from '../shared/prompts.js';
import { createPromptService } from '../server/prompts.js';

const project = '11111111-1111-4111-8111-111111111111';

test('default prompt set is valid and covers six tiles', () => {
  const set = defaultPromptSet(project);
  assert.equal(set.tiles.length, 6);
  assert.deepEqual(validatePromptSet(set), []);
});
test('validation rejects empty, oversized and duplicate tiles', () => {
  const set = defaultPromptSet(project);
  assert.ok(validatePromptSet({ ...set, tiles: set.tiles.map((t, i) => i ? t : { ...t, motion: '  ' }) }).length);
  assert.ok(validatePromptSet({ ...set, tiles: set.tiles.map((t, i) => i ? t : { ...t, motion: 'x'.repeat(maxMotionLength + 1) }) }).length);
  assert.ok(validatePromptSet({ ...set, tiles: set.tiles.map((t, i) => i ? t : { ...t, tileNumber: 2 }) }).length);
  assert.ok(validatePromptSet({ ...set, tiles: set.tiles.slice(1) }).length);
});
test('assembled prompt always carries the fixed guardrails, in tile order', () => {
  assert.ok(assemblePrompt('  Blinks slowly. ').endsWith(promptGuardrails));
  const set = defaultPromptSet(project), reversed = { ...set, tiles: [...set.tiles].reverse() };
  const text = promptsText(reversed, 'Lesson');
  assert.ok(text.indexOf('--- Tile 01 ---') < text.indexOf('--- Tile 06 ---'));
});
test('prompt service persists atomically and reports unsaved defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'prompts-'));
  try {
    const service = createPromptService(root);
    assert.equal((await service.current(project)).saved, false);
    assert.equal(await service.exportText(project, 'Lesson'), undefined);
    const set = defaultPromptSet(project); set.tiles[0].motion = '  A slow blink.  ';
    const saved = await service.save(project, set);
    assert.equal(saved.tiles[0].motion, 'A slow blink.');
    assert.equal((await service.current(project)).saved, true);
    assert.match((await service.exportText(project, 'Lesson'))!, /A slow blink\./);
    await assert.rejects(service.save(project, { ...set, tiles: [] }));
    await assert.rejects(service.current('../escape'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
