import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compactAnimationSettings } from '../../server/animation-checks';
import { defaultAnimationSettings, type AnimationJob, type AnimationSettings } from '../../shared/animation';
import type { FocusState } from '../../shared/focus';
import type { Project } from '../../shared/project';

let id: string;
const step = (page: Page) => page.locator('#camera-animation');
async function open(page: Page) { await page.goto(`/?project=${id}#camera-animation`); await expect(step(page).getByRole('button', { name: 'Render Selected Tile', exact: true })).toBeEnabled(); await step(page).scrollIntoViewIfNeeded(); }
async function setting(request: APIRequestContext, settings: AnimationSettings) { expect((await request.put(`/api/projects/${id}/animation-settings`, { data: settings })).ok()).toBeTruthy(); }
async function timingSaved(page: Page) { await expect(step(page).getByRole('status').filter({ hasText: 'Timing saved locally' })).toBeVisible(); }
test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/upload', { multipart: { image: { name: 'sample-comic.png', mimeType: 'image/png', buffer: await readFile(path.join(process.cwd(), 'tests/fixtures/sample-comic.png')) } } }); expect(r.status()).toBe(201);
  let p = await r.json() as Project; p = (await (await request.put(`/api/projects/${p.id}`, { data: p })).json()).project; id = p.id;
  const e = await (await request.post(`/api/projects/${id}/extract`, { data: { expectedUpdatedAt: p.updatedAt } })).json(); let source: any;
  await expect.poll(async () => { const j = await (await request.get(`/api/projects/${id}/extractions/${e.id}`)).json(); source = j.manifest; return j.status; }).toBe('complete');
  const gridState = await (await request.get(`/api/projects/${id}/layouts`)).json();
  const g = await (await request.post(`/api/projects/${id}/layouts`, { data: { expectedExtractionId: source.extractionId, settings: gridState.settings } })).json();
  await expect.poll(async () => (await (await request.get(`/api/projects/${id}/layouts/${g.id}`)).json()).status, { timeout: 15000 }).toBe('complete');
  const focus = await (await request.get(`/api/projects/${id}/focus`)).json() as FocusState;
  focus.config.views.find(v => v.format === 'desktop' && v.tileNumber === 2)!.cameraMode = 'detail';
  expect((await request.put(`/api/projects/${id}/focus`, { data: { config: focus.config, expectedRevision: focus.config.revision } })).ok()).toBeTruthy();
});
test('Default timing controls, timeline and saved native camera', async ({ page }) => {
  await open(page); await expect(step(page).getByLabel('Zoom-in duration', { exact: true })).toHaveValue('1.2'); await expect(step(page).getByLabel('Initial grid hold', { exact: true })).toHaveValue('1.5'); await expect(step(page).getByLabel('Final grid hold', { exact: true })).toHaveValue('2');
  await expect(step(page).getByText('Native Camera', { exact: true })).toBeVisible(); await expect(step(page).getByLabel('Animation timeline')).toContainText('Zoom Out');
  await expect(step(page).getByRole('button', { name: 'Continue to Frame Handoff' })).toBeDisabled();
  expect((await page.request.get('/api/video-tools')).ok()).toBeTruthy();
});
test('Individual timings persist independently and saved crops stay unchanged', async ({ page }) => {
  await open(page); const before = (await (await page.request.get(`/api/projects/${id}/focus`)).json()).config;
  await step(page).getByLabel('Animation timing mode').selectOption('individual'); await timingSaved(page);
  await step(page).getByLabel('Animation tile').selectOption('2'); await step(page).getByLabel('Zoom-in duration', { exact: true }).fill('0.2'); await timingSaved(page);
  await step(page).getByLabel('Animation tile').selectOption('1'); await expect(step(page).getByLabel('Zoom-in duration', { exact: true })).toHaveValue('1.2');
  await open(page); await step(page).getByLabel('Animation tile').selectOption('2'); await expect(step(page).getByLabel('Zoom-in duration', { exact: true })).toHaveValue('0.2');
  expect((await (await page.request.get(`/api/projects/${id}/focus`)).json()).config).toEqual(before);
});
test('Render selected tile, play actual MP4, download clip and manifest', async ({ page, request }) => {
  test.setTimeout(60000); await setting(request, compactAnimationSettings()); await open(page);
  const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${id}/animations`) && r.request().method() === 'POST');
  await step(page).getByRole('button', { name: 'Render Selected Tile', exact: true }).click(); const j = await (await response).json() as AnimationJob;
  await expect(step(page).getByText('Render complete', { exact: true })).toBeVisible({ timeout: 45000 });
  const finished = await (await request.get(`/api/projects/${id}/animations/${j.id}`)).json() as AnimationJob; expect(finished.manifest!.videos).toHaveLength(3);
  const player = step(page).getByLabel('Rendered camera preview', { exact: true });
  await expect.poll(() => player.evaluate(e => (e as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  expect(await player.evaluate(e => [(e as HTMLVideoElement).videoWidth, (e as HTMLVideoElement).videoHeight])).toEqual([1080, 1920]);
  await player.evaluate(async e => { const v = e as HTMLVideoElement; v.muted = true; await v.play(); }); await expect.poll(() => player.evaluate(e => (e as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  const downloadEvent = page.waitForEvent('download'); await step(page).getByRole('link', { name: 'mobile_zoom_to_tile_01.mp4', exact: true }).first().click(); expect((await downloadEvent).suggestedFilename()).toBe('mobile_zoom_to_tile_01.mp4');
  await step(page).locator('.animation-files summary').click(); const manifestDownload = page.waitForEvent('download'); await step(page).getByRole('link', { name: 'Camera animation manifest JSON', exact: true }).click(); expect((await manifestDownload).suggestedFilename()).toBe('camera_animation_manifest.json');
  const clip = finished.manifest!.videos.find(v => v.kind === 'in')!; const range = await request.get(clip.playbackUrl, { headers: { Range: 'bytes=0-127' } }); expect(range.status()).toBe(206); expect((await range.body()).length).toBe(128);
  await step(page).screenshot({ path: 'previews/module-five-selected-mobile.png' });
});
test('Desktop Detail preview is labelled and contains a real standalone MP4', async ({ page }) => {
  test.setTimeout(60000); await open(page); await step(page).getByLabel('Animation format').selectOption('desktop'); await step(page).getByLabel('Animation tile').selectOption('2');
  await expect(step(page).getByText('Reframed Detail', { exact: true })).toBeVisible(); await expect(step(page).getByRole('status').filter({ hasText: 'controlled dissolve' })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${id}/animations`) && r.request().method() === 'POST'); await step(page).getByRole('button', { name: 'Preview', exact: true }).click(); const j = await (await response).json() as AnimationJob;
  await expect(step(page).getByText('Render complete', { exact: true })).toBeVisible({ timeout: 45000 }); const result = await (await page.request.get(`/api/projects/${id}/animations/${j.id}`)).json() as AnimationJob;
  expect(result.manifest!.videos).toHaveLength(1); expect(result.manifest!.videos[0].cameraMode).toBe('detail');
  const player = step(page).getByLabel('Rendered camera preview', { exact: true }); await expect.poll(() => player.evaluate(e => (e as HTMLVideoElement).videoWidth)).toBe(1920); expect(await player.evaluate(e => (e as HTMLVideoElement).videoHeight)).toBe(1080);
  await step(page).screenshot({ path: 'previews/module-five-detail-desktop.png' });
});
test('Cancel stops rendering, blocks incomplete downloads and allows retry', async ({ page, request }) => {
  test.setTimeout(60000); await setting(request, defaultAnimationSettings()); await open(page);
  const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${id}/animations`) && r.request().method() === 'POST'); await step(page).getByRole('button', { name: 'Render All Tiles', exact: true }).click(); const j = await (await response).json() as AnimationJob;
  await expect(step(page).getByLabel('Zoom-in duration', { exact: true })).toBeDisabled(); await step(page).getByRole('button', { name: 'Cancel Render', exact: true }).click(); await expect(step(page).getByText('Render cancelled', { exact: true })).toBeVisible({ timeout: 20000 });
  expect((await request.get(`/api/projects/${id}/animations/${j.id}/files/mobile_zoom_to_tile_01.mp4`)).status()).toBe(409);
  await expect(step(page).getByRole('button', { name: 'Render Selected Tile', exact: true })).toBeEnabled();
  await setting(request, compactAnimationSettings()); await open(page); await step(page).getByRole('button', { name: 'Render Selected Tile', exact: true }).click(); await expect(step(page).getByText('Render complete', { exact: true })).toBeVisible({ timeout: 45000 });
});
test('Responsive controls and actual test bench outcomes are accessible', async ({ page }) => {
  await open(page); await page.setViewportSize({ width: 390, height: 844 }); await step(page).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await expect(step(page).getByRole('button', { name: 'Render All Tiles', exact: true })).toBeVisible();
  await step(page).screenshot({ path: 'previews/module-five-responsive.png' });
  const report = await (await page.request.get('/api/checks/module5/latest')).json();
  if (report) { await expect(page.getByRole('region', { name: 'Module 5 tests', exact: true }).getByText(`${report.passed}/${report.total} PASS`, { exact: true })).toBeVisible(); }
});
