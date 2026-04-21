# Test plan — PR #5 re-test after layout + detail + fmt fixes

## What changed since previous run (commit b1b7322)
1. **Layout (T7 fix)** — `style.css` @ lines 5640-5669: `basic-mode .app-shell` is now `320px 1fr` grid; `.sidebar` is vertical single-column with `position:sticky; top:16px`. Was: horizontal 2-col topbar with sidebar stacking above map (377 px gap). Expected: sidebar flush with map top.
2. **Detail panel re-render (T9 new)** — `app.js:5014`: `{ scope: 'detail', … always: true }`. Was: `:has(#municipality-profile.empty-state)` hid `.detail-panel`, making the render target invisible, so `renderDetail` was skipped, so `.empty-state` was never removed on click — chicken-and-egg. Expected: click on canvas → `#municipality-profile` loses `.empty-state`, detail-panel becomes visible, renders Anagrafica block.
3. **Quick-stats fmt (Devin Review fix)** — `app.js:2206-2215`: diverging metrics (`swing_compare`, `delta_turnout`, `over_performance_*`) use `fmtPctSigned(v) + ' pt'`. Was: `fmtPct(v) + '%'` (lost sign, wrong unit). Expected: when metric = `swing_compare`, quick-stats Media shows e.g. `+2.3 pt` not `2.3%`.

## Primary flow
Load dashboard → switch metric to Margine → click canvas → observe detail panel populates → switch metric to `swing_compare` (if reachable) → verify quick-stats format.

## Adversarial assertions

### R1 — Layout T7 (primary user complaint: "perfettamente allineato alla mappa")
- **Steps**: hard-refresh `http://127.0.0.1:8765/`; wait for first render; `getBoundingClientRect()` on `.sidebar` and `.map-panel`.
- **PASS**: `|sidebar.top - mapPanel.top| < 24` **AND** `sidebar.right < mapPanel.left` (truly side-by-side, not overlapping, not stacked)
- **FAIL condition distinguishability**: if basic-mode CSS override is wrong, sidebar will be full-width and stacked above map (gap ≥ 200 px). This is the exact failure mode from last run.

### R2 — Detail panel populates on click
- **Steps**: hard-refresh; wait for `state.municipalities.length > 0`; `els.mapCanvas.dispatchEvent(new MouseEvent('click', {clientX: rect.left+480, clientY: rect.top+340, bubbles:true}))`; snapshot `#municipality-profile.className` + `#municipality-profile .detail-block` count.
- **PASS**: className is `""` (empty) **AND** detail-block count ≥ 3 (Anagrafica, Risultati, etc.) **AND** `.detail-panel` has non-zero `getBoundingClientRect().width`
- **FAIL if broken**: className stays `"empty-state"`, detail-block count 0, `.detail-panel` `display:none` from `:has()`. This is exactly what the previous run saw.

### R3 — Quick-stats signed format for diverging metric
- **Steps**: select metric `swing_compare` via `els.metricSelect.value='swing_compare'; els.metricSelect.dispatchEvent(new Event('change'))`; await render; read `#sidebar-quick-stats .quick-stat dd` text for Media/Minimo/Massimo.
- **PASS**: all three contain ` pt` suffix **AND** at least one has a leading `+` or `−` sign
- **FAIL if broken**: suffix is `%` (old fmt)

### R4 — Regression: T1-T6 still pass
- Compact smoke: option labels clean (no "righe partiti"), legend populated, quick-stats 4 cells, PNG download, canvas.width = 960*dpr. One-liner console query. Skip T8 (sub-pages) — verified last run, no change since.

## Pass threshold
R1-R3 **must all pass** to call this PR mergeable. R4 must not regress.
