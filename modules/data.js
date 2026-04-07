import { safeNumber } from './shared.js';

const SUMMARY_NUMBER_FIELDS = ['election_year', 'turnout_pct', 'electors', 'voters', 'valid_votes', 'total_votes', 'first_party_share', 'second_party_share', 'first_second_margin'];
const RESULTS_LONG_NUMBER_FIELDS = ['election_year', 'votes', 'vote_share', 'rank'];
const CUSTOM_INDICATOR_NUMBER_FIELDS = ['election_year', 'value'];

export async function fetchTextFile(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Impossibile caricare ${path}`);
  return res.text();
}

export async function fetchJsonFile(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Impossibile caricare ${path}`);
  return res.json();
}

export function parseCsvText(text) {
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

export async function fetchCsvFile(path) {
  const text = await fetchTextFile(path);
  return parseCsvText(text);
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

function parseCustomIndicatorRows(rows) {
  return parseNumberFields(rows, CUSTOM_INDICATOR_NUMBER_FIELDS);
}

function buildDeclaredCoverageByElection(elections, datasetRegistry, summaryRows, resultRows) {
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
    const hit = map.get(normalizeBundlePath(path));
    if (!hit) throw new Error(`File locale non trovato: ${path}`);
    return hit.text();
  };
  const json = async path => JSON.parse(await text(path));
  const csv = async path => parseCsvText(await text(path));
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
  return String(row?.geometry_id || row?.municipality_id || `${normalizeJoinName(row?.municipality_name || row?.name_current)}__${normalizeJoinName(row?.province || '')}` || '').trim() || null;
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

async function loadBundleWithManifest(state, manifest, resolver, { buildIndices, registerIssue = () => {}, source = 'embedded' } = {}) {
  state.manifest = manifest;
  const files = manifest.files || {};
  const deferredResultsStrategy = String(manifest.loading?.municipalityResultsLong?.strategy || '');
  const preferDeferredResults = Boolean(files.municipalityResultsLongByElectionIndex || deferredResultsStrategy.includes('deferred'));
  const [elections, municipalities, parties, lineage, summary, eagerResultsLong, resultsShardIndex, aliases, customIndicators, qualityReport, geometryPack, datasetRegistry, codebook, usageNotes, updateLog, dataProducts, datasetContracts, provenance, releaseManifest, researchRecipes, siteGuides, archiveGapReport] = await Promise.all([
    resolver.csv(files.electionsMaster),
    resolver.csv(files.municipalitiesMaster),
    resolver.csv(files.partiesMaster),
    resolver.csv(files.territorialLineage),
    resolver.csv(files.municipalitySummary),
    !preferDeferredResults && files.municipalityResultsLong ? resolver.csv(files.municipalityResultsLong).catch(() => []) : Promise.resolve([]),
    files.municipalityResultsLongByElectionIndex ? resolver.json(files.municipalityResultsLongByElectionIndex).catch(() => null) : Promise.resolve(null),
    resolver.csv(files.municipalityAliases),
    resolver.csv(files.customIndicators),
    resolver.json(files.dataQualityReport),
    files.geometryPack ? resolver.json(files.geometryPack).catch(() => null) : Promise.resolve(null),
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
  ]);
  const needsFallbackGeometry = !geometryPack && files.geometry;
  const needsFallbackProvinceGeometry = !geometryPack && files.provinceGeometry;
  const [mainGeometry, provinceGeometry] = await Promise.all([
    needsFallbackGeometry ? resolver.geometry(files.geometry).catch(() => null) : Promise.resolve(null),
    needsFallbackProvinceGeometry ? resolver.geometry(files.provinceGeometry).catch(() => null) : Promise.resolve(null)
  ]);
  state.elections = parseNumberFields(elections, ['election_year']).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  state.municipalities = municipalities;
  state.parties = parties;
  state.lineage = lineage;
  state.aliases = aliases;
  state.summary = parseSummaryRows(summary);
  state.resultsLong = parseResultsLongRows(eagerResultsLong);
  state.customIndicators = parseCustomIndicatorRows(customIndicators);
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
  state.geometryPack = geometryPack || buildSyntheticGeometryPack(files.geometry, files.provinceGeometry);
  state.geometryFallback = mainGeometry || { type: 'FeatureCollection', features: [] };
  state.provinceGeometryFallback = provinceGeometry || { type: 'FeatureCollection', features: [] };
  state.geometryCache = {};
  state.dataSource = source;
  state.dataSourceLabel = source === 'local' ? `Bundle locale (${resolver.fileCount || 0} file)` : 'Bundle incorporato';
  state.geometryResolver = path => resolver.geometry(path);
  state.resultsResolver = path => resolver.csv(path);
  state.resultsLongShardIndex = resultsShardIndex || null;
  state.resultsLongShardPaths = resultsShardIndex?.shards || null;
  state.resultsLongLoadStrategy = state.resultsLongShardPaths && Object.keys(state.resultsLongShardPaths).length
    ? 'by_election'
    : (files.municipalityResultsLong ? 'full' : 'none');
  state.resultsLongFullLoaded = state.resultsLongLoadStrategy === 'full';
  state.loadedResultElectionKeys = new Set(state.resultsLong.map(row => row.election_key).filter(Boolean));
  state.resultsLoadPromises = new Map();
  state.resultsFullLoadPromise = null;
  state.declaredCoverageByElection = buildDeclaredCoverageByElection(state.elections, state.datasetRegistry, state.summary, state.resultsLong);
  state.resultsLongDeclaredRows = Array.from(state.declaredCoverageByElection.values()).reduce((sum, row) => sum + (row.results || 0), 0);
  state.resultsHydrationStarted = false;
  state.resultsHydrationComplete = state.resultsLongFullLoaded;
  if (typeof buildIndices === 'function') buildIndices();
  const defaults = defaultElectionSequence(state);
  state.selectedElection = state.selectedElection || defaults.at(-1)?.election_key || state.elections.at(-1)?.election_key || null;
  state.compareElection = state.compareElection || defaults.at(-2)?.election_key || state.selectedElection;
  await syncActiveGeometry(state, registerIssue);
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
      const parsed = parseResultsLongRows(rows);
      state.resultsLong = parsed;
      state.loadedResultElectionKeys = new Set(parsed.map(row => row.election_key).filter(Boolean));
      state.resultsLongFullLoaded = true;
      state.resultsHydrationComplete = true;
      if (typeof buildIndices === 'function') buildIndices();
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
      .then(rows => ({ key, rows: parseResultsLongRows(rows) }))
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
    if (typeof buildIndices === 'function') buildIndices();
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
