import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Project } from '../../shared/project';
import type { FocusConfig, FocusJob, FocusState } from '../../shared/focus';

let projectId: string;
async function setup(request: APIRequestContext) {
  const uploaded = await request.post('/api/upload', { multipart: { image: { name: 'sample-comic.png', mimeType: 'image/png', buffer: await readFile(path.join(process.cwd(), 'tests/fixtures/sample-comic.png')) } } });
  expect(uploaded.status()).toBe(201);
  let project = await uploaded.json() as Project;
  const saved = await request.put(`/api/projects/${project.id}`, { data: project }); expect(saved.ok()).toBeTruthy(); project = (await saved.json()).project;
  projectId = project.id;
  const extracted = await request.post(`/api/projects/${projectId}/extract`, { data: { expectedUpdatedAt: project.updatedAt } }); expect(extracted.status()).toBe(202);
  const e = await extracted.json(); let source: any;
  await expect.poll(async () => { const r = await request.get(`/api/projects/${projectId}/extractions/${e.id}`); const j = await r.json(); source = j.manifest; return j.status; }).toBe('complete');
  const state = await (await request.get(`/api/projects/${projectId}/layouts`)).json();
  const generated = await request.post(`/api/projects/${projectId}/layouts`, { data: { expectedExtractionId: source.extractionId, settings: state.settings } }); expect(generated.status()).toBe(202);
  const g = await generated.json();
  await expect.poll(async () => (await (await request.get(`/api/projects/${projectId}/layouts/${g.id}`)).json()).status, { timeout: 15000 }).toBe('complete');
}
const step = (page: Page) => page.locator('#camera-focus');
async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('Reopen a local project', { exact: true }).selectOption(projectId);
  await expect(step(page).getByLabel('Camera mode', { exact: true })).toBeVisible();
  await step(page).scrollIntoViewIfNeeded();
}
async function state(page: Page) { return await (await page.request.get(`/api/projects/${projectId}/focus`)).json() as FocusState; }
async function saved(page: Page) { await expect(step(page).getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible(); }
async function range(page: Page, label: string, value: string) {
  await step(page).getByLabel(label, { exact: true }).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, next); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
test.beforeAll(async ({ request }) => { await setup(request); });

test('Load twelve independent views, real grids and labelled centre fallback', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?project=${projectId}#camera-focus`);
  await expect(step(page).getByLabel('Camera mode', { exact: true })).toBeVisible();
  await expect(step(page).getByRole('button', { name: /^Focus tile / })).toHaveCount(6);
  const current = await state(page); expect(current.config.views).toHaveLength(12);
  await expect(step(page).getByText('Unverified centre suggestion.', { exact: true })).toBeVisible();
  await expect(step(page).getByRole('status').filter({ hasText: 'Reframed Detail.' })).toHaveCount(0);
  const image = step(page).locator('.focus-canvas image'); expect(await image.getAttribute('href')).toContain('/layouts/');
  const v = current.config.views.find(v => v.format === 'mobile' && v.tileNumber === 1)!;
  expect(Number(await step(page).locator('.focus-canvas').getAttribute('data-scale'))).toBe(v.transform.scale);
  await expect(step(page).getByRole('button', { name: 'Continue to Camera Animation' })).toBeDisabled(); expect(errors).toEqual([]);
});
test('Drag, wheel, keyboard, explicit approval and automatic/manual priority', async ({ page }) => {
  await open(page); await step(page).getByRole('button', { name: 'Focus tile 4', exact: true }).click();
  const before = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!;
  const canvas = step(page).locator('.focus-canvas'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .5 + 28, box.y + box.height * .5 + 22, { steps: 5 }); await page.mouse.up(); await saved(page);
  const moved = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!; expect(moved.native.center).not.toEqual(before.native.center);
  await canvas.hover(); await page.mouse.wheel(0, -180); await saved(page);
  const zoomed = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!; expect(zoomed.native.zoom).toBeGreaterThan(moved.native.zoom);
  await canvas.focus(); await page.keyboard.press('ArrowRight'); await saved(page);
  const keyed = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!; expect(keyed.native.center.x).toBeGreaterThan(zoomed.native.center.x);
  await step(page).getByRole('button', { name: 'Save current framing', exact: true }).click(); await saved(page);
  const approved = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!; expect(approved.approved).toBe(true);
  await step(page).getByRole('button', { name: 'Auto Focus', exact: true }).click(); await expect(step(page).getByText(/Manual framing retained/)).toBeVisible();
  expect((await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 4)!.native).toEqual(approved.native);
});
test('Separate detail framing, undo/redo, tile switching and reload persistence', async ({ page }) => {
  await open(page); await step(page).locator('.focus-selection').getByRole('button', { name: 'Desktop', exact: true }).click();
  await step(page).getByRole('button', { name: 'Focus tile 2', exact: true }).click();
  const mobileBefore = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 2)!;
  await step(page).getByLabel('Camera mode', { exact: true }).selectOption('detail');
  await expect(step(page).getByRole('status').filter({ hasText: 'Reframed Detail.' })).toBeVisible();
  await expect(step(page).locator('.focus-canvas image')).toHaveAttribute('href', /\/extractions\/.*tile_02\.png/);
  await range(page, 'Focus zoom', '1.6'); await saved(page);
  await step(page).getByRole('button', { name: 'Undo', exact: true }).click(); await expect(step(page).getByLabel('Focus zoom', { exact: true })).toHaveValue('1');
  await step(page).getByRole('button', { name: 'Redo', exact: true }).click(); await expect(step(page).getByLabel('Focus zoom', { exact: true })).toHaveValue('1.6'); await saved(page);
  expect((await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 2)).toEqual(mobileBefore);
  await step(page).getByRole('button', { name: 'Focus tile 5', exact: true }).click(); await step(page).getByRole('button', { name: 'Focus tile 2', exact: true }).click(); await expect(step(page).getByLabel('Focus zoom', { exact: true })).toHaveValue('1.6');
  await open(page); await step(page).locator('.focus-selection').getByRole('button', { name: 'Desktop', exact: true }).click(); await step(page).getByRole('button', { name: 'Focus tile 2', exact: true }).click(); await expect(step(page).getByLabel('Camera mode', { exact: true })).toHaveValue('detail'); await expect(step(page).getByLabel('Focus zoom', { exact: true })).toHaveValue('1.6');
});
test('Generate twelve stills, compare actual backend previews and download config', async ({ page }) => {
  await open(page); test.setTimeout(45000);
  const response = page.waitForResponse(r => r.url().endsWith('/focus-previews') && r.request().method() === 'POST');
  await step(page).getByRole('button', { name: 'Generate Focus Previews', exact: true }).click(); const initial = await (await response).json() as FocusJob;
  let finished: FocusJob;
  await expect.poll(async () => { finished = await (await page.request.get(`/api/projects/${projectId}/focus-previews/${initial.id}`)).json(); return finished.status; }, { timeout: 25000 }).toBe('complete');
  await expect(step(page).getByText('All 12 provisional stills generated', { exact: true })).toBeVisible();
  const manifest = finished!.manifest!; expect(manifest.previews).toHaveLength(12);
  for (const p of manifest.previews) { const r = await page.request.get(p.imageUrl); expect(r.ok()).toBeTruthy(); const m = await sharp(await r.body()).metadata(); expect(m.width).toBe(p.format === 'mobile' ? 1080 : 1920); expect(m.height).toBe(p.format === 'mobile' ? 1920 : 1080); }
  await expect(step(page).locator('.focus-comparison img')).toHaveCount(2);
  const downloadEvent = page.waitForEvent('download'); await step(page).getByRole('link', { name: 'Focus config JSON', exact: true }).click(); const download = await downloadEvent; expect(download.suggestedFilename()).toBe('focus_config.json'); const filename = path.join(process.cwd(), 'previews/module-four-focus-config.json'); await download.saveAs(filename); const c = JSON.parse(await readFile(filename, 'utf8')) as FocusConfig; expect(c.views).toHaveLength(12);
  await step(page).screenshot({ path: 'previews/module-four-mobile-editor.png' });
  await step(page).locator('.focus-selection').getByRole('button', { name: 'Desktop', exact: true }).click(); await step(page).getByRole('button', { name: 'Focus tile 2', exact: true }).click(); await step(page).screenshot({ path: 'previews/module-four-desktop-editor.png' });
});
test('Changed autosaved framing hides stale stills, reset and centre/FIT/FILL work', async ({ page }) => {
  await open(page); await step(page).getByRole('button', { name: 'Focus tile 3', exact: true }).click();
  await step(page).getByRole('button', { name: 'Fill output frame', exact: true }).click(); await saved(page);
  const fill = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 3)!; expect(fill.native.fit).toBe('FILL');
  await expect(step(page).locator('.focus-comparison img')).toHaveCount(0);
  await step(page).getByRole('button', { name: 'Fit entire scene', exact: true }).click(); await saved(page); expect((await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 3)!.native.fit).toBe('FIT');
  await step(page).getByRole('button', { name: 'Centre', exact: true }).click(); await saved(page);
  await step(page).getByRole('button', { name: 'Reset to automatic', exact: true }).click(); await saved(page); const reset = (await state(page)).config.views.find(v => v.format === 'mobile' && v.tileNumber === 3)!; expect(reset.manualOverride).toBe(false); expect(reset.native.zoom).toBe(1); expect(reset.cameraMode).toBe('native');
});
test('Responsive framing and optional guides', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 }); await open(page);
  await step(page).getByLabel('Safe area', { exact: true }).uncheck(); await step(page).getByLabel('Rule of thirds', { exact: true }).uncheck();
  await expect(step(page).locator('.focus-safe-guide')).toHaveCount(0); await expect(step(page).locator('.focus-third-guides')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(422);
});
