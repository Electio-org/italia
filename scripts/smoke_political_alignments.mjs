import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { politicalContext, politicalBalance, politicalWinner } from '../modules/political-alignments.js';
import { getMetricValue } from '../modules/selectors.js';

const catalog = JSON.parse(readFileSync(new URL('../data/derived/electoral_coalitions.json', import.meta.url)));
for (const [election, definitions] of Object.entries(catalog.coalitions)) {
  const members = definitions.flatMap(group => group.parties.map(party => party.toLowerCase()));
  assert.equal(new Set(members).size, members.length, `${election}: a list must never belong to two coalitions`);
  const pair = catalog.comparisons[election];
  assert.ok(definitions.some(group => group.key === pair.left));
  assert.ok(definitions.some(group => group.key === pair.right));
}
const stateFor = (key, entries) => ({ selectedElection: key, electoralCoalitions: catalog,
  indices: { resultsByElectionRows: new Map([[key, entries.map(([party_raw, votes, municipality_id = 'm1', bloc = 'centro']) => ({ election_key: key, municipality_id, party_raw, party_std: party_raw, votes, bloc, province: 'P' }))]]) } });
const state = stateFor('camera_2022', [
  ['Partito Democratico - Italia Democratica e Progressista', 25], ['Alleanza Verdi e Sinistra', 5], ['+Europa', 2], ['Impegno Civico Luigi di Maio - Centro Democratico', 1],
  ["Fratelli d'Italia Con Giorgia Meloni", 26], ['Lega Per Salvini Premier', 9], ['Forza Italia', 8], ['Noi Moderati/Lupi - Toti - Brugnaro - Udc', 1],
  ['Movimento 5 Stelle', 15], ['Azione - Italia Viva - Calenda', 8]
]);
let context = politicalContext(state);
assert.equal(politicalContext(state), context, 'cached lookups must not rebuild the election');
assert.deepEqual(politicalBalance(context, ['m1']), { value: 11, leftShare: 33, rightShare: 44, otherShare: 23, totalVotes: 100 });
assert.equal(context.partyGroups.get('Movimento 5 Stelle'), 'm5s_2022', '2022 M5S is not in the centre-left coalition');
assert.equal(politicalWinner(context, ['m1']), 'cdx_2022');
state.selectedMetric = 'political_balance';
assert.equal(getMetricValue(state, { election_key: 'camera_2022', municipality_id: 'm1' }), 11);
state.politicalScenario = { electionKey: 'camera_2022', leftLabel: 'Ipotesi', rightLabel: 'CDX', leftParties: [...context.left.parties, 'Movimento 5 Stelle'], rightParties: [...context.right.parties] };
context = politicalContext(state);
assert.equal(politicalBalance(context, ['m1']).otherShare, 8);
assert.ok(Math.abs(politicalBalance(context, ['m1']).value + 4) < 1e-9);
assert.equal(politicalWinner(context, ['m1']), 'cdx_2022', 'a scenario must never rewrite the historical winner');
assert.equal(politicalBalance(context, ['absent']), null);

const earlier = stateFor('camera_1996', [['Pds', 20], ['Forza Italia', 30], ['Lega Nord', 20], ['Rifondazione Comunista', 30]]);
context = politicalContext(earlier);
assert.equal(politicalBalance(context, ['m1']).otherShare, 50, 'desistance and independent Lega must not be silently merged into the two poles');
const year2001 = politicalContext(stateFor('camera_2001', [['Democratici Sinistra', 30], ['Forza Italia', 40], ['Lista di Pietro', 10], ['Rifondazione Comunista', 20]]));
assert.equal(year2001.partyGroups.get('Lista di Pietro'), 'list:Lista di Pietro');
const year2006 = politicalContext(stateFor('camera_2006', [["L'Ulivo", 35], ['Forza Italia', 20], ['Fiamma Tricolore', 10], ['No Euro', 15], ['Lista autonoma', 20]]));
assert.equal(year2006.partyGroups.get('Fiamma Tricolore'), 'casa_liberta_2006');
assert.equal(year2006.partyGroups.get('No Euro'), 'casa_liberta_2006');
assert.equal(politicalBalance(year2006, ['m1']).value, 10);
const year2018 = politicalContext(stateFor('camera_2018', [['Partito Democratico', 20], ['Svp - Patt', 15], ['Lega', 25], ['Movimento 5 Stelle', 40]]));
assert.equal(year2018.partyGroups.get('Svp - Patt'), 'csx_2018', 'regional lists follow the documented election-specific links');
assert.equal(politicalBalance(year2018, ['m1']).leftShare, 35);
assert.equal(politicalWinner(year2018, ['m1']), 'm5s_2018', 'a third electoral group can win; the map must not force a red/blue winner');
const onlyOthers = politicalContext(stateFor('camera_2022', [['Partito Democratico - Italia Democratica e Progressista', 0], ["Fratelli d'Italia Con Giorgia Meloni", 0], ['Movimento 5 Stelle', 100]]));
assert.equal(politicalBalance(onlyOthers, ['m1']), null, 'no votes for either compared side is missing data, not a tie');

const proportional = politicalContext(stateFor('europee_2024', [['PD', 30, 'm1', 'centro-sinistra'], ['FdI', 40, 'm1', 'destra'], ['M5S', 30]]));
assert.equal(proportional.historical, false, 'European elections must not inherit Camera coalitions');
assert.equal(proportional.groups.size, 3);
const unequal = stateFor('camera_2022', [['Partito Democratico - Italia Democratica e Progressista', 60, 'small'], ["Fratelli d'Italia Con Giorgia Meloni", 40, 'small'], ['Partito Democratico - Italia Democratica e Progressista', 100, 'large'], ["Fratelli d'Italia Con Giorgia Meloni", 900, 'large']]);
assert.ok(Math.abs(politicalBalance(politicalContext(unequal), ['small', 'large']).value - 780 / 1100 * 100) < 1e-9, 'aggregates must use vote totals, not averages of municipal percentages');
const tied = politicalContext(stateFor('camera_2022', [['Partito Democratico - Italia Democratica e Progressista', 50], ["Fratelli d'Italia Con Giorgia Meloni", 50]]));
assert.equal(politicalBalance(tied, ['m1']).value, 0);
assert.equal(politicalWinner(tied, ['m1']), '__tie__');
const incrementalState = stateFor('camera_2022', [['Partito Democratico - Italia Democratica e Progressista', 10], ["Fratelli d'Italia Con Giorgia Meloni", 20]]);
const beforeAppend = politicalContext(incrementalState);
incrementalState.indices.resultsByElectionRows.get('camera_2022').push({ municipality_id: 'm2', party_raw: 'Movimento 5 Stelle', votes: 100 });
const afterAppend = politicalContext(incrementalState);
assert.notEqual(afterAppend, beforeAppend, 'appended results invalidate the political lookup');
assert.equal(afterAppend.totalVotes, 130);
console.log('political alignment smoke: ok (historical coalitions, standalone lists, weighted balance, scenarios, ties)');
