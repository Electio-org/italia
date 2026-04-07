# Lombardia Camera Explorer Docs

Documentazione sintetica della build Lombardia-oriented.

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

## Prodotti attuali

- `camera_muni_historical`
  - risultati comunali storici della Camera e dell'Assemblea Costituente in Lombardia
  - shard annuali per `municipality_summary` e `municipality_results_long`
- `geometry_pack_lombardia`
  - geometrie comunali e provinciali per gli anni base dichiarati
- `metadata_layer`
  - dataset registry, codebook, usage notes, update log e gap report

## File chiave

- `data/derived/manifest.json`
- `data/derived/release_manifest.json`
- `data/derived/dataset_registry.json`
- `data/derived/dataset_contracts.json`
- `data/derived/provenance.json`
- `data/products/product_catalog.json`
- `clients/python/lce_loader.py`
- `scripts/check_bundle.py`

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
