import { fetchJsonFile, makeGeoProjection, parseGeometryObject, geometryJoinKey } from './modules/data.js';
import { createMunicipalitySearch } from './modules/municipality-search.js';
import { createReferendumLoader, referendumMetric, REFERENDUM_METRICS } from './modules/referendums.js';

const $ = id => document.getElementById(id);
$('nav-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const integer = value => value == null ? 'n.d.' : new Intl.NumberFormat('it-IT').format(value);
const decimal = value => value == null ? 'n.d.' : new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
const percent = value => value == null ? 'n.d.' : `${decimal(value)}%`;
const W = 960, H = 920, CELL = 24;
const canvas = $('map-canvas'), ctx = canvas.getContext('2d');
const hitContext = document.createElement('canvas').getContext('2d');
const loader = createReferendumLoader();
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
let bundle, catalog, geometry, paths = [], pathsById = new Map(), grid = new Map(), search;
let transform = d3.zoomIdentity, selectedId = null, metric = 'yes_share';
let overview, boundaries, projection, drawQueued = false, viewCache, loadToken = 0;
let hoverTimer, expandTimer, pointerFrame, hoverId = null, pointerPosition, dpr = 1;
let currentColors = [];

function mapLayout() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / W, rect.height / H);
  return { rect, scale, x: (rect.width - W * scale) / 2, y: (rect.height - H * scale) / 2 };
}
function cssTransform(logical) {
  const layout = mapLayout();
  return d3.zoomIdentity.translate(layout.scale * logical.x + layout.x * (1 - logical.k),
    layout.scale * logical.y + layout.y * (1 - logical.k)).scale(logical.k);
}

function metricValue(row) { return referendumMetric(row, metric); }
function metricText(value) {
  if (value == null) return 'Dati non disponibili';
  return metric === 'balance' ? `${value > 0 ? '+' : ''}${decimal(value)} pt` : percent(value);
}
function metricHeadline(row) {
  const value = metricValue(row);
  if (metric === 'balance' && value != null) return value === 0 ? 'Parit\u00e0 tra S\u00ec e No' : `${value > 0 ? 'S\u00ec' : 'No'} avanti di ${decimal(Math.abs(value))} punti`;
  return `${REFERENDUM_METRICS[metric].label}: ${metricText(value)}`;
}
function color(value) {
  if (!Number.isFinite(value)) return '#cbd4ce';
  const index = metric === 'balance' ? (value + 100) / 200 : value / 100;
  return currentColors[Math.max(0, Math.min(64, Math.round(index * 64)))];
}
function configureColors() {
  const interpolate = metric === 'balance'
    ? t => t < .5 ? d3.interpolateRgb('#b34b62', '#f4f5f3')(t * 2) : d3.interpolateRgb('#f4f5f3', '#147d78')((t - .5) * 2)
    : t => d3.interpolateRgb('#f0f5f2', metric === 'turnout' ? '#386b41' : '#147d78')(t);
  currentColors = Array.from({ length: 65 }, (_, i) => interpolate(i / 64));
}
function updateLegend() {
  $('legend-title').textContent = REFERENDUM_METRICS[metric].label;
  $('map-title').textContent = REFERENDUM_METRICS[metric].label;
  $('legend').style.background = `linear-gradient(90deg,${currentColors.join(',')})`;
  $('legend-labels').innerHTML = (metric === 'balance' ? ['No +100 pt', 'Parit\u00e0', 'S\u00ec +100 pt'] : ['0%', '50%', '100%']).map(value => `<span>${value}</span>`).join('');
}

function renderNational() {
  const row = bundle.consultation.national;
  $('national').innerHTML = `<h2>Italia</h2><p class="muted">Estero escluso</p>
    <div class="split"><div class="yes">S\u00ec<strong>${percent(row.yes_share)}</strong></div><div class="no">No<strong>${percent(row.no_share)}</strong></div></div>
    <div class="result-track"><span style="width:${row.yes_share || 0}%"></span><span class="no-fill" style="width:${row.no_share || 0}%"></span></div>
    <p class="muted">Affluenza ${percent(row.turnout_pct)} \u00b7 ${integer(row.voters)} votanti</p>`;
}

function renderSelection() {
  const host = $('selection');
  host.hidden = !selectedId;
  if (!selectedId) { host.replaceChildren(); return; }
  const row = bundle.byId.get(selectedId);
  const item = pathsById.get(selectedId);
  const name = row?.municipality_name || item?.feature.properties?.name_current || item?.feature.properties?.name || 'Comune';
  const province = row?.province || item?.feature.properties?.province || '';
  host.innerHTML = `<div class="selection-head"><div><h2>${escape(name)}</h2><p class="muted">${escape(province)} \u00b7 4 dicembre 2016</p></div><button class="close-selection" aria-label="Deseleziona comune">\u00d7</button></div>
    ${row ? `<p class="headline">${escape(metricHeadline(row))}</p>
    <div class="results"><div class="yes">S\u00ec<strong>${percent(row.yes_share)}</strong><span>${integer(row.yes_votes)} voti</span></div><div class="no">No<strong>${percent(row.no_share)}</strong><span>${integer(row.no_votes)} voti</span></div></div>
    <div class="result-track"><span style="width:${row.yes_share || 0}%"></span><span class="no-fill" style="width:${row.no_share || 0}%"></span></div>
    <dl>${[['Affluenza', percent(row.turnout_pct)], ['Votanti', integer(row.voters)], ['Elettori', integer(row.electors)], ['Voti validi', integer(row.valid_votes)], ['Bianche', integer(row.blank_votes)], ['Altre non valide*', integer(row.other_invalid_votes)]]
      .map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <p class="muted">* Differenza tra votanti, voti validi e bianche; pu\u00f2 includere schede contestate o non attribuite.</p>
    ${row.source_count > 1 ? `<p class="muted">Voti aggregati dai comuni di ${row.source_names.map(escape).join(', ')}.</p>` : ''}
    ${row.coverage_status === 'partial' ? '<p class="muted">Copertura territoriale parziale: non tutte le componenti sono attribuibili.</p>' : ''}` : '<p>Nessun dato attribuibile a questo territorio per la consultazione selezionata.</p>'}`;
  host.querySelector('button').addEventListener('click', () => select(null));
}

function visible(item, viewport) {
  const [[x0, y0], [x1, y1]] = item.bounds;
  return x1 >= viewport[0] && x0 <= viewport[2] && y1 >= viewport[1] && y0 <= viewport[3];
}
function viewportItems(viewport) {
  const found = new Set();
  for (let x = Math.floor(viewport[0] / CELL); x <= Math.floor(viewport[2] / CELL); x++) {
    for (let y = Math.floor(viewport[1] / CELL); y <= Math.floor(viewport[3] / CELL); y++) {
      for (const item of grid.get(`${x},${y}`) || []) if (visible(item, viewport)) found.add(item);
    }
  }
  return found;
}
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
function draw() {
  if (!overview) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#eaf0ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const layout = mapLayout();
  ctx.setTransform(dpr * layout.scale * transform.k, 0, 0, dpr * layout.scale * transform.k,
    dpr * (layout.x + layout.scale * transform.x), dpr * (layout.y + layout.scale * transform.y));
  if (transform.k < 3) {
    ctx.drawImage(overview, 0, 0, W, H);
  } else {
    const a = transform.invert([0, 0]), b = transform.invert([W, H]);
    // Rebuild only when the viewport changes, never for mousemove/hover.
    const key = [metric, transform.k, transform.x, transform.y].join('|');
    if (viewCache?.key !== key) {
      const buckets = new Map(), outlines = new Path2D();
      for (const item of viewportItems([...a, ...b])) {
        const fill = color(metricValue(bundle.byId.get(item.id)));
        if (!buckets.has(fill)) buckets.set(fill, new Path2D());
        buckets.get(fill).addPath(item.path);
        outlines.addPath(item.path);
      }
      viewCache = { key, buckets, outlines };
    }
    for (const [fill, path] of viewCache.buckets) { ctx.fillStyle = fill; ctx.fill(path); }
    ctx.strokeStyle = '#496054';
    ctx.lineWidth = .45 / transform.k;
    ctx.lineJoin = 'round';
    ctx.stroke(viewCache.outlines);
  }
  const selected = pathsById.get(selectedId);
  if (selected) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.6 / transform.k; ctx.stroke(selected.path);
    ctx.strokeStyle = '#163c2e'; ctx.lineWidth = 1.7 / transform.k; ctx.stroke(selected.path);
  }
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  if (canvas.__zoom) d3.select(canvas).call(zoom.transform, cssTransform(transform));
  requestDraw();
}
function bakeOverview() {
  const image = document.createElement('canvas');
  image.width = W * 2; image.height = H * 2;
  const context = image.getContext('2d');
  context.scale(2, 2);
  const buckets = new Map();
  for (const item of paths) {
    const fill = color(metricValue(bundle.byId.get(item.id)));
    if (!buckets.has(fill)) buckets.set(fill, new Path2D());
    buckets.get(fill).addPath(item.path);
  }
  for (const [fill, path] of buckets) { context.fillStyle = fill; context.fill(path); }
  context.strokeStyle = '#496054'; context.lineWidth = .35; context.lineJoin = 'round';
  context.stroke(boundaries);
  overview = image;
  viewCache = null;
}

const zoom = d3.zoom().extent(() => { const rect = canvas.getBoundingClientRect(); return [[0, 0], [rect.width, rect.height]]; }).scaleExtent([1, 4096])
  .on('start', () => hideHover())
  .on('zoom', event => {
    const layout = mapLayout(), current = event.transform;
    transform = d3.zoomIdentity.translate((current.x + layout.x * (current.k - 1)) / layout.scale,
      (current.y + layout.y * (current.k - 1)) / layout.scale).scale(current.k);
    requestDraw();
  });
// D3 owns wheel/touch gestures; coordinates use the fixed logical map space.
const originalPointer = event => {
  const layout = mapLayout();
  return [(event.clientX - layout.rect.left - layout.x) / layout.scale,
    (event.clientY - layout.rect.top - layout.y) / layout.scale];
};
function zoomTo(item) {
  const [[x0, y0], [x1, y1]] = item.bounds;
  const k = Math.min(4096, .76 / Math.max((x1 - x0) / W, (y1 - y0) / H));
  d3.select(canvas).call(zoom.transform, cssTransform(d3.zoomIdentity.translate(W / 2 - (x0 + x1) / 2 * k, H / 2 - (y0 + y1) / 2 * k).scale(k)));
}
function select(id, fit = false) {
  selectedId = id === selectedId ? null : id;
  hideHover();
  if (selectedId && fit && pathsById.has(selectedId)) zoomTo(pathsById.get(selectedId));
  if (!selectedId) $('search').value = '';
  const url = new URL(location.href);
  if (selectedId) url.searchParams.set('comune', selectedId); else url.searchParams.delete('comune');
  url.searchParams.set('metrica', metric);
  history.replaceState(null, '', url);
  renderSelection(); requestDraw();
}
function hit(event) {
  const [x, y] = transform.invert(originalPointer(event));
  const cell = grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || [];
  return cell.find(item => hitContext.isPointInPath(item.path, x, y)) || null;
}
function hideHover() {
  clearTimeout(hoverTimer); clearTimeout(expandTimer);
  if (pointerFrame) { cancelAnimationFrame(pointerFrame); pointerFrame = null; }
  hoverId = null; $('tooltip').hidden = true;
}
function showHover(item, expanded) {
  if (!pointerPosition || hoverId !== item.id) return;
  const row = bundle.byId.get(item.id), properties = item.feature.properties;
  const tip = $('tooltip');
  tip.innerHTML = `<strong>${escape(row?.municipality_name || properties.name_current || properties.name)}</strong><small>${escape(row?.province || properties.province || '')}</small>
    ${expanded ? `<div class="tooltip-value">${escape(metricHeadline(row))}</div>${row ? `<p>S\u00ec ${percent(row.yes_share)} \u00b7 No ${percent(row.no_share)}<br>Affluenza ${percent(row.turnout_pct)}</p>` : ''}` : ''}`;
  tip.hidden = false;
  const rect = $('map').getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(rect.width - tip.offsetWidth - 8, pointerPosition.clientX - rect.left + 14))}px`;
  tip.style.top = `${Math.max(8, Math.min(rect.height - tip.offsetHeight - 8, pointerPosition.clientY - rect.top + 14))}px`;
}
canvas.addEventListener('pointermove', event => {
  if (event.buttons || !bundle) return;
  pointerPosition = { clientX: event.clientX, clientY: event.clientY };
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null;
    const item = hit(pointerPosition);
    if (item?.id === hoverId) return;
    hideHover();
    if (!item) return;
    hoverId = item.id;
    hoverTimer = setTimeout(() => showHover(item, false), 120);
    expandTimer = setTimeout(() => showHover(item, true), 370);
  });
});
canvas.addEventListener('pointerleave', hideHover);
canvas.addEventListener('click', event => { if (!event.defaultPrevented && bundle) select(hit(event)?.id || null); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') select(null); });
$('reset').addEventListener('click', () => { select(null); d3.select(canvas).call(zoom.transform, d3.zoomIdentity); });
function zoomCenter(factor) { const { rect } = mapLayout(); d3.select(canvas).call(zoom.scaleBy, factor, [rect.width / 2, rect.height / 2]); }
$('zoom-in').addEventListener('click', () => zoomCenter(2));
$('zoom-out').addEventListener('click', () => zoomCenter(.5));
$('search').addEventListener('change', () => {
  const query = $('search').value.trim();
  if (!query) { select(null); return; }
  const matches = search.find(query);
  $('search-message').textContent = matches.length === 1 ? '' : matches.length > 1 ? 'Pi\u00f9 comuni: scegli anche la provincia.' : 'Comune non trovato.';
  if (matches.length === 1) { if (selectedId === matches[0].id) selectedId = null; select(matches[0].id, true); }
});
$('search').addEventListener('input', () => { if (!$('search').value) select(null); });
$('metric').addEventListener('change', async () => {
  $('metric').disabled = true; $('inline-status').textContent = 'Aggiornamento...';
  await nextFrame();
  metric = $('metric').value; configureColors(); bakeOverview(); updateLegend(); renderSelection(); requestDraw();
  const url = new URL(location.href); url.searchParams.set('metrica', metric); history.replaceState(null, '', url);
  $('metric').disabled = false; $('inline-status').textContent = '';
});
$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  try {
    await nextFrame();
    const output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height + 150 * dpr;
    const context = output.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 72 * dpr); context.scale(dpr, dpr); context.fillStyle = '#202622'; context.font = 'bold 18px system-ui';
    context.fillText(`Referendum 2016 \u00b7 ${REFERENDUM_METRICS[metric].label}`, 20, 29);
    context.font = '12px system-ui'; context.fillText('4 dicembre 2016 \u00b7 Italia, estero escluso', 20, 52);
    const y = output.height / dpr - 52;
    for (let i = 0; i < 65; i++) { context.fillStyle = currentColors[i]; context.fillRect(20 + i * 3, y, 3, 8); }
    context.fillStyle = '#34453c';
    context.fillText(metric === 'balance' ? 'No +100 pt                 Parit\u00e0                   S\u00ec +100 pt' : '0%                         50%                         100%', 20, y + 24);
    context.fillText('Fonte: Ministero dell\u2019Interno \u00b7 Electio Italia \u00b7 Simone Ghezzi Colombo', 20, y + 43);
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Impossibile creare il PNG.');
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `electio-referendum-2016-${metric}.png`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    $('inline-status').textContent = error.message || 'Download non riuscito. Riprova.';
  } finally { $('download').disabled = false; }
});

async function buildPaths(topology) {
  geometry = parseGeometryObject(topology);
  projection = makeGeoProjection(geometry, W - 48, H - 48);
  const [tx, ty] = projection.translate();
  projection.translate([tx + 24, ty + 24]);
  const path = d3.geoPath(projection);
  paths = []; pathsById = new Map(); grid = new Map();
  for (let index = 0; index < geometry.features.length; index++) {
    const feature = geometry.features[index], id = geometryJoinKey(feature);
    const item = { id, feature, path: new Path2D(path(feature)), bounds: path.bounds(feature) };
    paths.push(item); pathsById.set(id, item);
    const [[x0, y0], [x1, y1]] = item.bounds;
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) {
      for (let y = Math.floor(y0 / CELL); y <= Math.floor(y1 / CELL); y++) {
        const key = `${x},${y}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(item);
      }
    }
    if (index % 180 === 0) { $('loading-message').textContent = `Preparazione dei confini dettagliati: ${Math.round(index / geometry.features.length * 100)}%`; await nextFrame(); }
  }
  const object = topology.objects[Object.keys(topology.objects)[0]];
  boundaries = new Path2D(path(topojson.mesh(topology, object)));
}

async function boot() {
  const token = ++loadToken;
  $('loading').hidden = false; $('retry').hidden = true;
  try {
    const [index, topology] = await Promise.all([loader.catalog(), fetchJsonFile('data/derived/geometries_web/municipalities_2021.topojson.gz')]);
    catalog = index;
    const entry = catalog.consultations[0];
    bundle = await loader.load(entry);
    if (token !== loadToken) return;
    await buildPaths(topology);
    if (token !== loadToken) return;
    const requested = new URL(location.href).searchParams;
    metric = Object.hasOwn(REFERENDUM_METRICS, requested.get('metrica')) ? requested.get('metrica') : 'yes_share';
    $('metric').value = metric;
    search = createMunicipalitySearch(paths.map(item => ({ ...item.feature.properties,
      municipality_id: item.id, alias_names: (bundle.byId.get(item.id)?.source_names || []).join('|') })));
    $('municipalities').innerHTML = search.entries.map(entry => `<option value="${escape(entry.label)}"></option>`).join('');
    $('consultation').innerHTML = `<option value="${escape(entry.election_key)}">Costituzionale 2016</option>`;
    $('source').href = entry.source_url; $('audit').href = entry.audit_path;
    configureColors(); bakeOverview(); updateLegend(); renderNational();
    d3.select(canvas).call(zoom).on('dblclick.zoom', null);
    resize();
    const id = requested.get('comune');
    if (id && pathsById.has(id)) select(id, true);
    draw();
    document.querySelectorAll('button,select,input').forEach(control => { control.disabled = false; });
    $('loading').hidden = true;
    document.body.dataset.ready = 'true';
  } catch (error) {
    console.error(error);
    $('loading-title').textContent = 'Caricamento non riuscito';
    $('loading-message').textContent = 'I dati non sono disponibili. Riprova tra poco.';
    $('retry').hidden = false;
  }
}
$('retry').addEventListener('click', boot);
new ResizeObserver(resize).observe($('map'));
await boot();
