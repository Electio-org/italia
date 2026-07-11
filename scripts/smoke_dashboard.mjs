import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  serviceWorkers: 'block',
  viewport: { width: 1440, height: 1000 }
});
await context.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(message.text());
});
page.setDefaultTimeout(45_000);

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#loading-overlay')?.classList.contains('hidden'));
  await page.waitForFunction(() => document.querySelectorAll('#sidebar-party-results .party-results-row').length >= 5);

  const metrics = await page.locator('#metric-select option').evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(metrics, ['party_share', 'turnout', 'dominant_block', 'margin']);

  const election1992 = await page.locator('#election-select option').evaluateAll(options => (
    options.find(option => option.textContent.includes('1992'))?.value
  ));
  assert.ok(election1992, 'Camera 1992 must be available');
  await page.selectOption('#election-select', election1992);
  await page.waitForFunction(value => (
    document.querySelector('#election-select')?.value === value
    && (document.querySelector('#sidebar-party-results .party-results-scope')?.textContent || '').includes('1992')
    && document.querySelector('#map-loading')?.classList.contains('hidden')
  ), election1992);

  const parties1992 = await page.locator('#party-select option').evaluateAll(options => (
    options.filter(option => option.value).slice(0, 10).map(option => option.value)
  ));
  assert.deepEqual(parties1992.slice(0, 5), ['Dc', 'Pds', 'Psi', 'Lega Lombarda', 'Rifondazione Comunista']);
  assert.equal(parties1992.some(label => /^(avs|fdi|azione(?:\b|\s|-))/i.test(label)), false);

  await page.fill('#municipality-search', 'San Costantino Calabro');
  await page.dispatchEvent('#municipality-search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection-dock')?.classList.contains('hidden'));
  const municipalitySummary = await page.locator('#selection-dock').innerText();
  assert.match(municipalitySummary, /Rifondazione Comunista/i);
  assert.doesNotMatch(municipalitySummary, /\b(?:AVS|FdI)\b|^Azione/i);

  await page.focus('#municipality-search');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#selection-dock')?.classList.contains('hidden'));

  const canvas = await page.locator('#map-canvas').evaluate(node => {
    const data = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let painted = 0;
    const stride = Math.max(4, Math.floor((node.width * node.height) / 50_000) * 4);
    for (let index = 3; index < data.length; index += stride) {
      if (data[index] > 0) painted += 1;
    }
    return { width: node.width, height: node.height, painted };
  });
  assert.ok(canvas.painted > 100, 'map canvas must not be blank');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const mobileLayout = await page.evaluate(() => {
    const controls = document.querySelector('.control-panel')?.getBoundingClientRect();
    const map = document.querySelector('.map-panel')?.getBoundingClientRect();
    const companion = document.querySelector('.map-companion')?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      controlsY: controls?.y,
      mapY: map?.y,
      companionY: companion?.y
    };
  });
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.viewportWidth + 2, 'mobile layout must not overflow horizontally');
  assert.ok(mobileLayout.controlsY < mobileLayout.mapY && mobileLayout.mapY < mobileLayout.companionY, 'mobile order must be controls, map, context');
  assert.ok(mobileLayout.mapY < 650, 'mobile map must stay near the first screen');

  assert.deepEqual(runtimeErrors, []);
  console.log(`dashboard smoke: ok (${canvas.width}x${canvas.height}, ${canvas.painted} painted samples)`);
} finally {
  await browser.close();
}
