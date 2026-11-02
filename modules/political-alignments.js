import { safeNumber, resolvePartyMeta, inferPartyMeta } from './shared.js';

const contexts = new WeakMap();
const EMPTY_ROWS = [];
const keyForParty = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('it');
const orientation = { sinistra: -2, 'centro-sinistra': -1, centro: 0, liberale: 0, 'centro-destra': 1, destra: 2 };

export function politicalLabel(group) {
  if (!group?.label) return '';
  if (group.key.startsWith('scenario-') || group.label.includes('(aggregati)')) return group.label;
  return group.label.split(' (')[0];
}

export function politicalContext(state, electionKey = state.selectedElection) {
  const rows = state.indices?.resultsByElectionRows?.get(electionKey) || EMPTY_ROWS;
  const scenario = state.politicalScenario?.electionKey === electionKey ? state.politicalScenario : null;
  let cache = contexts.get(state);
  if (!cache) { cache = new Map(); contexts.set(state, cache); }
  const previous = cache.get(electionKey);
  if (previous?.rowCount === rows.length && previous.rows === rows && previous.scenario === scenario && previous.catalog === state.electoralCoalitions) return previous;
  const signature = JSON.stringify(scenario);
  const definitions = state.electoralCoalitions?.coalitions?.[electionKey] || [];
  const membership = new Map();
  definitions.forEach(group => group.parties.forEach(party => {
    const key = keyForParty(party);
    if (membership.has(key)) throw new Error(`Lista presente in due schieramenti: ${electionKey} / ${party}`);
    membership.set(key, group);
  }));
  const groups = new Map();
  const byMunicipality = new Map();
  const partyVotes = new Map();
  const partyGroups = new Map();
  let totalVotes = 0;
  rows.forEach(row => {
    const party = String(row.party_raw || row.party_std || '').trim();
    const votes = safeNumber(row.votes);
    if (!party || !(votes >= 0)) return;
    const definition = membership.get(keyForParty(party));
    const key = definition?.key || `list:${party}`;
    let group = groups.get(key);
    if (!group) {
      const meta = resolvePartyMeta(state.partyTaxonomyLookup, electionKey, party) || inferPartyMeta(party);
      group = { key, label: definition?.label || row.party_std || party, color: definition?.color || meta.color || '#6a757c', bloc: definition?.bloc || row.bloc, parties: new Set(), votes: 0 };
      groups.set(key, group);
    }
    group.parties.add(party);
    group.votes += votes;
    partyGroups.set(party, key);
    partyVotes.set(party, (partyVotes.get(party) || 0) + votes);
    totalVotes += votes;
    let municipality = byMunicipality.get(row.municipality_id);
    if (!municipality) {
      municipality = { totalVotes: 0, groups: new Map(), parties: new Map(), province: row.province };
      byMunicipality.set(row.municipality_id, municipality);
    }
    municipality.totalVotes += votes;
    municipality.groups.set(key, (municipality.groups.get(key) || 0) + votes);
    municipality.parties.set(party, (municipality.parties.get(party) || 0) + votes);
  });
  const ranked = [...groups.values()].sort((a, b) => b.votes - a.votes);
  const declared = state.electoralCoalitions?.comparisons?.[electionKey];
  let pair = declared ? [groups.get(declared.left), groups.get(declared.right)] : ranked.slice(0, 2);
  if (!declared) pair.sort((a, b) => (orientation[a?.bloc] || 0) - (orientation[b?.bloc] || 0));
  let [left, right] = pair;
  if (scenario) {
    const known = new Set(partyVotes.keys());
    const leftParties = new Set((Array.isArray(scenario.leftParties) ? scenario.leftParties : []).filter(party => known.has(party)));
    const rightParties = new Set((Array.isArray(scenario.rightParties) ? scenario.rightParties : []).filter(party => known.has(party) && !leftParties.has(party)));
    const makeSide = (key, label, parties) => ({ key, label: String(label || key).slice(0, 80), parties, votes: [...parties].reduce((sum, party) => sum + partyVotes.get(party), 0) });
    left = makeSide('scenario-left', scenario.leftLabel || 'Gruppo rosso', leftParties);
    right = makeSide('scenario-right', scenario.rightLabel || 'Gruppo blu', rightParties);
  }
  const provinceMunicipalities = new Map();
  byMunicipality.forEach((entry, id) => {
    if (!provinceMunicipalities.has(entry.province)) provinceMunicipalities.set(entry.province, []);
    provinceMunicipalities.get(entry.province).push(id);
  });
  const context = { rows, scenario, rowCount: rows.length, signature, catalog: state.electoralCoalitions, groups, ranked, byMunicipality, provinceMunicipalities, provinceBalances: new Map(), partyVotes, partyGroups, totalVotes, left, right, custom: Boolean(scenario), historical: definitions.length > 0 };
  cache.set(electionKey, context);
  while (cache.size > 4) cache.delete(cache.keys().next().value);
  return context;
}

export function politicalBalance(context, municipalityIds = null) {
  if (!context.left?.parties.size || !context.right?.parties.size) return null;
  let total = 0, left = 0, right = 0;
  if (municipalityIds === null) {
    total = context.totalVotes;
    left = context.left.votes;
    right = context.right.votes;
  } else {
    for (const id of municipalityIds) {
      const entry = context.byMunicipality.get(id);
      if (!entry) continue;
      total += entry.totalVotes;
      if (context.custom) {
        context.left.parties.forEach(party => { left += entry.parties.get(party) || 0; });
        context.right.parties.forEach(party => { right += entry.parties.get(party) || 0; });
      } else {
        left += entry.groups.get(context.left.key) || 0;
        right += entry.groups.get(context.right.key) || 0;
      }
    }
  }
  if (!(total > 0) || !(left + right > 0)) return null;
  return { value: (right - left) / total * 100, leftShare: left / total * 100, rightShare: right / total * 100, otherShare: Math.max(0, (total - left - right) / total * 100), totalVotes: total };
}

export function politicalWinner(context, municipalityIds) {
  const totals = new Map();
  municipalityIds.forEach(id => context.byMunicipality.get(id)?.groups.forEach((votes, key) => totals.set(key, (totals.get(key) || 0) + votes)));
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] <= 0) return null;
  return sorted[0][1] === sorted[1]?.[1] ? '__tie__' : sorted[0][0];
}
