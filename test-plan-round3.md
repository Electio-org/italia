# Round-3 polish — test plan (commit `1182e7c`)

Focus: prove the 4 new perf layers added on top of the round-2 PR actually run in the browser, without regressing the already-passing T1–T9.

## What changed in `1182e7c`

1. **Shared `perf-boot.js`** (3 151 B) replaces 6 copies of the same inline `<script>` block across all HTML pages. Registers SW, injects Speculation Rules, hover-prefetches nav, idle-warms siblings.
2. **View Transitions API** in `style.css` (`@view-transition { navigation: auto }` + 180 ms crossfade, disabled under `prefers-reduced-motion`).
3. **Overscroll containment** on `.sidebar` + `.main-content`.
4. **SW v5** — `SW_VERSION = 'lce-v5-2026-04-20'`, `SHELL_PATHS` expanded to 22 entries, new `navigationHandler()` implementing stale-while-revalidate for `request.mode === 'navigate'` with `./index.html` offline fallback. Registration uses `{ updateViaCache: 'none' }` and serve.py sends `Cache-Control: no-store` on the SW script so Chrome doesn't freeze us on an old version.
5. **`pointer-events: none`** on `#map-svg.is-canvas-backed` (belt-and-suspenders for the canvas hit-path).

## Primary flow

Open `http://127.0.0.1:8765/` at 1600×1200, wait for the dashboard to paint, then exercise a second navigation to a sibling page so the SW + prefetch path actually fires, then come back. Capture DevTools + `performance.getEntriesByType('navigation')` evidence between steps.

## Test cases — each designed to fail visibly if the change is broken

### P1 — perf-boot.js is served, parsed, and actually runs

- Load `/`; after `load` event read:
  - `performance.getEntriesByType('resource').filter(e => e.name.endsWith('/perf-boot.js')).length === 1`
  - `document.querySelector('script[type=speculationrules]') !== null`
  - `document.querySelector('script[type=speculationrules]').textContent.includes('"eagerness":"moderate"')`
- **Fails if** the script isn't loaded (404 / wrong path) or Speculation Rules never get injected. A broken perf-boot.js would miss both asserts.

### P2 — SW v4 activated and owns the new cache bucket

- `const reg = await navigator.serviceWorker.ready; reg.active.state === 'activated'`
- `const keys = await caches.keys(); keys.some(k => k.endsWith('lce-v5-2026-04-20'))`
- `const shell = await (await caches.open('shell::lce-v5-2026-04-20')).keys(); shell.length >= 20`
  - Must be ≥ 20 because SHELL_PATHS has 22 entries (was 19 in v3).
- **Fails if** the version didn't bump or `cache.put` loop skipped items. Old `lce-v3-*` bucket alone would fail the `.some(...)`.

### P3 — Second navigation served from SW, not network (stale-while-revalidate)

- Navigate `/` → `/data-download.html` via the **Dati** nav link (one click, no hard reload).
- After DOMContentLoaded on the target page, read:
  - `performance.getEntriesByType('navigation')[0].transferSize === 0` (served from SW cache) **or** `navigator.serviceWorker.controller !== null`
  - Chrome DevTools Network tab: the `data-download.html` row shows `(ServiceWorker)` in the Size column.
- **Fails if** the new `navigationHandler()` never fires. A broken handler would show `transferSize > 0` with a fresh network fetch.

### P4 — Hover prefetch fallback still injects `<link rel=prefetch>`

- Back on `/`, hover over the **Metodo** nav link for ~200 ms, then without clicking read:
  - `document.querySelectorAll('link[rel=prefetch][href*=usage-notes]').length === 1`
- **Fails if** the extracted perf-boot.js lost the pointerenter wiring.

### P5 — View Transitions CSS is parsed and applied

- Read from DevTools → Sources or via `getComputedStyle`:
  - `document.styleSheets` must contain one `CSSRule` whose `cssText` starts with `@view-transition`.
  - OR, DevTools → Elements → Computed → search "view-transition" shows the at-rule in `style.css`.
- Click **Dati** nav link and observe a visible 180 ms crossfade (not a white-flash hard reload). Recording must show the fade.
- **Fails if** the CSS didn't survive the edit (typo would mean no crossfade).

### P6 — Overscroll containment actually applied

- DevTools console:
  - `getComputedStyle(document.querySelector('.sidebar')).overscrollBehavior === 'contain'`
  - `getComputedStyle(document.querySelector('.main-content')).overscrollBehavior === 'contain'`
- **Fails if** the CSS rule didn't land in the shipped stylesheet.

### P7 — Regression: map + profile still work

- Change election dropdown once; the canvas colour palette must visibly change.
- Open the municipality picker, choose any comune; `#selected-municipality-badge` must update (text no longer empty).
- **Fails if** any of the polish commits accidentally broke the data path.

## Evidence

- Screen recording with `test_start` + one consolidated `assertion` per test.
- Console dump of asserts P1/P2/P3/P4/P6 as JSON printed via `console.log`.
- A GIF-style crossfade visible in the recording for P5.
- Before/after screenshots of dashboard + Dati page.
