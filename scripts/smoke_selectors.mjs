import assert from 'node:assert/strict';
import { ensureGeometry } from '../modules/data.js';

globalThis.d3 = {
  mean: values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
};

const {
  appendRowsToIndices,
  aggregateShareFor,
  getNationalPartyResultsForElection,
  getPartyOptionsForElection,
  getResultsForElection
} = await import('../modules/selectors.js');

const state = {
  indices: {},
  summary: [],
  resultsLong: [],
  lineage: [],
  selectedPartyMode: 'party_raw',
  coalitionLookupByElection: new Map()
};

const rows = [
  { election_key: 'e1', municipality_id: 'm1', party_raw: 'A', party_std: 'A', party_family: 'alpha', bloc: 'sinistra', votes: 30, vote_share: 30 },
  { election_key: 'e1', municipality_id: 'm1', party_raw: 'B', party_std: 'B', party_family: 'beta', bloc: 'destra', votes: 70, vote_share: 70 },
  { election_key: 'e1', municipality_id: 'm2', party_raw: 'A', party_std: 'A', party_family: 'alpha', bloc: 'sinistra', votes: 40, vote_share: 40 },
  { election_key: 'e1', municipality_id: 'm2', party_raw: 'B', party_std: 'B', party_family: 'beta', bloc: 'destra', votes: 60, vote_share: 60 },
  { election_key: 'e2', municipality_id: 'm1', party_raw: 'C', party_std: 'C', party_family: 'gamma', bloc: 'centro', votes: 100, vote_share: 100 }
];

state.summary = [
  { election_key: 'e1', municipality_id: 'm1', first_party_std: 'stale-a', first_party_share: 1 },
  { election_key: 'e1', municipality_id: 'm2', first_party_std: 'stale-b', first_party_share: 1 },
  { election_key: 'e2', municipality_id: 'm1', first_party_std: 'stale-c', first_party_share: 1 }
];

state.resultsLong = rows.slice(0, 2);
appendRowsToIndices(state, { rebuild: true });
state.resultsLong.push(...rows.slice(2));
appendRowsToIndices(state, { resultRows: rows.slice(2) });

assert.equal(getResultsForElection(state, 'e1').length, 4);
assert.equal(getResultsForElection(state, 'e2').length, 1);
assert.deepEqual(getPartyOptionsForElection(state, 'e1'), ['B', 'A']);
assert.equal(aggregateShareFor(state, 'e1', 'm1', 'A'), 30);
assert.equal(aggregateShareFor(state, 'e1', 'm2', 'B'), 60);
assert.equal(aggregateShareFor(state, 'e1', 'm2', 'missing'), null);
assert.deepEqual(
  getNationalPartyResultsForElection(state, 'e1').map(row => [row.label, row.share]),
  [['B', 65], ['A', 35]]
);
assert.equal(state.indices.summaryMap.get('e1__m1').first_party_runtime, 'B');
assert.equal(state.indices.summaryMap.get('e1__m1').first_party_runtime_share, 70);
assert.equal(state.indices.summaryMap.get('e1__m2').first_party_runtime, 'B');
assert.equal(state.indices.summaryMap.get('e2__m1').first_party_runtime, 'C');

state.selectedPartyMode = 'bloc';
assert.equal(aggregateShareFor(state, 'e1', 'm1', 'destra'), 70);
assert.equal(aggregateShareFor(state, 'e1', 'm2', 'sinistra'), 40);

const featureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] };
let attempts = 0;
const geometryIssues = [];
const geometryState = {
  geometryPack: { municipalities: { '2021': 'municipalities.topojson.gz' } },
  geometryCache: {},
  geometryResolver: async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Transient fetch failure');
    return featureCollection;
  }
};
assert.equal(await ensureGeometry(geometryState, 'municipalities', 2021, (...args) => geometryIssues.push(args)), featureCollection);
assert.equal(attempts, 2, 'initial geometry failure must recover with one retry');
assert.equal(await ensureGeometry(geometryState, 'municipalities', 2021), featureCollection);
assert.equal(attempts, 2, 'successful geometry must stay cached');
assert.equal(geometryIssues.length, 0, 'a recovered error must not leave a persistent issue');
delete geometryState.geometryCache.municipalities[2021];
geometryState.geometryResolver = async () => { throw new TypeError('Offline'); };
await ensureGeometry(geometryState, 'municipalities', 2021, (...args) => geometryIssues.push(args));
assert.equal(geometryState.geometryCache.municipalities[2021], undefined, 'failed geometry must not stay cached');
geometryState.geometryResolver = async () => featureCollection;
assert.equal(await ensureGeometry(geometryState, 'municipalities', 2021), featureCollection, 'a later retry must recover the same session');
console.log('selector smoke: ok (including geometry retry and cache recovery)');
