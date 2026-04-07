# Assunzioni, limiti, comparabilità

## 1. Principio base

L'app separa tre livelli:

1. **source / raw**: output scraper e file elettorali eterogenei
2. **derived / normalized**: tabelle coerenti e joinabili
3. **presentation**: mappa, dettaglio comune, timeline, confronti

## 2. Modalità territoriale

### Historical
Mostra il comune così come esisteva nell'anno dell'elezione, se il dato è disponibile.

### Harmonized
Riallinea le elezioni a una base comunale armonizzata, definita in `municipalities_master.csv` e `territorial_lineage.csv`.

## 3. Regola di trasparenza

Quando una comparazione non è pienamente affidabile, deve emergere in una delle colonne:

- `comparability_note`
- `territorial_status`
- `geometry_strategy`

## 4. Geografia

Ordine di preferenza:

1. geometrie storiche corrette per anno
2. geometrie attuali armonizzate con nota esplicita
3. fallback dichiarato

## 5. Partiti

I partiti vanno normalizzati separando:

- `party_raw`
- `party_std`
- `party_family`
- `bloc`

Così il frontend può mostrare sia il partito originale dell'anno sia aggregazioni storiche comparabili.

## 6. Qualità dei dati

`data_quality_report.json` non certifica verità sostantiva del dato: segnala solo lo stato tecnico del pipeline corrente.


## Novità v3

- slider temporale con navigazione precedente/successiva
- comparatore fino a 4 comuni
- ranking dinamici top/bottom sul filtro corrente
- mappa con zoom/pan e reset vista
- rank del comune selezionato sul campione filtrato


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


### Custom indicators / layer esterni

L'app può leggere `data/derived/custom_indicators.csv` con colonne minime:

- `indicator_key`
- `indicator_label`
- `municipality_id`
- `value`

Colonne opzionali: `election_key`, `election_year`, `source`, `notes`, `territorial_mode`.

Questi indicatori possono essere usati come metrica di mappa e tabella senza cambiare il core dell'app.


## Novità v11
- archetipi e pattern comunali
- confronto gruppi di comuni nel tempo
- passaggi tra elezioni con matrice dei blocchi
- audit/readiness aggiornato
