import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
const page = await context.newPage();
page.setDefaultTimeout(90_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const ready = () => page.waitForFunction(() => document.querySelector('#loading-overlay')?.classList.contains('hidden') && document.querySelector('#map-loading')?.classList.contains('hidden') && document.querySelector('#map-canvas')?.__zoom);
const otherShare = async () => parseFloat((await page.locator('#political-other-share').innerText()).replace(',', '.'));

try {
  mkdirSync('build', { recursive: true });
  await page.goto(baseUrl);
  await ready();
  console.log('politics: boot ready');
  assert.equal(await page.locator('.advanced-sidebar-details').getAttribute('open'), null);
  assert.equal(await page.locator('#metric-select [value="dominant_block"]').evaluate(option => option.hidden), true, 'generic families stay out of the primary menu');
  await page.selectOption('#metric-select', 'political_balance');
  await ready();
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'lists', 'Europee must compare actual lists, not invented coalitions');
  assert.ok(await otherShare() > 40, 'uncompared European lists must stay in the denominator');
  const gradientWidth = await page.locator('#sidebar-legend .political-gradient-bar').evaluate(node => node.getBoundingClientRect().width);
  assert.ok(gradientWidth > 200, 'the continuous legend must not collapse into a swatch');
  assert.ok(Number(await page.locator('#map-canvas').getAttribute('data-fill-buckets')) <= 70, 'smooth colors must stay bounded for canvas performance');
  await page.selectOption('#election-select', 'camera_2022');
  await ready();
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'historical');
  const originalOthers = await otherShare();
  await page.screenshot({ path: 'build/_political-desktop.png' });
  assert.ok(originalOthers > 20, 'M5S and Azione-IV must remain outside the 2022 CSX/CDX pair');
  const canvas = page.locator('#map-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  for (const [x, y] of [[0.45, 0.2], [0.5, 0.3], [0.62, 0.48], [0.7, 0.7]]) {
    await page.dispatchEvent('#map-canvas', 'mousemove', { clientX: bounds.x + bounds.width * x, clientY: bounds.y + bounds.height * y });
    await page.waitForTimeout(450);
    if (await page.locator('#tooltip').textContent().then(text => text.includes('Altre liste'))) break;
  }
  assert.match(await page.locator('#tooltip').textContent(), /Altre liste/, 'full hover must resolve the new metric without runtime errors');
  await page.fill('#municipality-search', 'Roma');
  await page.dispatchEvent('#municipality-search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection-dock').classList.contains('hidden'));
  assert.match(await page.locator('#selection-dock-metric-label').innerText(), /Equilibrio/i);
  const percentages = await page.locator('#selection-dock-stats strong').allTextContents();
  assert.ok(Math.abs(percentages.reduce((sum, value) => sum + parseFloat(value.replace(',', '.')), 0) - 100) < 0.2);
  await page.selectOption('#metric-select', 'dominant_coalition');
  await ready();
  assert.match(await page.locator('#selection-dock-metric-label').innerText(), /Schieramento/i);
  assert.doesNotMatch(await page.locator('#selection-dock-leader-name').innerText(), /^FdI$/);

  await page.locator('.advanced-sidebar-details').evaluate(node => { node.open = true; });
  await page.waitForFunction(() => document.querySelectorAll('[data-political-party]').length > 8);
  const m5s = await page.locator('[data-political-party]').evaluateAll(selects => selects.find(select => /Movimento 5 Stelle/i.test(select.dataset.politicalParty))?.dataset.politicalParty);
  assert.ok(m5s);
  await page.locator('[data-political-party]').evaluateAll((selects, party) => {
    const select = selects.find(select => select.dataset.politicalParty === party);
    select.value = 'left';
  }, m5s);
  await page.fill('#political-left-label', 'CSX + M5S');
  await page.click('#political-scenario-apply');
  await ready();
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'scenario');
  assert.ok(originalOthers - await otherShare() > 10, 'only the explicit scenario may add M5S to the left group');
  assert.match(await page.locator('#selection-dock-metric-label').innerText(), /scenario personale/i);
  assert.ok(new URL(page.url()).hash.includes('politicalScenario'));
  await page.selectOption('#metric-select', 'dominant_coalition');
  await ready();
  assert.doesNotMatch(await page.locator('#political-context').textContent(), /CSX \+ M5S/, 'historical composition must never inherit personal group names or membership');
  await page.selectOption('#metric-select', 'political_balance');
  await ready();
  console.log('politics: historical groups and custom scenario ready');
  await page.reload();
  await ready();
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'scenario', 'a shared URL must preserve the scenario');
  assert.equal(await page.locator('.advanced-sidebar-details').getAttribute('open'), null, 'the scenario editor must remain closed on arrival');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('#selection-dock-stats .selection-dock-stat').nth(1).isVisible(), true, 'mobile must retain both group shares');
  await page.screenshot({ path: 'build/_political-mobile.png', fullPage: true });
  await page.click('#selection-dock-open-btn');
  await page.waitForFunction(() => document.querySelector('#detail-current-election').textContent.includes('scenario personale') && !document.querySelector('#detail-current-election').textContent.includes('Caricamento'));
  assert.match(await page.locator('#detail-current-election').innerText(), /CSX \+ M5S/);
  const back = await page.locator('.detail-current-map-link').getAttribute('href');
  assert.match(back, /selectedMetric=political_balance/);
  assert.match(back, /politicalScenario/);
  console.log('politics: scenario preserved in municipality profile');
  await page.goto(new URL(back, page.url()).href);
  await ready();
  await page.locator('.advanced-sidebar-details').evaluate(node => { node.open = true; });
  await page.click('#political-scenario-reset');
  await ready();
  assert.equal(await page.locator('#political-context').getAttribute('data-mode'), 'historical');
  assert.ok(Math.abs(await otherShare() - originalOthers) < 0.1);
  assert.deepEqual(errors, []);
  console.log('political map smoke: ok (historical groups, continuous scale, standalone votes, advanced scenario, permalink, mobile and profile)');
} catch (error) {
  console.error('politics failed at', page.url(), errors);
  console.error(await page.evaluate(() => document.querySelector('#detail-current-election')?.textContent || document.querySelector('#selection-dock')?.textContent));
  await page.screenshot({ path: 'build/_political-failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
