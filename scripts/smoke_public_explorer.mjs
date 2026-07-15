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
page.setDefaultTimeout(60_000);

async function waitForMap(electionValue, metricValue) {
  await page.waitForFunction(({ electionValue, metricValue }) => (
    document.querySelector('#election-select')?.value === electionValue
    && document.querySelector('#metric-select')?.value === metricValue
    && new URLSearchParams(location.hash.slice(1)).get('selectedElection') === electionValue
    && new URLSearchParams(location.hash.slice(1)).get('selectedMetric') === metricValue
    && document.querySelector('#map-loading')?.classList.contains('hidden')
    && document.querySelector('#loading-overlay')?.classList.contains('hidden')
  ), { electionValue, metricValue });
}

async function selectMetric(metricValue) {
  await page.selectOption('#metric-select', metricValue);
  const electionValue = await page.locator('#election-select').inputValue();
  await waitForMap(electionValue, metricValue);
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#loading-overlay')?.classList.contains('hidden'));
  assert.equal(await page.locator('#loading-overlay').evaluate(node => getComputedStyle(node).position), 'fixed', 'boot loader must stay centered on the viewport');
  assert.equal(await page.locator('#map-canvas').getAttribute('data-hit-surface'), 'ready', 'map must prepare the O(1) hit surface before becoming interactive');

  const bootResultShards = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => entry.name.includes('/results_by_election/')).length);
  assert.ok(bootResultShards <= 1, 'boot may warm only the active election result shard');

  const elections = await page.locator('#election-select option').evaluateAll(options => (
    options
      .map(option => ({ value: option.value, label: option.textContent.trim() }))
      .filter(option => /1946|1992|2022/.test(option.label))
  ));
  assert.equal(elections.length, 3, '1946, 1992 and 2022 must all be available');

  const audit = [];
  for (const election of elections) {
    await page.selectOption('#metric-select', 'first_party');
    await page.selectOption('#election-select', election.value);
    await waitForMap(election.value, 'first_party');
    await page.waitForFunction(() => document.querySelectorAll('#sidebar-party-results .party-results-row').length === 3);

    const winnerLegend = await page.locator('#sidebar-legend .legend-item').allTextContents();
    const winnerColors = await page.locator('#sidebar-legend .legend-item .legend-swatch').evaluateAll(swatches => (
      swatches.slice(0, -1).map(swatch => swatch.style.background)
    ));
    assert.ok(winnerLegend.length >= 4 && winnerLegend.length <= 7, `${election.label}: winner legend must stay compact`);
    assert.equal(new Set(winnerColors).size, winnerColors.length, `${election.label}: winner colors must be distinct`);

    const nationalRows = await page.locator('#sidebar-party-results .party-results-row').allTextContents();
    assert.equal(nationalRows.length, 3, `${election.label}: national result must show exactly three parties`);

    const partyValues = await page.locator('#party-select option').evaluateAll(options => (
      options.filter(option => option.value).map(option => option.value)
    ));
    assert.ok(partyValues.length >= 5, `${election.label}: party selector must contain parties from the active election`);
    if (election.label.includes('1992')) {
      const firstTen = partyValues.slice(0, 10);
      assert.deepEqual(firstTen.slice(0, 5), ['Dc', 'Pds', 'Psi', 'Lega Lombarda', 'Rifondazione Comunista']);
      assert.equal(firstTen.some(label => /^(avs|fdi|azione(?:\b|\s|-))/i.test(label)), false, '1992 must not leak modern party labels');
      const partyLabels = await page.locator('#party-select option').allTextContents();
      assert.equal(
        partyLabels.some(label => /^(?:AVS|Verdi)\s*\/|^FdI$|^Azione(?:\s*\/\s*IV)?$/i.test(label)),
        false,
        '1992 labels must preserve their historical party names'
      );
    }

    await selectMetric('party_share');
    await page.waitForFunction(() => {
      const select = document.querySelector('#party-select');
      return select && !select.disabled && select.value && select.options.length > 1;
    });
    const partyLabel = (await page.locator('#party-select option:checked').textContent()).trim();
    assert.ok(partyLabel.length > 0 && partyLabel.length < 42, `${election.label}: selected party label must be readable`);
    assert.equal(await page.locator('#sidebar-legend .legend-gradient').count(), 0, `${election.label}: party share must use discrete classes`);
    assert.equal(await page.locator('#sidebar-legend .legend-item').count(), 6, `${election.label}: party share must expose five classes plus no data`);
    const fillBuckets = Number(await page.locator('#map-canvas').getAttribute('data-fill-buckets'));
    assert.ok(fillBuckets > 5 && fillBuckets <= 20, `${election.label}: five bands must retain performant internal shades (${fillBuckets} buckets)`);

    await page.fill('#municipality-search', 'Roma');
    await page.dispatchEvent('#municipality-search', 'change');
    await page.waitForFunction(() => !document.querySelector('#selection-dock')?.classList.contains('hidden'));
    await page.waitForFunction(() => (
      document.querySelector('#selection-dock-metric-label')?.textContent.trim().toLowerCase() === 'quota del partito'
      && document.querySelectorAll('#selection-dock-party-results .selection-result-row').length >= 5
    ));
    assert.equal((await page.locator('#selection-dock-title').innerText()).trim(), 'Roma (Roma)');
    const selectedCard = await page.locator('#selection-dock').innerText();
    assert.match(selectedCard, /Affluenza/i);
    assert.match(selectedCard, /Voto nel comune/i);
    assert.match(selectedCard, /voti validi/i);
    assert.equal(
      (await page.locator('#selection-dock-metric-label').innerText()).trim().toLowerCase(),
      'quota del partito',
      `${election.label}: municipality headline must follow the active party-share metric`
    );
    assert.equal((await page.locator('#selection-dock-leader-name').innerText()).trim(), partyLabel);
    assert.ok(await page.locator('#selection-dock-party-results .selection-result-row').count() >= 5, `${election.label}: selected municipality must expose its party result`);
    assert.equal(await page.locator('#selection-dock-party-results .selection-result-row.is-active').count(), 1, `${election.label}: selected party must be highlighted in the municipality result`);
    await page.click('#selection-dock-clear-btn');
    await page.waitForFunction(() => document.querySelector('#selection-dock')?.classList.contains('hidden'));

    await selectMetric('turnout');
    assert.equal(await page.locator('#sidebar-legend .legend-gradient').count(), 0, `${election.label}: turnout must use discrete classes`);
    assert.equal(await page.locator('#sidebar-legend .legend-item').count(), 6, `${election.label}: turnout must expose five classes plus no data`);
    await page.fill('#municipality-search', 'Roma');
    await page.dispatchEvent('#municipality-search', 'change');
    await page.waitForFunction(() => !document.querySelector('#selection-dock')?.classList.contains('hidden'));
    assert.equal((await page.locator('#selection-dock-metric-label').innerText()).trim().toLowerCase(), 'affluenza');
    assert.match(await page.locator('#selection-dock').innerText(), /Voto nel comune/i);
    await page.click('#selection-dock-clear-btn');

    await selectMetric('margin');
    const marginLegend = await page.locator('#sidebar-legend .legend-item').allTextContents();
    assert.equal(marginLegend.length, 6, `${election.label}: margin must expose five classes plus no data`);
    assert.ok(marginLegend.slice(0, -1).every(label => label.includes('pt')), `${election.label}: margin legend must use points`);

    await selectMetric('dominant_block');
    const blockLegend = await page.locator('#sidebar-legend .legend-item').allTextContents();
    assert.ok(blockLegend.some(label => label.includes('Centro')), `${election.label}: political-area legend must use public labels`);
    assert.equal(blockLegend.some(label => label.trim() === 'altro'), false, `${election.label}: technical block labels must not leak into the UI`);

    audit.push({ election: election.label, national: nationalRows, selectedParty: partyLabel });
  }

  const election2013 = await page.locator('#election-select option').evaluateAll(options => (
    options
      .map(option => ({ value: option.value, label: option.textContent.trim() }))
      .find(option => option.label.includes('2013'))
  ));
  assert.ok(election2013, 'Camera 2013 must be available for the historical municipality smoke');
  await page.selectOption('#metric-select', 'turnout');
  await page.selectOption('#election-select', election2013.value);
  await waitForMap(election2013.value, 'turnout');
  await page.fill('#municipality-search', 'Brembilla');
  await page.dispatchEvent('#municipality-search', 'change');
  await page.waitForFunction(() => !document.querySelector('#selection-dock')?.classList.contains('hidden'));
  await page.waitForFunction(() => document.querySelectorAll('#selection-dock-party-results .selection-result-row').length >= 5);
  assert.equal(
    (await page.locator('#selection-dock-title').innerText()).trim(),
    'Val Brembilla (Bergamo)',
    'a historical municipality name must resolve implicitly to the current mapped municipality'
  );
  assert.match(await page.locator('#selection-dock').innerText(), /Affluenza/i);
  assert.ok(
    await page.locator('#selection-dock-party-results .selection-result-row').count() >= 5,
    'the harmonized municipality must retain the complete 2013 election result'
  );
  await page.click('#selection-dock-clear-btn');

  await page.goto(`${baseUrl}municipality-detail.html?id=058091&election=camera_1992&metric=party_share&party=Dc`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#detail-current-election .detail-current-winner'));
  await page.waitForFunction(() => document.querySelectorAll('#detail-election-results .detail-election-result-row').length >= 5);
  const profileResources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  assert.ok(profileResources.some(name => name.includes('/municipality_profiles/index.json')));
  assert.ok(profileResources.some(name => name.includes('/municipality_profiles/chunks/058.json.gz')));
  assert.equal(profileResources.some(name => /\/municipality_summary\.csv(?:$|\?)/.test(name)), false, 'municipality detail must not load the 51 MB national summary');
  const currentElectionCard = await page.locator('#detail-current-election').innerText();
  assert.match(currentElectionCard, /Camera 1992/);
  assert.match(currentElectionCard, /\bDC\b/i);
  assert.match(currentElectionCard, /Quota del partito/i);
  assert.match(currentElectionCard, /Affluenza/i);
  assert.match(currentElectionCard, /Posizione/i);
  assert.doesNotMatch(currentElectionCard, /camera_1992|summary|runtime/i);
  assert.ok(await page.locator('#detail-election-results .detail-election-result-row').count() >= 10, 'municipality detail must show the complete party result');
  assert.equal(await page.locator('#detail-election-results .detail-election-result-row.is-active').count(), 1, 'party context from the map must stay highlighted in the detail page');
  assert.match(await page.locator('#detail-election-result-total').innerText(), /voti validi/i);
  assert.equal((await page.locator('#detail-name').innerText()).trim(), 'Roma');
  assert.doesNotMatch(await page.locator('#detail-standfirst').innerText(), /Romallo|Trento/i);

  const sectionOrder = await page.locator('#main-content > section.doc-section').evaluateAll(sections => (
    sections.map(section => section.id)
  ));
  assert.deepEqual(sectionOrder, [
    'detail-charts-section',
    'detail-winners-section',
    'detail-kpi-section',
    'detail-anagrafica-section',
    'detail-history-section'
  ]);
  const detailCopy = await page.locator('#main-content').innerText();
  assert.doesNotMatch(detailCopy, /\bflip\b|\bsummary\b|\bruntime\b|\bpp\b/i);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 1, `municipality detail must not overflow on mobile (${mobileOverflow}px)`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}data-download.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#party-taxonomy-table-body tr').length === 30);
  assert.equal(await page.locator('#party-taxonomy-summary > *').count(), 3, 'party taxonomy summary must expose its national audit');
  assert.equal(await page.locator('#party-taxonomy-table-body tr').count(), 30, 'party taxonomy audit must cover every published election');
  assert.match(await page.locator('#party-taxonomy-summary').innerText(), /99[,.]5\d%/, 'public data page must expose overall classified vote coverage');
  const taxonomy1992 = await page.locator('#party-taxonomy-table-body tr').filter({ hasText: 'camera_1992' }).innerText();
  assert.match(taxonomy1992, /99[,.]2\d%/, '1992 must retain high classification coverage without modern aliases');

  await page.goto(`${baseUrl}usage-notes.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#party-taxonomy-method-grid .doc-card').length === 3);
  assert.equal(await page.locator('#party-taxonomy-method-grid .doc-card').count(), 3, 'party taxonomy method must remain public');

  assert.deepEqual(runtimeErrors, []);
  console.log(`public explorer smoke: ok (${audit.map(row => row.election).join(', ')}; municipality detail)`);
} finally {
  await browser.close();
}
