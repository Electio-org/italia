import { safeNumber } from './shared.js';

const SUMMARY_NUMBER_FIELDS = ['election_year', 'turnout_pct', 'electors', 'voters', 'valid_votes', 'total_votes', 'first_party_share', 'second_party_share', 'first_second_margin'];
const RESULTS_LONG_NUMBER_FIELDS = ['election_year', 'votes', 'vote_share', 'rank'];
const CUSTOM_INDICATOR_NUMBER_FIELDS = ['election_year', 'value'];
const MAP_READY_NUMBER_FIELDS = SUMMARY_NUMBER_FIELDS;

export async function fetchTextFile(path) {
  const isGzip = String(path || '').endsWith('.gz');
  const res = await fetch(path);
  if (!res.ok) {
    if (isGzip) return fetchTextFile(String(path).replace(/\.gz$/, ''));
    throw new Error(`Impossibile caricare ${path}`);
  }
  if (isGzip) {
    if (typeof DecompressionStream !== 'function') {
      return fetchTextFile(String(path).replace(/\.gz$/, ''));
    }
    return decompressGzipBlob(await res.blob());
  }
  return res.text();
}

export async function fetchJsonFile(path) {
  if (String(path || '').endsWith('.gz')) return JSON.parse(await fetchTextFile(path));
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Impossibile caricare ${path}`);
  return res.json();
}

async function decompressGzipBlob(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export function parseCsvText(text) {
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

export function parseCsvTextAsync(text) {
  const useWorker = typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && String(text || '').length > 2_000_000;
  if (!useWorker) return Promise.resolve(parseCsvText(text));
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: result => resolve(result.data || []),
      error: error => reject(error)
    });
  }).catch(() => parseCsvText(text));
}

export async function fetchCsvFile(path) {
  const text = await fetchTextFile(path);
  return parseCsvTextAsync(text);
}

export function parseGeometryObject(obj) {
  if (obj?.type === 'Topology') {
    const key = Object.keys(obj.objects || {})[0];
    return topojson.feature(obj, obj.objects[key]);
  }
  return obj;
}

export async function fetchGeometryFile(path) {
  const obj = await fetchJsonFile(path);
  return parseGeometryObject(obj);
}

export function parseNumberFields(rows, fields) {
  return rows.map(row => {
    const out = { ...row };
    fields.forEach(field => {
      if (!(field in out)) return;
      const num = safeNumber(out[field]);
      out[field] = num ?? out[field];
    });
    return out;
  });
}

function parseSummaryRows(rows) {
  return parseNumberFields(rows, SUMMARY_NUMBER_FIELDS);
}

function parseResultsLongRows(rows) {
  return parseNumberFields(rows, RESULTS_LONG_NUMBER_FIELDS);
}

function normalizeMapReadyShares(shares = {}) {
  const out = { party_std: {}, party_family: {}, bloc: {} };
  Object.keys(out).forEach(mode => {
    Object.entries(shares?.[mode] || {}).forEach(([key, value]) => {
      const label = String(key || '').trim();
      const number = safeNumber(value);
      if (label && number != null) out[mode][label] = number;
    });
  });
  return out;
}

function parseMapReadyRows(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.rows || []);
  return parseNumberFields(rows, MAP_READY_NUMBER_FIELDS).map(row => ({
    ...row,
    shares: normalizeMapReadyShares(row.shares || {})
  }));
}

function parseCustomIndicatorRows(rows) {
  return parseNumberFields(rows, CUSTOM_INDICATOR_NUMBER_FIELDS);
}

function normalizeMunicipalitySearchRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const municipalityId = String(row?.municipality_id || '').trim();
    const label = String(row?.label || row?.name_current || row?.municipality_name || row?.name_historical || municipalityId).trim();
    const province = String(row?.province || row?.province_current || '').trim();
    const geometryId = String(row?.geometry_id || row?.geometry_id_current || municipalityId).trim();
    return municipalityId ? {
      municipality_id: municipalityId,
      label,
      province,
      geometry_id: geometryId,
      name_current: label,
      municipality_name: label,
      province_current: province
    } : null;
  }).filter(Boolean);
}

function buildMunicipalityLookupMaps(municipalities = []) {
  const byId = new Map();
  const byGeometry = new Map();
  municipalities.forEach(record => {
    const municipalityId = String(record?.municipality_id || '').trim();
    const geometryId = String(record?.geometry_id || '').trim();
    if (municipalityId && !byId.has(municipalityId)) byId.set(municipalityId, record);
    if (geometryId && !byGeometry.has(geometryId)) byGeometry.set(geometryId, record);
  });
  return { byId, byGeometry };
}

function resolveCurrentMunicipalityRecord(row, municipalityMaps) {
  const geometryId = String(row?.geometry_id || '').trim();
  const municipalityId = String(row?.municipality_id || '').trim();
  return municipalityMaps.byGeometry.get(geometryId)
    || municipalityMaps.byId.get(municipalityId)
    || null;
}

function enrichRowWithCurrentTerritory(row, municipalityMaps) {
  const current = resolveCurrentMunicipalityRecord(row, municipalityMaps);
  if (!current) return row;
  const currentProvince = String(current.province_current || '').trim();
  const currentGeometryId = String(current.geometry_id || '').trim();
  const currentName = String(current.name_current || '').trim();
  const observedProvince = String(row?.province || '').trim();
  const observedGeometryId = String(row?.geometry_id || '').trim();
  const observedName = String(row?.municipality_name || row?.name_current || '').trim();
  return {
    ...row,
    province_observed: observedProvince,
    geometry_id_observed: observedGeometryId,
    municipality_name_observed: observedName,
    province_current: currentProvince || observedProvince,
    municipality_name_current: currentName || observedName,
    geometry_id_current: currentGeometryId || observedGeometryId || String(row?.municipality_id || '').trim(),
    province: currentProvince || observedProvince,
    municipality_name: currentName || observedName,
    geometry_id: currentGeometryId || observedGeometryId || String(row?.municipality_id || '').trim()
  };
}

function enrichRowsWithCurrentTerritory(rows, municipalityMaps) {
  return (rows || []).map(row => enrichRowWithCurrentTerritory(row, municipalityMaps));
}

function buildDeclaredCoverageByElection(elections, datasetRegistry, summaryRows, resultRows, summaryShardRowCounts = {}, resultShardRowCounts = {}) {
  const map = new Map();
  (elections || []).forEach(election => {
    const key = election?.election_key;
    if (!key) return;
    map.set(key, { summary: 0, results: 0 });
  });
  (datasetRegistry || []).forEach(row => {
    const key = row?.election_key || row?.dataset_key;
    if (!key) return;
    const current = map.get(key) || { summary: 0, results: 0 };
    const summary = safeNumber(row?.summary_rows);
    const results = safeNumber(row?.result_rows);
    if (summary != null) current.summary = Math.max(current.summary, summary);
    if (results != null) current.results = Math.max(current.results, results);
    map.set(key, current);
  });
  if (summaryRows?.length) {
    d3.rollup(summaryRows, v => v.length, d => d.election_key).forEach((count, key) => {
      const current = map.get(key) || { summary: 0, results: 0 };
      current.summary = Math.max(current.summary, count);
      map.set(key, current);
    });
  }
  if (resultRows?.length) {
    d3.rollup(resultRows, v => v.length, d => d.election_key).forEach((count, key) => {
      const current = map.get(key) || { summary: 0, results: 0 };
      current.results = Math.max(current.results, count);
      map.set(key, current);
    });
  }
  Object.entries(summaryShardRowCounts || {}).forEach(([key, count]) => {
    if (!key) return;
    const current = map.get(key) || { summary: 0, results: 0 };
    current.summary = Math.max(current.summary, safeNumber(count) || 0);
    map.set(key, current);
  });
  Object.entries(resultShardRowCounts || {}).forEach(([key, count]) => {
    if (!key) return;
    const current = map.get(key) || { summary: 0, results: 0 };
    current.results = Math.max(current.results, safeNumber(count) || 0);
    map.set(key, current);
  });
  return map;
}

export function buildSyntheticGeometryPack(mainGeometryPath, provinceGeometryPath) {
  const municipalities = mainGeometryPath ? { '2026': mainGeometryPath } : {};
  const provinces = provinceGeometryPath ? { '2026': provinceGeometryPath } : {};
  return Object.keys(municipalities).length || Object.keys(provinces).length ? {
    municipalities, provinces, availableYears: [2026]
  } : null;
}

export function normalizeBundlePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

export function localFileCandidates(file) {
  const raw = normalizeBundlePath(file.webkitRelativePath || file.name || '');
  const parts = raw.split('/').filter(Boolean);
  const candidates = new Set([raw, normalizeBundlePath(file.name || '')]);
  for (let i = 1; i < parts.length; i += 1) candidates.add(parts.slice(i).join('/'));
  return [...candidates].filter(Boolean);
}

export function buildLocalBundleResolver(fileList) {
  const files = Array.from(fileList || []);
  const map = new Map();
  files.forEach(file => localFileCandidates(file).forEach(candidate => { if (!map.has(candidate)) map.set(candidate, file); }));
  const has = path => map.has(normalizeBundlePath(path));
  const text = async path => {
    const normalized = normalizeBundlePath(path);
    const hit = map.get(normalized);
    if (!hit) throw new Error(`File locale non trovato: ${path}`);
    if (normalized.endsWith('.gz')) {
      if (typeof DecompressionStream !== 'function') throw new Error(`Il browser non supporta DecompressionStream per ${path}`);
      return decompressGzipBlob(hit);
    }
    return hit.text();
  };
  const json = async path => JSON.parse(await text(path));
  const csv = async path => parseCsvTextAsync(await text(path));
  const geometry = async path => parseGeometryObject(await json(path));
  return { has, text, json, csv, geometry, fileCount: files.length };
}

export function normalizeJoinName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function geometryJoinKey(feature) {
  const p = feature?.properties || {};
  return String(p.geometry_id || p.municipality_id || `${normalizeJoinName(p.name_current || p.name)}__${normalizeJoinName(p.province || p.province_name || '')}` || '').trim() || null;
}

export function rowJoinKey(row) {
  return String(
    row?.geometry_id
    || row?.geometry_id_current
    || row?.municipality_id
    || `${normalizeJoinName(row?.municipality_name || row?.municipality_name_current || row?.name_current)}__${normalizeJoinName(row?.province_current || row?.province_observed || row?.province || '')}`
    || ''
  ).trim() || null;
}

export function currentGeometryJoinSet(geometry) {
  if (!geometry?.features?.length) return new Set();
  return new Set(geometry.features.map(geometryJoinKey).filter(Boolean));
}

export function makeGeoProjection(geometry, width, height) {
  const feature = geometry?.features?.[0];
  let pair = feature?.geometry?.coordinates;
  while (Array.isArray(pair) && Array.isArray(pair[0])) pair = pair[0];
  const looksProjected = Array.isArray(pair) && pair.length >= 2 && (Math.abs(Number(pair[0])) > 360 || Math.abs(Number(pair[1])) > 180);
  return looksProjected
    ? d3.geoIdentity().reflectY(true).fitSize([width, height], geometry)
    : d3.geoMercator().fitSize([width, height], geometry);
}

export function geometryYearForElectionValue(state, electionValue, territorialMode = state.territorialMode) {
  const years = Object.keys(state.geometryPack?.municipalities || {}).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;
  if (territorialMode === 'harmonized') return Math.max(...years);
  const electionYear = Number(state.elections.find(d => d.election_key === electionValue)?.election_year || electionValue || years[0]);
  const eligible = years.filter(y => y <= electionYear);
  return eligible.length ? Math.max(...eligible) : years[0];
}

export async function ensureGeometry(state, kind, year, registerIssue = () => {}) {
  if (!year || !state.geometryPack?.[kind]?.[String(year)]) return null;
  state.geometryCache[kind] = state.geometryCache[kind] || {};
  if (!state.geometryCache[kind][year]) {
    state.geometryCache[kind][year] = state.geometryResolver(state.geometryPack[kind][String(year)]).catch(err => {
      registerIssue(`geometry-${kind}-${year}`, err);
      return { type: 'FeatureCollection', features: [] };
    });
  }
  return state.geometryCache[kind][year];
}

function detailProvinceKey(state, year, province) {
  const byProvince = state.geometryPack?.detailMunicipalities?.[String(year)] || {};
  const raw = String(province || '').trim();
  if (!raw) return null;
  if (byProvince[raw]) return raw;
  const normalized = normalizeJoinName(raw);
  return Object.keys(byProvince).find(key => normalizeJoinName(key) === normalized) || null;
}

export function detailGeometryPathForProvince(state, year, province) {
  const key = detailProvinceKey(state, year, province);
  return key ? state.geometryPack?.detailMunicipalities?.[String(year)]?.[key] || null : null;
}

export async function ensureDetailGeometryForProvince(state, year, province, registerIssue = () => {}) {
  const provinceKey = detailProvinceKey(state, year, province);
  const path = provinceKey ? state.geometryPack?.detailMunicipalities?.[String(year)]?.[provinceKey] : null;
  if (!year || !provinceKey || !path || typeof state.geometryResolver !== 'function') return null;
  state.detailGeometryCache = state.detailGeometryCache || {};
  const cacheKey = `${year}__${normalizeJoinName(provinceKey)}`;
  if (!state.detailGeometryCache[cacheKey]) {
    state.detailGeometryCache[cacheKey] = state.geometryResolver(path).then(geometry => ({
      ...(geometry || { type: 'FeatureCollection', features: [] }),
      __detailKey: cacheKey,
      __detailProvince: provinceKey,
      __detailYear: String(year),
    })).catch(err => {
      registerIssue(`geometry-detail-${year}-${provinceKey}`, err);
      return { type: 'FeatureCollection', features: [], __detailKey: cacheKey, __detailProvince: provinceKey, __detailYear: String(year) };
    });
  }
  return state.detailGeometryCache[cacheKey];
}

export async function syncActiveGeometry(state, registerIssue = () => {}) {
  if (!state.geometryPack) {
    state.geometry = state.geometry || state.geometryFallback || { type: 'FeatureCollection', features: [] };
    state.geometryCompareA = state.geometry;
    state.geometryCompareB = state.geometry;
    state.geometrySwipe = state.geometry;
    state.provinceGeometry = state.provinceGeometry || state.provinceGeometryFallback || { type: 'FeatureCollection', features: [] };
    return;
  }
  const yearA = geometryYearForElectionValue(state, state.selectedElection, state.territorialMode);
  const yearB = geometryYearForElectionValue(state, state.compareElection || state.selectedElection, state.territorialMode);
  const sharedYear = state.territorialMode === 'harmonized' ? geometryYearForElectionValue(state, state.selectedElection, 'harmonized') : yearA;
  const [gA, gB, gS, pA] = await Promise.all([
    ensureGeometry(state, 'municipalities', yearA, registerIssue),
    ensureGeometry(state, 'municipalities', yearB, registerIssue),
    ensureGeometry(state, 'municipalities', sharedYear, registerIssue),
    ensureGeometry(state, 'provinces', yearA, registerIssue)
  ]);
  state.geometry = gA || state.geometryFallback || { type: 'FeatureCollection', features: [] };
  state.geometryCompareA = gA || state.geometry;
  state.geometryCompareB = gB || state.geometryCompareA;
  state.geometrySwipe = state.territorialMode === 'harmonized' ? (gS || state.geometryCompareA) : (yearA === yearB ? state.geometryCompareA : (gS || state.geometryCompareA));
  state.provinceGeometry = pA || state.provinceGeometryFallback || { type: 'FeatureCollection', features: [] };
  if (state.detailGeometryKey && !String(state.detailGeometryKey).startsWith(`${yearA}__`)) {
    state.detailGeometry = null;
    state.detailGeometryKey = null;
    state.detailGeometryWantedKey = null;
  }
}

export function electionCoverageFor(state, electionKey) {
  const declared = state.declaredCoverageByElection?.get(electionKey) || {};
  const summaryLoaded = state.indices.summaryCountByElection?.get(electionKey) ?? state.summary.filter(r => r.election_key === electionKey).length;
  const resultsLoaded = state.indices.resultCountByElection?.get(electionKey) ?? state.resultsLong.filter(r => r.election_key === electionKey).length;
  const summary = Math.max(summaryLoaded || 0, declared.summary || 0);
  const results = Math.max(resultsLoaded || 0, declared.results || 0);
  return { summary, results, summaryLoaded, resultsLoaded, summaryDeclared: declared.summary || 0, resultsDeclared: declared.results || 0 };
}

export function defaultElectionSequence(state) {
  const ordered = state.elections.slice().sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  const useful = ordered.filter(d => {
    const c = electionCoverageFor(state, d.election_key);
    return c.summary || c.results;
  });
  return useful.length ? useful : ordered;
}

async function loadFullSummaryOnce(state, { buildIndices, registerIssue = () => {} } = {}) {
  if (state.summaryFullLoaded) {
    return { strategy: 'full', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  }
  if (state.summaryFullLoadPromise) return state.summaryFullLoadPromise;
  const rel = state.manifest?.files?.municipalitySummary;
  if (!rel) return { strategy: 'full', loadedKeys: [], loadedRows: 0, missing: true };
  state.summaryFullLoadPromise = state.summaryResolver(rel)
    .then(rows => {
      const parsed = enrichRowsWithCurrentTerritory(
        parseSummaryRows(rows),
        state.municipalityLookupMaps || buildMunicipalityLookupMaps(state.municipalities)
      );
      state.summary = parsed;
      state.loadedSummaryElectionKeys = new Set(parsed.map(row => row.election_key).filter(Boolean));
      state.summaryFullLoaded = true;
      state.summaryHydrationComplete = true;
      if (typeof buildIndices === 'function') buildIndices({ rebuild: true });
      return { strategy: 'full', loadedKeys: [...state.loadedSummaryElectionKeys], loadedRows: parsed.length };
    })
    .catch(err => {
      registerIssue('summary-full-load', err);
      return { strategy: 'full', loadedKeys: [], loadedRows: 0, error: err };
    })
    .finally(() => {
      state.summaryFullLoadPromise = null;
    });
  return state.summaryFullLoadPromise;
}

export async function ensureSummaryForElections(state, electionKeys, { buildIndices, registerIssue = () => {} } = {}) {
  const wanted = [...new Set((electionKeys || []).filter(Boolean))];
  if (!wanted.length || !state.manifest?.files) return { strategy: state.summaryLoadStrategy || 'none', loadedKeys: [], loadedRows: 0 };
  if (state.summaryFullLoaded) return { strategy: 'full', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  if (state.summaryLoadStrategy !== 'by_election') {
    return loadFullSummaryOnce(state, { buildIndices, registerIssue });
  }

  const shardPaths = state.summaryShardPaths || {};
  const missing = wanted.filter(key => !state.loadedSummaryElectionKeys?.has(key));
  if (!missing.length) return { strategy: 'by_election', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  if (missing.some(key => !shardPaths[key])) {
    return loadFullSummaryOnce(state, { buildIndices, registerIssue });
  }

  const tasks = missing.map(key => {
    if (state.summaryLoadPromises?.has(key)) return state.summaryLoadPromises.get(key);
    const promise = state.summaryResolver(shardPaths[key])
      .then(rows => ({
        key,
        rows: enrichRowsWithCurrentTerritory(
          parseSummaryRows(rows),
          state.municipalityLookupMaps || buildMunicipalityLookupMaps(state.municipalities)
        )
      }))
      .catch(err => {
        registerIssue(`summary-shard-${key}`, err);
        return { key, rows: [], error: err };
      })
      .finally(() => {
        state.summaryLoadPromises?.delete(key);
      });
    state.summaryLoadPromises?.set(key, promise);
    return promise;
  });

  const chunks = await Promise.all(tasks);
  const fresh = [];
  const loadedKeys = [];
  chunks.forEach(chunk => {
    if (!chunk?.key || state.loadedSummaryElectionKeys?.has(chunk.key)) return;
    state.loadedSummaryElectionKeys?.add(chunk.key);
    loadedKeys.push(chunk.key);
    if (chunk.rows?.length) fresh.push(...chunk.rows);
  });
  if (fresh.length) state.summary = state.summary.concat(fresh);
  if (fresh.length || loadedKeys.length) {
    if (typeof buildIndices === 'function') buildIndices({ summaryRows: fresh });
  }
  if (state.summaryDeclaredRows && state.summary.length >= state.summaryDeclaredRows) {
    state.summaryHydrationComplete = true;
  }
  return { strategy: 'by_election', loadedKeys, loadedRows: fresh.length };
}

export async function ensureMapReadyForElections(state, electionKeys, { buildIndices, registerIssue = () => {} } = {}) {
  const wanted = [...new Set((electionKeys || []).filter(Boolean))];
  if (!wanted.length || !state.manifest?.files) return { strategy: state.mapReadyLoadStrategy || 'none', loadedKeys: [], loadedRows: 0 };
  if (state.mapReadyLoadStrategy !== 'by_election') return { strategy: state.mapReadyLoadStrategy || 'none', loadedKeys: [], loadedRows: 0, missing: true };

  const shardPaths = state.mapReadyShardPaths || {};
  const missing = wanted.filter(key => !state.loadedMapReadyElectionKeys?.has(key));
  if (!missing.length) return { strategy: 'by_election', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  if (missing.some(key => !shardPaths[key])) {
    return { strategy: 'by_election', loadedKeys: [], loadedRows: 0, missing: true };
  }

  const tasks = missing.map(key => {
    if (state.mapReadyLoadPromises?.has(key)) return state.mapReadyLoadPromises.get(key);
    const promise = state.mapReadyResolver(shardPaths[key])
      .then(payload => ({
        key,
        rows: enrichRowsWithCurrentTerritory(
          parseMapReadyRows(payload),
          state.municipalityLookupMaps || buildMunicipalityLookupMaps(state.municipalities)
        )
      }))
      .catch(err => {
        registerIssue(`map-ready-shard-${key}`, err);
        return { key, rows: [], error: err };
      })
      .finally(() => {
        state.mapReadyLoadPromises?.delete(key);
      });
    state.mapReadyLoadPromises?.set(key, promise);
    return promise;
  });

  const chunks = await Promise.all(tasks);
  const fresh = [];
  const loadedKeys = [];
  chunks.forEach(chunk => {
    if (!chunk?.key || state.loadedMapReadyElectionKeys?.has(chunk.key)) return;
    state.loadedMapReadyElectionKeys?.add(chunk.key);
    loadedKeys.push(chunk.key);
    if (chunk.rows?.length) fresh.push(...chunk.rows);
  });
  if (fresh.length) state.mapReadyRows = (state.mapReadyRows || []).concat(fresh);
  if (fresh.length || loadedKeys.length) {
    if (typeof buildIndices === 'function') buildIndices({ mapReadyRows: fresh });
  }
  if (state.mapReadyDeclaredRows && (state.mapReadyRows || []).length >= state.mapReadyDeclaredRows) {
    state.mapReadyHydrationComplete = true;
  }
  return { strategy: 'by_election', loadedKeys, loadedRows: fresh.length };
}

async function loadBundleWithManifest(state, manifest, resolver, { buildIndices, registerIssue = () => {}, source = 'embedded' } = {}) {
  state.manifest = manifest;
  const files = manifest.files || {};
  const deferredSummaryStrategy = String(manifest.loading?.municipalitySummary?.strategy || '');
  const deferredResultsStrategy = String(manifest.loading?.municipalityResultsLong?.strategy || '');
  const preferDeferredSummary = Boolean(files.municipalitySummaryByElectionIndex || deferredSummaryStrategy.includes('deferred'));
  const preferDeferredResults = Boolean(files.municipalityResultsLongByElectionIndex || deferredResultsStrategy.includes('deferred'));
  const [elections, municipalitySearchIndex, municipalitiesFallback, parties, eagerSummary, summaryShardIndex, eagerResultsLong, resultsShardIndex, mapReadyShardIndex, geometryPack] = await Promise.all([
    resolver.csv(files.electionsMaster),
    files.municipalitySearchIndex ? resolver.json(files.municipalitySearchIndex).catch(() => []) : Promise.resolve([]),
    !files.municipalitySearchIndex && files.municipalitiesMaster ? resolver.csv(files.municipalitiesMaster).catch(() => []) : Promise.resolve([]),
    resolver.csv(files.partiesMaster),
    !preferDeferredSummary && files.municipalitySummary ? resolver.csv(files.municipalitySummary).catch(() => []) : Promise.resolve([]),
    files.municipalitySummaryByElectionIndex ? resolver.json(files.municipalitySummaryByElectionIndex).catch(() => null) : Promise.resolve(null),
    !preferDeferredResults && files.municipalityResultsLong ? resolver.csv(files.municipalityResultsLong).catch(() => []) : Promise.resolve([]),
    files.municipalityResultsLongByElectionIndex ? resolver.json(files.municipalityResultsLongByElectionIndex).catch(() => null) : Promise.resolve(null),
    files.mapReadyByElectionIndex ? resolver.json(files.mapReadyByElectionIndex).catch(() => null) : Promise.resolve(null),
    files.geometryPack ? resolver.json(files.geometryPack).catch(() => null) : Promise.resolve(null)
  ]);
  const needsFallbackGeometry = !geometryPack && files.geometry;
  const needsFallbackProvinceGeometry = !geometryPack && files.provinceGeometry;
  const [mainGeometry, provinceGeometry] = await Promise.all([
    needsFallbackGeometry ? resolver.geometry(files.geometry).catch(() => null) : Promise.resolve(null),
    needsFallbackProvinceGeometry ? resolver.geometry(files.provinceGeometry).catch(() => null) : Promise.resolve(null)
  ]);
  const slimMunicipalities = normalizeMunicipalitySearchRows(municipalitySearchIndex || []);
  state.elections = parseNumberFields(elections, ['election_year']).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  state.municipalities = slimMunicipalities.length ? slimMunicipalities : (municipalitiesFallback || []);
  state.municipalitiesAreSlim = slimMunicipalities.length > 0;
  state.municipalitySearchIndex = normalizeMunicipalitySearchRows(state.municipalities);
  state.municipalityLookupMaps = buildMunicipalityLookupMaps(state.municipalities);
  state.parties = parties;
  state.lineage = [];
  state.aliases = [];
  state.summary = enrichRowsWithCurrentTerritory(parseSummaryRows(eagerSummary), state.municipalityLookupMaps);
  state.resultsLong = enrichRowsWithCurrentTerritory(parseResultsLongRows(eagerResultsLong), state.municipalityLookupMaps);
  state.mapReadyRows = [];
  state.customIndicators = [];
  state.qualityReport = null;
  state.datasetRegistry = [];
  state.codebook = null;
  state.usageNotes = [];
  state.updateLog = [];
  state.dataProducts = null;
  state.datasetContracts = null;
  state.provenance = null;
  state.releaseManifest = null;
  state.researchRecipes = [];
  state.siteGuides = null;
  state.archiveBundleGapReport = [];
  state.archiveBundleGapSummary = null;
  state.archiveGapByElection = new Map((state.archiveBundleGapReport || []).map(row => [row?.consultation_key || row?.election_key, row]).filter(([key]) => key));
  state.deferredMetadataResolver = resolver;
  state.deferredMetadataFiles = files;
  state.deferredMetadataLoaded = false;
  state.deferredMetadataPromise = null;
  state.geometryPack = geometryPack || buildSyntheticGeometryPack(files.geometry, files.provinceGeometry);
  state.geometryFallback = mainGeometry || { type: 'FeatureCollection', features: [] };
  state.provinceGeometryFallback = provinceGeometry || { type: 'FeatureCollection', features: [] };
  state.geometryCache = {};
  state.municipalityBoundaryGeometry = null;
  state.municipalityBoundaryGeometryYear = null;
  state.municipalityBoundaryLoadingYear = null;
  state.municipalityBoundaryLoadPromise = null;
  state.municipalityBoundaryIdleHandle = null;
  state.detailGeometryCache = {};
  state.detailGeometry = null;
  state.detailGeometryKey = null;
  state.detailGeometryWantedKey = null;
  state.detailGeometryLoadingKey = null;
  state.dataSource = source;
  state.dataSourceLabel = source === 'local' ? `Bundle locale (${resolver.fileCount || 0} file)` : 'Bundle incorporato';
  state.summaryResolver = path => resolver.csv(path);
  state.geometryResolver = path => resolver.geometry(path);
  state.resultsResolver = path => resolver.csv(path);
  state.mapReadyResolver = path => resolver.json(path);
  state.summaryShardIndex = summaryShardIndex || null;
  state.summaryShardPaths = summaryShardIndex?.shards || null;
  state.resultsLongShardIndex = resultsShardIndex || null;
  state.resultsLongShardPaths = resultsShardIndex?.shards || null;
  state.mapReadyShardIndex = mapReadyShardIndex || null;
  state.mapReadyShardPaths = mapReadyShardIndex?.shards || null;
  state.summaryLoadStrategy = state.summaryShardPaths && Object.keys(state.summaryShardPaths).length
    ? 'by_election'
    : (files.municipalitySummary ? 'full' : 'none');
  state.resultsLongLoadStrategy = state.resultsLongShardPaths && Object.keys(state.resultsLongShardPaths).length
    ? 'by_election'
    : (files.municipalityResultsLong ? 'full' : 'none');
  state.mapReadyLoadStrategy = state.mapReadyShardPaths && Object.keys(state.mapReadyShardPaths).length
    ? 'by_election'
    : 'none';
  state.summaryFullLoaded = state.summaryLoadStrategy === 'full';
  state.resultsLongFullLoaded = state.resultsLongLoadStrategy === 'full';
  state.loadedSummaryElectionKeys = new Set(state.summary.map(row => row.election_key).filter(Boolean));
  state.loadedResultElectionKeys = new Set(state.resultsLong.map(row => row.election_key).filter(Boolean));
  state.loadedMapReadyElectionKeys = new Set();
  state.summaryLoadPromises = new Map();
  state.resultsLoadPromises = new Map();
  state.mapReadyLoadPromises = new Map();
  state.summaryFullLoadPromise = null;
  state.resultsFullLoadPromise = null;
  state.declaredCoverageByElection = buildDeclaredCoverageByElection(
    state.elections,
    state.datasetRegistry,
    state.summary,
    state.resultsLong,
    summaryShardIndex?.row_counts || {},
    resultsShardIndex?.row_counts || {}
  );
  state.summaryDeclaredRows = Array.from(state.declaredCoverageByElection.values()).reduce((sum, row) => sum + (row.summary || 0), 0);
  state.resultsLongDeclaredRows = Array.from(state.declaredCoverageByElection.values()).reduce((sum, row) => sum + (row.results || 0), 0);
  state.mapReadyDeclaredRows = Object.values(mapReadyShardIndex?.row_counts || {}).reduce((sum, count) => sum + (safeNumber(count) || 0), 0);
  state.summaryHydrationStarted = false;
  state.resultsHydrationStarted = false;
  state.mapReadyHydrationStarted = false;
  state.summaryHydrationComplete = state.summaryFullLoaded;
  state.resultsHydrationComplete = state.resultsLongFullLoaded;
  state.mapReadyHydrationComplete = !state.mapReadyDeclaredRows;
  if (typeof buildIndices === 'function') buildIndices({ rebuild: true });
  const defaults = defaultElectionSequence(state);
  state.selectedElection = state.selectedElection || defaults.at(-1)?.election_key || state.elections.at(-1)?.election_key || null;
  const selectedDefaultIndex = defaults.findIndex(d => d.election_key === state.selectedElection);
  const defaultCompareElection = selectedDefaultIndex > 0
    ? defaults[selectedDefaultIndex - 1]?.election_key
    : defaults.find(d => d.election_key !== state.selectedElection)?.election_key;
  state.compareElection = state.compareElection || defaultCompareElection || null;
  await ensureMapReadyForElections(state, [state.selectedElection].filter(Boolean), { buildIndices, registerIssue });
  await ensureSummaryForElections(state, [state.selectedElection].filter(Boolean), { buildIndices, registerIssue });
  await syncActiveGeometry(state, registerIssue);
}

export async function loadDeferredBundleMetadata(state, { buildIndices, registerIssue = () => {} } = {}) {
  if (state.deferredMetadataLoaded) return { loaded: false, alreadyLoaded: true };
  if (state.deferredMetadataPromise) return state.deferredMetadataPromise;
  const files = state.deferredMetadataFiles || state.manifest?.files || {};
  const resolver = state.deferredMetadataResolver;
  if (!resolver) return { loaded: false, missingResolver: true };
  state.deferredMetadataPromise = Promise.all([
    files.municipalitiesMaster && state.municipalitiesAreSlim ? resolver.csv(files.municipalitiesMaster).catch(() => null) : Promise.resolve(null),
    files.territorialLineage ? resolver.csv(files.territorialLineage).catch(() => []) : Promise.resolve([]),
    files.municipalityAliases ? resolver.csv(files.municipalityAliases).catch(() => []) : Promise.resolve([]),
    files.customIndicators ? resolver.csv(files.customIndicators).catch(() => []) : Promise.resolve([]),
    files.dataQualityReport ? resolver.json(files.dataQualityReport).catch(() => null) : Promise.resolve(null),
    files.datasetRegistry ? resolver.json(files.datasetRegistry).catch(() => null) : Promise.resolve(null),
    files.codebook ? resolver.json(files.codebook).catch(() => null) : Promise.resolve(null),
    files.usageNotes ? resolver.json(files.usageNotes).catch(() => null) : Promise.resolve(null),
    files.updateLog ? resolver.json(files.updateLog).catch(() => null) : Promise.resolve(null),
    files.dataProducts ? resolver.json(files.dataProducts).catch(() => null) : Promise.resolve(null),
    files.datasetContracts ? resolver.json(files.datasetContracts).catch(() => null) : Promise.resolve(null),
    files.provenance ? resolver.json(files.provenance).catch(() => null) : Promise.resolve(null),
    files.releaseManifest ? resolver.json(files.releaseManifest).catch(() => null) : Promise.resolve(null),
    files.researchRecipes ? resolver.json(files.researchRecipes).catch(() => null) : Promise.resolve(null),
    files.siteGuides ? resolver.json(files.siteGuides).catch(() => null) : Promise.resolve(null),
    files.archiveBundleGapReport ? resolver.json(files.archiveBundleGapReport).catch(() => null) : Promise.resolve(null)
  ]).then(([municipalitiesMaster, lineage, aliases, customIndicators, qualityReport, datasetRegistry, codebook, usageNotes, updateLog, dataProducts, datasetContracts, provenance, releaseManifest, researchRecipes, siteGuides, archiveGapReport]) => {
    if (municipalitiesMaster?.length) {
      state.municipalities = municipalitiesMaster;
      state.municipalityLookupMaps = buildMunicipalityLookupMaps(state.municipalities);
      state.municipalitySearchIndex = normalizeMunicipalitySearchRows(state.municipalities);
      state.summary = enrichRowsWithCurrentTerritory(state.summary, state.municipalityLookupMaps);
      state.resultsLong = enrichRowsWithCurrentTerritory(state.resultsLong, state.municipalityLookupMaps);
      state.mapReadyRows = enrichRowsWithCurrentTerritory(state.mapReadyRows || [], state.municipalityLookupMaps);
      state.municipalitiesAreSlim = false;
    }
    state.lineage = lineage || [];
    state.aliases = aliases || [];
    state.customIndicators = parseCustomIndicatorRows(customIndicators || []);
    state.qualityReport = qualityReport;
    state.datasetRegistry = datasetRegistry?.datasets || datasetRegistry || [];
    state.codebook = codebook || null;
    state.usageNotes = usageNotes?.notes || usageNotes || [];
    state.updateLog = updateLog?.entries || updateLog || [];
    state.dataProducts = dataProducts || null;
    state.datasetContracts = datasetContracts || null;
    state.provenance = provenance || null;
    state.releaseManifest = releaseManifest || null;
    state.researchRecipes = researchRecipes?.recipes || researchRecipes || [];
    state.siteGuides = siteGuides || null;
    state.archiveBundleGapReport = archiveGapReport?.rows || archiveGapReport || [];
    state.archiveBundleGapSummary = archiveGapReport?.summary || null;
    state.archiveGapByElection = new Map((state.archiveBundleGapReport || []).map(row => [row?.consultation_key || row?.election_key, row]).filter(([key]) => key));
    state.declaredCoverageByElection = buildDeclaredCoverageByElection(
      state.elections,
      state.datasetRegistry,
      state.summary,
      state.resultsLong,
      state.summaryShardIndex?.row_counts || {},
      state.resultsLongShardIndex?.row_counts || {}
    );
    state.summaryDeclaredRows = Array.from(state.declaredCoverageByElection.values()).reduce((sum, row) => sum + (row.summary || 0), 0);
    state.resultsLongDeclaredRows = Array.from(state.declaredCoverageByElection.values()).reduce((sum, row) => sum + (row.results || 0), 0);
    state.deferredMetadataLoaded = true;
    if (typeof buildIndices === 'function') buildIndices({ rebuild: true });
    return { loaded: true };
  }).catch(err => {
    registerIssue('deferred-metadata-load', err);
    return { loaded: false, error: err };
  }).finally(() => {
    state.deferredMetadataPromise = null;
  });
  return state.deferredMetadataPromise;
}

async function loadFullResultsLongOnce(state, { buildIndices, registerIssue = () => {} } = {}) {
  if (state.resultsLongFullLoaded) {
    return { strategy: 'full', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  }
  if (state.resultsFullLoadPromise) return state.resultsFullLoadPromise;
  const rel = state.manifest?.files?.municipalityResultsLong;
  if (!rel) return { strategy: 'full', loadedKeys: [], loadedRows: 0, missing: true };
  state.resultsFullLoadPromise = state.resultsResolver(rel)
    .then(rows => {
      const parsed = enrichRowsWithCurrentTerritory(
        parseResultsLongRows(rows),
        state.municipalityLookupMaps || buildMunicipalityLookupMaps(state.municipalities)
      );
      state.resultsLong = parsed;
      state.loadedResultElectionKeys = new Set(parsed.map(row => row.election_key).filter(Boolean));
      state.resultsLongFullLoaded = true;
      state.resultsHydrationComplete = true;
      if (typeof buildIndices === 'function') buildIndices({ rebuild: true });
      return { strategy: 'full', loadedKeys: [...state.loadedResultElectionKeys], loadedRows: parsed.length };
    })
    .catch(err => {
      registerIssue('results-long-full-load', err);
      return { strategy: 'full', loadedKeys: [], loadedRows: 0, error: err };
    })
    .finally(() => {
      state.resultsFullLoadPromise = null;
    });
  return state.resultsFullLoadPromise;
}

export async function ensureResultsForElections(state, electionKeys, { buildIndices, registerIssue = () => {} } = {}) {
  const wanted = [...new Set((electionKeys || []).filter(Boolean))];
  if (!wanted.length || !state.manifest?.files) return { strategy: state.resultsLongLoadStrategy || 'none', loadedKeys: [], loadedRows: 0 };
  if (state.resultsLongFullLoaded) return { strategy: 'full', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  if (state.resultsLongLoadStrategy !== 'by_election') {
    return loadFullResultsLongOnce(state, { buildIndices, registerIssue });
  }

  const shardPaths = state.resultsLongShardPaths || {};
  const missing = wanted.filter(key => !state.loadedResultElectionKeys?.has(key));
  if (!missing.length) return { strategy: 'by_election', loadedKeys: [], loadedRows: 0, alreadyLoaded: true };
  if (missing.some(key => !shardPaths[key])) {
    return loadFullResultsLongOnce(state, { buildIndices, registerIssue });
  }

  const tasks = missing.map(key => {
    if (state.resultsLoadPromises?.has(key)) return state.resultsLoadPromises.get(key);
    const promise = state.resultsResolver(shardPaths[key])
      .then(rows => ({
        key,
        rows: enrichRowsWithCurrentTerritory(
          parseResultsLongRows(rows),
          state.municipalityLookupMaps || buildMunicipalityLookupMaps(state.municipalities)
        )
      }))
      .catch(err => {
        registerIssue(`results-long-shard-${key}`, err);
        return { key, rows: [], error: err };
      })
      .finally(() => {
        state.resultsLoadPromises?.delete(key);
      });
    state.resultsLoadPromises?.set(key, promise);
    return promise;
  });

  const chunks = await Promise.all(tasks);
  const fresh = [];
  const loadedKeys = [];
  chunks.forEach(chunk => {
    if (!chunk?.key || state.loadedResultElectionKeys?.has(chunk.key)) return;
    state.loadedResultElectionKeys?.add(chunk.key);
    loadedKeys.push(chunk.key);
    if (chunk.rows?.length) fresh.push(...chunk.rows);
  });
  if (fresh.length) state.resultsLong = state.resultsLong.concat(fresh);
  if (fresh.length || loadedKeys.length) {
    if (typeof buildIndices === 'function') buildIndices({ resultRows: fresh });
  }
  if (state.resultsLongDeclaredRows && state.resultsLong.length >= state.resultsLongDeclaredRows) {
    state.resultsHydrationComplete = true;
  }
  return { strategy: 'by_election', loadedKeys, loadedRows: fresh.length };
}

export async function loadData(state, { buildIndices, registerIssue = () => {} } = {}) {
  const manifest = await fetchJsonFile('data/derived/manifest.json');
  const resolver = {
    csv: fetchCsvFile,
    json: fetchJsonFile,
    geometry: fetchGeometryFile,
    fileCount: null
  };
  await loadBundleWithManifest(state, manifest, resolver, { buildIndices, registerIssue, source: 'embedded' });
}

export async function loadDataFromLocalFiles(state, fileList, { buildIndices, registerIssue = () => {} } = {}) {
  const resolver = buildLocalBundleResolver(fileList);
  let manifestPath = 'data/derived/manifest.json';
  if (!resolver.has(manifestPath) && resolver.has('manifest.json')) manifestPath = 'manifest.json';
  const manifest = await resolver.json(manifestPath);
  await loadBundleWithManifest(state, manifest, resolver, { buildIndices, registerIssue, source: 'local' });
}
