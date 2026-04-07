# Lombardia Camera Explorer

Private preview of a Lombardia-wide election data platform for `Camera dei Deputati` and `Assemblea Costituente` results at municipal level.

This repository is the focused home for the Lombardia build: a public-facing explorer, a structured derived-data bundle, and lightweight programmatic access for research and reuse. The long-term direction is broader, but this repo stays intentionally narrow so the Lombardia layer can become solid, credible, and reusable first.

## What is in this repository

- A static election explorer with map, municipality profile, comparison tools, coverage panels, and method-aware guidance.
- A derived data bundle under `data/derived/` with registry, codebook, usage notes, provenance, contracts, and release metadata.
- A dual geometry layer: web-optimized boundaries for the public app plus full-resolution boundaries for heavier downstream use.
- Programmatic loaders for Python and R under `clients/`.
- Validation scripts for bundle integrity, frontend sanity checks, and loader smoke tests.

## Current scope

- Geography: Lombardia
- Election family: `Camera dei Deputati` plus `Assemblea Costituente 1946`
- Granularity: primarily municipal, with province and region context layers
- Product style: public-facing and explorable, but structured as a data product rather than a one-off dashboard

## Main entry points

- `index.html`: main explorer
- `products.html`: product catalog, product manifests, and inventories
- `data-download.html`: bundle files, dataset families, and download-facing view
- `programmatic-access.html`: Python and R access paths
- `usage-notes.html`: caveats, comparability, and bundle notes
- `update-log.html`: release-facing log for the current bundle

## Run locally

Requirements:

- Python 3
- Node.js (used for JS syntax checks)

The dashboard vendors its critical browser libraries locally (`d3`, `PapaParse`, `topojson-client`) instead of loading them from public CDNs at runtime.

From the repository root:

```powershell
python -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/index.html`
- `http://127.0.0.1:8000/data-download.html`

## Validation

Useful local checks:

```powershell
node --check app.js
node --check site-pages.js
python -m py_compile scripts\preprocess.py scripts\check_bundle.py clients\python\lce_loader.py
python -m unittest clients.python.tests.test_loader
python scripts\check_bundle.py --root .
```

The bundle is meant to behave like a small release artifact, not just frontend fixtures. For that reason the repo ships machine-readable metadata such as:

- `data/derived/manifest.json`
- `data/derived/release_manifest.json`
- `data/derived/dataset_contracts.json`
- `data/derived/provenance.json`
- `data/derived/usage_notes.json`
- `data/derived/web_geometry_report.json`
- `data/products/product_catalog.json`
- `data/products/*/manifest.json`

## Repository layout

- `data/derived/`: derived datasets, web/full geometry packs, registry, contracts, and release metadata
- `clients/python/`: Python loader and tests
- `clients/r/`: R loader
- `scripts/`: preprocessing, geometry packaging, and validation scripts
- `modules/`: frontend modules used by the explorer
- `vendor/tabler/`: vendor UI shell assets
- `docs/`: supporting project notes

## Status

This is a private working repository for the Lombardia-only platform layer. It is already usable as a structured local bundle and explorer, but it should still be treated as a controlled preview rather than a final public release.

Licensing and publication policy will be finalized before public launch.

## Citation

If you need a machine-readable citation entry, see `CITATION.cff`.
