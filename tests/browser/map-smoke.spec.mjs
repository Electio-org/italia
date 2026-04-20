import { expect, test } from '@playwright/test';

async function waitForCanvasPixels(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#map-canvas');
    if (!canvas?.width || !canvas?.height) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < sample.length; i += 16) {
      if (sample[i] > 0) return true;
    }
    return false;
  }, null, { timeout: 30_000 });
}

async function findMapPoint(page) {
  const point = await page.locator('#map-canvas').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const width = canvas.width;
    const height = canvas.height;
    const step = 12;
    for (let y = Math.round(height * 0.18); y < Math.round(height * 0.86); y += step) {
      for (let x = Math.round(width * 0.08); x < Math.round(width * 0.92); x += step) {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        if (pixel[3] > 0 && (pixel[0] + pixel[1] + pixel[2]) < 740) {
          const rect = canvas.getBoundingClientRect();
          return {
            x: rect.left + (x / width) * rect.width,
            y: rect.top + (y / height) * rect.height
          };
        }
      }
    }
    return null;
  });
  expect(point, 'expected a visible municipality fill pixel').toBeTruthy();
  return point;
}

test('base map boots, stays interactive, and avoids long-result fetches', async ({ page }) => {
  const runtimeErrors = [];
  const fetched = [];

  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('request', request => fetched.push(request.url()));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#election-select')).toBeVisible();
  await expect(page.locator('#metric-select')).toBeVisible();
  await expect(page.locator('#map-canvas')).toBeVisible();
  await expect(page.locator('#loading-overlay')).toHaveClass(/hidden/, { timeout: 30_000 });
  await waitForCanvasPixels(page);

  const initialLongFetches = fetched.filter(url => url.includes('/results_by_election/'));
  expect(initialLongFetches, 'base boot should not fetch full long result shards').toEqual([]);

  const point = await findMapPoint(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#tooltip')).not.toHaveClass(/hidden/, { timeout: 2_000 });
  await expect(page.locator('#tooltip')).toContainText(/\S/);

  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#tooltip')).toHaveClass(/is-pinned/);
  await page.mouse.move(8, 8);
  await expect(page.locator('#tooltip')).not.toHaveClass(/hidden/);

  await page.selectOption('#metric-select', 'party_share');
  await waitForCanvasPixels(page);
  const partyOptions = await page.locator('#party-select option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (partyOptions.length) {
    await page.selectOption('#party-select', partyOptions[0]);
    await waitForCanvasPixels(page);
  }

  const electionValues = await page.locator('#election-select option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  const currentElection = await page.locator('#election-select').inputValue();
  const nextElection = electionValues.find(value => value !== currentElection);
  if (nextElection) {
    await page.selectOption('#election-select', nextElection);
    await waitForCanvasPixels(page);
  }

  const longFetches = fetched.filter(url => url.includes('/results_by_election/'));
  expect(longFetches, 'base metric/party/election flow should not fetch full long result shards').toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
