const DEFAULT_HOVER_INTENT_MS = 120;
const DEFAULT_HOVER_EXPAND_MS = 250;
const DEFAULT_HOVER_STATIONARY_PX = 2;

export function createMapTooltipController({
  state,
  getTooltipElement,
  getWrapperElement,
  geometryJoinKey,
  escapeHtml,
  fmtPct,
  fmtPctSigned,
  metricDisplay,
  metricLabel,
  getProvinceMetricAverage,
  getRegionMetricAverage,
  hoverIntentMs = DEFAULT_HOVER_INTENT_MS,
  hoverExpandMs = DEFAULT_HOVER_EXPAND_MS,
  stationaryPx = DEFAULT_HOVER_STATIONARY_PX,
  emptyText = '-'
}) {
  const tooltipElement = () => typeof getTooltipElement === 'function' ? getTooltipElement() : getTooltipElement;
  const wrapperElement = () => typeof getWrapperElement === 'function' ? getWrapperElement() : getWrapperElement;

  function positionTooltip(event, tooltip = tooltipElement()) {
    const wrapper = wrapperElement();
    if (!tooltip || !wrapper || !event) return;
    tooltip.classList.remove('hidden');
    const wrapperRect = wrapper.getBoundingClientRect();
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

  function tooltipPointerFromEvent(event) {
    return { clientX: event.clientX, clientY: event.clientY };
  }

  function tooltipKeyFor(feature, row, variant = 'full') {
    return [
      state.selectedElection || '',
      state.selectedMetric || '',
      state.selectedParty || '',
      (feature ? geometryJoinKey(feature) : '') || row?.municipality_id || row?.geometry_id || '',
      variant
    ].join('|');
  }

  function tooltipContext(feature, row) {
    const p = feature?.properties || {};
    const label = row?.municipality_name
      || row?.name_current
      || row?.label
      || row?.name_historical
      || p.name_current
      || p.municipality_name
      || p.name
      || p.NAME
      || p.comune
      || p.COMUNE
      || p.NOME_COM
      || p.DEN_CM
      || 'Comune';
    const province = row?.province
      || row?.province_current
      || row?.province_observed
      || p.province
      || p.province_current
      || p.provincia
      || p.PROVINCIA
      || p.sigla
      || '-';
    return { label, province };
  }

  function clearHoverTooltipTimers() {
    if (state.mapHoverIntentTimer) {
      window.clearTimeout(state.mapHoverIntentTimer);
      state.mapHoverIntentTimer = null;
    }
    if (state.mapHoverExpandTimer) {
      window.clearTimeout(state.mapHoverExpandTimer);
      state.mapHoverExpandTimer = null;
    }
  }

  function resetHoverTooltipState({ hide = false } = {}) {
    const tooltip = tooltipElement();
    clearHoverTooltipTimers();
    state.mapHoverKey = '';
    state.mapHoverPayload = null;
    state.mapHoverMode = null;
    if (hide && !state.mapTooltipPinned && tooltip) {
      tooltip.classList.add('hidden');
      tooltip.classList.remove('is-compact');
      delete tooltip.dataset.tooltipKey;
    }
  }

  function pointerMovedEnough(a, b) {
    if (!a || !b) return false;
    const dx = Number(a.clientX) - Number(b.clientX);
    const dy = Number(a.clientY) - Number(b.clientY);
    return Math.sqrt((dx * dx) + (dy * dy)) > stationaryPx;
  }

  function scheduleHoverExpand(key) {
    if (state.mapHoverExpandTimer) window.clearTimeout(state.mapHoverExpandTimer);
    state.mapHoverExpandTimer = window.setTimeout(() => {
      state.mapHoverExpandTimer = null;
      const payload = state.mapHoverPayload;
      if (!payload || state.mapHoverKey !== key || state.mapTooltipPinned) return;
      state.mapHoverMode = 'full';
      showTooltip(payload.event, payload.feature, payload.row, { variant: 'full' });
    }, hoverExpandMs);
  }

  function scheduleHoverTooltip(event, feature, row) {
    if (state.mapTooltipPinned || !event || !feature) return;
    const key = tooltipKeyFor(feature, row, 'hover');
    const pointer = tooltipPointerFromEvent(event);
    const wasSameKey = state.mapHoverKey === key;
    const moved = wasSameKey && pointerMovedEnough(state.mapHoverPayload?.event, pointer);
    const payload = { event: pointer, feature, row };

    if (!wasSameKey) {
      resetHoverTooltipState({ hide: true });
      state.mapHoverKey = key;
      state.mapHoverPayload = payload;
      state.mapHoverIntentTimer = window.setTimeout(() => {
        state.mapHoverIntentTimer = null;
        const latest = state.mapHoverPayload;
        if (!latest || state.mapHoverKey !== key || state.mapTooltipPinned) return;
        state.mapHoverMode = 'compact';
        showTooltip(latest.event, latest.feature, latest.row, { variant: 'compact' });
        scheduleHoverExpand(key);
      }, hoverIntentMs);
      return;
    }

    state.mapHoverPayload = payload;
    if (state.mapHoverMode) {
      showTooltip(pointer, feature, row, { variant: state.mapHoverMode });
    }
    if (state.mapHoverMode === 'compact' && moved) {
      scheduleHoverExpand(key);
    }
  }

  function showTooltip(event, feature, row, options = {}) {
    const tooltip = tooltipElement();
    if (!tooltip || !event || !feature) return;
    const variant = options.variant === 'compact' && !options.pinned ? 'compact' : 'full';
    const tooltipKey = tooltipKeyFor(feature, row, variant);
    const pinned = options.pinned === true;
    if (state.mapTooltipPinned && !pinned) return;
    if (pinned) resetHoverTooltipState();
    state.mapTooltipPinned = pinned;
    tooltip.classList.toggle('is-pinned', pinned);
    tooltip.classList.toggle('is-compact', variant === 'compact');
    if (tooltip.dataset.tooltipKey === tooltipKey) {
      positionTooltip(event, tooltip);
      return;
    }
    const tooltipInfo = tooltipContext(feature, row);
    const label = tooltipInfo.label;
    const province = tooltipInfo.province;
    const firstParty = row?.first_party_std || emptyText;
    const turnout = row?.turnout_pct != null ? `${fmtPct(row.turnout_pct)}%` : emptyText;
    if (variant === 'compact') {
      tooltip.dataset.tooltipKey = tooltipKey;
      tooltip.innerHTML = `
        <div class="tooltip-card tooltip-card-compact">
          <div class="tooltip-header tooltip-header-compact">
            <strong>${escapeHtml(label)}</strong>
            <span class="tooltip-badge">${escapeHtml(province)}</span>
          </div>
        </div>
      `;
      positionTooltip(event, tooltip);
      return;
    }
    const metricValue = row?.__metric_value;
    const provinceAvg = row ? getProvinceMetricAverage(row) : null;
    const regionAvg = row ? getRegionMetricAverage(row) : null;
    const metricValueStr = metricDisplay(metricValue, !['first_party', 'dominant_block', 'custom_indicator'].includes(state.selectedMetric));
    const provinceDelta = provinceAvg != null && typeof metricValue === 'number' ? `${fmtPctSigned(metricValue - provinceAvg)} pt` : emptyText;
    const regionDelta = regionAvg != null && typeof metricValue === 'number' ? `${fmtPctSigned(metricValue - regionAvg)} pt` : emptyText;
    const comparabilityNote = row?.comparability_note ? `<div class="tooltip-note">${escapeHtml(row.comparability_note)}</div>` : '';
    tooltip.dataset.tooltipKey = tooltipKey;
    tooltip.innerHTML = `
      <div class="tooltip-card">
        <div class="tooltip-header">
          <strong>${escapeHtml(label)}</strong>
          <span class="tooltip-badge">${escapeHtml(province)}</span>
        </div>
        <div class="tooltip-meta">Elezione ${escapeHtml(state.selectedElection || emptyText)} &middot; ${escapeHtml(metricLabel())}</div>
        <div class="tooltip-grid">
          <div><span>Valore</span><strong>${escapeHtml(metricValueStr)}</strong></div>
          <div><span>Affluenza</span><strong>${escapeHtml(turnout)}</strong></div>
          <div><span>Primo partito</span><strong>${escapeHtml(firstParty)}</strong></div>
          <div><span>Stato territoriale</span><strong>${escapeHtml(row?.territorial_status || emptyText)}</strong></div>
          <div><span>Vs provincia</span><strong>${escapeHtml(provinceDelta)}</strong></div>
          <div><span>Vs Italia</span><strong>${escapeHtml(regionDelta)}</strong></div>
        </div>
        ${comparabilityNote}
        <div class="tooltip-hint">Shift+click per aggiungere o rimuovere il comune dal comparatore</div>
      </div>
    `;
    positionTooltip(event, tooltip);
  }

  function hideTooltip(force = false) {
    const tooltip = tooltipElement();
    resetHoverTooltipState();
    if (state.mapTooltipPinned && !force) return;
    state.mapTooltipPinned = false;
    if (!tooltip) return;
    tooltip.classList.add('hidden');
    tooltip.classList.remove('is-pinned', 'is-compact');
    delete tooltip.dataset.tooltipKey;
  }

  return {
    hideTooltip,
    resetHoverTooltipState,
    scheduleHoverTooltip,
    showTooltip,
    tooltipContext,
    tooltipKeyFor
  };
}
