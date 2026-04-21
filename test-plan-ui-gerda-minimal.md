# Test plan — PR #2 `ui: gerda-minimal dashboard`

**Target branch:** `devin/1776772100-ui-gerda-minimal`
**Running against:** `http://127.0.0.1:8765/` (local `python scripts/serve.py`)
**Viewport:** 1600×1200 (maximized)

## What changed (user-visible)

The dashboard page was still too busy: duplicate brand in the sidebar,
a long column of 11 controls, narrative panels below the map (Una
piattaforma elettorale leggibile…, site-hero, signature, site-layers,
method-explainers, pathway, quickstart, question-workbench,
reading-guide, briefing, evidence, faq, release-studio, audit,
transitions, analysis/insights/research/advanced grids), and
Lettura/Avvertenza caption cards inside the map frame.

After this PR, the public dashboard renders as **topbar → compact
control strip (3 selects + timeline) → full-width map → compact
profile card → footer copyright**. Everything else is `display: none`
at the CSS layer (HTML/JS untouched).

## Primary flow

Open `/`, confirm the dashboard is gerda-minimal, click a comune on
the canvas, confirm the profile populates.

## Adversarial test matrix

For every assertion below I list **expected** vs **observed** so a
broken implementation (typo in selector, missing `!important`,
specificity loss) produces a visibly different result.

### T1 — Kill-list elements are all `display: none`

Run in devtools console:

```js
const hidden = [
  '.dashboard-intro-strip', '.dashboard-section-tabs', '.site-hero',
  '.signature-panel', '.site-layers-panel', '.method-explainers-panel',
  '.pathway-strip', '.quickstart-strip', '.question-workbench-panel',
  '.reading-guide-panel', '.briefing-panel', '.evidence-panel',
  '.faq-panel', '.release-studio-panel', '.audit-panel',
  '.transitions-panel', '.overview-grid', '#overview-cards',
  '.sidebar-tools', '.map-context-strip', '.quick-actions-panel',
  '.modes-panel', '.audience-panel', '.preferences-panel',
  '.saved-views-panel', '.recent-panel', '.status-panel',
  '.local-bundle-panel', '.external-panel', '.methodology-panel',
  '.toolbar', '.jump-bar', '.filter-chip-bar',
];
const state = hidden.map(s => {
  const el = document.querySelector(s);
  if (!el) return { s, missing: true };
  const d = getComputedStyle(el).display;
  return { s, display: d, pass: d === 'none' };
});
({ total: state.length, failed: state.filter(x => x.pass === false), missing: state.filter(x => x.missing) });
```

**Pass criteria:** `failed.length === 0`. `missing` can be non-zero
(e.g. a section was never present) but is **logged**, not ignored.

**Adversarial:** if `display: none` were missing for any selector
(typo in CSS, later override wins), that entry appears in `failed`
with its actual `display` value.

### T2 — Primary controls still visible and interactive

```js
['#election-select', '#metric-select', '#party-select'].map(s => {
  const el = document.querySelector(s);
  const r = el && el.getBoundingClientRect();
  return { s, exists: !!el, w: r?.width, h: r?.height, pass: r && r.width > 40 && r.height > 10 };
});
```

**Pass criteria:** all three `pass: true`, widths > 40px, heights > 10px.

**Adversarial:** if the CSS accidentally hid the parent `.control-panel`
or the `.two-col` wrapping these selects, the widths/heights drop to 0.

### T3 — Hidden-by-design controls are really hidden

```js
['#municipality-search', '#compare-election-select', '#party-mode-select',
 '#geometry-reference-select', '#territorial-mode-select'].map(s => {
  const el = document.querySelector(s);
  const label = el?.closest('label') || el?.closest('.two-col');
  return { s, labelDisplay: label ? getComputedStyle(label).display : 'no-parent' };
});
```

**Pass criteria:** every `labelDisplay === 'none'`.

### T4 — Sidebar brand block is hidden on desktop

```js
const b = document.querySelector('.sidebar .brand');
({ exists: !!b, display: b && getComputedStyle(b).display });
```

**Pass criteria:** `exists: true, display: 'none'` (element is in DOM
but hidden by CSS). If it showed as `'block'` the fix didn't land.

### T5 — Map fills the width, canvas is HiDPI-sized

```js
const mw = document.getElementById('map-wrapper').getBoundingClientRect();
const cv = document.getElementById('map-canvas');
({ wrapperWidth: mw.width, wrapperHeight: mw.height, canvasAttrW: cv.width, canvasAttrH: cv.height });
```

**Pass criteria:** `wrapperWidth > 800px` (full viewport width minus
detail panel). `wrapperHeight > 500px`. Regression guard for any grid
change that would squash the map.

### T6 — Click on canvas populates the profile

Pick a visually dense coordinate (Lombardia/Veneto around canvas
center-left). Use the existing canvas hit-detection by dispatching
a native `click` at that pixel.

```js
const cv = document.getElementById('map-canvas');
const rect = cv.getBoundingClientRect();
const x = rect.left + rect.width * 0.42;
const y = rect.top + rect.height * 0.22;
cv.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
await new Promise(r => setTimeout(r, 400));
const prof = document.getElementById('municipality-profile');
({ classList: [...prof.classList], text: prof.textContent.slice(0, 120) });
```

**Pass criteria:** `classList` no longer contains `'empty-state'` AND
`text` is not `'Seleziona un comune dalla mappa o dalla ricerca.'`.

**Adversarial:** if the SVG overlay absorbed the event (known past
issue) or the profile section was accidentally hidden, the text
would still be the empty placeholder.

### T7 — Footer copyright intact (regression)

```js
document.querySelector('.site-footer-copy')?.textContent?.trim();
```

**Pass criteria:** text starts with `'© 2026 Simone Ghezzi Colombo'`.

## Non-goals

- No regression sweep of the 5 sub-pages (not changed by this PR).
- No Service Worker verification (unchanged since PR #1).
- No TopoJSON verification (unchanged since PR #1).

## Evidence to collect

- Single full-page screenshot of the dashboard with the gerda-minimal
  layout (before/after comparison: past screenshots vs this one).
- JSON output of each console assertion block.
- Screenshot of profile card after T6 click.
- Short screen recording (30-60 s) showing layout, scrolling once,
  the click on the canvas, and the populated profile.
