import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { prepareCameraProject, extractTestFrames } from '../../server/frame-checks';
import type { FrameState } from '../../shared/frames';
let id: string;
const step = (page: Page) => page.locator('#gemini-first-frames');
async function open(page: Page) { await page.goto(`/?project=${id}#gemini-first-frames`); await expect(step(page).getByRole('button', { name: 'Extract All Frames', exact: true })).toBeEnabled(); await step(page).scrollIntoViewIfNeeded(); }
async function state(page: Page) { return await (await page.request.get(`/api/projects/${id}/frames`)).json() as FrameState; }
async function complete(page: Page) { await expect(step(page).getByText('Frame processing complete', { exact: true })).toBeVisible({ timeout: 90000 }); }
test.beforeAll(async () => { test.setTimeout(180000); const prepared = await prepareCameraProject('http://127.0.0.1:5173', path.join(process.cwd(), 'tests/fixtures')); id = prepared.project.id; await extractTestFrames('http://127.0.0.1:5173', id, prepared.animation.renderId); });
test('Extract all authoritative PNGs and display actual equality results', async ({ page }) => {
  test.setTimeout(120000); await open(page); await step(page).getByRole('button', { name: 'Extract All Frames', exact: true }).click(); await complete(page);
  await expect(step(page).getByText('12/12 PNGs verified', { exact: true })).toBeVisible();
  const report = (await state(page)).report!; expect(report.frames).toHaveLength(12); expect(report.frames.every(f => f.pixelDifference.differingPixels === 0 && f.pngRgbSha256 === f.videoRgbSha256)).toBeTruthy();
  await expect(step(page).locator('.frame-validation>div').first().getByText('PASS', { exact: true })).toBeVisible();
  const image = step(page).getByAltText('mobile tile 1 authoritative last decoded frame'); await expect.poll(() => image.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(1080);
  await step(page).screenshot({ path: 'previews/module-six-mobile-frames.png' });
});
test('Independent Verify All launches new decodes and retains exact hashes', async ({ page }) => {
  test.setTimeout(120000); await open(page); const before = (await state(page)).report!;
  await step(page).getByRole('button', { name: 'Verify All', exact: true }).click(); await complete(page); const after = (await state(page)).report!;
  for (let i = 0; i < 12; i++) { expect(after.frames[i].verificationDecodeId).not.toBe(before.frames[i].verificationDecodeId); expect(after.frames[i].pngRgbSha256).toBe(before.frames[i].pngRgbSha256); expect(after.frames[i].exactDecodedPixelMatch).toBe('PASS'); }
});
test('Desktop preview, PNG and twelve-frame ZIP downloads', async ({ page }) => {
  await open(page); await step(page).getByLabel('First-frame format').selectOption('desktop'); await step(page).getByLabel('First-frame tile').selectOption('3');
  const image = step(page).getByAltText('desktop tile 3 authoritative last decoded frame'); await expect.poll(() => image.evaluate(e => (e as HTMLImageElement).naturalWidth)).toBe(1920);
  await expect(step(page).locator('.frame-validation')).toContainText('1920 × 1080');
  const event = page.waitForEvent('download'); await step(page).getByRole('link', { name: 'Download Selected PNG', exact: true }).click(); const d = await event; expect(d.suggestedFilename()).toBe('desktop_tile_03_gemini_first_frame.png');
  const all = (await state(page)).report!; const r = await page.request.get(all.allFramesDownloadUrl); expect(r.ok()).toBeTruthy(); expect(Object.keys(unzipSync(new Uint8Array(await r.body())))).toHaveLength(12);
  await step(page).screenshot({ path: 'previews/module-six-desktop-frames.png' });
});
test('Optional bridge renders playable nine-frame MP4 without changing PNG', async ({ page }) => {
  test.setTimeout(60000); await open(page); const before = (await state(page)).report!.frames[0].pngFileSha256;
  await step(page).getByRole('button', { name: 'Generate Bridge', exact: true }).click(); await complete(page);
  const report = (await state(page)).report!; expect(report.bridges[0].frameCount).toBe(9); expect(report.frames[0].pngFileSha256).toBe(before);
  const video = step(page).getByLabel('Optional still bridge preview'); await expect.poll(() => video.evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(1080);
});
test('Changed PNG fails visibly and only selected tile is regenerated', async ({ page }) => {
  test.setTimeout(120000); await open(page); const before = (await state(page)).report!, f = before.frames[0];
  const png = path.resolve(before.outputDirectory, f.relativePath), raw = await sharp(await readFile(png)).removeAlpha().raw().toBuffer({ resolveWithObject: true }); raw.data[0] = (raw.data[0] + 1) % 256;
  await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 3 } }).png().toFile(png);
  await step(page).getByRole('button', { name: 'Verify All', exact: true }).click(); await expect(step(page).getByText('Frame verification failed', { exact: true })).toBeVisible({ timeout: 90000 });
  await expect(step(page).getByRole('button', { name: 'Download Selected PNG', exact: true })).toBeDisabled(); await expect(step(page).locator('.frame-validation>div').first().getByText('FAIL', { exact: true })).toBeVisible();
  await step(page).getByRole('button', { name: 'Regenerate Selected Tile', exact: true }).click(); await complete(page);
  const after = (await state(page)).report!; expect(after.frames[0].readyForGemini).toBeTruthy(); expect(after.frames[1].pngFileSha256).toBe(before.frames[1].pngFileSha256);
});
test('Cancel verification, preserve completed frames and use responsive controls', async ({ page }) => {
  test.setTimeout(45000); await open(page); await step(page).getByRole('button', { name: 'Verify All', exact: true }).click(); await step(page).getByRole('button', { name: 'Cancel Frame Processing', exact: true }).click();
  await expect(step(page).getByText('Frame processing cancelled', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(step(page).getByRole('link', { name: 'Download Selected PNG', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391); await step(page).screenshot({ path: 'previews/module-six-responsive.png' });
});
