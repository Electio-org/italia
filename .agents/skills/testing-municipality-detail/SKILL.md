---
name: testing-municipality-detail
description: End-to-end test recipe for the municipality-detail.html scheda comune (KPI strip, 3-line turnout chart, block-dominante timeline). Use when verifying changes to municipality-detail.html, municipality-detail.js, renderTurnoutChart, renderBlockChart, renderKpiStrip, or the data path that feeds them (modules/data.js summary loaders, scripts/preprocess.py municipality_summary export).
---

# Testing municipality-detail.html

The scheda comune renders four pieces:

1. **KPI strip** (`#detail-kpi-strip`) — exactly 4 tiles: Affluenza media, Quota media primo partito, Volatilità del primo partito, Blocco prevalente. Tone classes are `detail-kpi-positive` / `detail-kpi-negative` / `detail-kpi-neutral`.
2. **Turnout chart** (`#detail-chart-turnout svg`) — 3 line series: comune (solid blue, class `series-line`), provincia (dashed amber, class `series-line series-line-province`), Italia (dashed grey, class `series-line series-line-italy`). 20 dots `circle.series-dot` for the comune series, each carrying a `<title>` tooltip.
3. **Block-dominante timeline** (`#detail-chart-block svg`) — two strips of 20 tiles each: `rect.block-tile` (comune) and `rect.block-tile-ref` (Italia modale).
4. Margin chart + leader chart — unrelated, do not touch.

The Italia and provincia aggregates in the turnout chart are **population-weighted**: `sum(voters) / sum(electors)` over the master CSV, computed client-side. A simple per-comune mean would land at ~73-75% for camera_2022 Italia instead of the correct 63.91% — use this as a sanity check.

## Quick start

```bash
# 1. Start dev server (background)
cd ~/repos/italia
python3 scripts/serve.py --port 8765 --host 127.0.0.1 &
sleep 1
curl -sf http://127.0.0.1:8765/municipality-detail.html?id=015146 > /dev/null && echo "server up"

# 2. Run the verified test driver (lives in ~/run_tests.py from prior session)
python3 ~/run_tests.py
# expect: TOTAL: 18 PASS, 0 FAIL of 18
```

If `~/run_tests.py` is missing, reconstruct the driver from the contracts below.

## Six must-hold contracts (the actual test plan)

For each test comune (Milano `015146`, Napoli `063049`, Pedesina `014047`):

1. **KPI strip renders 4 tiles** with the exact label sequence `Affluenza media`, `Quota media primo partito`, `Volatilità del primo partito`, `Blocco prevalente`.
2. **KPI deltas are signed** (`+` or `−`) and the `Affluenza media` tone class flips correctly: positive iff `comune_turnout_mean > italia_mean_over_same_keys`.
3. **Turnout chart has exactly 3 `<path>` series**, classes in DOM order are `[series-line series-line-italy, series-line series-line-province, series-line]`. **Each `d` attribute starts with `M`** (the moveto contract from PR #21). Each `d` contains exactly 20 `M`/`L` commands. Exactly 20 `circle.series-dot` nodes.
4. **Block timeline has 20 + 20 rects** (`block-tile` + `block-tile-ref`). First/last tile fills match `BLOCK_COLORS[<csv-derived block>]` from `municipality-detail.js`.
5. **Cross-comune regression**: Affluenze of Milano/Napoli/Pedesina are pairwise distinct (≥0.1 pp apart) AND comune `<path>` `d` strings are pairwise distinct. If they are identical, the page is rendering global aggregates instead of comune data — critical regression.
6. **Italia tooltip on Milano camera_2022** = `camera_2022: 68.35% · Provincia (Milano): 69.11% · Italia: 63.91%` (±0.01 pp tolerance). This is the deepest sanity check — catches population-weighting regressions, missing provincia aggregates, and the (0,0) leading-L SVG bug all at once.

## Reference values (from `data/derived/municipality_summary.csv`)

All comuni cover 20 elections (Assemblea Costituente 1946 + Camera 1948..2022). Compute weighted Italia/provincia from the master.

| Comune | Affluenza media | Quota primo | Volatilità | Blocco prev. | Last block (2022) |
|---|---|---|---|---|---|
| Milano `015146` | 87.2% | 29.8% | 8 partiti | Centro | centro-sinistra |
| Napoli `063049` | 78.5% | 33.7% | 8 partiti | Centro | populista |
| Pedesina `014047` | 84.5% | 58.0% | 5 partiti | Centro | centro-destra |

| Quantity | Reference |
|---|---|
| Italia camera_2022 weighted turnout | **63.9122%** |
| Provincia Milano camera_2022 weighted turnout | **69.1057%** |
| Provincia Napoli camera_2022 weighted turnout | **50.78%** |
| Provincia Sondrio camera_2022 weighted turnout | **66.33%** |
| Milano camera_2022 turnout | 68.347% |
| Napoli camera_2022 turnout | 49.676% |
| Pedesina camera_2022 turnout | 87.097% |

⚠️ **Common hypothesis trap**: "smaller mountain comune ⇒ higher historical turnout" is **false** for Milano vs Pedesina. Milano's 1948-1979 turnout was 94-95% which pulls its mean to 87.2% > Pedesina's 84.5%. Test for *distinctness*, not a specific ordering.

## Driver pattern (Playwright Python)

Key settings:
- Use `browser.new_context(service_workers="block", viewport={"width":1280,"height":900})` — the SW caches old assets and breaks fresh test runs.
- Pre-register `page.on("console", ...)` and `page.on("pageerror", ...)` BEFORE `page.goto(...)`.
- Wait for `#detail-chart-block svg rect.block-tile` to exist (signals all 4 charts have rendered).

Path assertion (the PR #21 contract):

```python
paths = page.locator("#detail-chart-turnout svg path[class^='series-line']").all()
assert len(paths) == 3
for p in paths:
    d = p.get_attribute("d")
    assert d.startswith("M"), f"path starts with {d[:2]}, not M (PR #21 regression)"
    assert len([c for c in d if c in "ML"]) == 20
```

## Caveats and failure modes

- **PR #21 is defensive**: the original `points.map((p,i)=>...).filter(Boolean)` only emits a leading `L` (and renders a stray `(0,0) → first valid point` diagonal) if a comune's first chronological summary row has a null Italia or provincia aggregate. **No comune in the current master triggers it visually**; T3's `startswith("M")` assertion is the only externally-visible contract that catches the bug. Future ingestions (Senato/Europee/Regionali) may legitimately produce sparse first-cycle aggregates that DO trigger it visually — rerun this skill after each ingestion PR.
- **All three test comuni show "Blocco prevalente = Centro"** because 11 of 20 covered elections are DC-era (1948–1992) where the modal block was `centro` for almost every Italian comune. This is correct, not a bug. Use the *last-election block* (different per comune) to confirm comune-specific data.
- **If the dev server is not running**, the test will hang on `page.goto(...)`. Always run the curl smoke test first.
- **If Chromium fails to launch** (sandbox / GPU errors), the test environment is broken — do NOT loop. Send the user a message and stop.

## Devin Secrets Needed

None. Tests run fully offline against the local dev server; no credentials required.

## Files in scope

- `municipality-detail.html`
- `municipality-detail.js` (`renderKpiStrip` ~742–835, `renderTurnoutChart` ~277–411, `renderBlockChart` ~620–734, `BLOCK_COLORS` ~25–34)
- `style.css` (KPI tile classes `detail-kpi-card` / `detail-kpi-positive` / etc.)
- `modules/data.js` (`ensureSummaryForElections`, master CSV loader)
- `data/derived/municipality_summary.csv` (158k+ rows)
- `data/derived/summary_by_election/camera_2022.csv` (and siblings)
