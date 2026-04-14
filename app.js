import {
  q,
  safeNumber,
  fmtPct,
  fmtPctSigned,
  fmtInt,
  uniqueSorted,
  mean,
  PARTY_FALLBACKS,
  BLOCK_COLORS,
  FAMILY_COLORS,
  AREA_PRESETS,
  FALLBACK_PARTY_OPTIONS
} from './modules/shared.js';
import {
  trustStyle,
  matchesCompletenessFlag,
  assessRowTrustPure,
  assessViewTrustPure,
  hasMeaningfulComparabilityNote
} from './modules/quality.js';
import {
  loadData,
  loadDataFromLocalFiles,
  loadDeferredBundleMetadata,
  ensureSummaryForElections,
  ensureResultsForElections,
  ensureMapReadyForElections,
  geometryJoinKey,
  rowJoinKey,
  makeGeoProjection,
  electionCoverageFor,
  syncActiveGeometry,
  geometryYearForElectionValue,
  ensureDetailGeometryForProvince
} from './modules/data.js';
import {
  buildIndices,
  getSummaryRow,
  getResultsRows,
  aggregateShareFor,
  computeConcentration,
  computeDominanceChanges,
  computeVolatility,
  computeStabilityIndex,
  computeOverPerformanceProvince,
  computeOverPerformanceRegion,
  selectedShareSeriesForMunicipality,
  computeTrajectorySegments,
  longestLeaderRun,
  shareTrendLabel,
  getMetricValue,
  inferTurnoutTier,
  getSelectedRows,
  filteredRowsWithMetric,
  mapReadyPartyOptionsFor,
  appendSummaryRowsToIndices,
  appendMapReadyRowsToIndices,
  appendResultsLongRowsToIndices
} from './modules/selectors.js';
import { AUDIENCE_MODES, GLOSSARY_ENTRIES, GUIDED_QUESTION_BANK, DEFAULT_SITE_LAYERS, DEFAULT_METHOD_EXPLAINERS, DEFAULT_FAQ_ITEMS, DEFAULT_SITE_MANIFESTO, DEFAULT_SIGNATURE_PILLARS } from './modules/guidance.js';
import { createAnalysisModes, DEFAULT_NEXT_ACTIONS, DEFAULT_COLLAPSED_PANELS } from './modules/app-shell.js';

const LOCAL_STORAGE_KEY = 'italia_camera_explorer_state_v1';
const MAP_MAX_ZOOM = 32;
const DETAIL_ZOOM_THRESHOLD = 7;

const state = {
  manifest: null,
  elections: [],
  municipalities: [],
  municipalitySearchIndex: [],
  municipalitiesAreSlim: false,
  parties: [],
  lineage: [],
  aliases: [],
  summary: [],
  resultsLong: [],
  mapReadyRows: [],
  customIndicators: [],
  dataSource: 'embedded',
  dataSourceLabel: 'Bundle incorporato',
  datasetRegistry: [],
  codebook: null,
  usageNotes: [],
  updateLog: [],
  dataProducts: null,
  datasetContracts: null,
  provenance: null,
  releaseManifest: null,
  researchRecipes: [],
  geometry: null,
  qualityReport: null,
  selectedElection: null,
  compareElection: null,
  selectedMetric: 'turnout',
  selectedPartyMode: 'party_std',
  selectedParty: null,
  selectedCustomIndicator: null,
  territorialMode: 'historical',
  geometryReferenceYear: 'auto',
  selectedProvinceSet: new Set(),
  selectedMunicipalityId: null,
  selectedCompleteness: 'all',
  selectedTerritorialStatus: 'all',
  sameScaleAcrossYears: true,
  selectedPalette: 'auto',
  minSharePct: 0,
  tableSort: 'municipality_asc',
  showNotes: true,
  trajectoryMode: 'selected_vs_context',
  filteredRows: [],
  metricCaches: {},
  selectorCaches: {},
  indices: {},
  electionLabels: [],
  compareMunicipalityIds: [],
  recentMunicipalityIds: [],
  bookmarkedMunicipalityIds: [],
  tablePage: 1,
  playbackTimer: null,
  similarityCache: {},
  swipePosition: 50,
  municipalityNotes: {},
  selectedAreaPreset: 'all',
  focusMode: false,
  uiIssues: [],
  commandPaletteIndex: 0,
  analysisMode: 'explore',
  uiDensity: 'comfortable',
  visionMode: 'default',
  savedViews: [],
  viewHistory: [],
  historyIndex: -1,
  historySuspend: false,
  lastHistoryHash: null,
  collapsedPanels: { ...DEFAULT_COLLAPSED_PANELS },
  onboardingDismissed: false,
  uiLevel: 'basic',
  audienceMode: 'public',
  renderQueued: false,
  renderCycle: 0,
  deferredRenderHandle: null,
  deferredRenderKind: null,
  lastMapRenderKey: null,
  summaryDeclaredRows: 0,
  summaryHydrationStarted: false,
  summaryHydrationComplete: false,
  resultsLongDeclaredRows: 0,
  resultsHydrationStarted: false,
  resultsHydrationComplete: false,
  mapReadyDeclaredRows: 0,
  mapReadyHydrationStarted: false,
  mapReadyHydrationComplete: false,
  archiveBundleGapReport: [],
  archiveBundleGapSummary: null,
  archiveGapByElection: new Map(),
  mapCanvasCache: null,
  mapCanvasRender: null,
  mapCanvasTransform: null,
  mapCanvasMoveFrame: null,
  mapCanvasZoomFrame: null,
  mapCanvasLastPointerEvent: null,
  mapCanvasLastHit: null,
  mapTooltipPinned: false,
  mapZoomTarget: null,
  mapRefreshPending: false,
  mapRefreshToken: 0,
  mapRefreshLabel: '',
  mapIdlePrefetchHandle: null,
  prefetchedElectionKeys: new Set(),
  controlBusyPreviousDisabled: new WeakMap(),
  controlBusyCounts: new WeakMap(),
  detailGeometry: null,
  detailGeometryKey: null,
  detailGeometryWantedKey: null,
  detailGeometryLoadingKey: null,
  detailGeometryLoadPromise: null,
  lastAutoZoomMunicipality: null
};

state.geometryPack = null;
state.provinceGeometry = null;
state.geometryCompareA = null;
state.geometryCompareB = null;
state.geometrySwipe = null;
state.geometryCache = { municipalities: {}, provinces: {} };
state.detailGeometryCache = {};
const ANALYSIS_MODES = createAnalysisModes(state);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function normalizeTextToken(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesCompleteness(row) {
  return matchesCompletenessFlag(row?.completeness_flag, state.selectedCompleteness || 'all');
}

function matchesTerritorialStatus(row) {
  const selected = normalizeTextToken(state.selectedTerritorialStatus || 'all');
  if (!selected || selected === 'all') return true;
  return normalizeTextToken(row?.territorial_status || '') === selected;
}

function municipalityLabelById(id) {
  if (!id) return 'Comune n/d';
  const m = state.municipalities.find(d => d.municipality_id === id || d.geometry_id === id)
    || state.summary.find(d => d.municipality_id === id || d.geometry_id === id);
  const label = m?.label || m?.name_current || m?.municipality_name || m?.name_historical;
  const province = m?.province_current || m?.province;
  return m ? `${label}${province ? ` (${province})` : ''}` : String(id);
}

function municipalityNoteRecord(id = state.selectedMunicipalityId) {
  if (!id) return null;
  return { municipality_id: id, note: state.municipalityNotes?.[id] || '', updated_at: state.municipalityNotes?.[`__ts__${id}`] || null };
}

function updateMunicipalityNoteUI() {
  if (!els.municipalityNoteInput || !els.municipalityNoteMeta) return;
  const rec = municipalityNoteRecord();
  els.municipalityNoteInput.value = rec?.note || '';
  els.municipalityNoteMeta.textContent = rec?.updated_at ? `Nota locale aggiornata ${new Date(rec.updated_at).toLocaleString('it-IT')}` : 'Aggiungi una nota privata salvata nel browser.';
}

function inferPartyMeta(label) {
  const raw = String(label || '').trim();
  const match = PARTY_FALLBACKS.find(([re]) => re.test(raw));
  const meta = match ? match[1] : { family: 'altro', bloc: 'altro', color: '#64748b', display: raw || 'N/D' };
  return { display: meta.display || raw || 'N/D', family: meta.family || 'altro', bloc: meta.bloc || 'altro', color: meta.color || '#64748b' };
}

function getPartyColor(label) { return inferPartyMeta(label).color; }
function getFamilyColor(label) { return FAMILY_COLORS[label] || inferPartyMeta(label).color || FAMILY_COLORS.altro; }
function getBlockColor(label) { return BLOCK_COLORS[label] || BLOCK_COLORS.altro; }
function getGroupColor(label) {
  if (state.selectedPartyMode === 'party_family') return getFamilyColor(label);
  if (state.selectedPartyMode === 'bloc') return getBlockColor(label);
  return getPartyColor(label);
}

function customIndicatorMeta(key) {
  return state.customIndicators.find(d => (d.indicator_key || d.key) === key) || {};
}

function metricNeedsCompare() {
  return ['swing_compare', 'delta_turnout'].includes(state.selectedMetric);
}

function audienceMeta() {
  return AUDIENCE_MODES[state.audienceMode] || AUDIENCE_MODES.public;
}

function metricReadableExplanation() {
  switch (state.selectedMetric) {
    case 'turnout': return "La mappa mostra quanta partecipazione elettorale c'è stata, non quale partito ha vinto.";
    case 'first_party': return 'La mappa mostra chi arriva primo in ogni comune, non il margine della vittoria.';
    case 'party_share': return `La mappa mostra la quota della selezione attiva (${state.selectedParty || 'partito'}) dove il dato è disponibile.`;
    case 'margin': return 'La mappa mostra il distacco tra primo e secondo: più è alto, più il comune è sbilanciato.';
    case 'swing_compare': return 'La mappa mostra una differenza tra due elezioni: serve un anno di confronto attivo.';
    case 'delta_turnout': return "La mappa mostra come cambia l'affluenza rispetto all'elezione di confronto.";
    case 'volatility': return 'La mappa mostra quanto il comportamento elettorale è mobile nel tempo.';
    case 'dominance_changes': return 'La mappa mostra quante volte cambia il partito dominante nel comune.';
    case 'concentration': return 'La mappa mostra quanto il voto è concentrato su pochi soggetti politici.';
    case 'over_performance_province': return 'La mappa mostra quanto la selezione attiva va meglio o peggio rispetto alla provincia.';
    case 'over_performance_region': return "La mappa mostra quanto la selezione attiva va meglio o peggio rispetto all'Italia.";
    case 'stability_index': return 'La mappa mostra una sintesi di continuità e stabilità della traiettoria comunale.';
    case 'custom_indicator': return 'La mappa mostra un indicatore esterno caricato nel bundle.';
    default: return 'La mappa mostra la metrica attiva sul filtro corrente.';
  }
}

function currentCoverageNote() {
  const substantive = state.qualityReport?.derived_validations?.substantive_coverage_score;
  if (substantive == null) return 'La copertura sostanziale del bundle non è dichiarata.';
  if (substantive < 30) return 'Copertura sostanziale ancora bassa: la vista è utile soprattutto per esplorare, non per chiudere conclusioni forti.';
  if (substantive < 60) return 'Copertura intermedia: buona per letture mirate, ma non uniforme su tutti gli anni.';
  return 'Copertura sostanziale buona: il bundle regge letture più ambiziose, restando comunque da verificare anno per anno.';
}

function summaryHydrationSummary() {
  const declared = Math.max(state.summaryDeclaredRows || 0, state.summary.length || 0);
  const loaded = state.summary.length || 0;
  if (!declared) return 'Nessun summary comunale dichiarato nel bundle corrente.';
  if (state.summaryFullLoaded || loaded >= declared) return `Summary comunali caricati: ${fmtInt(loaded)} righe.`;
  return `Summary comunali caricati progressivamente: ${fmtInt(loaded)} / ${fmtInt(declared)} righe.`;
}

function resultsHydrationSummary() {
  const declared = Math.max(state.resultsLongDeclaredRows || 0, state.resultsLong.length || 0);
  const loaded = state.resultsLong.length || 0;
  if (!declared) return 'Nessun risultato di partito dichiarato nel bundle corrente.';
  if (state.resultsLongFullLoaded || loaded >= declared) return `Risultati di partito caricati: ${fmtInt(loaded)} righe.`;
  return `Risultati di partito caricati progressivamente: ${fmtInt(loaded)} / ${fmtInt(declared)} righe.`;
}

function mapReadyHydrationSummary() {
  const declared = Math.max(state.mapReadyDeclaredRows || 0, state.mapReadyRows.length || 0);
  const loaded = state.mapReadyRows.length || 0;
  if (!declared) return 'Asset mappa veloce non dichiarato nel bundle corrente.';
  if (loaded >= declared) return `Asset mappa veloce caricati: ${fmtInt(loaded)} righe.`;
  return `Asset mappa veloce caricati progressivamente: ${fmtInt(loaded)} / ${fmtInt(declared)} righe.`;
}

function visibleElectionKeysForSummary() {
  const keys = new Set([state.selectedElection].filter(Boolean));
  if (shouldHydrateCompareSummaryNow()) keys.add(state.compareElection);
  const needsHistory = ['volatility', 'dominance_changes', 'stability_index', 'concentration'].includes(state.selectedMetric)
    || ['trajectory', 'similarity', 'archetypes', 'group_compare'].includes(state.analysisMode)
    || state.uiLevel === 'research';
  if (needsHistory) {
    state.elections.forEach(election => {
      const coverage = electionCoverageFor(state, election.election_key);
      if (coverage.summary) keys.add(election.election_key);
    });
  }
  return [...keys];
}

function visibleElectionKeysForResults() {
  const keys = new Set([state.selectedElection].filter(Boolean));
  if (state.compareElection && (metricNeedsCompare() || state.analysisMode === 'compare' || state.selectedMunicipalityId)) {
    keys.add(state.compareElection);
  }
  const needsHistory = ['volatility', 'dominance_changes', 'stability_index', 'concentration'].includes(state.selectedMetric)
    || state.analysisMode === 'trajectory'
    || state.uiLevel === 'research';
  if (needsHistory) {
    state.elections.forEach(election => {
      const coverage = electionCoverageFor(state, election.election_key);
      if (coverage.results) keys.add(election.election_key);
    });
  }
  return [...keys];
}

function visibleElectionKeysForMapReady() {
  return [state.selectedElection].filter(Boolean);
}

function idle(callback, timeout = 600) {
  return window.requestIdleCallback
    ? window.requestIdleCallback(callback, { timeout })
    : window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), Math.min(timeout, 350));
}

function applySummaryHydrationOutcome(report, { silent = true } = {}) {
  if (!report || (!report.loadedRows && !(report.loadedKeys || []).length)) return;
  invalidateDerivedCaches();
  renderStatusPanel();
  requestRender();
  if (!silent) {
    const label = report.strategy === 'by_election'
      ? `${(report.loadedKeys || []).join(', ')}`
      : 'bundle completo';
    showToast(`Summary comunali caricati: ${label}.`, 'success', 1800);
  }
}

function ensureVisibleSummary({ silent = true } = {}) {
  return ensureSummaryForElections(state, visibleElectionKeysForSummary(), {
    buildIndices: updateIndices,
    registerIssue
  }).then(report => {
    applySummaryHydrationOutcome(report, { silent });
    return report;
  });
}

function applyMapReadyHydrationOutcome(report, { silent = true } = {}) {
  if (!report || (!report.loadedRows && !(report.loadedKeys || []).length)) return;
  invalidateDerivedCaches();
  renderStatusPanel();
  refreshPartySelector();
  requestRender();
  if (!silent) {
    const label = report.strategy === 'by_election'
      ? `${(report.loadedKeys || []).join(', ')}`
      : 'bundle completo';
    showToast(`Asset mappa veloce caricati: ${label}.`, 'success', 1400);
  }
}

function ensureVisibleMapReady({ silent = true } = {}) {
  return ensureMapReadyForElections(state, visibleElectionKeysForMapReady(), {
    buildIndices: updateIndices,
    registerIssue
  }).then(report => {
    applyMapReadyHydrationOutcome(report, { silent });
    return report;
  });
}

function applyResultsHydrationOutcome(report, { silent = true } = {}) {
  if (!report || (!report.loadedRows && !(report.loadedKeys || []).length)) return;
  invalidateDerivedCaches();
  renderStatusPanel();
  refreshPartySelector();
  requestRender();
  if (!silent) {
    const label = report.strategy === 'by_election'
      ? `${(report.loadedKeys || []).join(', ')}`
      : 'bundle completo';
    showToast(`Risultati di partito caricati: ${label}.`, 'success', 1800);
  }
}

function ensureVisibleResults({ silent = true } = {}) {
  return ensureResultsForElections(state, visibleElectionKeysForResults(), {
    buildIndices: updateIndices,
    registerIssue
  }).then(report => {
    applyResultsHydrationOutcome(report, { silent });
    return report;
  });
}

function scheduleBackgroundResultsHydration() {
  if (state.resultsHydrationStarted || state.resultsLongLoadStrategy !== 'by_election') return;
  state.resultsHydrationStarted = true;

  const pump = () => {
    const remaining = state.elections
      .map(election => election.election_key)
      .filter(key => {
        const coverage = electionCoverageFor(state, key);
        return coverage.results && !state.loadedResultElectionKeys?.has(key);
      });
    if (!remaining.length) {
      state.resultsHydrationComplete = true;
      renderStatusPanel();
      return;
    }
    idle(async () => {
      const report = await ensureResultsForElections(state, remaining.slice(0, 1), {
        buildIndices: updateIndices,
        registerIssue
      });
      applyResultsHydrationOutcome(report, { silent: true });
      pump();
    });
  };
  window.setTimeout(pump, 1200);
}

function scheduleBackgroundSummaryHydration() {
  if (state.summaryHydrationStarted || state.summaryLoadStrategy !== 'by_election') return;
  state.summaryHydrationStarted = true;

  const pump = () => {
    const remaining = state.elections
      .map(election => election.election_key)
      .filter(key => {
        const coverage = electionCoverageFor(state, key);
        return coverage.summary && !state.loadedSummaryElectionKeys?.has(key);
      });
    if (!remaining.length) {
      state.summaryHydrationComplete = true;
      renderStatusPanel();
      return;
    }
    idle(async () => {
      const report = await ensureSummaryForElections(state, remaining.slice(0, 1), {
        buildIndices: updateIndices,
        registerIssue
      });
      applySummaryHydrationOutcome(report, { silent: true });
      pump();
    });
  };
  window.setTimeout(pump, 1200);
}


function currentReleaseVersion() {
  return state.releaseManifest?.project?.version || state.manifest?.project?.version || 'n/d';
}

function currentReleaseDate() {
  return state.updateLog?.[0]?.date || 'data non disponibile';
}

function releaseIntegrityStatus() {
  const integrity = state.releaseManifest?.integrity || {};
  if (integrity.all_declared_files_present && integrity.all_declared_file_hashes_verified) return { label: 'Integrità verificata', tone: 'ok' };
  if (integrity.all_declared_files_present) return { label: 'File presenti', tone: 'warn' };
  return { label: 'Integrità non verificata', tone: 'warn' };
}

function archiveGapRowForElection(key) {
  if (!key) return null;
  return state.archiveGapByElection?.get(key) || null;
}

function currentArchiveGapSummary() {
  if (state.archiveBundleGapSummary) return state.archiveBundleGapSummary;
  const rows = state.archiveBundleGapReport || [];
  return {
    rows: rows.length,
    bundle_empty_archive_nonempty: rows.filter(row => (row.flags || []).includes('bundle_empty_archive_nonempty')).length,
    bundle_below_archive_positive_tables: rows.filter(row => (row.flags || []).includes('bundle_below_archive_positive_tables')).length,
    bundle_severely_partial_vs_archive: rows.filter(row => (row.flags || []).includes('bundle_severely_partial_vs_archive')).length,
    with_any_flags: rows.filter(row => (row.flags || []).length).length
  };
}

function archiveGapStatus(gapRow) {
  if (!gapRow) return { label: 'archivio n/d', tone: 'none' };
  const flags = gapRow.flags || [];
  if (flags.includes('bundle_empty_archive_nonempty')) return { label: 'bundle vuoto vs archivio', tone: 'partial' };
  if (flags.includes('bundle_severely_partial_vs_archive')) return { label: 'gap forte vs archivio', tone: 'partial' };
  if (flags.includes('bundle_below_archive_positive_tables')) return { label: 'sotto archivio', tone: 'partial' };
  if ((gapRow.archive_positive_table_rows || gapRow.archive_municipality_like_rows || 0) > 0) return { label: 'in linea con archivio', tone: 'ok' };
  return { label: 'archivio senza copertura utile', tone: 'none' };
}

function buildProgrammaticSnippet(language = 'python') {
  const election = state.selectedElection || '';
  const province = [...state.selectedProvinceSet][0] || '';
  if (language === 'r') {
    return `source('clients/r/lce_loader.R')
bundle <- load_lce_bundle('.')
summary <- lce_read(bundle, 'municipalitySummary')
subset <- subset(summary, election_key == '${election}'${province ? ` & province == '${province}'` : ''})
head(subset)`;
  }
  return `from clients.python.lce_loader import load_bundle
bundle = load_bundle('.')
summary = bundle.filter_summary(election_key='${election}'${province ? `, province='${province}'` : ''})
print(summary.head())`;
}

function buildProjectCitation() {
  const version = currentReleaseVersion();
  const date = currentReleaseDate();
  return `Italia Camera Explorer, release ${version} (${date}). Bundle statico boundary-aware per l'analisi comunale delle elezioni della Camera e dell'Assemblea Costituente in Italia.`;
}

function researchRecipesForAudience() {
  const audience = state.audienceMode || 'public';
  const recipes = Array.isArray(state.researchRecipes) ? state.researchRecipes.filter(item => (item.audiences || []).includes(audience)) : [];
  return state.uiLevel === 'basic' ? recipes.slice(0, 4) : recipes;
}

function electionLabelByKey(key) {
  if (!key) return 'nessuna elezione';
  const rec = state.elections.find(d => d.election_key === key);
  return rec?.election_label || rec?.election_year || key;
}

function metricNeedsPartyResults() {
  if (state.selectedMetric === 'concentration') return true;
  if (state.selectedMetric === 'party_share') return state.mapReadyLoadStrategy !== 'by_election';
  return Boolean(state.selectedParty)
    && ['party_share', 'swing_compare', 'over_performance_province', 'over_performance_region'].includes(state.selectedMetric);
}

function shouldHydratePartyResultsNow() {
  if (state.selectedMunicipalityId && document.body.dataset.dashboardView === 'profile') return true;
  if (metricNeedsPartyResults()) return true;
  if (state.analysisMode === 'trajectory') return true;
  if (state.analysisMode === 'compare' && state.compareElection && state.selectedParty) return true;
  return false;
}

function shouldHydrateCompareSummaryNow() {
  if (!state.compareElection || state.compareElection === state.selectedElection) return false;
  return Boolean(state.selectedMunicipalityId)
    || metricNeedsCompare()
    || state.analysisMode === 'compare'
    || document.body.dataset.dashboardView === 'profile';
}

function updateIndices(delta = {}) {
  let appended = false;
  if (delta?.summaryRows?.length) {
    appendSummaryRowsToIndices(state, delta.summaryRows);
    appended = true;
  }
  if (delta?.mapReadyRows?.length) {
    appendMapReadyRowsToIndices(state, delta.mapReadyRows);
    appended = true;
  }
  if (delta?.resultRows?.length) {
    appendResultsLongRowsToIndices(state, delta.resultRows);
    appended = true;
  }
  if (appended) {
    return;
  }
  buildIndices(state);
}

function ensureDeferredMetadata({ silent = true } = {}) {
  return loadDeferredBundleMetadata(state, { buildIndices: updateIndices, registerIssue }).then(report => {
    if (report?.loaded) {
      invalidateDerivedCaches();
      setupControls();
      readControls();
      updateBodyAppearance();
      renderStatusPanel();
      requestRender();
      if (!silent) showToast('Metadata, usage notes e release studio caricati.', 'success', 1800);
    }
    return report;
  });
}

function currentSelectionLabel() {
  if (state.selectedMetric === 'custom_indicator') return customIndicatorMeta(state.selectedCustomIndicator).label || 'indicatore custom';
  if (state.selectedParty) return state.selectedParty;
  return metricLabel().toLowerCase();
}

function formatMetricValue(value) {
  if (value == null || value === '') return 'n/d';
  if (typeof value === 'string') return value;
  switch (state.selectedMetric) {
    case 'turnout':
    case 'party_share':
    case 'margin':
    case 'volatility':
    case 'concentration':
    case 'stability_index':
      return `${fmtPct(value)}%`;
    case 'swing_compare':
    case 'delta_turnout':
    case 'over_performance_province':
    case 'over_performance_region':
      return `${fmtPctSigned(value)} pt`;
    case 'dominance_changes':
      return `${fmtInt(value)}`;
    default:
      return `${fmtPct(value)}%`;
  }
}

function metricSentenceForRow(row) {
  if (!row) return 'metrica non disponibile sul comune selezionato';
  const metricValue = getMetricValue(state, row);
  const selection = currentSelectionLabel();
  switch (state.selectedMetric) {
    case 'turnout': return `affluenza ${formatMetricValue(metricValue)}`;
    case 'first_party': return `primo partito ${row.first_party_std || 'n/d'}`;
    case 'party_share': return `${selection} ${formatMetricValue(metricValue)}`;
    case 'margin': return `margine 1°-2° ${formatMetricValue(metricValue)}`;
    case 'dominant_block': return `blocco dominante ${row.dominant_block || 'n/d'}`;
    case 'swing_compare': return `swing ${selection} ${formatMetricValue(metricValue)}`;
    case 'delta_turnout': return `Δ affluenza ${formatMetricValue(metricValue)}`;
    case 'volatility': return `volatilità ${formatMetricValue(metricValue)}`;
    case 'dominance_changes': return `cambi di dominanza ${formatMetricValue(metricValue)}`;
    case 'concentration': return `concentrazione ${formatMetricValue(metricValue)}`;
    case 'over_performance_province': return `scarto vs provincia ${formatMetricValue(metricValue)}`;
    case 'over_performance_region': return `scarto vs Italia ${formatMetricValue(metricValue)}`;
    case 'stability_index': return `stabilità ${formatMetricValue(metricValue)}`;
    case 'custom_indicator': return `${selection} ${formatMetricValue(metricValue)}`;
    default: return `${metricLabel().toLowerCase()} ${formatMetricValue(metricValue)}`;
  }
}

function viewStandfirst(rows, trust) {
  const electionLabel = electionLabelByKey(state.selectedElection);
  const compareLabel = state.compareElection ? electionLabelByKey(state.compareElection) : null;
  const provinces = [...state.selectedProvinceSet];
  const provinceText = provinces.length ? ` nelle province ${provinces.join(', ')}` : " sull'intero filtro corrente";
  const modeText = state.territorialMode === 'harmonized' ? 'armonizzata' : 'storica';
  if (state.audienceMode === 'research') return `Vista ${modeText} su ${electionLabel}${compareLabel ? `, con confronto ${compareLabel}` : ''}: ${fmtInt(rows.length)} unità filtrate, base geometrica ${state.geometryReferenceYear || 'auto'}, affidabilità vista ${trust.label.toLowerCase()}.`;
  if (state.audienceMode === 'admin') return `Lettura operativa per ${electionLabel}${compareLabel ? ` rispetto a ${compareLabel}` : ''}: ${fmtInt(rows.length)} comuni filtrati${provinceText}, con attenzione a affluenza, scarti territoriali e comparabilità.`;
  if (state.audienceMode === 'press') return `Appunto da usare con disciplina: ${fmtInt(rows.length)} comuni filtrati per ${electionLabel}${compareLabel ? `, confronto con ${compareLabel}` : ''}. La vista aiuta a trovare differenze, ma va citata insieme a copertura e limiti.`;
  return `Vista su ${electionLabel}${compareLabel ? ` con confronto ${compareLabel}` : ''}: ${fmtInt(rows.length)} comuni filtrati${provinceText}. ${metricReadableExplanation()}`;
}

function buildViewBriefing(rows = filteredRowsWithMetric(state)) {
  const trust = assessViewTrust(rows);
  const selectedElectionLabel = electionLabelByKey(state.selectedElection);
  const compareLabel = state.compareElection ? electionLabelByKey(state.compareElection) : null;
  const coverage = state.selectedElection ? electionCoverageFor(state, state.selectedElection) : {};
  const compareCoverage = state.compareElection ? electionCoverageFor(state, state.compareElection) : null;
  const selected = selectedMunicipalityRecord();
  const currentRow = selected ? (getSummaryRow(state, state.selectedElection, state.selectedMunicipalityId) || (state.indices.summaryByMunicipality.get(state.selectedMunicipalityId) || []).slice().sort((a, b) => (a.election_year || 0) - (b.election_year || 0)).at(-1) || null) : null;
  const municipalityHeadline = selected && currentRow ? `${municipalityLabelById(state.selectedMunicipalityId)} · ${metricSentenceForRow(currentRow)}` : null;
  const headline = municipalityHeadline || `${metricLabel()} · ${selectedElectionLabel} · ${fmtInt(rows.length)} comuni filtrati`;
  const canSay = [];
  const caution = [];
  const cannotSay = [];

  canSay.push(`La vista attuale usa ${fmtInt(rows.length)} comuni filtrati e una lettura ${state.territorialMode === 'harmonized' ? 'armonizzata' : 'storica'} del territorio.`);
  canSay.push(`Per ${selectedElectionLabel}, il bundle ha ${coverage?.summary ? 'summary disponibile' : 'summary assente'}${coverage?.results ? ' e risultati di partito' : metricNeedsPartyResults() ? ' ma risultati di partito non completi per questa lettura' : ''}.`);
  if (selected && currentRow) canSay.push(`Nel comune selezionato (${municipalityLabelById(state.selectedMunicipalityId)}), la vista mostra ${metricSentenceForRow(currentRow)} nell'elezione attiva.`);
  if (compareLabel && compareCoverage && (compareCoverage.summary || compareCoverage.results)) canSay.push(`Il confronto con ${compareLabel} è attivo${metricNeedsCompare() ? ' e rende leggibile la metrica differenziale' : ''}.`);
  if (state.geometry?.features?.length) canSay.push(`La mappa usa geometrie reali con base ${state.geometryReferenceYear || 'auto'} e join attivi sui comuni disponibili.`);

  caution.push(currentCoverageNote());
  (trust.reasons || []).slice(0, 3).forEach(reason => caution.push(reason));
  if (metricNeedsCompare() && !state.compareElection) caution.push('La metrica attiva richiede un confronto esplicito: senza anno B la lettura resta incompleta.');
  if (compareLabel && compareCoverage && !compareCoverage.summary && !compareCoverage.results) caution.push(`Il bundle non offre copertura utile per ${compareLabel}, quindi il confronto va trattato con molta prudenza.`);
  if (metricNeedsPartyResults() && !coverage?.results) caution.push('La metrica attiva usa risultati di partito, ma il bundle corrente non li offre in modo pienamente leggibile per questo filtro.');
  if (currentRow?.comparability_note) caution.push(`Comune selezionato: ${currentRow.comparability_note}`);
  if (!state.geometry?.features?.length) caution.push('Le geometrie attive mancano o non sono caricabili: la lettura spaziale è limitata.');

  if (state.qualityReport?.derived_validations && (state.qualityReport.derived_validations.substantive_coverage_score ?? 0) < 40) cannotSay.push("Questa vista non basta per descrivere da sola la storia elettorale completa dell'Italia.");
  if (state.selectedMetric === 'first_party') cannotSay.push('Il primo partito non misura da solo il margine della vittoria né la distanza dagli inseguitori.');
  if (state.selectedMetric === 'turnout') cannotSay.push("L'affluenza non identifica da sola quali partiti siano forti o deboli.");
  if (state.selectedMetric === 'party_share') cannotSay.push("La quota della selezione attiva non equivale all'intera distribuzione del voto nel comune.");
  if (state.selectedMetric === 'swing_compare' || state.selectedMetric === 'delta_turnout') cannotSay.push('Una differenza tra due elezioni non spiega da sola le cause del cambiamento.');
  if (state.selectedMetric === 'custom_indicator') cannotSay.push('Un indicatore custom non diventa automaticamente comparabile nel tempo o tra comuni senza validazione esterna.');
  if (state.territorialMode === 'harmonized' && !state.summary.some(r => r.territorial_mode === 'harmonized')) cannotSay.push('La modalità armonizzata è visibile, ma il bundle corrente non la popola davvero con righe utili.');
  if (!cannotSay.length) cannotSay.push('La vista non sostituisce coverage matrix, audit, lineage e note metodologiche quando vuoi fare affermazioni forti.');

  const geometryText = state.geometryReferenceYear === 'auto'
    ? `auto${state.geometryPack?.defaultYear ? ` (default ${state.geometryPack.defaultYear})` : ''}`
    : state.geometryReferenceYear;
  const methodNote = `Vista costruita su ${selectedElectionLabel}${compareLabel ? ` con confronto ${compareLabel}` : ''}; metrica: ${metricLabel()}${state.selectedParty ? ` (${state.selectedParty})` : state.selectedMetric === 'custom_indicator' && state.selectedCustomIndicator ? ` (${customIndicatorMeta(state.selectedCustomIndicator).label || state.selectedCustomIndicator})` : ''}; modalità territoriale: ${state.territorialMode}; base geometrica: ${geometryText}; comuni filtrati: ${rows.length}; affidabilità vista: ${trust.label}; ${currentCoverageNote()}`;

  return {
    badge: `${audienceMeta().label} · ${trust.label}`,
    headline,
    standfirst: viewStandfirst(rows, trust),
    canSay: [...new Set(canSay)].slice(0, 5),
    caution: [...new Set(caution)].slice(0, 5),
    cannotSay: [...new Set(cannotSay)].slice(0, 5),
    methodNote,
    trust
  };
}

function assessRowTrust(row, lineage = null) {
  return assessRowTrustPure({
    row,
    lineage,
    hasGeometry: !!state.geometry?.features?.length,
    metricNeedsCompare: metricNeedsCompare(),
    compareElection: !!state.compareElection,
    territorialMode: state.territorialMode
  });
}

function assessViewTrust(rows = filteredRowsWithMetric(state)) {
  return assessViewTrustPure({
    rows,
    hasGeometry: !!state.geometry?.features?.length,
    metricNeedsCompare: metricNeedsCompare(),
    compareElection: !!state.compareElection,
    territorialMode: state.territorialMode
  });
}

function rememberMunicipality(id) {
  if (!id) return;
  state.recentMunicipalityIds = [id, ...state.recentMunicipalityIds.filter(x => x !== id)].slice(0, 8);
}

function selectMunicipality(id, options = {}) {
  if (!id) return;
  state.selectedMunicipalityId = id;
  rememberMunicipality(id);
  if (options.updateSearch !== false && els.municipalitySearch) els.municipalitySearch.value = municipalityLabelById(id);
  updateMunicipalityNoteUI();
  syncURLState();
  ensureDetailGeometryForMunicipality(id, { reason: 'selection' });
}

function detailGeometryRequestForMunicipality(municipalityId = state.selectedMunicipalityId) {
  if (!municipalityId || !state.geometryPack?.detailMunicipalities) return null;
  const row = getSummaryRow(state, state.selectedElection, municipalityId)
    || state.mapReadyRows.find(d => d.election_key === state.selectedElection && d.municipality_id === municipalityId)
    || state.summary.find(d => d.municipality_id === municipalityId)
    || state.municipalities.find(d => d.municipality_id === municipalityId || d.geometry_id === municipalityId);
  const province = String(row?.province || row?.province_current || '').trim();
  const year = geometryYearForElectionValue(state, state.selectedElection, state.territorialMode);
  if (!province || !year) return null;
  const provinceKey = normalizeTextToken(province) || province;
  return { municipalityId, province, year, key: `${year}__${provinceKey}` };
}

function activateDetailGeometry(geometry, request) {
  if (!geometry?.features?.length || !request?.key) return false;
  state.detailGeometry = geometry;
  state.detailGeometryKey = request.key;
  state.mapCanvasCache = null;
  state.lastMapRenderKey = null;
  return true;
}

function ensureDetailGeometryForMunicipality(municipalityId = state.selectedMunicipalityId, options = {}) {
  const request = detailGeometryRequestForMunicipality(municipalityId);
  if (!request) return Promise.resolve(null);
  state.detailGeometryWantedKey = request.key;
  if (state.detailGeometryKey === request.key && state.detailGeometry?.features?.length) {
    return Promise.resolve(state.detailGeometry);
  }
  if (state.detailGeometryLoadingKey === request.key && state.detailGeometryLoadPromise) {
    return state.detailGeometryLoadPromise;
  }
  state.detailGeometryLoadingKey = request.key;
  state.detailGeometryLoadPromise = ensureDetailGeometryForProvince(state, request.year, request.province, registerIssue)
    .then(geometry => {
      if (state.detailGeometryWantedKey !== request.key && !options.forceActivate) return geometry;
      if (activateDetailGeometry(geometry, request)) {
        if (state.selectedMunicipalityId === municipalityId) state.lastAutoZoomMunicipality = null;
        requestRender();
      }
      return geometry;
    })
    .finally(() => {
      if (state.detailGeometryLoadingKey === request.key) state.detailGeometryLoadingKey = null;
    });
  return state.detailGeometryLoadPromise;
}

function ensureDetailGeometryForCurrentFocus(transform = state.mapCanvasTransform) {
  if (!transform || transform.k < DETAIL_ZOOM_THRESHOLD) return;
  const municipalityId = state.selectedMunicipalityId || state.mapCanvasLastHit?.row?.municipality_id;
  if (!municipalityId) return;
  ensureDetailGeometryForMunicipality(municipalityId, { reason: 'deep-zoom' });
}

function toggleBookmarkMunicipality(id) {
  if (!id) return;
  if (state.bookmarkedMunicipalityIds.includes(id)) state.bookmarkedMunicipalityIds = state.bookmarkedMunicipalityIds.filter(x => x !== id);
  else state.bookmarkedMunicipalityIds = [id, ...state.bookmarkedMunicipalityIds].slice(0, 12);
  syncURLState();
}

function saveLocalState() {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      recentMunicipalityIds: state.recentMunicipalityIds,
      bookmarkedMunicipalityIds: state.bookmarkedMunicipalityIds,
      municipalityNotes: state.municipalityNotes,
      savedViews: state.savedViews,
      collapsedPanels: state.collapsedPanels,
      onboardingDismissed: state.onboardingDismissed,
      lastView: currentViewState()
    }));
  } catch {}
}

function restoreLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    state.recentMunicipalityIds = obj.recentMunicipalityIds || [];
    state.bookmarkedMunicipalityIds = obj.bookmarkedMunicipalityIds || [];
    state.municipalityNotes = obj.municipalityNotes || {};
    state.savedViews = obj.savedViews || [];
    state.collapsedPanels = { ...DEFAULT_COLLAPSED_PANELS, ...(obj.collapsedPanels || {}) };
    state.onboardingDismissed = !!obj.onboardingDismissed;
    Object.assign(state, obj.lastView || {});
    if (Array.isArray(obj.lastView?.selectedProvinces)) state.selectedProvinceSet = new Set(obj.lastView.selectedProvinces);
  } catch {}
}

function refreshPartySelector() {
  if (!els.partySelect) return;
  const effectiveMode = state.selectedMetric === 'party_share' ? 'party_std' : state.selectedPartyMode;
  let values = mapReadyPartyOptionsFor(state, state.selectedElection, effectiveMode);
  const electionRows = state.resultsLong.filter(r => !state.selectedElection || r.election_key === state.selectedElection);
  const sourceRows = state.selectedElection ? electionRows : state.resultsLong;
  if (!values.length) {
    values = effectiveMode === 'bloc'
      ? uniqueSorted(sourceRows.map(r => r.bloc || inferPartyMeta(r.party_std || r.party_raw).bloc).filter(Boolean))
      : effectiveMode === 'party_family'
        ? uniqueSorted(sourceRows.map(r => r.party_family || inferPartyMeta(r.party_std || r.party_raw).family).filter(Boolean))
        : uniqueSorted(sourceRows.map(r => r.party_std || inferPartyMeta(r.party_raw).display).filter(Boolean));
  }
  const placeholder = values.length ? '' : '<option value="">Carico i partiti...</option>';
  els.partySelect.innerHTML = placeholder || values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  els.partySelect.disabled = !values.length;
  if (!values.includes(state.selectedParty)) state.selectedParty = values[0] || null;
  els.partySelect.value = state.selectedParty || '';
}

function updateElectionSlider() {
  if (!els.electionSlider || !els.sliderYearLabel) return;
  const idx = state.electionLabels.findIndex(d => d.value === state.selectedElection);
  els.electionSlider.max = Math.max(0, state.electionLabels.length - 1);
  els.electionSlider.value = Math.max(0, idx);
  els.sliderYearLabel.textContent = state.electionLabels[idx]?.label || 'Timeline non disponibile';
}

function setupControls() {
  if (els.electionSelect) {
    const withData = state.elections.filter(d => { const c = electionCoverageFor(state, d.election_key); return c.summary || c.results; });
    const withoutData = state.elections.filter(d => { const c = electionCoverageFor(state, d.election_key); return !(c.summary || c.results); });
    const renderOption = d => {
      const c = electionCoverageFor(state, d.election_key);
      const suffix = c.results ? ` | ${c.results} righe partiti` : c.summary ? ` | ${c.summary} righe summary` : ' | nessun dato comunale pubblicato';
      return `<option value="${escapeHtml(d.election_key)}">${escapeHtml(d.election_label || d.election_key)}${escapeHtml(suffix)}</option>`;
    };
    els.electionSelect.innerHTML = `${withData.length ? `<optgroup label="Elezioni con copertura">${withData.map(renderOption).join('')}</optgroup>` : ''}${withoutData.length ? `<optgroup label="Anni noti ma non ancora pubblicati a livello comunale">${withoutData.map(renderOption).join('')}</optgroup>` : ''}`;
    els.compareElectionSelect.innerHTML = `<option value="">Nessun confronto</option>` + `${withData.length ? `<optgroup label="Elezioni con copertura">${withData.map(renderOption).join('')}</optgroup>` : ''}${withoutData.length ? `<optgroup label="Anni noti ma non ancora pubblicati a livello comunale">${withoutData.map(renderOption).join('')}</optgroup>` : ''}`;
    state.electionLabels = (withData.length ? withData : state.elections).map(d => ({ value: d.election_key, label: d.election_label || String(d.election_year || d.election_key) }));
    els.electionSelect.value = state.selectedElection || (withData.at(-1)?.election_key || state.elections.at(-1)?.election_key || '');
    els.compareElectionSelect.value = state.compareElection || '';
    updateElectionSlider();
  }
  if (els.areaPresetSelect) els.areaPresetSelect.innerHTML = AREA_PRESETS.map(p => `<option value="${escapeHtml(p.value)}">${escapeHtml(p.label)}</option>`).join('');
  if (els.areaPresetSelect) els.areaPresetSelect.value = state.selectedAreaPreset || 'all';
  if (els.provinceSelect) {
    const provinces = uniqueSorted(state.summary.map(r => r.province).filter(Boolean));
    els.provinceSelect.innerHTML = provinces.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    [...els.provinceSelect.options].forEach(o => { o.selected = state.selectedProvinceSet.has(o.value); });
  }
  if (els.territorialStatusSelect) {
    const statuses = ['all', ...uniqueSorted(state.summary.map(r => r.territorial_status).filter(Boolean))];
    els.territorialStatusSelect.innerHTML = statuses.map(v => `<option value="${escapeHtml(v)}">${v === 'all' ? 'Tutti' : escapeHtml(v)}</option>`).join('');
  }
  if (els.completenessSelect) els.completenessSelect.value = state.selectedCompleteness || 'all';
  if (els.territorialStatusSelect) els.territorialStatusSelect.value = state.selectedTerritorialStatus || 'all';
  if (els.metricSelect) {
    els.metricSelect.value = state.selectedMetric;
    if (!els.metricSelect.value) {
      state.selectedMetric = 'turnout';
      els.metricSelect.value = state.selectedMetric;
    }
  }
  if (state.selectedMetric === 'party_share') state.selectedPartyMode = 'party_std';
  if (els.partyModeSelect) els.partyModeSelect.value = state.selectedPartyMode;
  if (els.territorialModeSelect) {
    const hasHarmonized = state.summary.some(r => String(r.territorial_mode || '') === 'harmonized');
    const harmOpt = [...els.territorialModeSelect.options].find(o => o.value === 'harmonized');
    if (harmOpt) {
      harmOpt.disabled = !hasHarmonized;
      harmOpt.textContent = hasHarmonized ? 'Armonizzato' : 'Armonizzato (non disponibile nel bundle)';
    }
    if (!hasHarmonized && state.territorialMode === 'harmonized') state.territorialMode = 'historical';
    els.territorialModeSelect.value = state.territorialMode;
  }
  if (els.geometryReferenceSelect) {
    const years = (state.geometryPack?.availableYears || []).map(String);
    els.geometryReferenceSelect.innerHTML = `<option value="auto">Auto (anno più vicino)</option>` + years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    if (!years.includes(String(state.geometryReferenceYear))) state.geometryReferenceYear = 'auto';
    els.geometryReferenceSelect.value = String(state.geometryReferenceYear || 'auto');
  }
  if (els.sameScaleCheckbox) els.sameScaleCheckbox.checked = !!state.sameScaleAcrossYears;
  if (els.paletteSelect) els.paletteSelect.value = state.selectedPalette;
  if (els.minShareInput) els.minShareInput.value = state.minSharePct ?? 0;
  if (els.tableSortSelect) els.tableSortSelect.value = state.tableSort;
  if (els.showNotesCheckbox) els.showNotesCheckbox.checked = !!state.showNotes;
  if (els.trajectoryModeSelect) els.trajectoryModeSelect.value = state.trajectoryMode;
  if (els.swipePosition) els.swipePosition.value = state.swipePosition ?? 50;
  if (els.densitySelect) els.densitySelect.value = state.uiDensity;
  if (els.visionModeSelect) els.visionModeSelect.value = state.visionMode;
  if (els.customIndicatorSelect) {
    const opts = state.customIndicators.length ? uniqueSorted(state.customIndicators.map(d => d.indicator_key || d.key)).map(k => ({ key: k, label: customIndicatorMeta(k).label || k })) : [];
    els.customIndicatorSelect.innerHTML = `<option value="">Nessuno</option>` + opts.map(d => `<option value="${escapeHtml(d.key)}">${escapeHtml(d.label)}</option>`).join('');
    els.customIndicatorSelect.value = state.selectedCustomIndicator || '';
  }
  refreshPartySelector();
  if (els.municipalityList) els.municipalityList.innerHTML = state.municipalities.map(m => `<option value="${escapeHtml(m.label || m.name_current || m.municipality_name)}"></option>`).join('');
}

function readControls({ refreshMap = true } = {}) {
  if (els.electionSelect) state.selectedElection = els.electionSelect.value || state.selectedElection;
  if (els.compareElectionSelect) state.compareElection = els.compareElectionSelect.value || null;
  if (els.metricSelect) state.selectedMetric = els.metricSelect.value || state.selectedMetric;
  if (els.partyModeSelect) state.selectedPartyMode = els.partyModeSelect.value || state.selectedPartyMode;
  if (els.partySelect) state.selectedParty = els.partySelect.value || state.selectedParty;
  if (state.selectedMetric === 'party_share') state.selectedPartyMode = 'party_std';
  if (els.customIndicatorSelect) state.selectedCustomIndicator = els.customIndicatorSelect.value || null;
  if (els.territorialModeSelect) state.territorialMode = els.territorialModeSelect.value || state.territorialMode;
  if (els.geometryReferenceSelect) state.geometryReferenceYear = els.geometryReferenceSelect.value || state.geometryReferenceYear;
  if (els.provinceSelect) state.selectedProvinceSet = new Set([...els.provinceSelect.selectedOptions].map(o => o.value));
  if (els.areaPresetSelect) state.selectedAreaPreset = els.areaPresetSelect.value || 'all';
  if (els.completenessSelect) state.selectedCompleteness = els.completenessSelect.value || 'all';
  if (els.territorialStatusSelect) state.selectedTerritorialStatus = els.territorialStatusSelect.value || 'all';
  if (els.sameScaleCheckbox) state.sameScaleAcrossYears = !!els.sameScaleCheckbox.checked;
  if (els.paletteSelect) state.selectedPalette = els.paletteSelect.value || 'auto';
  if (els.minShareInput) state.minSharePct = safeNumber(els.minShareInput.value) || 0;
  if (els.tableSortSelect) state.tableSort = els.tableSortSelect.value || state.tableSort;
  if (els.showNotesCheckbox) state.showNotes = !!els.showNotesCheckbox.checked;
  if (els.trajectoryModeSelect) state.trajectoryMode = els.trajectoryModeSelect.value || state.trajectoryMode;
  if (els.swipePosition) state.swipePosition = safeNumber(els.swipePosition.value) ?? state.swipePosition;
  if (els.densitySelect) state.uiDensity = els.densitySelect.value || state.uiDensity;
  if (els.visionModeSelect) state.visionMode = els.visionModeSelect.value || state.visionMode;
  updateBodyAppearance();
  if (refreshMap) {
    syncActiveGeometry(state, registerIssue).then(() => {
      requestRender();
      ensureVisibleMapReady({ silent: true });
      ensureVisibleSummary({ silent: true });
      if (shouldHydratePartyResultsNow()) ensureVisibleResults({ silent: false });
      scheduleLikelyDatasetPrefetch();
    }).catch(err => registerIssue('geometry-sync', err));
  }
  syncURLState();
}

function renderAudiencePanel() {
  if (!els.audienceModeButtons || !els.audienceModeSummary) return;
  els.audienceModeButtons.innerHTML = Object.entries(AUDIENCE_MODES).map(([key, meta]) => `
    <button type="button" class="audience-btn${state.audienceMode === key ? ' is-active' : ''}" data-audience-mode="${escapeHtml(key)}">${escapeHtml(meta.label)}</button>`).join('');
  els.audienceModeSummary.textContent = audienceMeta().description;
  [...els.audienceModeButtons.querySelectorAll('[data-audience-mode]')].forEach(btn => btn.addEventListener('click', () => setAudienceMode(btn.dataset.audienceMode)));
}

function renderReadingGuide() {
  if (!els.readingGuide || !els.audienceChecklist || !els.glossaryPanel) return;
  const mode = audienceMeta();
  const compareMessage = metricNeedsCompare() && !state.compareElection
    ? 'La metrica attiva richiede un anno di confronto: senza confronto la lettura resta incompleta.'
    : 'La metrica attiva è leggibile con i filtri correnti.';
  const cards = [
    { title: 'Cosa mostra la vista', text: metricReadableExplanation() },
    { title: 'Contesto del bundle', text: currentCoverageNote() },
    { title: 'Prima di concludere', text: `${compareMessage} Modalità territoriale: ${state.territorialMode}. Base geometrica: ${state.geometryReferenceYear || 'auto'}.` }
  ];
  if (state.audienceMode === 'research') cards.push({ title: 'Lettura research-safe', text: 'Usa coverage matrix, audit, codebook e lineage prima di trattare la vista come base comparativa.' });
  if (state.audienceMode === 'press') cards.push({ title: 'Lettura newsroom-safe', text: 'Trasforma la mappa in una storia solo dopo aver verificato copertura, confronto e no-data.' });
  if (state.audienceMode === 'admin') cards.push({ title: 'Lettura amministrativa', text: 'Guarda insieme affluenza, scarti territoriali, similari e traiettoria del comune prima di fare benchmark.' });
  els.readingGuide.innerHTML = cards.map(card => `
    <article class="reading-card">
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.text)}</p>
    </article>`).join('');
  els.audienceChecklist.innerHTML = (mode.checklist || []).map(item => `<div class="checklist-item">${escapeHtml(item)}</div>`).join('');
  els.glossaryPanel.innerHTML = GLOSSARY_ENTRIES.map(item => `
    <article class="glossary-card">
      <strong>${escapeHtml(item.term)}</strong>
      <p>${escapeHtml(item.text)}</p>
    </article>`).join('');
}

function renderBriefingPanel() {
  if (!els.briefingHeadline || !els.briefingStandfirst || !els.briefingCanSay || !els.briefingCaution || !els.briefingCannotSay || !els.briefingMethodNote) return;
  const briefing = buildViewBriefing();
  const listHtml = (items, tone) => items.map(item => `<div class="briefing-item ${tone}">${escapeHtml(item)}</div>`).join('');
  if (els.briefingBadge) els.briefingBadge.textContent = briefing.badge;
  els.briefingHeadline.textContent = briefing.headline;
  els.briefingStandfirst.textContent = briefing.standfirst;
  els.briefingCanSay.innerHTML = listHtml(briefing.canSay, 'can');
  els.briefingCaution.innerHTML = listHtml(briefing.caution, 'caution');
  els.briefingCannotSay.innerHTML = listHtml(briefing.cannotSay, 'cannot');
  els.briefingMethodNote.textContent = briefing.methodNote;
  if (els.copyBriefBtn) {
    els.copyBriefBtn.onclick = () => copyTextToClipboard([
      briefing.headline,
      briefing.standfirst,
      '',
      'Cosa puoi dire:',
      ...briefing.canSay.map(item => `- ${item}`),
      '',
      'Cose da dire con cautela:',
      ...briefing.caution.map(item => `- ${item}`),
      '',
      'Cosa questa vista non prova:',
      ...briefing.cannotSay.map(item => `- ${item}`)
    ].join('\n'), 'Sintesi della vista copiata.');
  }
  if (els.copyMethodNoteBtn) {
    els.copyMethodNoteBtn.onclick = () => copyTextToClipboard(briefing.methodNote, 'Nota metodologica copiata.');
  }
}


function currentBundleVersion() {
  return state.manifest?.project?.version || 'n/d';
}

function electionsWithUsefulCoverage() {
  return state.elections.filter(d => {
    const coverage = electionCoverageFor(state, d.election_key) || {};
    return coverage.summary || coverage.results;
  }).sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
}

function ensureCompareElectionCandidate() {
  const ordered = electionsWithUsefulCoverage();
  if (!ordered.length) return null;
  if (state.compareElection && state.compareElection !== state.selectedElection) return state.compareElection;
  const idx = ordered.findIndex(d => d.election_key === state.selectedElection);
  if (idx > 0) return ordered[idx - 1].election_key;
  if (idx >= 0 && ordered[idx + 1]) return ordered[idx + 1].election_key;
  return ordered[0]?.election_key || null;
}

function ensureActiveSelectionForQuestions() {
  if (state.selectedMetric === 'custom_indicator' && state.customIndicators.length) {
    state.selectedCustomIndicator = state.selectedCustomIndicator || (state.customIndicators[0]?.indicator_key || state.customIndicators[0]?.key) || null;
    return;
  }
  if (state.selectedParty) return;
  const options = state.indices?.partyOptionsByMode?.[state.selectedPartyMode] || [];
  state.selectedParty = options[0] || state.selectedParty || FALLBACK_PARTY_OPTIONS[0] || null;
}

function guidedQuestionsForAudience() {
  const audience = state.audienceMode || 'public';
  const cards = GUIDED_QUESTION_BANK.filter(item => (item.audiences || []).includes(audience));
  return state.uiLevel === 'basic' ? cards.slice(0, 4) : cards;
}

function applyGuidedQuestion(questionId) {
  const question = GUIDED_QUESTION_BANK.find(item => item.id === questionId);
  if (!question) return;
  const settings = question.settings || {};
  if (settings.analysisMode && ANALYSIS_MODES[settings.analysisMode]) {
    state.analysisMode = settings.analysisMode;
    ANALYSIS_MODES[settings.analysisMode].apply();
  }
  if (settings.metric) state.selectedMetric = settings.metric;
  if (settings.palette) state.selectedPalette = settings.palette;
  if (settings.partyMode) state.selectedPartyMode = settings.partyMode;
  if (Object.prototype.hasOwnProperty.call(settings, 'showNotes')) state.showNotes = !!settings.showNotes;
  if (settings.ensureCompareElection && !state.compareElection) {
    const compareKey = ensureCompareElectionCandidate();
    if (compareKey && compareKey !== state.selectedElection) state.compareElection = compareKey;
  }
  if (settings.ensurePartySelection) ensureActiveSelectionForQuestions();
  if (settings.metric === 'custom_indicator' && state.customIndicators.length) ensureActiveSelectionForQuestions();
  setupControls();
  readControls();
  requestRender();
  showToast(`Percorso guidato attivato: ${question.label}.`, 'success', 2000);
  if (question.jumpTarget) {
    const target = q(question.jumpTarget);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}



function siteLayers() {
  return Array.isArray(state.siteGuides?.layers) && state.siteGuides.layers.length ? state.siteGuides.layers : DEFAULT_SITE_LAYERS;
}

function methodExplainers() {
  return Array.isArray(state.siteGuides?.explainers) && state.siteGuides.explainers.length ? state.siteGuides.explainers : DEFAULT_METHOD_EXPLAINERS;
}

function faqItems() {
  return Array.isArray(state.siteGuides?.faq) && state.siteGuides.faq.length ? state.siteGuides.faq : DEFAULT_FAQ_ITEMS;
}

function siteManifesto() {
  return state.siteGuides?.manifesto || DEFAULT_SITE_MANIFESTO;
}

function signaturePillars() {
  return Array.isArray(state.siteGuides?.pillars) && state.siteGuides.pillars.length ? state.siteGuides.pillars : DEFAULT_SIGNATURE_PILLARS;
}

function applySiteLayer(layerKey) {
  const layer = siteLayers().find(item => item.key === layerKey);
  if (!layer) return;
  if (layer.audience && AUDIENCE_MODES[layer.audience]) state.audienceMode = layer.audience;
  if (layer.analysisMode && ANALYSIS_MODES[layer.analysisMode]) {
    state.analysisMode = layer.analysisMode;
    ANALYSIS_MODES[layer.analysisMode].apply();
  }
  if (layer.uiLevel) setUILevel(layer.uiLevel);
  else requestRender();
  showToast(`Layer attivato: ${layer.title}.`, 'success', 1800);
  if (layer.jumpTarget) {
    const target = q(layer.jumpTarget);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }
}

function renderSiteLayersPanel() {
  if (!els.siteLayersGrid || !els.siteLayersSummary) return;
  const currentAudience = audienceMeta();
  els.siteLayersSummary.textContent = `Stessa base, tre porte di ingresso: puoi partire da una lettura ${currentAudience.label.toLowerCase()} e poi scendere nel layer più analitico senza cambiare motore.`;
  els.siteLayersGrid.innerHTML = siteLayers().map(layer => `
    <article class="site-layer-card ${escapeHtml(layer.key || '')}">
      <div class="site-layer-eyebrow">${escapeHtml(layer.eyebrow || '')}</div>
      <h3>${escapeHtml(layer.title || '')}</h3>
      <p>${escapeHtml(layer.description || '')}</p>
      <div class="site-layer-meta">
        <span class="pill muted">${escapeHtml((AUDIENCE_MODES[layer.audience] || {}).label || layer.audience || 'n/d')}</span>
        <span class="pill muted">${escapeHtml((ANALYSIS_MODES[layer.analysisMode] || {}).label || layer.analysisMode || 'n/d')}</span>
      </div>
      <div class="pathway-actions">
        <button type="button" class="hero-primary-btn site-layer-btn" data-site-layer="${escapeHtml(layer.key || '')}">${escapeHtml(layer.cta || 'Apri')}</button>
        <button type="button" class="ghost-btn small-btn" data-jump-target="${escapeHtml(layer.jumpTarget || 'map-wrapper')}">Vai alla sezione</button>
      </div>
    </article>`).join('');
  [...els.siteLayersGrid.querySelectorAll('[data-site-layer]')].forEach(btn => btn.addEventListener('click', () => applySiteLayer(btn.dataset.siteLayer)));
}

function renderMethodExplainersPanel() {
  if (!els.methodExplainersGrid || !els.methodExplainersSummary) return;
  const geometryText = state.geometryReferenceYear || 'auto';
  els.methodExplainersSummary.textContent = `Metodo rapido: vista corrente su ${electionLabelByKey(state.selectedElection)}, modalità ${state.territorialMode}, base geometrica ${geometryText}, metrica ${metricLabel().toLowerCase()}.`;
  const dynamicTail = {
    scope: `Nella vista attuale hai ${fmtInt(filteredRowsWithMetric(state).length)} comuni filtrati con metrica leggibile.` ,
    nodata: `Nella release corrente la readiness tecnica e ${fmtInt(state.qualityReport?.derived_validations?.technical_readiness_score ?? state.qualityReport?.derived_validations?.readiness_score ?? 0)} e la copertura sostanziale e ${fmtInt(state.qualityReport?.derived_validations?.substantive_coverage_score ?? 0)}.`,
    boundary: `La base geometrica disponibile copre ${(state.geometryPack?.availableYears || []).join(', ') || 'n/d'}.`,
    evidence: `${buildEvidenceLadder().badge}: ${buildEvidenceLadder().title}`
  };
  els.methodExplainersGrid.innerHTML = methodExplainers().map(item => `
    <article class="method-explainer-card ${escapeHtml(item.accent || '')}">
      <div class="mini-section-title">${escapeHtml(item.title || '')}</div>
      <p>${escapeHtml(item.body || '')}</p>
      <div class="helper-text">${escapeHtml(dynamicTail[item.accent] || '')}</div>
    </article>`).join('');
}

function renderFaqPanel() {
  if (!els.faqAccordion || !els.faqSummary) return;
  els.faqSummary.textContent = 'Domande semplici ma importanti: servono a rendere la parte divulgativa più onesta, non più superficiale.';
  els.faqAccordion.innerHTML = faqItems().map((item, idx) => `
    <details class="faq-item" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span>${escapeHtml(item.question || '')}</span>
        <span class="pill muted">${escapeHtml(item.tag || 'FAQ')}</span>
      </summary>
      <div class="faq-answer">${escapeHtml(item.answer || '')}</div>
    </details>`).join('');
}

function applyResearchRecipe(recipeKey) {
  const recipe = (state.researchRecipes || []).find(item => item.recipe_key === recipeKey);
  if (!recipe) return;
  const settings = recipe.settings || {};
  if (settings.analysisMode && ANALYSIS_MODES[settings.analysisMode]) {
    state.analysisMode = settings.analysisMode;
    ANALYSIS_MODES[settings.analysisMode].apply();
  }
  if (settings.metric) state.selectedMetric = settings.metric;
  if (settings.palette) state.selectedPalette = settings.palette;
  if (settings.partyMode) state.selectedPartyMode = settings.partyMode;
  if (Object.prototype.hasOwnProperty.call(settings, 'showNotes')) state.showNotes = !!settings.showNotes;
  if (settings.ensureCompareElection && !state.compareElection) {
    const compareKey = ensureCompareElectionCandidate();
    if (compareKey && compareKey !== state.selectedElection) state.compareElection = compareKey;
  }
  if (settings.ensurePartySelection) ensureActiveSelectionForQuestions();
  setupControls();
  readControls();
  requestRender();
  showToast(`Recipe attivata: ${recipe.title}.`, 'success', 2000);
  if (recipe.jump_target) {
    const target = q(recipe.jump_target);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}

function renderHeroPanel() {
  if (!els.heroTitle || !els.heroStandfirst || !els.heroBadges) return;
  const trust = assessViewTrust();
  const technical = state.qualityReport?.derived_validations?.technical_readiness_score ?? state.qualityReport?.derived_validations?.readiness_score ?? null;
  const substantive = state.qualityReport?.derived_validations?.substantive_coverage_score ?? null;
  const products = state.dataProducts?.products || [];
  const integrity = releaseIntegrityStatus();
  const electionLabel = electionLabelByKey(state.selectedElection);
  const audience = audienceMeta();
  const recipeCount = researchRecipesForAudience().length;
  const compareText = state.compareElection && state.compareElection !== state.selectedElection ? ` con confronto ${electionLabelByKey(state.compareElection)}` : '';
  els.heroTitle.textContent = `${electionLabel}${compareText} · base ${state.territorialMode === 'harmonized' ? 'armonizzata' : 'storica'} · ${metricLabel()}`;
  els.heroStandfirst.textContent = `${viewStandfirst(filteredRowsWithMetric(state), trust)} Questa home prova a far convivere esplorazione pubblica, audit, release discipline e accesso programmatico.`;
  els.heroBadges.innerHTML = [
    `Pubblico: ${audience.label}`,
    `Affidabilità vista: ${trust.label}`,
    `Integrità release: ${integrity.label}`,
    `Recipe disponibili: ${fmtInt(recipeCount)}`
  ].map(item => `<span class="pill">${escapeHtml(item)}</span>`).join('');
  if (els.heroReleaseVersion) els.heroReleaseVersion.textContent = `v${escapeHtml(currentReleaseVersion())}`;
  if (els.heroReleaseMeta) els.heroReleaseMeta.textContent = `${escapeHtml(currentReleaseDate())} · ${escapeHtml(state.dataSourceLabel || 'bundle')}`;
  if (els.heroTechnicalReadiness) els.heroTechnicalReadiness.textContent = technical == null ? '—' : fmtInt(technical);
  if (els.heroSubstantiveReadiness) els.heroSubstantiveReadiness.textContent = substantive == null ? '—' : fmtInt(substantive);
  if (els.heroProductsCount) els.heroProductsCount.textContent = fmtInt(products.length);
  if (els.heroProductsMeta) els.heroProductsMeta.textContent = `${fmtInt((state.geometryPack?.availableYears || []).length)} basi geometriche · ${fmtInt(Object.keys(state.manifest?.files || {}).length)} file dichiarati`;
}


function renderSignaturePanel() {
  if (!els.signatureTitle || !els.signatureStandfirst || !els.signatureStatement || !els.signatureProofGrid || !els.signatureMarquee) return;
  const manifesto = siteManifesto();
  const trust = assessViewTrust();
  const integrity = releaseIntegrityStatus();
  const technical = state.qualityReport?.derived_validations?.technical_readiness_score ?? state.qualityReport?.derived_validations?.readiness_score ?? 0;
  const substantive = state.qualityReport?.derived_validations?.substantive_coverage_score ?? 0;
  const geometryYears = state.geometryPack?.availableYears || [];
  const products = state.dataProducts?.products || [];
  const layerCount = siteLayers().length;
  const audience = audienceMeta();
  els.signatureTitle.textContent = manifesto.title || 'Una base che prova a reggere sia come sito sia come infrastruttura.';
  els.signatureStandfirst.textContent = `${manifesto.standfirst || ''} Adesso stai guardando ${electionLabelByKey(state.selectedElection)}, metrica ${metricLabel().toLowerCase()}, profilo ${audience.label.toLowerCase()}.`;
  els.signatureStatement.innerHTML = `
    <div class="signature-statement-quote">${escapeHtml(manifesto.statement || '')}</div>
    <div class="signature-statement-meta">
      <span class="pill">Vista attiva: ${escapeHtml(trust.label)}</span>
      <span class="pill muted">Release ${escapeHtml(currentReleaseVersion())}</span>
      <span class="pill muted">${fmtInt(layerCount)} layer di ingresso</span>
    </div>`;
  const dynamicDetails = {
    same_engine: `Tre ingressi dichiarati, audience attiva ${audience.label.toLowerCase()} e ${fmtInt(researchRecipesForAudience().length)} recipe utilizzabili senza cambiare bundle.`,
    declared_limits: `Copertura sostanziale ${fmtInt(substantive)} e no-data reso esplicito: il sito non finge pienezza dove la release non la offre.`,
    release_backed: `Release ${escapeHtml(currentReleaseVersion())}, ${fmtInt(products.length)} prodotti dati dichiarati e integrità ${escapeHtml(integrity.label.toLowerCase())}.`,
    boundary_aware: `${fmtInt(geometryYears.length)} basi geometriche disponibili (${escapeHtml(geometryYears.join(', ') || 'n/d')}) e lettura ${state.territorialMode === 'harmonized' ? 'armonizzata' : 'storica'} dichiarata.`
  };
  els.signatureProofGrid.innerHTML = signaturePillars().map(item => `
    <article class="signature-proof-card ${escapeHtml(item.key || '')}">
      <div class="signature-proof-eyebrow">${escapeHtml(item.eyebrow || '')}</div>
      <h3>${escapeHtml(item.title || '')}</h3>
      <p>${escapeHtml(item.body || '')}</p>
      <div class="signature-proof-detail">${escapeHtml(dynamicDetails[item.key] || `Readiness tecnica ${fmtInt(technical)} · copertura ${fmtInt(substantive)}.`)}</div>
    </article>`).join('');
  const marqueeItems = [
    'Atlante elettorale boundary-aware',
    'Release citabile e verificabile',
    'No-data distinto da valore basso',
    'Stesso motore per pubblico e ricerca',
    `Readiness tecnica ${fmtInt(technical)}`,
    `Copertura sostanziale ${fmtInt(substantive)}`
  ];
  els.signatureMarquee.innerHTML = marqueeItems.map(item => `<span class="signature-tag">${escapeHtml(item)}</span>`).join('');
}

function renderPathwayPanel() {
  if (!els.pathwayGrid) return;
  const cards = [
    { title: 'Esplora il territorio', desc: 'Mappa, affluenza, overview e scheda comune con guardrail già attivi.', target: 'map-wrapper', kicker: 'Public-facing' },
    { title: 'Confronta due elezioni', desc: 'Apri lo strato boundary-aware con compare map, swipe e differenze.', target: 'compare-map-summary', kicker: 'Comparative' },
    { title: 'Audit e metodologia', desc: 'Coverage, evidence ladder, codebook, usage notes e data products.', target: 'usage-notes-panel', kicker: 'Method-first' },
    { title: 'Usa il bundle da codice', desc: 'Loader ufficiale, release identity, citation e snippet pronti.', target: 'release-studio-panel', kicker: 'Programmatic' }
  ];
  const recipes = researchRecipesForAudience();
  els.pathwayGrid.innerHTML = cards.concat(recipes.map(recipe => ({ title: recipe.title, desc: recipe.goal, target: recipe.jump_target || 'release-studio-panel', kicker: 'Recipe', recipeKey: recipe.recipe_key }))).slice(0, 8).map(card => `
    <article class="pathway-card">
      <div class="pathway-kicker">${escapeHtml(card.kicker || '')}</div>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.desc || '')}</p>
      <div class="pathway-actions">
        ${card.recipeKey ? `<button type="button" class="ghost-btn small-btn" data-recipe-key="${escapeHtml(card.recipeKey)}">Attiva</button>` : ''}
        <button type="button" class="ghost-btn small-btn" data-jump-target="${escapeHtml(card.target)}">Apri sezione</button>
      </div>
    </article>`).join('');
  [...els.pathwayGrid.querySelectorAll('[data-recipe-key]')].forEach(btn => btn.addEventListener('click', () => applyResearchRecipe(btn.dataset.recipeKey)));
}

function renderReleaseStudioPanel() {
  if (!els.releaseIdentityPanel || !els.provenancePanel || !els.clientSnippetPanel || !els.citationPanel) return;
  const release = state.releaseManifest || {};
  const integrity = releaseIntegrityStatus();
  const fileEntries = release.file_entries || {};
  const contracts = state.datasetContracts?.contracts || [];
  const provenanceEntries = state.provenance?.entries || [];
  const latestRecipe = researchRecipesForAudience()[0];
  if (els.releaseIntegrityPill) {
    els.releaseIntegrityPill.textContent = integrity.label;
    els.releaseIntegrityPill.className = `pill ${integrity.tone === 'ok' ? '' : 'muted'}`;
  }
  els.releaseIdentityPanel.innerHTML = `
    <div class="release-meta-row"><span>Versione</span><strong>${escapeHtml(currentReleaseVersion())}</strong></div>
    <div class="release-meta-row"><span>Data release</span><strong>${escapeHtml(currentReleaseDate())}</strong></div>
    <div class="release-meta-row"><span>File dichiarati</span><strong>${fmtInt(Object.keys(fileEntries).length)}</strong></div>
    <div class="release-meta-row"><span>Prodotti dati</span><strong>${fmtInt((state.dataProducts?.products || []).length)}</strong></div>
    <div class="release-note">${escapeHtml((state.releaseManifest?.project?.notes || state.manifest?.project?.notes || []).slice(0,2).join(' · '))}</div>`;
  els.provenancePanel.innerHTML = `
    <div class="release-meta-row"><span>Entries provenance</span><strong>${fmtInt(provenanceEntries.length)}</strong></div>
    <div class="release-meta-row"><span>Contracts</span><strong>${fmtInt(contracts.length)}</strong></div>
    <div class="release-note">${escapeHtml((provenanceEntries[0]?.method || provenanceEntries[0]?.note || 'Provenance disponibile nel bundle.'))}</div>
    <div class="release-list">${contracts.slice(0,4).map(contract => `<div class="release-list-item">${escapeHtml(contract.dataset_key || contract.dataset || 'dataset')} · ${escapeHtml((contract.required_columns || []).slice(0,3).join(', '))}</div>`).join('') || '<div class="empty-state">Nessun contract caricato.</div>'}</div>`;
  els.clientSnippetPanel.innerHTML = `
    <div class="snippet-card compact-snippet"><strong>Python</strong><pre>${escapeHtml(buildProgrammaticSnippet('python'))}</pre></div>
    <div class="snippet-card compact-snippet"><strong>R</strong><pre>${escapeHtml(buildProgrammaticSnippet('r'))}</pre></div>`;
  els.citationPanel.innerHTML = `
    <div class="release-note">${escapeHtml(buildProjectCitation())}</div>
    <div class="release-meta-row"><span>CITATION.cff</span><strong>${(state.manifest?.files || {}).citation || 'root/CITATION.cff'}</strong></div>
    <div class="release-meta-row"><span>Recipe in evidenza</span><strong>${escapeHtml(latestRecipe?.title || 'n/d')}</strong></div>
    <div class="release-list">${researchRecipesForAudience().slice(0,4).map(recipe => `<div class="release-list-item"><strong>${escapeHtml(recipe.title)}</strong><span>${escapeHtml(recipe.goal)}</span></div>`).join('')}</div>`;
}

function renderQuestionWorkbench() {
  if (!els.guidedQuestionGrid || !els.guidedQuestionSummary) return;
  const audience = audienceMeta();
  const cards = guidedQuestionsForAudience();
  const note = state.uiLevel === 'basic'
    ? 'Modalità base: mostro solo le domande più solide e immediate per il pubblico attivo.'
    : 'Modalità esperta: includo anche percorsi più analitici e diagnostici.';
  els.guidedQuestionSummary.textContent = `${audience.label}: ${audience.description} ${note}`;
  if (!cards.length) {
    els.guidedQuestionGrid.innerHTML = '<div class="empty-state">Nessuna domanda guidata disponibile per il profilo attivo.</div>';
    return;
  }
  els.guidedQuestionGrid.innerHTML = cards.map(card => `
    <article class="question-card">
      <div class="question-card-top">
        <span class="pill muted">${escapeHtml(audience.label)}</span>
        <strong>${escapeHtml(card.label)}</strong>
      </div>
      <p>${escapeHtml(card.desc)}</p>
      <div class="helper-text">${escapeHtml(card.kicker || '')}</div>
      <button type="button" class="ghost-btn small-btn" data-guided-question="${escapeHtml(card.id)}">Apri percorso</button>
    </article>`).join('');
  [...els.guidedQuestionGrid.querySelectorAll('[data-guided-question]')].forEach(btn => btn.addEventListener('click', () => applyGuidedQuestion(btn.dataset.guidedQuestion)));
}

function buildEvidenceLadder(rows = filteredRowsWithMetric(state)) {
  const trust = assessViewTrust(rows);
  const coverage = electionCoverageFor(state, state.selectedElection) || {};
  const compareCoverage = state.compareElection ? electionCoverageFor(state, state.compareElection) || {} : null;
  const substantive = Number(state.qualityReport?.derived_validations?.substantive_coverage_score ?? 0);
  const rowCount = rows.length;
  const compareReady = !metricNeedsCompare() || (state.compareElection && (compareCoverage?.summary || compareCoverage?.results));
  const partyReady = !metricNeedsPartyResults() || coverage.results;
  const geometryReady = !!state.geometry?.features?.length;
  let level = 'exploratory';
  if (trust.status === 'ok' && rowCount >= 20 && substantive >= 40 && compareReady && partyReady && geometryReady) level = 'strong';
  else if (trust.status !== 'missing' && rowCount >= 5 && compareReady) level = 'cautious';
  const levelMeta = {
    strong: {
      badge: 'Base abbastanza solida',
      title: 'Questa vista regge bene briefing, note e confronti circoscritti.',
      body: 'Hai una combinazione abbastanza sana di coverage, geometrie e metrica attiva. Restano comunque da verificare anno, perimetro e comparabilità prima di generalizzare.',
      className: 'strong'
    },
    cautious: {
      badge: 'Usabile con cautela',
      title: 'La vista è utile, ma va protetta con caveat e controlli espliciti.',
      body: 'Puoi usarla per orientarti o per briefing ragionati, però non è il caso di trasformarla in una tesi forte senza coverage, audit e note territoriali.',
      className: 'cautious'
    },
    exploratory: {
      badge: 'Esplorativa',
      title: 'Questa vista serve soprattutto per esplorare, non per chiudere il discorso.',
      body: 'Il filtro o il bundle corrente sono ancora troppo sottili per farne una base forte. Meglio usarla per trovare piste, poi validarle in coverage, audit e dati scaricabili.',
      className: 'exploratory'
    }
  }[level];
  const checks = [
    `${rowCount} comuni filtrati con metrica leggibile nella vista corrente.`,
    `${coverage.summary ? 'Summary presente' : 'Summary non presente'}${coverage.results ? ' · risultati di partito presenti' : metricNeedsPartyResults() ? ' · risultati di partito non pieni per questa lettura' : ''}.`,
    `${geometryReady ? 'Geometrie attive disponibili' : 'Geometrie assenti o non caricate'}${state.geometryReferenceYear ? ` · base ${state.geometryReferenceYear}` : ''}.`,
    `Affidabilità vista: ${trust.label}.`,
    currentCoverageNote()
  ];
  if (metricNeedsCompare()) checks.push(compareReady ? `Confronto attivo con ${electionLabelByKey(state.compareElection)}.` : 'La metrica richiede un confronto più solido di quello attuale.');
  const nextChecks = [
    "Apri coverage matrix e verifica se l'anno scelto è davvero popolato.",
    'Guarda audit e comparability notes prima di scrivere una conclusione forte.',
    metricNeedsPartyResults() ? 'Controlla se la lettura dipende da risultati di partito incompleti.' : 'Controlla comunque no-data e perimetro territoriale.',
    state.selectedMunicipalityId ? 'Apri la scheda comune e verifica se la traiettoria locale conferma la mappa.' : 'Seleziona almeno un comune per verificare se il pattern regge anche nel dettaglio.'
  ].filter(Boolean);
  return { level, ...levelMeta, checks: [...new Set(checks)], nextChecks: [...new Set(nextChecks)] };
}

function currentViewCitation(evidence = buildEvidenceLadder()) {
  const bundleVersion = currentBundleVersion();
  const election = electionLabelByKey(state.selectedElection);
  const compare = state.compareElection ? `; confronto ${electionLabelByKey(state.compareElection)}` : '';
  const selection = state.selectedMetric === 'custom_indicator'
    ? (customIndicatorMeta(state.selectedCustomIndicator).label || state.selectedCustomIndicator || metricLabel())
    : (state.selectedParty || metricLabel());
  const generated = new Date().toISOString().slice(0, 10);
  return `Italia Camera Explorer, vista "${metricLabel()}" (${selection}) su ${election}${compare}; modalità territoriale ${state.territorialMode}; base geometrica ${state.geometryReferenceYear || 'auto'}; bundle ${bundleVersion}; livello di evidenza ${evidence.badge}; consultato il ${generated}.`;
}

function currentReproducibilityLine() {
  const files = state.manifest?.files || {};
  return `Riproducibilità minima: manifest=${files ? 'presente' : 'assente'} · summary=${files.municipalitySummary || 'n/d'} · results=${files.municipalityResultsLong || 'n/d'} · geometryPack=${files.geometryPack || files.geometry || 'n/d'} · audience=${state.audienceMode} · analysisMode=${state.analysisMode}.`;
}

function renderEvidencePanel() {
  if (!els.evidenceBadge || !els.evidenceHeadline || !els.evidenceBody || !els.evidenceChecks || !els.evidenceNextChecks || !els.viewCitationNote || !els.copyViewCitationBtn || !els.copyReproBtn) return;
  const evidence = buildEvidenceLadder();
  els.evidenceBadge.textContent = evidence.badge;
  els.evidenceBadge.className = `pill evidence-pill ${evidence.className}`;
  els.evidenceHeadline.textContent = evidence.title;
  els.evidenceBody.textContent = evidence.body;
  els.evidenceChecks.innerHTML = evidence.checks.map(item => `<div class="evidence-item">${escapeHtml(item)}</div>`).join('');
  els.evidenceNextChecks.innerHTML = evidence.nextChecks.map(item => `<div class="evidence-item next">${escapeHtml(item)}</div>`).join('');
  const citation = currentViewCitation(evidence);
  els.viewCitationNote.textContent = citation;
  els.copyViewCitationBtn.onclick = () => copyTextToClipboard(citation, 'Citazione della vista copiata.');
  els.copyReproBtn.onclick = () => copyTextToClipboard(currentReproducibilityLine(), 'Riga di riproducibilità copiata.');
}

function renderStatusPanel() {
  if (!els.datasetStatus || !els.dataCounts) return;
  const derived = state.qualityReport?.derived_validations || {};
  const geometryYears = state.geometryPack?.availableYears?.join(', ') || 'nessuna';
  const technical = derived.technical_readiness_score ?? derived.readiness_score ?? 'n/d';
  const substantive = derived.substantive_coverage_score ?? 'n/d';
  const uniqueSummaryMunicipalities = new Set(state.summary.map(r => r.municipality_id)).size;
  const electionsWithData = state.elections.filter(d => { const c = electionCoverageFor(state, d.election_key); return c.summary || c.results; }).length;
  const sourceText = escapeHtml(state.dataSourceLabel || 'Bundle incorporato');
  const declaredResultRows = Math.max(state.resultsLongDeclaredRows || 0, state.resultsLong.length || 0);
  const gapSummary = currentArchiveGapSummary();
  const archiveGapText = gapSummary.with_any_flags
    ? `Archivio canonico: ${fmtInt(gapSummary.bundle_empty_archive_nonempty || 0)} elezioni oggi vuote nel bundle e ${fmtInt(gapSummary.bundle_severely_partial_vs_archive || gapSummary.bundle_below_archive_positive_tables || 0)} ancora molto sotto la copertura gia prodotta.`
    : 'Nessun gap archivio-vs-bundle dichiarato nel bundle corrente.';
  els.datasetStatus.innerHTML = `
    <div class="status-banner ${state.geometry?.features?.length ? 'ok' : 'warn'}">
      <strong>${state.geometry?.features?.length ? 'Geometrie ISTAT caricate' : 'Modalità data-first'}</strong>
      <div class="helper-text" style="margin-top:4px">Sorgente attiva: <strong>${sourceText}</strong>.</div>
    <div class="helper-text" style="margin-top:4px">Confini comunali Italia disponibili per: ${geometryYears}. Modalità attiva: ${escapeHtml(state.territorialMode)} · base geometrica: <strong>${escapeHtml(String(state.geometryReferenceYear || 'auto'))}</strong>.</div>
      <div class="helper-text" style="margin-top:4px">Readiness tecnica: ${fmtInt(technical)} · copertura sostanziale: ${fmtInt(substantive)}.</div>
      <div class="helper-text" style="margin-top:4px">${escapeHtml(mapReadyHydrationSummary())}</div>
      <div class="helper-text" style="margin-top:4px">${escapeHtml(summaryHydrationSummary())}</div>
      <div class="helper-text" style="margin-top:4px">${escapeHtml(resultsHydrationSummary())}</div>
      <div class="helper-text" style="margin-top:4px">${escapeHtml(archiveGapText)}</div>
    </div>`;
  els.dataCounts.innerHTML = `
    <div class="count-grid">
      <div class="count-card"><span class="eyebrow">Elezioni note</span><strong>${fmtInt(state.elections.length)}</strong></div>
      <div class="count-card"><span class="eyebrow">Elezioni con dati</span><strong>${fmtInt(electionsWithData)}</strong></div>
      <div class="count-card"><span class="eyebrow">Comuni unici in summary</span><strong>${fmtInt(uniqueSummaryMunicipalities)}</strong></div>
      <div class="count-card"><span class="eyebrow">Righe risultati</span><strong>${fmtInt(state.resultsLong.length)} / ${fmtInt(declaredResultRows)}</strong></div>
      <div class="count-card"><span class="eyebrow">Gap vs archivio</span><strong>${fmtInt(gapSummary.with_any_flags || 0)}</strong></div>
    </div>`;
  if (els.dataSourceBadge) els.dataSourceBadge.textContent = state.dataSource === 'local' ? 'Bundle locale' : 'Bundle incorporato';
  if (els.localBundleSummary) {
    els.localBundleSummary.textContent = state.dataSource === 'local'
      ? `Bundle locale attivo · ${fmtInt(state.elections.length)} elezioni note · ${fmtInt(state.summary.length)} righe summary · ${fmtInt(state.resultsLong.length)} / ${fmtInt(declaredResultRows)} righe partito caricate.`
      : 'Nessun bundle locale caricato.';
  }
}

function datasetFileDescriptors() {
  const files = state.manifest?.files || {};
  return [
    { key: 'elections', label: 'Elections master', rows: state.elections.length, path: files.electionsMaster, note: 'Anagrafica elezioni e stato di parsing.' },
    { key: 'summary', label: 'Municipality summary', rows: state.summary.length, path: files.municipalitySummary, note: 'Affluenza, leader, margini e metadati comunali per elezione.' },
    { key: 'results', label: 'Municipality results long', rows: state.resultsLong.length, path: files.municipalityResultsLong, note: 'Risultati partito/famiglia/blocco in formato lungo.' },
    { key: 'municipalities', label: 'Municipalities master', rows: state.municipalities.length, path: files.municipalitiesMaster, note: 'Master territoriale, codici e metadata geografici.' },
    { key: 'aliases', label: 'Municipality aliases', rows: state.aliases.length, path: files.municipalityAliases, note: 'Alias storici e nomi ricercabili nel finder.' },
    { key: 'parties', label: 'Parties master', rows: state.parties.length, path: files.partiesMaster, note: 'Normalizzazione partiti/famiglie/blocchi.' },
    { key: 'lineage', label: 'Territorial lineage', rows: state.lineage.length, path: files.territorialLineage, note: 'Lineage territoriale e note di armonizzazione.' },
    { key: 'quality', label: 'Data quality report', rows: (state.qualityReport?.datasets || []).length, path: files.dataQualityReport, note: 'Audit di plausibilità, coverage e readiness.' },
    { key: 'archiveGap', label: 'Archive bundle gap report', rows: (state.archiveBundleGapReport || []).length, path: files.archiveBundleGapReport, note: 'Confronto esplicito tra bundle pubblicato e archivio canonico nazionale.' }
  ].filter(d => d.path);
}

function renderDataPackagePanel() {
  if (!els.coverageMatrix || !els.dataCatalog) return;
  const ordered = state.elections.slice().sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  const geometryYears = new Set((state.geometryPack?.availableYears || []).map(Number));
  const rows = ordered.map(e => {
    const coverage = electionCoverageFor(state, e.election_key);
    const hasGeom = geometryYears.size ? [...geometryYears].some(y => y <= Number(e.election_year || 0)) : Boolean(state.geometryFallback?.features?.length);
    return { election: e, coverage, hasGeom, archiveGap: archiveGapRowForElection(e.election_key) };
  });
  const dot = (kind, value) => {
    const cls = value ? (value === 'partial' ? 'partial' : 'ok') : 'none';
    const label = value === 'partial' ? 'parziale' : value ? 'sì' : 'no';
    return `<span class="coverage-dot ${cls}" title="${kind}: ${label}">${kind}</span>`;
  };
  els.coverageMatrix.innerHTML = `
    <table class="coverage-matrix-table">
      <thead><tr><th>Anno</th><th>Summary</th><th>Partiti</th><th>Geometria</th><th>Archivio</th><th>Stato</th></tr></thead>
      <tbody>${rows.map(({ election, coverage, hasGeom, archiveGap }) => {
        const summary = coverage.summary ? 'ok' : null;
        const results = coverage.results ? 'ok' : null;
        const gapStatus = archiveGapStatus(archiveGap);
        const status = coverage.summary && coverage.results ? 'copertura utile' : coverage.summary || coverage.results ? 'parziale' : 'vuoto';
        const archiveScope = archiveGap ? (archiveGap.archive_positive_table_rows || archiveGap.archive_municipality_like_rows || 0) : null;
        return `<tr><td><strong>${escapeHtml(election.election_year || election.election_key)}</strong></td><td>${dot('S', summary)}</td><td>${dot('P', results)}</td><td>${dot('G', hasGeom ? 'ok' : null)}</td><td><span class="coverage-dot ${escapeHtml(gapStatus.tone)}">${escapeHtml(gapStatus.label)}</span>${archiveScope != null ? `<div class="helper-text">Archivio: ${fmtInt(archiveScope)}</div>` : ''}</td><td>${escapeHtml(status)}</td></tr>`;
      }).join('')}</tbody>
    </table>`;
  const sourceLocal = state.dataSource === 'local';
  const geomYears = (state.geometryPack?.availableYears || []).map(String);
  els.dataCatalog.innerHTML = datasetFileDescriptors().map(ds => `
    <article class="data-card">
      <h3>${escapeHtml(ds.label)}</h3>
      <div class="data-meta">
        <div><strong>${fmtInt(ds.rows)}</strong> righe / record logici</div>
        <div>${escapeHtml(ds.note)}</div>
        <div><code>${escapeHtml(ds.path)}</code></div>
      </div>
      <div class="data-actions">
        ${sourceLocal ? `<span class="helper-text">Bundle locale: file già nel browser</span>` : `<button type="button" class="ghost-btn small-btn" data-download-path="${escapeHtml(ds.path)}">Scarica file</button>`}
      </div>
    </article>`).join('');
  [...els.dataCatalog.querySelectorAll('[data-download-path]')].forEach(btn => btn.addEventListener('click', () => {
    const path = btn.dataset.downloadPath;
    const a = document.createElement('a');
    a.href = path;
    a.download = path.split('/').pop();
    a.click();
  }));
}

async function activateLocalBundle(fileList) {
  if (!fileList?.length) return;
  setLoading(true, 'Caricamento bundle locale…');
  try {
    await loadDataFromLocalFiles(state, fileList, { buildIndices: updateIndices, registerIssue });
    invalidateDerivedCaches();
    setupControls();
    renderStatusPanel();
    requestRender();
    showToast('Bundle locale caricato nel browser.');
  } catch (err) {
    registerIssue('local-bundle', err);
    showToast(`Errore bundle locale: ${err.message || err}`);
  } finally {
    setLoading(false);
  }
}

function saveCurrentViewSnapshot(label = null) {
  const view = currentViewState();
  state.savedViews = [{ id: `view_${Date.now()}`, label: label || `Vista ${new Date().toLocaleString('it-IT')}`, view }, ...state.savedViews].slice(0, 15);
  saveLocalState();
}

function checkpointHistory() {
  const snap = JSON.stringify(currentViewState());
  if (state.historySuspend || snap === state.lastHistoryHash) return;
  state.lastHistoryHash = snap;
  state.viewHistory = state.viewHistory.slice(0, state.historyIndex + 1);
  state.viewHistory.push(JSON.parse(snap));
  state.viewHistory = state.viewHistory.slice(-30);
  state.historyIndex = state.viewHistory.length - 1;
}

function applyViewSnapshot(view) {
  if (!view) return;
  state.historySuspend = true;
  Object.assign(state, view);
  state.selectedProvinceSet = new Set(view.selectedProvinces || view.selectedProvinceSet || []);
  setupControls();
  readControls();
  state.historySuspend = false;
}

function undoView() {
  if (state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  applyViewSnapshot(state.viewHistory[state.historyIndex]);
}

function redoView() {
  if (state.historyIndex >= state.viewHistory.length - 1) return;
  state.historyIndex += 1;
  applyViewSnapshot(state.viewHistory[state.historyIndex]);
}

function applyAnalysisMode(mode) {
  if (!ANALYSIS_MODES[mode]) return;
  state.analysisMode = mode;
  ANALYSIS_MODES[mode].apply();
  setupControls();
  readControls();
}

function stopTimelinePlayback() {
  if (state.playbackTimer) {
    clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
  if (els.playTimelineBtn) els.playTimelineBtn.textContent = '▶ Play';
}

function toggleTimelinePlayback() {
  if (state.playbackTimer) { stopTimelinePlayback(); return; }
  if (els.playTimelineBtn) els.playTimelineBtn.textContent = '■ Stop';
  state.playbackTimer = setInterval(() => stepElection(1), 1200);
}

function stepElection(delta) {
  const idx = state.electionLabels.findIndex(d => d.value === state.selectedElection);
  if (idx === -1) return;
  const next = state.electionLabels[(idx + delta + state.electionLabels.length) % state.electionLabels.length];
  state.selectedElection = next.value;
  setupControls();
  readControls({ refreshMap: false });
  refreshPartySelector();
  refreshMapContinuously(els.electionSelect, { message: 'Cambio elezione...' });
}

function swapSelectedElections() {
  const tmp = state.selectedElection;
  state.selectedElection = state.compareElection;
  state.compareElection = tmp;
  setupControls();
  readControls({ refreshMap: false });
  refreshPartySelector();
  refreshMapContinuously(els.swapElectionsBtn, { message: 'Scambio confronto...' });
}

function initCollapsiblePanels() {
  document.querySelectorAll('[data-collapsible]').forEach(panel => {
    const key = panel.dataset.collapsible;
    const btn = panel.querySelector('[data-collapse-toggle]');
    const body = panel.querySelector('[data-collapse-body]');
    if (!btn || !body) return;
    const apply = () => {
      const collapsed = !!state.collapsedPanels[key];
      panel.classList.toggle('collapsed', collapsed);
      panel.classList.toggle('is-collapsed', collapsed);
    };
    apply();
    btn.onclick = () => { state.collapsedPanels[key] = !state.collapsedPanels[key]; apply(); saveLocalState(); };
  });
}

function openOnboarding() { els.onboardingModal?.classList.remove('hidden'); }
function closeOnboarding() { els.onboardingModal?.classList.add('hidden'); }
function dismissOnboarding() { state.onboardingDismissed = true; saveLocalState(); closeOnboarding(); }

function renderMunicipalityTrustBox(a, b) {
  if (!els.municipalityTrustBox) return;
  if (!a && !b) {
    els.municipalityTrustBox.innerHTML = '<div class="helper-text">Seleziona un comune per leggere affidabilità del caso e note di comparabilità.</div>';
    return;
  }
  const row = a && a.score != null ? b : a;
  const lineage = a && a.score != null ? null : b;
  const trust = a && a.score != null ? a : assessRowTrust(row, lineage);
  if (!row || !trust) {
    els.municipalityTrustBox.innerHTML = '<div class="helper-text">Affidabilità del caso non disponibile.</div>';
    return;
  }
  els.municipalityTrustBox.innerHTML = `<div class="trust-box ${trustStyle(trust.status)}"><strong>Affidabilità del caso: ${escapeHtml(trust.label)}</strong><div class="helper-text" style="margin-top:6px">${escapeHtml((trust.reasons || []).join(' · ') || 'Nessun warning forte')}</div></div>`;
}

function municipalityColor(id) {
  const palette = ['#38bdf8', '#f59e0b', '#8b5cf6', '#10b981'];
  const idx = state.compareMunicipalityIds.indexOf(id);
  if (idx >= 0) return palette[idx % palette.length];
  if (id && id === state.selectedMunicipalityId) return '#f43f5e';
  return '#334155';
}

function auditPayload() {
  return {
    generated_at: new Date().toISOString(),
    view: currentViewState(),
    quality_report: state.qualityReport,
    derived_validations: state.qualityReport?.derived_validations || null,
    geometry_pack: state.geometryPack ? { years: state.geometryPack.availableYears, main_features: (state.geometry?.features || []).length } : null,
    ui_issues: state.uiIssues
  };
}

function renderRecentMunicipalityPanel() {
  if (!els.recentMunicipalityPanel) return;
  const ids = [...new Set([...state.recentMunicipalityIds, ...state.bookmarkedMunicipalityIds])].slice(0, 10);
  els.recentMunicipalityPanel.innerHTML = ids.length ? ids.map(id => `<button type="button" class="chip-btn" data-mid="${escapeHtml(id)}">${escapeHtml(municipalityLabelById(id))}</button>`).join(' ') : '<div class="helper-text">Nessun comune recente.</div>';
  [...els.recentMunicipalityPanel.querySelectorAll('[data-mid]')].forEach(btn => btn.addEventListener('click', () => { selectMunicipality(btn.dataset.mid); requestRender(); }));
}

function buildMunicipalityReportHtml() {
  const id = state.selectedMunicipalityId;
  if (!id) return '';
  const rows = (state.indices.summaryByMunicipality.get(id) || []).slice().sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  const selected = selectedMunicipalityRecord();
  const currentRow = getSummaryRow(state, state.selectedElection, id) || rows.at(-1) || null;
  const compareRow = state.compareElection ? getSummaryRow(state, state.compareElection, id) : null;
  const lineage = lineageRecord();
  const trust = currentRow ? assessRowTrust(currentRow, lineage) : { label: 'n/d', reasons: [] };
  const currentPartyShare = currentRow ? aggregateShareFor(state, currentRow.election_key, id, state.selectedParty) : null;
  const storyNotes = municipalityStoryNotes(rows, currentRow, compareRow, lineage, currentPartyShare);
  const noteRecord = municipalityNoteRecord(id);
  const briefing = buildViewBriefing();
  const compareShare = compareRow ? aggregateShareFor(state, compareRow.election_key, id, state.selectedParty) : null;
  const historyRows = rows.map(row => ({
    year: row.election_year || '—',
    turnout: row.turnout_pct != null ? `${fmtPct(row.turnout_pct)}%` : '—',
    firstParty: row.first_party_std || '—',
    margin: row.first_second_margin != null ? `${fmtPct(row.first_second_margin)} pt` : '—',
    activeShare: (() => {
      const share = aggregateShareFor(state, row.election_key, id, state.selectedParty);
      return share != null ? `${fmtPct(share)}%` : '—';
    })(),
    completeness: row.completeness_flag || '—',
    territorial: row.territorial_status || '—'
  }));
  const currentProvince = selected?.province_current || currentRow?.province || 'n/d';
  const keyFacts = [
    ['Elezione attiva', electionLabelByKey(state.selectedElection)],
    ['Confronto', state.compareElection ? electionLabelByKey(state.compareElection) : 'nessuno'],
    ['Metrica attiva', metricLabel()],
    ['Selezione attiva', currentSelectionLabel()],
    ['Provincia corrente', currentProvince],
    ['Affidabilità del caso', trust.label],
    ['Affluenza corrente', currentRow?.turnout_pct != null ? `${fmtPct(currentRow.turnout_pct)}%` : '—'],
    ['Primo partito', currentRow?.first_party_std || '—'],
    ['Quota attiva', currentPartyShare != null ? `${fmtPct(currentPartyShare)}%` : '—'],
    ['Δ quota vs confronto', currentPartyShare != null && compareShare != null ? `${fmtPctSigned(currentPartyShare - compareShare)} pt` : '—']
  ];
  if (currentRow?.province_observed && currentRow.province_observed !== currentProvince) {
    keyFacts.splice(5, 0, ['Provincia osservata nella fonte', currentRow.province_observed]);
  }
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Scheda comune · ${escapeHtml(municipalityLabelById(id))}</title>
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:28px;background:#0b1220;color:#e5eefc;line-height:1.55}
    h1,h2,h3{margin:0 0 10px}
    .wrap{max-width:1120px;margin:0 auto}
    .lede{color:#cbd5e1;margin-top:8px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:18px 0}
    .card{background:#111827;border:1px solid rgba(148,163,184,.2);border-radius:18px;padding:16px}
    .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#162032;border:1px solid rgba(148,163,184,.18);margin-right:8px;font-size:12px}
    .kvs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}
    .kvs div{background:rgba(15,23,42,.55);border-radius:12px;padding:10px 12px;border:1px solid rgba(148,163,184,.14)}
    .kvs span{display:block;color:#93c5fd;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
    ul{margin:8px 0 0 18px;padding:0}
    li{margin:7px 0}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{padding:10px 8px;border-bottom:1px solid rgba(148,163,184,.16);text-align:left;font-size:14px}
    th{color:#93c5fd}
    .meta{margin-top:8px;color:#cbd5e1;font-size:14px}
    .muted{color:#94a3b8}
    .hero{font-size:1.18rem;font-weight:800;margin-top:8px}
    @media print{body{background:#fff;color:#111827}.card{background:#fff;border-color:#cbd5e1}.pill{background:#f8fafc;color:#0f172a;border-color:#cbd5e1}th{color:#334155}.muted,.lede,.meta{color:#475569}}
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <span class="pill">${escapeHtml(audienceMeta().label)}</span>
      <span class="pill">${escapeHtml(metricLabel())}</span>
      <span class="pill">${escapeHtml(state.territorialMode)}</span>
    </div>
    <h1>${escapeHtml(municipalityLabelById(id))}</h1>
    <div class="hero">${escapeHtml(metricSentenceForRow(currentRow))}</div>
    <p class="lede">Scheda stampabile del comune selezionato: mantiene il lato divulgativo, ma porta con sé coverage, affidabilità, note territoriali e serie storica leggibile.</p>

    <div class="grid">
      <section class="card">
        <h2>Key facts</h2>
        <div class="kvs">
          ${keyFacts.map(([k, v]) => `<div><span>${escapeHtml(k)}</span>${escapeHtml(v)}</div>`).join('')}
        </div>
      </section>
      <section class="card">
        <h2>Sintesi pronta</h2>
        <p class="meta">${escapeHtml(briefing.standfirst)}</p>
        <ul>${briefing.canSay.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>
    </div>

    <div class="grid">
      <section class="card">
        <h2>Lettura del caso</h2>
        <ul>${storyNotes.length ? storyNotes.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>Nessuna traiettoria leggibile nel bundle corrente.</li>'}</ul>
      </section>
      <section class="card">
        <h2>Guardrail e limiti</h2>
        <div class="meta"><strong>Affidabilità del caso:</strong> ${escapeHtml(trust.label)}</div>
        <ul>${[...(trust.reasons || []), ...briefing.caution].slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>
    </div>

    ${noteRecord?.note ? `<section class="card"><h2>Nota locale salvata nel browser</h2><p>${escapeHtml(noteRecord.note)}</p><div class="muted">${noteRecord.updated_at ? `Aggiornata ${new Date(noteRecord.updated_at).toLocaleString('it-IT')}` : ''}</div></section>` : ''}

    <section class="card" style="margin-top:16px">
      <h2>Serie storica disponibile</h2>
      <table>
        <thead>
          <tr><th>Anno</th><th>Affluenza</th><th>Primo partito</th><th>Quota attiva</th><th>Margine</th><th>Completezza</th><th>Stato territoriale</th></tr>
        </thead>
        <tbody>
          ${historyRows.length ? historyRows.map(row => `<tr><td>${escapeHtml(String(row.year))}</td><td>${escapeHtml(row.turnout)}</td><td>${escapeHtml(row.firstParty)}</td><td>${escapeHtml(row.activeShare)}</td><td>${escapeHtml(row.margin)}</td><td>${escapeHtml(row.completeness)}</td><td>${escapeHtml(row.territorial)}</td></tr>`).join('') : '<tr><td colspan="7">Nessuna serie storica disponibile.</td></tr>'}
        </tbody>
      </table>
    </section>

    <section class="card" style="margin-top:16px">
      <h2>Nota metodologica pronta da citare</h2>
      <p>${escapeHtml(briefing.methodNote)}</p>
      <p class="muted">Questa scheda non sostituisce il controllo di coverage matrix, audit, lineage e risultati di partito completi.</p>
    </section>
  </div>
</body>
</html>`;
}

const els = {};

function setLoading(isLoading, message = '') {
  const overlay = q('loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !isLoading);
  const helper = overlay.querySelector('.helper-text');
  if (helper && message) helper.textContent = message;
}

function showToast(message, type = 'success', timeout = 2400) {
  const stack = q('toast-stack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<strong>${escapeHtml(type === 'error' ? 'Attenzione' : type === 'warning' ? 'Nota' : 'Fatto')}</strong><div class="helper-text" style="margin-top:4px">${escapeHtml(message)}</div>`;
  stack.appendChild(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(4px)';
    window.setTimeout(() => node.remove(), 180);
  }, timeout);
}

async function copyTextToClipboard(text, successMessage = 'Testo copiato negli appunti.') {
  try {
    await navigator.clipboard.writeText(String(text || ''));
    showToast(successMessage, 'success', 1800);
  } catch {
    showToast('Impossibile copiare negli appunti in questo contesto.', 'warning', 2400);
  }
}

function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function setInlineMapRefresh(isActive, message = '') {
  state.mapRefreshPending = !!isActive;
  state.mapRefreshLabel = isActive ? (message || 'Aggiorno la vista') : '';
  document.body.classList.toggle('map-refresh-pending', !!isActive);
  if (!els.controlRefreshStatus) return;
  els.controlRefreshStatus.classList.toggle('hidden', !isActive);
  const label = els.controlRefreshStatus.querySelector('span:last-child');
  if (label) label.textContent = state.mapRefreshLabel || 'Aggiorno la vista';
}

function setControlBusy(control, isBusy) {
  if (!control) return;
  if (isBusy) {
    const count = state.controlBusyCounts.get(control) || 0;
    if (!count) {
      state.controlBusyPreviousDisabled.set(control, !!control.disabled);
    }
    state.controlBusyCounts.set(control, count + 1);
    control.disabled = true;
    control.classList?.add('is-control-loading');
    return;
  }
  const count = state.controlBusyCounts.get(control) || 0;
  if (count > 1) {
    state.controlBusyCounts.set(control, count - 1);
    return;
  }
  state.controlBusyCounts.delete(control);
  const wasDisabled = state.controlBusyPreviousDisabled.get(control);
  state.controlBusyPreviousDisabled.delete(control);
  control.disabled = wasDisabled === true;
  control.classList?.remove('is-control-loading');
}

function controlRefreshLabel(control) {
  if (control === els.electionSelect || control === els.electionSlider) return 'Cambio elezione...';
  if (control === els.partySelect || control === els.partyModeSelect) return 'Aggiorno partito...';
  if (control === els.metricSelect) return 'Aggiorno metrica...';
  if (control === els.compareElectionSelect) return 'Aggiorno confronto...';
  return 'Aggiorno la vista...';
}

function hasRenderedMapSurface() {
  return Boolean(state.mapCanvasRender?.cache?.items?.length || q('map-svg')?.querySelector('.municipality-path'));
}

function selectedMapNeedsMapReady() {
  return ['turnout', 'first_party', 'margin', 'dominant_block', 'party_share'].includes(state.selectedMetric);
}

function selectedMapNeedsSummary() {
  return !selectedMapNeedsMapReady()
    || ['delta_turnout', 'swing_compare'].includes(state.selectedMetric)
    || state.selectedMetric === 'custom_indicator';
}

function currentMapInputsReady() {
  if (!state.selectedElection) return false;
  if (selectedMapNeedsMapReady()) {
    const loaded = state.loadedMapReadyElectionKeys?.has(state.selectedElection)
      || Boolean(state.indices.mapReadyCountByElection?.get(state.selectedElection));
    if (!loaded && state.mapReadyLoadStrategy === 'by_election') return false;
  }
  if (selectedMapNeedsSummary()) {
    const loaded = state.loadedSummaryElectionKeys?.has(state.selectedElection)
      || Boolean(state.indices.summaryCountByElection?.get(state.selectedElection));
    if (!loaded && state.summaryLoadStrategy === 'by_election') return false;
  }
  if (metricNeedsCompare() && state.compareElection) {
    const loaded = state.loadedSummaryElectionKeys?.has(state.compareElection)
      || Boolean(state.indices.summaryCountByElection?.get(state.compareElection));
    if (!loaded && state.summaryLoadStrategy === 'by_election') return false;
  }
  return Boolean(state.geometry?.features?.length || state.geometryFallback?.features?.length);
}

async function prepareCurrentMapInputs() {
  const tasks = [
    syncActiveGeometry(state, registerIssue),
    ensureVisibleMapReady({ silent: true })
  ];
  if (selectedMapNeedsSummary() || shouldHydrateCompareSummaryNow()) tasks.push(ensureVisibleSummary({ silent: true }));
  if (shouldHydratePartyResultsNow()) tasks.push(ensureVisibleResults({ silent: true }));
  await Promise.all(tasks);
}

function likelyNextElectionKeys(limit = 2) {
  const labels = state.electionLabels || [];
  const idx = labels.findIndex(d => d.value === state.selectedElection);
  if (idx < 0) return [];
  const candidates = [labels[idx + 1]?.value, labels[idx - 1]?.value, state.compareElection].filter(Boolean);
  return [...new Set(candidates)].filter(key => key !== state.selectedElection).slice(0, limit);
}

function scheduleLikelyDatasetPrefetch() {
  if (state.mapIdlePrefetchHandle) return;
  state.mapIdlePrefetchHandle = idle(async () => {
    state.mapIdlePrefetchHandle = null;
    const keys = likelyNextElectionKeys()
      .filter(key => !state.prefetchedElectionKeys.has(key))
      .filter(key => !state.loadedMapReadyElectionKeys?.has(key) || !state.loadedSummaryElectionKeys?.has(key));
    if (!keys.length) return;
    keys.forEach(key => state.prefetchedElectionKeys.add(key));
    try {
      const [mapReport, summaryReport] = await Promise.all([
        ensureMapReadyForElections(state, keys, { buildIndices: updateIndices, registerIssue }),
        ensureSummaryForElections(state, keys, { buildIndices: updateIndices, registerIssue })
      ]);
      if ((mapReport?.loadedRows || 0) || (summaryReport?.loadedRows || 0)) {
        invalidateDerivedCaches();
        renderStatusPanel();
      }
    } catch (error) {
      keys.forEach(key => state.prefetchedElectionKeys.delete(key));
      registerIssue('idle-prefetch', error);
    }
  }, 1000);
}

function refreshMapContinuously(control = null, { message = controlRefreshLabel(control), disableControl = true } = {}) {
  const token = state.mapRefreshToken + 1;
  state.mapRefreshToken = token;
  setInlineMapRefresh(true, message);
  if (disableControl) setControlBusy(control, true);
  requestRender();
  prepareCurrentMapInputs()
    .catch(error => registerIssue('map-refresh', error))
    .finally(() => {
      setControlBusy(control, false);
      if (state.mapRefreshToken !== token) return;
      setInlineMapRefresh(false);
      scheduleLikelyDatasetPrefetch();
      requestRender();
    });
}

function requestRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  window.requestAnimationFrame(() => {
    state.renderQueued = false;
    renderAll();
  });
}

function invalidateDerivedCaches() {
  state.metricCaches = {};
  state.selectorCaches = {};
  state.similarityCache = {};
}

function registerIssue(scope, error) {
  const message = error?.message || String(error || 'Errore sconosciuto');
  state.uiIssues = [{ scope, message, ts: Date.now() }, ...state.uiIssues.filter(d => d.scope !== scope)].slice(0, 12);
  console.error(`[${scope}]`, error);
}

function clearIssues() {
  state.uiIssues = [];
}

function safeRender(scope, fn) {
  try {
    fn();
  } catch (error) {
    registerIssue(scope, error);
  }
}

function resolveRenderTarget(target) {
  if (!target) return null;
  if (typeof target === 'function') return target() || null;
  if (typeof target === 'string') return document.querySelector(target);
  return target;
}

function isRenderTargetVisible(target) {
  const node = resolveRenderTarget(target);
  if (!node || !document.body.contains(node)) return false;
  if (node.hidden) return false;
  if (node.closest('.hidden, .hidden-by-view')) return false;
  if (node.closest('.panel.collapsed, .panel.is-collapsed')) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return node.getClientRects().length > 0;
}

function shouldRunRenderTask(task) {
  if (typeof task.when === 'function' && !task.when()) return false;
  if (task.always) return true;
  return isRenderTargetVisible(task.target);
}

function cancelDeferredRender() {
  if (!state.deferredRenderHandle) return;
  if (state.deferredRenderKind === 'idle' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(state.deferredRenderHandle);
  } else {
    window.clearTimeout(state.deferredRenderHandle);
  }
  state.deferredRenderHandle = null;
  state.deferredRenderKind = null;
}

function scheduleDeferredRender(tasks, token) {
  if (!tasks.length) return;
  cancelDeferredRender();
  const run = () => {
    state.deferredRenderHandle = null;
    state.deferredRenderKind = null;
    if (token !== state.renderCycle) return;
    tasks.forEach(task => {
      if (shouldRunRenderTask(task)) safeRender(task.scope, task.fn);
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    state.deferredRenderKind = 'idle';
    state.deferredRenderHandle = window.requestIdleCallback(run, { timeout: 180 });
    return;
  }
  state.deferredRenderKind = 'timeout';
  state.deferredRenderHandle = window.setTimeout(run, 90);
}

function provinceValuesForPreset(presetValue, available) {
  const preset = AREA_PRESETS.find(d => d.value === presetValue);
  if (!preset || preset.value === 'all') return available.slice();
  if (preset.value === 'custom') return [...state.selectedProvinceSet];
  const tokens = (preset.tokens || []).map(normalizeTextToken);
  return available.filter(prov => tokens.some(token => normalizeTextToken(prov).includes(token)));
}

function toggleFocusMode(force = null) {
  state.focusMode = force == null ? !state.focusMode : !!force;
  document.body.classList.toggle('focus-mode', state.focusMode);
  if (els.focusModeBtn) els.focusModeBtn.textContent = state.focusMode ? 'Esci focus' : 'Focus mode';
  syncURLState();
}

function setUILevel(level = 'basic') {
  state.uiLevel = level === 'advanced' ? 'advanced' : 'basic';
  updateBodyAppearance();
  if (state.uiLevel === 'basic' && document.body.dataset.dashboardView === 'analysis') {
    switchDashboardSection('dashboard');
  }
  syncURLState();
  requestRender();
  showToast(`Interfaccia ${state.uiLevel === 'advanced' ? 'esperta' : 'base'} attiva.`, 'success', 1800);
}

function setAudienceMode(mode = 'public', { applyHints = true } = {}) {
  if (!AUDIENCE_MODES[mode]) return;
  state.audienceMode = mode;
  if (applyHints) {
    if (mode === 'public') {
      state.analysisMode = 'explore';
      state.selectedMetric = 'turnout';
      state.selectedPalette = 'sequential';
    } else if (mode === 'research') {
      state.showNotes = true;
      state.analysisMode = 'diagnose';
    } else if (mode === 'admin') {
      state.analysisMode = 'trajectory';
      state.selectedMetric = 'turnout';
    } else if (mode === 'press') {
      state.analysisMode = 'compare';
      if (state.compareElection) state.selectedMetric = 'swing_compare';
    }
  }
  setupControls();
  readControls();
  updateBodyAppearance();
  requestRender();
  showToast(`Guida di lettura impostata su ${audienceMeta().label}.`, 'success', 1800);
}

function updateBodyAppearance() {
  document.body.classList.toggle('density-compact', state.uiDensity === 'compact');
  document.body.classList.toggle('basic-mode', state.uiLevel === 'basic');
  document.body.classList.toggle('advanced-mode', state.uiLevel === 'advanced');
  document.body.classList.toggle('party-share-mode', state.selectedMetric === 'party_share');
  document.body.classList.toggle('vision-colorblind', state.visionMode === 'colorblind');
  document.body.classList.toggle('vision-high-contrast', state.visionMode === 'high_contrast');
  document.body.dataset.audienceMode = state.audienceMode || 'public';
  if (els.uiLevelSummary) {
    els.uiLevelSummary.textContent = state.uiLevel === 'advanced'
      ? 'Modalità esperta: tutti i pannelli restano disponibili e la lettura è più densa.'
      : 'Modalità base: focus su comune, anno, metrica e contesto, senza togliere il motore dati.';
  }
  if (els.displayModeSummary) {
    els.displayModeSummary.textContent = `Densità ${state.uiDensity === 'compact' ? 'compatta' : 'comfort'} · visione ${state.visionMode === 'default' ? 'standard' : state.visionMode.replace('_', ' ')} · pubblico ${audienceMeta().label.toLowerCase()}.`;
  }
  if (state.uiLevel === 'basic' && document.body.dataset.dashboardView === 'analysis') {
    switchDashboardSection('dashboard');
  }
}

function switchDashboardSection(view = 'dashboard') {
  const tab = document.querySelector(`.dashboard-tab[data-section-view="${view}"]`);
  tab?.click();
}

function returnToSelectedMap() {
  switchDashboardSection('dashboard');
  const mapWrapper = q('map-wrapper');
  mapWrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!state.selectedMunicipalityId) return;
  state.lastAutoZoomMunicipality = null;
  window.setTimeout(() => {
    zoomToSelectedMunicipality();
    requestRender();
  }, 160);
}

function collapseFirstScreenTools() {
  els.advancedControls?.removeAttribute('open');
  els.secondaryTools?.removeAttribute('open');
}

function commandEntries(query = '') {
  const norm = normalizeTextToken(query);
  const base = [
    { label: 'Reset filtri', hint: 'Ripristina la vista neutra', keywords: 'reset filtri default', action: () => { closeCommandPalette(); resetFilters(); } },
    { label: 'Apri onboarding', hint: 'Guida introduttiva', keywords: 'help onboarding aiuto', action: () => { closeCommandPalette(); openOnboarding(); } },
    { label: state.focusMode ? 'Esci focus mode' : 'Attiva focus mode', hint: 'Riduce il rumore visivo', keywords: 'focus modalità', action: () => { closeCommandPalette(); toggleFocusMode(); requestRender(); } },
    { label: 'Interfaccia base', hint: 'Vista più semplice', keywords: 'base semplice ui', action: () => { closeCommandPalette(); setUILevel('basic'); } },
    { label: 'Interfaccia esperta', hint: 'Vista completa', keywords: 'esperto advanced ui', action: () => { closeCommandPalette(); setUILevel('advanced'); } }
  ];
  const audienceEntries = Object.entries(AUDIENCE_MODES).map(([key, meta]) => ({
    label: `Pubblico: ${meta.label}`,
    hint: meta.description,
    keywords: `pubblico audience ${key} ${meta.label}`,
    action: () => { closeCommandPalette(); setAudienceMode(key); }
  }));
  const analysisEntries = Object.entries(ANALYSIS_MODES).map(([key, meta]) => ({
    label: `Modalità: ${meta.label}`,
    hint: meta.description,
    keywords: `modalità ${key} ${meta.label}`,
    action: () => { closeCommandPalette(); applyAnalysisMode(key); }
  }));
  const municipalityEntries = state.municipalities.slice(0, 400).map(m => ({
    label: municipalityLabelById(m.municipality_id),
    hint: 'Apri profilo comune',
    keywords: `${m.name_current || ''} ${m.name_historical || ''} ${m.alias_names || ''}`,
    action: () => { closeCommandPalette(); selectMunicipality(m.municipality_id, { updateSearch: true }); requestRender(); }
  }));
  const entries = [...base, ...audienceEntries, ...analysisEntries, ...municipalityEntries];
  if (!norm) return entries.slice(0, 24);
  return entries.filter(entry => normalizeTextToken(`${entry.label} ${entry.hint || ''} ${entry.keywords || ''}`).includes(norm)).slice(0, 24);
}

function renderCommandPalette() {
  if (!els.commandResults) return;
  const entries = commandEntries(els.commandInput?.value || '');
  if (!entries.length) {
    els.commandResults.innerHTML = '<div class="empty-state">Nessun risultato.</div>';
    return;
  }
  state.commandPaletteIndex = Math.max(0, Math.min(state.commandPaletteIndex || 0, entries.length - 1));
  els.commandResults.innerHTML = entries.map((entry, idx) => `
    <button type="button" class="command-item${idx === state.commandPaletteIndex ? ' is-active' : ''}" data-command-index="${idx}">
      <strong>${escapeHtml(entry.label)}</strong>
      <span>${escapeHtml(entry.hint || '')}</span>
    </button>`).join('');
  [...els.commandResults.querySelectorAll('[data-command-index]')].forEach(btn => btn.addEventListener('click', () => {
    const hit = entries[Number(btn.dataset.commandIndex)];
    hit?.action?.();
  }));
}

function openCommandPalette() {
  if (!els.commandPalette) return;
  els.commandPalette.classList.remove('hidden');
  state.commandPaletteIndex = 0;
  if (els.commandInput) {
    els.commandInput.value = '';
    renderCommandPalette();
    requestAnimationFrame(() => els.commandInput?.focus());
  }
}

function closeCommandPalette() {
  els.commandPalette?.classList.add('hidden');
  if (els.commandInput) els.commandInput.value = '';
}

function saveCurrentMunicipalityNote() {
  if (!state.selectedMunicipalityId || !els.municipalityNoteInput) return;
  const note = (els.municipalityNoteInput.value || '').trim();
  if (!note) return clearCurrentMunicipalityNote();
  state.municipalityNotes ||= {};
  state.municipalityNotes[state.selectedMunicipalityId] = note;
  state.municipalityNotes[`__ts__${state.selectedMunicipalityId}`] = new Date().toISOString();
  updateMunicipalityNoteUI();
  saveLocalState();
  showToast('Nota locale salvata nel browser.', 'success', 1800);
}

function clearCurrentMunicipalityNote() {
  if (!state.selectedMunicipalityId) return;
  delete state.municipalityNotes?.[state.selectedMunicipalityId];
  delete state.municipalityNotes?.[`__ts__${state.selectedMunicipalityId}`];
  updateMunicipalityNoteUI();
  saveLocalState();
  showToast('Nota locale cancellata.', 'success', 1800);
}

function printMunicipalityReport() {
  const html = buildMunicipalityReportHtml();
  if (!html || !state.selectedMunicipalityId) return;
  const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=900');
  if (!win) {
    showToast('Popup bloccato: impossibile aprire la scheda di stampa.', 'warning', 2600);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

async function toggleMapFullscreen() {
  const target = q('map-wrapper');
  if (!target) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen();
  } catch (error) {
    registerIssue('fullscreen', error);
  }
}

// data loading / geometry helpers moved to modules/data.js

// selectors / metrics moved to modules/selectors.js

function renderHeaderBadges(rows) {
  const electionLabel = state.elections.find(d => d.election_key === state.selectedElection)?.election_label || state.selectedElection || 'Nessuna elezione';
  const compareLabel = state.elections.find(d => d.election_key === state.compareElection)?.election_label || state.compareElection || 'nessun confronto';
  els.activeSummary.textContent = `${electionLabel} · ${rows.length} comuni filtrati`;
  els.territorySummary.textContent = `${state.territorialMode === 'historical' ? 'Comune storico' : 'Comune armonizzato'}${state.sameScaleAcrossYears ? ' · scala fissa' : ' · scala adattiva'}`;
  els.metricSummary.textContent = `${metricLabel()} · confronto: ${compareLabel} · modalità: ${(ANALYSIS_MODES[state.analysisMode] || ANALYSIS_MODES.explore).label}`;
}

function renderActiveFilterChips() {
  if (!els.activeFilterChips) return;
  const chips = [];
  if (state.selectedElection) chips.push(['Anno', state.elections.find(d => d.election_key === state.selectedElection)?.election_label || state.selectedElection]);
  if (state.compareElection) chips.push(['Confronto', state.elections.find(d => d.election_key === state.compareElection)?.election_label || state.compareElection]);
  chips.push(['Indicatore', metricLabel()]);
  if (state.selectedParty && state.selectedMetric !== 'custom_indicator') chips.push([state.selectedPartyMode === 'party_std' ? 'Partito' : state.selectedPartyMode === 'party_family' ? 'Famiglia' : 'Blocco', state.selectedParty]);
  if (state.selectedMetric === 'custom_indicator' && state.selectedCustomIndicator) chips.push(['Indicatore custom', customIndicatorMeta(state.selectedCustomIndicator).label]);
  if (state.selectedAreaPreset && state.selectedAreaPreset !== 'all' && state.selectedAreaPreset !== 'custom') chips.push(['Area', AREA_PRESETS.find(d => d.value === state.selectedAreaPreset)?.label || state.selectedAreaPreset]);
  if (state.selectedProvinceSet.size) chips.push(['Province', [...state.selectedProvinceSet].join(', ')]);
  if (state.selectedCompleteness !== 'all') chips.push(['Completezza', state.selectedCompleteness]);
  if (state.selectedTerritorialStatus !== 'all') chips.push(['Stato', state.selectedTerritorialStatus]);
  chips.push(['Territorio', state.territorialMode === 'historical' ? 'Storico' : 'Armonizzato']);
  if (state.focusMode) chips.push(['Vista', 'Focus mode']);
  if (!chips.length) {
    els.activeFilterChips.innerHTML = '';
    return;
  }
  els.activeFilterChips.innerHTML = chips.map(([k, v]) => `<span class="filter-chip"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</span>`).join('');
}

function metricLabel() {
  const labels = {
    first_party: 'Primo partito',
    party_share: 'Quota partito',
    turnout: 'Affluenza',
    margin: 'Margine 1°-2°',
    dominant_block: 'Blocco dominante',
    swing_compare: 'Swing vs confronto',
    delta_turnout: 'Δ affluenza',
    volatility: 'Volatilità storica',
    dominance_changes: 'Cambi dominanza',
    concentration: 'Concentrazione del voto',
    over_performance_province: 'Scarto vs provincia',
  over_performance_region: 'Scarto vs Italia',
    stability_index: 'Indice di stabilità',
    custom_indicator: customIndicatorMeta(state.selectedCustomIndicator).label || 'Indicatore custom'
  };
  return labels[state.selectedMetric] || state.selectedMetric;
}

function showMapMessage(message) {
  document.body.classList.add('geometry-missing', 'data-first-mode');
  els.mapEmptyState.innerHTML = `${message}<div class="helper-text" style="margin-top:8px">Modalità fallback: tabella, ranking e traiettorie restano il centro dell'esplorazione finché non carichi le geometrie comunali reali.</div>`;
  els.mapEmptyState.classList.remove('hidden');
}

function hideMapMessage() {
  document.body.classList.remove('geometry-missing', 'data-first-mode');
  els.mapEmptyState.classList.add('hidden');
}

function getScaleDomainRows(rows) {
  if (!state.sameScaleAcrossYears) return rows;
  return state.summary
    .filter(row => !state.selectedProvinceSet.size || state.selectedProvinceSet.has(row.province))
    .filter(row => !row.territorial_mode || row.territorial_mode === state.territorialMode)
    .map(row => ({ ...row, __metric_value: getMetricValue(state, row) }));
}

function interpolateToColor(targetColor) {
  const start = d3.rgb('#f8fafc');
  const end = d3.rgb(targetColor);
  return t => d3.interpolateRgb(start, end)(t);
}

function interpolatePartyShareColor(targetColor) {
  const safeTarget = targetColor || '#2563eb';
  const mid = d3.interpolateRgb('#f8fafc', safeTarget)(0.48);
  const end = d3.rgb(safeTarget).darker(0.35).formatHex();
  return d3.interpolateRgbBasis(['#f8fafc', mid, end]);
}

function mapSequentialInterpolator() {
  if (state.selectedPalette === 'accessible') return d3.interpolateCividis;
  if (state.selectedMetric === 'party_share') return interpolatePartyShareColor(getGroupColor(state.selectedParty));
  if (state.selectedMetric === 'turnout') return d3.interpolateRgbBasis(['#f8fafc', '#d9f0e2', '#5ec7b7', '#1d4ed8']);
  if (state.selectedMetric === 'margin') return d3.interpolateRgbBasis(['#f8fafc', '#fde68a', '#f97316', '#9a3412']);
  return d3.interpolateCividis;
}

function colorScaleForRows(rows) {
  const domainRows = getScaleDomainRows(rows);
  const values = domainRows.map(d => d.__metric_value).filter(v => v !== null && v !== undefined && v !== '');
  if (!values.length) return { type: 'empty', colorFor: () => '#e5e7eb', legend: [] };

  const preferred = state.selectedPalette;

  if (state.selectedMetric === 'first_party' || state.selectedMetric === 'dominant_block') {
    const categories = uniqueSorted(values);
    return {
      type: 'categorical',
      colorFor: v => {
        if (!v) return '#e5e7eb';
        if (state.selectedMetric === 'dominant_block') return getBlockColor(v);
        return getPartyColor(v);
      },
      legend: categories.slice(0, 8).map(c => ({ label: c, color: state.selectedMetric === 'dominant_block' ? getBlockColor(c) : getPartyColor(c) }))
    };
  }

  const numeric = values.map(Number).filter(Number.isFinite);
  if (!numeric.length) return { type: 'empty', colorFor: () => '#e5e7eb', legend: [] };

  const metricIsDiverging = ['swing_compare', 'delta_turnout', 'over_performance_province', 'over_performance_region'].includes(state.selectedMetric) || preferred === 'diverging';
  if (metricIsDiverging) {
    const maxAbs = d3.max(numeric.map(v => Math.abs(v))) || 1;
    const scale = d3.scaleSequential(d3.interpolateRdBu).domain([maxAbs, -maxAbs]);
    return {
      type: 'sequential',
      colorFor: v => Number.isFinite(v) ? scale(v) : '#e5e7eb',
      legend: [{ label: `${fmtPctSigned(-maxAbs)} → 0 → ${fmtPctSigned(maxAbs)}`, gradient: `linear-gradient(90deg, ${scale(-maxAbs)}, ${scale(0)}, ${scale(maxAbs)})` }]
    };
  }

  const rawMin = d3.min(numeric);
  const max = d3.max(numeric);
  const zeroBasedMetrics = ['party_share', 'margin'];
  const min = zeroBasedMetrics.includes(state.selectedMetric) ? Math.min(0, rawMin ?? 0) : rawMin;
  const domainMax = max === min ? min + 1 : max;
  const scale = d3.scaleSequential(mapSequentialInterpolator()).domain([min, domainMax]).clamp(true);
  return {
    type: 'sequential',
    colorFor: v => Number.isFinite(v) ? scale(v) : '#e5e7eb',
    legend: [{ label: `${fmtPct(min)} – ${fmtPct(max)}`, gradient: `linear-gradient(90deg, ${scale(min)}, ${scale((min + domainMax) / 2 || min)}, ${scale(domainMax)})` }]
  };
}

function renderLegend(scaleInfo) {
  if (!scaleInfo || !scaleInfo.legend?.length) {
    els.legend.innerHTML = `
      <div class="legend-stack">
        <span class="legend-caption">Legenda</span>
        <span class="legend-empty">Legenda non disponibile per la vista corrente</span>
      </div>`;
    return;
  }
  const explainer = scaleInfo.type === 'categorical'
    ? 'Colore coerente per categoria'
    : scaleInfo.type === 'sequential'
      ? (['swing_compare', 'delta_turnout', 'over_performance_province', 'over_performance_region'].includes(state.selectedMetric)
        ? 'Scala divergente centrata sul contrasto'
        : state.selectedMetric === 'party_share'
          ? `Più intenso = più voto a ${state.selectedParty || 'partito'}`
          : state.selectedMetric === 'margin'
            ? 'Più intenso = vittoria più netta'
            : 'Più intenso = valore più alto')
      : 'Metrica non numerica';
  const rows = scaleInfo.legend.map(item => {
    if (item.gradient) {
      return `<span class="legend-item legend-item-block"><span class="legend-gradient" style="background:${item.gradient}"></span><span>${escapeHtml(item.label)}</span></span>`;
    }
    return `<span class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span><span>${escapeHtml(item.label)}</span></span>`;
  }).join('');
  els.legend.innerHTML = `
    <div class="legend-stack">
      <div class="legend-heading">
        <span class="legend-caption">${escapeHtml(metricLabel())}</span>
        <span class="legend-caption subtle">${escapeHtml(explainer)}</span>
      </div>
      <div class="legend-rows">
        ${rows}
        <span class="legend-item"><span class="legend-swatch" style="background:#e5e7eb"></span><span>Nessun dato / comune non coperto</span></span>
      </div>
    </div>`;
}

function renderOverviewCards(rows) {
  const avgTurnout = mean(rows.map(r => r.turnout_pct));
  const avgPartyShare = mean(rows.map(r => r.__party_share));
  const shouldShowHeavyHistory = state.resultsLong.length && (
    ['volatility', 'stability_index'].includes(state.selectedMetric)
    || ['compare', 'diagnose', 'trajectory'].includes(state.analysisMode || '')
    || state.uiLevel === 'advanced'
  );
  const avgVolatility = shouldShowHeavyHistory ? mean(rows.map(r => r.__volatility ?? computeVolatility(state, r.municipality_id))) : null;
  const avgStability = shouldShowHeavyHistory ? mean(rows.map(r => computeStabilityIndex(state, r.municipality_id))) : null;
  const completeCount = rows.filter(r => matchesCompletenessFlag(r.completeness_flag, 'non_partial')).length;
  const completeRate = rows.length ? completeCount / rows.length * 100 : null;
  const leaderCounts = d3.rollups(rows.filter(r => r.first_party_std), v => v.length, d => d.first_party_std).sort((a, b) => b[1] - a[1]);
  const topLeader = leaderCounts[0]?.[0] || '—';
  const topLeaderN = leaderCounts[0]?.[1] || 0;

  const cards = [
    { label: 'Comuni visibili', value: fmtInt(rows.length), sub: `${state.selectedProvinceSet.size ? 'province filtrate' : 'tutta Italia / dataset disponibile'}` },
    { label: 'Affluenza media', value: avgTurnout != null ? `${fmtPct(avgTurnout)}%` : '—', sub: 'media dei comuni filtrati' },
    { label: 'Quota media selezione', value: avgPartyShare != null ? `${fmtPct(avgPartyShare)}%` : '—', sub: `${state.selectedParty || 'nessuna selezione'} · ${state.selectedPartyMode}` },
    { label: 'Partito più spesso primo', value: topLeader, sub: `${topLeaderN} comuni in testa` },
    { label: 'Copertura utile', value: completeRate != null ? `${fmtPct(completeRate)}%` : '—', sub: `${fmtInt(completeCount)} comuni senza note/parzialità` },
    { label: 'Volatilità media', value: avgVolatility != null ? `${fmtPct(avgVolatility)} pt` : '—', sub: 'oscillazione media storica' },
    { label: 'Stabilità media', value: avgStability != null ? `${fmtPct(avgStability)}%` : '—', sub: 'quota del run dominante più lungo' }
  ];
  els.overviewCards.innerHTML = cards.map(card => `
    <div class="overview-card">
      <span class="label">${escapeHtml(card.label)}</span>
      <span class="value">${escapeHtml(card.value)}</span>
      <span class="sub">${escapeHtml(card.sub)}</span>
    </div>`).join('');
}

function renderWarnings(rows) {
  const messages = [];
  const derivedValidation = state.qualityReport?.derived_validations;
  if (!state.geometry?.features?.length) messages.push('Geografia mancante: inserisci un GeoJSON/TopoJSON reale per accendere la mappa comunale.');
  if (derivedValidation?.issue_count) {
    messages.push(`Audit derived: ${derivedValidation.issue_count} issue di plausibilità rilevate nel preprocess. Controlla il pannello audit prima di interpretare la vista come definitiva.`);
  }
  if (derivedValidation && (derivedValidation.substantive_coverage_score ?? 0) < 50) {
    messages.push(`Copertura sostanziale ancora bassa (${fmtInt(derivedValidation?.substantive_coverage_score)}): molte elezioni note non hanno ancora righe utili nel bundle corrente.`);
  }
  if (!state.summary.length || !state.resultsLong.length) messages.push("I dataset derived elettorali sono ancora vuoti o incompleti: l'app mostra infrastruttura, controlli e logica, ma non inventa risultati.");
  if (state.selectedMetric === 'swing_compare' && !state.compareElection) messages.push("Lo swing richiede un'elezione di confronto selezionata.");
  if (['party_share','over_performance_province','over_performance_region'].includes(state.selectedMetric) && !state.selectedParty) messages.push('La metrica attiva richiede una selezione partito/famiglia/blocco leggibile.');
  if (state.selectedMetric === 'custom_indicator' && !state.selectedCustomIndicator) messages.push('La metrica custom richiede un file custom_indicators.csv con almeno un indicatore leggibile.');
  if (rows.some(r => hasMeaningfulComparabilityNote(r.comparability_note) || String(r.comparability_note || '').includes('no_party_rows_detected')) && state.showNotes) messages.push('Alcuni comuni hanno note di comparabilità o risultati di partito assenti: verifica il pannello dettaglio e la colonna note in tabella.');
  if (!messages.length || !state.showNotes) {
    els.warningStrip.classList.add('hidden');
    els.warningStrip.innerHTML = '';
    return;
  }
  els.warningStrip.classList.remove('hidden');
  els.warningStrip.innerHTML = messages.map(m => `<div>${escapeHtml(m)}</div>`).join('');
}

function currentMapRenderKey() {
  return JSON.stringify({
    selectedElection: state.selectedElection,
    compareElection: state.compareElection,
    selectedMetric: state.selectedMetric,
    selectedPartyMode: state.selectedPartyMode,
    selectedParty: state.selectedParty,
    selectedCustomIndicator: state.selectedCustomIndicator,
    territorialMode: state.territorialMode,
    geometryReferenceYear: state.geometryReferenceYear,
    selectedCompleteness: state.selectedCompleteness,
    selectedTerritorialStatus: state.selectedTerritorialStatus,
    selectedPalette: state.selectedPalette,
    sameScaleAcrossYears: state.sameScaleAcrossYears,
    minSharePct: state.minSharePct,
    selectedProvinceSet: [...state.selectedProvinceSet].sort(),
    selectedMunicipalityId: state.selectedMunicipalityId,
    compareMunicipalityIds: [...state.compareMunicipalityIds],
    summaryRows: state.summary.length,
    mapReadyRows: state.mapReadyRows.length,
    resultsRows: state.resultsLong.length,
    geometryFeatures: state.geometry?.features?.length || 0,
    provinceGeometryFeatures: state.provinceGeometry?.features?.length || 0,
    detailGeometryKey: state.detailGeometryKey,
    detailGeometryFeatures: state.detailGeometry?.features?.length || 0,
    showNotes: state.showNotes
  });
}

function activeMunicipalityFeatures() {
  const overviewFeatures = state.geometry?.features || [];
  const detailFeatures = state.detailGeometry?.features || [];
  if (!detailFeatures.length) return overviewFeatures;
  const detailKeys = new Set(detailFeatures.map(geometryJoinKey).filter(Boolean));
  if (!detailKeys.size) return overviewFeatures;
  return overviewFeatures.filter(feature => !detailKeys.has(geometryJoinKey(feature))).concat(detailFeatures);
}

function renderMap() {
  const renderKey = currentMapRenderKey();
  if (state.lastMapRenderKey === renderKey) return;
  const svg = d3.select('#map-svg');
  const waitingForInputs = !currentMapInputsReady();
  if (waitingForInputs && hasRenderedMapSurface()) {
    if (state.mapRefreshPending) setInlineMapRefresh(true, state.mapRefreshLabel || 'Aggiorno la vista...');
    return;
  }
  svg.selectAll('*').remove();

  const rows = filteredRowsWithMetric(state, { matchesCompleteness, matchesTerritorialStatus });
  state.filteredRows = rows;
  renderHeaderBadges(rows);
  renderOverviewCards(rows);
  renderWarnings(rows);

  if (!state.geometry || !Array.isArray(state.geometry.features) || !state.geometry.features.length) {
    showMapMessage('Geografia non disponibile. Inserisci un <code>GeoJSON</code> o <code>TopoJSON</code> reale e aggiorna il percorso nel <code>manifest.json</code>.');
    renderLegend(null);
    state.lastMapRenderKey = renderKey;
    return;
  }
  hideMapMessage();

  const rowByJoinKey = new Map(rows.map(r => [rowJoinKey(r), r]));
  const scaleInfo = colorScaleForRows(rows);
  renderLegend(scaleInfo);

  const projection = makeGeoProjection(state.geometry, 960, 680);
  const path = d3.geoPath(projection);
  const features = activeMunicipalityFeatures();
  const anySelection = Boolean(state.selectedMunicipalityId);

  if (els.mapCanvas && typeof Path2D === 'function') {
    svg.classed('is-canvas-backed', true);
    renderCanvasMap({ rows, rowByJoinKey, scaleInfo, projection, anySelection });
    enableMapZoom();
    if (state.selectedMunicipalityId && state.lastAutoZoomMunicipality !== state.selectedMunicipalityId) {
      zoomToSelectedMunicipality();
      state.lastAutoZoomMunicipality = state.selectedMunicipalityId;
    } else if (!state.selectedMunicipalityId) {
      state.lastAutoZoomMunicipality = null;
    }
    state.lastMapRenderKey = renderKey;
    return;
  }

  svg.classed('is-canvas-backed', false);

  const zoomLayer = svg.append('g').attr('class', 'map-zoom-layer');

  if (state.provinceGeometry?.features?.length) {
    zoomLayer.append('g').attr('class','province-layer').selectAll('path')
      .data(state.provinceGeometry.features)
      .join('path')
      .attr('class','province-boundary')
      .attr('d', path)
      .attr('fill','none')
      .attr('stroke','#94a3b8')
      .attr('stroke-width',0.8)
      .attr('opacity',0.55);
  }

  zoomLayer.selectAll('path')
    .data(features)
    .join('path')
    .attr('class', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      const mid = row?.municipality_id;
      const classes = ['map-path','municipality-path'];
      if (mid && mid === state.selectedMunicipalityId) classes.push('is-selected');
      if (mid && state.compareMunicipalityIds.includes(mid)) classes.push('is-compared');
      if (anySelection && mid && mid !== state.selectedMunicipalityId && !state.compareMunicipalityIds.includes(mid)) classes.push('is-faded');
      return classes.join(' ');
    })
    .attr('d', path)
    .attr('fill', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      return row ? scaleInfo.colorFor(row.__metric_value) : '#e5e7eb';
    })
    .attr('stroke', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      const mid = row?.municipality_id;
      if (mid && mid === state.selectedMunicipalityId) return '#f8fafc';
      if (mid && state.compareMunicipalityIds.includes(mid)) return municipalityColor(mid);
      return 'rgba(15, 23, 42, 0.16)';
    })
    .attr('stroke-width', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      const mid = row?.municipality_id;
      if (mid && mid === state.selectedMunicipalityId) return 1.8;
      if (mid && state.compareMunicipalityIds.includes(mid)) return 1.25;
      return 0.18;
    })
    .attr('cursor', 'pointer')
    .on('mouseenter', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mousemove', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mouseleave', hideTooltip)
    .on('click', (event, feature) => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      if (row?.municipality_id) {
        if (event.shiftKey) {
          toggleCompareMunicipality(row.municipality_id);
          return;
        }
        selectMunicipality(row.municipality_id, { updateSearch: true });
        showTooltip(event, feature, row, { pinned: true });
        requestRender();
      }
    });

  enableMapZoom();
  if (state.selectedMunicipalityId && state.lastAutoZoomMunicipality !== state.selectedMunicipalityId) {
    zoomToSelectedMunicipality();
    state.lastAutoZoomMunicipality = state.selectedMunicipalityId;
  } else if (!state.selectedMunicipalityId) {
    state.lastAutoZoomMunicipality = null;
  }
  state.lastMapRenderKey = renderKey;
}

function canvasGeometryCacheKey(projection) {
  const years = state.geometryPack?.availableYears?.join(',') || '';
  const geometryYear = state.geometryReferenceYear || 'auto';
  const featureCount = state.geometry?.features?.length || 0;
  const provinceCount = state.provinceGeometry?.features?.length || 0;
  const detailKey = state.detailGeometryKey || '';
  const detailCount = state.detailGeometry?.features?.length || 0;
  return `${geometryYear}|${years}|${featureCount}|${provinceCount}|${detailKey}|${detailCount}|${projection?.constructor?.name || 'projection'}`;
}

function buildCanvasMapCache(projection) {
  const key = canvasGeometryCacheKey(projection);
  if (state.mapCanvasCache?.key === key) return state.mapCanvasCache;
  const path = d3.geoPath(projection);
  const toItem = feature => {
    const d = path(feature);
    if (!d) return null;
    const bounds = path.bounds(feature);
    const [[x0, y0], [x1, y1]] = bounds || [[NaN, NaN], [NaN, NaN]];
    return {
      feature,
      key: geometryJoinKey(feature),
      path: new Path2D(d),
      bounds,
      boundsArea: [x0, y0, x1, y1].every(Number.isFinite) ? Math.max(1, (x1 - x0) * (y1 - y0)) : Infinity
    };
  };
  const overviewItems = (state.geometry?.features || []).map(toItem).filter(Boolean);
  const detailItems = (state.detailGeometry?.features || []).map(toItem).filter(Boolean);
  const detailKeys = new Set(detailItems.map(item => item.key).filter(Boolean));
  const items = detailItems.length && detailKeys.size
    ? overviewItems.filter(item => !detailKeys.has(item.key)).concat(detailItems)
    : overviewItems;
  const provinceItems = (state.provinceGeometry?.features || []).map(toItem).filter(Boolean);
  const hitGridCellSize = 24;
  const hitGrid = new Map();
  const addToGrid = (cellKey, index) => {
    if (!hitGrid.has(cellKey)) hitGrid.set(cellKey, []);
    hitGrid.get(cellKey).push(index);
  };
  items.forEach((item, index) => {
    const [[x0, y0], [x1, y1]] = item.bounds || [[NaN, NaN], [NaN, NaN]];
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const minCol = Math.max(0, Math.floor(x0 / hitGridCellSize));
    const maxCol = Math.max(minCol, Math.floor(x1 / hitGridCellSize));
    const minRow = Math.max(0, Math.floor(y0 / hitGridCellSize));
    const maxRow = Math.max(minRow, Math.floor(y1 / hitGridCellSize));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        addToGrid(`${col}:${row}`, index);
      }
    }
  });
  hitGrid.forEach(indexes => indexes.sort((a, b) => (items[a]?.boundsArea ?? Infinity) - (items[b]?.boundsArea ?? Infinity)));
  state.mapCanvasCache = {
    key,
    items,
    provinceItems,
    hitGrid,
    hitGridCellSize,
    itemsByKey: new Map(items.map(item => [item.key, item]))
  };
  return state.mapCanvasCache;
}

function setupCanvasMapHandlers() {
  const canvas = els.mapCanvas;
  if (!canvas || canvas.__italiaMapHandlers) return;
  canvas.__italiaMapHandlers = true;
  canvas.addEventListener('mousemove', event => {
    if (state.mapTooltipPinned) return;
    state.mapCanvasLastPointerEvent = event;
    if (state.mapCanvasMoveFrame) return;
    state.mapCanvasMoveFrame = window.requestAnimationFrame(() => {
      state.mapCanvasMoveFrame = null;
      const pointerEvent = state.mapCanvasLastPointerEvent || event;
      const hit = hitTestCanvasMap(pointerEvent);
      if (hit) {
        showTooltip(pointerEvent, hit.item.feature, hit.row);
        if (!state.selectedMunicipalityId && state.mapCanvasTransform?.k >= DETAIL_ZOOM_THRESHOLD) {
          ensureDetailGeometryForMunicipality(hit.row?.municipality_id, { reason: 'hover-deep-zoom' });
        }
      } else {
        hideTooltip();
      }
    });
  });
  canvas.addEventListener('mouseleave', () => {
    state.mapCanvasLastPointerEvent = null;
    state.mapCanvasLastHit = null;
    hideTooltip();
  });
  canvas.addEventListener('click', event => {
    const hit = hitTestCanvasMap(event);
    const row = hit?.row;
    if (!row?.municipality_id) return;
    if (event.shiftKey) {
      toggleCompareMunicipality(row.municipality_id);
      return;
    }
    selectMunicipality(row.municipality_id, { updateSearch: true });
    showTooltip(event, hit.item.feature, row, { pinned: true });
    requestRender();
  });
}

function resizeCanvasBackingStore(canvas) {
  if (!canvas) return null;
  const width = 960;
  const height = 680;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas.getContext('2d', { alpha: true });
}

function renderCanvasMap({ rows, rowByJoinKey, scaleInfo, projection, anySelection }) {
  const canvas = els.mapCanvas;
  const ctx = resizeCanvasBackingStore(canvas);
  if (!canvas || !ctx) return;
  setupCanvasMapHandlers();
  const cache = buildCanvasMapCache(projection);
  const transform = state.mapCanvasTransform || d3.zoomIdentity;
  state.mapCanvasLastHit = null;
  state.mapCanvasRender = { cache, rowByJoinKey, scaleInfo, anySelection };
  drawCanvasMap(transform);
}

function drawCanvasMap(transform = state.mapCanvasTransform || d3.zoomIdentity) {
  const canvas = els.mapCanvas;
  const ctx = resizeCanvasBackingStore(canvas);
  const render = state.mapCanvasRender;
  if (!canvas || !ctx || !render) return;
  state.mapCanvasTransform = transform;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
  const strokeScale = 1 / Math.max(1, transform.k);

  render.cache.items.forEach(item => {
    const row = render.rowByJoinKey.get(item.key);
    const mid = row?.municipality_id;
    const selected = mid && mid === state.selectedMunicipalityId;
    const compared = mid && state.compareMunicipalityIds.includes(mid);
    const faded = render.anySelection && mid && !selected && !compared;
    ctx.globalAlpha = faded ? 0.32 : 1;
    ctx.fillStyle = row ? render.scaleInfo.colorFor(row.__metric_value) : '#e5e7eb';
    ctx.fill(item.path);
    const showMunicipalStroke = selected || compared || transform.k >= 3;
    if (showMunicipalStroke) {
      ctx.strokeStyle = selected ? '#0f172a' : compared ? municipalityColor(mid) : 'rgba(15, 23, 42, 0.12)';
      ctx.lineWidth = (selected ? 2.2 : compared ? 1.5 : 0.18) * strokeScale;
      ctx.stroke(item.path);
    }
  });

  ctx.globalAlpha = transform.k >= 3 ? 0.28 : 0.48;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = (transform.k >= 3 ? 0.62 : 0.92) * strokeScale;
  render.cache.provinceItems.forEach(item => {
    ctx.stroke(item.path);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawCanvasMapSoon(transform = state.mapCanvasTransform || d3.zoomIdentity) {
  state.mapCanvasTransform = transform;
  if (state.mapCanvasZoomFrame) return;
  state.mapCanvasZoomFrame = window.requestAnimationFrame(() => {
    state.mapCanvasZoomFrame = null;
    drawCanvasMap(state.mapCanvasTransform);
  });
}

function canvasEventPoint(event) {
  const canvas = els.mapCanvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const y = (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
  const transform = state.mapCanvasTransform || d3.zoomIdentity;
  const [ux, uy] = transform.invert([x, y]);
  return { x: ux, y: uy };
}

function hitTestCanvasMap(event) {
  const render = state.mapCanvasRender;
  const canvas = els.mapCanvas;
  if (!render || !canvas) return null;
  const ctx = canvas.getContext('2d');
  const point = canvasEventPoint(event);
  if (!ctx || !point) return null;
  const pad = 1.5 / Math.max(1, state.mapCanvasTransform?.k || 1);
  const previous = state.mapCanvasLastHit;
  if (previous?.item) {
    const [[x0, y0], [x1, y1]] = previous.item.bounds || [[Infinity, Infinity], [-Infinity, -Infinity]];
    if (point.x >= x0 - pad && point.x <= x1 + pad && point.y >= y0 - pad && point.y <= y1 + pad && ctx.isPointInPath(previous.item.path, point.x, point.y)) {
      return previous;
    }
  }
  const cellSize = render.cache.hitGridCellSize || 32;
  const cellKey = `${Math.max(0, Math.floor(point.x / cellSize))}:${Math.max(0, Math.floor(point.y / cellSize))}`;
  const candidateIndexes = render.cache.hitGrid?.get(cellKey);
  if (!candidateIndexes?.length) {
    state.mapCanvasLastHit = null;
    return null;
  }
  const candidates = candidateIndexes;
  for (let i = 0; i < candidates.length; i += 1) {
    const item = render.cache.items[candidates[i]];
    if (!item) continue;
    const [[x0, y0], [x1, y1]] = item.bounds || [[Infinity, Infinity], [-Infinity, -Infinity]];
    if (point.x < x0 - pad || point.x > x1 + pad || point.y < y0 - pad || point.y > y1 + pad) continue;
    if (ctx.isPointInPath(item.path, point.x, point.y)) {
      state.mapCanvasLastHit = { item, row: render.rowByJoinKey.get(item.key) || null };
      return state.mapCanvasLastHit;
    }
  }
  state.mapCanvasLastHit = null;
  return null;
}

function getProvinceMetricAverage(row) {
  if (!row) return null;
  if (state.selectedMetric === 'party_share' || state.selectedMetric === 'swing_compare') {
    const current = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${row.province}__${state.selectedParty}`);
    if (state.selectedMetric === 'party_share') return current ?? null;
    const compare = state.compareElection ? state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${state.compareElection}__${row.province}__${state.selectedParty}`) : null;
    return current != null && compare != null ? current - compare : null;
  }
  const stats = state.indices.provinceSummaryMap.get(`${row.election_key}__${row.province}`);
  if (!stats) return null;
  if (state.selectedMetric === 'turnout') return stats.turnout_pct;
  if (state.selectedMetric === 'margin') return stats.margin;
  if (state.selectedMetric === 'delta_turnout') {
    const compareStats = state.compareElection ? state.indices.provinceSummaryMap.get(`${state.compareElection}__${row.province}`) : null;
    return stats.turnout_pct != null && compareStats?.turnout_pct != null ? stats.turnout_pct - compareStats.turnout_pct : null;
  }
  if (state.selectedMetric === 'over_performance_province') return 0;
  if (state.selectedMetric === 'over_performance_region') {
    const province = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${row.province}__${state.selectedParty}`);
    const region = state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${state.selectedParty}`);
    return province != null && region != null ? province - region : null;
  }
  if (state.selectedMetric === 'stability_index') return computeStabilityIndex(state, row.municipality_id);
  if (state.selectedMetric === 'custom_indicator') {
    const provinceRows = filteredRowsWithMetric(state, { matchesCompleteness, matchesTerritorialStatus }).filter(r => r.province === row.province).map(r => r.__metric_value).filter(Number.isFinite);
    return provinceRows.length ? d3.mean(provinceRows) : null;
  }
  return stats.first_party_share;
}

function getRegionMetricAverage(row) {
  if (!row) return null;
  if (state.selectedMetric === 'party_share' || state.selectedMetric === 'swing_compare') {
    const current = state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${state.selectedParty}`);
    if (state.selectedMetric === 'party_share') return current ?? null;
    const compare = state.compareElection ? state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${state.compareElection}__${state.selectedParty}`) : null;
    return current != null && compare != null ? current - compare : null;
  }
  const stats = state.indices.regionSummaryMap.get(row.election_key);
  if (!stats) return null;
  if (state.selectedMetric === 'turnout') return stats.turnout_pct;
  if (state.selectedMetric === 'margin') return stats.margin;
  if (state.selectedMetric === 'delta_turnout') {
    const compareStats = state.compareElection ? state.indices.regionSummaryMap.get(state.compareElection) : null;
    return stats.turnout_pct != null && compareStats?.turnout_pct != null ? stats.turnout_pct - compareStats.turnout_pct : null;
  }
  if (state.selectedMetric === 'over_performance_region') return 0;
  if (state.selectedMetric === 'over_performance_province') {
    const province = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${row.province}__${state.selectedParty}`);
    const region = state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${row.election_key}__${state.selectedParty}`);
    return province != null && region != null ? province - region : null;
  }
  if (state.selectedMetric === 'stability_index') return computeStabilityIndex(state, row.municipality_id);
  if (state.selectedMetric === 'custom_indicator') {
    const allRows = filteredRowsWithMetric(state, { matchesCompleteness, matchesTerritorialStatus }).map(r => r.__metric_value).filter(Number.isFinite);
    return allRows.length ? d3.mean(allRows) : null;
  }
  return stats.first_party_share;
}

function metricDisplay(value, signed = false) {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (state.selectedMetric === 'custom_indicator') return signed ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}` : Number(value).toFixed(2);
  if (['first_party','dominant_block'].includes(state.selectedMetric)) return String(value);
  return signed ? fmtPctSigned(value) : fmtPct(value);
}

function positionTooltip(event, tooltip = els.tooltip) {
  tooltip.classList.remove('hidden');
  const wrapperRect = q('map-wrapper').getBoundingClientRect();
  tooltip.style.left = `${event.clientX - wrapperRect.left + 14}px`;
  tooltip.style.top = `${event.clientY - wrapperRect.top + 14}px`;
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 16;
  const idealLeft = event.clientX - wrapperRect.left + 16;
  const idealTop = event.clientY - wrapperRect.top + 16;
  const left = Math.max(margin, Math.min(idealLeft, wrapperRect.width - tooltipRect.width - margin));
  const top = Math.max(margin, Math.min(idealTop, wrapperRect.height - tooltipRect.height - margin));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTooltip(event, feature, row, options = {}) {
  const tooltip = els.tooltip;
  const p = feature.properties || {};
  const tooltipKey = `${state.selectedElection || ''}|${state.selectedMetric || ''}|${state.selectedParty || ''}|${geometryJoinKey(feature) || row?.municipality_id || ''}`;
  const pinned = options.pinned === true;
  if (state.mapTooltipPinned && !pinned) return;
  state.mapTooltipPinned = pinned;
  tooltip.classList.toggle('is-pinned', pinned);
  if (tooltip.dataset.tooltipKey === tooltipKey) {
    positionTooltip(event, tooltip);
    return;
  }
  const label = row?.municipality_name || p.name_current || p.name || 'Comune';
  const province = row?.province || p.province || '—';
  const firstParty = row?.first_party_std || '—';
  const turnout = row?.turnout_pct != null ? `${fmtPct(row.turnout_pct)}%` : '—';
  const metricValue = row?.__metric_value;
  const provinceAvg = row ? getProvinceMetricAverage(row) : null;
  const regionAvg = row ? getRegionMetricAverage(row) : null;
  const metricValueStr = metricDisplay(metricValue, !['first_party','dominant_block','custom_indicator'].includes(state.selectedMetric));
  const provinceDelta = provinceAvg != null && typeof metricValue === 'number' ? `${fmtPctSigned(metricValue - provinceAvg)} pt` : '—';
  const regionDelta = regionAvg != null && typeof metricValue === 'number' ? `${fmtPctSigned(metricValue - regionAvg)} pt` : '—';
  const comparabilityNote = row?.comparability_note ? `<div class="tooltip-note">${escapeHtml(row.comparability_note)}</div>` : '';
  if (tooltip.dataset.tooltipKey !== tooltipKey) {
  tooltip.dataset.tooltipKey = tooltipKey;
  tooltip.innerHTML = `
    <strong>${escapeHtml(label)}</strong><br>
    Provincia: ${escapeHtml(province)}<br>
    Elezione: ${escapeHtml(state.selectedElection || '—')}<br>
    Affluenza: ${turnout}<br>
    Primo partito: ${escapeHtml(firstParty)}<br>
    ${escapeHtml(metricLabel())}: ${escapeHtml(metricValueStr)}<br>
    Diff. provincia: ${provinceAvg != null ? `${fmtPctSigned((typeof metricValue === 'number' ? metricValue : null) - provinceAvg)} pt` : '—'}<br>
        Diff. Italia: ${regionAvg != null ? `${fmtPctSigned((typeof metricValue === 'number' ? metricValue : null) - regionAvg)} pt` : '—'}<br>
    Stato territoriale: ${escapeHtml(row?.territorial_status || '—')}<br>
    <span style="color:#94a3b8">Shift+click per aggiungere/rimuovere nel comparatore</span>
    ${row?.comparability_note ? `<br>Nota: ${escapeHtml(row.comparability_note)}` : ''}
  `;
  tooltip.innerHTML = `
    <div class="tooltip-card">
      <div class="tooltip-header">
        <strong>${escapeHtml(label)}</strong>
        <span class="tooltip-badge">${escapeHtml(province)}</span>
      </div>
      <div class="tooltip-meta">Elezione ${escapeHtml(state.selectedElection || '—')} · ${escapeHtml(metricLabel())}</div>
      <div class="tooltip-grid">
        <div><span>Valore</span><strong>${escapeHtml(metricValueStr)}</strong></div>
        <div><span>Affluenza</span><strong>${turnout}</strong></div>
        <div><span>Primo partito</span><strong>${escapeHtml(firstParty)}</strong></div>
        <div><span>Stato territoriale</span><strong>${escapeHtml(row?.territorial_status || '—')}</strong></div>
        <div><span>Vs provincia</span><strong>${escapeHtml(provinceDelta)}</strong></div>
        <div><span>Vs Italia</span><strong>${escapeHtml(regionDelta)}</strong></div>
      </div>
      ${comparabilityNote}
      <div class="tooltip-hint">Shift+click per aggiungere o rimuovere il comune dal comparatore</div>
    </div>
  `;
  }
  positionTooltip(event, tooltip);
}

function hideTooltip(force = false) {
  if (state.mapTooltipPinned && !force) return;
  state.mapTooltipPinned = false;
  els.tooltip.classList.add('hidden');
  els.tooltip.classList.remove('is-pinned');
  delete els.tooltip.dataset.tooltipKey;
}

function selectedMunicipalityRecord() {
  if (!state.selectedMunicipalityId) return null;
  return state.municipalities.find(d => d.municipality_id === state.selectedMunicipalityId || d.geometry_id === state.selectedMunicipalityId)
    || state.summary.find(d => d.municipality_id === state.selectedMunicipalityId || d.geometry_id === state.selectedMunicipalityId)
    || null;
}

function lineageRecord() {
  return state.lineage.find(d => d.municipality_id_stable === state.selectedMunicipalityId) || null;
}

function renderDetail() {
  const container = els.municipalityProfile;
  const selected = selectedMunicipalityRecord();
  if (!selected) {
    els.selectedMunicipalityBadge.textContent = 'Nessun comune selezionato';
    container.className = 'empty-state smart-empty-state';
    container.innerHTML = `<strong>Nessun comune selezionato</strong><div class="helper-text">Usa ricerca, mappa, insight o command palette per aprire subito un profilo comunale.</div><div class="detail-actions-row" style="margin-top:12px"><button type="button" data-empty-action="search">Apri ricerca</button><button type="button" class="ghost-btn" data-empty-action="trajectory">Modalità Traiettoria</button><button type="button" class="ghost-btn" data-empty-action="compare">Modalità Confronta</button></div>`;
    container.querySelectorAll('[data-empty-action]').forEach(btn => btn.addEventListener('click', () => {
      const action = btn.dataset.emptyAction;
      if (action === 'search') els.municipalitySearch?.focus();
      if (action === 'trajectory') applyAnalysisMode('trajectory');
      if (action === 'compare') applyAnalysisMode('compare');
    }));
    els.municipalityStory.classList.add('hidden');
    els.municipalityStory.innerHTML = '';
    if (els.trajectoryStoryboard) els.trajectoryStoryboard.innerHTML = '';
    if (els.trajectoryReport) els.trajectoryReport.innerHTML = '';
    renderMunicipalityTrustBox(null, null);
    els.lineagePanel.innerHTML = '';
    els.singleElectionResults.innerHTML = '';
    if (els.pinMunicipalityBtn) els.pinMunicipalityBtn.textContent = 'Salva bookmark';
    renderTimeline([]);
    renderDominanceStrip([]);
    renderContextCompareChart([], null);
    updateMunicipalityNoteUI();
    return;
  }

  const profileRows = (state.indices.summaryByMunicipality.get(state.selectedMunicipalityId) || []).slice().sort((a, b) => (a.election_year || 0) - (b.election_year || 0));
  const currentRow = getSummaryRow(state, state.selectedElection, state.selectedMunicipalityId) || profileRows.at(-1) || {};
  const compareRow = state.compareElection ? getSummaryRow(state, state.compareElection, state.selectedMunicipalityId) : null;
  const lineage = lineageRecord();
  const provinceTurnout = currentRow ? state.indices.provinceSummaryMap.get(`${currentRow.election_key}__${currentRow.province}`)?.turnout_pct : null;
  const regionTurnout = currentRow ? state.indices.regionSummaryMap.get(currentRow.election_key)?.turnout_pct : null;
  const currentPartyShare = currentRow ? aggregateShareFor(state, currentRow.election_key, state.selectedMunicipalityId, state.selectedParty) : null;
  const provincePartyShare = currentRow ? state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${currentRow.province}__${state.selectedParty}`) : null;
  const regionPartyShare = currentRow ? state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${state.selectedParty}`) : null;
  const turnoutRank = currentRow ? rankPosition(state.filteredRows, state.selectedMunicipalityId, r => r.turnout_pct) : null;
  const metricRank = currentRow ? rankPosition(state.filteredRows, state.selectedMunicipalityId, r => typeof r.__metric_value === 'number' ? r.__metric_value : null) : null;

  els.selectedMunicipalityBadge.textContent = selected.name_current || selected.municipality_name || selected.name_historical || state.selectedMunicipalityId;
  els.bookmarkMunicipalityBtn.textContent = state.compareMunicipalityIds.includes(state.selectedMunicipalityId) ? 'Rimuovi dal comparatore' : 'Aggiungi al comparatore';
  if (els.pinMunicipalityBtn) els.pinMunicipalityBtn.textContent = state.bookmarkedMunicipalityIds.includes(state.selectedMunicipalityId) ? 'Rimuovi bookmark' : 'Salva bookmark';
  container.className = '';
  container.innerHTML = `
    <div class="detail-block">
      <h3>Anagrafica</h3>
      <div class="keyvals">
        ${currentRow?.province_observed && currentRow.province_observed !== (selected.province_current || currentRow.province || '') ? `<div><span>Provincia osservata</span>${escapeHtml(currentRow.province_observed)}</div>` : ''}
        <div><span>ID geometrico corrente</span>${escapeHtml(selected.geometry_id || currentRow.geometry_id || 'n/d')}</div>
        <div><span>Nome corrente</span>${escapeHtml(selected.name_current || selected.municipality_name || '—')}</div>
        <div><span>Nome storico</span>${escapeHtml(selected.name_historical || '—')}</div>
        <div><span>Provincia</span>${escapeHtml(selected.province_current || currentRow.province || '—')}</div>
        <div><span>ID stabile</span>${escapeHtml(selected.municipality_id || selected.geometry_id || '—')}</div>
        <div><span>Stato territoriale</span>${escapeHtml(currentRow.territorial_status || '—')}</div>
        <div><span>Modalità territoriale</span>${escapeHtml(currentRow.territorial_mode || state.territorialMode)}</div>
      </div>
    </div>
    <div class="detail-block">
      <h3>Confronti immediati</h3>
      <div class="keyvals">
        <div><span>Affluenza comune</span>${currentRow.turnout_pct != null ? `${fmtPct(currentRow.turnout_pct)}%` : '—'}</div>
        <div><span>Vs provincia</span>${currentRow.turnout_pct != null && provinceTurnout != null ? `${fmtPctSigned(currentRow.turnout_pct - provinceTurnout)} pt` : '—'}</div>
        <div><span>Vs Italia</span>${currentRow.turnout_pct != null && regionTurnout != null ? `${fmtPctSigned(currentRow.turnout_pct - regionTurnout)} pt` : '—'}</div>
        <div><span>Primo partito</span>${escapeHtml(currentRow.first_party_std || '—')}</div>
        <div><span>${escapeHtml(state.selectedParty || 'Quota attiva')}</span>${currentPartyShare != null ? `${fmtPct(currentPartyShare)}%` : '—'}</div>
        <div><span>Vs provincia / Italia</span>${currentPartyShare != null ? `${provincePartyShare != null ? fmtPctSigned(currentPartyShare - provincePartyShare) : '—'} / ${regionPartyShare != null ? fmtPctSigned(currentPartyShare - regionPartyShare) : '—'} pt` : '—'}</div>
        <div><span>Margine 1°-2°</span>${currentRow.first_second_margin != null ? `${fmtPct(currentRow.first_second_margin)} pt` : '—'}</div>
        <div><span>Delta vs confronto</span>${compareRow ? `${fmtPctSigned((currentPartyShare ?? 0) - (aggregateShareFor(state, compareRow.election_key, state.selectedMunicipalityId, state.selectedParty) ?? 0))} pt` : '—'}</div>
        <div><span>Rank affluenza</span>${turnoutRank != null ? `#${fmtInt(turnoutRank)} / ${fmtInt(state.filteredRows.length)}` : '—'}</div>
        <div><span>Rank indicatore</span>${metricRank != null ? `#${fmtInt(metricRank)} / ${fmtInt(state.filteredRows.length)}` : '—'}</div>
      </div>
    </div>`;

  renderMunicipalityTrustBox(currentRow, lineage);
  renderMunicipalityStory(profileRows, currentRow, compareRow, lineage, currentPartyShare);
  renderTrajectoryStoryboard(profileRows, currentRow, compareRow);
  renderTrajectoryReport(profileRows, currentRow, compareRow);
  renderLineagePanel(lineage);
  renderSingleElectionResults();
  renderTimeline(profileRows);
  renderDominanceStrip(profileRows);
  renderContextCompareChart(profileRows, currentRow);
  updateMunicipalityNoteUI();
}

function municipalityStoryNotes(profileRows, currentRow, compareRow, lineage, currentPartyShare) {
  if (!profileRows.length) return [];
  const years = profileRows.map(r => r.election_year).filter(Boolean);
  const leaderChanges = computeDominanceChanges(state, state.selectedMunicipalityId);
  const turnoutAvg = mean(profileRows.map(r => r.turnout_pct));
  const volatility = computeVolatility(state, state.selectedMunicipalityId);
  const stability = computeStabilityIndex(state, state.selectedMunicipalityId);
  const selectedSeries = profileRows.map(r => ({ year: r.election_year, value: aggregateShareFor(state, r.election_key, state.selectedMunicipalityId, state.selectedParty) })).filter(d => d.value != null);
  const bestPoint = selectedSeries.slice().sort((a, b) => ((b.value ?? -Infinity) - (a.value ?? -Infinity)))[0];
  const worstPoint = selectedSeries.slice().sort((a, b) => ((a.value ?? Infinity) - (b.value ?? Infinity)))[0];
  const provincePartyShare = currentRow ? state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${currentRow.province}__${state.selectedParty}`) : null;
  const regionPartyShare = currentRow ? state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${state.selectedParty}`) : null;
  const notes = [];
  notes.push(`Copertura disponibile ${years[0] || '—'}–${years.at(-1) || '—'} su ${profileRows.length} elezioni.`);
  notes.push(`Il comune cambia partito dominante ${leaderChanges} volte, ha una volatilità media di ${volatility != null ? fmtPct(volatility) : '—'} punti e un indice di stabilità di ${stability != null ? fmtPct(stability) : '—'}%.`);
  if (turnoutAvg != null) notes.push(`Affluenza media storica ${fmtPct(turnoutAvg)}%.`);
  if (bestPoint) notes.push(`${state.selectedParty || 'La selezione attiva'} tocca il suo massimo nel ${bestPoint.year} con ${fmtPct(bestPoint.value)}%${worstPoint ? ` (minimo ${worstPoint.year}: ${fmtPct(worstPoint.value)}%)` : ''}.`);
  if (currentPartyShare != null && provincePartyShare != null) notes.push(`Nel ${currentRow.election_year}, il comune è ${fmtPctSigned(currentPartyShare - provincePartyShare)} punti rispetto alla media provinciale sulla selezione attiva.`);
  if (currentPartyShare != null && regionPartyShare != null) notes.push(`Rispetto all'Italia nello stesso anno, il differenziale è ${fmtPctSigned(currentPartyShare - regionPartyShare)} punti.`);
  if (compareRow && currentRow) {
    const compareShare = aggregateShareFor(state, compareRow.election_key, state.selectedMunicipalityId, state.selectedParty);
    if (currentPartyShare != null && compareShare != null) notes.push(`Tra ${compareRow.election_year} e ${currentRow.election_year} la selezione attiva si muove di ${fmtPctSigned(currentPartyShare - compareShare)} punti.`);
  }
  if (lineage?.event_type || lineage?.notes) notes.push(`Territorio: ${lineage.event_type || 'evento amministrativo'}${lineage.notes ? ` · ${lineage.notes}` : ''}.`);
  return notes;
}

function renderMunicipalityStory(profileRows, currentRow, compareRow, lineage, currentPartyShare) {
  const notes = municipalityStoryNotes(profileRows, currentRow, compareRow, lineage, currentPartyShare);
  if (!notes.length) {
    els.municipalityStory.classList.add('hidden');
    return;
  }
  els.municipalityStory.classList.remove('hidden');
  els.municipalityStory.innerHTML = notes.map(n => `<div>${escapeHtml(n)}</div>`).join('');
}


function renderTrajectoryStoryboard(profileRows, currentRow, compareRow) {
  if (!els.trajectoryStoryboard) return;
  if (!profileRows.length) {
    els.trajectoryStoryboard.innerHTML = '';
    return;
  }
  const selectedSeries = profileRows.map(r => aggregateShareFor(state, r.election_key, state.selectedMunicipalityId, state.selectedParty)).filter(v => v != null);
  const run = longestLeaderRun(state, profileRows);
  const segments = computeTrajectorySegments(state, profileRows);
  const firstYear = profileRows[0]?.election_year;
  const lastYear = profileRows.at(-1)?.election_year;
  const leaders = [...new Set(profileRows.map(r => r.first_party_std).filter(Boolean))];
  const currentShare = currentRow ? aggregateShareFor(state, currentRow.election_key, state.selectedMunicipalityId, state.selectedParty) : null;
  const compareShare = compareRow ? aggregateShareFor(state, compareRow.election_key, state.selectedMunicipalityId, state.selectedParty) : null;
  const trend = shareTrendLabel(selectedSeries);
  const overProv = currentRow ? computeOverPerformanceProvince(state, currentRow) : null;
  const overReg = currentRow ? computeOverPerformanceRegion(state, currentRow) : null;
  const storyCards = [
    { title: 'Arco osservato', main: `${firstYear || '—'}–${lastYear || '—'}`, sub: `${profileRows.length} elezioni utili · ${leaders.length} leader diversi` },
    { title: 'Segnale selezione attiva', main: trend, sub: currentShare != null ? `oggi ${fmtPct(currentShare)}%${compareShare != null ? ` · vs confronto ${fmtPctSigned(currentShare - compareShare)} pt` : ''}` : 'quota non disponibile' },
    { title: 'Run dominante più lungo', main: run ? run.leader : '—', sub: run ? `${run.from}–${run.to} · ${run.elections} elezioni consecutive` : 'nessun run leggibile' },
    { title: 'Scarti nel contesto', main: overProv != null ? `${fmtPctSigned(overProv)} pt vs provincia` : 'scarto n/d', sub: overReg != null ? `${fmtPctSigned(overReg)} pt vs Italia` : 'scarto nazionale n/d' },
    { title: 'Fasi storiche', main: segments.map(seg => `${seg.from}–${seg.to}`).join(' · '), sub: segments.map(seg => `${seg.label}: ${seg.dominant}`).join(' · ') }
  ];
  els.trajectoryStoryboard.innerHTML = storyCards.map(card => `<div class="story-card"><h4>${escapeHtml(card.title)}</h4><div class="big">${escapeHtml(card.main)}</div><div class="helper-text">${escapeHtml(card.sub)}</div></div>`).join('');
}

function renderLineagePanel(lineage) {
  if (!lineage) {
    els.lineagePanel.innerHTML = '';
    return;
  }
  els.lineagePanel.innerHTML = `
    <div class="lineage-box">
      <strong>Lineage territoriale</strong>
      <div class="lineage-grid">
        <div><span class="label">Predecessori / parent</span><br>${escapeHtml(lineage.parent_ids || '—')}</div>
        <div><span class="label">Successori / child</span><br>${escapeHtml(lineage.child_ids || '—')}</div>
        <div><span class="label">Evento</span><br>${escapeHtml(lineage.event_type || lineage.merge_event || lineage.rename_event || '—')}</div>
        <div><span class="label">Strategia geometrica</span><br>${escapeHtml(lineage.geometry_strategy || '—')}</div>
      </div>
      ${lineage.notes ? `<div style="margin-top:8px;color:var(--muted)">${escapeHtml(lineage.notes)}</div>` : ''}
    </div>`;
}

function renderSingleElectionResults() {
  const rows = getResultsRows(state, state.selectedElection, state.selectedMunicipalityId)
    .slice()
    .sort((a, b) => ((a.rank ?? 9999) - (b.rank ?? 9999)));
  if (!rows.length) {
    els.singleElectionResults.innerHTML = "<div class=\"empty-state\">Nessun risultato partitico disponibile per il comune e l'elezione selezionati.</div>";
    return;
  }

  const topRows = rows.slice(0, 12);
  els.singleElectionResults.innerHTML = `
    <div class="detail-block">
      <h3>Risultati nell'elezione selezionata</h3>
      ${topRows.map(r => `
        <div class="result-row">
          <div>${escapeHtml(r.party_std || r.party_raw || '—')}</div>
          <div class="result-bar-track"><div class="result-bar-fill" style="width:${Math.max(0, Math.min(100, r.vote_share ?? 0))}%; background:${getPartyColor(r.party_std)}"></div></div>
          <div>${r.vote_share != null ? `${fmtPct(r.vote_share)}%` : '—'}</div>
          <div>#${r.rank ?? '—'}</div>
        </div>`).join('')}
    </div>`;
}


function trajectoryField(mode) {
  if (mode === 'party_family') return 'party_family';
  if (mode === 'bloc') return 'bloc';
  return 'party_std';
}

function groupColorByMode(label, mode) {
  if (mode === 'bloc') return getBlockColor(label);
  if (mode === 'party_family') return getFamilyColor(label);
  return getPartyColor(label);
}

function topTrajectoryGroups(municipalityId, mode, limit = 5) {
  const field = trajectoryField(mode);
  const rows = state.resultsLong
    .filter(r => r.municipality_id === municipalityId)
    .filter(r => !state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode)
    .filter(r => r[field]);
  if (!rows.length) return [];
  return d3.rollups(rows, v => d3.sum(v, d => d.vote_share ?? 0), d => d[field])
    .sort((a, b) => ((b[1] ?? 0) - (a[1] ?? 0)))
    .slice(0, limit)
    .map(([label]) => label);
}

function buildTrajectorySeries(profileRows) {
  const mode = state.trajectoryMode || 'selected_vs_context';
  const years = uniqueSorted(profileRows.map(d => Number(d.election_year))).map(Number).sort((a,b)=>a-b);
  if (mode === 'selected_vs_context') {
    const turnoutSeries = profileRows.filter(d => d.turnout_pct != null).map(d => ({ year: d.election_year, value: d.turnout_pct }));
    const selectedSeries = profileRows.map(d => ({ year: d.election_year, value: aggregateShareFor(state, d.election_key, state.selectedMunicipalityId, state.selectedParty) })).filter(d => d.value != null);
    const provinceSeries = profileRows.map(d => ({ year: d.election_year, value: state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${d.election_key}__${d.province}__${state.selectedParty}`) ?? null })).filter(d => d.value != null);
    const regionSeries = profileRows.map(d => ({ year: d.election_year, value: state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${d.election_key}__${state.selectedParty}`) ?? null })).filter(d => d.value != null);
    return {
      label: 'Selezione attiva vs contesto',
      series: [
        { key: 'Affluenza', data: turnoutSeries, color: '#60a5fa', dash: '4,3' },
        { key: `${state.selectedParty || 'Selezione attiva'} · comune`, data: selectedSeries, color: getGroupColor(state.selectedParty) },
        { key: 'Provincia', data: provinceSeries, color: '#f59e0b', dash: '6,4' },
    { key: 'Italia', data: regionSeries, color: '#94a3b8', dash: '2,5' }
      ].filter(s => s.data.length),
      years
    };
  }

  const groupingMode = mode === 'top_parties' ? 'party_std' : state.selectedPartyMode;
  const topGroups = topTrajectoryGroups(state.selectedMunicipalityId, groupingMode, 5);
  const series = topGroups.map(label => ({
    key: label,
    color: groupColorByMode(label, groupingMode),
    data: profileRows.map(row => {
      const rows = getResultsRows(state, row.election_key, state.selectedMunicipalityId)
        .filter(r => !state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode)
        .filter(r => String(r[trajectoryField(groupingMode)] || '') === String(label));
      return { year: row.election_year, value: rows.length ? d3.sum(rows, d => d.vote_share ?? 0) : null };
    }).filter(d => d.value != null)
  })).filter(s => s.data.length);

  return {
    label: mode === 'top_parties' ? 'Top partiti nel tempo' : 'Top gruppi nel tempo',
    series,
    years
  };
}

function lastDefinedPoint(series) {
  const pts = (series.data || []).filter(d => d.value != null);
  return pts.length ? pts[pts.length - 1] : null;
}

function renderTrajectoryReferenceLines(svg, x, yTop, yBottom, years) {
  const refs = [];
  const selectedYear = state.elections.find(e => e.election_key === state.selectedElection)?.election_year;
  const compareYear = state.elections.find(e => e.election_key === state.compareElection)?.election_year;
  if (selectedYear && years.includes(Number(selectedYear))) refs.push({ year: Number(selectedYear), label: 'A', color: '#f8fafc' });
  if (compareYear && years.includes(Number(compareYear)) && Number(compareYear) !== Number(selectedYear)) refs.push({ year: Number(compareYear), label: 'B', color: '#f59e0b' });
  refs.forEach(ref => {
    svg.append('line')
      .attr('x1', x(ref.year)).attr('x2', x(ref.year))
      .attr('y1', yTop).attr('y2', yBottom)
      .attr('stroke', ref.color)
      .attr('stroke-width', 1.1)
      .attr('stroke-dasharray', '3,4')
      .attr('opacity', .8);
    svg.append('text')
      .attr('x', x(ref.year) + 4)
      .attr('y', yTop + 10)
      .attr('fill', ref.color)
      .style('font-size', '11px')
      .text(ref.label);
  });
}

function renderTimeline(profileRows) {
  const svg = d3.select('#timeline-chart');
  svg.selectAll('*').remove();
  const width = 620;
  const height = 300;
  const margin = { top: 28, right: 130, bottom: 34, left: 42 };

  if (!profileRows.length) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Serie storica non disponibile');
    return;
  }

  const trajectory = buildTrajectorySeries(profileRows);
  const seriesDefs = trajectory.series || [];
  const allYears = trajectory.years || uniqueSorted(profileRows.map(d => d.election_year)).map(Number);
  if (!seriesDefs.length || !allYears.length) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Nessuna traiettoria disponibile per la vista scelta');
    return;
  }

  const yMax = d3.max(seriesDefs.flatMap(s => s.data.map(d => d.value).filter(v => v != null))) || 10;
  const x = d3.scaleLinear().domain(d3.extent(allYears)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, Math.max(10, yMax * 1.08)]).nice().range([height - margin.bottom, margin.top]);
  const line = d3.line().defined(d => d.value != null).curve(d3.curveLinear).x(d => x(d.year)).y(d => y(d.value));

  svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format('d')))
    .call(g => g.selectAll('text').attr('fill', '#94a3b8'))
    .call(g => g.selectAll('line,path').attr('stroke', '#475569'));

  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y))
    .call(g => g.selectAll('text').attr('fill', '#94a3b8'))
    .call(g => g.selectAll('line,path').attr('stroke', '#475569'));

  svg.append('text')
    .attr('x', margin.left)
    .attr('y', 14)
    .attr('fill', '#cbd5e1')
    .style('font-size', '11px')
    .text(`${municipalityLabelById(state.selectedMunicipalityId)} · ${trajectory.label}`);

  svg.append('text')
    .attr('x', width - margin.right)
    .attr('y', height - 8)
    .attr('text-anchor', 'end')
    .attr('fill', '#94a3b8')
    .style('font-size', '10px')
    .text('Linee tra elezioni discrete, non trend continuo osservato');

  renderTrajectoryReferenceLines(svg, x, margin.top, height - margin.bottom, allYears);

  seriesDefs.forEach(series => {
    svg.append('path')
      .datum(series.data)
      .attr('fill', 'none')
      .attr('stroke', series.color)
      .attr('stroke-width', 2.2)
      .attr('stroke-dasharray', series.dash || null)
      .attr('d', line);

    svg.append('g')
      .selectAll('circle')
      .data(series.data)
      .join('circle')
      .attr('cx', d => x(d.year))
      .attr('cy', d => y(d.value))
      .attr('r', 2.5)
      .attr('fill', series.color)
      .attr('opacity', .9);

    const endpoint = lastDefinedPoint(series);
    if (endpoint) {
      const xLabel = Math.min(width - 4, x(endpoint.year) + 8);
      svg.append('text')
        .attr('x', xLabel)
        .attr('y', y(endpoint.value))
        .attr('dominant-baseline', 'middle')
        .attr('fill', series.color)
        .style('font-size', '11px')
        .style('font-weight', 600)
        .text(`${series.key} ${fmtPct(endpoint.value)}%`);
    }
  });
}

function renderDominanceStrip(profileRows) {
  const svg = d3.select('#dominance-strip');
  svg.selectAll('*').remove();
  const width = 620;
  const height = 92;
  const margin = { top: 16, right: 18, bottom: 24, left: 18 };

  if (!profileRows.length) {
    svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Nessuna sequenza di dominanza disponibile');
    return;
  }

  const years = profileRows.map(r => r.election_year);
  const x = d3.scaleBand().domain(years).range([margin.left, width - margin.right]).paddingInner(.06);

  svg.append('text').attr('x', margin.left).attr('y', 12).attr('fill', '#cbd5e1').style('font-size', '11px').text('Partito dominante per elezione');

  svg.append('g')
    .selectAll('rect')
    .data(profileRows)
    .join('rect')
    .attr('x', d => x(d.election_year))
    .attr('y', 24)
    .attr('width', x.bandwidth())
    .attr('height', 28)
    .attr('rx', 8)
    .attr('fill', d => getPartyColor(d.first_party_std))
    .attr('stroke', d => d.municipality_id === state.selectedMunicipalityId ? '#f8fafc' : 'transparent');

  svg.append('g')
    .selectAll('text.year')
    .data(profileRows)
    .join('text')
    .attr('x', d => x(d.election_year) + x.bandwidth() / 2)
    .attr('y', 70)
    .attr('text-anchor', 'middle')
    .attr('fill', '#94a3b8')
    .style('font-size', '11px')
    .text(d => d.election_year || '');
}

function sortRows(rows) {
  const sorted = rows.slice();
  const sorters = {
    municipality_asc: (a, b) => String(a.municipality_name || '').localeCompare(String(b.municipality_name || ''), 'it'),
    turnout_desc: (a, b) => ((b.turnout_pct ?? -Infinity) - (a.turnout_pct ?? -Infinity)),
    party_desc: (a, b) => ((b.__party_share ?? -Infinity) - (a.__party_share ?? -Infinity)),
    margin_desc: (a, b) => ((b.first_second_margin ?? -Infinity) - (a.first_second_margin ?? -Infinity)),
    swing_desc: (a, b) => ((b.__swing_compare ?? -Infinity) - (a.__swing_compare ?? -Infinity)),
    volatility_desc: (a, b) => ((b.__volatility ?? -Infinity) - (a.__volatility ?? -Infinity)),
    dominance_changes_desc: (a, b) => ((b.__dominance_changes ?? -Infinity) - (a.__dominance_changes ?? -Infinity)),
    stability_desc: (a, b) => ((computeStabilityIndex(state, b.municipality_id) ?? -Infinity) - (computeStabilityIndex(state, a.municipality_id) ?? -Infinity)),
    over_perf_prov_desc: (a, b) => ((computeOverPerformanceProvince(state, b) ?? -Infinity) - (computeOverPerformanceProvince(state, a) ?? -Infinity)),
    over_perf_reg_desc: (a, b) => ((computeOverPerformanceRegion(state, b) ?? -Infinity) - (computeOverPerformanceRegion(state, a) ?? -Infinity))
  };
  return sorted.sort(sorters[state.tableSort] || sorters.municipality_asc);
}

function renderTable() {
  const body = els.resultsTableBody;
  const filterText = (els.tableFilter.value || '').trim().toLowerCase();
  let rows = state.filteredRows.filter(r => {
    const text = `${r.municipality_name || ''} ${r.province || ''} ${r.first_party_std || ''} ${r.comparability_note || ''}`.toLowerCase();
    return !filterText || text.includes(filterText);
  });
  rows = sortRows(rows);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.tablePage = Math.max(1, Math.min(state.tablePage || 1, totalPages));
  const start = (state.tablePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  body.innerHTML = pageRows.map(r => `
    <tr data-mid="${escapeHtml(r.municipality_id || '')}" class="${r.municipality_id === state.selectedMunicipalityId ? 'is-selected' : ''}">
      <td>${escapeHtml(r.municipality_name || '—')}</td>
      <td>${escapeHtml(r.province || '—')}</td>
      <td>${r.turnout_pct != null ? `${fmtPct(r.turnout_pct)}%` : '—'}</td>
      <td>${escapeHtml(r.first_party_std || '—')}</td>
      <td>${r.__party_share != null ? `${fmtPct(r.__party_share)}%` : '—'}</td>
      <td>${r.__swing_compare != null ? `${fmtPctSigned(r.__swing_compare)} pt` : '—'}</td>
      <td>${r.__volatility != null ? `${fmtPct(r.__volatility)} pt` : '—'}</td>
      <td>${r.comparability_note ? `<span class="note-chip">nota</span>` : ''}</td>
    </tr>`).join('');

  if (els.tablePageInfo) els.tablePageInfo.textContent = `Pagina ${state.tablePage}/${totalPages} · ${fmtInt(rows.length)} righe`;
  if (els.tablePrevBtn) els.tablePrevBtn.disabled = state.tablePage <= 1;
  if (els.tableNextBtn) els.tableNextBtn.disabled = state.tablePage >= totalPages;

  [...body.querySelectorAll('tr')].forEach(tr => {
    tr.addEventListener('click', () => {
      selectMunicipality(tr.dataset.mid || null);
      requestRender();
    });
  });
}

function renderComparisonPanel() {
  if (!state.selectedElection || !state.compareElection) {
    els.comparisonPanelContent.innerHTML = "<div class=\"comparison-box\">Seleziona un'elezione di confronto per vedere swing, guadagni e perdite comune per comune.</div>";
    return;
  }

  const diffs = state.filteredRows.map(row => {
    const compare = getSummaryRow(state, state.compareElection, row.municipality_id);
    return {
      municipality_name: row.municipality_name,
      province: row.province,
      delta_party: row.__swing_compare,
      delta_turnout: compare?.turnout_pct != null && row.turnout_pct != null ? row.turnout_pct - compare.turnout_pct : null,
      leader_flip: compare?.first_party_std && row.first_party_std && compare.first_party_std !== row.first_party_std,
      from_leader: compare?.first_party_std || null,
      to_leader: row.first_party_std || null,
      municipality_id: row.municipality_id
    };
  }).filter(d => d.delta_party != null || d.delta_turnout != null || d.leader_flip);

  const topGain = diffs.filter(d => d.delta_party != null).slice().sort((a, b) => b.delta_party - a.delta_party).slice(0, 8);
  const topLoss = diffs.filter(d => d.delta_party != null).slice().sort((a, b) => a.delta_party - b.delta_party).slice(0, 8);
  const turnoutGain = diffs.filter(d => d.delta_turnout != null).slice().sort((a, b) => b.delta_turnout - a.delta_turnout).slice(0, 6);
  const leaderFlips = diffs.filter(d => d.leader_flip).slice().sort((a, b) => String(a.municipality_name).localeCompare(String(b.municipality_name), 'it')).slice(0, 8);

  const listHtml = (items, type='party') => items.length ? `<div class="ranked-list">${items.map(item => `<div class="ranked-item"><button class="link-btn" type="button" data-mid="${escapeHtml(item.municipality_id)}">${escapeHtml(item.municipality_name)} <span style="color:var(--muted)">(${escapeHtml(item.province || '—')})</span></button><strong>${type === 'flip' ? `${escapeHtml(item.from_leader || '—')} → ${escapeHtml(item.to_leader || '—')}` : item.delta_party != null ? `${fmtPctSigned(item.delta_party)} pt` : `${fmtPctSigned(item.delta_turnout)} pt`}</strong></div>`).join('')}</div>` : '<div class="empty-state">Dati insufficienti.</div>';

  els.comparisonPanelContent.innerHTML = `
    <div class="comparison-box">
      <h3>Maggiori crescite · ${escapeHtml(state.selectedParty || 'selezione')}</h3>
      ${listHtml(topGain)}
    </div>
    <div class="comparison-box">
      <h3>Maggiori cali · ${escapeHtml(state.selectedParty || 'selezione')}</h3>
      ${listHtml(topLoss)}
    </div>
    <div class="comparison-box">
      <h3>Variazioni affluenza</h3>
      ${listHtml(turnoutGain.map(d => ({ ...d, delta_party: null })), 'turnout')}
    </div>
    <div class="comparison-box">
      <h3>Cambi di primo partito</h3>
      ${listHtml(leaderFlips, 'flip')}
    </div>`;
  [...els.comparisonPanelContent.querySelectorAll('[data-mid]')].forEach(btn => btn.addEventListener('click', () => {
    selectMunicipality(btn.dataset.mid, { updateSearch: true });
    requestRender();
  }));
}

function comparisonMetricBase() {
  if (state.selectedMetric === 'swing_compare' || state.selectedMetric === 'party_share') return 'party_share';
  if (state.selectedMetric === 'delta_turnout' || state.selectedMetric === 'turnout') return 'turnout';
  if (state.selectedMetric === 'over_performance_province' || state.selectedMetric === 'over_performance_region') return state.selectedMetric;
  if (state.selectedMetric === 'stability_index') return 'stability_index';
  return state.selectedMetric;
}

function metricValueForMode(row, mode, electionKeyOverride = null) {
  const electionKey = electionKeyOverride || row?.election_key;
  if (!row) return null;
  switch (mode) {
    case 'turnout': return row.turnout_pct;
    case 'margin': return row.first_second_margin;
    case 'dominant_block': return row.dominant_block || inferPartyMeta(row.first_party_std).bloc;
    case 'party_share': return aggregateShareFor(state, electionKey, row.municipality_id, state.selectedParty);
    case 'volatility': return computeVolatility(state, row.municipality_id);
    case 'dominance_changes': return computeDominanceChanges(state, row.municipality_id);
    case 'concentration': return computeConcentration(state, row.municipality_id, electionKey);
    case 'first_party':
    default:
      return row.first_party_std || null;
  }
}

function filteredRowsForElection(electionKey, mode = comparisonMetricBase()) {
  return state.summary.filter(row => {
    if (electionKey && row.election_key !== electionKey) return false;
    if (state.territorialMode && row.territorial_mode && row.territorial_mode !== state.territorialMode) return false;
    if (state.selectedProvinceSet.size && !state.selectedProvinceSet.has(row.province)) return false;
    if (!matchesCompleteness(row)) return false;
    if (!matchesTerritorialStatus(row)) return false;
    return true;
  }).map(row => ({ ...row, __compare_map_value: metricValueForMode(row, mode, electionKey) }));
}

function colorScaleForMode(rows, mode, valueField = '__compare_map_value') {
  const values = rows.map(d => d[valueField]).filter(v => v !== null && v !== undefined && v !== '');
  if (!values.length) return { colorFor: () => '#334155' };
  if (mode === 'first_party' || mode === 'dominant_block') {
    return {
      colorFor: v => {
        if (!v) return '#334155';
        if (mode === 'dominant_block') return getBlockColor(v);
        return getPartyColor(v);
      }
    };
  }
  const numeric = values.map(Number).filter(Number.isFinite);
  if (!numeric.length) return { colorFor: () => '#334155' };
  const min = d3.min(numeric);
  const max = d3.max(numeric);
  const preferred = state.selectedPalette;
  const target = mode === 'party_share' ? getGroupColor(state.selectedParty) : mode === 'turnout' ? '#0ea5e9' : mode === 'concentration' ? '#8b5cf6' : '#2563eb';
  const interpolator = preferred === 'accessible' ? d3.interpolateCividis : interpolateToColor(target);
  const scale = d3.scaleSequential(interpolator).domain([min, max || min + 1]);
  return { colorFor: v => Number.isFinite(v) ? scale(v) : '#334155' };
}

function renderComparisonMap(svgSelector, rows, scaleInfo, title, geometry = state.geometry) {
  const svg = d3.select(svgSelector);
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  const titleEl = svgSelector === '#compare-map-a' ? els.compareMapATitle : els.compareMapBTitle;
  if (titleEl) titleEl.textContent = title;
  if (!geometry?.features?.length) {
    svg.append('text').attr('x', 210).attr('y', 150).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Geometria non disponibile');
    return;
  }
  const rowByJoinKey = new Map(rows.map(r => [rowJoinKey(r), r]));
  const projection = makeGeoProjection(geometry, 420, 300);
  const path = d3.geoPath(projection);
  svg.append('g').selectAll('path')
    .data(geometry.features)
    .join('path')
    .attr('class', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      const mid = row?.municipality_id;
      return `mini-map-path${mid && mid === state.selectedMunicipalityId ? ' is-selected' : ''}${state.selectedMunicipalityId && mid && mid !== state.selectedMunicipalityId ? ' is-muted' : ''}`;
    })
    .attr('d', path)
    .attr('fill', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      return row ? scaleInfo.colorFor(row.__compare_map_value) : '#cbd5e1';
    })
    .attr('stroke', '#0b1220')
    .attr('stroke-width', .45)
    .attr('cursor', 'pointer')
    .on('mouseenter', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mousemove', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mouseleave', hideTooltip)
    .on('click', (event, feature) => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      if (row?.municipality_id) {
        if (event.shiftKey) {
          toggleCompareMunicipality(row.municipality_id);
          return;
        }
        selectMunicipality(row.municipality_id, { updateSearch: true });
        requestRender();
      }
    });
}

function renderComparisonMaps() {
  if (!els.compareMapSummary) return;
  if (!state.selectedElection || !state.compareElection) {
    els.compareMapSummary.textContent = 'Seleziona due elezioni per attivare il confronto cartografico affiancato.';
    renderComparisonMap('#compare-map-a', [], { colorFor: () => '#334155' }, 'Elezione A');
    renderComparisonMap('#compare-map-b', [], { colorFor: () => '#334155' }, 'Elezione B');
    return;
  }
  const mode = comparisonMetricBase();
  const rowsA = filteredRowsForElection(state.selectedElection, mode);
  const rowsB = filteredRowsForElection(state.compareElection, mode);
  const scaleRows = rowsA.concat(rowsB);
  const scale = colorScaleForMode(scaleRows, mode, '__compare_map_value');
  const labelA = state.elections.find(d => d.election_key === state.selectedElection)?.election_label || state.selectedElection;
  const labelB = state.elections.find(d => d.election_key === state.compareElection)?.election_label || state.compareElection;
  els.compareMapSummary.textContent = `Confronto affiancato su ${mode === 'party_share' ? `quota ${state.selectedParty || 'selezione'}` : metricLabel().replace(' vs confronto', '')}. Clicca un comune in una delle due mappe per aprirlo.`;
  renderComparisonMap('#compare-map-a', rowsA, scale, labelA, state.geometryCompareA || state.geometry);
  renderComparisonMap('#compare-map-b', rowsB, scale, labelB, state.geometryCompareB || state.geometry);
}

function renderSwipeMap() {
  const svg = d3.select('#swipe-map-svg');
  const swipeGeometry = state.geometrySwipe || state.geometry;
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  if (!els.swipeCompareSummary || !els.swipeMapDivider) return;
  if (!state.selectedElection || !state.compareElection) {
    els.swipeCompareSummary.textContent = 'Attiva due elezioni per usare lo swipe.';
    svg.append('text').attr('x', 420).attr('y', 160).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Swipe non attivo');
    els.swipeMapDivider.style.left = `${state.swipePosition}%`;
    return;
  }
  if (!swipeGeometry?.features?.length) {
    els.swipeCompareSummary.textContent = 'Geometria mancante: impossibile eseguire lo swipe.';
    svg.append('text').attr('x', 420).attr('y', 160).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Geometria non disponibile');
    els.swipeMapDivider.style.left = `${state.swipePosition}%`;
    return;
  }
  const mode = comparisonMetricBase();
  const rowsA = filteredRowsForElection(state.selectedElection, mode);
  const rowsB = filteredRowsForElection(state.compareElection, mode);
  const scale = colorScaleForMode(rowsA.concat(rowsB), mode, '__compare_map_value');
  const rowByJoinKeyA = new Map(rowsA.map(r => [rowJoinKey(r), r]));
  const rowByJoinKeyB = new Map(rowsB.map(r => [rowJoinKey(r), r]));
  const width = 840, height = 320;
  const projection = makeGeoProjection(swipeGeometry, width, height);
  const path = d3.geoPath(projection);
  const clipId = 'swipe-clip-compare';
  svg.append('clipPath').attr('id', clipId).append('rect').attr('x', 0).attr('y', 0).attr('width', width * (((state.swipePosition ?? 50)) / 100)).attr('height', height);
  const layerB = svg.append('g').attr('class', 'swipe-layer swipe-layer-b');
  const layerA = svg.append('g').attr('class', 'swipe-layer swipe-layer-a').attr('clip-path', `url(#${clipId})`);
  const drawLayer = (layer, rowByJoinKey, variant) => layer.selectAll('path').data(swipeGeometry.features).join('path')
    .attr('class', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      const mid = row?.municipality_id;
      const classes = [variant === 'a' ? 'mini-map-path' : 'mini-map-path'];
      if (mid && mid === state.selectedMunicipalityId) classes.push('is-selected');
      if (mid && state.compareMunicipalityIds.includes(mid)) classes.push('is-compared');
      if (state.selectedMunicipalityId && mid && mid !== state.selectedMunicipalityId && !state.compareMunicipalityIds.includes(mid)) classes.push('is-muted');
      return classes.join(' ');
    })
    .attr('d', path)
    .attr('fill', feature => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      return row ? scale.colorFor(row.__compare_map_value) : '#1f2937';
    })
    .attr('stroke', '#0b1220')
    .attr('stroke-width', .45)
    .attr('cursor', 'pointer')
    .on('mouseenter', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mousemove', (event, feature) => showTooltip(event, feature, rowByJoinKey.get(geometryJoinKey(feature))))
    .on('mouseleave', hideTooltip)
    .on('click', (event, feature) => {
      const row = rowByJoinKey.get(geometryJoinKey(feature));
      if (row?.municipality_id) {
        if (event.shiftKey) { toggleCompareMunicipality(row.municipality_id); return; }
        selectMunicipality(row.municipality_id, { updateSearch: true });
        requestRender();
      }
    });
  drawLayer(layerB, rowByJoinKeyB, 'b');
  drawLayer(layerA, rowByJoinKeyA, 'a');
  const labelA = state.elections.find(d => d.election_key === state.selectedElection)?.election_label || state.selectedElection;
  const labelB = state.elections.find(d => d.election_key === state.compareElection)?.election_label || state.compareElection;
  svg.append('text').attr('class', 'swipe-label').attr('x', 12).attr('y', 20).text(labelA);
  svg.append('text').attr('class', 'swipe-label').attr('x', width - 12).attr('y', 20).attr('text-anchor', 'end').text(labelB);
  els.swipeCompareSummary.textContent = `Swipe su ${mode === 'party_share' ? `quota ${state.selectedParty || 'selezione'}` : metricLabel().replace(' vs confronto', '')}. Sposta il cursore per fondere i due anni sulla stessa geografia.`;
  els.swipeMapDivider.style.left = `${state.swipePosition}%`;
}

function toggleCompareMunicipality(id) {
  if (!id) return;
  if (state.compareMunicipalityIds.includes(id)) {
    state.compareMunicipalityIds = state.compareMunicipalityIds.filter(x => x !== id);
  } else {
    state.compareMunicipalityIds = [...state.compareMunicipalityIds, id].slice(0, 4);
    rememberMunicipality(id);
  }
  syncURLState();
  requestRender();
}

function renderCompareChips() {
  if (!els.compareChipList) return;
  if (!state.compareMunicipalityIds.length) {
    els.compareChipList.innerHTML = '<div class="helper-text">Aggiungi fino a 4 comuni dal pannello dettaglio o dalla tabella.</div>';
    return;
  }
  els.compareChipList.innerHTML = state.compareMunicipalityIds.map(id => {
    const label = municipalityLabelById(id);
    return `<span class="compare-chip" style="border-color:${municipalityColor(id)}55;background:${municipalityColor(id)}22"><span>${escapeHtml(label)}</span><button type="button" data-remove-mid="${escapeHtml(id)}">✕</button></span>`;
  }).join('');
  [...els.compareChipList.querySelectorAll('[data-remove-mid]')].forEach(btn => btn.addEventListener('click', () => {
    state.compareMunicipalityIds = state.compareMunicipalityIds.filter(x => x !== btn.dataset.removeMid);
    renderCompareChips();
    renderMultiCompareChart();
    syncURLState();
  }));
}

function rankPosition(rows, municipalityId, accessor) {
  const valid = rows.filter(r => accessor(r) != null).slice().sort((a, b) => ((accessor(b) ?? -Infinity) - (accessor(a) ?? -Infinity)));
  const idx = valid.findIndex(r => r.municipality_id === municipalityId);
  return idx >= 0 ? idx + 1 : null;
}

function renderRankingsPanel() {
  const rows = state.filteredRows || [];
  if (!els.rankingsPanelContent) return;
  if (!rows.length) {
    els.rankingsPanelContent.innerHTML = '<div class="comparison-box">Nessun comune disponibile per le classifiche.</div>';
    return;
  }
  const bestMetric = rows.filter(r => typeof r.__metric_value === 'number').slice().sort((a, b) => b.__metric_value - a.__metric_value).slice(0, 6);
  const worstMetric = rows.filter(r => typeof r.__metric_value === 'number').slice().sort((a, b) => a.__metric_value - b.__metric_value).slice(0, 6);
  const volatile = rows.filter(r => r.__volatility != null).slice().sort((a, b) => b.__volatility - a.__volatility).slice(0, 6);
  const tight = rows.filter(r => r.first_second_margin != null).slice().sort((a, b) => a.first_second_margin - b.first_second_margin).slice(0, 6);
  const box = (title, items, valueKey='__metric_value') => `<div class="comparison-box"><span class="ranking-kicker">${escapeHtml(metricLabel())}</span><h3>${escapeHtml(title)}</h3>${items.length ? `<div class="ranked-list">${items.map(item => `<div class="ranked-item"><button class="link-btn" type="button" data-mid="${escapeHtml(item.municipality_id)}">${escapeHtml(item.municipality_name)} <span style="color:var(--muted)">(${escapeHtml(item.province || '—')})</span></button><strong>${valueKey==='__volatility' ? fmtPct(item.__volatility)+' pt' : valueKey==='first_second_margin' ? fmtPct(item.first_second_margin)+' pt' : fmtPctSigned(item.__metric_value)+(typeof item.__metric_value==='number' && !['first_party','dominant_block'].includes(state.selectedMetric) ? ' pt' : '')}</strong></div>`).join('')}</div>` : '<div class="empty-state">Dati insufficienti.</div>'}</div>`;
  els.rankingsPanelContent.innerHTML = [
    box('Valori più alti', bestMetric),
    box('Valori più bassi', worstMetric),
    box('Comuni più volatili', volatile, '__volatility'),
    box('Margini più stretti', tight, 'first_second_margin')
  ].join('');
  [...els.rankingsPanelContent.querySelectorAll('[data-mid]')].forEach(btn => btn.addEventListener('click', () => {
    selectMunicipality(btn.dataset.mid, { updateSearch: true });
    requestRender();
  }));
}

function renderMultiCompareChart() {
  const svg = d3.select('#multi-compare-chart');
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  const summary = els.multiCompareSummary;
  const ids = state.compareMunicipalityIds.slice(0, 4);
  if (!ids.length) {
    if (summary) summary.textContent = 'Nessun comune nel comparatore.';
    svg.append('text').attr('x', 360).attr('y', 120).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Aggiungi uno o più comuni al comparatore');
    return;
  }
  if (summary) summary.textContent = `Confronto su ${state.selectedParty || 'selezione attiva'} · ${ids.map(municipalityLabelById).join(' · ')}`;
  const width = 720, height = 260, margin = {top: 24, right: 18, bottom: 34, left: 42};
  const series = ids.map(id => {
    const rows = (state.indices.summaryByMunicipality.get(id) || []).slice().sort((a,b)=>(a.election_year||0)-(b.election_year||0));
    return {
      id,
      label: municipalityLabelById(id),
      color: municipalityColor(id),
      values: rows.map(r => ({ year: r.election_year, value: aggregateShareFor(state, r.election_key, id, state.selectedParty) })).filter(v => v.value != null)
    };
  }).filter(s => s.values.length);
  if (!series.length) {
    svg.append('text').attr('x', 360).attr('y', 120).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Dati insufficienti per il comparatore');
    return;
  }
  const years = [...new Set(series.flatMap(s => s.values.map(v => v.year)))].sort((a,b)=>a-b);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(series.flatMap(s => s.values.map(v => v.value))) || 10]).nice().range([height - margin.bottom, margin.top]);
  const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
  svg.append('g').attr('transform', `translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format('d'))).call(g=>g.selectAll('text').attr('fill','#94a3b8')).call(g=>g.selectAll('line,path').attr('stroke','#475569'));
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y)).call(g=>g.selectAll('text').attr('fill','#94a3b8')).call(g=>g.selectAll('line,path').attr('stroke','#475569'));
  series.forEach((s, idx) => {
    svg.append('path').datum(s.values).attr('fill','none').attr('stroke',s.color).attr('stroke-width',2.3).attr('d', line);
    svg.append('text').attr('x', width - margin.right).attr('y', margin.top + idx*16).attr('text-anchor','end').attr('fill', s.color).style('font-size','11px').text(s.label);
  });
}

function renderProvinceInsights() {
  if (!els.provinceInsights) return;
  const rows = state.filteredRows || [];
  if (!rows.length) {
    els.provinceInsights.innerHTML = '<div class="empty-state">Nessuna provincia disponibile con i filtri correnti.</div>';
    return;
  }
  const provinceRows = d3.rollups(rows, items => {
    const numericMetric = items.filter(r => typeof r.__metric_value === 'number').map(r => r.__metric_value);
    const categoricalMetric = items.filter(r => typeof r.__metric_value === 'string').map(r => r.__metric_value);
    const metricLeader = categoricalMetric.length ? d3.rollup(categoricalMetric, v => v.length, d => d).entries().next().value : null;
    const completeCount = items.filter(r => matchesCompleteness({ completeness_flag: r.completeness_flag })).length;
    return {
      province: items[0]?.province || '—',
      n: items.length,
      avgMetric: numericMetric.length ? d3.mean(numericMetric) : null,
      avgTurnout: mean(items.map(r => r.turnout_pct)),
      avgPartyShare: mean(items.map(r => r.__party_share)),
      completenessRate: items.length ? completeCount / items.length * 100 : null,
      topLeader: metricLeader ? metricLeader[0] : d3.rollups(items.filter(r => r.first_party_std), v => v.length, d => d.first_party_std).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—'
    };
  }, d => d.province || '—').map(([province, stats]) => stats).sort((a,b) => {
    if (typeof a.avgMetric === 'number' && typeof b.avgMetric === 'number') return b.avgMetric - a.avgMetric;
    return String(a.province).localeCompare(String(b.province), 'it');
  });

  els.provinceInsights.innerHTML = `<div class="province-insights-grid">${provinceRows.map(row => `
    <div class="province-card ${state.selectedProvinceSet.has(row.province) ? 'is-selected' : ''}">
      <div class="province-card-head">
        <div><strong>${escapeHtml(row.province)}</strong><div class="helper-text">${fmtInt(row.n)} comuni nel filtro</div></div>
        <span class="pill muted">${typeof row.avgMetric === 'number' ? fmtPct(row.avgMetric) + ' pt' : escapeHtml(row.topLeader)}</span>
      </div>
      <div class="province-metrics">
        <div class="mini"><span class="k">Affluenza media</span><strong>${row.avgTurnout != null ? fmtPct(row.avgTurnout) + '%' : '—'}</strong></div>
        <div class="mini"><span class="k">Quota attiva media</span><strong>${row.avgPartyShare != null ? fmtPct(row.avgPartyShare) + '%' : '—'}</strong></div>
        <div class="mini"><span class="k">Copertura</span><strong>${row.completenessRate != null ? fmtPct(row.completenessRate) + '%' : '—'}</strong></div>
      </div>
      <div class="province-actions">
        <button type="button" data-province-focus="${escapeHtml(row.province)}">Filtra solo questa</button>
        <button type="button" data-province-toggle="${escapeHtml(row.province)}">${state.selectedProvinceSet.has(row.province) ? 'Rimuovi filtro' : 'Aggiungi filtro'}</button>
      </div>
    </div>`).join('')}</div>`;

  [...els.provinceInsights.querySelectorAll('[data-province-focus]')].forEach(btn => btn.addEventListener('click', () => {
    state.selectedProvinceSet = new Set([btn.dataset.provinceFocus]);
    setupControls();
    readControls();
    requestRender();
  }));
  [...els.provinceInsights.querySelectorAll('[data-province-toggle]')].forEach(btn => btn.addEventListener('click', () => {
    const value = btn.dataset.provinceToggle;
    if (state.selectedProvinceSet.has(value)) state.selectedProvinceSet.delete(value);
    else state.selectedProvinceSet.add(value);
    setupControls();
    readControls();
    requestRender();
  }));
}

function renderHeatmap() {
  const svg = d3.select('#heatmap-chart');
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  const summary = els.heatmapSummary;
  if (!state.selectedMunicipalityId) {
    if (summary) summary.textContent = 'Seleziona un comune per attivare la heatmap.';
    svg.append('text').attr('x', 360).attr('y', 150).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Heatmap non disponibile');
    return;
  }
  const accessor = row => state.selectedPartyMode === 'party_std' ? row.party_std : state.selectedPartyMode === 'party_family' ? row.party_family : row.bloc;
  const rows = state.resultsLong
    .filter(r => r.municipality_id === state.selectedMunicipalityId)
    .filter(r => !state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode);
  if (!rows.length) {
    if (summary) summary.textContent = 'Nessun risultato partitico disponibile per il comune selezionato.';
    svg.append('text').attr('x', 360).attr('y', 150).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Nessun dato per la heatmap');
    return;
  }
  const years = uniqueSorted(rows.map(r => r.election_year)).map(Number).sort((a,b)=>a-b);
  const groupTotals = d3.rollups(rows, v => d3.sum(v, d => d.vote_share || 0), accessor).sort((a,b)=>b[1]-a[1]);
  let groups = groupTotals.slice(0, 8).map(d => d[0]);
  if (state.selectedParty && !groups.includes(state.selectedParty)) groups = [state.selectedParty, ...groups].slice(0, 8);
  const matrix = [];
  for (const g of groups) {
    for (const year of years) {
      const value = d3.sum(rows.filter(r => accessor(r) === g && r.election_year === year), r => r.vote_share || 0) || 0;
      matrix.push({ group: g, year, value });
    }
  }
  if (summary) summary.textContent = `${municipalityLabelById(state.selectedMunicipalityId)} · ${state.selectedPartyMode} · ${groups.length} gruppi mostrati`;
  const width = 720, height = 320, margin = { top: 20, right: 20, bottom: 46, left: 160 };
  const x = d3.scaleBand().domain(years).range([margin.left, width - margin.right]).padding(0.05);
  const y = d3.scaleBand().domain(groups).range([margin.top, height - margin.bottom]).padding(0.06);
  const max = d3.max(matrix, d => d.value) || 1;
  const color = d3.scaleSequential(state.selectedPalette === 'accessible' ? d3.interpolateCividis : d3.interpolateYlGnBu).domain([0, max]);
  svg.selectAll('rect.heatmap-cell')
    .data(matrix)
    .join('rect')
    .attr('class', 'heatmap-cell')
    .attr('x', d => x(d.year))
    .attr('y', d => y(d.group))
    .attr('width', x.bandwidth())
    .attr('height', y.bandwidth())
    .attr('rx', 4)
    .attr('fill', d => color(d.value))
    .append('title')
    .text(d => `${d.group} · ${d.year}: ${fmtPct(d.value)}%`);
  svg.append('g').attr('class', 'heatmap-axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format('d')));
  const yAxis = svg.append('g').attr('class', 'heatmap-axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y));
  yAxis.selectAll('text').attr('class', d => d === state.selectedParty ? 'heatmap-highlight' : null);
  const legendWidth = 180;
  const legendX = width - margin.right - legendWidth;
  const defs = svg.append('defs');
  const gradient = defs.append('linearGradient').attr('id', 'heatmap-gradient');
  gradient.append('stop').attr('offset', '0%').attr('stop-color', color(0));
  gradient.append('stop').attr('offset', '100%').attr('stop-color', color(max));
  svg.append('rect').attr('x', legendX).attr('y', height - 24).attr('width', legendWidth).attr('height', 10).attr('rx', 999).attr('fill', 'url(#heatmap-gradient)');
  svg.append('text').attr('x', legendX).attr('y', height - 28).attr('fill', '#94a3b8').style('font-size', '11px').text('0');
  svg.append('text').attr('x', legendX + legendWidth).attr('y', height - 28).attr('text-anchor', 'end').attr('fill', '#94a3b8').style('font-size', '11px').text(`${fmtPct(max)}%`);
}



function renderSimilarityPanel() {
  if (!els.similarityPanelContent || !els.similaritySummary) return;
  if (!state.selectedMunicipalityId) {
    els.similaritySummary.textContent = "Seleziona un comune per attivare l'analisi di similarità.";
    els.similarityPanelContent.innerHTML = '<div class="empty-state">Qui compariranno comuni vicini per traiettoria, un cluster euristico leggibile e scorciatoie per aprirli o aggiungerli al comparatore.</div>';
    return;
  }
  const bundle = similarityBundle(state.selectedMunicipalityId, 6);
  const selectedRow = getSummaryRow(state, state.selectedElection, state.selectedMunicipalityId);
  els.similaritySummary.textContent = `${municipalityLabelById(state.selectedMunicipalityId)} · ${bundle.targetCount} punti temporali utili · cluster: ${bundle.cluster}`;
  const renderList = (title, rows, emptyLabel) => `
    <div class="similarity-card">
      <h3>${title}</h3>
      ${rows.length ? `<div class="similarity-list">${rows.map(row => `
        <div class="similarity-item">
          <div>
            <button type="button" class="link-btn" data-sim-mid="${escapeHtml(row.municipality_id)}">${escapeHtml(row.label)}</button>
            <div class="similarity-meta">${row.cluster}${row.shareNow != null ? ` · quota attiva ${fmtPct(row.shareNow)}%` : ''}${row.turnoutNow != null ? ` · affluenza ${fmtPct(row.turnoutNow)}%` : ''}</div>
          </div>
          <div class="similarity-score">${fmtPct(row.score)}</div>
        </div>`).join('')}</div>` : `<div class="helper-text">${emptyLabel}</div>`}
    </div>`;
  const targetVol = computeVolatility(state, state.selectedMunicipalityId);
  const targetChanges = computeDominanceChanges(state, state.selectedMunicipalityId);
  els.similarityPanelContent.innerHTML = `
    <div class="similarity-grid">
      <div class="cluster-card">
        <div class="cluster-badge">Cluster euristico · ${escapeHtml(bundle.cluster)}</div>
        <div class="cluster-grid">
          <div class="cluster-metric"><span class="k">Quota attiva oggi</span><strong>${selectedRow ? (aggregateShareFor(state, state.selectedElection, state.selectedMunicipalityId, state.selectedParty) != null ? fmtPct(aggregateShareFor(state, state.selectedElection, state.selectedMunicipalityId, state.selectedParty)) + '%' : '—') : '—'}</strong></div>
          <div class="cluster-metric"><span class="k">Affluenza oggi</span><strong>${selectedRow?.turnout_pct != null ? fmtPct(selectedRow.turnout_pct) + '%' : '—'}</strong></div>
          <div class="cluster-metric"><span class="k">Volatilità</span><strong>${targetVol != null ? fmtPct(targetVol) + ' pt' : '—'}</strong></div>
          <div class="cluster-metric"><span class="k">Cambi dominanza</span><strong>${fmtInt(targetChanges)}</strong></div>
        </div>
        <div class="helper-text" style="margin-top:10px">Metodo leggero ma utile: confronta la serie temporale della quota attiva, l'affluenza e i cambi di leadership. Feature esplorativa: utile per orientarsi, non una clusterizzazione robusta da paper.</div>
      </div>
      ${renderList('Comuni più simili', bundle.nearest, 'Nessun comune sufficientemente comparabile nel filtro corrente.')}
      ${renderList('Stesso cluster euristico', bundle.sameCluster, 'Nessun altro comune del filtro cade nello stesso cluster euristico.')}
    </div>`;
  [...els.similarityPanelContent.querySelectorAll('[data-sim-mid]')].forEach(btn => btn.addEventListener('click', () => {
    selectMunicipality(btn.dataset.simMid, { updateSearch: true });
    requestRender();
  }));
}

function renderProvinceSmallMultiples() {
  if (!els.provinceSmallMultiples) return;
  const allRows = state.summary.filter(row => !state.territorialMode || !row.territorial_mode || row.territorial_mode === state.territorialMode);
  const provinces = uniqueSorted(allRows.map(r => r.province || '—'));
  if (!provinces.length) {
    els.provinceSmallMultiples.innerHTML = '<div class="empty-state">Small multiples non disponibili senza province o serie temporali.</div>';
    return;
  }
  const provinceMetrics = provinces.map(province => {
    const rows = allRows.filter(r => (r.province || '—') === province);
    const years = uniqueSorted(rows.map(r => Number(r.election_year))).map(Number).sort((a,b)=>a-b);
    const values = years.map(year => {
      const yearRows = rows.filter(r => Number(r.election_year) === year);
      let value = null;
      if (state.selectedMetric === 'party_share' || state.selectedMetric === 'swing_compare') {
        const current = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${yearRows[0]?.election_key || ''}__${province}__${state.selectedParty}`) ?? null;
        if (state.selectedMetric === 'party_share') value = current;
        else {
          const compare = state.compareElection ? state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${state.compareElection}__${province}__${state.selectedParty}`) : null;
          value = current != null && compare != null ? current - compare : null;
        }
      } else if (state.selectedMetric === 'turnout') value = mean(yearRows.map(r => r.turnout_pct));
      else if (state.selectedMetric === 'margin') value = mean(yearRows.map(r => r.first_second_margin));
      else if (state.selectedMetric === 'over_performance_province') value = 0;
      else if (state.selectedMetric === 'over_performance_region') {
        const current = state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${yearRows[0]?.election_key}__${province}__${state.selectedParty}`);
        const region = state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${yearRows[0]?.election_key}__${state.selectedParty}`);
        value = current != null && region != null ? current - region : null;
      }
      else if (state.selectedMetric === 'stability_index') value = mean(yearRows.map(r => computeStabilityIndex(state, r.municipality_id)));
      else if (state.selectedMetric === 'delta_turnout') {
        const current = mean(yearRows.map(r => r.turnout_pct));
        const compareRows = state.summary.filter(r => r.election_key === state.compareElection && (r.province || '—') === province && (!state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode));
        const compare = mean(compareRows.map(r => r.turnout_pct));
        value = current != null && compare != null ? current - compare : null;
      } else if (state.selectedMetric === 'dominant_block') {
        value = d3.rollups(yearRows.map(r => r.dominant_block || inferPartyMeta(r.first_party_std).bloc), v => v.length, d => d).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
      } else if (state.selectedMetric === 'first_party') {
        value = d3.rollups(yearRows.map(r => r.first_party_std).filter(Boolean), v => v.length, d => d).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
      } else {
        value = mean(yearRows.map(r => getMetricValue(state, r)).filter(v => typeof v === 'number'));
      }
      return { year, value };
    });
    return { province, years, values, selected: state.selectedProvinceSet.has(province) };
  });
  const sorted = provinceMetrics.sort((a,b) => String(a.province).localeCompare(String(b.province), 'it'));
  els.provinceSmallMultiples.innerHTML = `<div class="small-multiple-grid">${sorted.map((p, idx) => `
    <div class="small-multiple-card ${p.selected ? 'is-selected' : ''}">
      <div class="small-multiple-head">
        <div><strong>${escapeHtml(p.province)}</strong><div class="meta">${metricLabel()}</div></div>
        <span class="pill muted">${typeof p.values[p.values.length - 1]?.value === 'number' ? metricDisplay(p.values[p.values.length - 1].value) : escapeHtml(p.values[p.values.length - 1]?.value || '—')}</span>
      </div>
      <svg class="sparkline-svg" id="sparkline-${idx}" viewBox="0 0 220 84"></svg>
      <div class="small-multiple-actions">
        <button type="button" data-sm-focus="${escapeHtml(p.province)}">Solo questa</button>
        <button type="button" data-sm-toggle="${escapeHtml(p.province)}">${p.selected ? 'Rimuovi filtro' : 'Aggiungi filtro'}</button>
      </div>
    </div>`).join('')}</div>`;
  sorted.forEach((p, idx) => {
    const svg = d3.select(`#sparkline-${idx}`);
    const numericValues = p.values.filter(d => typeof d.value === 'number' && Number.isFinite(d.value));
    if (!numericValues.length) {
      svg.append('text').attr('x', 110).attr('y', 44).attr('text-anchor', 'middle').attr('fill', '#94a3b8').style('font-size', '11px').text('n/d');
      return;
    }
    const margin = { top: 8, right: 8, bottom: 14, left: 8 };
    const x = d3.scaleLinear().domain(d3.extent(numericValues, d => d.year)).range([margin.left, 220 - margin.right]);
    const y = d3.scaleLinear().domain(d3.extent(numericValues, d => d.value)).nice().range([84 - margin.bottom, margin.top]);
    const line = d3.line().x(d => x(d.year)).y(d => y(d.value));
    svg.append('path').datum(numericValues).attr('fill', 'none').attr('stroke', '#60a5fa').attr('stroke-width', 2).attr('d', line);
    svg.append('circle').attr('cx', x(numericValues[numericValues.length - 1].year)).attr('cy', y(numericValues[numericValues.length - 1].value)).attr('r', 3.6).attr('fill', '#22c55e');
    svg.append('text').attr('x', margin.left).attr('y', 80).attr('fill', '#64748b').style('font-size', '10px').text(numericValues[0].year);
    svg.append('text').attr('x', 220 - margin.right).attr('y', 80).attr('text-anchor', 'end').attr('fill', '#64748b').style('font-size', '10px').text(numericValues[numericValues.length - 1].year);
  });
  [...els.provinceSmallMultiples.querySelectorAll('[data-sm-focus]')].forEach(btn => btn.addEventListener('click', () => {
    state.selectedProvinceSet = new Set([btn.dataset.smFocus]);
    setupControls();
    readControls();
    requestRender();
  }));
  [...els.provinceSmallMultiples.querySelectorAll('[data-sm-toggle]')].forEach(btn => btn.addEventListener('click', () => {
    const province = btn.dataset.smToggle;
    if (state.selectedProvinceSet.has(province)) state.selectedProvinceSet.delete(province);
    else state.selectedProvinceSet.add(province);
    setupControls();
    readControls();
    requestRender();
  }));
}

function enableMapZoom() {
  if (els.mapCanvas && state.mapCanvasRender) {
    const canvas = d3.select(els.mapCanvas);
    if (!state.mapCanvasZoomBehavior) {
      state.mapCanvasZoomBehavior = d3.zoom()
        .scaleExtent([1, MAP_MAX_ZOOM])
        .on('zoom', event => {
          drawCanvasMapSoon(event.transform);
          ensureDetailGeometryForCurrentFocus(event.transform);
        });
      canvas.call(state.mapCanvasZoomBehavior);
    }
    state.mapZoomBehavior = state.mapCanvasZoomBehavior;
    state.mapZoomTarget = 'canvas';
    return;
  }
  const svg = d3.select('#map-svg');
  const base = svg.select('g.map-zoom-layer');
  if (base.empty()) return;
  const zoom = d3.zoom().scaleExtent([1, MAP_MAX_ZOOM]).on('zoom', (event) => {
    base.attr('transform', event.transform);
    ensureDetailGeometryForCurrentFocus(event.transform);
  });
  svg.call(zoom);
  state.mapZoomBehavior = zoom;
  state.mapZoomTarget = 'svg';
}

function resetMapZoom() {
  if (!state.mapZoomBehavior) return;
  if (state.mapZoomTarget === 'canvas' && els.mapCanvas) {
    d3.select(els.mapCanvas).transition().duration(180).call(state.mapZoomBehavior.transform, d3.zoomIdentity);
    return;
  }
  d3.select('#map-svg').transition().duration(250).call(state.mapZoomBehavior.transform, d3.zoomIdentity);
}

function zoomToSelectedMunicipality(options = {}) {
  if (!state.mapZoomBehavior || !state.selectedMunicipalityId || !state.geometry?.features?.length) return;
  const row = getSummaryRow(state, state.selectedElection, state.selectedMunicipalityId)
    || state.mapReadyRows.find(d => d.election_key === state.selectedElection && d.municipality_id === state.selectedMunicipalityId)
    || state.summary.find(d => d.municipality_id === state.selectedMunicipalityId)
    || state.municipalities.find(d => d.municipality_id === state.selectedMunicipalityId);
  if (!row) return;
  let bounds = null;
  if (state.mapZoomTarget === 'canvas' && state.mapCanvasRender?.cache?.items?.length) {
    const key = rowJoinKey(row);
    bounds = state.mapCanvasRender.cache.itemsByKey?.get(key)?.bounds || null;
  } else {
    const feature = activeMunicipalityFeatures().find(f => geometryJoinKey(f) === rowJoinKey(row));
    if (!feature) return;
    const path = d3.geoPath(makeGeoProjection(state.geometry, 960, 680));
    bounds = path.bounds(feature);
  }
  if (!bounds) return;
  const [[x0, y0], [x1, y1]] = bounds;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return;
  const width = 960;
  const height = 680;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  const scale = Math.max(1, Math.min(MAP_MAX_ZOOM, 0.8 / Math.max(dx / width, dy / height)));
  const transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-x, -y);
  const duration = options.duration ?? (state.detailGeometryKey ? 180 : 220);
  if (state.mapZoomTarget === 'canvas' && els.mapCanvas) {
    d3.select(els.mapCanvas).transition().duration(duration).call(state.mapZoomBehavior.transform, transform);
    return;
  }
  d3.select('#map-svg').transition().duration(options.duration ?? 350).call(state.mapZoomBehavior.transform, transform);
}

function serializeSvgToPng(svgNode, filename = 'chart.png') {
  if (!svgNode) return;
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svgNode);
  const viewBox = svgNode.viewBox?.baseVal || { width: svgNode.clientWidth || 800, height: svgNode.clientHeight || 400 };
  const width = Math.max(10, viewBox.width || svgNode.clientWidth || 800);
  const height = Math.max(10, viewBox.height || svgNode.clientHeight || 400);
  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      const pngUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(pngUrl);
    });
  };
  img.src = url;
}

function downloadCanvasAsPng(canvas, filename = 'map.png') {
  if (!canvas) return;
  canvas.toBlob(blob => {
    if (!blob) return;
    const pngUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(pngUrl);
  });
}

function exportCSV(rows, filename = 'filtered_table.csv') {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(data, filename = 'payload.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function currentViewState() {
  return {
    selectedElection: state.selectedElection,
    compareElection: state.compareElection,
    selectedMetric: state.selectedMetric,
    selectedPartyMode: state.selectedPartyMode,
    selectedParty: state.selectedParty,
    selectedCustomIndicator: state.selectedCustomIndicator,
    territorialMode: state.territorialMode,
    geometryReferenceYear: state.geometryReferenceYear,
    selectedProvinces: [...state.selectedProvinceSet],
    selectedMunicipalityId: state.selectedMunicipalityId,
    compareMunicipalityIds: state.compareMunicipalityIds,
    selectedCompleteness: state.selectedCompleteness,
    selectedTerritorialStatus: state.selectedTerritorialStatus,
    sameScaleAcrossYears: state.sameScaleAcrossYears,
    selectedPalette: state.selectedPalette,
    minSharePct: state.minSharePct,
    tableSort: state.tableSort,
    tablePage: state.tablePage,
    showNotes: state.showNotes,
    trajectoryMode: state.trajectoryMode,
    swipePosition: state.swipePosition,
    selectedAreaPreset: state.selectedAreaPreset,
    focusMode: state.focusMode,
    analysisMode: state.analysisMode,
    uiDensity: state.uiDensity,
    visionMode: state.visionMode,
    uiLevel: state.uiLevel,
    audienceMode: state.audienceMode
  };
}

function syncURLState() {
  const params = new URLSearchParams();
  const view = currentViewState();
  Object.entries(view).forEach(([key, value]) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    params.set(key, Array.isArray(value) ? value.join('|') : String(value));
  });
  history.replaceState(null, '', `${location.pathname}#${params.toString()}`);
  saveLocalState();
}

function restoreURLState() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(raw);
  if (!raw) return;
  state.selectedElection = params.get('selectedElection') || state.selectedElection;
  state.compareElection = params.get('compareElection') || state.compareElection;
  state.selectedMetric = params.get('selectedMetric') || state.selectedMetric;
  state.selectedPartyMode = params.get('selectedPartyMode') || state.selectedPartyMode;
  state.selectedParty = params.get('selectedParty') || state.selectedParty;
  state.selectedCustomIndicator = params.get('selectedCustomIndicator') || state.selectedCustomIndicator;
  state.territorialMode = params.get('territorialMode') || state.territorialMode;
  state.geometryReferenceYear = params.get('geometryReferenceYear') || state.geometryReferenceYear;
  state.selectedMunicipalityId = params.get('selectedMunicipalityId') || state.selectedMunicipalityId;
  state.selectedCompleteness = params.get('selectedCompleteness') || state.selectedCompleteness;
  state.selectedTerritorialStatus = params.get('selectedTerritorialStatus') || state.selectedTerritorialStatus;
  state.sameScaleAcrossYears = params.get('sameScaleAcrossYears') !== 'false';
  const compareMunicipalityIds = params.get('compareMunicipalityIds');
  if (compareMunicipalityIds) state.compareMunicipalityIds = compareMunicipalityIds.split('|').filter(Boolean).slice(0,4);
  state.selectedPalette = params.get('selectedPalette') || state.selectedPalette;
  state.minSharePct = safeNumber(params.get('minSharePct')) || state.minSharePct;
  state.tableSort = params.get('tableSort') || state.tableSort;
  state.tablePage = safeNumber(params.get('tablePage')) || state.tablePage;
  state.showNotes = params.get('showNotes') !== 'false';
  state.trajectoryMode = params.get('trajectoryMode') || state.trajectoryMode;
  state.swipePosition = safeNumber(params.get('swipePosition')) ?? state.swipePosition;
  state.selectedAreaPreset = params.get('selectedAreaPreset') || state.selectedAreaPreset;
  state.focusMode = params.get('focusMode') === 'true' ? true : state.focusMode;
  state.analysisMode = params.get('analysisMode') || state.analysisMode;
  state.uiDensity = params.get('uiDensity') || state.uiDensity;
  state.visionMode = params.get('visionMode') || state.visionMode;
  state.uiLevel = params.get('uiLevel') || state.uiLevel;
  state.audienceMode = params.get('audienceMode') || state.audienceMode;
  const provinces = params.get('selectedProvinces');
  if (provinces) state.selectedProvinceSet = new Set(provinces.split('|').filter(Boolean));
}

async function copyPermalink() {
  syncURLState();
  try {
    await navigator.clipboard.writeText(location.href);
    els.copyLinkBtn.textContent = 'Link copiato';
    showToast('Permalink copiato negli appunti.');
    setTimeout(() => { els.copyLinkBtn.textContent = 'Copia permalink'; }, 1500);
  } catch {
    els.copyLinkBtn.textContent = 'Copia fallita';
    showToast('Impossibile copiare il permalink in questo contesto.', 'warning');
    setTimeout(() => { els.copyLinkBtn.textContent = 'Copia permalink'; }, 1500);
  }
}

function handleMunicipalitySearch() {
  const query = (els.municipalitySearch.value || '').trim().toLowerCase();
  if (!query) return;
  const municipalityNameFields = d => [d.label, d.name_current, d.municipality_name, d.name_historical, ...String(d.alias_names || '').split('|')]
    .filter(Boolean)
    .map(value => String(value).toLowerCase());
  const foundMunicipality = state.municipalities.find(d => municipalityNameFields(d).some(value => value === query))
    || state.municipalities.find(d => municipalityNameFields(d).some(value => value.startsWith(query)))
    || state.municipalities.find(d => municipalityNameFields(d).some(value => value.includes(query)));
  const foundAlias = state.aliases.find(d => `${d.alias || ''} ${d.alias_type || ''}`.toLowerCase().includes(query));
  const foundSummary = state.summary.find(d => String(d.municipality_name || '').toLowerCase().includes(query));
  const selectedId = foundMunicipality?.municipality_id || foundAlias?.municipality_id || foundSummary?.municipality_id;
  if (selectedId) {
    selectMunicipality(selectedId, { updateSearch: false });
    requestRender();
  }
}

function resetFilters() {
  state.selectedMetric = 'turnout';
  state.selectedPartyMode = 'party_std';
  state.selectedProvinceSet = new Set();
  state.selectedAreaPreset = 'all';
  state.territorialMode = 'historical';
  state.selectedCompleteness = 'all';
  state.selectedTerritorialStatus = 'all';
  state.sameScaleAcrossYears = true;
  state.selectedPalette = 'auto';
  state.minSharePct = 0;
  state.tableSort = 'municipality_asc';
  state.showNotes = true;
  state.selectedMunicipalityId = null;
  state.compareMunicipalityIds = [];
  hideTooltip(true);
  state.tablePage = 1;
  invalidateDerivedCaches();
  stopTimelinePlayback();
  setupControls();
  readControls();
  updateBodyAppearance();
  requestRender();
}

function bindEvents() {
  const loadDeferredMetadataFromPanel = ({ silent = false } = {}) => ensureDeferredMetadata({ silent });
  [els.advancedControls, els.secondaryTools].filter(Boolean).forEach(panel => {
    panel.addEventListener('toggle', () => {
      if (panel.open) loadDeferredMetadataFromPanel({ silent: false });
    });
  });
  document.addEventListener('dashboard-view-change', event => {
    if (['method', 'analysis', 'profile'].includes(event.detail?.view)) loadDeferredMetadataFromPanel({ silent: false });
  });
  [els.electionSelect, els.compareElectionSelect, els.provinceSelect, els.areaPresetSelect, els.metricSelect, els.partySelect, els.customIndicatorSelect, els.partyModeSelect, els.territorialModeSelect, els.completenessSelect, els.territorialStatusSelect, els.sameScaleCheckbox, els.paletteSelect, els.tableSortSelect, els.showNotesCheckbox, els.trajectoryModeSelect, els.densitySelect, els.visionModeSelect].filter(Boolean).forEach(el => {
    el.addEventListener('change', () => {
      const shouldRefreshPartyOptions = el === els.electionSelect || el === els.metricSelect || el === els.partyModeSelect;
      const shouldClearMapInfo = [els.electionSelect, els.compareElectionSelect, els.metricSelect, els.partySelect, els.partyModeSelect].includes(el);
      const affectsMap = [els.electionSelect, els.compareElectionSelect, els.provinceSelect, els.areaPresetSelect, els.metricSelect, els.partySelect, els.customIndicatorSelect, els.partyModeSelect, els.territorialModeSelect, els.completenessSelect, els.territorialStatusSelect, els.sameScaleCheckbox, els.paletteSelect].includes(el);
      if (el === els.areaPresetSelect) {
        const available = [...els.provinceSelect.options].map(o => o.value);
        const selected = provinceValuesForPreset(els.areaPresetSelect.value, available);
        [...els.provinceSelect.options].forEach(opt => { opt.selected = els.areaPresetSelect.value === 'all' ? false : selected.includes(opt.value); });
      }
      if (el === els.provinceSelect) {
        const selected = [...els.provinceSelect.selectedOptions].map(o => o.value);
        const available = [...els.provinceSelect.options].map(o => o.value);
        const matched = AREA_PRESETS.find(p => p.value !== 'all' && p.value !== 'custom' && JSON.stringify(provinceValuesForPreset(p.value, available).sort()) === JSON.stringify(selected.slice().sort()));
        if (els.areaPresetSelect) els.areaPresetSelect.value = matched ? matched.value : (selected.length ? 'custom' : 'all');
      }
      invalidateDerivedCaches();
      state.tablePage = 1;
      readControls({ refreshMap: !affectsMap });
      updateBodyAppearance();
      if (shouldClearMapInfo) hideTooltip(true);
      if (shouldRefreshPartyOptions) {
        refreshPartySelector();
        syncURLState();
      }
      if (affectsMap) refreshMapContinuously(el);
      else requestRender();
    });
  });

  els.minShareInput.addEventListener('input', () => { state.tablePage = 1; readControls({ refreshMap: false }); refreshMapContinuously(els.minShareInput, { disableControl: false }); });
  els.swipePosition?.addEventListener('input', () => { readControls(); renderSwipeMap(); syncURLState(); });
  els.electionSlider.addEventListener('input', () => {
    const idx = Number(els.electionSlider.value || 0);
    const label = (state.electionLabels || [])[idx];
    if (!label) return;
    state.selectedElection = label.value;
    els.electionSelect.value = label.value;
    updateElectionSlider();
    state.tablePage = 1;
    readControls({ refreshMap: false });
    if (state.selectedMetric === 'party_share') {
      refreshPartySelector();
      syncURLState();
    }
    refreshMapContinuously(els.electionSlider, { disableControl: false });
  });
  els.prevElectionBtn.addEventListener('click', () => stepElection(-1));
  els.nextElectionBtn.addEventListener('click', () => stepElection(1));
  els.playTimelineBtn?.addEventListener('click', toggleTimelinePlayback);
  els.swapElectionsBtn?.addEventListener('click', swapSelectedElections);
  els.mapFullscreenBtn?.addEventListener('click', toggleMapFullscreen);
  els.focusModeBtn?.addEventListener('click', () => { toggleFocusMode(); requestRender(); });
  els.uiLevelBasicBtn?.addEventListener('click', () => setUILevel('basic'));
  els.uiLevelAdvancedBtn?.addEventListener('click', () => setUILevel('advanced'));
  els.commandPaletteBtn?.addEventListener('click', openCommandPalette);
  els.commandCloseBtn?.addEventListener('click', closeCommandPalette);
  q('command-palette')?.addEventListener('click', event => { if (event.target?.dataset?.closeCommand === 'true') closeCommandPalette(); });
  els.commandInput?.addEventListener('input', () => { state.commandPaletteIndex = 0; renderCommandPalette(); });
  els.commandInput?.addEventListener('keydown', event => {
    const entries = commandEntries(els.commandInput?.value || '');
    if (event.key === 'ArrowDown') { event.preventDefault(); state.commandPaletteIndex = Math.min(entries.length - 1, (state.commandPaletteIndex || 0) + 1); renderCommandPalette(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); state.commandPaletteIndex = Math.max(0, (state.commandPaletteIndex || 0) - 1); renderCommandPalette(); }
    if (event.key === 'Enter') { event.preventDefault(); entries[state.commandPaletteIndex]?.action?.(); }
    if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); }
  });
  els.mapResetBtn.addEventListener('click', resetMapZoom);
  els.bookmarkMunicipalityBtn.addEventListener('click', () => toggleCompareMunicipality(state.selectedMunicipalityId));
  els.pinMunicipalityBtn?.addEventListener('click', () => {
    toggleBookmarkMunicipality(state.selectedMunicipalityId);
    requestRender();
  });
  els.backToMapBtn?.addEventListener('click', returnToSelectedMap);
  els.clearCompareBtn.addEventListener('click', () => { state.compareMunicipalityIds = []; syncURLState(); requestRender(); });
  els.historyBackBtn?.addEventListener('click', undoView);
  els.historyForwardBtn?.addEventListener('click', redoView);
  els.helpBtn?.addEventListener('click', openOnboarding);
  els.loadLocalBundleBtn?.addEventListener('click', () => els.localBundleInput?.click());
  els.localBundleInput?.addEventListener('change', async () => { if (els.localBundleInput.files?.length) await activateLocalBundle(els.localBundleInput.files); });
  els.resetEmbeddedBundleBtn?.addEventListener('click', () => location.reload());
  els.onboardingCloseBtn?.addEventListener('click', closeOnboarding);
  els.onboardingDismissBtn?.addEventListener('click', dismissOnboarding);
  els.onboardingStartTrajectoryBtn?.addEventListener('click', () => { applyAnalysisMode('trajectory'); closeOnboarding(); });
  els.onboardingStartCompareBtn?.addEventListener('click', () => { applyAnalysisMode('compare'); closeOnboarding(); });
  document.querySelectorAll('[data-close-onboarding]').forEach(node => node.addEventListener('click', closeOnboarding));
  document.querySelectorAll('[data-jump-target]').forEach(btn => btn.addEventListener('click', () => q(btn.dataset.jumpTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  els.copyHeroPythonBtn?.addEventListener('click', () => copyTextToClipboard(buildProgrammaticSnippet('python'), 'Snippet Python copiato.'));
  els.copyReleasePythonBtn?.addEventListener('click', () => copyTextToClipboard(buildProgrammaticSnippet('python'), 'Snippet Python copiato.'));
  els.copyCitationBtn?.addEventListener('click', () => copyTextToClipboard(buildProjectCitation(), 'Citazione progetto copiata.'));
  els.selectionDockOpenBtn?.addEventListener('click', () => q('municipality-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  els.selectionDockCompareBtn?.addEventListener('click', () => q('comparison-panel-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  els.selectionDockClearBtn?.addEventListener('click', () => { state.selectedMunicipalityId = null; state.compareMunicipalityIds = []; hideTooltip(true); syncURLState(); requestRender(); });
  const debouncedMunicipalitySearch = debounce(() => handleMunicipalitySearch(), 140);
  const debouncedTableFilter = debounce(() => { state.tablePage = 1; renderTable(); }, 120);
  els.municipalitySearch.addEventListener('change', handleMunicipalitySearch);
  els.municipalitySearch.addEventListener('input', debouncedMunicipalitySearch);
  els.tableFilter.addEventListener('input', debouncedTableFilter);
  els.tablePrevBtn?.addEventListener('click', () => { state.tablePage = Math.max(1, (state.tablePage || 1) - 1); renderTable(); syncURLState(); });
  els.tableNextBtn?.addEventListener('click', () => { state.tablePage = (state.tablePage || 1) + 1; renderTable(); syncURLState(); });
  els.exportTableBtn.addEventListener('click', () => { exportCSV(state.filteredRows, `table_${state.selectedElection || 'all'}.csv`); showToast('CSV della tabella esportato.'); });
  els.exportMunicipalityBtn.addEventListener('click', () => {
    if (!state.selectedMunicipalityId) return;
    const payload = {
      municipality: selectedMunicipalityRecord(),
      summary: state.summary.filter(d => d.municipality_id === state.selectedMunicipalityId),
      results: state.resultsLong.filter(d => d.municipality_id === state.selectedMunicipalityId),
      lineage: lineageRecord(),
      similarity: state.selectedMunicipalityId ? similarityBundle(state.selectedMunicipalityId, 8) : null,
      light_cluster: state.selectedMunicipalityId ? lightClusterLabel(state.selectedMunicipalityId) : null,
      local_note: state.selectedMunicipalityId ? municipalityNoteRecord(state.selectedMunicipalityId) : null,
      view_state: currentViewState()
    };
    exportJSON(payload, `${state.selectedMunicipalityId}.json`);
    showToast('Profilo comune esportato in JSON.');
  });
  els.exportStateBtn.addEventListener('click', () => { exportJSON({ view: currentViewState(), filtered_rows: state.filteredRows }, `view_${state.selectedElection || 'all'}.json`); showToast('Vista corrente esportata in JSON.'); });
  els.exportMapPngBtn?.addEventListener('click', () => {
    if (els.mapCanvas && state.mapCanvasRender) downloadCanvasAsPng(els.mapCanvas, `map_${state.selectedElection || 'all'}.png`);
    else serializeSvgToPng(q('map-svg'), `map_${state.selectedElection || 'all'}.png`);
    showToast('Snapshot mappa avviato.');
  });
  els.exportTimelinePngBtn?.addEventListener('click', () => { serializeSvgToPng(q('timeline-chart'), `timeline_${state.selectedMunicipalityId || 'none'}.png`); showToast('Snapshot timeline avviato.'); });
  els.exportHeatmapPngBtn?.addEventListener('click', () => { serializeSvgToPng(q('heatmap-chart'), `heatmap_${state.selectedMunicipalityId || 'none'}.png`); showToast('Snapshot heatmap avviato.'); });
  els.exportAuditBtn?.addEventListener('click', () => { exportJSON(auditPayload(), `audit_${state.selectedElection || 'all'}.json`); showToast('Audit esportato.'); });
  els.exportReportHtmlBtn?.addEventListener('click', exportMunicipalityReportHtml);
  els.printReportBtn?.addEventListener('click', printMunicipalityReport);
  els.saveNoteBtn?.addEventListener('click', saveCurrentMunicipalityNote);
  els.clearNoteBtn?.addEventListener('click', clearCurrentMunicipalityNote);
  [...document.querySelectorAll('[data-preset-metric]')].forEach(btn => btn.addEventListener('click', () => {
    state.selectedMetric = btn.dataset.presetMetric || state.selectedMetric;
    if (btn.dataset.presetMode) state.selectedPartyMode = btn.dataset.presetMode;
    if (btn.dataset.presetPalette) state.selectedPalette = btn.dataset.presetPalette;
    state.tablePage = 1;
    state.similarityCache = {};
    setupControls();
    readControls();
    updateBodyAppearance();
    requestRender();
  }));
  els.copyLinkBtn.addEventListener('click', copyPermalink);
  els.saveViewBtn?.addEventListener('click', saveCurrentViewSnapshot);
  [...document.querySelectorAll('[data-analysis-mode]')].forEach(btn => btn.addEventListener('click', () => applyAnalysisMode(btn.dataset.analysisMode)));
  els.resetBtn.addEventListener('click', resetFilters);

  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    document.body.classList.toggle('map-fullscreen-active', active);
    if (els.mapFullscreenBtn) els.mapFullscreenBtn.textContent = active ? 'Esci fullscreen' : 'Fullscreen';
  });
  document.addEventListener('keydown', event => {
    const targetTag = event.target?.tagName?.toLowerCase();
    const inInput = ['input', 'select', 'textarea'].includes(targetTag);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
      return;
    }
    if (event.key === '?' && !inInput) {
      event.preventDefault();
      openOnboarding();
      return;
    }
    if (event.key === '/' && !inInput) {
      event.preventDefault();
      els.municipalitySearch?.focus();
      return;
    }
    if (event.key === 'Escape' && !els.commandPalette?.classList.contains('hidden')) {
      closeCommandPalette();
      return;
    }
    if (inInput) return;
    if (event.key === '[') stepElection(-1);
    if (event.key === ']') stepElection(1);
    if (event.key === 'f' || event.key === 'F') { toggleFocusMode(); requestRender(); }
    if (event.key === 'Escape') {
      state.selectedMunicipalityId = null;
      hideTooltip(true);
      requestRender();
    }
    if ((event.key === 's' || event.key === 'S') && (event.altKey || event.shiftKey)) {
      event.preventDefault();
      saveCurrentViewSnapshot();
      return;
    }
    if ((event.key === 'b' || event.key === 'B') && state.selectedMunicipalityId) {
      toggleBookmarkMunicipality(state.selectedMunicipalityId);
      renderRecentMunicipalityPanel();
      showToast('Comune aggiunto o rimosso dai bookmark.');
    }
    if ((event.key === 'c' || event.key === 'C') && state.selectedMunicipalityId) {
      toggleCompareMunicipality(state.selectedMunicipalityId);
      showToast('Comune aggiornato nel comparatore.');
    }
  });
}


function computeLeaderRuns(profileRows) {
  const rows = (profileRows || []).filter(r => r.first_party_std).slice().sort((a,b)=>(a.election_year||0)-(b.election_year||0));
  const runs = [];
  rows.forEach(row => {
    const prev = runs.at(-1);
    if (!prev || prev.leader !== row.first_party_std) runs.push({ leader: row.first_party_std, from: row.election_year, to: row.election_year, elections: 1 });
    else { prev.to = row.election_year; prev.elections += 1; }
  });
  return runs;
}

function computeTrajectoryBreaks(profileRows) {
  const ordered = (profileRows || []).slice().sort((a,b)=>(a.election_year||0)-(b.election_year||0));
  return d3.pairs(ordered).map(([a,b]) => {
    const shareA = aggregateShareFor(state, a.election_key, a.municipality_id, state.selectedParty);
    const shareB = aggregateShareFor(state, b.election_key, b.municipality_id, state.selectedParty);
    return {
      from: a.election_year,
      to: b.election_year,
      leaderChanged: a.first_party_std && b.first_party_std && a.first_party_std !== b.first_party_std,
      deltaShare: shareA != null && shareB != null ? shareB - shareA : null,
      deltaTurnout: a.turnout_pct != null && b.turnout_pct != null ? b.turnout_pct - a.turnout_pct : null
    };
  }).filter(d => d.leaderChanged || Math.abs(d.deltaShare || 0) >= 4 || Math.abs(d.deltaTurnout || 0) >= 4)
    .sort((a,b)=>Math.max(Math.abs(b.deltaShare||0), Math.abs(b.deltaTurnout||0)) - Math.max(Math.abs(a.deltaShare||0), Math.abs(a.deltaTurnout||0)));
}

function renderTrajectoryReport(profileRows, currentRow, compareRow) {
  if (!els.trajectoryReport) return;
  if (!profileRows.length) { els.trajectoryReport.innerHTML = ''; return; }
  const runs = computeLeaderRuns(profileRows);
  const breaks = computeTrajectoryBreaks(profileRows).slice(0, 5);
  const meta = customIndicatorMeta(state.selectedCustomIndicator);
  const indicatorName = state.selectedMetric === 'custom_indicator' ? meta.label : (state.selectedParty || metricLabel());
  const html = `
    <div class="panel-header tight"><h3>Report traiettoria</h3><span class="helper-text">lettura strutturata delle fasi del comune</span></div>
    <div class="story-grid report-grid">
      <div class="story-card">
        <span class="story-kicker">Ere di dominanza</span>
        <div class="similarity-list">${runs.length ? runs.map(run => `<div class="similarity-item"><div><strong>${escapeHtml(run.leader)}</strong><div class="similarity-meta">${fmtInt(run.elections)} elezioni · ${escapeHtml(run.from)}–${escapeHtml(run.to)}</div></div><div class="similarity-score">${fmtInt(run.elections)}</div></div>`).join('') : '<div class="helper-text">Nessuna era leggibile</div>'}</div>
      </div>
      <div class="story-card">
        <span class="story-kicker">Rotture / salti</span>
        <div class="similarity-list">${breaks.length ? breaks.map(br => `<div class="similarity-item"><div><strong>${escapeHtml(br.from)} → ${escapeHtml(br.to)}</strong><div class="similarity-meta">${br.leaderChanged ? 'cambio leader · ' : ''}${br.deltaShare != null ? `${escapeHtml(indicatorName)} ${fmtPctSigned(br.deltaShare)} pt` : 'quota n/d'}${br.deltaTurnout != null ? ` · affluenza ${fmtPctSigned(br.deltaTurnout)} pt` : ''}</div></div></div>`).join('') : '<div class="helper-text">Nessuna rottura forte sulla serie disponibile</div>'}</div>
      </div>
    </div>`;
  els.trajectoryReport.innerHTML = html;
}

function renderContextCompareChart(profileRows, currentRow) {
  const svg = d3.select('#context-compare-chart');
  svg.selectAll('*').remove();
  const width = 620, height = 220, margin = { top: 22, right: 24, bottom: 30, left: 150 };
  if (!profileRows.length || !currentRow) {
    svg.append('text').attr('x', width/2).attr('y', height/2).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Confronto di contesto non disponibile');
    return;
  }
  const rows = [
    { label: 'Quota attiva · comune', value: aggregateShareFor(state, currentRow.election_key, currentRow.municipality_id, state.selectedParty), color: getGroupColor(state.selectedParty) },
    { label: 'Quota attiva · provincia', value: state.indices.provinceGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${currentRow.province}__${state.selectedParty}`) ?? null, color: '#f59e0b' },
      { label: 'Quota attiva · Italia', value: state.indices.regionGroupMaps[state.selectedPartyMode]?.get(`${currentRow.election_key}__${state.selectedParty}`) ?? null, color: '#94a3b8' },
    { label: 'Affluenza · comune', value: currentRow.turnout_pct, color: '#38bdf8' },
    { label: 'Affluenza · provincia', value: state.indices.provinceSummaryMap.get(`${currentRow.election_key}__${currentRow.province}`)?.turnout_pct ?? null, color: '#fb7185' },
    { label: 'Indice stabilità', value: computeStabilityIndex(state, currentRow.municipality_id), color: '#22c55e' }
  ].filter(d => d.value != null);
  if (!rows.length) { svg.append('text').attr('x', width/2).attr('y', height/2).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Confronto di contesto non disponibile'); return; }
  const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.value) * 1.08 || 10]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.22);
  svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(6)).call(g => g.selectAll('text').attr('fill','#94a3b8')).call(g=>g.selectAll('line,path').attr('stroke','#475569'));
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y)).call(g => g.selectAll('text').attr('fill','#cbd5e1')).call(g=>g.selectAll('line,path').attr('stroke','#475569'));
  svg.selectAll('rect.bar').data(rows).join('rect').attr('class','bar').attr('x', margin.left).attr('y', d => y(d.label)).attr('width', d => Math.max(0, x(d.value) - margin.left)).attr('height', y.bandwidth()).attr('rx', 8).attr('fill', d => d.color).attr('opacity', 0.92);
  svg.selectAll('text.label').data(rows).join('text').attr('class','label').attr('x', d => x(d.value) + 6).attr('y', d => y(d.label) + y.bandwidth()/2).attr('dominant-baseline','middle').attr('fill','#f8fafc').style('font-size','11px').text(d => `${metricDisplay(d.value)}${state.selectedMetric === 'custom_indicator' ? '' : '%'}`.replace('%%','%'));
}

function dataContractSummary() {
  const required = {
    summary: ['election_key','election_year','municipality_id','municipality_name','province','turnout_pct','first_party_std'],
    results: ['election_key','municipality_id','party_std','vote_share'],
    municipalities: ['municipality_id','name_current'],
    customIndicators: ['indicator_key','municipality_id','value']
  };
  const datasets = {
    summary: state.summary,
    results: state.resultsLong,
    municipalities: state.municipalities,
    customIndicators: state.customIndicators
  };
  return Object.entries(required).map(([key, cols]) => ({
    key,
    rows: datasets[key]?.length || 0,
    cols: cols.map(col => ({
      name: col,
      coverage: datasets[key]?.length ? ((datasets[key].filter(r => String(r[col] ?? '').trim() !== '').length / datasets[key].length) * 100) : 0
    }))
  }));
}

function vectorForMunicipality(municipalityId) {
  const rows = (state.indices.summaryByMunicipality.get(municipalityId) || []).filter(r => !state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode);
  if (!rows.length) return null;
  const shares = rows.map(r => aggregateShareFor(state, r.election_key, municipalityId, state.selectedParty)).filter(v => v != null);
  return {
    municipality_id: municipalityId,
    values: [
      shares.length ? d3.mean(shares) : 0,
      computeVolatility(state, municipalityId) || 0,
      computeStabilityIndex(state, municipalityId) || 0,
      mean(rows.map(r => r.turnout_pct)) || 0,
      rows.length ? computeDominanceChanges(state, municipalityId) || 0 : 0,
      rows.length ? (computeOverPerformanceRegion(state, rows.at(-1)) || 0) : 0
    ]
  };
}

function computeKMeansBundle() {
  const key = `kmeans__${state.selectedPartyMode}__${state.selectedParty || 'none'}__${state.territorialMode}__${state.selectedElection || 'none'}__${[...state.selectedProvinceSet].sort().join(',')}`;
  if (state.similarityCache[key]) return state.similarityCache[key];
  const ids = [...new Set(getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus }).map(r => r.municipality_id).filter(Boolean))];
  const vectors = ids.map(vectorForMunicipality).filter(v => v && v.values.some(Number.isFinite));
  if (vectors.length < 6) return state.similarityCache[key] = { assignment: new Map(), labels: new Map(), centroids: [] };
  const k = Math.max(3, Math.min(5, Math.round(Math.sqrt(vectors.length / 6)) + 2));
  let centroids = vectors.slice(0, k).map(v => v.values.slice());
  let assignment = new Map();
  for (let iter = 0; iter < 12; iter++) {
    assignment = new Map();
    vectors.forEach(v => {
      let best = 0, bestDist = Infinity;
      centroids.forEach((c, idx) => {
        const dist = Math.sqrt(c.reduce((acc, cv, i) => acc + ((v.values[i] - cv) ** 2), 0));
        if (dist < bestDist) { bestDist = dist; best = idx; }
      });
      assignment.set(v.municipality_id, best);
    });
    centroids = centroids.map((_, idx) => {
      const members = vectors.filter(v => assignment.get(v.municipality_id) === idx);
      if (!members.length) return centroids[idx];
      return centroids[idx].map((__, dim) => d3.mean(members.map(m => m.values[dim])) || 0);
    });
  }
  const labels = new Map();
  centroids.forEach((c, idx) => {
    const [avgShare, volatility, stability, turnout, changes, overperf] = c;
    const bits = [
      avgShare >= 20 ? 'quota alta' : avgShare >= 10 ? 'quota media' : 'quota bassa',
      volatility >= 8 ? 'volatile' : 'più stabile',
      stability >= 60 ? 'dominanza stabile' : changes >= 3 ? 'leader mobili' : 'equilibrato',
      turnout >= 75 ? 'alta affluenza' : 'affluenza intermedia'
    ];
    labels.set(idx, bits.join(' · '));
  });
  const bundle = { assignment, labels, centroids };
  state.similarityCache[key] = bundle;
  return bundle;
}

function lightClusterLabel(municipalityId) {
  const bundle = computeKMeansBundle();
  const clusterId = bundle.assignment.get(municipalityId);
  if (clusterId != null) return `Cluster ${clusterId + 1} · ${bundle.labels.get(clusterId)}`;
  const series = selectedShareSeriesForMunicipality(state, municipalityId);
  const dominantBlock = d3.rollups(series.filter(d => d.block), v => v.length, d => d.block).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'altro';
  const volatility = computeVolatility(state, municipalityId);
  const dominanceChanges = computeDominanceChanges(state, municipalityId);
  const volatilityTier = volatility == null ? 'volatilità n/d' : volatility >= 10 ? 'alta volatilità' : volatility >= 5 ? 'volatilità media' : 'bassa volatilità';
  const changeTier = dominanceChanges >= 4 ? 'molti cambi' : dominanceChanges >= 2 ? 'alcuni cambi' : 'stabile';
  return `${dominantBlock} · ${inferTurnoutTier(state, municipalityId)} · ${volatilityTier} · ${changeTier}`;
}

function similarityBundle(targetId, limit = 6) {
  const cacheKey = `similar__${state.selectedPartyMode}__${state.selectedParty || 'none'}__${state.territorialMode}__${[...state.selectedProvinceSet].sort().join(',')}__${state.selectedCompleteness}__${state.selectedTerritorialStatus}__${targetId}`;
  if (cacheKey in state.similarityCache) return state.similarityCache[cacheKey];
  const targetSeries = selectedShareSeriesForMunicipality(state, targetId);
  const targetMap = new Map(targetSeries.map(d => [d.election_year, d]));
  const clusterBundle = computeKMeansBundle();
  const targetClusterId = clusterBundle.assignment.get(targetId);
  const targetCluster = lightClusterLabel(targetId);
  const candidates = getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus }).map(r => r.municipality_id).filter((id, idx, arr) => id && id !== targetId && arr.indexOf(id) === idx);
  const scored = candidates.map(id => {
    const series = selectedShareSeriesForMunicipality(state, id);
    const commonYears = [...new Set(series.map(d => d.election_year).filter(y => targetMap.has(y)))].sort((a,b)=>a-b);
    if (!commonYears.length) return null;
    let sq = 0, n = 0;
    commonYears.forEach(year => {
      const a = targetMap.get(year), b = series.find(s => s.election_year === year);
      if (!a || !b) return;
      if (a.share != null && b.share != null) { sq += ((a.share - b.share) / 10) ** 2; n += 1; }
      if (a.turnout_pct != null && b.turnout_pct != null) { sq += ((a.turnout_pct - b.turnout_pct) / 12) ** 2; n += 1; }
      if (a.leader && b.leader && a.leader !== b.leader) sq += 0.45;
      if (a.block && b.block && a.block !== b.block) sq += 0.35;
    });
    if (!n) return null;
    const distance = Math.sqrt(sq / n);
    const score = Math.max(0, 100 - distance * 28);
    const clusterId = clusterBundle.assignment.get(id);
    return {
      municipality_id: id,
      label: municipalityLabelById(id),
      score,
      distance,
      cluster: lightClusterLabel(id),
      sameCluster: clusterId != null && targetClusterId != null ? clusterId === targetClusterId : lightClusterLabel(id) === targetCluster,
      shareNow: aggregateShareFor(state, state.selectedElection, id, state.selectedParty),
      turnoutNow: getSummaryRow(state, state.selectedElection, id)?.turnout_pct ?? null
    };
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  const bundle = {
    cluster: targetCluster,
    nearest: scored.slice(0, limit),
    sameCluster: scored.filter(d => d.sameCluster).slice(0, limit),
    targetCount: targetSeries.filter(d => d.share != null).length
  };
  state.similarityCache[cacheKey] = bundle;
  return bundle;
}

function exportMunicipalityReportHtml() {
  const html = buildMunicipalityReportHtml();
  if (!html || !state.selectedMunicipalityId) return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.selectedMunicipalityId}_report.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}


function municipalityArchetype(municipalityId) {
  if (!municipalityId) return null;
  const row = getSummaryRow(state, state.selectedElection, municipalityId) || (state.indices.summaryByMunicipality.get(municipalityId) || []).at(-1) || null;
  const volatility = computeVolatility(state, municipalityId);
  const stability = computeStabilityIndex(state, municipalityId);
  const changes = computeDominanceChanges(state, municipalityId);
  const turnoutTier = inferTurnoutTier(state, municipalityId);
  const block = row?.dominant_block || row?.bloc || 'altro';
  const provGap = row ? computeOverPerformanceProvince(state, row) : null;
  const regGap = row ? computeOverPerformanceRegion(state, row) : null;
  const tags = [];
  if (block && block !== 'altro') tags.push(block);
  tags.push(turnoutTier || 'affluenza n/d');
  if (stability != null && stability >= 72) tags.push('forte continuità');
  else if (changes >= 4) tags.push('leader mobili');
  else if (volatility != null && volatility >= 9) tags.push('volatilità alta');
  else tags.push('profilo intermedio');
  if (provGap != null && provGap >= 4) tags.push('sopra provincia');
  else if (provGap != null && provGap <= -4) tags.push('sotto provincia');
  const label = tags.slice(0, 4).join(' · ');
  return {
    municipality_id: municipalityId,
    label,
    block,
    turnoutTier,
    volatility,
    stability,
    changes,
    provGap,
    regGap
  };
}

function renderArchetypePanel() {
  if (!els.archetypePanelContent || !els.archetypeSummary) return;
  const rows = getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus });
  if (!rows.length) {
    els.archetypeSummary.textContent = 'Nessun comune disponibile con i filtri correnti.';
    els.archetypePanelContent.innerHTML = '<div class="empty-state">Gli archetipi compariranno qui quando esistono comuni osservabili nel filtro.</div>';
    return;
  }
  const uniqueIds = [...new Set(rows.map(r => r.municipality_id).filter(Boolean))];
  const archetypes = uniqueIds.map(municipalityArchetype).filter(Boolean);
  const counts = d3.rollups(archetypes, v => ({ n: v.length, ids: v.map(d => d.municipality_id).slice(0, 6) }), d => d.label)
    .map(([label, stats]) => ({ label, ...stats }))
    .sort((a,b) => b.n - a.n)
    .slice(0, 6);
  const selected = municipalityArchetype(state.selectedMunicipalityId);
  const peers = selected ? archetypes.filter(d => d.municipality_id !== state.selectedMunicipalityId && d.label === selected.label).slice(0, 6) : [];
  els.archetypeSummary.textContent = `${archetypes.length} comuni classificati · ${counts.length} archetipi visibili${selected ? ` · comune selezionato: ${selected.label}` : ''}`;
  const countHtml = counts.length ? counts.map(item => `
    <div class="archetype-item">
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <div class="similarity-meta">${item.ids.length ? item.ids.map(id => municipalityLabelById(id)).join(' · ') : 'nessun esempio'}${item.n > item.ids.length ? ` · +${item.n - item.ids.length} altri` : ''}</div>
      </div>
      <div class="archetype-count">${fmtInt(item.n)}</div>
    </div>`).join('') : '<div class="helper-text">Archetipi non leggibili.</div>';
  const peerHtml = selected ? `
      <div class="archetype-card">
        <div class="archetype-badge">Comune selezionato</div>
        <div><strong>${escapeHtml(municipalityLabelById(state.selectedMunicipalityId))}</strong></div>
        <div class="helper-text" style="margin-top:6px">${escapeHtml(selected.label)}</div>
        <div class="similarity-meta" style="margin-top:8px">Stabilità ${selected.stability != null ? fmtPct(selected.stability) : '—'} · volatilità ${selected.volatility != null ? fmtPct(selected.volatility) : '—'} · cambi ${fmtInt(selected.changes)}</div>
        <div class="archetype-list" style="margin-top:10px">
          ${peers.length ? peers.map(peer => `
            <div class="archetype-item">
              <button class="link-btn" type="button" data-mid="${escapeHtml(peer.municipality_id)}">${escapeHtml(municipalityLabelById(peer.municipality_id))}</button>
              <div class="similarity-meta">${peer.provGap != null ? `Δ prov ${fmtPctSigned(peer.provGap)} pt` : 'Δ prov n/d'}</div>
            </div>`).join('') : '<div class="helper-text">Nessun peer immediato nello stesso archetipo.</div>'}
        </div>
      </div>` : `
      <div class="archetype-card">
        <div class="archetype-badge">Suggerimento</div>
        <div class="helper-text">Seleziona un comune per vedere il suo archetipo, i peer vicini e la sua posizione relativa.</div>
      </div>`;
  els.archetypePanelContent.innerHTML = `
    <div class="archetype-grid">
      <div class="archetype-card">
        <div class="archetype-badge">Distribuzione archetipi</div>
        <div class="archetype-list">${countHtml}</div>
      </div>
      ${peerHtml}
    </div>`;
  [...els.archetypePanelContent.querySelectorAll('[data-mid]')].forEach(btn => btn.addEventListener('click', () => { selectMunicipality(btn.dataset.mid); requestRender(); }));
}

function averageSeriesForMunicipalities(ids) {
  const validIds = [...new Set((ids || []).filter(Boolean))];
  if (!validIds.length) return [];
  const rows = state.summary.filter(r => validIds.includes(r.municipality_id) && (!state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode));
  const years = d3.rollups(rows, items => {
    const shares = items.map(item => aggregateShareFor(state, item.election_key, item.municipality_id, state.selectedParty)).filter(v => v != null);
    return {
      election_year: items[0]?.election_year,
      election_key: items[0]?.election_key,
      share: shares.length ? d3.mean(shares) : null,
      turnout: mean(items.map(i => i.turnout_pct)),
      stability: mean(items.map(i => computeStabilityIndex(state, i.municipality_id)))
    };
  }, d => d.election_key).map(([_, stats]) => stats).filter(d => d.election_year != null).sort((a,b) => a.election_year - b.election_year);
  return years;
}

function provinceAverageSeries() {
  const rows = state.summary.filter(r => (!state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode) && (!state.selectedProvinceSet.size || state.selectedProvinceSet.has(r.province)));
  return d3.rollups(rows, items => ({
    election_year: items[0]?.election_year,
    election_key: items[0]?.election_key,
    share: mean(items.map(item => aggregateShareFor(state, item.election_key, item.municipality_id, state.selectedParty))),
    turnout: mean(items.map(i => i.turnout_pct)),
    stability: mean(items.map(i => computeStabilityIndex(state, i.municipality_id)))
  }), d => d.election_key).map(([_, stats]) => stats).filter(d => d.election_year != null).sort((a,b)=>a.election_year-b.election_year);
}

function regionAverageSeries() {
  const rows = state.summary.filter(r => (!state.territorialMode || !r.territorial_mode || r.territorial_mode === state.territorialMode));
  return d3.rollups(rows, items => ({
    election_year: items[0]?.election_year,
    election_key: items[0]?.election_key,
    share: mean(items.map(item => aggregateShareFor(state, item.election_key, item.municipality_id, state.selectedParty))),
    turnout: mean(items.map(i => i.turnout_pct)),
    stability: mean(items.map(i => computeStabilityIndex(state, i.municipality_id)))
  }), d => d.election_key).map(([_, stats]) => stats).filter(d => d.election_year != null).sort((a,b)=>a.election_year-b.election_year);
}

function renderGroupComparePanel() {
  const svg = d3.select('#group-compare-chart');
  svg.selectAll('*').remove();
  if (!els.groupCompareSummary) return;
  const comparator = averageSeriesForMunicipalities(state.compareMunicipalityIds);
  const bookmarks = averageSeriesForMunicipalities(state.bookmarkedMunicipalityIds);
  const province = provinceAverageSeries();
  const region = regionAverageSeries();
  const series = [
    { key: 'compare', label: 'Comparatore', color: '#38bdf8', values: comparator },
    { key: 'bookmarks', label: 'Bookmark', color: '#f59e0b', values: bookmarks },
    { key: 'province', label: state.selectedProvinceSet.size === 1 ? `Provincia · ${[...state.selectedProvinceSet][0]}` : 'Province filtrate', color: '#a78bfa', values: province },
    { key: 'region', label: 'Italia', color: '#94a3b8', values: region }
  ].filter(s => s.values.length);
  if (series.length < 2) {
    els.groupCompareSummary.textContent = 'Aggiungi comuni al comparatore o ai bookmark per vedere una traiettoria media confrontata con il contesto.';
    svg.append('text').attr('x', 360).attr('y', 140).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Confronto gruppi non disponibile');
    return;
  }
  const metricAccessor = d => {
    if (state.selectedMetric === 'turnout') return d.turnout;
    if (state.selectedMetric === 'stability_index') return d.stability;
    return d.share;
  };
  const points = series.flatMap(s => s.values.map(v => ({ ...v, series: s.label, color: s.color, value: metricAccessor(v) })) ).filter(d => d.value != null);
  if (!points.length) {
    els.groupCompareSummary.textContent = 'Dati insufficienti per il confronto di gruppo sulla metrica attiva.';
    svg.append('text').attr('x', 360).attr('y', 140).attr('text-anchor', 'middle').attr('fill', '#94a3b8').text('Dati insufficienti');
    return;
  }
  const width = 720, height = 280, margin = { top: 24, right: 110, bottom: 32, left: 44 };
  const x = d3.scalePoint().domain(uniqueSorted(points.map(d => d.election_year))).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(d3.extent(points, d => d.value)).nice().range([height - margin.bottom, margin.top]);
  const line = d3.line().defined(d => d.value != null).x(d => x(d.election_year)).y(d => y(d.value));
  svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format('d'))).call(g => g.selectAll('text').attr('fill','#cbd5e1')).call(g => g.selectAll('line,path').attr('stroke','#475569'));
  svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y)).call(g => g.selectAll('text').attr('fill','#cbd5e1')).call(g => g.selectAll('line,path').attr('stroke','#475569'));
  series.forEach(s => {
    const vals = s.values.map(v => ({ ...v, value: metricAccessor(v) })).filter(d => d.value != null);
    svg.append('path').datum(vals).attr('fill','none').attr('stroke', s.color).attr('stroke-width', 2.4).attr('d', line);
    svg.selectAll(`circle.group-${s.key}`).data(vals).join('circle').attr('class', `group-${s.key}`).attr('cx', d => x(d.election_year)).attr('cy', d => y(d.value)).attr('r', 3.2).attr('fill', s.color);
    const last = vals.at(-1);
    if (last) svg.append('text').attr('x', x(last.election_year) + 8).attr('y', y(last.value)).attr('fill', s.color).style('font-size','11px').attr('dominant-baseline','middle').text(s.label);
  });
  const activeYear = state.selectedElection ? series.map(s => ({ label: s.label, point: s.values.find(v => v.election_key === state.selectedElection) || s.values.at(-1) })).filter(d => d.point && metricAccessor(d.point) != null) : [];
  els.groupCompareSummary.textContent = activeYear.length ? activeYear.map(d => `${d.label}: ${metricDisplay(metricAccessor(d.point))}${state.selectedMetric === 'custom_indicator' ? '' : '%'}`.replace('%%','%')).join(' · ') : 'Confronto gruppi attivo';
}

function renderTransitionMatrix() {
  if (!els.transitionMatrixContent) return;
  if (!state.compareElection || !state.selectedElection) {
    els.transitionMatrixContent.innerHTML = '<div class="empty-state">Seleziona due elezioni per leggere i passaggi tra leader e blocchi.</div>';
    return;
  }
  const current = getSelectedRows(state, { matchesCompleteness, matchesTerritorialStatus });
  const baseIds = [...new Set(current.map(r => r.municipality_id).filter(Boolean))];
  const pairs = baseIds.map(id => ({ a: getSummaryRow(state, state.compareElection, id), b: getSummaryRow(state, state.selectedElection, id) })).filter(d => d.a && d.b);
  if (!pairs.length) {
    els.transitionMatrixContent.innerHTML = '<div class="empty-state">Nessun comune confrontabile tra le due elezioni con i filtri correnti.</div>';
    return;
  }
  const topTransitions = d3.rollups(pairs, v => v.length, d => `${d.a.first_party_std || '—'} → ${d.b.first_party_std || '—'}`)
    .map(([transition, n]) => ({ transition, n }))
    .sort((a,b) => b.n - a.n)
    .slice(0, 8);
  const blocks = uniqueSorted(pairs.flatMap(d => [d.a.dominant_block || '—', d.b.dominant_block || '—'])).slice(0, 8);
  const matrix = blocks.map(from => {
    const row = { from };
    blocks.forEach(to => {
      row[to] = pairs.filter(d => (d.a.dominant_block || '—') === from && (d.b.dominant_block || '—') === to).length;
    });
    return row;
  });
  const changedLeader = pairs.filter(d => d.a.first_party_std && d.b.first_party_std && d.a.first_party_std !== d.b.first_party_std).length;
  const changedBlock = pairs.filter(d => (d.a.dominant_block || '—') !== (d.b.dominant_block || '—')).length;
  const topHtml = topTransitions.length ? topTransitions.map(item => `<div class="transition-item"><div><strong>${escapeHtml(item.transition)}</strong></div><div class="archetype-count">${fmtInt(item.n)}</div></div>`).join('') : '<div class="helper-text">Nessun passaggio leggibile.</div>';
  const table = `<table class="transition-table"><thead><tr><th>Da \ A</th>${blocks.map(b => `<th>${escapeHtml(b)}</th>`).join('')}</tr></thead><tbody>${matrix.map(row => `<tr><th>${escapeHtml(row.from)}</th>${blocks.map(to => `<td class="${row[to] === d3.max(blocks.map(k => row[k])) && row[to] > 0 ? 'transition-cell-strong' : ''}">${fmtInt(row[to])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  els.transitionMatrixContent.innerHTML = `
    <div class="archetype-grid">
      <div class="transition-card">
        <div class="archetype-badge">Passaggi di leader</div>
        <div class="transition-list">${topHtml}</div>
      </div>
      <div class="transition-card">
        <div class="archetype-badge">Sintesi</div>
        <div class="similarity-list">
          <div class="similarity-item"><div><strong>Comuni confrontabili</strong><div class="similarity-meta">con dati in entrambe le elezioni</div></div><div class="similarity-score">${fmtInt(pairs.length)}</div></div>
          <div class="similarity-item"><div><strong>Cambio di primo partito</strong></div><div class="similarity-score">${fmtInt(changedLeader)}</div></div>
          <div class="similarity-item"><div><strong>Cambio di blocco dominante</strong></div><div class="similarity-score">${fmtInt(changedBlock)}</div></div>
        </div>
      </div>
    </div>
    <div class="transition-card">
      <div class="archetype-badge">Matrice blocchi</div>
      ${table}
    </div>`;
}


function renderAnalysisModePanel() {
  if (!els.analysisModeButtons || !els.analysisModeSummary) return;
  els.analysisModeButtons.innerHTML = Object.entries(ANALYSIS_MODES).map(([key, meta]) => `
    <button type="button" class="mode-btn${state.analysisMode === key ? ' is-active' : ''}" data-mode="${escapeHtml(key)}">${escapeHtml(meta.label)}</button>`).join('');
  els.analysisModeSummary.textContent = (ANALYSIS_MODES[state.analysisMode] || ANALYSIS_MODES.explore).description;
  [...els.analysisModeButtons.querySelectorAll('[data-mode]')].forEach(btn => btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    state.analysisMode = mode;
    ANALYSIS_MODES[mode]?.apply?.();
    setupControls();
    readControls();
    requestRender();
  }));
}

function renderSavedViewsPanel() {
  if (!els.savedViewsPanel) return;
  if (!state.savedViews.length) {
    els.savedViewsPanel.innerHTML = '<div class="empty-state">Nessuna vista salvata. Usa "Salva vista" per fissare combinazioni utili di filtri.</div>';
    return;
  }
  els.savedViewsPanel.innerHTML = state.savedViews.map(item => `
    <div class="saved-view-item">
      <div>
        <strong>${escapeHtml(item.label || item.id)}</strong>
        <div class="helper-text">${escapeHtml(item.view?.selectedElection || 'vista')}</div>
      </div>
      <div class="saved-view-actions">
        <button type="button" class="link-btn" data-open-view="${escapeHtml(item.id)}">Apri</button>
        <button type="button" class="link-btn" data-drop-view="${escapeHtml(item.id)}">Elimina</button>
      </div>
    </div>`).join('');
  [...els.savedViewsPanel.querySelectorAll('[data-open-view]')].forEach(btn => btn.addEventListener('click', () => {
    const hit = state.savedViews.find(v => v.id === btn.dataset.openView);
    if (!hit) return;
    applyViewSnapshot(hit.view);
    requestRender();
  }));
  [...els.savedViewsPanel.querySelectorAll('[data-drop-view]')].forEach(btn => btn.addEventListener('click', () => {
    state.savedViews = state.savedViews.filter(v => v.id !== btn.dataset.dropView);
    saveLocalState();
    requestRender();
  }));
}

function renderCustomIndicatorSummary() {
  if (!els.customIndicatorSummary) return;
  if (!state.customIndicators.length) {
    els.customIndicatorSummary.innerHTML = '<div class="helper-text">Nessun layer esterno caricato nel bundle corrente.</div>';
    return;
  }
  const active = state.selectedCustomIndicator ? customIndicatorMeta(state.selectedCustomIndicator) : null;
  els.customIndicatorSummary.innerHTML = `
    <div class="helper-text">Indicatori custom disponibili: <strong>${fmtInt(uniqueSorted(state.customIndicators.map(d => d.indicator_key || d.key)).length)}</strong>${active ? ` · attivo: <strong>${escapeHtml(active.label || state.selectedCustomIndicator)}</strong>` : ''}</div>`;
}

function renderQuickstart() {
  if (!els.quickstartCards || !els.nextBestActions) return;
  const byAudience = {
    public: [
      { key: 'search', label: 'Apri un comune', desc: 'Cerca un comune e vai alla sua traiettoria storica.', run: () => els.municipalitySearch?.focus() },
      { key: 'compare', label: 'Confronta due elezioni', desc: 'Attiva il doppio confronto cartografico e la tabella differenze.', run: () => { state.analysisMode = 'compare'; ANALYSIS_MODES.compare.apply(); requestRender(); } },
      { key: 'audit', label: 'Controlla qualità', desc: 'Leggi readiness, coverage e audit del bundle.', run: () => { state.analysisMode = 'diagnose'; ANALYSIS_MODES.diagnose.apply(); requestRender(); } }
    ],
    research: [
      { key: 'audit', label: 'Audit e coverage', desc: 'Apri audit tecnico, coverage matrix e note metodologiche.', run: () => { state.analysisMode = 'diagnose'; ANALYSIS_MODES.diagnose.apply(); requestRender(); } },
      { key: 'bundle', label: 'Scarica i dataset', desc: 'Usa catalogo, codebook e manifest come strato dati.', run: () => q('usage-notes-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      { key: 'compare', label: 'Confronto boundary-aware', desc: 'Apri confronto tra elezioni con attenzione a territorialità e coverage.', run: () => { state.analysisMode = 'compare'; ANALYSIS_MODES.compare.apply(); requestRender(); } }
    ],
    admin: [
      { key: 'turnout', label: "Parti dall'affluenza", desc: 'Panoramica civica immediata su partecipazione e contesto.', run: () => { state.selectedMetric = 'turnout'; state.selectedPalette = 'sequential'; setupControls(); readControls(); requestRender(); } },
      { key: 'profile', label: 'Scheda comune', desc: 'Apri un comune e guarda profilo, simili e traiettoria.', run: () => els.municipalitySearch?.focus() },
      { key: 'province', label: 'Leggi le province', desc: 'Scorri verso province, small multiples e scarti territoriali.', run: () => q('province-insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    ],
    press: [
      { key: 'compare', label: 'Trova dove cambia', desc: 'Confronta due elezioni e cerca swing leggibili.', run: () => { state.analysisMode = 'compare'; ANALYSIS_MODES.compare.apply(); requestRender(); } },
      { key: 'story', label: 'Apri traiettoria', desc: 'Usa timeline e storyboard per costruire una storia territoriale.', run: () => { state.analysisMode = 'trajectory'; ANALYSIS_MODES.trajectory.apply(); requestRender(); } },
      { key: 'warn', label: 'Controlla i limiti', desc: 'Verifica note e coverage prima di titolare.', run: () => q('usage-notes-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    ]
  };
  const actions = byAudience[state.audienceMode] || byAudience.public;
  els.quickstartCards.innerHTML = actions.map(item => `
    <button type="button" class="quickstart-card" data-quick="${escapeHtml(item.key)}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.desc)}</span>
    </button>`).join('');
  const nextActions = (AUDIENCE_MODES[state.audienceMode]?.checklist || DEFAULT_NEXT_ACTIONS);
  els.nextBestActions.innerHTML = nextActions.map(t => `<li>${escapeHtml(t)}</li>`).join('');
  [...els.quickstartCards.querySelectorAll('[data-quick]')].forEach(btn => btn.addEventListener('click', () => {
    const hit = actions.find(a => a.key === btn.dataset.quick);
    hit?.run?.();
  }));
}

function renderInsightFeed() {
  if (!els.insightFeed) return;
  const rows = state.filteredRows?.length ? state.filteredRows : filteredRowsWithMetric(state, { matchesCompleteness, matchesTerritorialStatus });
  const insights = [];
  if (rows.length) {
    const top = rows.filter(r => r.__metric_value != null).slice().sort((a, b) => ((b.__metric_value ?? -Infinity) - (a.__metric_value ?? -Infinity)))[0];
    if (top) insights.push({ mid: top.municipality_id, text: `${top.municipality_name} è in cima alla vista corrente per ${metricLabel().toLowerCase()}.` });
    const flips = rows.filter(r => (r.__dominance_changes || 0) >= 2).sort((a,b)=>(b.__dominance_changes||0)-(a.__dominance_changes||0))[0];
    if (flips) insights.push({ mid: flips.municipality_id, text: `${flips.municipality_name} mostra molti cambi di dominanza (${fmtInt(flips.__dominance_changes)}).` });
  }
  if (state.qualityReport?.derived_validations && (state.qualityReport.derived_validations.substantive_coverage_score ?? 0) < 50) insights.push({ text: 'Copertura storica ancora parziale: usa i confronti come esplorazione, non come base definitiva.' });
  if (!insights.length) {
    els.insightFeed.innerHTML = '<div class="helper-text">Gli insight compariranno qui quando il filtro corrente rende visibili pattern leggibili.</div>';
    return;
  }
  els.insightFeed.innerHTML = insights.slice(0, 4).map(item => `<button type="button" class="insight-item" ${item.mid ? `data-mid="${escapeHtml(item.mid)}"` : ''}>${escapeHtml(item.text)}</button>`).join('');
  [...els.insightFeed.querySelectorAll('[data-mid]')].forEach(btn => btn.addEventListener('click', () => { selectMunicipality(btn.dataset.mid, { updateSearch: true }); requestRender(); }));
}

function renderDiagnostics() {
  if (!els.diagnosticsPanel || !els.coverageAudit) return;
  const report = state.qualityReport?.derived_validations || {};
  const rows = dataContractSummary();
  els.diagnosticsPanel.innerHTML = `
    <div class="helper-text">Issue preprocess: <strong>${fmtInt(report.issue_count ?? 0)}</strong>${report.coverage_note ? ` · ${escapeHtml(report.coverage_note)}` : ''}</div>`;
  els.coverageAudit.innerHTML = rows.map(ds => `
    <div class="coverage-block">
      <strong>${escapeHtml(ds.key)}</strong>
      <div class="helper-text">${fmtInt(ds.rows)} righe</div>
      <div class="coverage-list">${ds.cols.map(col => `<div class="coverage-row"><span>${escapeHtml(col.name)}</span><strong>${fmtPct(col.coverage)}%</strong></div>`).join('')}</div>
    </div>`).join('');
}

function renderReadinessAudit() {
  if (!els.readinessAudit) return;
  const report = state.qualityReport?.derived_validations || {};
  const technical = report.technical_readiness_score ?? report.readiness_score ?? null;
  const substantive = report.substantive_coverage_score ?? null;
  const usefulElectionCount = state.elections.filter(d => { const c = electionCoverageFor(state, d.election_key); return c.summary || c.results; }).length;
  els.readinessAudit.innerHTML = `
    <div class="similarity-list">
      <div class="similarity-item"><div><strong>Readiness tecnica</strong><div class="similarity-meta">consistenza del bundle</div></div><div class="similarity-score">${fmtInt(technical)}</div></div>
      <div class="similarity-item"><div><strong>Copertura sostanziale</strong><div class="similarity-meta">anni con dati utili sul totale noto</div></div><div class="similarity-score">${fmtInt(substantive)}</div></div>
      <div class="similarity-item"><div><strong>Elezioni con righe utili</strong></div><div class="similarity-score">${fmtInt(usefulElectionCount)}</div></div>
    </div>`;
}

function renderMethodologyPanels() {
  if (els.usageNotesList) {
    const notes = (state.usageNotes || []).length ? state.usageNotes : [
      { title: 'Bundle corrente', severity: 'info', text: 'Il bundle corrente può essere parziale: usa sempre catalogo dati, coverage e audit prima di interpretare una vista come completa.' }
    ];
    els.usageNotesList.innerHTML = notes.map(note => `
      <article class="note-card">
        <div class="severity-pill ${escapeHtml(note.severity || 'info')}">${escapeHtml((note.severity || 'info').toUpperCase())}</div>
        <strong>${escapeHtml(note.title || note.key || 'Nota')}</strong>
        <div class="helper-text" style="margin-top:6px">${escapeHtml(note.text || '')}</div>
      </article>`).join('');
  }
  if (els.datasetRegistryPanel) {
    const entries = Array.isArray(state.datasetRegistry) ? state.datasetRegistry.slice(0, 14) : [];
    els.datasetRegistryPanel.innerHTML = entries.length ? entries.map(ds => `
      <article class="registry-card">
        <strong>${escapeHtml(ds.dataset_key || ds.dataset_family || 'dataset')}</strong>
        <div class="registry-meta">${escapeHtml(ds.dataset_family || '')}${ds.boundary_basis ? ` · base ${escapeHtml(String(ds.boundary_basis))}` : ''}</div>
        <div class="helper-text" style="margin-top:6px">Stato: <strong>${escapeHtml(ds.status || 'n/d')}</strong>${ds.coverage_label ? ` · ${escapeHtml(ds.coverage_label)}` : ''}${Number.isFinite(safeNumber(ds.summary_rows)) || Number.isFinite(safeNumber(ds.result_rows)) ? ` · summary ${fmtInt(ds.summary_rows || 0)} · results ${fmtInt(ds.result_rows || 0)}` : ''}</div>
      </article>`).join('') : '<div class="empty-state">Nessun dataset registry disponibile.</div>';
  }
  if (els.dataProductsPanel) {
    const products = state.dataProducts?.products || [];
    els.dataProductsPanel.innerHTML = products.length ? products.map(prod => `
      <article class="product-card">
        <strong>${escapeHtml(prod.title || prod.product_key || 'data product')}</strong>
        <div class="registry-meta">${escapeHtml(prod.kind || '')}${prod.territorial_mode ? ` · ${escapeHtml(prod.territorial_mode)}` : ''}${prod.granularity ? ` · ${escapeHtml(prod.granularity)}` : ''}</div>
        <div class="helper-text" style="margin-top:6px">Dataset: <strong>${escapeHtml(prod.primary_dataset_key || 'n/d')}</strong>${prod.companion_dataset_key ? ` · companion ${escapeHtml(prod.companion_dataset_key)}` : ''}</div>
        <div class="helper-text" style="margin-top:6px">${(prod.guardrails || []).slice(0,2).map(item => escapeHtml(item)).join(' · ')}</div>
      </article>`).join('') : '<div class="empty-state">Data products non disponibili.</div>';
  }
  if (els.accessClientsPanel) {
    const clients = state.dataProducts?.clients || [];
    els.accessClientsPanel.innerHTML = clients.length ? clients.map(client => `
      <article class="snippet-card">
        <strong>${escapeHtml((client.language || 'client').toUpperCase())}</strong>
        <div class="helper-text" style="margin-top:6px">Entrypoint: <code>${escapeHtml(client.entrypoint || '')}</code></div>
        <pre>${escapeHtml(client.example || '')}</pre>
      </article>`).join('') : '<div class="empty-state">Client ufficiali non dichiarati.</div>';
  }
  if (els.codebookPanel) {
    const datasets = state.codebook?.datasets || [];
    els.codebookPanel.innerHTML = datasets.length ? datasets.slice(0,4).map(ds => `
      <article class="codebook-card">
        <strong>${escapeHtml(ds.dataset || 'dataset')}</strong>
        <div class="codebook-meta">${fmtInt(ds.columns?.length || 0)} colonne documentate</div>
        <div class="coverage-list" style="margin-top:8px">${(ds.columns || []).slice(0,6).map(col => `<div class="coverage-row"><span>${escapeHtml(col.name)}</span><strong>${escapeHtml(col.type_hint || '')}</strong></div>`).join('')}</div>
      </article>`).join('') : '<div class="empty-state">Codebook non disponibile nel bundle.</div>';
  }
  if (els.downloadGuidePanel) {
    const summaryPath = state.manifest?.files?.municipalitySummary || 'data/derived/municipality_summary.csv';
    const resultsPath = state.manifest?.files?.municipalityResultsLong || 'data/derived/municipality_results_long.csv';
    els.downloadGuidePanel.innerHTML = `
      <article class="snippet-card">
        <strong>Python / pandas</strong>
        <pre>import pandas as pd
summary = pd.read_csv('${escapeHtml(summaryPath)}')
results = pd.read_csv('${escapeHtml(resultsPath)}')</pre>
      </article>
      <article class="snippet-card">
        <strong>R</strong>
        <pre>summary <- read.csv('${escapeHtml(summaryPath)}')
results <- read.csv('${escapeHtml(resultsPath)}')</pre>
      </article>
      <article class="snippet-card">
        <strong>Bundle locale</strong>
        <div class="helper-text" style="margin-top:6px">Carica una cartella locale con <code>manifest.json</code> e file derived per sostituire il bundle incorporato senza toccare il codice.</div>
      </article>`;
  }
  if (els.updateLogPanel) {
    const entries = Array.isArray(state.updateLog) ? state.updateLog : [];
    els.updateLogPanel.innerHTML = entries.length ? entries.map(item => `
      <article class="update-card">
        <strong>${escapeHtml(item.version || 'n/d')} · ${escapeHtml(item.title || 'Update')}</strong>
        <div class="update-meta">${escapeHtml(item.date || '')}</div>
        <ul>${(item.changes || []).map(ch => `<li>${escapeHtml(ch)}</li>`).join('')}</ul>
      </article>`).join('') : '<div class="empty-state">Update log non disponibile.</div>';
  }
}

function renderSelectionDock() {
  if (!els.selectionDock || !els.selectionDockTitle || !els.selectionDockMeta) return;
  const mid = state.selectedMunicipalityId;
  const compareN = state.compareMunicipalityIds.length;
  const visible = Boolean(mid || compareN);
  els.selectionDock.classList.toggle('hidden', !visible);
  if (!visible) return;
  els.selectionDockTitle.textContent = mid ? municipalityLabelById(mid) : 'Nessun comune principale';
  els.selectionDockMeta.textContent = `${compareN} comuni nel comparatore${mid ? ' · profilo attivo' : ''}`;
}

function renderViewHealthPill() {
  if (!els.viewHealthPill) return;
  const issueCount = state.uiIssues?.length || 0;
  els.viewHealthPill.textContent = issueCount ? `UI issue: ${fmtInt(issueCount)}` : 'UI stabile';
  els.viewHealthPill.className = `health-pill ${issueCount ? 'warn' : 'ok'}`;
}

function renderViewTrustPill() {
  if (!els.viewTrustPill) return;
  const trust = assessViewTrust();
  els.viewTrustPill.textContent = `Affidabilità vista: ${trust.label}`;
  els.viewTrustPill.className = `health-pill ${trustStyle(trust.status)}`;
}

function renderAll() {
  ensureVisibleMapReady({ silent: true });
  ensureVisibleSummary({ silent: true });
  if (shouldHydratePartyResultsNow()) ensureVisibleResults({ silent: true });
  cancelDeferredRender();
  state.renderCycle += 1;
  const renderToken = state.renderCycle;
  clearIssues();
  const immediateTasks = [
    { scope: 'hero', fn: renderHeroPanel, target: () => els.heroTitle },
    { scope: 'signature', fn: renderSignaturePanel, target: () => els.signatureTitle },
    { scope: 'site-layers', fn: renderSiteLayersPanel, target: () => els.siteLayersGrid },
    { scope: 'pathways', fn: renderPathwayPanel, target: () => els.pathwayGrid },
    { scope: 'method-explainers', fn: renderMethodExplainersPanel, target: () => els.methodExplainersGrid },
    { scope: 'faq', fn: renderFaqPanel, target: () => els.faqAccordion },
    { scope: 'analysis-modes', fn: renderAnalysisModePanel, target: () => els.analysisModeButtons },
    { scope: 'audience-panel', fn: renderAudiencePanel, target: () => els.audienceModeButtons },
    { scope: 'saved-views', fn: renderSavedViewsPanel, target: () => els.savedViewsPanel },
    { scope: 'custom-indicators', fn: renderCustomIndicatorSummary, target: () => els.customIndicatorSummary },
    { scope: 'quickstart', fn: renderQuickstart, target: () => els.quickstartCards },
    { scope: 'question-workbench', fn: renderQuestionWorkbench, target: () => els.guidedQuestionGrid },
    { scope: 'reading-guide', fn: renderReadingGuide, target: () => els.readingGuide },
    { scope: 'briefing', fn: renderBriefingPanel, target: '.briefing-panel' },
    { scope: 'evidence-panel', fn: renderEvidencePanel, target: '#evidence-panel' },
    { scope: 'insight-feed', fn: renderInsightFeed, target: () => els.insightFeed },
    { scope: 'status-panel', fn: renderStatusPanel, target: () => els.datasetStatus },
    { scope: 'release-studio', fn: renderReleaseStudioPanel, target: '#release-studio-panel' },
    { scope: 'data-package', fn: renderDataPackagePanel, target: '.data-package-panel' },
    { scope: 'methodology', fn: renderMethodologyPanels, target: '#usage-notes-panel' },
    { scope: 'map', fn: renderMap, target: '#map-canvas' },
    { scope: 'filter-chips', fn: renderActiveFilterChips, target: () => els.activeFilterChips },
    { scope: 'detail', fn: renderDetail, target: () => els.municipalityProfile },
    { scope: 'comparison-panel', fn: renderComparisonPanel, target: () => els.comparisonPanelContent },
    { scope: 'recent', fn: renderRecentMunicipalityPanel, target: () => els.recentMunicipalityPanel },
    { scope: 'diagnostics', fn: renderDiagnostics, target: () => els.diagnosticsPanel },
    { scope: 'table', fn: renderTable, target: '#results-table' },
    { scope: 'readiness', fn: renderReadinessAudit, target: () => els.readinessAudit },
    { scope: 'selection-dock', fn: renderSelectionDock, target: () => els.selectionDock, always: true },
    { scope: 'view-health', fn: renderViewHealthPill, target: () => els.viewHealthPill },
    { scope: 'view-trust', fn: renderViewTrustPill, target: () => els.viewTrustPill }
  ];
  const deferredTasks = [
    { scope: 'comparison-maps', fn: renderComparisonMaps, target: () => els.compareMapSummary },
    { scope: 'swipe-map', fn: renderSwipeMap, target: '#swipe-map-svg' },
    { scope: 'rankings', fn: renderRankingsPanel, target: () => els.rankingsPanelContent },
    { scope: 'multi-compare', fn: renderMultiCompareChart, target: '#multi-compare-chart' },
    { scope: 'province-insights', fn: renderProvinceInsights, target: () => els.provinceInsights },
    { scope: 'heatmap', fn: renderHeatmap, target: '#heatmap-chart' },
    { scope: 'similarity', fn: renderSimilarityPanel, target: () => els.similarityPanelContent },
    { scope: 'province-multiples', fn: renderProvinceSmallMultiples, target: () => els.provinceSmallMultiples },
    { scope: 'archetypes', fn: renderArchetypePanel, target: () => els.archetypePanelContent },
    { scope: 'group-compare', fn: renderGroupComparePanel, target: '#group-compare-chart' },
    { scope: 'transitions', fn: renderTransitionMatrix, target: () => els.transitionMatrixContent }
  ];
  immediateTasks.forEach(task => {
    if (shouldRunRenderTask(task)) safeRender(task.scope, task.fn);
  });
  scheduleDeferredRender(deferredTasks, renderToken);
  checkpointHistory();
}

async function init() {
  Object.assign(els, {
    municipalitySearch: q('municipality-search'),
    municipalityList: q('municipality-list'),
    advancedControls: q('advanced-controls'),
    secondaryTools: q('secondary-tools'),
    electionSelect: q('election-select'),
    compareElectionSelect: q('compare-election-select'),
    electionSlider: q('election-slider'),
    sliderYearLabel: q('slider-year-label'),
    prevElectionBtn: q('prev-election-btn'),
    nextElectionBtn: q('next-election-btn'),
    playTimelineBtn: q('play-timeline-btn'),
    areaPresetSelect: q('area-preset-select'),
    provinceSelect: q('province-select'),
    completenessSelect: q('completeness-select'),
    territorialStatusSelect: q('territorial-status-select'),
    metricSelect: q('metric-select'),
    partyModeSelect: q('party-mode-select'),
    partySelect: q('party-select'),
    controlRefreshStatus: q('control-refresh-status'),
    territorialModeSelect: q('territorial-mode-select'),
    geometryReferenceSelect: q('geometry-reference-select'),
    sameScaleCheckbox: q('same-scale-checkbox'),
    paletteSelect: q('palette-select'),
    minShareInput: q('min-share-input'),
    tableSortSelect: q('table-sort-select'),
    showNotesCheckbox: q('show-notes-checkbox'),
    trajectoryModeSelect: q('trajectory-mode-select'),
    datasetStatus: q('dataset-status'),
    dataCounts: q('data-counts'),
    dataSourceBadge: q('data-source-badge'),
    localBundleInput: q('local-bundle-input'),
    loadLocalBundleBtn: q('load-local-bundle-btn'),
    resetEmbeddedBundleBtn: q('reset-embedded-bundle-btn'),
    localBundleSummary: q('local-bundle-summary'),
    coverageMatrix: q('coverage-matrix'),
    dataCatalog: q('data-catalog'),
    usageNotesList: q('usage-notes-list'),
    datasetRegistryPanel: q('dataset-registry-panel'),
    dataProductsPanel: q('data-products-panel'),
    accessClientsPanel: q('access-clients-panel'),
    codebookPanel: q('codebook-panel'),
    downloadGuidePanel: q('download-guide-panel'),
    updateLogPanel: q('update-log-panel'),
    legend: q('legend'),
    mapCanvas: q('map-canvas'),
    mapEmptyState: q('map-empty-state'),
    tooltip: q('tooltip'),
    municipalityProfile: q('municipality-profile'),
    municipalityStory: q('municipality-story'),
    bookmarkMunicipalityBtn: q('bookmark-municipality-btn'),
    pinMunicipalityBtn: q('pin-municipality-btn'),
    backToMapBtn: q('back-to-map-btn'),
    clearCompareBtn: q('clear-compare-btn'),
    compareChipList: q('compare-chip-list'),
    lineagePanel: q('lineage-panel'),
    selectedMunicipalityBadge: q('selected-municipality-badge'),
    singleElectionResults: q('single-election-results'),
    resultsTableBody: q('results-table').querySelector('tbody'),
    tableFilter: q('table-filter'),
    tablePrevBtn: q('table-prev-btn'),
    tableNextBtn: q('table-next-btn'),
    tablePageInfo: q('table-page-info'),
    exportTableBtn: q('export-table-btn'),
    exportMunicipalityBtn: q('export-municipality-btn'),
    exportStateBtn: q('export-state-btn'),
    exportMapPngBtn: q('export-map-png-btn'),
    exportTimelinePngBtn: q('export-timeline-png-btn'),
    exportHeatmapPngBtn: q('export-heatmap-png-btn'),
    exportAuditBtn: q('export-audit-btn'),
    exportReportHtmlBtn: q('export-report-html-btn'),
    printReportBtn: q('print-report-btn'),
    copyLinkBtn: q('copy-link-btn'),
    resetBtn: q('reset-btn'),
    saveViewBtn: q('save-view-btn'),
    savedViewsPanel: q('saved-views-panel'),
    analysisModeButtons: q('analysis-mode-buttons'),
    analysisModeSummary: q('analysis-mode-summary'),
    audienceModeButtons: q('audience-mode-buttons'),
    audienceModeSummary: q('audience-mode-summary'),
    densitySelect: q('density-select'),
    visionModeSelect: q('vision-mode-select'),
    displayModeSummary: q('display-mode-summary'),
    uiLevelBasicBtn: q('ui-level-basic-btn'),
    uiLevelAdvancedBtn: q('ui-level-advanced-btn'),
    uiLevelSummary: q('ui-level-summary'),
    insightFeed: q('insight-feed'),
    quickstartCards: q('quickstart-cards'),
    nextBestActions: q('next-best-actions'),
    guidedQuestionGrid: q('guided-question-grid'),
    guidedQuestionSummary: q('guided-question-summary'),
    readingGuide: q('reading-guide'),
    briefingBadge: q('briefing-badge'),
    briefingHeadline: q('briefing-headline'),
    briefingStandfirst: q('briefing-standfirst'),
    briefingCanSay: q('briefing-can-say'),
    briefingCaution: q('briefing-caution'),
    briefingCannotSay: q('briefing-cannot-say'),
    briefingMethodNote: q('briefing-method-note'),
    copyBriefBtn: q('copy-brief-btn'),
    copyMethodNoteBtn: q('copy-method-note-btn'),
    evidenceBadge: q('evidence-badge'),
    evidenceHeadline: q('evidence-headline'),
    evidenceBody: q('evidence-body'),
    evidenceChecks: q('evidence-checks'),
    evidenceNextChecks: q('evidence-next-checks'),
    viewCitationNote: q('view-citation-note'),
    copyViewCitationBtn: q('copy-view-citation-btn'),
    copyReproBtn: q('copy-repro-btn'),
    audienceChecklist: q('audience-checklist'),
    glossaryPanel: q('glossary-panel'),
    activeSummary: q('active-summary'),
    territorySummary: q('territory-summary'),
    metricSummary: q('metric-summary'),
    heroTitle: q('hero-title'),
    heroStandfirst: q('hero-standfirst'),
    heroBadges: q('hero-badges'),
    heroReleaseVersion: q('hero-release-version'),
    heroReleaseMeta: q('hero-release-meta'),
    heroTechnicalReadiness: q('hero-technical-readiness'),
    heroSubstantiveReadiness: q('hero-substantive-readiness'),
    heroProductsCount: q('hero-products-count'),
    heroProductsMeta: q('hero-products-meta'),
    copyHeroPythonBtn: q('copy-hero-python-btn'),
    signatureTitle: q('signature-title'),
    signatureStandfirst: q('signature-standfirst'),
    signatureStatement: q('signature-statement'),
    signatureProofGrid: q('signature-proof-grid'),
    signatureMarquee: q('signature-marquee'),
    siteLayersGrid: q('site-layers-grid'),
    siteLayersSummary: q('site-layers-summary'),
    methodExplainersGrid: q('method-explainers-grid'),
    methodExplainersSummary: q('method-explainers-summary'),
    faqAccordion: q('faq-accordion'),
    faqSummary: q('faq-summary'),
    pathwayGrid: q('pathway-grid'),
    releaseIntegrityPill: q('release-integrity-pill'),
    releaseIdentityPanel: q('release-identity-panel'),
    provenancePanel: q('provenance-panel'),
    clientSnippetPanel: q('client-snippet-panel'),
    citationPanel: q('citation-panel'),
    copyReleasePythonBtn: q('copy-release-python-btn'),
    copyCitationBtn: q('copy-citation-btn'),
    overviewCards: q('overview-cards'),
    comparisonPanelContent: q('comparison-panel-content'),
    rankingsPanelContent: q('rankings-panel-content'),
    multiCompareSummary: q('multi-compare-summary'),
    recentMunicipalityPanel: q('recent-municipality-panel'),
    provinceInsights: q('province-insights'),
    similaritySummary: q('similarity-summary'),
    similarityPanelContent: q('similarity-panel-content'),
    provinceSmallMultiples: q('province-small-multiples'),
    archetypeSummary: q('archetype-summary'),
    archetypePanelContent: q('archetype-panel-content'),
    groupCompareSummary: q('group-compare-summary'),
    transitionMatrixContent: q('transition-matrix-content'),
    heatmapSummary: q('heatmap-summary'),
    mapFullscreenBtn: q('map-fullscreen-btn'),
    mapResetBtn: q('map-reset-btn'),
    warningStrip: q('warning-strip'),
    swipePosition: q('swipe-position'),
    swipeCompareSummary: q('swipe-compare-summary'),
    historyBackBtn: q('history-back-btn'),
    historyForwardBtn: q('history-forward-btn'),
    commandPaletteBtn: q('command-palette-btn'),
    helpBtn: q('help-btn'),
    focusModeBtn: q('focus-mode-btn'),
    commandPalette: q('command-palette'),
    commandInput: q('command-input'),
    commandResults: q('command-results'),
    commandCloseBtn: q('command-close-btn'),
    swipeMapDivider: q('swipe-map-divider'),
    trajectoryStoryboard: q('trajectory-storyboard'),
    trajectoryReport: q('trajectory-report'),
    municipalityTrustBox: q('municipality-trust-box'),
    contextCompareChart: q('context-compare-chart'),
    municipalityNoteInput: q('municipality-note-input'),
    municipalityNoteMeta: q('municipality-note-meta'),
    saveNoteBtn: q('save-note-btn'),
    clearNoteBtn: q('clear-note-btn'),
    activeFilterChips: q('active-filter-chips'),
    diagnosticsPanel: q('diagnostics-panel'),
    coverageAudit: q('coverage-audit'),
    readinessAudit: q('readiness-audit'),
    compareMapSummary: q('compare-map-summary'),
    compareMapATitle: q('compare-map-a-title'),
    compareMapBTitle: q('compare-map-b-title'),
    swapElectionsBtn: q('swap-elections-btn'),
    customIndicatorSelect: q('custom-indicator-select'),
    customIndicatorSummary: q('custom-indicator-summary'),
    selectionDock: q('selection-dock'),
    selectionDockTitle: q('selection-dock-title'),
    selectionDockMeta: q('selection-dock-meta'),
    selectionDockOpenBtn: q('selection-dock-open-btn'),
    selectionDockCompareBtn: q('selection-dock-compare-btn'),
    selectionDockClearBtn: q('selection-dock-clear-btn'),
    viewHealthPill: q('view-health-pill'),
    viewTrustPill: q('view-trust-pill'),
    onboardingModal: q('onboarding-modal'),
    onboardingCloseBtn: q('onboarding-close-btn'),
    onboardingDismissBtn: q('onboarding-dismiss-btn'),
    onboardingStartTrajectoryBtn: q('onboarding-start-trajectory-btn'),
    onboardingStartCompareBtn: q('onboarding-start-compare-btn')
  });
  collapseFirstScreenTools();

  try {
    setLoading(true, 'Caricamento dataset, geometrie e indici…');
    await loadData(state, { buildIndices: updateIndices, registerIssue });
    restoreLocalState();
    restoreURLState();
    const bootParams = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
    if (!bootParams.has('uiLevel')) state.uiLevel = 'basic';
    if (!bootParams.has('audienceMode')) state.audienceMode = 'public';
    setupControls();
    invalidateDerivedCaches();
    renderStatusPanel();
    readControls({ refreshMap: false });
    await prepareCurrentMapInputs();
    bindEvents();
    initCollapsiblePanels();
    updateBodyAppearance();
    toggleFocusMode(state.focusMode);
    requestRender();
    scheduleLikelyDatasetPrefetch();
    setLoading(false);
    if (!state.onboardingDismissed && new URLSearchParams(window.location.search).get('onboarding') === '1') openOnboarding();
    showToast('Explorer pronto. Controlla audit e metodo se i dati sono parziali.', 'success', 2600);
  } catch (err) {
    console.error(err);
    q('dataset-status').innerHTML = `<div class="empty-state">Errore di caricamento: ${escapeHtml(err.message)}</div>`;
    setLoading(false);
    showMapMessage('Manifest o file derived mancanti. Avvia un server statico nella cartella del progetto e verifica <code>data/derived/manifest.json</code>.');
    showToast(`Errore di caricamento: ${err.message}`, 'error', 3600);
  }
}

window.addEventListener('error', event => registerIssue('window', event.error || event.message));
window.addEventListener('unhandledrejection', event => registerIssue('promise', event.reason || 'Promise rejection'));
init();
