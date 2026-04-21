# Test plan — PR #5 "gerda-parity round 5"

**URL under test**: `http://127.0.0.1:8765/index.html` (dev server serving the branch `devin/1776767396-gerda-round5`)
**Reference "before"**: https://electio-org.github.io/italia/ (post-PR#4 main — same code minus round-5)

## What changed (summary in one breath)

1. **Clean election labels** — `app.js:750` strips `" | 111212 righe partiti"` suffix; years without data are `disabled` with `" · non ancora pubblicato"`.
2. **Sidebar legend** — `#sidebar-legend` mirror of `#legend`, populated by the same `renderLegend()` call.
3. **Quick-stats box** — new `renderQuickStats(rows)` writes Media / Minimo / Massimo / Comuni to `#sidebar-quick-stats`.
4. **Download PNG button** — `#sidebar-download-png-btn` triggers `downloadCanvasAsPng()`.
5. **HiDPI canvas + sharper borders** — `canvas.width = 960 * dpr`, `ctx.scale(dpr)`, line widths bumped (`0.38 → 0.55` on comune, `0.8 → 0.9` on province, `lineJoin:round`).
6. **Sidebar flush with map top** — `.sidebar { padding-top: 0 }`, `.map-and-detail { align-items: flex-start }`.

## Tests

### T1 — Election dropdown has no "righe partiti" suffix  ·  **adversarial**

Steps:
1. Open the dashboard.
2. `const opts = [...document.querySelector('#election-select').options].map(o => o.textContent)`

Pass if:
- **Every** option's text contains a 4-digit year (e.g. "2022") AND **no** option contains the substring `" righe partiti"` or `" righe summary"` or `" | nessun dato"`.
- At least one option text equals `"Camera 2022"` (the main one).

Would-look-identical-if-broken?: No — the old suffix was always appended by `renderOption`; a broken strip would still show it.

### T2 — Sidebar legend is present and matches map-panel legend  ·  **adversarial**

Steps:
1. Screenshot the sidebar region.
2. `sidebarHtml = document.querySelector('#sidebar-legend').innerHTML`
3. `mapHtml = document.querySelector('#legend').innerHTML`

Pass if:
- `#sidebar-legend` is a child of `.sidebar .panel.map-companion` (confirmed via `closest('.map-companion')` non-null).
- `sidebarHtml === mapHtml` AND both have length > 0.
- Computed `display` on `#sidebar-legend` is not `none`.

Would-look-identical-if-broken?: No — before round-5 the node simply didn't exist (would throw in `querySelector`).

### T3 — Quick-stats box renders 4 cells with the right labels  ·  **adversarial**

Steps:
1. `const dts = [...document.querySelectorAll('#sidebar-quick-stats dt')].map(e => e.textContent.trim())`
2. `const dds = [...document.querySelectorAll('#sidebar-quick-stats dd')].map(e => e.textContent.trim())`

Pass if:
- `dts` is exactly `["Media", "Minimo", "Massimo", "Comuni"]` (in this order).
- `dds` has length 4, each non-empty, none equal to `"—"` (metric is loaded).
- Header `.quick-stats-header` text is non-empty (contains a metric label).

Would-look-identical-if-broken?: No — the element didn't exist before.

### T4 — Quick-stats + legend RECOMPUTE on metric change  ·  **adversarial** (the highest-value test)

Steps:
1. Capture `before = { header, media } = quick-stats header text + first `dd`.
2. Change the Mostra in mappa (metric) select to a different value (e.g. if current is `turnout`, pick `margin`; snapshot the dropdown first and pick a different index).
3. Wait 500 ms for re-render.
4. Capture `after = { header, media }`.

Pass if:
- `after.header !== before.header` (different metric label) AND
- `after.media !== before.media` (the numeric value differs).
- `#sidebar-legend` innerHTML also differs.

Would-look-identical-if-broken?: No — if `renderQuickStats` isn't called on re-render, both values would be unchanged.

### T5 — Download PNG button triggers a PNG download  ·  **adversarial**

Steps:
1. Intercept with `const createURL = URL.createObjectURL; let captured = null; URL.createObjectURL = (b) => { captured = b; return createURL(b); }`.
2. Click `#sidebar-download-png-btn`.
3. Wait 500 ms.

Pass if:
- `captured instanceof Blob === true`
- `captured.type === 'image/png'`
- `captured.size > 10_000` (rasterized map, not an empty canvas).

Would-look-identical-if-broken?: No — old DOM had no such button; missing event listener = no Blob ever created.

### T6 — HiDPI canvas backing store + hit-test regression  ·  **adversarial**

Steps:
1. `const cv = document.querySelector('#map-canvas')`
2. Read: `dpr = window.devicePixelRatio; cw = cv.width; ch = cv.height`
3. Click a known area of the canvas (northern Italy, logical coords around [450, 200]) → read `document.querySelector('#municipality-profile.empty-state')` — should now return `null`.

Pass if:
- `cw === Math.round(960 * Math.max(1, Math.min(3, dpr)))` AND `ch === Math.round(680 * Math.max(1, Math.min(3, dpr)))`.
- After the click, `#municipality-profile.empty-state` is null (profile was populated → detail panel becomes visible).

Would-look-identical-if-broken?: No — the old code had `cv.width = 960` hardcoded; on DPR=1 this T6a still passes but T6b catches a hit-test math regression (the important one). On DPR=2, T6a fails if broken.

### T7 — Sidebar and map top are vertically aligned  ·  (regression check)

Steps:
1. `const sb = document.querySelector('.sidebar').getBoundingClientRect()`
2. `const mp = document.querySelector('#map-wrapper').getBoundingClientRect()`

Pass if:
- `Math.abs(sb.top - mp.top) < 24` pixels (flush within half the old gap).

Would-look-identical-if-broken?: Yes at first glance, but the exact numeric assertion would fail — old gap was ~14-30 px depending on breakpoint; strict `<24` with flex-start distinguishes working from broken once the `padding-top: 0` rule ships.

### T8 — Sub-pages are unaffected  ·  (regression label)

Steps:
1. Navigate to `/data-download.html`, `/methodology.html`, `/update-log.html`.
2. Verify page `<h1>` renders (not "undefined" or blank).

Pass if:
- All three pages return HTTP 200 AND their main heading text length > 3 chars.

Would-look-identical-if-broken?: Yes — this is regression only. Labeled `Regression` in the report.

## Scope

- Do NOT retest PR #3 / PR #4 items (layout collapse, SW precaching) — already covered by prior runs.
- Do NOT test "Loading spinner". PR description is explicit that this round only bumped z-index. Original `setLoading` already worked before round-5.

## Evidence captured

- Continuous screen recording with `setup` / `test_start` / `assertion` annotations.
- One full-page screenshot after initial load (for the PR comment).
- One full-page screenshot after a municipality is selected (proves hit-test + detail-panel).
