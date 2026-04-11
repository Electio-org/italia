# Italia Camera Explorer Docs

Documentazione sintetica della build Italia-oriented.

## Cosa descrive questa cartella

- struttura del bundle pubblico
- contratti e provenance dei dataset
- logica dei prodotti dati pubblicati
- note operative per release, validazione e accesso programmatico

## Stato attuale del progetto

La repo non e piu soltanto una dashboard statica.
Oggi espone:

- un explorer pubblico in `index.html`
- una sezione prodotti in `products.html`
- pagine pubbliche per download, metodo, accesso programmatico e update log
- un bundle dichiarato in `data/derived/manifest.json`
- un catalogo prodotti in `data/products/product_catalog.json`
- manifest dedicati per ciascun prodotto in `data/products/*/manifest.json`
- librerie browser critiche vendorizzate localmente, senza dipendere da CDN pubbliche per il dashboard

## Prodotti attuali

- `camera_muni_historical`
  - risultati comunali storici della Camera e dell'Assemblea Costituente in Italia
  - shard annuali per `municipality_summary` e `municipality_results_long`
- `geometry_pack_italy`
  - geometrie comunali e provinciali web-optimized per gli anni base dichiarati
- `geometry_pack_italy_full`
  - geometrie comunali e provinciali full-resolution per download e riuso piu pesante
- `metadata_layer`
  - dataset registry, codebook, usage notes, update log, gap report e web geometry report

## File chiave

- `data/derived/manifest.json`
- `data/derived/release_manifest.json`
- `data/derived/dataset_registry.json`
- `data/derived/dataset_contracts.json`
- `data/derived/provenance.json`
- `data/derived/web_geometry_report.json`
- `data/products/product_catalog.json`
- `clients/python/lce_loader.py`
- `scripts/check_bundle.py`
- `scripts/build_web_geometry_pack.py`

## Validazione minima

```powershell
node --check app.js
node --check site-pages.js
python -m unittest clients.python.tests.test_loader
python scripts/check_bundle.py --root .
```

## Principio guida

Il progetto segue una logica sempre piu dataset-first:

- prima prodotti dati chiari e verificabili
- poi explorer pubblico, download e accesso da codice sopra lo stesso bundle
