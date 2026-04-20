import assert from 'node:assert/strict';

import {
  appendSummaryRowsToIndices,
  initStaticIndices
} from '../modules/selectors.js';

const nearlyEqual = (actual, expected, label) => {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  );
};

const state = {
  lineage: [],
  summary: [],
  mapReadyRows: [],
  resultsLong: [],
  indices: {}
};

initStaticIndices(state);

appendSummaryRowsToIndices(state, [
  {
    election_key: 'camera_2022',
    municipality_id: 'big-town',
    province: 'MI',
    electors: 1000,
    voters: 700,
    valid_votes: 1000,
    turnout_pct: 70,
    first_party_share: 60,
    second_party_share: 30,
    first_second_margin: 30
  },
  {
    election_key: 'camera_2022',
    municipality_id: 'small-town',
    province: 'MI',
    electors: 100,
    voters: 50,
    valid_votes: 100,
    turnout_pct: 50,
    first_party_share: 20,
    second_party_share: 10,
    first_second_margin: 10
  },
  {
    election_key: 'camera_2022',
    municipality_id: 'other-province',
    province: 'BG',
    electors: 400,
    voters: 200,
    valid_votes: 400,
    turnout_pct: 50,
    first_party_share: 40,
    second_party_share: 25,
    first_second_margin: 15
  }
]);

const mi = state.indices.provinceSummaryMap.get('camera_2022__MI');
assert.ok(mi, 'province aggregate should exist');
assert.equal(mi.electors, 1100);
assert.equal(mi.voters, 750);
assert.equal(mi.valid_votes, 1100);
nearlyEqual(mi.turnout_pct, (750 / 1100) * 100, 'province turnout');
nearlyEqual(mi.first_party_share, ((600 + 20) / 1100) * 100, 'province first party share');
nearlyEqual(mi.second_party_share, ((300 + 10) / 1100) * 100, 'province second party share');
nearlyEqual(mi.margin, ((600 + 20 - 300 - 10) / 1100) * 100, 'province margin');

const region = state.indices.regionSummaryMap.get('camera_2022');
assert.ok(region, 'region aggregate should exist');
assert.equal(region.electors, 1500);
assert.equal(region.voters, 950);
assert.equal(region.valid_votes, 1500);
nearlyEqual(region.turnout_pct, (950 / 1500) * 100, 'region turnout');
nearlyEqual(region.first_party_share, ((600 + 20 + 160) / 1500) * 100, 'region first party share');
nearlyEqual(region.second_party_share, ((300 + 10 + 100) / 1500) * 100, 'region second party share');
nearlyEqual(region.margin, ((600 + 20 + 160 - 300 - 10 - 100) / 1500) * 100, 'region margin');

console.log('selector aggregate smoke passed');
