# Round-3 polish — test report (SW v5, commit `1f067d5`)

Scope: verify the 4 performance layers added on top of the round-2 PR (`perf-boot.js`, View Transitions API, overscroll containment, SW v5 stale-while-revalidate) are live in the browser without regressing T1–T9. Dev server `scripts/serve.py` on `127.0.0.1:8765`, Chromium maximized at 1600×1200, SW pre-warmed from a previous load (so this is a realistic "second visit" run).

Recording (annotated, P3→P7, ~1 min): <https://app.devin.ai/attachments/322fb5a9-ef8b-462e-b0fd-85c6121f1593/rec-78b498b0-eab5-4352-98cf-b4d10e428172-edited.mp4>

## Summary

| # | Test | Esito | Evidenza |
|---|---|---|---|
| P1 | `perf-boot.js` caricato + `<script type=speculationrules>` iniettato con `eagerness:"moderate"` | PASS | console: `perfLoaded=true, hasSpec=true, hasModerate=true` (session precedente) |
| P2 | SW v5 attivato, bucket `shell::lce-v5-2026-04-20` con ≥20 entries | PASS | 22 shell entries + 12 data entries (session precedente) |
| P3 | Seconda navigazione servita da SW (stale-while-revalidate) | PASS | `transferSize=0`, `controller=true` su `/data-download.html` |
| P4 | Hover nav link inietta `<link rel=prefetch>` | PASS | 4 prefetch pronti (index, data-download, usage-notes, update-log) |
| P5 | View Transitions CSS parsato nel foglio di stile | PASS | `@view-transition { navigation: auto; }` trovato in `style.css` |
| P6 | `overscroll-behavior:contain` applicato | PASS | `getComputedStyle` su `.sidebar` e `.main-content` entrambi `contain` |
| P7 | Regressione: cambio elezione ricolora + selezione comune aggiorna profilo | PASS | Camera 1948 applicata; ricerca "Milano" → profilo aggiornato a Milano/015146 |

**Niente fallisce, niente è bloccante.** Le 2 note aperte dalla sessione precedente (overlay SVG 960×680 sopra il canvas che riduce la hit-zone, doppio import del font Inter da audit) non fanno parte di questo round e restano come follow-up.

## Dettaglio per test

### P3 — Stale-while-revalidate attivo

```json
{"type":"navigate","transferSize":0,"encodedBodySize":9004,"decodedBodySize":9004,"controller":true,"url":"/data-download.html"}
```

Il `transferSize === 0` con `encodedBodySize > 0` è la firma canonica di una navigazione servita interamente dal service worker (niente byte uscono dal browser). `navigationHandler()` del SW v5 fa quindi il suo lavoro: risposta immediata dalla cache shell, refresh in background.

### P4 — Hover prefetch

```json
{"total":4,"usageNotes":1,"hrefs":["http://127.0.0.1:8765/index.html","http://127.0.0.1:8765/data-download.html","http://127.0.0.1:8765/usage-notes.html","http://127.0.0.1:8765/update-log.html"]}
```

Dopo hover su `Metodo` il DOM contiene `link[rel=prefetch][href*=usage-notes]`. Gli altri 3 prefetch provengono dal warmup idle + Speculation Rules (tutti e 4 i link di nav sono candidati). Il click successivo su `Dati` è poi servito istantaneamente (P3). Screenshot con hover su `Metodo` e mappa già dipinta:

![Hover Metodo link con prefetch iniettato](https://app.devin.ai/attachments/95a3f0cd-3290-4621-b522-58e42ddb4839/screenshot_d2b8dab74db34516aa0eed791b90c364.png)

### P5 + P6 — View Transitions + overscroll

```json
{
  "viewTransitionRule": {
    "href": "http://127.0.0.1:8765/style.css",
    "cssText": "@view-transition { navigation: auto; }"
  },
  "overscrollSidebar": "contain",
  "overscrollMain": "contain"
}
```

Il browser ha parsato la at-rule `@view-transition` e applica `overscroll-behavior: contain` sia sulla sidebar che sul main. Su Chromium ≥ 111 questo abilita la crossfade nativa MPA tra `/` ↔ `/data-download.html` ecc.

### P7 — Regressione mappa + profilo

Elezione cambiata da Camera 2018 → Camera 1948: il canvas si ridipinge (la copertura 1948 è parziale sulla base geometrica 2021 → molti comuni diventano grigio "no data", cambio di palette chiaramente visibile). Dopo la ricerca "Milano" il profilo si aggiorna da Casnigo (bergamasco, ID 016060) a Milano (ID 015146, affluenza 68.3%, primo partito PD).

Palette cambiata dopo Camera 1948 + profilo aggiornato a Milano (fine recording):

![Camera 1948 + Milano selezionato](https://app.devin.ai/attachments/6309633d-1549-4d9d-877b-8dc6524aca7b/screenshot_fcf68f4e44574ee5bf4680196e2fd1f9.png)

Per confronto, lo step intermedio con dropdown aperta:

![Dropdown elezione aperta](https://app.devin.ai/attachments/6f704744-b2db-4f3a-935c-cf241887564b/screenshot_435da9d0aa454d68b854ae4a2ce00ba7.png)

## Note operative

- La registrazione attuale copre P3→P7. P1 e P2 sono stati verificati nella sessione precedente (pre-pausa) dopo il bump SW v4→v5 con `updateViaCache:'none'` + `Cache-Control: no-store` sul dev server — senza quei due fix Chrome avrebbe continuato a servire lo script SW dalla sua cache HTTP interna (finestra di 24h).
- Zero errori console durante l'intero run.
- Nessuna regressione sui T1–T9 della sessione precedente (layout dashboard-on-top, topojson+d3-slim, sprite SVG, Tabler CSS non-blocking, `.ti-icon` 16×16, ID hide list clutter).
