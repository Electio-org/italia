import { safeNumber, mean } from './shared.js';
import { currentGeometryJoinSet, rowJoinKey } from './data.js';

export function buildIndices(state) {
  state.indices.summaryByMunicipality = d3.group(state.summary, d => d.municipality_id);
  state.indices.resultsByElectionMunicipality = d3.group(state.resultsLong, d => d.election_key, d => d.municipality_id);
  state.indices.summaryMap = new Map(state.summary.map(r => [`${r.election_key}__${r.municipality_id}`, r]));
  state.indices.summaryCountByElection = d3.rollup(state.summary, v => v.length, d => d.election_key);
  state.indices.resultCountByElection = d3.rollup(state.resultsLong, v => v.length, d => d.election_key);
  state.indices.resultsMap = new Map();
  state.resultsLong.forEach(r => {
    const key = `${r.election_key}__${r.municipality_id}`;
    if (!state.indices.resultsMap.has(key)) state.indices.resultsMap.set(key, []);
    state.indices.resultsMap.get(key).push(r);
  });
  state.indices.lineageMap = new Map(state.lineage.map(r => [r.municipality_id_stable || r.municipality_id || r.municipality_id_current, r]));

  const provinceAcc = new Map();
  const regionAcc = new Map();
  state.summary.forEach(r => {
    const electors = safeNumber(r.electors) || 0;
    const voters = safeNumber(r.voters) || 0;
    const validVotes = safeNumber(r.valid_votes) || 0;
    if (r.province) {
      const key = `${r.election_key}__${r.province}`;
      const acc = provinceAcc.get(key) || { electors: 0, voters: 0, valid_votes: 0, n: 0, turnout_values: [] };
      acc.electors += electors;
      acc.voters += voters;
      acc.valid_votes += validVotes;
      acc.n += 1;
      if (Number.isFinite(safeNumber(r.turnout_pct))) acc.turnout_values.push(safeNumber(r.turnout_pct));
      provinceAcc.set(key, acc);
    }
    const rKey = `${r.election_key}`;
    const rAcc = regionAcc.get(rKey) || { electors: 0, voters: 0, valid_votes: 0, n: 0, turnout_values: [] };
    rAcc.electors += electors;
    rAcc.voters += voters;
    rAcc.valid_votes += validVotes;
    rAcc.n += 1;
    if (Number.isFinite(safeNumber(r.turnout_pct))) rAcc.turnout_values.push(safeNumber(r.turnout_pct));
    regionAcc.set(rKey, rAcc);
  });
  state.indices.provinceSummaryMap = new Map([...provinceAcc.entries()].map(([k, acc]) => [k, { turnout_pct: acc.electors > 0 ? (acc.voters / acc.electors) * 100 : mean(acc.turnout_values), n: acc.n, electors: acc.electors, voters: acc.voters, valid_votes: acc.valid_votes }]));
  state.indices.regionSummaryMap = new Map([...regionAcc.entries()].map(([k, acc]) => [k, { turnout_pct: acc.electors > 0 ? (acc.voters / acc.electors) * 100 : mean(acc.turnout_values), n: acc.n, electors: acc.electors, voters: acc.voters, valid_votes: acc.valid_votes }]));

  state.indices.provinceGroupMaps = { party_std: new Map(), party_family: new Map(), bloc: new Map() };
  state.indices.regionGroupMaps = { party_std: new Map(), party_family: new Map(), bloc: new Map() };
  ['party_std', 'party_family', 'bloc'].forEach(mode => {
    const field = mode === 'bloc' ? 'bloc' : mode;
    const provinceVotes = new Map();
    const regionVotes = new Map();
    state.resultsLong.forEach(r => {
      const group = r[field] || 'N/D';
      const votes = safeNumber(r.votes) || 0;
      if (r.province) {
        const key = `${r.election_key}__${r.province}__${group}`;
        provinceVotes.set(key, (provinceVotes.get(key) || 0) + votes);
      }
      const regionKey = `${r.election_key}__${group}`;
      regionVotes.set(regionKey, (regionVotes.get(regionKey) || 0) + votes);
    });
    provinceVotes.forEach((votes, key) => {
      const [electionKey, province] = key.split('__');
      const denom = state.indices.provinceSummaryMap.get(`${electionKey}__${province}`)?.valid_votes || 0;
      state.indices.provinceGroupMaps[mode].set(key, denom > 0 ? (votes / denom) * 100 : null);
    });
    regionVotes.forEach((votes, key) => {
      const electionKey = key.split('__')[0];
      const denom = state.indices.regionSummaryMap.get(electionKey)?.valid_votes || 0;
      state.indices.regionGroupMaps[mode].set(key, denom > 0 ? (votes / denom) * 100 : null);
    });
  });
}

export function getSummaryRow(state, electionKey, municipalityId) {
  return state.indices.summaryMap?.get(`${electionKey}__${municipalityId}`) || null;
}

export function getResultsRows(state, electionKey, municipalityId) {
  return (state.indices.resultsMap?.get(`${electionKey}__${municipalityId}`) || []).slice().sort((a, b) => (safeNumber(a.rank) || 999) - (safeNumber(b.rank) || 999));
}

export function aggregateShareFor(state, electionKey, municipalityId, selectedParty = state.selectedParty) {
  const rows = getResultsRows(state, electionKey, municipalityId);
  if (!rows.length || !selectedParty) return null;
  const field = state.selectedPartyMode === 'bloc' ? 'bloc' : state.selectedPartyMode;
  const matches = rows.filter(r => String(r[field] || '') === String(selectedParty));
  return matches.length ? d3.sum(matches, r => safeNumber(r.vote_share) || 0) : null;
}

export function computeConcentration(state, municipalityId, electionKey = state.selectedElection) {
  const rows = getResultsRows(state, electionKey, municipalityId);
  if (!rows.length) return null;
  return d3.sum(rows.map(r => { const p = (safeNumber(r.vote_share) || 0) / 100; return p * p; })) * 100;
}

export function computeDominanceChanges(state, municipalityId) {
  const rows = (state.indices.summaryByMunicipality.get(municipalityId) || []).filter(r => r.first_party_std).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  let changes = 0;
  rows.forEach((r, i) => { if (i && r.first_party_std !== rows[i - 1].first_party_std) changes += 1; });
  return changes;
}

export function computeVolatility(state, municipalityId) {
  const rows = (state.indices.summaryByMunicipality.get(municipalityId) || []).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  const vals = rows.map(r => aggregateShareFor(state, r.election_key, municipalityId)).filter(v => v != null);
  if (vals.length < 2) return null;
  return mean(vals.slice(1).map((v, i) => Math.abs(v - vals[i])));
}

export function computeStabilityIndex(state, municipalityId) {
  const v = computeVolatility(state, municipalityId);
  const c = computeDominanceChanges(state, municipalityId) || 0;
  if (v == null) return null;
  return Math.max(0, 100 - v * 2.4 - c * 6);
}

export function computeOverPerformanceProvince(state, row) {
  if (!row) return null;
  const own = aggregateShareFor(state, row.election_key, row.municipality_id);
  const prov = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${row.province}__${state.selectedParty}`);
  return own != null && prov != null ? own - prov : null;
}

export function computeOverPerformanceRegion(state, row) {
  if (!row) return null;
  const own = aggregateShareFor(state, row.election_key, row.municipality_id);
  const reg = state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${state.selectedParty}`);
  return own != null && reg != null ? own - reg : null;
}

export function selectedShareSeriesForMunicipality(state, municipalityId) {
  return (state.indices.summaryByMunicipality.get(municipalityId) || [])
    .slice()
    .sort((a, b) => (a.election_year || 0) - (b.election_year || 0))
    .map(r => ({ year: r.election_year, election_key: r.election_key, value: aggregateShareFor(state, r.election_key, municipalityId) }))
    .filter(d => d.value != null);
}

export function computeTrajectorySegments(state, profileRows) {
  const series = (profileRows || []).map(r => ({ year: r.election_year, leader: r.first_party_std || 'N/D', value: aggregateShareFor(state, r.election_key, r.municipality_id) })).filter(d => d.year != null);
  const out = [];
  series.forEach(item => {
    const prev = out.at(-1);
    if (!prev || prev.leader !== item.leader) out.push({ leader: item.leader, from: item.year, to: item.year, max: item.value, min: item.value });
    else { prev.to = item.year; prev.max = Math.max(prev.max, item.value || prev.max); prev.min = Math.min(prev.min, item.value || prev.min); }
  });
  return out;
}

export function longestLeaderRun(state, profileRows) {
  const segs = computeTrajectorySegments(state, profileRows);
  if (!segs.length) return null;
  return segs.slice().sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
}

export function shareTrendLabel(series) {
  if (!series || series.length < 2) return 'trend n/d';
  const delta = series.at(-1).value - series[0].value;
  if (delta >= 5) return 'crescita netta';
  if (delta <= -5) return 'calo netto';
  return 'andamento stabile';
}

export function getMetricValue(state, row) {
  if (!row) return null;
  switch (state.selectedMetric) {
    case 'first_party': return row.first_party_std || null;
    case 'party_share': return aggregateShareFor(state, row.election_key, row.municipality_id);
    case 'turnout': return safeNumber(row.turnout_pct);
    case 'margin': return safeNumber(row.first_second_margin);
    case 'dominant_block': return row.dominant_block || null;
    case 'swing_compare': {
      const current = aggregateShareFor(state, row.election_key, row.municipality_id);
      const compare = state.compareElection ? aggregateShareFor(state, state.compareElection, row.municipality_id) : null;
      return current != null && compare != null ? current - compare : null;
    }
    case 'delta_turnout': {
      const compareRow = state.compareElection ? getSummaryRow(state, state.compareElection, row.municipality_id) : null;
      return compareRow ? (safeNumber(row.turnout_pct) - safeNumber(compareRow.turnout_pct)) : null;
    }
    case 'volatility': return computeVolatility(state, row.municipality_id);
    case 'dominance_changes': return computeDominanceChanges(state, row.municipality_id);
    case 'concentration': return computeConcentration(state, row.municipality_id, row.election_key);
    case 'over_performance_province': return computeOverPerformanceProvince(state, row);
    case 'over_performance_region': return computeOverPerformanceRegion(state, row);
    case 'stability_index': return computeStabilityIndex(state, row.municipality_id);
    case 'custom_indicator': {
      const rec = state.customIndicators.find(d => d.election_key === row.election_key && d.municipality_id === row.municipality_id && (d.indicator_key || d.key) === state.selectedCustomIndicator);
      return rec ? safeNumber(rec.value) : null;
    }
    default: return null;
  }
}

export function inferTurnoutTier(state, municipalityId) {
  const rows = (state.indices.summaryByMunicipality.get(municipalityId) || []).filter(r => r.turnout_pct != null);
  const avg = mean(rows.map(r => r.turnout_pct));
  if (avg == null) return 'turnout n/d';
  if (avg >= 82) return 'alta affluenza';
  if (avg >= 72) return 'affluenza intermedia';
  return 'bassa affluenza';
}

export function getSelectedRows(state, { matchesCompleteness = () => true, matchesTerritorialStatus = () => true } = {}) {
  const provincesKey = [...state.selectedProvinceSet].sort().join('|');
  const cacheKey = ['selectedRows', state.selectedElection || '', state.territorialMode || '', provincesKey, state.selectedCompleteness || '', state.selectedTerritorialStatus || '', state.summary.length].join('__');
  if (cacheKey in state.selectorCaches) return state.selectorCaches[cacheKey];
  const rows = state.summary.filter(row => {
    if (state.selectedElection && row.election_key !== state.selectedElection) return false;
    if (state.territorialMode && row.territorial_mode && row.territorial_mode !== state.territorialMode) return false;
    if (state.selectedProvinceSet.size && !state.selectedProvinceSet.has(row.province)) return false;
    if (!matchesCompleteness(row)) return false;
    if (!matchesTerritorialStatus(row)) return false;
    return true;
  });
  state.selectorCaches[cacheKey] = rows;
  return rows;
}

export function filteredRowsWithMetric(state, { matchesCompleteness = () => true, matchesTerritorialStatus = () => true } = {}) {
  const provincesKey = [...state.selectedProvinceSet].sort().join('|');
  const geometryKey = state.geometry?.features?.length ? `${state.geometry.features.length}` : 'nogeom';
  const cacheKey = ['rowsWithMetric', state.selectedElection || '', state.compareElection || '', state.selectedMetric || '', state.selectedPartyMode || '', state.selectedParty || '', state.selectedCustomIndicator || '', state.territorialMode || '', provincesKey, state.selectedCompleteness || '', state.selectedTerritorialStatus || '', state.minSharePct || 0, state.summary.length, state.resultsLong.length, geometryKey].join('__');
  if (cacheKey in state.selectorCaches) return state.selectorCaches[cacheKey];
  const geometryKeys = currentGeometryJoinSet(state.geometry);
  const rows = getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus }).map(row => {
    const joinKey = rowJoinKey(row);
    const geometry_match = joinKey ? geometryKeys.has(joinKey) : false;
    return {
      ...row,
      geometry_match,
      __metric_value: getMetricValue(state, row),
      __party_share: aggregateShareFor(state, row.election_key, row.municipality_id, state.selectedParty),
      __swing_compare: state.compareElection ? (() => {
        const current = aggregateShareFor(state, row.election_key, row.municipality_id, state.selectedParty);
        const compare = aggregateShareFor(state, state.compareElection, row.municipality_id, state.selectedParty);
        return current != null && compare != null ? current - compare : null;
      })() : null,
      __volatility: computeVolatility(state, row.municipality_id),
      __dominance_changes: computeDominanceChanges(state, row.municipality_id)
    };
  }).filter(row => (row.__party_share ?? 0) >= state.minSharePct || state.selectedMetric !== 'party_share');
  state.selectorCaches[cacheKey] = rows;
  return rows;
}
