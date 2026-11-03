# Referendum pilot: 4 December 2016

This opt-in pilot lives at `referendum.html`, linked from the atlas navigation,
data downloads and methodology. Its assets are declared in the bundle manifest
and release integrity metadata, but its state and results remain separate from
party elections and historical coalitions. It is not included in the initial
service-worker precache. No referendum request is added to election boot.

## Build and verify

```sh
python scripts/build_referendum_pilot.py
python -m unittest discover -s tests -p test_referendum_pilot.py -v
node scripts/smoke_referendum.mjs
node scripts/smoke_referendum.mjs --browser
```

The browser smoke expects an existing static server on port 4173. Override
`BASE_URL` to test another server. `--archive /path/to/referendum-20161204.zip`
rebuilds without network access. Gzip output is deterministic (`mtime=0`).

## Provenance and checks

- Primary archive: <https://elezionistorico.interno.gov.it/daithome/documenti/opendata/referendum/referendum-20161204.zip>
- Independent institutional control totals: <https://www.cr.piemonte.it/dwd/osservatorio/referendum/risultati/3_referendum%2004.12.2016_e.pdf>
- Source member, SHA-256, territory-resolution methods and exceptions are in
  `data/derived/referendums/referendum_2016_12_04_q1_audit.json`.
- The per-source-municipality crosswalk is published as a compressed audit asset.
- Identities valid on the voting date are resolved against the existing ANPR
  history; the existing dated ISTAT SITUAS succession graph resolves 2021 geometry.
- Exact names take precedence over shortened/bilingual aliases. Homonyms must
  resolve uniquely, using province where available. Known truncated/corrupt
  official labels are recorded in the audit's correction dictionary.
- The 7,998 official source municipalities have resolved identities. Five
  cannot be allocated to their post-vote splits (Mappano and Misiliscemi): their
  2021 territories remain gray rather than inventing allocations. The map has
  7,897 data rows. Map totals **plus excluded source rows** match the full source:
  12,708,172 Yes, 19,026,617 No, 31,997,916 voters, 46,720,943 electors. These are
  **Italy only**, not Italy plus overseas. Minor boundary exchanges are not
  reconstructed at polling-section level; the map states its 2021 reference.
- Percentages use summed counts: Yes / (Yes + No), and voters / electors.
  The signed balance is (Yes - No) / (Yes + No), in percentage points.
- Missing values are not zero. Zero valid votes have no Yes/No percentage.
  The source does not distinguish all null/disputed ballots: the residual is
  labelled "other invalid", not misrepresented as an official null-ballot count.
- There is no turnout quorum for this constitutional consultation. Future
  referendum types need their own metadata; never infer validity per municipality.

## Runtime

- Uses the existing compressed detailed national TopoJSON without changing it.
- Reuses the existing projection, geographic parsing and municipality search.
- Cached Path2D geometry, spatial grid for hit testing and viewport culling.
- Baked overview; vector rendering at deep zoom. Boundaries never participate
  in hit testing. Selection adds an outline without fading unrelated areas.
- Initial loading waits for geometry preparation. Subsequent metric changes
  are local, with no network request or blank-map reset.
- Escape, click on the selected municipality, empty-map click, clear-search,
  and the explicit close button all deselect. The reset button also restores Italy.
- PNG export includes metric, scale, scope and attribution.
- Desktop/mobile browser smoke checks actual canvas pixels, search, deep zoom,
  hover hit testing, selection, metric switching without fetch and PNG download.

## Main-dashboard integration

The referendum is a dedicated consultation page in the common navigation, not
an electoral list in the party dropdown. This preserves a minimal election
boot and prevents Yes/No results from leaking into party rankings or coalition
calculations. The module `modules/referendums.js` provides validated O(1)
municipality lookup, weighted aggregation and metric resolution. A cross-page
browser smoke verifies navigation, election-state restoration and isolation of
network/data loading. Future consultation types can extend the separate catalog
without rebuilding the party results bundle.
