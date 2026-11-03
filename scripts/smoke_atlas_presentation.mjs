import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const output = resolve(process.env.ARTIFACTS_DIR || join(tmpdir(), 'electio-atlas-presentation'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block'
});
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const waitForMap = () => page.waitForFunction(() => (
  document.querySelector('#loading-overlay')?.classList.contains('hidden')
  && document.querySelector('#map-loading')?.classList.contains('hidden')
  && document.querySelector('#map-canvas')?.__zoom
));
const screenshot = name => page.screenshot({ path: join(output, name), fullPage: true });

try {
  await page.goto(baseUrl);
  await waitForMap();
  assert.equal(await page.locator('link[href="atlas-interface.css"]').count(), 1);
  await page.selectOption('#metric-select', 'turnout');
  await waitForMap();
  const desktop = await page.locator('.sidebar').boundingBox();
  const map = await page.locator('.map-panel').boundingBox();
  assert.ok(desktop.x + desktop.width < map.x, 'desktop controls must sit beside the map');
  assert.ok(Math.abs(desktop.y - map.y) < 3, 'controls and map must align');
  const mapPixels = await page.locator('#map-canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set();
    for (let index = 0; index < data.length; index += 400) {
      if (data[index + 3]) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
    return colors.size;
  });
  assert.ok(mapPixels > 20, 'map canvas must contain rendered cartography');
  assert.equal(await page.locator('.national-results').getAttribute('open'), null);
  assert.equal(await page.locator('.national-results').isVisible(), false, 'do not offer an empty national result panel for turnout');
  assert.equal(await page.locator('.metric-explainer').getAttribute('open'), null);
  await page.locator('.metric-explainer > summary').click();
  assert.ok((await page.locator('#metric-help').innerText()).length > 10);
  await page.locator('.metric-explainer > summary').click();
  await screenshot('desktop.png');

  await page.selectOption('#metric-select', 'party_share');
  await waitForMap();
  assert.equal(await page.locator('#party-select').isVisible(), true);
  assert.ok(await page.locator('#party-select option').count() > 1);
  await page.waitForFunction(() => document.querySelector('#sidebar-party-results')?.textContent.trim());
  await page.locator('.national-results > summary').click();
  assert.equal(await page.locator('#sidebar-party-results').isVisible(), true);
  await page.locator('.national-results > summary').click();
  await page.fill('#municipality-search', 'Roma');
  await page.dispatchEvent('#municipality-search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection-dock').classList.contains('hidden'));
  assert.match(await page.locator('#selection-dock-title').innerText(), /Roma/);
  await screenshot('desktop-selection.png');
  await page.click('#selection-dock-clear-btn');
  await page.waitForFunction(() => document.querySelector('#selection-dock').classList.contains('hidden'));

  for (const width of [1920, 1024, 960, 900, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 960 ? 844 : 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}px`);
    assert.equal(await page.locator('#election-select').isVisible(), true);
    assert.equal(await page.locator('#metric-select').isVisible(), true);
    assert.equal(await page.locator('#party-select').isVisible(), true);
    const canvas = await page.locator('#map-canvas').boundingBox();
    assert.ok(canvas.width > 200 && canvas.height > 140, `map has a useful size at ${width}px`);
    if (width === 390) {
      await screenshot('mobile.png');
      await page.fill('#municipality-search', 'Roma');
      await page.dispatchEvent('#municipality-search', 'change');
      await page.waitForFunction(() => !document.querySelector('#selection-dock').classList.contains('hidden'));
      const selectedCanvas = await page.locator('#map-canvas').boundingBox();
      const dock = await page.locator('#selection-dock').boundingBox();
      assert.ok(dock.y >= selectedCanvas.y + selectedCanvas.height - 1, 'mobile selection must not cover the map');
      await screenshot('mobile-selection.png');
      await page.click('#selection-dock-clear-btn');
      await page.locator('.navbar-toggler').click();
      assert.equal(await page.locator('#site-nav-menu .nav-link[aria-current="page"]').isVisible(), true);
      await page.locator('.navbar-toggler').click();
    }
  }
  await page.locator('.advanced-sidebar-details > summary').click();
  assert.equal(await page.locator('#geometry-reference-select').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'advanced controls must fit small screens');
  assert.deepEqual(errors, []);
  console.log('atlas presentation: ok (7 viewport sizes, disclosures, party flow, selection, navigation, advanced tools)');
} finally {
  await browser.close();
}
