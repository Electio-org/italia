export function setupCanvasMapInteractions({
  canvas,
  state,
  detailZoomThreshold,
  hitTest,
  markLightInteraction,
  markHeavyInteraction,
  scheduleHoverTooltip,
  hideTooltip,
  ensureDetailGeometryForMunicipality,
  toggleCompareMunicipality,
  selectMunicipality,
  showTooltip,
  requestRender
}) {
  if (!canvas || canvas.__italiaMapHandlers) return;
  canvas.__italiaMapHandlers = true;

  canvas.addEventListener('mousemove', event => {
    markLightInteraction?.();
    if (state.mapTooltipPinned) return;
    state.mapCanvasLastPointerEvent = event;
    if (state.mapCanvasMoveFrame) return;
    state.mapCanvasMoveFrame = window.requestAnimationFrame(() => {
      state.mapCanvasMoveFrame = null;
      const pointerEvent = state.mapCanvasLastPointerEvent || event;
      const hit = hitTest?.(pointerEvent);
      if (hit) {
        scheduleHoverTooltip?.(pointerEvent, hit.item.feature, hit.row);
        if (!state.selectedMunicipalityId && state.mapCanvasTransform?.k >= detailZoomThreshold) {
          ensureDetailGeometryForMunicipality?.(hit.row?.municipality_id, { reason: 'hover-deep-zoom' });
        }
      } else {
        hideTooltip?.();
      }
    });
  });

  canvas.addEventListener('mouseleave', () => {
    state.mapCanvasLastPointerEvent = null;
    state.mapCanvasLastHit = null;
    hideTooltip?.();
  });

  canvas.addEventListener('click', event => {
    markHeavyInteraction?.();
    const hit = hitTest?.(event);
    const row = hit?.row;
    if (!row?.municipality_id) return;
    if (event.shiftKey) {
      toggleCompareMunicipality?.(row.municipality_id);
      return;
    }
    selectMunicipality?.(row.municipality_id, { updateSearch: true });
    showTooltip?.(event, hit.item.feature, row, { pinned: true, variant: 'full' });
    requestRender?.();
  });
}
