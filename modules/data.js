import {
  safeNumber,
  inferredPartyMetaOrNull,
  buildPartyTaxonomyLookup,
  resolvePartyMeta
} from './shared.js';

const SUMMARY_NUMBER_FIELDS = ['election_year', 'turnout_pct', 'electors', 'voters', 'valid_votes', 'total_votes', 'first_party_share', 'second_party_share', 'first_second_margin'];
const RESULTS_LONG_NUMBER_FIELDS = ['election_year', 'votes', 'vote_share', 'rank'];
const CUSTOM_INDICATOR_NUMBER_FIELDS = ['election_year', 'value'];

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
    const fc = topojson.feature(obj, obj.objects[key]);
    // Stash topology on the collection so downstream callers (map canvas)
    // can build topojson.mesh() layers for comune / provincia / regione
    // borders. Non-enumerable so JSON.stringify stays clean.
    try {
      Object.defineProperty(fc, '__topology', { value: obj, enumerable: false, configurable: true });
      Object.defineProperty(fc, '__topologyObjectKey', { value: key, enumerable: false, configurable: true });
    } catch (_) { /* older runtimes */ }
    return fc;
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

// Canonical region names. The municipality master mixes "Friuli Venezia
// Giulia" (203 comuni) and "Friuli-Venezia Giulia" (30 comuni) — normalising
// at load time avoids the region selector splitting Friuli into two groups.
const REGION_CANONICAL = new Map([
  ['friuli-venezia giulia', 'Friuli Venezia Giulia'],
  ['friuli venezia giulia', 'Friuli Venezia Giulia']
]);

function canonicalRegionName(value) {
  if (value === null || value === undefined) return value;
  const raw = String(value).trim();
  if (!raw) return raw;
  const canon = REGION_CANONICAL.get(raw.toLowerCase());
  return canon || raw;
}

export function normalizeMunicipalityRegions(municipalities = []) {
  return (municipalities || []).map(m => {
    if (!m || typeof m !== 'object') return m;
    const region = canonicalRegionName(m.region);
    return region === m.region ? m : { ...m, region };
  });
}

function parseSummaryRows(rows) {
  return parseNumberFields(rows, SUMMARY_NUMBER_FIELDS);
}

// Apply the JS-side party taxonomy on top of whatever the Python
// preprocessor wrote into the CSV.
//
// The Python preprocessor (scripts/preprocess.py) ships a short PARTY_FALLBACKS
// list of ~11 regexes, so the CSV stamps `bloc=altro` / `party_family=altro`
// on the vast majority of historically significant parties (L'Ulivo, AN, UDC,
// RC, IdV, Pensionati, La Rosa nel Pugno, Verdi pre-AVS, Comunisti Italiani,
// SEL, LeU, +Europa, Scelta Civica, FLI, …). That in turn breaks every
// bloc-aware aggregation downstream and produces the visible "Olgiate Molgora
// 2006 → altro 54%" regression Simone reported.
//
// We patch this at runtime: for every result row, re-run the JS regex list
// (the authoritative taxonomy, kept in modules/shared.js) against `party_raw`
// and, when it has an opinion, OVERWRITE the CSV's bloc/family/std. If the
// JS list has no opinion (returns null) we keep the CSV's existing values so
// we don't downgrade good data to `altro`.
//
// This is intentionally aggressive: we override even when the CSV value
// already looks plausible, because the Python regex set is so small that any
// match it produces is also produced (and is a strict subset of) the JS set.
// The only difference is that JS sometimes refines a generic "altro" into
// the correct bloc.
function applyRuntimeTaxonomy(row, taxonomyLookup = null) {
  const raw = String(row?.party_raw || row?.party_std || '').trim();
  if (!raw) return row;
  const exact = resolvePartyMeta(taxonomyLookup, row?.election_key, raw);
  const meta = exact || inferredPartyMetaOrNull(raw);
  if (!meta) return row;
  // Spread the row first, then layer in only the fields the JS taxonomy
  // wants to set. We do NOT touch votes / vote_share / rank / election keys.
  return {
    ...row,
    party_std: exact
      ? (exact.party_std || exact.display || raw)
      : (row.party_std || meta.display || raw),
    party_family: meta.family || row.party_family || 'altro',
    bloc: meta.bloc || row.bloc || 'altro'
  };
}

function parseResultsLongRows(rows, taxonomyLookup = null) {
  return parseNumberFields(rows, RESULTS_LONG_NUMBER_FIELDS).map(row => applyRuntimeTaxonomy(row, taxonomyLookup));
}

// Build a per-election Map<lowercased_party_raw, coalition_record> from
// the curated coalitions JSON. We lowercase the party_raw key because the
// upstream CSV labels mix casings ("L'Ulivo" vs "L'ulivo" in some pre-
// processing paths) and we want a single resilient point of normalisation.
// Coalition records preserve the full metadata (key, label, color, bloc,
// election_key) so consumers can render without re-walking the catalog.
function buildCoalitionLookupByElection(catalog) {
  const out = new Map();
  if (!catalog?.coalitions) return out;
  Object.entries(catalog.coalitions).forEach(([electionKey, coalitions]) => {
    if (!Array.isArray(coalitions) || !coalitions.length) return;
    const partyToCoalition = new Map();
    coalitions.forEach(coalition => {
      const parties = Array.isArray(coalition?.parties) ? coalition.parties : [];
      parties.forEach(partyRaw => {
        const key = String(partyRaw || '').trim().toLowerCase();
        if (!key) return;
        // First-write-wins: a party should only belong to one coalition per
        // election. If the JSON accidentally lists it twice we keep the
        // first occurrence and ignore the rest (defensive — the curated
        // file should never trip this).
        if (partyToCoalition.has(key)) return;
        partyToCoalition.set(key, {
          coalition_key: coalition.key || '',
          coalition_label: coalition.label || '',
          coalition_color: coalition.color || '#94a3b8',
          coalition_bloc: coalition.bloc || '',
          election_key: electionKey
        });
      });
    });
    out.set(electionKey, partyToCoalition);
  });
  return out;
}

function parseCustomIndicatorRows(rows) {
  return parseNumberFields(rows, CUSTOM_INDICATOR_NUMBER_FIELDS);
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
  const loadedKeys = [];
  const failedKeys = [];
  const freshChunks = [];
  chunks.forEach(chunk => {
    if (!chunk?.key || state.loadedSummaryElectionKeys?.has(chunk.key)) return;
    if (chunk.error || !chunk.rows?.length) {
      failedKeys.push(chunk.key);
      return;
    }
    state.loadedSummaryElectionKeys?.add(chunk.key);
    loadedKeys.push(chunk.key);
    freshChunks.push(chunk.rows);
  });
  // Use reduce+concat instead of fresh.push(...chunk.rows) to avoid V8's
  // argument-count RangeError on large shards. Currently summary shards are
  // small (~7.9k rows max per Camera election) but Senato/Europee/Regionali
  // shards in the roadmap may grow past the ~125k argument limit.
  let freshTotal = 0;
  freshChunks.forEach(rows => { freshTotal += rows.length; });
  if (freshTotal) {
    state.summary = freshChunks.reduce((acc, rows) => acc.concat(rows), state.summary);
  }
  if (freshTotal || loadedKeys.length) {
    if (typeof buildIndices === 'function') {
      const flat = freshChunks.length === 1 ? freshChunks[0] : freshChunks.reduce((acc, rows) => acc.concat(rows), []);
      buildIndices({ summaryRows: flat });
    }
  }
  if (state.summaryDeclaredRows && state.summary.length >= state.summaryDeclaredRows) {
    state.summaryHydrationComplete = true;
  }
  return { strategy: 'by_election', loadedKeys, loadedRows: freshTotal, failedKeys };
}

async function loadBundleWithManifest(state, manifest, resolver, { buildIndices, registerIssue = () => {}, source = 'embedded' } = {}) {
  state.manifest = manifest;
  const files = manifest.files || {};
  const deferredSummaryStrategy = String(manifest.loading?.municipalitySummary?.strategy || '');
  const deferredResultsStrategy = String(manifest.loading?.municipalityResultsLong?.strategy || '');
  const preferDeferredSummary = Boolean(files.municipalitySummaryByElectionIndex || deferredSummaryStrategy.includes('deferred'));
  const preferDeferredResults = Boolean(files.municipalityResultsLongByElectionIndex || deferredResultsStrategy.includes('deferred'));
  // Path to the curated historical-coalitions catalog. Hard-coded because
  // it's an opt-in product (not a derived shard) and may live outside the
  // manifest. Falls back to null silently — coalition UI elements
  // gracefully no-op when state.electoralCoalitions is absent.
  const coalitionsPath = files.electoralCoalitions || 'data/derived/electoral_coalitions.json';
  const [elections, municipalities, parties, partyTaxonomy, eagerSummary, summaryShardIndex, eagerResultsLong, resultsShardIndex, geometryPack, electoralCoalitions] = await Promise.all([
    resolver.csv(files.electionsMaster),
    resolver.csv(files.municipalitiesMaster),
    resolver.csv(files.partiesMaster),
    files.partyTaxonomy ? resolver.csv(files.partyTaxonomy).catch(() => []) : Promise.resolve([]),
    !preferDeferredSummary && files.municipalitySummary ? resolver.csv(files.municipalitySummary).catch(() => []) : Promise.resolve([]),
    files.municipalitySummaryByElectionIndex ? resolver.json(files.municipalitySummaryByElectionIndex).catch(() => null) : Promise.resolve(null),
    !preferDeferredResults && files.municipalityResultsLong ? resolver.csv(files.municipalityResultsLong).catch(() => []) : Promise.resolve([]),
    files.municipalityResultsLongByElectionIndex ? resolver.json(files.municipalityResultsLongByElectionIndex).catch(() => null) : Promise.resolve(null),
    files.geometryPack ? resolver.json(files.geometryPack).catch(() => null) : Promise.resolve(null),
    resolver.json(coalitionsPath).catch(() => null)
  ]);
  const needsFallbackGeometry = !geometryPack && files.geometry;
  const needsFallbackProvinceGeometry = !geometryPack && files.provinceGeometry;
  const [mainGeometry, provinceGeometry] = await Promise.all([
    needsFallbackGeometry ? resolver.geometry(files.geometry).catch(() => null) : Promise.resolve(null),
    needsFallbackProvinceGeometry ? resolver.geometry(files.provinceGeometry).catch(() => null) : Promise.resolve(null)
  ]);
  state.elections = parseNumberFields(elections, ['election_year']).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  state.municipalities = normalizeMunicipalityRegions(municipalities);
  state.municipalityLookupMaps = buildMunicipalityLookupMaps(state.municipalities);
  state.parties = parties;
  state.partyTaxonomy = partyTaxonomy;
  state.partyTaxonomyLookup = buildPartyTaxonomyLookup(partyTaxonomy);
  state.lineage = [];
  state.aliases = [];
  state.summary = enrichRowsWithCurrentTerritory(parseSummaryRows(eagerSummary), state.municipalityLookupMaps);
  state.resultsLong = enrichRowsWithCurrentTerritory(parseResultsLongRows(eagerResultsLong, state.partyTaxonomyLookup), state.municipalityLookupMaps);
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
  // Historical-coalitions catalog (curated JSON). Build a per-election
  // map: party_raw → coalition record. We resolve the lookup at read
  // time in shared.js#coalitionForParty so a missing file is a silent
  // no-op (coalition UI surfaces gracefully degrade).
  state.electoralCoalitions = electoralCoalitions || null;
  state.coalitionLookupByElection = buildCoalitionLookupByElection(electoralCoalitions);
  state.geometryCache = {};
  state.dataSource = source;
  state.dataSourceLabel = source === 'local' ? `Bundle locale (${resolver.fileCount || 0} file)` : 'Bundle incorporato';
  state.summaryResolver = path => resolver.csv(path);
  state.geometryResolver = path => resolver.geometry(path);
  state.resultsResolver = path => resolver.csv(path);
  state.summaryShardIndex = summaryShardIndex || null;
  state.summaryShardPaths = summaryShardIndex?.shards || null;
  state.resultsLongShardIndex = resultsShardIndex || null;
  state.resultsLongShardPaths = resultsShardIndex?.shards || null;
  const publishedTerritorialMode = String(summaryShardIndex?.territorial_mode || resultsShardIndex?.territorial_mode || '').trim();
  if (publishedTerritorialMode) state.territorialMode = publishedTerritorialMode;
  state.summaryLoadStrategy = state.summaryShardPaths && Object.keys(state.summaryShardPaths).length
    ? 'by_election'
    : (files.municipalitySummary ? 'full' : 'none');
  state.resultsLongLoadStrategy = state.resultsLongShardPaths && Object.keys(state.resultsLongShardPaths).length
    ? 'by_election'
    : (files.municipalityResultsLong ? 'full' : 'none');
  state.summaryFullLoaded = state.summaryLoadStrategy === 'full';
  state.resultsLongFullLoaded = state.resultsLongLoadStrategy === 'full';
  state.loadedSummaryElectionKeys = new Set(state.summary.map(row => row.election_key).filter(Boolean));
  state.loadedResultElectionKeys = new Set(state.resultsLong.map(row => row.election_key).filter(Boolean));
  state.summaryLoadPromises = new Map();
  state.resultsLoadPromises = new Map();
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
  state.summaryHydrationStarted = false;
  state.resultsHydrationStarted = false;
  state.summaryHydrationComplete = state.summaryFullLoaded;
  state.resultsHydrationComplete = state.resultsLongFullLoaded;
  if (typeof buildIndices === 'function') buildIndices({ rebuild: true });
  const defaults = defaultElectionSequence(state);
  state.selectedElection = state.selectedElection || defaults.at(-1)?.election_key || state.elections.at(-1)?.election_key || null;
  state.compareElection = state.compareElection || state.selectedElection || defaults.at(-2)?.election_key || null;
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
  ]).then(([lineage, aliases, customIndicators, qualityReport, datasetRegistry, codebook, usageNotes, updateLog, dataProducts, datasetContracts, provenance, releaseManifest, researchRecipes, siteGuides, archiveGapReport]) => {
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
        parseResultsLongRows(rows, state.partyTaxonomyLookup),
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
          parseResultsLongRows(rows, state.partyTaxonomyLookup),
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
  const loadedKeys = [];
  const failedKeys = [];
  const freshChunks = [];
  chunks.forEach(chunk => {
    if (!chunk?.key || state.loadedResultElectionKeys?.has(chunk.key)) return;
    if (chunk.error || !chunk.rows?.length) {
      failedKeys.push(chunk.key);
      return;
    }
    state.loadedResultElectionKeys?.add(chunk.key);
    loadedKeys.push(chunk.key);
    freshChunks.push(chunk.rows);
  });
  // Concatenate without spread to avoid V8's argument-count RangeError on
  // large shards (camera_2006 has 135k rows, camera_2013 has 139k rows;
  // anything >~125k args triggers "Maximum call stack size exceeded" in
  // Array.prototype.push(...rows). state.resultsLong.concat() uses an
  // internal copy that has no such limit.
  let freshTotal = 0;
  freshChunks.forEach(rows => { freshTotal += rows.length; });
  if (freshTotal) {
    state.resultsLong = freshChunks.reduce((acc, rows) => acc.concat(rows), state.resultsLong);
  }
  if (freshTotal || loadedKeys.length) {
    if (typeof buildIndices === 'function') {
      const flat = freshChunks.length === 1 ? freshChunks[0] : freshChunks.reduce((acc, rows) => acc.concat(rows), []);
      buildIndices({ resultRows: flat });
    }
  }
  const freshLength = freshTotal;
  if (state.resultsLongDeclaredRows && state.resultsLong.length >= state.resultsLongDeclaredRows) {
    state.resultsHydrationComplete = true;
  }
  return { strategy: 'by_election', loadedKeys, loadedRows: freshLength, failedKeys };
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
