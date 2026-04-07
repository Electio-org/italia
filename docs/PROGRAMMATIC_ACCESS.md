# Accesso programmabile

Il bundle ora espone un accesso ufficiale più disciplinato oltre alla UI.

## Python

```python
from clients.python.lce_loader import load_bundle

bundle = load_bundle('.')
summary = bundle.load_dataset('municipalitySummary')
products = bundle.list_products()
integrity = bundle.verify_integrity()
```

## CLI Python

```bash
python clients/python/lce_loader.py --root . --summary
python clients/python/lce_loader.py --root . --products
python clients/python/lce_loader.py --root . --verify
```

## R

```r
source('clients/r/lce_loader.R')
library(jsonlite)

bundle <- load_lce_bundle('.')
summary <- lce_read(bundle, 'municipalitySummary')
products <- lce_read(bundle, 'dataProducts')
```

## Perché serve

Questo rende il progetto meno dipendente dal browser: il bundle diventa un prodotto dati con un canale ufficiale minimo, verificabile e versionato per l'accesso da codice.
