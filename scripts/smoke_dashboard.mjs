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
  await page.selectOption('#metric-select', 'first_party');
  await page.waitForFunction(() => (
    document.querySelector('#map-loading')?.classList.contains('hidden')
    && document.querySelectorAll('#sidebar-party-results .party-results-row').length === 3
  ));

  const metrics = await page.locator('#metric-select option').evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(metrics, ['first_party', 'party_share', 'turnout', 'dominant_block', 'margin']);
  assert.equal(await page.locator('#sidebar-quick-stats').count(), 0);
  assert.ok(await page.locator('#sidebar-legend .legend-item').count() <= 7, 'winner legend must stay compact');

  const election1992 = await page.locator('#election-select option').evaluateAll(options => (
    options.find(option => option.textContent.includes('1992'))?.value
  ));
  assert.ok(election1992, 'Camera 1992 must be available');
  await page.selectOption('#election-select', election1992);
  await page.waitForFunction(value => (
    document.querySelector('#election-select')?.value === value
    && (document.querySelector('#sidebar-party-results .party-results-scope')?.textContent || '').includes('1992')
    && document.querySelectorAll('#sidebar-party-results .party-results-row').length === 3
    && document.querySelector('#map-loading')?.classList.contains('hidden')
  ), election1992);

  const winnerLegendColors = await page.locator('#sidebar-legend .legend-item').evaluateAll(items => (
    items.slice(0, 5).map(item => item.querySelector('.legend-swatch')?.style.background || '')
  ));
  assert.equal(new Set(winnerLegendColors).size, winnerLegendColors.length, 'top winner colors must be distinct');

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

  await page.fill('#municipality-search', 'Roma');
  await page.dispatchEvent('#municipality-search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection-dock')?.classList.contains('hidden'));
  assert.equal((await page.locator('#selection-dock-title').innerText()).trim(), 'Roma (Roma)');
  await page.click('#selection-dock-clear-btn');
  await page.waitForFunction(() => document.querySelector('#selection-dock')?.classList.contains('hidden'));
  await page.click('#map-reset-btn');

  const hoverProfile = await page.evaluate(async () => {
    const canvas = document.querySelector('#map-canvas');
    const rect = canvas.getBoundingClientRect();
    const prototype = CanvasRenderingContext2D.prototype;
    const original = prototype.isPointInPath;
    const originalGetImageData = prototype.getImageData;
    let pathChecks = 0;
    let pixelReadbacks = 0;
    prototype.isPointInPath = function instrumentedIsPointInPath(...args) {
      pathChecks += 1;
      return original.apply(this, args);
    };
    prototype.getImageData = function instrumentedGetImageData(...args) {
      pixelReadbacks += 1;
      return originalGetImageData.apply(this, args);
    };
    try {
      for (let index = 0; index < 72; index += 1) {
        const column = index % 12;
        const row = Math.floor(index / 12);
        canvas.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: rect.left + ((column + 0.5) / 12) * rect.width,
          clientY: rect.top + ((row + 0.5) / 6) * rect.height
        }));
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    } finally {
      prototype.isPointInPath = original;
      prototype.getImageData = originalGetImageData;
    }
    return {
      pathChecks,
      pixelReadbacks,
      hitSurface: canvas.dataset.hitSurface,
      checksPerMove: pathChecks / 72
    };
  });
  assert.equal(hoverProfile.hitSurface, 'ready', 'hover must use the prebuilt hit surface');
  assert.ok(hoverProfile.pathChecks < 1000, `hover must not scan all municipalities (${hoverProfile.pathChecks} path checks)`);
  assert.equal(hoverProfile.pixelReadbacks, 0, 'hover must not force synchronous canvas pixel readbacks');

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
  console.log(`dashboard smoke: ok (${canvas.width}x${canvas.height}, ${canvas.painted} painted samples, ${hoverProfile.checksPerMove.toFixed(1)} path checks/move)`);
} finally {
  await browser.close();
}
