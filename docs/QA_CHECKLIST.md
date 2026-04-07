# QA checklist operativa

## Dati
- Le quote partito stanno tra 0 e 100.
- La somma quote per comune è plausibile.
- Elettori >= votanti >= voti validi.
- Il leader nel summary coincide con il leader nel long.
- Le province non sono vuote quando ci si aspetta che ci siano.

## Bundle
- `python scripts/check_bundle.py --root .` passa senza errori bloccanti.
- `node --check app.js` passa.
- Il preprocess compila.

## UX
- Se mancano geometrie, la UI entra in modalità `data-first`.
- La mappa non promette più di ciò che il dataset consente.
- Il dock inferiore non copre il contenuto finale.

## Prima di distribuire
- Popolare alias storici reali.
- Inserire geometrie comunali reali.
- Testare almeno una viewport desktop e una mobile.
