# Lombardia Camera Explorer

Infrastruttura statica per analizzare nel tempo le elezioni della Camera in Lombardia a livello comunale.

## Cosa contiene

- `index.html`, `style.css`, `app.js`: frontend statico
- `scripts/preprocess.py`: bootstrap dei file derived e del manifest
- `data/derived/`: contratti dati, placeholder vuoti e report qualità ricavato dal tuo zip
- `data/reference/`: template per partiti, alias e lineage territoriale
- `docs/`: metodologia e contratti dati

## Filosofia

Questa app **non inventa dati** e non presume che i tuoi dataset siano già perfetti.
Mostra solo ciò che trova in `data/derived/`.
Se mancano geometrie, risultati normalizzati o lineage, lo dichiara chiaramente nell'interfaccia.

## Avvio locale

Apri il terminale nella cartella del progetto e lancia:

```bash
python -m http.server 8000
```

Poi apri:

```text
http://localhost:8000
```

## File che il frontend sa già leggere

- `data/derived/manifest.json`
- `data/derived/elections_master.csv`
- `data/derived/municipality_summary.csv`
- `data/derived/municipality_results_long.csv`
- `data/derived/municipalities_master.csv`
- `data/derived/parties_master.csv`
- `data/derived/territorial_lineage.csv`
- `data/derived/municipality_aliases.csv`
- `data/derived/geometry_pack.json` + `data/derived/geometries/...` (oppure fallback `lombardia_municipalities.geojson` referenziato dal manifest)
- `data/derived/data_quality_report.json`

## Cosa devi sostituire quando avremo i dati completi

1. il file geometrico placeholder
2. le tabelle vuote `municipality_summary.csv` e `municipality_results_long.csv`
3. i master `municipalities_master.csv`, `parties_master.csv`, `territorial_lineage.csv`
4. eventualmente il `manifest.json` se vuoi cambiare nomi o percorsi dei file

## Cosa fa già il frontend

- ricerca comune con autocomplete
- filtro elezione
- filtro province
- filtro indicatore / partito
- modalità territoriale storico / armonizzato
- lettura del report qualità
- mappa SVG pronta a leggere GeoJSON/TopoJSON
- pannello dettaglio comune
- tabella filtrabile
- export CSV/JSON
- timeline affluenza + partito selezionato

## Limite attuale voluto

L'infrastruttura è pronta, ma non forza normalizzazioni arbitrarie sui dati grezzi.
Appena avremo i dataset giusti, basta riempire i file derived secondo i contratti descritti nei docs.


## Novità v3

- slider temporale con navigazione precedente/successiva
- comparatore fino a 4 comuni
- ranking dinamici top/bottom sul filtro corrente
- mappa con zoom/pan e reset vista
- rank del comune selezionato sul campione filtrato


## Novità v5

- doppia mappa di confronto affiancata tra elezione attiva e anno di confronto
- bookmark persistenti separati dal comparatore
- scorciatoie tastiera per ricerca, navigazione temporale e selezione rapida
- tabella paginata per lavorare meglio su molti comuni
- diagnostica join dati ↔ geometrie e audit di copertura funzionale
- barra filtri attivi per lettura più fluida dello stato della vista
- autoplay della timeline elettorale e scambio rapido tra le due elezioni

## Gap ancora dichiarati

- clusterizzazione delle traiettorie non ancora implementata
- geometrie storiche vere per anno dipendono dai file geografici che inserirai
- confronto swipe vero e proprio non ancora separato dalla doppia mappa affiancata


## Novità v6

- comuni simili e cluster leggero basati su traiettoria, affluenza e cambi di leadership
- small multiples provinciali per leggere pattern territoriali lungo il tempo
- preprocessore più forte: bootstrap pragmatico da cartelle `_clean` / `_raw` con note metodologiche esplicite
- export del profilo comune arricchito con cluster e similarità


## v7

- Aggiunta una vista **Traiettoria storica del comune** più leggibile e narrativa, con modalità `selezione attiva vs contesto`, `top gruppi nel tempo` e `top partiti nel tempo`.
- Il grafico usa linee tra elezioni discrete, con etichette finali e anni di confronto evidenziati, evitando smoothing continuo implicito.


## Novità v8

- Swipe compare su geografia condivisa con cursore
- Traiettoria storica del comune rafforzata con storyboard sintetico
- Annotazioni locali per comune salvate nel browser
- Shift+click in mappa per aggiungere/rimuovere comuni dal comparatore
- Stampa della scheda comune in formato leggibile


## Aggiornamenti v9

- nuovi indicatori: scarto vs provincia, scarto vs Lombardia, indice di stabilità
- audit tecnico/readiness per elezione con export JSON
- diagnostica mismatch più trasparente
- traiettoria del comune rafforzata con scarti contestuali e stabilità


## Novità v10

- supporto a `custom_indicators.csv` per indicatori esterni e overlay socio-demografici
- report traiettoria del comune più strutturato
- confronto comune vs contesto con grafico dedicato
- clusterizzazione più robusta via k-means leggero
- export report HTML del comune
- audit contratti dati con copertura colonne chiave


## Novità v11
- archetipi e pattern comunali
- confronto gruppi di comuni nel tempo
- passaggi tra elezioni con matrice dei blocchi
- audit/readiness aggiornato


## Novità v12

- command palette per comune o azione rapida (`Ctrl/Cmd+K`)
- focus mode e fullscreen mappa
- preset territoriali lombardi per navigazione più rapida
- toast, overlay di caricamento e feedback operativi
- render isolato per sezione: un errore locale non dovrebbe bloccare tutta l'app
- audit UI con issue catturate in sessione e indicatori di robustezza
- passata grafica più forte: glow, gradienti, sticky toolbar, pannelli più polished


## Novità v13

- modalità guidate task-first: **Esplora / Confronta / Traiettoria / Diagnostica / Layer esterni**
- **viste salvate** in locale, richiamabili e cancellabili
- **insight immediati** cliccabili sul filtro corrente, per orientare l’analisi più in fretta
- preferenze di **densità** e **contrasto / color-blind mode** salvate localmente
- legenda più esplicita, toolbar ancora più sticky e feedback visivo più rifinito
- input principali resi più fluidi con debounce leggero
- piccoli miglioramenti di accessibilità (`role`, `aria-label`, contrasto più forte, sticky headers tabella)


## Novità v14

- onboarding/help con shortcut `?`
- cronologia vista con indietro/avanti
- pannelli comprimibili per progressive disclosure
- jump bar per navigare tra sezioni
- selection dock persistente
- pill salute vista più trasparente


## Novità v15

- Modalità **Base / Esperto** per ridurre il carico cognitivo e nascondere i controlli tecnici finché non servono.
- **Affidabilità della vista** e **affidabilità del caso comunale** esposte in UI e nei report export.
- Quickstart cards per partire subito da comune, confronto o audit.
- Report HTML del comune più professionale, con metadata, contesto e motivi di comparabilità/fragilità.


## v16 hardening

- preprocess corretto: quote ricalcolate dai voti quando c'è un denominatore plausibile
- validazioni di plausibilità salvate in `data_quality_report.json`
- path assoluti rimossi dal bundle
- fallback mappa più onesto quando le geometrie mancano
- rendering front-end coalesced con `requestRender()` per ridurre rerender inutili
- duplicate `similarityBundle` / `lightClusterLabel` rimosse



## Novità v26

- nuovo pannello **Briefing e limiti della vista** con sintesi pronta, guardrail e nota metodologica copiabile
- scheda comune stampabile molto più forte: key facts, storyline, caveat e serie storica leggibile
- layer audience-aware ancora più utile per pubblico, ricerca, amministratori e stampa senza togliere profondità

## Novità v25
- semantica di `completeness_flag` corretta: distingue `turnout_only` da `party_results_checked`
- province bootstrap riempite per i comuni effettivamente ingestiti
- `elections_master.csv` ripulito dai path assoluti
- preprocess capace di leggere sia layout flat sia layout `validated/existing/raw_option_urls`
- cluster etichettato in UI come euristico/esplorativo
- nuovo modulo `modules/quality.js` per fiducia/completeness
- caricamento opzionale di un bundle locale dal browser (cartella con `manifest.json` e file derived)
- nuovo catalogo dati con coverage matrix e download center del bundle attivo


## Geografie ISTAT integrate
Sono inclusi i confini comunali e provinciali della Lombardia per 1991, 2001, 2014, 2018, 2021 e 2026 (`data/derived/geometry_pack.json`). In modalità `historical` la mappa principale usa il boundary-year più vicino non successivo all'elezione; in `harmonized` usa l'ultimo anno disponibile.


## Novità v25

- bundle più GERDA-like: dataset registry, usage notes, codebook, update log
- base geometrica selezionabile nel frontend
- snippets rapidi per caricare i dataset in Python/R
- manifest aggiornato con file machine-readable aggiuntivi


## Novità v27

- domande guidate audience-aware per aprire percorsi di lettura con un click
- pannello livello di evidenza con guardrail su quanto la vista è davvero usabile
- citazione pronta della vista e riga minima di riproducibilità
- contenuti editoriali estratti in `modules/guidance.js` per rendere la base meno monolitica


## Novità v28

- base più da **data product**: aggiunto `data_products.json` con famiglie, guardrail e client ufficiali
- loader ufficiali Python e R per usare il bundle anche fuori dal browser
- sezione metodologia estesa con data products e accesso ufficiale
- `check_bundle.py` più severo su loader, manifest e prodotti dati


## Novità v29

- aggiunti `release_manifest.json`, `provenance.json` e `dataset_contracts.json`
- il bundle ora dichiara anche fingerprint SHA-256, conteggi base e identità di release
- loader Python rafforzato con `verify_integrity()` e test unitari
- `check_bundle.py` ora controlla anche integrità release, contratti dati e test del loader

## Novità v30

- Hero pubblico più forte, con pathway cards e release metrics sopra la dashboard.
- Release studio con identity, provenance, citation e snippet ufficiali Python/R.
- Research recipes machine-readable per accesso pubblico e research-safe senza impoverire il motore dati.


## Novità v31

- Aggiunti site guides machine-readable con tre livelli d'uso, explainers e FAQ.
- Release studio reso visibile nel sito.
- Nuove sezioni frontali per metodo rapido e accesso più chiaro tra pubblico, briefing e ricerca.


## Novità v32

- Home resa più memorabile con manifesto, proof pillars e narrative strip.
- Front door più forte senza ridurre la parte metodologica, release-first e programmatica.
