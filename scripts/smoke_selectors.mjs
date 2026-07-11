import assert from 'node:assert/strict';

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

console.log('selector smoke: ok');
