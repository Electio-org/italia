import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(90_000);
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const ready = () => page.waitForFunction(() => document.querySelector('#map-canvas')?.__zoom
  && document.querySelector('#loading-overlay')?.classList.contains('hidden')
  && document.querySelector('#map-loading')?.classList.contains('hidden'));

try {
  mkdirSync('build', { recursive: true });
  await page.goto(new URL('index.html#selectedElection=camera_2022&selectedMetric=political_balance', base).href);
  await ready();
  assert.ok(await page.locator('body').evaluate(body => body.classList.contains('atlas-ui')));
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'historical');
  assert.equal(await page.locator('.advanced-sidebar-details').getAttribute('open'), null);
  assert.equal(requests.some(url => /\/referendums\/|\/referendum\.(js|css)/.test(url)), false, 'the electoral boot must not load referendum assets');
  await page.locator('.national-results > summary').click();
  assert.ok(await page.locator('#sidebar-party-results').isVisible());
  await page.locator('.site-nav a[href="referendum.html"]').click();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('href'), 'referendum.html');
  const referendumRequests = requests.filter(url => url.includes('/referendums/')).length;
  await page.fill('#search', '058091');
  await page.dispatchEvent('#search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection').hidden);
  await page.selectOption('#metric', 'balance');
  await page.waitForFunction(() => !document.querySelector('#metric').disabled);
  assert.match(await page.locator('#selection .headline').textContent(), /avanti/);
  assert.equal(requests.filter(url => url.includes('/referendums/')).length, referendumRequests);
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.click('#nav-toggle');
  assert.equal(await page.locator('#referendum-nav a[href="data-download.html"]').isVisible(), true);
  await page.locator('#referendum-nav a[href="data-download.html"]').click();
  await page.waitForSelector('#referendum');
  assert.ok(await page.locator('#referendum a[download]').count() >= 2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.site-nav a[href="index.html"]').click();
  await ready();
  assert.equal(await page.locator('#election-select').inputValue(), 'camera_2022', 'returning from the referendum must preserve the electoral consultation');
  assert.equal(await page.locator('#metric-select').inputValue(), 'political_balance');
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'historical');
  await page.screenshot({ path: 'build/_unified-atlas-desktop.png' });
  assert.deepEqual(errors, []);
  console.log('unified atlas: ok (presentation, historical groups, lazy isolation, referendum, mobile navigation, downloads and electoral return)');
} catch (error) {
  await page.screenshot({ path: 'build/_unified-atlas-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
