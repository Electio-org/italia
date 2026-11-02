import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createMunicipalitySearch } from '../modules/municipality-search.js';

const search = createMunicipalitySearch([
  { municipality_id: '016065', name_current: 'Castro', province_current: 'Bergamo' },
  { municipality_id: '075096', name_current: 'Castro', province_current: 'Lecce' },
  { municipality_id: '016253', name_current: 'Val Brembilla', province_current: 'Bergamo', alias_names: 'Brembilla|Gerosa' },
  { municipality_id: '001073', name_current: 'Ciriè', province_current: 'Torino' }
]);
assert.equal(search.find('Castro').length, 2, 'homonyms must never resolve arbitrarily');
assert.equal(search.find('Castro (Lecce)')[0].id, '075096');
assert.equal(search.find('016065')[0].id, '016065');
assert.equal(search.find('Brembilla')[0].id, '016253');
assert.equal(search.find('Cirie')[0].id, '001073');
assert.equal(search.find('not a municipality').length, 0);

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
const page = await context.newPage();
page.setDefaultTimeout(75_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const waitForMap = () => page.waitForFunction(() => (
  document.querySelector('#loading-overlay')?.classList.contains('hidden')
  && document.querySelector('#map-loading')?.classList.contains('hidden')
  && document.querySelector('#map-canvas')?.__zoom
));
async function findMunicipality(value) {
  await page.fill('#municipality-search', value);
  await page.dispatchEvent('#municipality-search', 'change');
}

try {
  await page.goto(baseUrl);
  await waitForMap();
  const geometryRequests = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => new URL(entry.name).pathname)
    .filter(path => path.includes('municipalities_2021.topojson')));
  assert.ok(geometryRequests.some(path => path.endsWith('.gz')));
  assert.equal(geometryRequests.some(path => path.endsWith('.topojson')), false, 'boot must not download the 21 MB uncompressed duplicate');
  const enhancement = await page.evaluate(async () => {
    let fullScans = 0;
    const original = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) {
      if (selector === 'button') fullScans += 1;
      return original.call(this, selector);
    };
    const root = document.createElement('div');
    root.hidden = true;
    root.innerHTML = '<button type="button">Nested button</button><input type="search">';
    const button = document.createElement('button');
    button.hidden = true;
    document.body.append(root, button);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const enhanced = root.querySelector('button').classList.contains('btn')
      && button.classList.contains('btn') && root.querySelector('input').classList.contains('form-control');
    root.remove();
    button.remove();
    Document.prototype.querySelectorAll = original;
    return { enhanced, fullScans };
  });
  assert.equal(enhancement.enhanced, true, 'new roots and nested controls must still receive their styles');
  assert.equal(enhancement.fullScans, 0, 'tooltip/DOM changes must never rescan the whole dashboard');

  await findMunicipality('Castro');
  await page.waitForFunction(() => document.querySelector('#municipality-search-status').textContent.includes('provincia'));
  assert.equal(await page.locator('#selection-dock').isVisible(), false);
  await findMunicipality('Castro (Bergamo)');
  await page.waitForFunction(() => document.querySelector('#selection-dock-title').textContent === 'Castro (Bergamo)');
  await page.click('#clear-municipality-btn');
  await page.waitForFunction(() => document.querySelector('#selection-dock').classList.contains('hidden'));
  assert.equal(await page.locator('#municipality-search').inputValue(), '');
  await findMunicipality('058091');
  await page.waitForFunction(() => document.querySelector('#selection-dock-title').textContent === 'Roma (Roma)');
  await page.fill('#municipality-search', '');
  await page.dispatchEvent('#municipality-search', 'input');
  await page.waitForFunction(() => document.querySelector('#selection-dock').classList.contains('hidden'));
  await findMunicipality('comune inesistente xyz');
  await page.waitForFunction(() => document.querySelector('#municipality-search-status').textContent.includes('Nessun comune'));

  await page.selectOption('#election-select', 'camera_1948');
  await waitForMap();
  await findMunicipality('Trieste');
  await page.waitForFunction(() => document.querySelector('#selection-dock-title').textContent === 'Trieste (Trieste)');
  for (const metric of ['turnout', 'margin', 'dominant_block']) {
    await page.selectOption('#metric-select', metric);
    await waitForMap();
    assert.match(await page.locator('#selection-dock-leader-name').innerText(), /Nessun risultato/);
    assert.equal(await page.locator('#selection-dock-leader-share').innerText(), 'n.d.');
  }
  await page.click('#clear-municipality-btn');
  await page.selectOption('#metric-select', 'turnout');
  await waitForMap();
  await page.click('#map-reset-btn');
  const canvas = page.locator('#map-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -1800);
  await page.waitForFunction(() => document.querySelector('#map-canvas')?.__zoom?.k >= 4);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    window.__fillPathAdds = 0;
    const original = Path2D.prototype.addPath;
    Path2D.prototype.addPath = function (...args) {
      window.__fillPathAdds += 1;
      return original.apply(this, args);
    };
  });
  await page.mouse.down();
  await page.mouse.move(cx + 1, cy + 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { window.__fillPathAdds = 0; });
  for (let step = 2; step <= 12; step += 1) {
    await page.mouse.move(cx + step, cy + 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  await page.mouse.up();
  const additions = await page.evaluate(() => window.__fillPathAdds);
  assert.ok(additions < 150, `small deep-zoom pans must reuse viewport paths (${additions} path additions)`);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'dashboard must fit mobile');
  await findMunicipality('Roma');
  await page.waitForFunction(() => !document.querySelector('#selection-dock').classList.contains('hidden'));
  const mobileMap = await canvas.boundingBox();
  const mobileDock = await page.locator('#selection-dock').boundingBox();
  assert.ok(mobileDock.y >= mobileMap.y + mobileMap.height - 1, 'mobile results must not cover the map');
  await page.goto(`${baseUrl}municipality-detail.html?id=058091&election=europee_2024&metric=turnout`);
  await page.waitForFunction(() => document.querySelectorAll('#detail-history-body tr').length === 10);
  assert.match(await page.locator('#detail-history-scope').innerText(), /Europee.*10 elezioni/);
  assert.equal((await page.locator('#detail-history-body').innerText()).includes('Camera'), false);
  await page.locator('#detail-chart-bloc-composition').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#detail-election-results .detail-election-result-row').length > 5);
  const detailParties = await page.locator('.detail-election-result-name').allTextContents();
  assert.ok(detailParties.includes('Azione - Siamo Europei'), '2024 must use its election-specific party identity');
  assert.equal(detailParties.some(label => /Azione\s*\/\s*IV|Verdi\s*\/\s*AVS/.test(label)), false, 'detail must not revive generic coalition aliases');
  const requestedHistory = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)
    .filter(name => name.includes('/results_by_election/')));
  assert.equal(requestedHistory.length, 1, 'scrolling the history must not download every national results shard');
  await page.click('[data-history-family="camera"]');
  assert.equal(await page.locator('#detail-history-body tr').count(), 20);
  assert.equal((await page.locator('#detail-history-body').innerText()).includes('Europee'), false);
  assert.equal(await page.locator('[data-history-family="camera"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'history controls must fit mobile');
  assert.match(await page.locator('.detail-breadcrumb-link').getAttribute('href'), /selectedElection=europee_2024/);

  await page.goto(`${baseUrl}municipality-detail.html?id=032006&election=camera_1948&metric=turnout`);
  await page.waitForFunction(() => document.querySelector('#detail-current-election').textContent.includes('Nessun risultato'));
  assert.equal(await page.locator('#detail-current-election .detail-current-winner').count(), 0, 'a missing election must never show results from another year');

  const fixture = {
    municipalities: [{ municipality_id: '058091', name_current: 'Roma', province_current: 'Roma' }],
    summary: [
      { municipality_id: '058091', election_key: 'camera_2018', election_year: 2018, turnout_pct: null, first_party_share: null, first_second_margin: null, electors: null, voters: null, valid_votes: null },
      { municipality_id: '058091', election_key: 'camera_2022', election_year: 2022, turnout_pct: 70, first_party_share: 50, first_second_margin: 20, electors: 100, voters: 70, valid_votes: 60 }
    ]
  };
  await page.route('**/municipality_profiles/chunks/058.json.gz', route => route.fulfill({
    contentType: 'application/gzip', body: gzipSync(JSON.stringify(fixture))
  }));
  await page.goto(`${baseUrl}municipality-detail.html?id=058091&election=camera_2018&metric=margin`);
  await page.waitForFunction(() => document.querySelectorAll('#detail-history-body tr').length === 2);
  assert.equal(await page.locator('#detail-chart-turnout .series-dot').count(), 1, 'missing turnout must never become a zero-valued point');
  assert.equal(await page.locator('#detail-current-election .detail-current-winner b').innerText(), '—', 'missing margins must never display zero');
  assert.deepEqual(errors, []);
  console.log(`explorer interactions: ok (homonyms, missing historical results, family histories, ${additions} path additions during pan)`);
} finally {
  await browser.close();
}
