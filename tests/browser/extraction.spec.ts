import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import type { ExtractionManifest, ExtractionJob } from '../../shared/extraction';

const fixture = (name: string) => path.join(process.cwd(), 'tests', 'fixtures', name);
async function prepare(page: Page, filename = 'sample-comic.png') {
  await page.goto('/');
  await page.getByLabel('Upload comic', { exact: true }).setInputFiles(fixture(filename));
  await expect(page.getByRole('status').filter({ hasText: 'Comic uploaded' })).toBeVisible();
  const extract = page.getByRole('button', { name: 'Extract Six Tiles', exact: true });
  await expect(extract).toBeDisabled();
  const saveResponse = page.waitForResponse(r => r.url().includes('/api/projects/') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await (await saveResponse).json();
  await expect(extract).toBeEnabled();
  return saved.project;
}
async function extract(page: Page) {
  const response = page.waitForResponse(r => r.url().endsWith('/extract') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^(Extract Six Tiles|Re-extract)$/ }).click();
  const initial = await (await response).json() as ExtractionJob;
  // A re-extraction may keep the previous verified previews visible while the new job runs.
  // Wait for this specific run, rather than interpreting the previous PASS badge as completion.
  let finished: ExtractionJob | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${initial.projectId}/extractions/${initial.id}`);
    finished = await response.json() as ExtractionJob;
    return finished.status;
  }).toBe('complete');
  await expect(page.getByRole('status').filter({ hasText: '6/6 pixel checks PASS' })).toBeVisible();
  await expect(page.locator('[data-testid^="extracted-tile-"]')).toHaveCount(6);
  return finished!.manifest!;
}
const hash = (bytes: Buffer | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('Confirm, extract, download six PNGs and ZIP, reopen saved results', async ({ page }) => {
  const project = await prepare(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/api/detect')) requests.push(request.url()); });
  const manifest = await extract(page);
  expect(requests).toEqual([]);
  for (const tile of manifest.tiles) {
    const article = page.getByTestId(`extracted-tile-${tile.number}`);
    await expect(article).toContainText(`${tile.width} × ${tile.height} px`);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: `Download tile ${tile.number}`, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(tile.filename);
    const filename = path.join(process.cwd(), 'test-results', `module2-${tile.filename}`);
    await download.saveAs(filename);
    const bytes = await readFile(filename);
    expect(hash(bytes)).toBe(tile.pngSha256);
    const info = await sharp(bytes).metadata();
    expect(info.width).toBe(tile.crop.width); expect(info.height).toBe(tile.crop.height);
  }
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download All Tiles ZIP', exact: true }).click();
  const download = await zipDownload;
  expect(download.suggestedFilename()).toBe('six_extracted_tiles.zip');
  const filename = path.join(process.cwd(), 'test-results', 'six_extracted_tiles.zip');
  await download.saveAs(filename);
  const entries = unzipSync(await readFile(filename));
  expect(Object.keys(entries).length).toBe(7);
  expect(JSON.parse(Buffer.from(entries['tile_extraction_manifest.json']).toString('utf8'))).toEqual(manifest);
  await page.locator('#extract-six-tiles').screenshot({ path: 'test-results/module-two-portrait.png' });
  await page.getByRole('button', { name: 'Back to Panel Adjustment', exact: true }).click();
  await expect(page.getByLabel('Panel 1 width', { exact: true })).toBeInViewport();
  await page.reload();
  await page.getByLabel('Reopen a local project').selectOption(project.id);
  await expect(page.getByRole('status').filter({ hasText: '6/6 pixel checks PASS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Re-extract', exact: true })).toBeEnabled();
});

for (const [filename, layout] of [['landscape-comic.jpg', '3x2'], ['portrait-comic.webp', '2x3']] as const) {
  test(`Extract ${filename} and preserve native preview proportions`, async ({ page }) => {
    await prepare(page, filename);
    const manifest = await extract(page);
    expect(manifest.layout).toBe(layout);
    expect(manifest.tiles.map(t => t.number)).toEqual([1, 2, 3, 4, 5, 6]);
    const image = page.getByRole('img', { name: 'Extracted tile 01', exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(manifest.tiles[0].width / manifest.tiles[0].height, 2);
    if (layout === '3x2') await page.locator('#extract-six-tiles').screenshot({ path: 'test-results/module-two-landscape.png' });
  });
}

test('Editing a confirmed crop invalidates previews until saved; re-extraction uses corrected pixels', async ({ page }) => {
  await prepare(page);
  const first = await extract(page);
  const oldWidth = first.tiles[0].width;
  await page.getByLabel('Panel 1 width', { exact: true }).fill(String(oldWidth - 7));
  await expect(page.locator('[data-testid^="extracted-tile-"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Extract Six Tiles', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Extract Six Tiles', exact: true })).toBeEnabled();
  const next = await extract(page);
  expect(next.tiles[0].width).toBe(oldWidth - 7);
  expect(next.extractionId).not.toBe(first.extractionId);
  expect(next.tiles[0].pngSha256).not.toBe(first.tiles[0].pngSha256);
  const reproduced = await extract(page);
  expect(reproduced.tiles.map(t => t.pngSha256)).toEqual(next.tiles.map(t => t.pngSha256));
});

test('Module 2 bench displays all 12 real PASS/FAIL results', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Run Module 2 checks', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Module 2 tests' }).getByText('12/12 PASS', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.module-two-result .test-status.pass')).toHaveCount(12);
  await expect(page.locator('.module-two-result .test-status.fail')).toHaveCount(0);
  await page.getByRole('region', { name: 'Module 2 tests' }).screenshot({ path: 'test-results/module-two-checks.png' });
});

test('Module 2 previews and controls fit a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await extract(page);
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await page.locator('#extract-six-tiles').screenshot({ path: 'test-results/module-two-mobile.png' });
});
