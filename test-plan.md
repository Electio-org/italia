# Test plan — PR #1 (gerda-style dashboard)

**PR:** https://github.com/simoneghezzicolombo/lombardia_camera_app_v35/pull/1
**Branch:** `devin/1776701036-perf-gerda-parity`
**Environment:** local dev server on `http://127.0.0.1:8765` via `python scripts/serve.py` (honours `Accept-Encoding`, returns pre-built `.gz` siblings).
**Device profile:** desktop, viewport ≥ 1280 × 800 so the `@media (min-width: 960px)` dashboard-on-top rules apply.

## User-visible change

The dashboard previously put its 9 primary map controls in a 378-px left sidebar with a smaller map to the right. After this PR, at viewports ≥ 960 px the controls collapse into a compact **sticky horizontal strip on top**, the map spans the full content width, and critical-path bytes drop from ~296 KB gz to ~68 KB gz (swap d3 full → d3-slim, Tabler CSS → async, icon font → SVG sprite, GeoJSON → TopoJSON).

## Adversarial philosophy

Each assertion must fail if the change were broken. Specifically:
- If the new topbar CSS didn't actually apply (wrong scope, misspelled selector) → sidebar would still be on the left and the map would still be narrow — visible in a single screenshot.
- If `d3-slim` missed any API → `renderMap()` throws `d3.X is not a function` and the canvas stays blank on first paint and on election change.
- If TopoJSON parsing failed → the loader would fall back to the `.geojson` sibling (load time spike) or produce 0 features → map would be empty.
- If the service worker didn't register or the cache-first rule didn't fire → the second nav would refetch over the network instead of hitting `(ServiceWorker)` in the Network panel.
- If the SVG sprite failed → the nav icons would render as invisible 0×0 inlines and nav chrome would look broken.

## Test cases

### T1 — Dashboard-on-top layout is in effect on desktop

**Steps**
1. Open `http://127.0.0.1:8765/` in a browser maximised to ≥ 1280 px wide.
2. Wait for `#map-wrapper` canvas to paint (max 3 s).
3. Screenshot the viewport.

**Assertions**
- `.sidebar` spans the full horizontal width of `.app-shell` (not a left column). Its computed `grid-template-columns` on `.app-shell` is a single track (via DevTools), not `minmax(260px, 320px) 1fr`.
- The map canvas (`#map-canvas` inside `#map-wrapper`) is visibly wider than the sidebar — width > 800 px at 1280-viewport.
- `position: sticky` works: on scroll, the control strip remains visible at the top.
- Visual comparison to `main` branch screenshot: the layout changed — no longer a tall left sidebar.

**Why it would fail if broken:** If the CSS scoping was wrong (`body[data-site-page]` typo, wrong media query) the old 2-column layout would render identically to `main`.

### T2 — Map renders from TopoJSON with d3-slim

**Steps**
1. Hard-reload `http://127.0.0.1:8765/` with DevTools → Network open, filter "topojson".
2. Inspect the single request for `data/derived/geometries_web/municipalities_2021.topojson`.
3. Let the map canvas paint.
4. Observe the DevTools console.

**Assertions**
- Network response has `Content-Encoding: gzip`, `Content-Type: application/json`, **transferred size ≈ 400 KB** (not the 649 KB `.geojson.gz` nor the 3.3 MB uncompressed `.geojson`). If we see a second request for `municipalities_2021.geojson`, the topojson-first path is broken — **fail**.
- `els.mapCanvas` fills the wrapper: pixel sampling of the canvas (centre ± 100 px) returns non-transparent pixels (i.e. at least one boundary polygon painted).
- DevTools console reports **zero** errors. In particular no `d3.X is not a function` message (would prove the slim bundle is missing an API) and no `Cannot read properties of undefined` from the geometry resolver.

**Why it would fail if broken:** If `parseGeometryObject` didn't accept `Topology` we'd see an empty canvas and a console error. If `d3-slim` missed `geoPath`, `rollup`, `scaleSequential`, or any interaction API, `renderMap()` throws and the map is blank.

### T3 — Election change forces a map recolour (proves d3-slim interactions work)

**Steps**
1. From the state at the end of T2, take a screenshot of the map.
2. In the topbar's **Elezione** `<select>` (`#election-select`), pick a different election year than the current one.
3. Wait ≤ 2 s; take a second screenshot.

**Assertions**
- The map canvas pixel-diff vs the T2 screenshot is non-zero in the main map region (colours/palette shift reflects the new election). The year label (`#slider-year-label`) updates to reflect the picked year.
- Console remains error-free during the transition — confirms `d3.transition`, `d3.interpolateRdBu`, `d3.format`, etc. are all present in the slim bundle.

**Why it would fail if broken:** Canvas identical between the two screenshots (handler silently failed) or a new console error from a missing d3 API.

### T4 — Municipality click → profile panel populates (proves topojson features are real)

**Steps**
1. Click a municipality polygon in the centre of the canvas.
2. Scroll down to `#municipality-profile`.

**Assertions**
- `#selected-municipality-badge` changes from `Nessun comune selezionato` to the comune's name (non-empty text).
- `#municipality-profile` is no longer the empty-state text (`Seleziona un comune dalla mappa o dalla ricerca.`); it contains at least one `<h3>` or row of data.

**Why it would fail if broken:** If TopoJSON decoded with zero features, the click hit-test fails and the profile stays on the empty state.

### T5 — Nav icon sprite + non-blocking Tabler CSS

**Steps**
1. Load index.html with DevTools → Network open, filter by `Type: Font/CSS`.
2. Screenshot the header nav row.

**Assertions**
- **No** request for `vendor/tabler/icons/tabler-icons.min.css` or `vendor/tabler/icons/fonts/tabler-icons.*` is issued. (Hard fail if seen — means the sprite swap regressed.)
- One request for `icons.svg` (or many `icons.svg#icon-*` from the same cache entry).
- The 4 nav items (Dashboard, Dati, Metodo, Aggiornamenti) each render a visible icon + label in the header.
- `vendor/tabler/core/tabler.min.css` is loaded with initiator `link` and the response is received, but the HTML has `media="print"` → `onload='this.media=all'`. After `load` it should now apply.

### T6 — Service worker + prefetch make the 2nd nav instant

**Steps**
1. Open DevTools → Application → Service Workers; confirm `service-worker.js` is **activated and running**.
2. Hover the **Dati** nav link for ~500 ms (do not click yet) and confirm Network shows a `<link rel="prefetch" href="data-download.html">` is appended.
3. Click **Dati**. Then click **Dashboard** (returning to index.html).

**Assertions**
- The service worker is `activated` (screenshotable in Application panel). `status: activated and is running`.
- After hover but before click, Network lists a prefetch for `data-download.html` with initiator `(index):1` (link injected by our inline script).
- On the second nav (to `index.html` after being on Dati), the main `index.html` request is served from `(ServiceWorker)` in Network → size column shows `(ServiceWorker)` / `disk cache`, not a full network round-trip.
- Navigation feels instant to the human watching the recording (no white flash).

**Why it would fail if broken:** Service-worker registration path wrong → `status: redundant`; prefetch script error → no `<link rel=prefetch>` inserted; cache-first rule typo → network still used.

## Execution evidence to capture

- Screenshots: 1 topbar layout (desktop), 1 pre-election-change map, 1 post-election-change map, 1 municipality profile populated, 1 DevTools service worker status panel.
- One continuous screen recording (`record_start` → `record_stop`) with `record_annotate` markers at each test start + pass/fail.
- For T5/T6: a Network panel screenshot showing no `tabler-icons.min.css`, a `(ServiceWorker)` entry, and a `prefetch` entry.
- Console log output pasted into the final comment — empty is ideal.

## Code pointers informing this plan

- `index.html:32` — `<body data-site-page="dashboard">` (gates the new CSS scope).
- `style.css` (dashboard-on-top rules, new in this PR).
- `app.js:2273` `renderMap()`, `app.js:2302` Path2D canvas render, `app.js:4993-4999` control bindings.
- `modules/data.js:60` `parseGeometryObject` (accepts `Topology`).
- `service-worker.js` (new, cache-first for `/data/derived/**`, SWR for shell).
- `index.html:1215-1259` inline script: SW registration + hover-prefetch.

## Out of scope for this run

- Lighthouse scores (nice-to-have, will mention in report if time allows).
- Mobile viewport (< 960 px) — explicit fallback layout kept; not the primary change.
- Cross-browser matrix — Chrome only.
