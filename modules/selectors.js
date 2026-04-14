import { safeNumber, mean } from './shared.js';
import { currentGeometryJoinSet, rowJoinKey } from './data.js';

const GROUP_MODES = ['party_std', 'party_family', 'bloc'];
const MAP_READY_METRICS = new Set(['turnout', 'first_party', 'margin', 'dominant_block', 'party_share']);

export function initStaticIndices(state) {
  state.indices = {
    summaryByMunicipality: new Map(),
    resultsByElectionMunicipality: new Map(),
    summaryMap: new Map(),
    mapReadyByElectionMunicipality: new Map(),
    summaryCountByElection: new Map(),
    resultCountByElection: new Map(),
    mapReadyCountByElection: new Map(),
    resultsMap: new Map(),
    partyShareByElectionMunicipalityGroup: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __resultsPartyShareAcc: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __mapReadyPartyShareKeys: { party_std: new Set(), party_family: new Set(), bloc: new Set() },
    mapReadyPartyOptions: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    lineageMap: new Map((state.lineage || []).map(r => [r.municipality_id_stable || r.municipality_id || r.municipality_id_current, r])),
    provinceSummaryMap: new Map(),
    regionSummaryMap: new Map(),
    provinceGroupMaps: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    regionGroupMaps: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __provinceAcc: new Map(),
    __regionAcc: new Map(),
    __provinceVotes: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __regionVotes: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __provinceGroupKeysBySummaryKey: { party_std: new Map(), party_family: new Map(), bloc: new Map() },
    __regionGroupKeysByElection: { party_std: new Map(), party_family: new Map(), bloc: new Map() }
  };
}

function rowKey(electionKey, municipalityId) {
  return `${electionKey}__${municipalityId}`;
}

function partyShareKey(electionKey, municipalityId, group) {
  return `${electionKey}__${municipalityId}__${group}`;
}

function groupFieldForMode(mode) {
  return mode === 'bloc' ? 'bloc' : mode;
}

function pushGrouped(map, key, row) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}

function incrementCount(map, key, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + by);
}

function addKeyToSetMap(map, key, value) {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function summaryStats(acc) {
  return {
    turnout_pct: acc.electors > 0 ? (acc.voters / acc.electors) * 100 : mean(acc.turnout_values),
    n: acc.n,
    electors: acc.electors,
    voters: acc.voters,
    valid_votes: acc.valid_votes
  };
}

function addToSummaryAcc(map, key, row) {
  if (!key) return null;
  const acc = map.get(key) || { electors: 0, voters: 0, valid_votes: 0, n: 0, turnout_values: [] };
  acc.electors += safeNumber(row.electors) || 0;
  acc.voters += safeNumber(row.voters) || 0;
  acc.valid_votes += safeNumber(row.valid_votes) || 0;
  acc.n += 1;
  const turnout = safeNumber(row.turnout_pct);
  if (Number.isFinite(turnout)) acc.turnout_values.push(turnout);
  map.set(key, acc);
  return acc;
}

function recomputeVoteShareMaps(state) {
  GROUP_MODES.forEach(mode => {
    state.indices.__provinceVotes[mode].forEach((votes, key) => {
      const [electionKey, province] = key.split('__');
      const denom = state.indices.provinceSummaryMap.get(`${electionKey}__${province}`)?.valid_votes || 0;
      state.indices.provinceGroupMaps[mode].set(key, denom > 0 ? (votes / denom) * 100 : null);
    });
    state.indices.__regionVotes[mode].forEach((votes, key) => {
      const electionKey = key.split('__')[0];
      const denom = state.indices.regionSummaryMap.get(electionKey)?.valid_votes || 0;
      state.indices.regionGroupMaps[mode].set(key, denom > 0 ? (votes / denom) * 100 : null);
    });
  });
}

function recomputeGroupMapsForSummaryRows(state, summaryRows = []) {
  const touchedProvinceKeys = new Set();
  const touchedElectionKeys = new Set();
  summaryRows.forEach(row => {
    if (row.province) touchedProvinceKeys.add(`${row.election_key}__${row.province}`);
    if (row.election_key) touchedElectionKeys.add(row.election_key);
  });
  touchedProvinceKeys.forEach(summaryKey => {
    GROUP_MODES.forEach(mode => {
      const denom = state.indices.provinceSummaryMap.get(summaryKey)?.valid_votes || 0;
      (state.indices.__provinceGroupKeysBySummaryKey[mode].get(summaryKey) || new Set()).forEach(provinceKey => {
        const votes = state.indices.__provinceVotes[mode].get(provinceKey) || 0;
        state.indices.provinceGroupMaps[mode].set(provinceKey, denom > 0 ? (votes / denom) * 100 : null);
      });
    });
  });
  touchedElectionKeys.forEach(electionKey => {
    GROUP_MODES.forEach(mode => {
      const regionDenom = state.indices.regionSummaryMap.get(electionKey)?.valid_votes || 0;
      (state.indices.__regionGroupKeysByElection[mode].get(electionKey) || new Set()).forEach(regionKey => {
        const votes = state.indices.__regionVotes[mode].get(regionKey) || 0;
        state.indices.regionGroupMaps[mode].set(regionKey, regionDenom > 0 ? (votes / regionDenom) * 100 : null);
      });
    });
  });
}

export function appendSummaryRowsToIndices(state, summaryRows = []) {
  if (!state.indices?.summaryByMunicipality || !state.indices?.__provinceAcc) initStaticIndices(state);
  const rows = summaryRows || [];
  if (!rows.length) return;

  rows.forEach(row => {
    pushGrouped(state.indices.summaryByMunicipality, row.municipality_id, row);
    state.indices.summaryMap.set(rowKey(row.election_key, row.municipality_id), row);
    incrementCount(state.indices.summaryCountByElection, row.election_key);
    if (row.province) {
      const provinceKey = `${row.election_key}__${row.province}`;
      state.indices.provinceSummaryMap.set(provinceKey, summaryStats(addToSummaryAcc(state.indices.__provinceAcc, provinceKey, row)));
    }
    const regionKey = `${row.election_key}`;
    state.indices.regionSummaryMap.set(regionKey, summaryStats(addToSummaryAcc(state.indices.__regionAcc, regionKey, row)));
  });

  recomputeGroupMapsForSummaryRows(state, rows);
}

export function appendResultsLongRowsToIndices(state, resultRows = []) {
  if (!state.indices?.summaryByMunicipality || !state.indices?.__provinceAcc) initStaticIndices(state);
  const rows = resultRows || [];
  if (!rows.length) return;

  rows.forEach(row => {
    const resultKey = rowKey(row.election_key, row.municipality_id);
    pushGrouped(state.indices.resultsMap, resultKey, row);
    if (!state.indices.resultsByElectionMunicipality.has(row.election_key)) {
      state.indices.resultsByElectionMunicipality.set(row.election_key, new Map());
    }
    pushGrouped(state.indices.resultsByElectionMunicipality.get(row.election_key), row.municipality_id, row);
    incrementCount(state.indices.resultCountByElection, row.election_key);
    GROUP_MODES.forEach(mode => {
      const field = groupFieldForMode(mode);
      const group = row[field] || 'N/D';
      const votes = safeNumber(row.votes) || 0;
      const shareMap = state.indices.partyShareByElectionMunicipalityGroup[mode];
      const resultShareAcc = state.indices.__resultsPartyShareAcc[mode];
      const mapReadyKeys = state.indices.__mapReadyPartyShareKeys[mode];
      const shareKey = partyShareKey(row.election_key, row.municipality_id, group);
      const resultShare = (resultShareAcc.get(shareKey) || 0) + (safeNumber(row.vote_share) || 0);
      resultShareAcc.set(shareKey, resultShare);
      if (!mapReadyKeys.has(shareKey)) shareMap.set(shareKey, resultShare);
      if (row.province) {
        const summaryKey = `${row.election_key}__${row.province}`;
        const provinceKey = `${row.election_key}__${row.province}__${group}`;
        const total = (state.indices.__provinceVotes[mode].get(provinceKey) || 0) + votes;
        state.indices.__provinceVotes[mode].set(provinceKey, total);
        addKeyToSetMap(state.indices.__provinceGroupKeysBySummaryKey[mode], summaryKey, provinceKey);
        const denom = state.indices.provinceSummaryMap.get(summaryKey)?.valid_votes || 0;
        state.indices.provinceGroupMaps[mode].set(provinceKey, denom > 0 ? (total / denom) * 100 : null);
      }
      const regionKey = `${row.election_key}__${group}`;
      const total = (state.indices.__regionVotes[mode].get(regionKey) || 0) + votes;
      state.indices.__regionVotes[mode].set(regionKey, total);
      addKeyToSetMap(state.indices.__regionGroupKeysByElection[mode], row.election_key, regionKey);
      const denom = state.indices.regionSummaryMap.get(row.election_key)?.valid_votes || 0;
      state.indices.regionGroupMaps[mode].set(regionKey, denom > 0 ? (total / denom) * 100 : null);
    });
  });
}

export function appendMapReadyRowsToIndices(state, mapReadyRows = []) {
  if (!state.indices?.summaryByMunicipality || !state.indices?.__provinceAcc) initStaticIndices(state);
  const rows = mapReadyRows || [];
  if (!rows.length) return;

  rows.forEach(row => {
    state.indices.mapReadyByElectionMunicipality.set(rowKey(row.election_key, row.municipality_id), row);
    incrementCount(state.indices.mapReadyCountByElection, row.election_key);
    GROUP_MODES.forEach(mode => {
      const target = state.indices.mapReadyPartyOptions[mode];
      if (!target.has(row.election_key)) target.set(row.election_key, new Set());
      Object.entries(row.shares?.[mode] || {}).forEach(([group, share]) => {
        if (group) target.get(row.election_key).add(group);
        const value = safeNumber(share);
        if (group && value != null) {
          state.indices.partyShareByElectionMunicipalityGroup[mode].set(
            partyShareKey(row.election_key, row.municipality_id, group),
            value
          );
          state.indices.__mapReadyPartyShareKeys[mode].add(partyShareKey(row.election_key, row.municipality_id, group));
        }
      });
    });
  });
}

export function appendRowsToIndices(state, { summaryRows = [], resultRows = [], mapReadyRows = [], rebuild = false } = {}) {
  if (rebuild || !state.indices?.summaryByMunicipality || !state.indices?.__provinceAcc) {
    buildIndices(state);
    return;
  }
  appendSummaryRowsToIndices(state, summaryRows);
  appendMapReadyRowsToIndices(state, mapReadyRows);
  appendResultsLongRowsToIndices(state, resultRows);
}

export function buildIndices(state) {
  initStaticIndices(state);
  appendSummaryRowsToIndices(state, state.summary || []);
  appendMapReadyRowsToIndices(state, state.mapReadyRows || []);
  appendResultsLongRowsToIndices(state, state.resultsLong || []);
  if ((state.summary || []).length && (state.resultsLong || []).length) recomputeVoteShareMaps(state);
}

export function getSummaryRow(state, electionKey, municipalityId) {
  return state.indices.summaryMap?.get(rowKey(electionKey, municipalityId))
    || state.indices.mapReadyByElectionMunicipality?.get(rowKey(electionKey, municipalityId))
    || null;
}

export function getResultsRows(state, electionKey, municipalityId) {
  return (state.indices.resultsMap?.get(rowKey(electionKey, municipalityId)) || []).slice().sort((a, b) => (safeNumber(a.rank) || 999) - (safeNumber(b.rank) || 999));
}

export function mapReadyShareFor(state, electionKey, municipalityId, selectedParty = state.selectedParty, partyMode = state.selectedPartyMode) {
  if (!selectedParty) return null;
  const field = groupFieldForMode(partyMode);
  const value = state.indices.partyShareByElectionMunicipalityGroup?.[field]?.get(partyShareKey(electionKey, municipalityId, selectedParty));
  return value == null ? null : safeNumber(value);
}

export function mapReadyPartyOptionsFor(state, electionKey, partyMode = state.selectedPartyMode) {
  const field = groupFieldForMode(partyMode);
  const byElection = state.indices.mapReadyPartyOptions?.[field];
  if (!byElection) return [];
  const values = new Set();
  const keys = electionKey ? [electionKey] : [...byElection.keys()];
  keys.forEach(key => {
    (byElection.get(key) || new Set()).forEach(value => {
      if (value) values.add(value);
    });
  });
  return [...values].sort((a, b) => String(a).localeCompare(String(b), 'it'));
}

export function aggregateShareFor(state, electionKey, municipalityId, selectedParty = state.selectedParty) {
  const ready = mapReadyShareFor(state, electionKey, municipalityId, selectedParty);
  if (ready != null) return ready;
  const rows = getResultsRows(state, electionKey, municipalityId);
  if (!rows.length || !selectedParty) return null;
  const field = state.selectedPartyMode === 'bloc' ? 'bloc' : state.selectedPartyMode;
  const matches = rows.filter(r => String(r[field] || '') === String(selectedParty));
  return matches.length ? d3.sum(matches, r => safeNumber(r.vote_share) || 0) : null;
}

function shouldUseMapReadyRows(state) {
  if (!MAP_READY_METRICS.has(state.selectedMetric)) return false;
  if (!state.selectedElection) return false;
  return Boolean(state.indices.mapReadyCountByElection?.get(state.selectedElection));
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
  const useMapReady = shouldUseMapReadyRows(state);
  const sourceRows = useMapReady ? (state.mapReadyRows || []) : state.summary;
  const cacheKey = ['selectedRows', useMapReady ? 'mapReady' : 'summary', state.selectedElection || '', state.territorialMode || '', provincesKey, state.selectedCompleteness || '', state.selectedTerritorialStatus || '', state.summary.length, (state.mapReadyRows || []).length].join('__');
  if (cacheKey in state.selectorCaches) return state.selectorCaches[cacheKey];
  const rows = sourceRows.filter(row => {
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
  const cacheKey = ['rowsWithMetric', state.selectedElection || '', state.compareElection || '', state.selectedMetric || '', state.selectedPartyMode || '', state.selectedParty || '', state.selectedCustomIndicator || '', state.territorialMode || '', provincesKey, state.selectedCompleteness || '', state.selectedTerritorialStatus || '', state.minSharePct || 0, state.summary.length, state.mapReadyRows?.length || 0, state.resultsLong.length, geometryKey].join('__');
  if (cacheKey in state.selectorCaches) return state.selectorCaches[cacheKey];
  const geometryKeys = currentGeometryJoinSet(state.geometry);
  const needsPartyShare = Boolean(state.selectedParty) && (state.selectedMetric === 'party_share' || state.minSharePct > 0 || ['party_desc', 'swing_desc'].includes(state.tableSort || ''));
  const needsSwing = Boolean(state.selectedParty && state.compareElection) && (state.selectedMetric === 'swing_compare' || ['swing_desc'].includes(state.tableSort || ''));
  const needsVolatility = ['volatility', 'stability_index'].includes(state.selectedMetric) || ['volatility_desc'].includes(state.tableSort || '') || ['compare', 'diagnose'].includes(state.analysisMode || '');
  const needsDominance = state.selectedMetric === 'dominance_changes' || ['dominance_changes_desc'].includes(state.tableSort || '') || ['compare', 'diagnose'].includes(state.analysisMode || '');
  const rows = getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus }).map(row => {
    const joinKey = rowJoinKey(row);
    const geometry_match = joinKey ? geometryKeys.has(joinKey) : false;
    const metricValue = getMetricValue(state, row);
    const partyShare = needsPartyShare ? aggregateShareFor(state, row.election_key, row.municipality_id, state.selectedParty) : null;
    const swingCompare = needsSwing ? (() => {
      const current = aggregateShareFor(state, row.election_key, row.municipality_id, state.selectedParty);
      const compare = aggregateShareFor(state, state.compareElection, row.municipality_id, state.selectedParty);
      return current != null && compare != null ? current - compare : null;
    })() : null;
    return {
      ...row,
      geometry_match,
      __metric_value: metricValue,
      __party_share: state.selectedMetric === 'party_share' ? metricValue : partyShare,
      __swing_compare: state.selectedMetric === 'swing_compare' ? metricValue : swingCompare,
      __volatility: state.selectedMetric === 'volatility' ? metricValue : (needsVolatility ? computeVolatility(state, row.municipality_id) : null),
      __dominance_changes: state.selectedMetric === 'dominance_changes' ? metricValue : (needsDominance ? computeDominanceChanges(state, row.municipality_id) : null)
    };
  }).filter(row => (row.__party_share ?? 0) >= state.minSharePct || state.selectedMetric !== 'party_share');
  state.selectorCaches[cacheKey] = rows;
  return rows;
}
