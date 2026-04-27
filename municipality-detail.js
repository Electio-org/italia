// Standalone script for municipality-detail.html.
// Reads ?id=<municipality_id> from the URL, fetches the slim derived CSVs
// already shipped with the bundle, and renders anagrafica + storico + 3
// SVG charts (turnout over time, winner margin, leader timeline).

const DERIVED = 'data/derived';
const SVG_NS = 'http://www.w3.org/2000/svg';

const els = {
  name: document.getElementById('detail-name'),
  standfirst: document.getElementById('detail-standfirst'),
  error: document.getElementById('detail-error'),
  anagrafica: document.getElementById('detail-anagrafica'),
  historyBody: document.getElementById('detail-history-body'),
  chartTurnout: document.getElementById('detail-chart-turnout'),
  chartMargin: document.getElementById('detail-chart-margin'),
  chartLeader: document.getElementById('detail-chart-leader'),
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

function showError(message) {
  if (!els.error) return;
  els.error.textContent = message;
  els.error.classList.remove('hidden');
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

function renderHistory(rows) {
  if (!els.historyBody) return;
  if (!rows.length) {
    els.historyBody.innerHTML = '<tr><td colspan="5" class="detail-placeholder detail-placeholder-muted">Nessun risultato summary disponibile per questo comune.</td></tr>';
    return;
  }
  const sorted = sortRowsByYear(rows);
  els.historyBody.innerHTML = sorted.map(row => `
    <tr>
      <td>${escapeHtml(row.election_label || row.election_key || '—')}</td>
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

function renderTurnoutChart(rows) {
  const container = els.chartTurnout;
  if (!container) return;
  const points = sortRowsByYear(rows)
    .map(row => {
      const year = Number(row.election_year || row.year);
      const turnout = Number(row.turnout_pct);
      if (!Number.isFinite(year) || !Number.isFinite(turnout)) return null;
      return { year, turnout, label: row.election_label || row.election_key };
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

  // line + dots
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.year).toFixed(2)},${yScale(p.turnout).toFixed(2)}`).join(' ');
  svg.appendChild(svgEl('path', { class: 'series-line', d: path }));
  for (const p of points) {
    const dot = svgEl('circle', {
      class: 'series-dot',
      cx: xScale(p.year),
      cy: yScale(p.turnout),
      r: 3.5,
    });
    const title = svgEl('title');
    title.textContent = `${p.label || p.year}: ${p.turnout.toFixed(2)}%`;
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
      const leader = row.first_party_std;
      if (!Number.isFinite(year) || !leader) return null;
      const share = Number(row.first_party_share);
      return {
        year,
        leader,
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

function renderCharts(rows) {
  renderTurnoutChart(rows);
  renderMarginChart(rows);
  renderLeaderChart(rows);
}

async function main() {
  const { id } = getParams();
  if (!id) {
    showError('Parametro "id" mancante. Apri il dettaglio da un comune selezionato sulla dashboard.');
    if (els.name) els.name.textContent = 'Dettaglio comune';
    return;
  }

  try {
    const [municipalities, summary] = await Promise.all([
      fetchCsv(`${DERIVED}/municipalities_master.csv`),
      fetchCsv(`${DERIVED}/municipality_summary.csv`).catch(() => []),
    ]);

    const record = municipalities.find(row => (row.municipality_id || '').trim() === id) || null;
    const rows = summary.filter(row => (row.municipality_id || '').trim() === id);

    const displayName = record?.name_current || record?.municipality_name || record?.name_historical || id;
    if (els.name) els.name.textContent = displayName;
    if (els.standfirst) {
      const province = record?.province_current || record?.province || '';
      const region = record?.region_current || record?.region || '';
      const bits = [province, region].filter(Boolean).join(' · ');
      els.standfirst.textContent = bits
        ? `${bits} — anagrafica, storico elezioni e grafici sull'evoluzione del comune.`
        : "Anagrafica, storico elezioni e grafici sull'evoluzione del comune.";
    }
    document.title = `Electio Italia | ${displayName}`;

    renderAnagrafica(record);
    renderHistory(rows);
    renderCharts(rows);
  } catch (err) {
    console.error(err);
    showError('Errore nel caricamento dei dati del comune. Riprova aggiornando la pagina.');
  }
}

main();
