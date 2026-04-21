# Electio Italia

Public-facing electoral atlas of Italy — mapping every Italian election, from the post-war period onward, at the **municipal level**.

This repository is the focused home for the national build: a web dashboard, a structured derived-data bundle, and lightweight programmatic access for research and reuse. Data is sourced from official Eligendo open-data archives.

**Current coverage (shipped):** `Camera dei Deputati` (1948–2022) + `Assemblea Costituente` 1946.
**Roadmap:** `Senato`, `Parlamento Europeo`, `Regionali`, `Comunali`, `Referendum` — all at the municipal level, all from 1946 onward.

**Live site:** https://simoneghezzicolombo.github.io/electio/ (GitHub Pages; a custom domain can be added later by restoring the `CNAME` file).

## What is in this repository

- A static election explorer with map, municipality profile, comparison tools, coverage panels, and method-aware guidance.
- A derived data bundle under `data/derived/` with registry, codebook, usage notes, provenance, contracts, and release metadata.
- A dual geometry layer: web-optimized boundaries for the public app plus full-resolution boundaries for heavier downstream use.
- Programmatic loaders for Python and R under `clients/`.
- Validation scripts for bundle integrity, frontend sanity checks, and loader smoke tests.

## Current scope & roadmap

- **Geography:** Italy — all ~7,900 comuni, with province and region context layers
- **Granularity:** primarily municipal
- **Election families shipped:** `Camera dei Deputati` (1948–2022) + `Assemblea Costituente` 1946
- **Roadmap (next waves):** `Senato della Repubblica` · `Parlamento Europeo` · `Regionali` · `Comunali` · `Referendum`
- **Product style:** public-facing and explorable, but structured as a data product rather than a one-off dashboard

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

From the repository root, use the project dev server (it sets `Cache-Control: no-store` on `service-worker.js` so SW updates land immediately):

```bash
python scripts/serve.py --port 8765 --host 127.0.0.1
```

Then open `http://127.0.0.1:8765/`.

## Deploy (GitHub Pages)

The repository root is the Pages site. A `.nojekyll` file disables Jekyll.

1. **GitHub → Settings → Pages**: source = `main` branch, folder = `/ (root)`.
2. **Default URL**: `https://<owner>.github.io/<repo>/`. For this repository that is `https://simoneghezzicolombo.github.io/electio/`.
3. **Custom domain (optional)**: create a `CNAME` file at the repo root containing the domain (e.g. `electio.eu`), then configure DNS at your registrar:
   - `A` records on the apex → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` on the `www` subdomain → `<owner>.github.io`
   - Enable **Enforce HTTPS** after DNS propagates.
4. **Large downloads**: `municipality_results_long.csv` (506 MB) and full-resolution GeoJSON files (LFS) are not served by Pages. Publish them as GitHub Release assets and update the links in `data-download.html` accordingly.

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

This is a private working repository for the national platform layer. It is already usable as a structured local bundle and explorer, but it should still be treated as a controlled preview rather than a final public release.

Licensing and publication policy will be finalized before public launch.

## Citation

If you need a machine-readable citation entry, see `CITATION.cff`.
