import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { atomicJson } from '../server/storage.js';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : existsSync(edge) ? edge : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173/?project=03080222-5f86-4423-a624-07ae2ec0698f#assemble-lesson');
  const stage = page.locator('#assemble-lesson');
  const navigate = page.getByRole('navigation', { name: 'Lesson workflow' }).getByRole('button', { name: /Assemble/ });
  await expect(navigate).toBeEnabled(); await navigate.click();
  await expect(stage.getByText('Lesson processing complete', { exact: true })).toBeVisible();
  await expect(stage.locator('.assembly-outputs article')).toHaveCount(2);
  const players = [];
  for (const [filename, width, height] of [['lesson_mobile_9x16.mp4', 1080, 1920], ['lesson_desktop_16x9.mp4', 1920, 1080]] as const) {
    const video = stage.getByLabel(filename, { exact: true });
    await expect.poll(() => video.evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(width);
    const actual = await video.evaluate(async element => {
      const player = element as HTMLVideoElement;
      await new Promise<void>((resolve, reject) => { player.addEventListener('seeked', () => resolve(), { once: true }); player.addEventListener('error', () => reject(new Error('Video decode failed')), { once: true }); player.currentTime = 6; });
      player.pause();
      return { width: player.videoWidth, height: player.videoHeight, duration: player.duration, displayedTime: player.currentTime, error: player.error?.message };
    });
    assert.equal(actual.height, height); assert.equal(actual.duration, 36.6); assert.equal(actual.error, undefined);
    players.push({ filename, ...actual });
  }
  await stage.locator('.assembly-outputs').screenshot({ path: 'previews/module-ten-sample-output.png' });
  await stage.locator('.stage-heading').screenshot({ path: 'previews/module-ten-assembly-header.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollWidth <= 391); assert.deepEqual(errors, []);
  await stage.locator('.assembly-outputs').screenshot({ path: 'previews/module-ten-sample-narrow.png' });
  await atomicJson('previews/module-ten-sample-browser.json', { timestamp: new Date().toISOString(), status: 'PASS', players, browserErrors: errors, narrowViewport: { width: 390, scrollWidth }, screenshot: 'previews/module-ten-sample-output.png' });
  console.log(JSON.stringify({ status: 'PASS', players, scrollWidth, errors }, null, 2));
} finally { await browser.close(); }
