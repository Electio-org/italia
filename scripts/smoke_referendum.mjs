import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { aggregateReferendumRows, referendumMetric, validateReferendumBundle, createReferendumLoader } from '../modules/referendums.js';

const root = new URL('../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const catalog = read('data/derived/referendums/index.json');
const entry = catalog.consultations[0];
const payload = JSON.parse(gunzipSync(readFileSync(new URL(entry.path, root))));
const bundle = validateReferendumBundle(payload);
const audit = read(entry.audit_path);
assert.equal(bundle.municipalities.length, 7897);
assert.equal(audit.source_municipalities, 7998);
assert.equal(audit.excluded.length, 5);
assert.ok(audit.excluded.every(row => row.status === 'ambiguous_split'));
assert.equal(bundle.byId.has('081021'), false, 'pre-split Trapani must not be attributed to its smaller 2021 boundary');
assert.equal(bundle.consultation.quorum_required, false);
assert.equal(audit.national.yes_votes, 12708172);
assert.equal(audit.national.no_votes, 19026617);
assert.equal(audit.national.voters, 31997916);
assert.equal(audit.national.electors, 46720943);
const national = aggregateReferendumRows(bundle.municipalities);
for (const field of ['yes_votes', 'no_votes', 'voters', 'electors', 'blank_votes']) {
  assert.equal(national[field] + audit.excluded.reduce((sum, row) => sum + row[field], 0), audit.national[field]);
}
assert.ok(bundle.byId.has('058091'), 'Roma must resolve by ISTAT code');
assert.ok(bundle.municipalities.some(row => row.source_count > 1), 'merged municipalities sum their predecessors');
assert.equal(referendumMetric({ yes_share: null }, 'yes_share'), null);
assert.equal(referendumMetric({ yes_share: 0 }, 'yes_share'), 0);
assert.equal(referendumMetric({ yes_share: '' }, 'yes_share'), null);
assert.equal(aggregateReferendumRows([]).yes_share, null);
assert.throws(() => validateReferendumBundle({ ...payload, municipalities: [payload.municipalities[0], payload.municipalities[0]] }));
let calls = 0;
const loader = createReferendumLoader(async () => { calls++; return payload; });
assert.equal(await loader.load(entry), await loader.load(entry));
assert.equal(calls, 1, 'session cache must reuse the data');
let failures = 0;
const retry = createReferendumLoader(async () => { if (!failures++) throw Error('transient'); return payload; });
await assert.rejects(retry.load(entry));
assert.equal((await retry.load(entry)).municipalities.length, 7897);
console.log('Referendum data contract: PASS');

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, serviceWorkers: 'block' });
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.goto(new URL('referendum.html', process.env.BASE_URL || 'http://127.0.0.1:4173/').href);
      await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
      assert.equal(await page.locator('#loading').isHidden(), true);
      assert.match(await page.locator('#national').innerText(), /40,0%/);
      assert.equal(requests.some(url => url.includes('results_by_election') || url.includes('municipality_results_long')), false);
      const pixels = await page.locator('canvas').evaluate(canvas => {
        const context = canvas.getContext('2d'), data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let filled = 0;
        for (let i = 0; i < data.length; i += 64) if (data[i + 3] && !(data[i] === 234 && data[i + 1] === 240 && data[i + 2] === 236)) filled++;
        return filled / Math.ceil(data.length / 64);
      });
      assert.ok(pixels > .02, `map must be nonblank at ${viewport.width}px`);
      const before = requests.length;
      await page.selectOption('#metric', 'balance');
      await page.waitForFunction(() => !document.querySelector('#metric').disabled);
      assert.equal(requests.length, before, 'metric changes must never fetch data');
      await page.fill('#search', '058091');
      await page.dispatchEvent('#search', 'change');
      await page.waitForFunction(() => !document.querySelector('#selection').hidden);
      assert.match(await page.locator('#selection h2').innerText(), /Roma/);
      assert.match(await page.locator('#selection .headline').innerText(), /avanti/);
      assert.equal(await page.locator('canvas').evaluate(canvas => canvas.__zoom.k > 1), true);
      await page.locator('canvas').scrollIntoViewIfNeeded();
      const map = await page.locator('canvas').boundingBox();
      await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
      await page.waitForTimeout(450);
      assert.equal(await page.locator('#tooltip').isVisible(), true, 'hover remains hit-testable after fitting a municipality');
      await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
      assert.equal(await page.locator('#selection').isHidden(), true, 'clicking the selected municipality must deselect');
      await page.fill('#search', '058091');
      await page.dispatchEvent('#search', 'change');
      assert.equal(await page.locator('#selection').isVisible(), true);
      await page.selectOption('#metric', 'turnout');
      await page.waitForFunction(() => !document.querySelector('#metric').disabled);
      assert.match(await page.locator('#selection .headline').innerText(), /Affluenza:/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#selection').isHidden(), true);
      await page.locator('#reset').click();
      assert.equal(await page.locator('canvas').evaluate(canvas => canvas.__zoom.k), 1);
      await page.selectOption('#metric', 'balance');
      await page.waitForFunction(() => !document.querySelector('#metric').disabled);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#download').click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /referendum-2016-balance\.png$/);
      assert.equal(await download.failure(), null);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `build/_referendum-${viewport.width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Referendum desktop/mobile browser smoke: PASS');
  } finally { await browser.close(); }
}
