# Client Python

Uso rapido:

```python
from clients.python.lce_loader import load_bundle

bundle = load_bundle('.')
summary = bundle.load_dataset('municipalitySummary')
results = bundle.load_dataset('municipalityResultsLong')
```

Da CLI:

```bash
python clients/python/lce_loader.py --root . --summary
python clients/python/lce_loader.py --root . --dataset municipalitySummary
```
