// Standalone script for municipality-detail.html.
// Reads ?id=<municipality_id> from the URL, fetches the slim derived CSVs
// already shipped with the bundle, and renders anagrafica + storico + 3
// SVG charts (turnout over time, winner margin, leader timeline).

import { inferPartyMeta, inferredPartyMetaOrNull } from './modules/shared.js';

const DERIVED = 'data/derived';
const SVG_NS = 'http://www.w3.org/2000/svg';

const els = {
  name: document.getElementById('detail-name'),
  standfirst: document.getElementById('detail-standfirst'),
  error: document.getElementById('detail-error'),
  currentElection: document.getElementById('detail-current-election'),
  anagrafica: document.getElementById('detail-anagrafica'),
  historyBody: document.getElementById('detail-history-body'),
  kpiStrip: document.getElementById('detail-kpi-strip'),
  winnersBody: document.getElementById('detail-winners-body'),
  chartTurnout: document.getElementById('detail-chart-turnout'),
  chartMargin: document.getElementById('detail-chart-margin'),
  chartLeader: document.getElementById('detail-chart-leader'),
  chartBlock: document.getElementById('detail-chart-block'),
  chartBlocComposition: document.getElementById('detail-chart-bloc-composition'),
};

// Categorical colors for `dominant_block`. Ordine: continuum politico
// destra → sinistra, poi populista / regionalista / altro come categorie
// "fuori asse" — la stessa sequenza usata da modules/shared.js così
// legend, timeline e KPI sono coerenti tra mappa principale e scheda
// comune. I valori possibili in data/derived/municipality_summary.csv
// sono: centro · centro-destra · destra · centro-sinistra · sinistra ·
// populista · liberale · regionalista · altro · empty.
const BLOCK_COLORS = {
  'destra': '#1e1b4b',
  'centro-destra': '#1e3a8a',
  'liberale': '#8b5cf6',
  'centro': '#0ea5e9',
  'centro-sinistra': '#f59e0b',
  'sinistra': '#dc2626',
  'populista': '#a855f7',
  'regionalista': '#16a34a',
  'altro': '#94a3b8',
  '': '#cbd5e1',
};
const BLOCK_LABEL = {
  'destra': 'Destra',
  'centro-destra': 'Centrodestra',
  'liberale': 'Liberale',
  'centro': 'Centro',
  'centro-sinistra': 'Centrosinistra',
  'sinistra': 'Sinistra',
  'populista': 'Populisti',
  'regionalista': 'Regionalisti',
  'altro': 'Altri / non classificati',
  '': 'n.d.',
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtInt(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('it-IT');
}

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: (params.get('id') || '').trim(),
    election: (params.get('election') || '').trim(),
  };
}

function arrangeDetailSections() {
  const main = document.getElementById('main-content');
  if (!main) return;
  [
    'detail-charts-section',
    'detail-winners-section',
    'detail-kpi-section',
    'detail-anagrafica-section',
    'detail-history-section'
  ].forEach(id => {
    const section = document.getElementById(id);
    if (section) main.appendChild(section);
  });
}

function electionDisplayLabel(row) {
  if (!row) return 'Elezione non disponibile';
  if (row.election_label) return row.election_label;
  const year = row.election_year || row.year || '';
  return String(row.election_key || '').includes('assemblea_costituente')
    ? `Assemblea Costituente ${year}`
    : `Camera ${year}`;
}

function publicPartyLabel(party, electionKey = '') {
  const raw = String(party || '').trim();
  if (!raw) return 'n.d.';
  const year = Number(String(electionKey || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
  const token = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (year && year < 2022) {
    if (/^(avs|avs \/ verdi|verdi \/ avs)$/.test(token)) return 'Verdi';
    const acronyms = {
      dc: 'DC', pci: 'PCI', psi: 'PSI', psdi: 'PSDI', pri: 'PRI', pli: 'PLI',
      pds: 'PDS', ds: 'DS', an: 'AN', msi: 'MSI', pd: 'PD', fi: 'FI',
      fdi: 'FdI', m5s: 'M5S', udc: 'UDC', idv: 'IdV', sel: 'SEL'
    };
    return acronyms[token] || raw;
  }
  return inferPartyMeta(raw).display || raw;
}

function publicPartyMark(party, electionKey = '') {
  const display = publicPartyLabel(party, electionKey);
  const compact = display.replace(/[^A-Za-z0-9]/g, '');
  if (compact.length <= 4) return compact || '-';
  const words = display
    .split(/\s+|\//)
    .map(word => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter(word => word && !['DI', 'DEI', 'DEL', 'DELLA', 'CON', 'PER'].includes(word.toUpperCase()));
  return words.slice(0, 3).map(word => word[0]).join('').toUpperCase() || compact.slice(0, 3).toUpperCase();
}

function renderCurrentElection(row, municipalityId, exactWinner = null) {
  if (!els.currentElection) return;
  if (!row) {
    els.currentElection.innerHTML = '<div class="detail-placeholder detail-placeholder-muted">Nessun risultato disponibile per l\'elezione richiesta.</div>';
    return;
  }
  const party = exactWinner?.party || row.first_party_raw || row.first_party_std || '';
  const meta = inferPartyMeta(party);
  const partyLabel = publicPartyLabel(party, row.election_key);
  const share = exactWinner?.share ?? Number(row.first_party_share);
  const block = exactWinner?.bloc || reinferBlockForSummaryRow(row);
  const mapHash = new URLSearchParams({
    selectedElection: row.election_key || '',
    selectedMetric: 'first_party',
    selectedPartyMode: 'party_raw',
    selectedMunicipalityId: municipalityId || '',
    uiLevel: 'basic',
    audienceMode: 'public'
  });
  els.currentElection.innerHTML = `
    <div class="detail-current-head">
      <span>Elezione selezionata</span>
      <strong>${escapeHtml(electionDisplayLabel(row))}</strong>
    </div>
    <div class="detail-current-winner">
      <span class="detail-current-party-dot" style="background:${escapeHtml(meta.color || '#64748b')}" aria-hidden="true">${escapeHtml(publicPartyMark(party, row.election_key))}</span>
      <div>
        <span>Partito vincente</span>
        <strong>${escapeHtml(partyLabel)}</strong>
      </div>
      <b>${Number.isFinite(Number(share)) ? fmtPct(share) : '—'}</b>
    </div>
    <dl class="detail-current-stats">
      <div><dt>Affluenza</dt><dd>${fmtPct(row.turnout_pct)}</dd></div>
      <div><dt>Margine</dt><dd>${Number.isFinite(Number(row.first_second_margin)) ? `${Number(row.first_second_margin).toFixed(1)} pt` : '—'}</dd></div>
      <div><dt>Area</dt><dd>${escapeHtml(BLOCK_LABEL[block] || block || 'n.d.')}</dd></div>
    </dl>
    <a class="detail-current-map-link" href="index.html#${mapHash.toString()}">Riapri sulla mappa</a>`;
}

async function loadExactWinner(municipalityId, electionKey) {
  if (!municipalityId || !electionKey) return null;
  const manifestResponse = await fetch(`${DERIVED}/manifest.json`);
  if (!manifestResponse.ok) return null;
  const manifest = await manifestResponse.json();
  const indexPath = manifest.files?.municipalityResultsLongByElectionIndex || `${DERIVED}/municipality_results_long_by_election.json`;
  const indexResponse = await fetch(indexPath);
  if (!indexResponse.ok) return null;
  const index = await indexResponse.json();
  const shardPath = index.shards?.[electionKey];
  if (!shardPath) return null;
  const rows = parseCsvStream(await fetchAndDecompress(shardPath));
  const totals = new Map();
  rows.forEach(result => {
    if (String(result.municipality_id || '').trim() !== municipalityId) return;
    const party = String(result.party_raw || result.party_std || '').trim();
    if (!party) return;
    const current = totals.get(party) || { party, votes: 0, share: 0 };
    current.votes += Number(result.votes) || 0;
    current.share += Number(result.vote_share) || 0;
    totals.set(party, current);
  });
  const winner = [...totals.values()].sort((a, b) => (b.votes - a.votes) || (b.share - a.share))[0] || null;
  if (!winner) return null;
  winner.bloc = inferredPartyMetaOrNull(winner.party)?.bloc || '';
  return winner;
}

function showError(message) {
  if (!els.error) return;
  els.error.textContent = message;
  els.error.classList.remove('hidden');
}

// Re-derives `dominant_block` for a summary row by re-inferring the bloc
// of `first_party_std` (or `first_party_raw`, when present) via the JS
// PARTY_FALLBACKS list in modules/shared.js.
//
// The summary CSV's `dominant_block` field is generated by
// scripts/preprocess.py, whose PARTY_FALLBACKS list is much shorter than
// the JS one — so a lot of well-known parties (L'Ulivo, AN, UDC, RC,
// IdV, Pensionati, La Rosa nel Pugno, Verdi pre-AVS, ...) end up
// stamped `bloc=altro` even when the leading party clearly belongs to
// a recognisable bloc. This page only loads `municipality_summary.csv`
// (not the per-party results-long shards), so the cleanest patch we
// can apply at runtime is to look at the leader-party label and let
// the JS taxonomy reclassify it. If the JS list also can't recognise
// the leader we leave the CSV value alone — better to keep an explicit
// `altro` than to fabricate a bloc.
//
// Returns the (possibly overridden) bloc string. Never returns
// undefined; falls back to '' to match the CSV's "no data" sentinel.
function reinferBlockForSummaryRow(row) {
  const fromCsv = (row?.dominant_block || '').trim();
  const leader = String(row?.first_party_std || row?.first_party_raw || row?.first_party || '').trim();
  if (!leader) return fromCsv;
  const meta = inferredPartyMetaOrNull(leader);
  if (!meta) return fromCsv;
  const inferred = (meta.bloc || '').trim();
  if (!inferred || inferred === 'altro') return fromCsv;
  return inferred;
}

async function fetchCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fetch ${path} → ${res.status}`);
  const text = await res.text();
  return new Promise((resolve, reject) => {
    if (typeof window.Papa === 'undefined') {
      reject(new Error('PapaParse non caricato'));
      return;
    }
    window.Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: result => resolve(result.data || []),
      error: err => reject(err),
    });
  });
}

async function loadMunicipalityProfileBundle(municipalityId) {
  try {
    const indexResponse = await fetch(`${DERIVED}/municipality_profiles/index.json`);
    if (!indexResponse.ok) throw new Error(`profile index -> ${indexResponse.status}`);
    const index = await indexResponse.json();
    const chunkKey = index.municipality_chunks?.[municipalityId];
    const chunkPath = chunkKey ? index.chunks?.[chunkKey] : null;
    if (!chunkPath) throw new Error(`profile chunk missing for ${municipalityId}`);
    const chunk = JSON.parse(await fetchAndDecompress(chunkPath));
    return {
      municipalities: chunk.municipalities || [],
      summary: chunk.summary || [],
      nationalByElection: index.national_by_election || {}
    };
  } catch (error) {
    console.warn('Profilo compresso non disponibile, uso il bundle completo', error);
    const [municipalities, summary] = await Promise.all([
      fetchCsv(`${DERIVED}/municipalities_master.csv`),
      fetchCsv(`${DERIVED}/municipality_summary.csv`).catch(() => []),
    ]);
    return { municipalities, summary, nationalByElection: {} };
  }
}

function renderAnagrafica(record) {
  if (!els.anagrafica) return;
  if (!record) {
    els.anagrafica.innerHTML = '<div class="detail-placeholder detail-placeholder-muted">Nessuna anagrafica disponibile per questo comune.</div>';
    return;
  }
  const fields = [
    ['ID comune', record.municipality_id],
    ['Nome corrente', record.name_current || record.municipality_name],
    ['Provincia', record.province_current || record.province],
    ['Regione', record.region_current || record.region],
    ['ID geometrico corrente', record.geometry_id_current || record.geometry_id],
    ['Popolazione (ultima)', fmtInt(record.population_latest)],
    ['Stato territoriale', record.territorial_status || 'attivo'],
  ];
  els.anagrafica.innerHTML = fields
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([label, value]) => `
      <div class="detail-kv">
        <span class="detail-kv-label">${escapeHtml(label)}</span>
        <span class="detail-kv-value">${escapeHtml(value)}</span>
      </div>
    `)
    .join('');
}

function sortRowsByYear(rows) {
  return rows.slice().sort((a, b) => {
    const ya = Number(a.election_year || a.year || 0);
    const yb = Number(b.election_year || b.year || 0);
    return ya - yb;
  });
}

// Build per-election aggregates (national + comune's province) from the
// full summary CSV. Population-weighted: sum(voters) / sum(electors) * 100,
// which is what ISTAT publishes — not the simple mean of the per-comune
// percentages (that would over-weight the smallest mountain villages).
function buildAggregatesByElection(summaryRows, comuneId, municipalities = [], nationalByElection = {}) {
  const currentProvinceById = new Map(municipalities.map(record => [
    String(record.municipality_id || '').trim(),
    String(record.province_current || record.province || '').trim()
  ]));
  const byElection = new Map();
  for (const row of summaryRows) {
    const key = row.election_key;
    if (!key) continue;
    if (!byElection.has(key)) byElection.set(key, []);
    byElection.get(key).push(row);
  }
  const aggregates = new Map();
  for (const [key, rows] of byElection.entries()) {
    const ownRow = rows.find(r => (r.municipality_id || '').trim() === comuneId);
    const ownProvince = currentProvinceById.get(comuneId) || (ownRow?.province || '').trim();
    let nationElectors = 0;
    let nationVoters = 0;
    let nationValid = 0;
    let nationFirstWinShare = 0;
    let nationFirstWinValid = 0;
    let provElectors = 0;
    let provVoters = 0;
    let provFirstShareWeighted = 0;
    let provValidForFirst = 0;
    const blockCountsNation = {};
    const blockCountsProv = {};
    for (const r of rows) {
      const electors = Number(r.electors);
      const voters = Number(r.voters);
      const valid = Number(r.valid_votes);
      const firstShare = Number(r.first_party_share);
      // Use the runtime-reinferred bloc instead of the CSV's
      // `dominant_block` so the modal-block aggregation reflects the
      // JS taxonomy (otherwise huge swathes of comuni in 2006-2008
      // collapse to "altro" because the Python preprocessor's regex
      // list doesn't recognise L'Ulivo / AN / UDC / RC / IdV / etc.).
      const block = reinferBlockForSummaryRow(r);
      if (Number.isFinite(electors) && Number.isFinite(voters)) {
        nationElectors += electors;
        nationVoters += voters;
      }
      if (Number.isFinite(valid)) nationValid += valid;
      if (Number.isFinite(firstShare) && Number.isFinite(valid)) {
        nationFirstWinShare += firstShare * valid;
        nationFirstWinValid += valid;
      }
      if (block) blockCountsNation[block] = (blockCountsNation[block] || 0) + 1;
      const rowProvince = currentProvinceById.get(String(r.municipality_id || '').trim()) || (r.province || '').trim();
      const isOwnProv = ownProvince && rowProvince === ownProvince;
      if (isOwnProv) {
        if (Number.isFinite(electors) && Number.isFinite(voters)) {
          provElectors += electors;
          provVoters += voters;
        }
        if (Number.isFinite(firstShare) && Number.isFinite(valid)) {
          provFirstShareWeighted += firstShare * valid;
          provValidForFirst += valid;
        }
        if (block) blockCountsProv[block] = (blockCountsProv[block] || 0) + 1;
      }
    }
    const modal = counts => {
      const entries = Object.entries(counts);
      if (!entries.length) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    };
    const declared = nationalByElection?.[key] || {};
    const declaredTurnout = declared.turnout_pct == null ? null : Number(declared.turnout_pct);
    const declaredFirstShare = declared.first_party_share == null ? null : Number(declared.first_party_share);
    aggregates.set(key, {
      year: Number(rows[0].election_year),
      nationTurnout: Number.isFinite(declaredTurnout)
        ? declaredTurnout
        : (nationElectors > 0 ? (nationVoters / nationElectors) * 100 : null),
      provinceTurnout: provElectors > 0 ? (provVoters / provElectors) * 100 : null,
      nationFirstShareAvg: Number.isFinite(declaredFirstShare)
        ? declaredFirstShare
        : (nationFirstWinValid > 0 ? nationFirstWinShare / nationFirstWinValid : null),
      provinceFirstShareAvg: provValidForFirst > 0 ? provFirstShareWeighted / provValidForFirst : null,
      nationModalBlock: declared.dominant_block || modal(blockCountsNation),
      provinceModalBlock: modal(blockCountsProv),
      sampleN: Number(declared.municipalities) || rows.length,
      provinceN: Object.values(blockCountsProv).reduce((a, b) => a + b, 0),
      provinceName: ownProvince || null,
    });
  }
  return aggregates;
}

function renderHistory(rows) {
  if (!els.historyBody) return;
  if (!rows.length) {
    els.historyBody.innerHTML = '<tr><td colspan="5" class="detail-placeholder detail-placeholder-muted">Nessun risultato elettorale disponibile per questo comune.</td></tr>';
    return;
  }
  const sorted = sortRowsByYear(rows);
  els.historyBody.innerHTML = sorted.map(row => `
    <tr>
      <td>${escapeHtml(electionDisplayLabel(row))}</td>
      <td>${escapeHtml(row.election_year || row.year || '—')}</td>
      <td>${fmtPct(row.turnout_pct)}</td>
      <td>${fmtInt(row.voti_validi || row.valid_votes)}</td>
      <td>${fmtInt(row.elettori || row.electors)}</td>
    </tr>
  `).join('');
}

// ----- SVG chart helpers -------------------------------------------------

function svgEl(name, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child == null) continue;
    el.appendChild(child);
  }
  return el;
}

function svgText(text, attrs = {}) {
  const el = svgEl('text', attrs);
  el.textContent = text;
  return el;
}

function chartEmpty(container, message) {
  if (!container) return;
  container.innerHTML = `<div class="detail-placeholder detail-placeholder-muted">${escapeHtml(message)}</div>`;
}

function setChartSvg(container, svg) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(svg);
}

function chartDimensions(container) {
  const width = Math.max(320, container?.clientWidth || 480);
  const height = 220;
  const margin = { top: 14, right: 16, bottom: 36, left: 44 };
  return { width, height, margin };
}

// ----- 1. Turnout over time ---------------------------------------------
//
// Three overlaid series: comune (primary), provincia, Italia. Province + Italia
// come from the per-election aggregates pre-computed over the full summary CSV
// (population-weighted, sum(voters)/sum(electors) — see buildAggregatesByElection).

function renderTurnoutChart(rows, aggregates) {
  const container = els.chartTurnout;
  if (!container) return;
  const points = sortRowsByYear(rows)
    .map(row => {
      const year = Number(row.election_year || row.year);
      const turnout = Number(row.turnout_pct);
      if (!Number.isFinite(year) || !Number.isFinite(turnout)) return null;
      const agg = aggregates?.get(row.election_key) || null;
      return {
        year,
        turnout,
        label: row.election_label || row.election_key,
        provinceTurnout: agg?.provinceTurnout ?? null,
        nationTurnout: agg?.nationTurnout ?? null,
        provinceName: agg?.provinceName || row.province || null,
      };
    })
    .filter(Boolean);
  if (!points.length) {
    chartEmpty(container, 'Nessun dato di affluenza per questo comune.');
    return;
  }

  const { width, height, margin } = chartDimensions(container);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const years = points.map(p => p.year);
  const xMin = Math.min(...years);
  const xMax = Math.max(...years);
  const xRange = Math.max(1, xMax - xMin);
  const yMin = 0;
  const yMax = 100;

  const xScale = year => margin.left + ((year - xMin) / xRange) * innerW;
  const yScale = pct => margin.top + (1 - (pct - yMin) / (yMax - yMin)) * innerH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // y grid + axis (every 25%)
  const gridGroup = svgEl('g', { class: 'grid' });
  for (const tick of [0, 25, 50, 75, 100]) {
    gridGroup.appendChild(svgEl('line', {
      x1: margin.left, x2: margin.left + innerW,
      y1: yScale(tick), y2: yScale(tick),
    }));
  }
  svg.appendChild(gridGroup);

  const yAxis = svgEl('g', { class: 'axis' });
  for (const tick of [0, 25, 50, 75, 100]) {
    yAxis.appendChild(svgText(`${tick}%`, {
      x: margin.left - 8,
      y: yScale(tick) + 4,
      'text-anchor': 'end',
    }));
  }
  svg.appendChild(yAxis);

  // x axis labels — show first, last, and any spaced years
  const xAxis = svgEl('g', { class: 'axis' });
  const seenYears = new Set();
  const yearsToShow = points.length <= 6
    ? points.map(p => p.year)
    : [points[0].year, points[Math.floor(points.length / 2)].year, points[points.length - 1].year];
  for (const yr of yearsToShow) {
    if (seenYears.has(yr)) continue;
    seenYears.add(yr);
    xAxis.appendChild(svgText(String(yr), {
      x: xScale(yr),
      y: margin.top + innerH + 16,
      'text-anchor': 'middle',
    }));
  }
  xAxis.appendChild(svgEl('line', {
    x1: margin.left, x2: margin.left + innerW,
    y1: margin.top + innerH, y2: margin.top + innerH,
  }));
  svg.appendChild(xAxis);

  // Reference series (Italia + provincia) sit BEHIND the comune line.
  // The first surviving segment must be a `moveto` (`M`) regardless of how
  // many leading points have null aggregate values — using the original
  // index from `points.map` and filtering afterwards would emit a path that
  // starts with `L`, drawing a stray diagonal from (0,0) to the first valid
  // point. Track the "first emitted" state with a flag instead.
  const seriesGroup = svgEl('g');
  const buildPath = (key) => {
    let started = false;
    const segments = [];
    for (const p of points) {
      const v = p[key];
      if (!Number.isFinite(v)) continue;
      const cmd = started ? 'L' : 'M';
      started = true;
      segments.push(`${cmd}${xScale(p.year).toFixed(2)},${yScale(v).toFixed(2)}`);
    }
    return segments.join(' ');
  };
  const nationPath = buildPath('nationTurnout');
  if (nationPath) {
    seriesGroup.appendChild(svgEl('path', {
      class: 'series-line series-line-italy',
      d: nationPath,
    }));
  }
  const provPath = buildPath('provinceTurnout');
  if (provPath) {
    seriesGroup.appendChild(svgEl('path', {
      class: 'series-line series-line-province',
      d: provPath,
    }));
  }
  // comune (primary) always last so it stays on top.
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.year).toFixed(2)},${yScale(p.turnout).toFixed(2)}`).join(' ');
  seriesGroup.appendChild(svgEl('path', { class: 'series-line', d: path }));
  svg.appendChild(seriesGroup);

  for (const p of points) {
    const dot = svgEl('circle', {
      class: 'series-dot',
      cx: xScale(p.year),
      cy: yScale(p.turnout),
      r: 3.5,
    });
    const title = svgEl('title');
    const lines = [`${p.label || p.year}: ${p.turnout.toFixed(2)}%`];
    if (Number.isFinite(p.provinceTurnout)) {
      const provName = p.provinceName ? ` (${p.provinceName})` : '';
      lines.push(`Provincia${provName}: ${p.provinceTurnout.toFixed(2)}%`);
    }
    if (Number.isFinite(p.nationTurnout)) lines.push(`Italia: ${p.nationTurnout.toFixed(2)}%`);
    title.textContent = lines.join(' · ');
    dot.appendChild(title);
    svg.appendChild(dot);
  }

  setChartSvg(container, svg);
}

// ----- 2. Margin of victory bars ----------------------------------------

function renderMarginChart(rows) {
  const container = els.chartMargin;
  if (!container) return;
  const items = sortRowsByYear(rows)
    .map(row => {
      const year = Number(row.election_year || row.year);
      const margin = Number(row.first_second_margin);
      if (!Number.isFinite(year) || !Number.isFinite(margin)) return null;
      return {
        year,
        margin,
        leader: row.first_party_std || '—',
        runnerUp: row.second_party_std || '—',
        label: row.election_label || row.election_key,
      };
    })
    .filter(Boolean);
  if (!items.length) {
    chartEmpty(container, 'Margine non disponibile per questo comune.');
    return;
  }

  const { width, height, margin } = chartDimensions(container);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const maxMargin = Math.max(20, ...items.map(d => d.margin));
  const barWidth = Math.min(28, Math.max(6, innerW / items.length - 4));
  const xStep = innerW / items.length;
  const yScale = v => margin.top + (1 - v / maxMargin) * innerH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // grid + y axis
  const gridGroup = svgEl('g', { class: 'grid' });
  const yAxis = svgEl('g', { class: 'axis' });
  const tickStep = maxMargin > 60 ? 20 : maxMargin > 30 ? 10 : 5;
  for (let v = 0; v <= maxMargin + 0.001; v += tickStep) {
    gridGroup.appendChild(svgEl('line', {
      x1: margin.left, x2: margin.left + innerW,
      y1: yScale(v), y2: yScale(v),
    }));
    yAxis.appendChild(svgText(`${v.toFixed(0)} pt`, {
      x: margin.left - 8, y: yScale(v) + 4, 'text-anchor': 'end',
    }));
  }
  svg.appendChild(gridGroup);
  svg.appendChild(yAxis);

  // bars
  items.forEach((d, i) => {
    const cx = margin.left + i * xStep + xStep / 2;
    const x = cx - barWidth / 2;
    const y = yScale(d.margin);
    const h = (margin.top + innerH) - y;
    const bar = svgEl('rect', {
      class: 'series-bar',
      x, y,
      width: barWidth,
      height: Math.max(1, h),
      rx: 2,
    });
    const title = svgEl('title');
    title.textContent = `${d.label || d.year}: ${d.margin.toFixed(1)} pt (${d.leader} vs ${d.runnerUp})`;
    bar.appendChild(title);
    svg.appendChild(bar);
  });

  // x labels — endpoints + middle
  const xAxis = svgEl('g', { class: 'axis' });
  xAxis.appendChild(svgEl('line', {
    x1: margin.left, x2: margin.left + innerW,
    y1: margin.top + innerH, y2: margin.top + innerH,
  }));
  const labelIdxs = items.length <= 6
    ? items.map((_, i) => i)
    : [0, Math.floor(items.length / 2), items.length - 1];
  for (const i of [...new Set(labelIdxs)]) {
    const cx = margin.left + i * xStep + xStep / 2;
    xAxis.appendChild(svgText(String(items[i].year), {
      x: cx, y: margin.top + innerH + 16, 'text-anchor': 'middle',
    }));
  }
  svg.appendChild(xAxis);

  setChartSvg(container, svg);
}

// ----- 3. Leader timeline ----------------------------------------------

const PARTY_FAMILY_COLORS = {
  PD: '#ef4444', DS: '#ef4444', PCI: '#b91c1c', PSI: '#dc2626',
  M5S: '#f59e0b', LEGA: '#16a34a', LN: '#16a34a',
  FI: '#2563eb', FDI: '#1e3a8a', AN: '#1e3a8a', MSI: '#1e3a8a',
  DC: '#0ea5e9', UDC: '#0ea5e9', PRI: '#7c3aed', PLI: '#a855f7',
  IV: '#f43f5e', AZIONE: '#f43f5e', AZ: '#f43f5e',
  PSDI: '#fb7185', RAD: '#a3e635',
  SVP: '#94a3b8', UV: '#94a3b8',
};

function colorForParty(name) {
  if (!name) return '#64748b';
  const key = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const k of Object.keys(PARTY_FAMILY_COLORS)) {
    if (key.includes(k)) return PARTY_FAMILY_COLORS[k];
  }
  // hash-fallback (deterministic)
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 55% 45%)`;
}

function renderLeaderChart(rows) {
  const container = els.chartLeader;
  if (!container) return;
  const items = sortRowsByYear(rows)
    .map(row => {
      const year = Number(row.election_year || row.year);
      const leader = row.first_party_raw || row.first_party_std;
      if (!Number.isFinite(year) || !leader) return null;
      const share = Number(row.first_party_share);
      return {
        year,
        leader: publicPartyLabel(leader, row.election_key),
        share: Number.isFinite(share) ? share : null,
        label: row.election_label || row.election_key,
      };
    })
    .filter(Boolean);
  if (!items.length) {
    chartEmpty(container, 'Primo partito non disponibile per questo comune.');
    return;
  }

  const containerWidth = Math.max(320, container.clientWidth || 480);
  const margin = { top: 14, right: 12, bottom: 28, left: 12 };
  const tileH = 40;
  const tileGap = 4;
  // Honor a minimum tile width so labels stay legible, but expand the viewBox
  // (not the container) so all tiles fit. The SVG's `preserveAspectRatio` then
  // scales the whole strip down to the container — chart shrinks vertically a
  // touch instead of clipping the right-hand tiles.
  const naturalTileW = (containerWidth - margin.left - margin.right - tileGap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
  const tileW = Math.max(40, naturalTileW);
  const layoutWidth = margin.left + margin.right + items.length * tileW + Math.max(0, items.length - 1) * tileGap;
  const width = Math.max(containerWidth, layoutWidth);
  const height = margin.top + tileH + margin.bottom;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  items.forEach((d, i) => {
    const x = margin.left + i * (tileW + tileGap);
    const tile = svgEl('g', { class: 'leader-tile' });
    const rect = svgEl('rect', {
      x, y: margin.top, width: tileW, height: tileH, rx: 6,
      fill: colorForParty(d.leader),
    });
    const title = svgEl('title');
    title.textContent = `${d.label || d.year}: ${d.leader}${d.share != null ? ` — ${d.share.toFixed(2)}%` : ''}`;
    rect.appendChild(title);
    tile.appendChild(rect);
    tile.appendChild(svgText(d.leader.length > 8 ? `${d.leader.slice(0, 7)}…` : d.leader, {
      x: x + tileW / 2,
      y: margin.top + tileH / 2 + 1,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      class: 'leader-name',
    }));
    if (d.share != null) {
      tile.appendChild(svgText(`${d.share.toFixed(1)}%`, {
        x: x + tileW / 2,
        y: margin.top + tileH - 6,
        'text-anchor': 'middle',
        class: 'leader-share',
      }));
    }
    tile.appendChild(svgText(String(d.year), {
      x: x + tileW / 2,
      y: margin.top + tileH + 14,
      'text-anchor': 'middle',
      fill: '#475569',
      'font-size': 11,
    }));
    svg.appendChild(tile);
  });

  setChartSvg(container, svg);
}

// ----- 4. Dominant block timeline ---------------------------------------
//
// Two parallel strips of categorical tiles (centro · centrosinistra · …) for
// each election covered: the comune on top, the modal block of all comuni in
// Italy on a thinner strip below. Lets the visitor see at a glance whether
// the comune voted with or against the country in each cycle.

function renderBlockChart(rows, aggregates) {
  const container = els.chartBlock;
  if (!container) return;
  const items = sortRowsByYear(rows)
    .map(row => {
      const year = Number(row.election_year || row.year);
      if (!Number.isFinite(year)) return null;
      const block = (row.dominant_block || '').trim();
      const agg = aggregates?.get(row.election_key) || null;
      return {
        year,
        block,
        nationBlock: agg?.nationModalBlock || '',
        label: row.election_label || row.election_key,
      };
    })
    .filter(Boolean);
  if (!items.length) {
    chartEmpty(container, 'Blocco dominante non disponibile per questo comune.');
    return;
  }

  const containerWidth = Math.max(320, container.clientWidth || 480);
  const margin = { top: 16, right: 12, bottom: 28, left: 12 };
  const tileH = 30;
  const stripGap = 4;
  const tileGap = 4;
  const naturalTileW = (containerWidth - margin.left - margin.right - tileGap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
  const tileW = Math.max(40, naturalTileW);
  const layoutWidth = margin.left + margin.right + items.length * tileW + Math.max(0, items.length - 1) * tileGap;
  const width = Math.max(containerWidth, layoutWidth);
  const height = margin.top + tileH + stripGap + tileH * 0.55 + margin.bottom + 14;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // Row labels (on the left edge of each strip)
  svg.appendChild(svgText('Comune', {
    x: margin.left,
    y: margin.top - 4,
    'font-size': 10,
    fill: '#64748b',
    'font-weight': 600,
    'letter-spacing': '0.04em',
    'text-transform': 'uppercase',
  }));
  svg.appendChild(svgText('Italia (modale)', {
    x: margin.left,
    y: margin.top + tileH + stripGap - 2,
    'font-size': 10,
    fill: '#94a3b8',
    'letter-spacing': '0.04em',
    'text-transform': 'uppercase',
  }));

  items.forEach((d, i) => {
    const x = margin.left + i * (tileW + tileGap);
    // Comune strip (taller, full color)
    const comuneRect = svgEl('rect', {
      class: 'block-tile',
      x,
      y: margin.top,
      width: tileW,
      height: tileH,
      rx: 5,
      fill: BLOCK_COLORS[d.block] ?? BLOCK_COLORS[''],
    });
    const comuneTitle = svgEl('title');
    const comuneBlockLabel = BLOCK_LABEL[d.block] ?? (d.block || 'n.d.');
    const nationBlockLabel = BLOCK_LABEL[d.nationBlock] ?? d.nationBlock;
    comuneTitle.textContent = `${d.label || d.year} — Comune: ${comuneBlockLabel}` +
      (d.nationBlock ? `; Italia (modale): ${nationBlockLabel}` : '');
    comuneRect.appendChild(comuneTitle);
    svg.appendChild(comuneRect);
    if (tileW >= 38) {
      svg.appendChild(svgText(BLOCK_LABEL[d.block] ?? (d.block || 'n.d.'), {
        x: x + tileW / 2,
        y: margin.top + tileH / 2 + 4,
        'text-anchor': 'middle',
        class: 'block-tile-label',
      }));
    }

    // Italia strip (shorter, lower opacity reference)
    const refRect = svgEl('rect', {
      class: 'block-tile-ref',
      x,
      y: margin.top + tileH + stripGap,
      width: tileW,
      height: tileH * 0.55,
      rx: 4,
      fill: BLOCK_COLORS[d.nationBlock] ?? BLOCK_COLORS[''],
      'fill-opacity': d.nationBlock ? 0.55 : 0.25,
    });
    const refTitle = svgEl('title');
    refTitle.textContent = d.nationBlock
      ? `Italia (${d.label || d.year}): blocco modale ${BLOCK_LABEL[d.nationBlock] ?? d.nationBlock}`
      : `Italia (${d.label || d.year}): n.d.`;
    refRect.appendChild(refTitle);
    svg.appendChild(refRect);

    svg.appendChild(svgText(String(d.year), {
      x: x + tileW / 2,
      y: margin.top + tileH + stripGap + tileH * 0.55 + 14,
      'text-anchor': 'middle',
      fill: '#475569',
      'font-size': 11,
    }));
  });

  setChartSvg(container, svg);
}

// ----- 5. KPI strip (comune vs Italia summary) --------------------------
//
// Tabler-style KPI tiles at the top of the charts section. Computes
// comune-mean vs nation-weighted-mean for turnout and first-party share,
// counts distinct first-parties (volatility), and lists the modal block.

function renderKpiStrip(rows, aggregates) {
  const container = els.kpiStrip;
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<div class="detail-placeholder detail-placeholder-muted">Nessun dato di confronto disponibile.</div>';
    return;
  }

  // Comune-side averages (mean over the elections we have).
  const comuneTurnouts = rows.map(r => Number(r.turnout_pct)).filter(Number.isFinite);
  const comuneFirstShares = rows.map(r => Number(r.first_party_share)).filter(Number.isFinite);
  const comuneTurnoutAvg = comuneTurnouts.length
    ? comuneTurnouts.reduce((a, b) => a + b, 0) / comuneTurnouts.length : null;
  const comuneFirstAvg = comuneFirstShares.length
    ? comuneFirstShares.reduce((a, b) => a + b, 0) / comuneFirstShares.length : null;

  // Nation-side averages over the SAME elections (so the delta is comparable).
  const nationTurnouts = [];
  const nationFirstShares = [];
  const blockCountsComune = {};
  for (const r of rows) {
    const agg = aggregates?.get(r.election_key);
    if (agg && Number.isFinite(agg.nationTurnout)) nationTurnouts.push(agg.nationTurnout);
    if (agg && Number.isFinite(agg.nationFirstShareAvg)) nationFirstShares.push(agg.nationFirstShareAvg);
    const block = reinferBlockForSummaryRow(r);
    if (block) blockCountsComune[block] = (blockCountsComune[block] || 0) + 1;
  }
  const nationTurnoutAvg = nationTurnouts.length
    ? nationTurnouts.reduce((a, b) => a + b, 0) / nationTurnouts.length : null;
  const nationFirstAvg = nationFirstShares.length
    ? nationFirstShares.reduce((a, b) => a + b, 0) / nationFirstShares.length : null;

  const distinctFirstParties = new Set(
    rows.map(r => (r.first_party_raw || r.first_party_std || '').trim()).filter(Boolean)
  );
  const modalBlockEntry = Object.entries(blockCountsComune).sort((a, b) => b[1] - a[1])[0];
  const modalBlock = modalBlockEntry ? modalBlockEntry[0] : '';
  const modalBlockShare = modalBlockEntry && rows.length
    ? (modalBlockEntry[1] / rows.length) * 100 : null;

  const fmtDelta = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const d = a - b;
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '');
    return `${sign}${Math.abs(d).toFixed(1)} pt`;
  };
  const turnoutDelta = fmtDelta(comuneTurnoutAvg, nationTurnoutAvg);
  const firstDelta = fmtDelta(comuneFirstAvg, nationFirstAvg);

  const tiles = [
    {
      label: 'Affluenza media',
      value: Number.isFinite(comuneTurnoutAvg) ? `${comuneTurnoutAvg.toFixed(1)}%` : '—',
      hint: turnoutDelta != null
        ? `Δ Italia ${turnoutDelta} (${rows.length} elezioni)`
        : `${rows.length} elezioni coperte`,
      tone: comuneTurnoutAvg != null && nationTurnoutAvg != null
        ? (comuneTurnoutAvg > nationTurnoutAvg ? 'positive' : (comuneTurnoutAvg < nationTurnoutAvg ? 'negative' : 'neutral'))
        : 'neutral',
    },
    {
      label: 'Quota media primo partito',
      value: Number.isFinite(comuneFirstAvg) ? `${comuneFirstAvg.toFixed(1)}%` : '—',
      hint: firstDelta != null
        ? `Δ Italia ${firstDelta}`
        : 'Quota media del partito vincente nelle elezioni coperte',
      tone: 'neutral',
    },
    {
      label: 'Vincitori diversi',
      value: distinctFirstParties.size ? `${distinctFirstParties.size} partiti` : '—',
      hint: distinctFirstParties.size <= 1
        ? 'Sempre lo stesso vincitore'
        : `${distinctFirstParties.size} partiti diversi hanno vinto nel comune`,
      tone: 'neutral',
    },
    {
      label: 'Area più frequente',
      value: BLOCK_LABEL[modalBlock] ?? (modalBlock || '—'),
      hint: modalBlockShare != null
        ? `Vince in ${modalBlockShare.toFixed(0)}% delle elezioni coperte`
        : 'Non disponibile',
      tone: 'neutral',
    },
  ];

  container.innerHTML = tiles.map(t => `
    <div class="detail-kpi-card detail-kpi-${escapeHtml(t.tone)}">
      <span class="detail-kpi-label">${escapeHtml(t.label)}</span>
      <span class="detail-kpi-value">${escapeHtml(t.value)}</span>
      <span class="detail-kpi-hint">${escapeHtml(t.hint)}</span>
    </div>
  `).join('');
}

// ----- 6. "Vincitore per elezione" timeline -----------------------------
//
// Compact, scannable table that gives the user a one-screen historical
// compare across all elections covered for the comune. Each row is one
// election (newest first) and emits:
//   - winning party (with a "flip" badge if it changed vs the previous
//     covered election)
//   - winning party share (%)
//   - winning bloc (re-inferred via the JS taxonomy — see
//     `reinferBlockForSummaryRow`) with a "flip" badge if it differs
//   - lead margin (1° vs 2° in percentage points)
//   - Δ winning share in pp vs the previous covered election
//   - Δ turnout in pp vs the previous covered election
//
// "Previous" is the previous covered election in the comune's history,
// not necessarily the previous chronological one — for comuni born late
// (e.g. comuni created post-fusion) the chain skips the missing years.

function deltaCellHtml(delta) {
  if (delta == null || !Number.isFinite(delta)) {
    return '<span class="detail-winners-delta detail-winners-delta-na">—</span>';
  }
  const eps = 0.05;
  const sign = delta > eps ? '+' : (delta < -eps ? '−' : '±');
  const tone = delta > eps ? 'detail-winners-delta-pos'
    : (delta < -eps ? 'detail-winners-delta-neg' : 'detail-winners-delta-flat');
  const abs = Math.abs(delta).toFixed(1);
  return `<span class="detail-winners-delta ${tone}">${sign}${abs} pt</span>`;
}

function renderWinnersTimeline(rows) {
  const tbody = els.winnersBody;
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="detail-placeholder detail-placeholder-muted">Nessun risultato elettorale disponibile per questo comune.</td></tr>';
    return;
  }
  // Iterate chronologically so we can compute "vs previous" deltas,
  // then reverse the emitted rows so the user sees newest-first.
  const asc = sortRowsByYear(rows);
  const enriched = [];
  let prevShare = null;
  let prevTurnout = null;
  let prevBlock = null;
  let prevLeader = null;
  for (const row of asc) {
    const leaderRaw = String(row.first_party_raw || row.first_party_std || '').trim();
    const leader = publicPartyLabel(leaderRaw, row.election_key);
    const share = Number(row.first_party_share);
    const margin = Number(row.first_second_margin);
    const turnout = Number(row.turnout_pct);
    const block = reinferBlockForSummaryRow(row);

    const shareDelta = prevShare != null && Number.isFinite(share) ? share - prevShare : null;
    const turnoutDelta = prevTurnout != null && Number.isFinite(turnout) ? turnout - prevTurnout : null;
    const leaderChange = !!(prevLeader && leader && leader !== prevLeader);
    const blockChange = !!(prevBlock && block && block !== prevBlock);

    enriched.push({
      row,
      leader,
      share,
      margin,
      turnout,
      block,
      shareDelta,
      turnoutDelta,
      leaderChange,
      blockChange,
    });

    if (Number.isFinite(share)) prevShare = share;
    if (Number.isFinite(turnout)) prevTurnout = turnout;
    if (leader) prevLeader = leader;
    if (block) prevBlock = block;
  }

  const desc = enriched.slice().reverse();
  tbody.innerHTML = desc.map(e => {
    const { row, leader, share, margin, turnout, block, shareDelta, turnoutDelta, leaderChange, blockChange } = e;
    const year = row.election_year || row.year || '';
    const label = String(row.election_key || '').includes('assemblea_costituente') ? 'Costituente' : 'Camera';
    const blockColor = BLOCK_COLORS[block] || BLOCK_COLORS[''];
    const blockLabel = BLOCK_LABEL[block] ?? (block || '—');
    return `
      <tr>
        <th scope="row" class="detail-winners-year">
          <strong>${escapeHtml(String(year))}</strong>
          <small>${escapeHtml(label)}</small>
        </th>
        <td class="detail-winners-leader">
          <span class="detail-winners-leader-name">${escapeHtml(leader || '—')}</span>
          ${leaderChange ? '<span class="detail-winners-badge detail-winners-badge-flip" title="Cambio di partito vincitore rispetto all\'elezione precedente">cambio</span>' : ''}
        </td>
        <td class="detail-winners-share">${Number.isFinite(share) ? `${share.toFixed(2)}%` : '—'}</td>
        <td class="detail-winners-block">
          <span class="detail-winners-bloc-pill" style="background:${blockColor}1a; color:${blockColor}; border-color:${blockColor}33">
            <span class="detail-winners-bloc-dot" style="background:${blockColor}"></span>
            ${escapeHtml(blockLabel)}
          </span>
          ${blockChange ? '<span class="detail-winners-badge detail-winners-badge-flip" title="Cambio di area politica rispetto all\'elezione precedente">cambio</span>' : ''}
        </td>
        <td class="detail-winners-margin">${Number.isFinite(margin) ? `${margin.toFixed(1)} pt` : '—'}</td>
        <td class="detail-winners-delta-cell">${deltaCellHtml(shareDelta)}</td>
        <td class="detail-winners-delta-cell">${deltaCellHtml(turnoutDelta)}</td>
      </tr>`;
  }).join('');
}

function renderCharts(rows, aggregates) {
  renderTurnoutChart(rows, aggregates);
  renderMarginChart(rows);
  renderLeaderChart(rows);
  renderBlockChart(rows, aggregates);
}

// ----- 6. Bloc composition timeline ------------------------------------
//
// Historical comparison of bloc shares in this comune, one row per
// election. The detail page only loads `municipality_summary.csv`
// (slim, ~few MB) on its own, so to compute bloc shares we have to
// pull the per-election results-long shards. They are split per
// election (gzipped ~1.5–2.2MB each, 20 shards), so we fetch them in
// parallel and render each row as soon as its shard arrives — the
// user sees the most-recent elections first while older shards
// stream in.
//
// Aggregation is the same the JS dashboard does: re-infer the bloc
// from `party_raw` via the runtime taxonomy in modules/shared.js,
// sum `vote_share` per bloc.

const BLOC_ORDER = ['destra', 'centro-destra', 'centro', 'centro-sinistra', 'sinistra', 'populista', 'altro'];

async function fetchAndDecompress(path) {
  const isGz = String(path || '').endsWith('.gz');
  const res = await fetch(path);
  if (!res.ok) {
    if (isGz) {
      // Some static hosts strip the .gz; fall back to the
      // uncompressed sibling. Slower (10×) but at least works.
      return fetchAndDecompress(String(path).replace(/\.gz$/, ''));
    }
    throw new Error(`Fetch ${path} → ${res.status}`);
  }
  if (!isGz) return res.text();
  if (typeof DecompressionStream !== 'function') {
    // Safari < 16.4 / very old browsers — fall back to uncompressed.
    return fetchAndDecompress(String(path).replace(/\.gz$/, ''));
  }
  const blob = await res.blob();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function parseCsvStream(text) {
  if (typeof window.Papa === 'undefined') return [];
  const result = window.Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  return result.data || [];
}

// Computes bloc shares for `comuneId` inside a parsed results-long
// shard. Returns { blocs: [{bloc, share, votes}], totalShare,
// totalVotes } or null if the comune isn't in the shard.
function blocSharesForShard(rows, comuneId) {
  const totals = new Map();
  const parties = new Map();
  let totalVotes = 0;
  let totalShare = 0;
  let found = false;
  for (const row of rows) {
    if ((row.municipality_id || '').trim() !== comuneId) continue;
    found = true;
    const raw = String(row.party_raw || row.party_std || '').trim();
    const meta = raw ? inferredPartyMetaOrNull(raw) : null;
    let bloc = (meta?.bloc || row.bloc || '').trim();
    if (!bloc) bloc = 'altro';
    const share = Number(row.vote_share);
    const votes = Number(row.votes);
    if (!Number.isFinite(share)) continue;
    const cur = totals.get(bloc) || { share: 0, votes: 0 };
    cur.share += share;
    if (Number.isFinite(votes)) cur.votes += votes;
    totals.set(bloc, cur);
    if (raw) {
      const party = parties.get(raw) || { party: raw, share: 0, votes: 0, bloc };
      party.share += share;
      if (Number.isFinite(votes)) party.votes += votes;
      parties.set(raw, party);
    }
    totalShare += share;
    if (Number.isFinite(votes)) totalVotes += votes;
  }
  if (!found) return null;
  const blocs = [...totals.entries()]
    .map(([bloc, v]) => ({ bloc, share: v.share, votes: v.votes }))
    .filter(d => Number.isFinite(d.share) && d.share > 0);
  // Sort using the political continuum order (destra → sinistra → populista → altro)
  // so stacked bars are visually consistent across years.
  blocs.sort((a, b) => {
    const ai = BLOC_ORDER.indexOf(a.bloc);
    const bi = BLOC_ORDER.indexOf(b.bloc);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const winner = [...parties.values()]
    .sort((a, b) => (b.votes - a.votes) || (b.share - a.share))[0] || null;
  return { blocs, totalShare, totalVotes, winner };
}

function blocCompositionRowHtml(electionKey, electionLabel, year, data) {
  if (!data || !data.blocs.length) {
    return `
      <li class="detail-bloc-row detail-bloc-row-empty" data-election="${escapeHtml(electionKey)}">
        <span class="detail-bloc-year">${escapeHtml(String(year || electionLabel || electionKey))}</span>
        <span class="detail-bloc-empty">Nessun risultato disponibile per il comune in questa elezione.</span>
      </li>`;
  }
  const total = data.totalShare || 100;
  const segments = data.blocs.map(b => {
    const width = Math.max(0, Math.min(100, (b.share / total) * 100));
    const color = BLOCK_COLORS[b.bloc] || '#94a3b8';
    const title = `${BLOCK_LABEL[b.bloc] || b.bloc}: ${b.share.toFixed(1)}%`;
    return `<span class="detail-bloc-seg" style="flex: ${width.toFixed(3)} 1 0; background: ${color}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>`;
  }).join('');
  // Compact legend on the right: top-3 blocs with %.
  const top = data.blocs.slice().sort((a, b) => b.share - a.share).slice(0, 3);
  const legend = top.map(b => `
    <span class="detail-bloc-chip" style="background:${BLOCK_COLORS[b.bloc] || '#94a3b8'}1a; color:${BLOCK_COLORS[b.bloc] || '#94a3b8'}">
      <span class="detail-bloc-dot" style="background:${BLOCK_COLORS[b.bloc] || '#94a3b8'}"></span>
      ${escapeHtml(BLOCK_LABEL[b.bloc] || b.bloc)} ${b.share.toFixed(1)}%
    </span>`).join('');
  return `
    <li class="detail-bloc-row" data-election="${escapeHtml(electionKey)}">
      <span class="detail-bloc-year">${escapeHtml(String(year || electionLabel || electionKey))}</span>
      <span class="detail-bloc-bar">${segments}</span>
      <span class="detail-bloc-legend">${legend}</span>
    </li>`;
}

function loadingRowHtml(electionKey, electionLabel, year) {
  return `
    <li class="detail-bloc-row detail-bloc-row-loading" data-election="${escapeHtml(electionKey)}">
      <span class="detail-bloc-year">${escapeHtml(String(year || electionLabel || electionKey))}</span>
      <span class="detail-bloc-bar detail-bloc-bar-skeleton" aria-hidden="true"></span>
      <span class="detail-bloc-legend detail-bloc-legend-loading">caricamento…</span>
    </li>`;
}

async function renderBlocComposition(comuneId, summaryRows, aggregates = null) {
  const container = els.chartBlocComposition;
  if (!container) return;
  // Use the elections that the summary already lists for this comune as
  // the row order — we already know coverage. Sort newest-first so the
  // most-relevant elections render first as their shard arrives.
  const sorted = sortRowsByYear(summaryRows).slice().reverse();
  if (!sorted.length) {
    chartEmpty(container, 'Nessuna elezione disponibile per il comune.');
    return;
  }
  // 1. Fetch the manifest to discover shard paths.
  let manifest;
  try {
    const res = await fetch(`${DERIVED}/manifest.json`);
    if (!res.ok) throw new Error(`manifest → ${res.status}`);
    const root = await res.json();
    const shardRes = await fetch(root.files?.municipalityResultsLongByElectionIndex || `${DERIVED}/municipality_results_long_by_election.json`);
    if (!shardRes.ok) throw new Error(`shard index → ${shardRes.status}`);
    manifest = await shardRes.json();
  } catch (err) {
    console.error('Errore caricamento manifest blocchi', err);
    chartEmpty(container, 'Impossibile caricare la composizione storica del voto.');
    return;
  }
  const shards = manifest.shards || {};
  // 2. Build placeholder rows in election order.
  const ordered = sorted.map(r => ({
    electionKey: (r.election_key || '').trim(),
    electionLabel: r.election_label || r.election_key,
    year: Number(r.election_year || r.year),
  }));
  container.innerHTML = `<ol class="detail-bloc-list">${ordered.map(o => loadingRowHtml(o.electionKey, o.electionLabel, o.year)).join('')}</ol>`;

  // Load newest elections first without saturating the browser or network.
  const rendered = new Map();
  let nextEntry = 0;
  const loadEntry = async (entry) => {
    const path = shards[entry.electionKey];
    if (!path) {
      const li = container.querySelector(`li[data-election="${cssEscape(entry.electionKey)}"]`);
      if (li) li.outerHTML = blocCompositionRowHtml(entry.electionKey, entry.electionLabel, entry.year, null);
      return;
    }
    try {
      const text = await fetchAndDecompress(path);
      const rows = parseCsvStream(text);
      const result = blocSharesForShard(rows, comuneId);
      rendered.set(entry.electionKey, result);
      const li = container.querySelector(`li[data-election="${cssEscape(entry.electionKey)}"]`);
      if (li) li.outerHTML = blocCompositionRowHtml(entry.electionKey, entry.electionLabel, entry.year, result);
    } catch (err) {
      console.error('Errore caricamento shard blocco', entry.electionKey, err);
      const li = container.querySelector(`li[data-election="${cssEscape(entry.electionKey)}"]`);
      if (li) {
        li.outerHTML = `<li class="detail-bloc-row detail-bloc-row-empty" data-election="${escapeHtml(entry.electionKey)}">
          <span class="detail-bloc-year">${escapeHtml(String(entry.year || entry.electionKey))}</span>
          <span class="detail-bloc-empty">Dati non disponibili per questa elezione.</span>
        </li>`;
      }
    }
  };
  const workers = Array.from({ length: Math.min(3, ordered.length) }, async () => {
    while (nextEntry < ordered.length) {
      const entry = ordered[nextEntry];
      nextEntry += 1;
      await loadEntry(entry);
    }
  });
  await Promise.all(workers);

  const refinedRows = summaryRows.map(row => {
    const winner = rendered.get(String(row.election_key || '').trim())?.winner;
    if (!winner) return row;
    return {
      ...row,
      first_party_raw: winner.party,
      first_party_std: winner.party,
      first_party_share: winner.share,
      dominant_block: winner.bloc || row.dominant_block
    };
  });
  renderWinnersTimeline(refinedRows);
  renderLeaderChart(refinedRows);
  renderBlockChart(refinedRows, aggregates);
  renderKpiStrip(refinedRows, aggregates);
}

// CSS.escape polyfill — CSS.escape is supported in all modern browsers
// but not in very old Safari versions. The shard keys we use are
// well-formed identifiers so a basic escape is enough here.
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function main() {
  arrangeDetailSections();
  const { id, election } = getParams();
  if (!id) {
    showError('Parametro "id" mancante. Apri il dettaglio da un comune selezionato sulla dashboard.');
    if (els.name) els.name.textContent = 'Dettaglio comune';
    return;
  }

  try {
    const { municipalities, summary, nationalByElection } = await loadMunicipalityProfileBundle(id);

    const record = municipalities.find(row => (row.municipality_id || '').trim() === id) || null;
    const rows = summary.filter(row => (row.municipality_id || '').trim() === id);

    const displayName = record?.name_current || record?.municipality_name || record?.name_historical || id;
    if (els.name) els.name.textContent = displayName;
    if (els.standfirst) {
      const province = record?.province_current || record?.province || '';
      const region = record?.region_current || record?.region || '';
      const bits = [province, region].filter(Boolean).join(' · ');
      els.standfirst.textContent = bits
        ? `${bits}. Il voto nel comune, elezione per elezione.`
        : 'Il voto nel comune, elezione per elezione.';
    }
    document.title = `Electio Italia | ${displayName}`;

    const aggregates = buildAggregatesByElection(summary, id, municipalities, nationalByElection);
    const sortedRows = sortRowsByYear(rows);
    const activeRow = rows.find(row => row.election_key === election) || sortedRows.at(-1) || null;

    renderCurrentElection(activeRow, id);
    renderAnagrafica(record);
    renderHistory(rows);
    renderKpiStrip(rows, aggregates);
    renderWinnersTimeline(rows);
    renderCharts(rows, aggregates);

    if (activeRow?.election_key) {
      loadExactWinner(id, activeRow.election_key)
        .then(winner => {
          if (winner) renderCurrentElection(activeRow, id, winner);
        })
        .catch(error => console.warn('Vincitore esatto non disponibile', error));
    }

    // Bloc-composition chart needs the per-election results-long shards
    // (~30 MB gzipped total). Defer until the section scrolls into view
    // so the rest of the detail page stays snappy. Only triggers once.
    if (els.chartBlocComposition && typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            renderBlocComposition(id, rows, aggregates).catch(err => {
              console.error('renderBlocComposition failed', err);
            });
            return;
          }
        }
      }, { rootMargin: '300px 0px' });
      io.observe(els.chartBlocComposition);
    } else if (els.chartBlocComposition) {
      // Fallback for browsers without IntersectionObserver: just load eagerly.
      renderBlocComposition(id, rows, aggregates).catch(err => {
        console.error('renderBlocComposition failed', err);
      });
    }
  } catch (err) {
    console.error(err);
    showError('Errore nel caricamento dei dati del comune. Riprova aggiornando la pagina.');
  }
}

main();
