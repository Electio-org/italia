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
page.setDefaultTimeout(75_000);

async function waitForMap(election, metric) {
  await page.waitForFunction(({ election, metric }) => (
    document.querySelector('#election-select')?.value === election
    && document.querySelector('#metric-select')?.value === metric
    && document.querySelector('#loading-overlay')?.classList.contains('hidden')
    && document.querySelector('#map-loading')?.classList.contains('hidden')
  ), { election, metric });
}

async function selectView(election, metric) {
  await page.selectOption('#metric-select', metric);
  await page.selectOption('#election-select', election);
  await waitForMap(election, metric);
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#loading-overlay')?.classList.contains('hidden'));

  const options = await page.locator('#election-select option').evaluateAll(nodes => (
    nodes.filter(node => node.value).map(node => ({ value: node.value, label: node.textContent.trim() }))
  ));
  assert.equal(options.length, 30, 'the public selector must expose all 30 elections');
  assert.equal(options.filter(option => option.value.startsWith('europee_')).length, 10);
  assert.deepEqual(
    await page.locator('#election-select optgroup').evaluateAll(nodes => nodes.map(node => node.label)),
    ['Elezioni europee', 'Camera e Assemblea Costituente']
  );

  const targets = [
    { key: 'europee_1979', winner: 'DC', forbidden: /\b(?:FdI|AVS|M5S)\b|Azione/i },
    { key: 'europee_1999', winner: 'Forza Italia', forbidden: /\b(?:FdI|AVS|M5S)\b|^Azione/i },
    { key: 'europee_2024', winner: 'FdI', forbidden: null }
  ];

  for (const target of targets) {
    await selectView(target.key, 'first_party');
    await page.waitForFunction(() => document.querySelectorAll('#sidebar-party-results .party-results-row').length === 3);
    const national = await page.locator('#sidebar-party-results .party-results-row').allTextContents();
    assert.match(national[0], new RegExp(target.winner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

    await page.selectOption('#metric-select', 'party_share');
    await waitForMap(target.key, 'party_share');
    await page.waitForFunction(() => {
      const select = document.querySelector('#party-select');
      return select && !select.disabled && select.value && select.options.length > 4;
    });
    const partyLabels = await page.locator('#party-select option').allTextContents();
    assert.match(partyLabels[0], new RegExp(target.winner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    if (target.forbidden) {
      assert.equal(partyLabels.slice(0, 15).some(label => target.forbidden.test(label)), false, `${target.key} leaks a modern party identity`);
    }

    await page.fill('#municipality-search', 'Roma');
    await page.dispatchEvent('#municipality-search', 'change');
    await page.waitForFunction(() => (
      !document.querySelector('#selection-dock')?.classList.contains('hidden')
      && document.querySelectorAll('#selection-dock-party-results .selection-result-row').length >= 5
    ));
    assert.equal((await page.locator('#selection-dock-title').innerText()).trim(), 'Roma (Roma)');
    assert.equal((await page.locator('#selection-dock-metric-label').innerText()).trim().toLowerCase(), 'quota del partito');
    assert.equal(await page.locator('#selection-dock-party-results .selection-result-row.is-active').count(), 1);
    await page.click('#selection-dock-clear-btn');
    await page.waitForFunction(() => document.querySelector('#selection-dock')?.classList.contains('hidden'));

    await selectView(target.key, 'turnout');
    assert.equal(await page.locator('#sidebar-legend .legend-item').count(), 6);
  }

  const europeResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map(entry => entry.name)
    .filter(name => name.includes('/results_by_election/europee_')));
  assert.ok(europeResources.some(name => name.includes('europee_1979.csv.gz')));
  assert.ok(europeResources.some(name => name.includes('europee_1999.csv.gz')));
  assert.ok(europeResources.some(name => name.includes('europee_2024.csv.gz')));
  assert.deepEqual(runtimeErrors, []);
  console.log('european elections smoke: ok (1979, 1999, 2024; party share; Roma)');
} finally {
  await browser.close();
}
