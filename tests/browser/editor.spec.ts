import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const fixture = (name: string) => path.join(process.cwd(), 'tests', 'fixtures', name);
async function portrait(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Portrait', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sample loaded' })).toBeVisible();
}

test('Upload portrait, preserve aspect ratio, and show six guides', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: 'test-results/empty-workspace.png', fullPage: true });
  await page.getByLabel('Upload comic', { exact: true }).setInputFiles(fixture('sample-comic.png'));
  await expect(page.getByRole('status').filter({ hasText: 'Comic uploaded' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use 2 columns by 3 rows' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="panel-guide-"]')).toHaveCount(6);
  const image = page.getByRole('img', { name: 'Uploaded comic: sample-comic.png' });
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(848 / 1264, 2);
  const overlay = await page.getByLabel('Comic panel boundary editor').boundingBox();
  expect(overlay!.width).toBeCloseTo(box!.width, 1);
  expect(overlay!.height).toBeCloseTo(box!.height, 1);
  await page.screenshot({ path: 'test-results/portrait-editor.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Upload landscape and manually switch layouts', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Upload comic', { exact: true }).setInputFiles(fixture('landscape-comic.jpg'));
  await expect(page.getByRole('status').filter({ hasText: 'Comic uploaded' })).toBeVisible();
  const landscape = page.getByRole('button', { name: 'Use 3 columns by 2 rows' });
  await expect(landscape).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="panel-guide-"]')).toHaveCount(6);
  const image = await page.getByRole('img', { name: 'Uploaded comic: landscape-comic.jpg' }).boundingBox();
  expect(image!.width / image!.height).toBeCloseTo(1272 / 856, 2);
  await page.getByRole('button', { name: 'Use 2 columns by 3 rows' }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 × 3 layout applied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use 2 columns by 3 rows' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid^="panel-guide-"]')).toHaveCount(6);
  await landscape.click();
  await expect(page.getByRole('status').filter({ hasText: '3 × 2 layout applied' })).toBeVisible();
  await page.screenshot({ path: 'test-results/landscape-editor.png', fullPage: true });
});

test('Drag a gutter, keyboard-adjust a panel, save and reload JSON', async ({ page }) => {
  await portrait(page);
  const before = Number(await page.getByLabel('Panel 1 width', { exact: true }).inputValue());
  const handle = page.getByRole('slider', { name: 'Column 1 end boundary', exact: true });
  const svg = await page.getByLabel('Comic panel boundary editor').boundingBox();
  const coordinate = Number(await handle.getAttribute('aria-valuenow'));
  const x = svg!.x + coordinate / 848 * svg!.width;
  await page.mouse.move(x - 1, svg!.y + svg!.height * 0.2);
  await page.mouse.down(); await page.mouse.move(x - 12, svg!.y + svg!.height * 0.2, { steps: 6 }); await page.mouse.up();
  const changed = Number(await page.getByLabel('Panel 1 width', { exact: true }).inputValue());
  expect(changed).toBeLessThan(before);
  await page.getByRole('button', { name: 'Individual panel', exact: true }).click();
  await page.getByRole('slider', { name: 'Panel 1 right boundary', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Panel 1 width', { exact: true })).toHaveValue(String(changed - 1));
  await page.getByLabel('Project name', { exact: true }).fill('Browser roundtrip');
  const saveResponse = page.waitForResponse(res => res.url().includes('/api/projects/') && res.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await (await saveResponse).json();
  await expect(page.getByRole('status').filter({ hasText: 'Project saved locally' })).toBeVisible();
  expect(saved.project.manuallyAdjusted).toBe(true);
  await page.getByLabel('Panel 1 width', { exact: true }).fill(String(changed - 10));
  await page.getByLabel('Reopen a local project').selectOption(saved.project.id);
  await expect(page.getByRole('status').filter({ hasText: 'Coordinates restored exactly' })).toBeVisible();
  await expect(page.getByLabel('Panel 1 width', { exact: true })).toHaveValue(String(changed - 1));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const download = await downloadPromise;
  const file = path.join(process.cwd(), 'test-results', 'browser-roundtrip.json');
  await download.saveAs(file);
  await page.reload();
  await page.getByLabel('Open project JSON', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: 'Project reopened' })).toBeVisible();
  await expect(page.getByLabel('Panel 1 width', { exact: true })).toHaveValue(String(changed - 1));
});

test('Reject unsupported or corrupt files and block overlapping save', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Upload comic', { exact: true }).setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('bad gif') });
  await expect(page.getByRole('alert')).toContainText('Unsupported image');
  await page.getByLabel('Upload comic', { exact: true }).setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('corrupt') });
  await expect(page.getByRole('alert')).toContainText('could not be decoded');
  await page.getByRole('button', { name: 'Portrait', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sample loaded' })).toBeVisible();
  await page.getByLabel('Panel 1 width', { exact: true }).fill('600');
  await expect(page.getByRole('status').filter({ hasText: 'Boundaries need attention' })).toContainText('overlap');
  await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset & auto-detect' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Six valid panels' })).toBeVisible();
});

test('Run checks and display real PASS/FAIL results', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Run checks', exact: true }).click();
  await expect(page.getByText('10/10 PASS', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Module 1 tests' }).locator('.test-status.pass')).toHaveCount(10);
  await expect(page.getByRole('region', { name: 'Module 1 tests' }).locator('.test-status.fail')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/test-bench.png', fullPage: true });
});

test('Mobile editor fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await portrait(page);
  await expect(page.locator('[data-testid^="panel-guide-"]')).toHaveCount(6);
  const widths = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: 'test-results/mobile-editor.png', fullPage: true });
});
