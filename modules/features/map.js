export function createCurrentMapRenderKey(state) {
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
    municipalityBoundaryGeometryYear: state.municipalityBoundaryGeometryYear || '',
    municipalityBoundaryFeatures: state.municipalityBoundaryGeometry?.features?.length || 0,
    detailGeometryKey: state.detailGeometryKey,
    detailGeometryFeatures: state.detailGeometry?.features?.length || 0,
    showNotes: state.showNotes
  });
}

export function activeMunicipalityFeatures(state, geometryJoinKey) {
  const overviewFeatures = state.geometry?.features || [];
  const detailFeatures = state.detailGeometry?.features || [];
  if (!detailFeatures.length) return overviewFeatures;
  const detailKeys = new Set(detailFeatures.map(geometryJoinKey).filter(Boolean));
  if (!detailKeys.size) return overviewFeatures;
  return overviewFeatures.filter(feature => !detailKeys.has(geometryJoinKey(feature))).concat(detailFeatures);
}

function canvasGeometryCacheKey(state, projection, boundaryGeometry) {
  const years = state.geometryPack?.availableYears?.join(',') || '';
  const geometryYear = state.geometryReferenceYear || 'auto';
  const featureCount = state.geometry?.features?.length || 0;
  const provinceCount = state.provinceGeometry?.features?.length || 0;
  const boundaryYear = state.municipalityBoundaryGeometryYear || '';
  const boundaryCount = boundaryGeometry?.features?.length || 0;
  const detailKey = state.detailGeometryKey || '';
  const detailCount = state.detailGeometry?.features?.length || 0;
  return `${geometryYear}|${years}|${featureCount}|${provinceCount}|${boundaryYear}|${boundaryCount}|${detailKey}|${detailCount}|${projection?.constructor?.name || 'projection'}`;
}

export function buildCanvasMapCache(state, projection, { geometryJoinKey, boundaryGeometry } = {}) {
  const key = canvasGeometryCacheKey(state, projection, boundaryGeometry);
  if (state.mapCanvasCache?.key === key) return state.mapCanvasCache;
  const d3Ref = globalThis.d3;
  const PathClass = globalThis.Path2D;
  if (!d3Ref?.geoPath || !PathClass) return null;
  const path = d3Ref.geoPath(projection);
  const toItem = feature => {
    const d = path(feature);
    if (!d) return null;
    const bounds = path.bounds(feature);
    const [[x0, y0], [x1, y1]] = bounds || [[NaN, NaN], [NaN, NaN]];
    return {
      feature,
      key: geometryJoinKey(feature),
      path: new PathClass(d),
      bounds,
      boundsArea: [x0, y0, x1, y1].every(Number.isFinite) ? Math.max(1, (x1 - x0) * (y1 - y0)) : Infinity
    };
  };
  const toStrokeItem = feature => {
    const d = path(feature);
    return d ? { feature, path: new PathClass(d) } : null;
  };
  const overviewItems = (state.geometry?.features || []).map(toItem).filter(Boolean);
  const detailItems = (state.detailGeometry?.features || []).map(toItem).filter(Boolean);
  const detailKeys = new Set(detailItems.map(item => item.key).filter(Boolean));
  const items = detailItems.length && detailKeys.size
    ? overviewItems.filter(item => !detailKeys.has(item.key)).concat(detailItems)
    : overviewItems;
  const boundaryItems = (boundaryGeometry?.features || []).map(toStrokeItem).filter(Boolean);
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
    boundaryItems,
    provinceItems,
    hitGrid,
    hitGridCellSize,
    itemsByKey: new Map(items.map(item => [item.key, item]))
  };
  return state.mapCanvasCache;
}

export function resizeCanvasBackingStore(canvas, width = 960, height = 680) {
  if (!canvas) return null;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas.getContext('2d', { alpha: true });
}

export function drawCanvasMap(state, canvas, { transform, municipalityColor = () => '#2563eb' } = {}) {
  const ctx = resizeCanvasBackingStore(canvas);
  const render = state.mapCanvasRender;
  if (!canvas || !ctx || !render?.cache) return;
  const activeTransform = transform || state.mapCanvasTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  state.mapCanvasTransform = activeTransform;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(activeTransform.x || 0, activeTransform.y || 0);
  ctx.scale(activeTransform.k || 1, activeTransform.k || 1);
  const strokeScale = 1 / Math.max(1, activeTransform.k || 1);

  render.cache.items.forEach(item => {
    const row = render.rowByJoinKey.get(item.key);
    const mid = row?.municipality_id;
    const selected = mid && mid === state.selectedMunicipalityId;
    const compared = mid && state.compareMunicipalityIds.includes(mid);
    const faded = render.anySelection && mid && !selected && !compared;
    ctx.globalAlpha = faded ? 0.32 : 1;
    ctx.fillStyle = row ? render.scaleInfo.colorFor(row.__metric_value) : '#e5e7eb';
    ctx.fill(item.path);
    const showMunicipalStroke = selected || compared || activeTransform.k >= 3;
    if (showMunicipalStroke) {
      ctx.strokeStyle = selected ? '#0f172a' : compared ? municipalityColor(mid) : 'rgba(15, 23, 42, 0.12)';
      ctx.lineWidth = (selected ? 2.2 : compared ? 1.5 : 0.18) * strokeScale;
      ctx.stroke(item.path);
    }
  });

  if (render.cache.boundaryItems?.length) {
    ctx.globalAlpha = activeTransform.k >= 3 ? 0.16 : 0.24;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = (activeTransform.k >= 3 ? 0.24 : 0.2) * strokeScale;
    render.cache.boundaryItems.forEach(item => {
      ctx.stroke(item.path);
    });
  }

  ctx.globalAlpha = activeTransform.k >= 3 ? 0.28 : 0.48;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = (activeTransform.k >= 3 ? 0.62 : 0.92) * strokeScale;
  render.cache.provinceItems.forEach(item => {
    ctx.stroke(item.path);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function canvasEventPoint(state, canvas, event) {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const y = (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
  const transform = state.mapCanvasTransform || globalThis.d3?.zoomIdentity;
  if (!transform?.invert) return null;
  const [ux, uy] = transform.invert([x, y]);
  return { x: ux, y: uy };
}

export function hitTestCanvasMap(state, canvas, event) {
  const render = state.mapCanvasRender;
  if (!render || !canvas) return null;
  const ctx = canvas.getContext('2d');
  const point = canvasEventPoint(state, canvas, event);
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
  for (let i = 0; i < candidateIndexes.length; i += 1) {
    const item = render.cache.items[candidateIndexes[i]];
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
