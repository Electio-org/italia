# Release protocol

Ogni release del bundle dovrebbe avere quattro strati leggibili da codice:

1. `manifest.json` — cosa dichiara il bundle
2. `data_products.json` — quali prodotti dati espone
3. `provenance.json` — come i dataset derived sono stati prodotti
4. `release_manifest.json` — fingerprint dei file, hash SHA-256, conteggi base

## Controlli minimi prima di pubblicare

```bash
node --check app.js
python -m py_compile scripts/preprocess.py scripts/check_bundle.py clients/python/lce_loader.py
python -m unittest clients.python.tests.test_loader
python scripts/check_bundle.py --root .
python clients/python/lce_loader.py --root . --verify
```

## Criterio

Una release non dovrebbe essere considerata affidabile solo perché il frontend parte. Deve anche:

- dichiarare i file in modo stabile
- esporre client/loader ufficiali
- avere contratti dati espliciti
- avere provenance minima leggibile da codice
- avere fingerprint verificabili dei file rilasciati
