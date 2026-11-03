"""Build useful, crawlable election records from the exact public map shards.

No network requests or raw-data rewrites. Missing turnout is never zero-filled.
The aggregates describe the covered municipal perimeter, not official national totals.
Run this, then scripts/build_discovery.py, before publishing changed election data.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import html
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://electio-org.github.io/italia/'


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def valid_turnout(row):
    electors, voters = number(row.get('electors')), number(row.get('voters'))
    return electors is not None and voters is not None and electors > 0 and 0 <= voters <= electors


def aggregate_turnout(rows):
    usable = [row for row in rows if valid_turnout(row)]
    electors = sum(number(row['electors']) for row in usable)
    voters = sum(number(row['voters']) for row in usable)
    return {'units': len(usable), 'electors': electors, 'voters': voters,
            'turnout': voters / electors * 100 if electors else None}


def read_rows(relative, key):
    with gzip.open(ROOT / relative, 'rt', encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle))
    if not rows or any(row['election_key'] != key for row in rows):
        raise ValueError(f'Empty or mixed-election input: {relative}')
    return rows


def summary_for(key):
    relative = f'data/derived/summary_by_election/{key}.csv.gz'
    rows = read_rows(relative, key)
    ids = [row['municipality_id'] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f'Duplicate municipal units in {key}')
    if any(row['territorial_mode'] != 'harmonized' for row in rows):
        raise ValueError(f'Unexpected territorial basis in {key}')
    return rows, relative


def build_model(spec, masters):
    key, previous_key = spec['key'], spec['previous']
    rows, summary_path = summary_for(key)
    previous, previous_path = summary_for(previous_key)
    results_path = f'data/derived/results_by_election/{key}.csv.gz'
    results = read_rows(results_path, key)
    summary_ids = {row['municipality_id'] for row in rows}
    result_ids = {row['municipality_id'] for row in results}
    if not result_ids.issubset(summary_ids):
        raise ValueError(f'Results outside summary perimeter in {key}')
    parties = {}
    for row in results:
        votes = number(row.get('votes'))
        if votes is None or votes < 0 or votes != int(votes):
            raise ValueError(f'Invalid observed vote count in {key}')
        label = row.get('party_std') or row['party_raw']
        party = parties.setdefault(label, {'name': label, 'votes': 0, 'aliases': set()})
        party['votes'] += int(votes)
        party['aliases'].add(row['party_raw'])
    total_votes = sum(item['votes'] for item in parties.values())
    if not total_votes:
        raise ValueError(f'No observed list votes in {key}')
    ranked = sorted(parties.values(), key=lambda item: (-item['votes'], item['name']))
    for item in ranked:
        item['share'] = item['votes'] / total_votes * 100
        item['aliases'] = sorted(item['aliases'])
    current_map = {row['municipality_id']: row for row in rows if valid_turnout(row)}
    previous_map = {row['municipality_id']: row for row in previous if valid_turnout(row)}
    common = sorted(current_map.keys() & previous_map.keys())
    if not common:
        raise ValueError(f'No comparable turnout perimeter: {key}')
    paired_current = aggregate_turnout([current_map[item] for item in common])
    paired_previous = aggregate_turnout([previous_map[item] for item in common])
    regions = defaultdict(list)
    for unit in common:
        region = current_map[unit].get('region') or 'Regione non disponibile'
        if region != (previous_map[unit].get('region') or 'Regione non disponibile'):
            raise ValueError(f'Regional boundary mismatch for {unit}')
        regions[region].append(unit)
    regional = []
    for region, units in regions.items():
        now = aggregate_turnout([current_map[item] for item in units])
        before = aggregate_turnout([previous_map[item] for item in units])
        regional.append({'name': region, 'units': len(units), 'current': now['turnout'],
                         'previous': before['turnout'], 'delta': now['turnout'] - before['turnout']})
    files = [summary_path, results_path, previous_path]
    source = masters[key]
    archive = next((part.split('=', 1)[1] for part in source['source_notes'].split('; ')
                    if part.startswith('archive=')), '')
    return {**spec, 'date': source['election_date'], 'previous_year': int(masters[previous_key]['election_year']),
            'year': int(source['election_year']), 'rows': len(rows), 'result_units': len(result_ids),
            'turnout': aggregate_turnout(rows), 'total_votes': total_votes, 'parties': ranked,
            'common': len(common), 'paired_current': paired_current, 'paired_previous': paired_previous,
            'delta': paired_current['turnout'] - paired_previous['turnout'],
            'regions': sorted(regional, key=lambda item: (-item['current'], item['name'])),
            'files': files, 'archive': archive,
            'input_sha256': {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in files}}


def e(value):
    return html.escape(str(value), quote=True)


def integer(value):
    return f'{value:,.0f}'.replace(',', '.')


def decimal(value, digits=2):
    return '—' if value is None else f'{value:.{digits}f}'.replace('.', ',')


def percent(value):
    return decimal(value) + '%' if value is not None else '—'


def delta(value):
    return ('+' if value > 0 else '−' if value < 0 else '') + decimal(abs(value)) + ' punti'


def display_date(value):
    months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
    parsed = date.fromisoformat(value)
    return f'{parsed.day} {months[parsed.month - 1]} {parsed.year}'


def map_link(model, prefix):
    return prefix + 'index.html#' + urlencode({'selectedElection': model['key'], 'compareElection': model['previous'], 'selectedMetric': 'turnout'})


def shell(body, prefix, updated, version):
    return f'''<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Electio Italia</title><meta name="description" content="Schede elettorali Electio"><link rel="icon" type="image/svg+xml" href="{prefix}favicon.svg"><link rel="stylesheet" href="{prefix}assets/election-pages.css"><script src="{prefix}assets/election-pages.js" defer></script></head><body>
<a class="skip" href="#main">Vai al contenuto</a><header class="site-head"><a class="brand" href="{prefix}index.html"><span class="monogram" aria-hidden="true">EI</span><span>Electio Italia<small>Atlante elettorale</small></span></a><nav aria-label="Navigazione principale"><a href="{prefix}index.html">Mappa</a><a href="{prefix}elezioni/" aria-current="page">Elezioni</a><a href="{prefix}referendum.html">Referendum</a><a href="{prefix}data-download.html">Dati</a><a href="{prefix}usage-notes.html">Metodo</a></nav></header>
<main id="main">{body}</main><footer><p>Electio Italia · <a href="https://simoneghezzicolombo.github.io/">Simone Ghezzi Colombo</a> · Release dati {e(version)} · Schede aggiornate il {display_date(updated)}.</p><p>Progetto indipendente, basato su archivi Eligendo. Gli aggregati riguardano i comuni coperti nel dataset: non sono risultati di seggio o un totale ufficiale nazionale.</p><a href="{prefix}elezioni/">Tutte le schede</a> · <a href="{prefix}usage-notes.html">Metodo e limiti</a> · <a href="https://github.com/Electio-org/italia">Codice e dati</a></footer></body></html>'''


def election_body(model, models, version):
    prefix = '../../'
    leader = model['parties'][0]
    name, year, previous_year = model['title'], model['year'], model['previous_year']
    pair = model['paired_current']['turnout']
    before = model['paired_previous']['turnout']
    list_rows = ''.join(f'''<tr data-party data-search="{e(' '.join([party['name'], *party['aliases']]).casefold())}"><th scope="row"><strong>{e(party['name'])}</strong><details><summary>Denominazioni nella fonte</summary><p>{e('; '.join(party['aliases']))}</p></details></th><td class="number">{integer(party['votes'])}</td><td><div class="share"><span class="bar" style="--share:{party['share']:.6f}%" aria-hidden="true"></span><strong>{percent(party['share'])}</strong></div></td></tr>''' for party in model['parties'])
    region_rows = ''.join(f'''<tr data-region data-name="{e(region['name'])}" data-current="{region['current']:.10f}" data-delta="{region['delta']:.10f}"><th scope="row">{e(region['name'])}</th><td class="number">{integer(region['units'])}</td><td class="number">{percent(region['previous'])}</td><td class="number">{percent(region['current'])}</td><td class="number">{delta(region['delta'])}</td></tr>''' for region in model['regions'])
    related = ''.join(f'<li><a href="../{e(item["slug"])}/">{e(item["title"])}</a></li>' for item in models if item['key'] != model['key'])
    files = ''.join(f'<li><a href="{prefix + path}" download>{"Risultati di lista" if "results_by" in path else "Affluenza e riepilogo comunale"} · {e(path.split("/")[-1])}</a></li>' for path in model['files'])
    month_note = 'La data indicata è quella della consultazione riportata nel catalogo; per il 2024 il voto si è svolto l’8 e 9 giugno.' if model['key'] == 'europee_2024' else 'La data è quella riportata nel catalogo delle consultazioni Electio.'
    return f'''<nav class="crumbs" aria-label="Percorso"><a href="../">Elezioni</a><span aria-hidden="true">/</span><span>{e(model['family'])} {year}</span></nav>
<section class="hero"><p class="eyebrow">{e(model['family'])} · <time datetime="{model['date']}">{display_date(model['date'])}</time></p><h1>{e(name)}<span>Risultati, affluenza e confronto territoriale.</span></h1><p class="lead">Nel perimetro comunale di Electio, <strong>{e(leader['name'])}</strong> è la prima lista per voti, con il <strong>{percent(leader['share'])}</strong>. L’affluenza aggregata è <strong>{percent(model['turnout']['turnout'])}</strong>, calcolata da votanti ed elettori dei territori con dati disponibili.</p><div class="actions"><a class="button primary" href="{e(map_link(model, prefix))}">Esplora la mappa del {year} ↗</a><a class="button" href="#dati">Scarica i dati</a></div></section>
<dl class="metrics"><div><dt>Affluenza aggregata</dt><dd>{percent(model['turnout']['turnout'])}</dd><small>Su {integer(model['turnout']['units'])} unità comunali con dati utilizzabili</small></div><div><dt>Voti di lista nel dataset</dt><dd>{integer(model['total_votes'])}</dd><small>Somma dei voti osservati, non numero dei votanti</small></div><div><dt>Unità con risultati</dt><dd>{integer(model['result_units'])}</dd><small>Riferimento territoriale: geometria comunale 2021</small></div></dl>
<aside class="note"><strong>Prima di confrontare i numeri</strong><p>Questa scheda aggrega gli stessi file comunali armonizzati usati dalla mappa, non il riparto dei seggi né il risultato ufficiale nazionale completo. Il perimetro delle liste e quello dell’affluenza possono differire. Voti di lista, votanti ed elettori sono grandezze distinte; i dati mancanti non vengono trasformati in zeri.</p></aside>
<section aria-labelledby="liste-title"><div class="section-heading"><div><p class="eyebrow">Il voto alle liste</p><h2 id="liste-title">Come si distribuiscono i voti.</h2></div><p>Quote ricalcolate sulla somma dei voti delle liste nel dataset. Le sigle sono quelle della tassonomia Electio, specifica per elezione; le denominazioni originali restano consultabili.</p></div><div class="controls" data-enhanced hidden><label>Cerca una lista<input type="search" data-party-search placeholder="Nome, sigla o denominazione originale" autocomplete="off"></label><button type="button" class="button" data-show-all aria-pressed="false">Mostra tutte le liste</button></div><p class="status" data-party-status role="status" aria-live="polite"></p><div class="table-scroll" role="region" aria-label="Voti e quote delle liste" tabindex="0"><table class="party-table"><caption>Voti di lista aggregati · {e(name)}</caption><thead><tr><th scope="col">Lista</th><th scope="col" class="number">Voti</th><th scope="col">Quota</th></tr></thead><tbody>{list_rows}</tbody></table></div><p class="caption">Denominatore: {integer(model['total_votes'])} voti di lista, su {integer(model['result_units'])} unità comunali. Non sono quote di coalizione e non vanno lette come percentuali di seggi.</p></section>
<section aria-labelledby="compare-title"><div class="section-heading"><div><p class="eyebrow">Un confronto a perimetro comune</p><h2 id="compare-title">Affluenza: {previous_year} → {year}.</h2></div><p>Il confronto usa solo le {integer(model['common'])} unità territoriali presenti in entrambe le elezioni con elettori e votanti validi. L’affluenza di ciascun anno è il rapporto fra le somme, non la media semplice delle percentuali comunali.</p></div><div class="comparison"><div><p class="change">{delta(model['delta'])}</p><p>Variazione dell’affluenza sul perimetro comune</p></div><div class="comparison-bars"><div><span>{previous_year}</span><div class="track"><span style="width:{before:.6f}%" aria-hidden="true"></span></div><strong>{percent(before)}</strong></div><div><span>{year}</span><div class="track"><span style="width:{pair:.6f}%" aria-hidden="true"></span></div><strong>{percent(pair)}</strong></div></div></div><details class="denominators"><summary>Controlla i denominatori del confronto</summary><div class="table-scroll"><table><caption>Stesse unità territoriali, popolazioni elettorali osservate in ciascun anno</caption><thead><tr><th>Anno</th><th class="number">Elettori</th><th class="number">Votanti</th><th class="number">Affluenza</th></tr></thead><tbody><tr><th>{previous_year}</th><td class="number">{integer(model['paired_previous']['electors'])}</td><td class="number">{integer(model['paired_previous']['voters'])}</td><td class="number">{percent(before)}</td></tr><tr><th>{year}</th><td class="number">{integer(model['paired_current']['electors'])}</td><td class="number">{integer(model['paired_current']['voters'])}</td><td class="number">{percent(pair)}</td></tr></tbody></table></div></details></section>
<section aria-labelledby="region-title"><div class="section-heading"><div><p class="eyebrow">Differenze territoriali</p><h2 id="region-title">L’affluenza, regione per regione.</h2></div><p>Aggregati delle stesse unità comunali del confronto {previous_year}–{year}, raggruppate per regione. Il confronto regionale non corregge cambiamenti nella composizione dell’elettorato o nelle regole elettorali.</p></div><div class="controls" data-enhanced hidden><label>Ordina le regioni<select data-region-sort><option value="current">Affluenza {year}, dalla più alta</option><option value="name">Nome della regione</option><option value="delta">Variazione, dalla più alta</option></select></label></div><div class="table-scroll" role="region" aria-label="Affluenza per regione" tabindex="0"><table><caption>Affluenza regionale aggregata sul perimetro comune · variazioni in punti percentuali</caption><thead><tr><th scope="col">Regione</th><th scope="col" class="number">Unità</th><th scope="col" class="number">{previous_year}</th><th scope="col" class="number">{year}</th><th scope="col" class="number">Variazione</th></tr></thead><tbody data-region-table>{region_rows}</tbody></table></div></section>
<section id="dati" aria-labelledby="data-title"><p class="eyebrow">Fonti e riproducibilità</p><h2 id="data-title">Dai dati alla scheda.</h2><div class="data-grid"><div><h3>File effettivamente utilizzati</h3><ul class="file-list">{files}</ul><p>I file sono CSV compressi gzip. Le sintesi sono disponibili anche in <a href="{prefix}assets/election-pages-data.json">JSON, con hash SHA-256 degli input</a>.</p></div><div><h3>Fonte, metodo, limiti</h3><ul><li>Fonte originaria: <a href="https://elezionistorico.interno.gov.it/eligendo/opendata.php">archivi open data Eligendo, Ministero dell’Interno</a>{f' · <code>{e(model["archive"])}</code>' if model['archive'] else ''}.</li><li>Base territoriale: comuni al 31 dicembre 2021; predecessori ricostruiti tramite la lineage ISTAT SITUAS. Scissioni ambigue e trasferimenti parziali non vengono allocati arbitrariamente.</li><li>Affluenza: somma dei votanti / somma degli elettori × 100. Esclusi i record con valori mancanti, elettori non positivi o votanti fuori dall’intervallo 0–elettori.</li><li>Copertura: {integer(model['rows'])} record di riepilogo; {integer(model['turnout']['units'])} utilizzabili per l’affluenza; {integer(model['result_units'])} con risultati di lista.</li><li>{month_note}</li></ul><a href="{prefix}usage-notes.html">Leggi tutte le note metodologiche →</a></div></div><details><summary>Come citare questa scheda</summary><p>Ghezzi Colombo, Simone. Electio Italia: {e(name)}. Release dati {e(version)}. Aggregati comunali su geometria 2021. URL: {BASE}elezioni/{model['slug']}/. Fonte originaria: Eligendo, Ministero dell’Interno. Indicare la data di consultazione.</p></details></section>
<section class="related" aria-labelledby="related-title"><h2 id="related-title">Altre consultazioni.</h2><ul>{related}</ul><a class="button" href="../">Torna all’archivio delle schede</a></section>'''


def build():
    from build_discovery import head_metadata
    config = json.loads((ROOT / 'seo/elections.json').read_text(encoding='utf-8'))
    masters = {}
    for path in ('elections_master.csv', 'european_elections_master.csv'):
        with (ROOT / 'data/derived' / path).open(encoding='utf-8-sig', newline='') as handle:
            masters.update({row['election_key']: row for row in csv.DictReader(handle)})
    version = json.loads((ROOT / 'data/derived/release_manifest.json').read_text(encoding='utf-8'))['project']['version']
    models = [build_model(spec, masters) for spec in config['elections']]
    pages = []
    for model in models:
        title = model['title'] + ' — risultati e affluenza | Electio Italia'
        description = f'{model["title"]}: voti alle liste e affluenza {percent(model["turnout"]["turnout"])} nel perimetro comunale Electio. Confronto con {model["previous_year"]}, fonti e dati CSV.'
        path = f'elezioni/{model["slug"]}/index.html'
        page = {'path': path, 'url': f'elezioni/{model["slug"]}/', 'title': title, 'description': description,
                'network_in_footer': True, 'dataset': {'temporalCoverage': model['date'], 'dateModified': config['updated'],
                'version': version, 'measurementTechnique': 'Aggregation of municipal election shards harmonized to the 2021 municipal geography; matched-unit turnout comparisons',
                'isBasedOn': 'https://elezionistorico.interno.gov.it/eligendo/opendata.php',
                'spatialCoverage': {'@type': 'Place', 'name': 'Italy, municipalities covered by Electio on the 2021 geographic basis'},
                'variableMeasured': ['Observed list votes', 'Share of list votes in covered units', 'Weighted aggregate turnout'],
                'distribution': [{'@type': 'DataDownload', 'encodingFormat': 'application/gzip', 'contentUrl': BASE + item} for item in model['files']]}}
        document = shell(election_body(model, models, version), '../../', config['updated'], version)
        document = head_metadata(document, page)
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(document, encoding='utf-8', newline='\n')
        pages.append(page)
    cards = ''.join(f'''<article class="election-card"><p class="eyebrow">{e(model['family'])} · {display_date(model['date'])}</p><h2><a href="{model['slug']}/">{e(model['title'])}</a></h2><p>Prima lista nel dataset: <strong>{e(model['parties'][0]['name'])}</strong> · {percent(model['parties'][0]['share'])} dei voti di lista.</p><dl><div><dt>Affluenza aggregata</dt><dd>{percent(model['turnout']['turnout'])}</dd></div><div><dt>Unità con risultati</dt><dd>{integer(model['result_units'])}</dd></div></dl><a class="card-link" href="{model['slug']}/">Risultati, confronto con {model['previous_year']} e fonti →</a></article>''' for model in models)
    body = f'''<section class="hero"><p class="eyebrow">Archivio delle consultazioni</p><h1>Le elezioni, una per una.</h1><p class="lead">Cinque schede per leggere risultati di lista, affluenza e differenze territoriali prima di entrare nella mappa. Dati osservati, denominatori espliciti e confronti riproducibili.</p><p>La mappa contiene tutte le 30 consultazioni attualmente pubblicate; questo primo gruppo di schede approfondisce Camera 2013, 2018 e 2022 ed Europee 2019 e 2024.</p><a class="button primary" href="../index.html">Apri l’atlante completo ↗</a></section><aside class="note"><strong>Che cosa descrivono questi numeri?</strong><p>Aggregati del dataset comunale Electio, ricondotto alla geometria 2021. Non risultati di seggio né un totale nazionale ufficiale completo. Ogni scheda distingue copertura dei risultati, copertura dell’affluenza e perimetro del confronto.</p></aside><section class="election-grid" aria-label="Schede delle elezioni">{cards}</section>'''
    page = {'path': 'elezioni/index.html', 'url': 'elezioni/', 'title': 'Elezioni italiane: schede, risultati e affluenza | Electio Italia', 'description': 'Schede delle elezioni Camera 2013, 2018 e 2022 ed Europee 2019 e 2024: voti di lista, affluenza comunale, confronti, fonti e dati scaricabili.', 'type': 'CollectionPage', 'network_in_footer': True}
    target = ROOT / page['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(head_metadata(shell(body, '../', config['updated'], version), page), encoding='utf-8', newline='\n')
    pages.insert(0, page)
    (ROOT / 'seo/election-pages.json').write_text(json.dumps(pages, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    output = ROOT / 'assets/election-pages-data.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps({'generated_by': 'scripts/build_election_pages.py', 'updated': config['updated'], 'bundle_version': version, 'territorial_basis': '2021-12-31', 'elections': models}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for model in models:
        print(f'{model["key"]}: {model["result_units"]} results units, {percent(model["turnout"]["turnout"])} turnout, {model["parties"][0]["name"]} first; {model["common"]} paired units, delta {model["delta"]:+.2f} points')
    print(f'Built {len(pages)} public HTML pages, using bundle {version}.')


if __name__ == '__main__':
    build()
