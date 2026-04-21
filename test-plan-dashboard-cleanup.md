# Test Plan — PR #6 Dashboard Cleanup (Electio Italia)

Environment: local dev server on `http://127.0.0.1:8765/` serving the PR #6 branch `devin/1776769294-dashboard-cleanup`.

4 fixes to verify, one adversarial test each. Every assertion is a concrete value that a broken implementation would NOT produce.

---

## T1 — SVG overlay removed (canvas-only map)

**Goal:** prove `#map-svg` element is gone from the dashboard DOM and clicks still hit-test correctly.

1. Open `http://127.0.0.1:8765/`.
2. DevTools console: `document.getElementById('map-svg')`.
3. Click on a visible comune on the canvas (central Lombardia area).
4. DevTools console: `document.getElementById('map-detail-cta-name').textContent`.

**Pass criteria**
- Step 2 returns **`null`** (not an `SVGSVGElement`).
- Step 3: the map-detail CTA at the top-right of the map becomes visible (not `.hidden`).
- Step 4 returns a non-empty comune name (e.g. `"Milano"`, `"Barga"`, etc.) — proving click → canvas hit-test → selection pipeline still works without the SVG overlay.

Source: `index.html:786-793` (no more `<svg id="map-svg">`), `app.js:2712-2730` (`updateMapDetailCta`).

---

## T2 — Detail CTA + standalone detail page

**Goal:** prove the inline detail-panel is gone and the "Vai al dettaglio" CTA routes to a working standalone page.

1. From T1, verify the inline `.detail-panel` on the dashboard is `display:none`:
   `getComputedStyle(document.querySelector('.detail-panel')).display` → **`"none"`**.
2. Read the CTA link href: `document.getElementById('map-detail-cta-link').href`.
   Expected: ends with `municipality-detail.html?id=<6-digit>&election=<election-id>`.
3. Click the CTA link.
4. On the detail page: verify URL is `/municipality-detail.html?id=...`, and the page shows:
   - a **breadcrumb** `← Torna alla dashboard`
   - an **Anagrafica** section with at least 4 `<dt>`/`<dd>` pairs (ID, nome, provincia, regione)
   - a **Storico** section with a `<table>` containing at least 1 row

**Pass criteria**
- `.detail-panel` inline on dashboard is `display:none`.
- CTA href matches pattern `municipality-detail.html?id=\d{6}&election=.+`.
- Detail page loads (HTTP 200), renders the comune name in the page title/heading and fills the anagrafica grid with the same comune ID.
- No error message visible in `#detail-error`.

Source: `municipality-detail.html`, `municipality-detail.js`, `app.js:2712-2730`, `style.css:5815-5816` (detail-panel hidden on dashboard).

---

## T3 — Sharp comune borders (multi-pass canvas)

**Goal:** prove the new fill-first/stroke-after canvas rendering is active and produces visibly sharper borders.

Since "sharp" is subjective, assert the code is in the new pass order by instrumenting the actual `CanvasRenderingContext2D.stroke` calls used on the map canvas.

1. On dashboard, open DevTools console and run:
   ```js
   const c = document.getElementById('map-canvas').getContext('2d');
   const strokes = [];
   const origStroke = c.stroke;
   c.stroke = function(path) { strokes.push({ lw: c.lineWidth, ss: c.strokeStyle, ga: c.globalAlpha }); return origStroke.call(this, path); };
   ```
2. Trigger a redraw: change the metric dropdown (e.g. `Affluenza` → `Voti validi`) and wait ~1.5 s.
3. Inspect: `strokes.slice(0,8)` and `new Set(strokes.map(s=>s.ss))`.

**Pass criteria**
- Stroke styles include **both** `#1e293b` (light comune borders) **and** `#0f172a` (heavy province boundaries).
- At least one stroke has `lineWidth` close to `0.7 * strokeScale` (≈ 0.7 at zoom=1), and at least one has `lineWidth` close to `1.4 * strokeScale` (≈ 1.4).
- Stroke order: the first strokes recorded (after the fill pass) are the light `#1e293b` ones, then the heavier `#0f172a` province strokes.
- Visual zoom-in screenshot at ~3× in Lombardia area shows comune borders as thin single-pixel dark lines with no fuzzy edges; province boundaries visibly thicker and darker on top.

If instrumentation shows only one stroke style or strokes before fills, the new pass order is NOT active → FAIL.

Source: `app.js:2479-2520` (new multi-pass ordering).

---

## T4 — Loading indicator on election change

**Goal:** prove `#map-loading` appears on election change and dismisses after render.

1. On dashboard, confirm `#map-loading` exists and has class `hidden`:
   `document.getElementById('map-loading').classList.contains('hidden')` → **`true`**.
2. Install a mutation observer to record class changes:
   ```js
   const l = document.getElementById('map-loading');
   const log = [];
   new MutationObserver(() => log.push({ t: performance.now().toFixed(0), cls: l.className, ariaHidden: l.getAttribute('aria-hidden'), label: l.querySelector('.map-loading-label')?.textContent })).observe(l, { attributes:true });
   window.__loadingLog = log;
   ```
3. Change the election dropdown (e.g. pick a different year from the current one).
4. Wait 2 s, then inspect `window.__loadingLog`.

**Pass criteria**
- `__loadingLog` contains at least 2 entries.
- First entry after change: `cls` does **not** include `hidden` AND `label` === `"Caricamento dati elezione…"` AND `ariaHidden === "false"`.
- A later entry: `cls` includes `hidden` again AND `ariaHidden === "true"` — i.e. spinner dismissed after render.
- The spinner is visible in a screenshot taken between steps 3 and 4.

Source: `app.js:2732-2745` (`setMapLoading`), `app.js:4052-4060` (hook on select changes), `index.html:787-790`, `style.css:5858-5890`.

---

## Evidence collected per test

- Screenshots of: dashboard after click (CTA visible), detail page (anagrafica+storico populated), zoomed-in Lombardia borders, spinner mid-change
- Console output of: `document.getElementById('map-svg')`, CTA href, stroke style counts, loading log
- Annotated recording covering all 4 tests end-to-end

## Regression sanity (label clearly as Regression)

- After T3 instrumentation, restore `c.stroke = origStroke` and verify pan/zoom still works (single-shot, not part of primary results).
