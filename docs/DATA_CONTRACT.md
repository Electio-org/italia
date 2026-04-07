# Contratto dati minimo

## elections_master.csv

| colonna | tipo | note |
|---|---|---|
| election_key | string | es. `camera_1963` |
| election_year | int | anno |
| election_date | date | ISO `YYYY-MM-DD` |
| election_label | string | label user-facing |
| electoral_system | string | opzionale |
| status | string | completed / implausible / error / ... |
| is_complete | bool/string | opzionale |
| comparability_notes | string | opzionale |
| source_notes | string | opzionale |

## municipalities_master.csv

| colonna | tipo | note |
|---|---|---|
| municipality_id | string | ID stabile interno |
| name_current | string | nome corrente |
| name_historical | string | opzionale |
| province_current | string | provincia corrente |
| geometry_id | string | chiave join geografia |
| alias_names | string | alias separati da `|` |
| harmonized_group_id | string | ID base armonizzata |

## municipality_summary.csv

Una riga per comune-elezione-modalità territoriale.

| colonna | tipo |
|---|---|
| election_key | string |
| election_year | int |
| municipality_id | string |
| municipality_name | string |
| province | string |
| geometry_id | string |
| territorial_mode | string (`historical` / `harmonized`) |
| territorial_status | string |
| turnout_pct | number |
| electors | number |
| voters | number |
| valid_votes | number |
| total_votes | number |
| first_party_std | string |
| first_party_share | number |
| second_party_std | string |
| second_party_share | number |
| first_second_margin | number |
| dominant_block | string |
| comparability_note | string |
| completeness_flag | string |

## municipality_results_long.csv

Una riga per comune-elezione-partito.

| colonna | tipo |
|---|---|
| election_key | string |
| election_year | int |
| municipality_id | string |
| municipality_name | string |
| province | string |
| party_raw | string |
| party_std | string |
| party_family | string |
| bloc | string |
| votes | number |
| vote_share | number |
| rank | number |
| territorial_mode | string |
| geometry_id | string |
| comparability_note | string |

## territorial_lineage.csv

| colonna | tipo |
|---|---|
| municipality_id_stable | string |
| name_current | string |
| name_historical | string |
| valid_from | date/string |
| valid_to | date/string |
| parent_ids | string |
| child_ids | string |
| event_type | string |
| merge_event | string |
| split_event | string |
| rename_event | string |
| province_history | string |
| geometry_strategy | string |
| notes | string |


## custom_indicators.csv

Colonne minime: `indicator_key`, `indicator_label`, `municipality_id`, `value`.
Colonne opzionali: `election_key`, `election_year`, `source`, `notes`, `territorial_mode`.

Scopo: supportare overlay socio-demografici, indicatori esterni o metriche costruite fuori dalla pipeline elettorale principale.


## data_products.json

Definisce i **prodotti dati** del bundle: famiglie, uso previsto, dataset principali, guardrail e client ufficiali. Serve a rendere il progetto meno dipendente dalla UI e più vicino a una infrastruttura dati.
