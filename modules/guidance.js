export const AUDIENCE_MODES = {
  public: {
    label: 'Pubblico',
    description: 'Per cittadini e lettrici occasionali: linguaggio piano, enfasi su cosa si vede davvero e cosa resta parziale.',
    checklist: [
      'Leggi prima metrica attiva, elezione e livello territoriale.',
      'Distingui sempre "dato assente" da "valore basso".',
      'Usa audit e coverage prima di trarre conclusioni storiche forti.'
    ]
  },
  research: {
    label: 'Ricerca',
    description: 'Per uso accademico e analitico: comparabilita territoriale, copertura, boundary basis e limiti del bundle in primo piano.',
    checklist: [
      'Controlla storico vs armonizzato e base geometrica.',
      'Verifica coverage per anno prima di stimare trend.',
      'Usa download, codebook e note metodologiche insieme alla dashboard.'
    ]
  },
  admin: {
    label: 'Amministratori',
    description: 'Per lettura civica e amministrativa: focus su affluenza, scarti territoriali e profili comunali leggibili senza perdere rigore.',
    checklist: [
      'Parti da affluenza, margini e scarti rispetto a provincia/regione.',
      'Confronta il tuo comune con vicini e comuni simili.',
      'Leggi le note territoriali prima di usare confronti longitudinali.'
    ]
  },
  press: {
    label: 'Stampa',
    description: 'Per giornalisti e comunicatori: aiuta a trovare differenze e traiettorie, ma frena letture eccessive quando i dati sono sottili.',
    checklist: [
      'Evita titoli assoluti se coverage e comparabilita sono deboli.',
      'Usa confronto tra due elezioni solo se il bundle ha righe utili in entrambi gli anni.',
      'Cita sempre metrica, perimetro e limiti del dato.'
    ]
  }
};

export const GLOSSARY_ENTRIES = [
  { term: 'Storico', text: "Mostra i comuni nel loro assetto dell'epoca, quando il bundle lo consente." },
  { term: 'Armonizzato', text: 'Riallinea i risultati a una base territoriale comune per confronti nel tempo.' },
  { term: 'Copertura sostanziale', text: 'Quanta parte della storia elettorale nota ha righe davvero utili nel bundle.' },
  { term: 'Readiness tecnica', text: 'Coerenza interna del bundle: file, join, geometrie e controlli di base.' },
  { term: 'No data', text: 'Dato non disponibile o non unibile: non significa valore basso.' },
  { term: 'Base geometrica', text: 'Anno dei confini usato per disegnare la mappa e collegare i dati territoriali.' }
];

export const GUIDED_QUESTION_BANK = [
  {
    id: 'turnout-map',
    audiences: ['public', 'admin', 'press', 'research'],
    label: 'Dove si vota di piu o di meno?',
    desc: "Imposta l'affluenza come metrica principale e ti porta alla mappa e alle province.",
    kicker: 'Buona per aprire la lettura del territorio senza partire dai partiti.',
    settings: { analysisMode: 'explore', metric: 'turnout', palette: 'sequential' },
    jumpTarget: 'map-wrapper'
  },
  {
    id: 'selected-share',
    audiences: ['public', 'admin', 'press', 'research'],
    label: 'Come va il partito selezionato?',
    desc: 'Attiva la quota del partito, famiglia o blocco scelto e la rende leggibile in mappa e tabella.',
    kicker: 'Utile quando hai gia una selezione attiva e vuoi restare disciplinato.',
    settings: { metric: 'party_share', palette: 'sequential', ensurePartySelection: true },
    jumpTarget: 'map-wrapper'
  },
  {
    id: 'swing-map',
    audiences: ['press', 'research', 'admin'],
    label: 'Dove cambia davvero tra due elezioni?',
    desc: 'Attiva lo swing e, se manca, sceglie automaticamente un anno di confronto con copertura utile.',
    kicker: 'Perfetta per storie di cambiamento, ma va sempre letta insieme a coverage e limiti.',
    settings: { analysisMode: 'compare', metric: 'swing_compare', palette: 'diverging', ensureCompareElection: true },
    jumpTarget: 'compare-map-summary'
  },
  {
    id: 'stability-map',
    audiences: ['research', 'press', 'admin'],
    label: 'Quali comuni sono piu stabili o piu mobili?',
    desc: "Porta in primo piano l'indice di stabilita, piu utile dei singoli risultati per leggere persistenze.",
    kicker: 'Ideale per un racconto strutturale, non per una sola elezione.',
    settings: { analysisMode: 'diagnose', metric: 'stability_index', palette: 'accessible' },
    jumpTarget: 'rankings-panel-content'
  },
  {
    id: 'province-gap',
    audiences: ['admin', 'research', 'press'],
    label: 'Dove il comune sta sopra o sotto la sua provincia?',
    desc: 'Attiva lo scarto vs provincia per la selezione corrente e apre una lettura comparativa piu amministrativa.',
    kicker: 'Ottima per benchmark locali, purche la selezione attiva sia chiara.',
    settings: { metric: 'over_performance_province', palette: 'diverging', ensurePartySelection: true },
    jumpTarget: 'province-insights'
  },
  {
    id: 'trajectory-selected',
    audiences: ['public', 'admin', 'press', 'research'],
    label: 'Raccontami la traiettoria di un comune',
    desc: 'Passa alla modalita traiettoria e spinge la scheda comune al centro della lettura.',
    kicker: 'Funziona meglio quando hai gia selezionato un comune.',
    settings: { analysisMode: 'trajectory', metric: 'party_share', palette: 'sequential', ensurePartySelection: true },
    jumpTarget: 'municipality-profile'
  },
  {
    id: 'coverage-audit',
    audiences: ['public', 'press', 'research', 'admin'],
    label: 'Quanta base empirica ho davvero qui sotto?',
    desc: 'Non cambia la narrativa: ti porta direttamente a coverage, audit e data package.',
    kicker: 'Da usare prima di fare affermazioni forti o titoli assoluti.',
    settings: { analysisMode: 'diagnose', metric: 'stability_index', palette: 'accessible', showNotes: true },
    jumpTarget: 'coverage-matrix'
  },
  {
    id: 'custom-layer',
    audiences: ['research', 'admin'],
    label: 'Che succede se aggiungo un indicatore esterno?',
    desc: 'Porta in primo piano il layer custom o, se manca, mantiene la struttura pronta per quando carichi i dati esterni.',
    kicker: 'Base utile per collegare elezioni, profili socio-economici e amministrativi.',
    settings: { analysisMode: 'layers', metric: 'custom_indicator', palette: 'accessible' },
    jumpTarget: 'custom-indicator-summary'
  }
];

export const DEFAULT_SITE_LAYERS = [
  {
    key: 'explore',
    title: 'Esplora',
    eyebrow: 'Public front door',
    description: 'Apri la mappa, orientati con affluenza, primo partito e scheda comune senza dover entrare subito nei dettagli del bundle.',
    audience: 'public',
    analysisMode: 'explore',
    uiLevel: 'basic',
    jumpTarget: 'map-wrapper',
    cta: 'Apri la mappa'
  },
  {
    key: 'understand',
    title: 'Capisci',
    eyebrow: 'Briefing layer',
    description: 'Passa da mappa a briefing, evidenza e confronto: e il livello giusto per amministratori, stampa e letture pubbliche disciplinate.',
    audience: 'press',
    analysisMode: 'compare',
    uiLevel: 'basic',
    jumpTarget: 'evidence-panel',
    cta: 'Apri briefing'
  },
  {
    key: 'analyze',
    title: 'Analizza',
    eyebrow: 'Research layer',
    description: 'Vai su audit, release, coverage e accesso programmatico. E lo strato da usare quando la vista deve essere anche riproducibile.',
    audience: 'research',
    analysisMode: 'diagnose',
    uiLevel: 'advanced',
    jumpTarget: 'release-studio-panel',
    cta: 'Apri release studio'
  }
];

export const DEFAULT_METHOD_EXPLAINERS = [
  {
    key: 'what_you_see',
    title: 'Cosa stai guardando',
    body: 'Ogni vista combina metrica, elezione, modalita territoriale e base geometrica. La mappa non e mai una fotografia neutra: e sempre un filtro dichiarato.',
    accent: 'scope'
  },
  {
    key: 'nodata',
    title: 'No data non vuol dire valore basso',
    body: 'Un comune grigio o non colorato puo indicare dato assente, coverage insufficiente o join territoriale non disponibile. Va distinto da un vero valore basso.',
    accent: 'nodata'
  },
  {
    key: 'historical_vs_harm',
    title: 'Storico vs armonizzato',
    body: "Storico conserva il perimetro dell'epoca; armonizzato riallinea i risultati a una base comune per confronti nel tempo. Le due letture rispondono a domande diverse.",
    accent: 'boundary'
  },
  {
    key: 'cite',
    title: 'Quando la vista e citabile',
    body: 'Una vista diventa piu usabile quando coverage, risultati, geometrie e confronto sono dichiarati e coerenti. Per questo il sito espone evidenza, citazione pronta e riga di riproducibilita.',
    accent: 'evidence'
  }
];

export const DEFAULT_FAQ_ITEMS = [
  {
    question: 'Posso confrontare due elezioni qualsiasi?',
    answer: 'Solo con disciplina. Il confronto ha senso se entrambi gli anni hanno copertura utile e la base territoriale scelta regge davvero la lettura. Coverage, evidence ladder e note territoriali servono proprio a questo.',
    tag: 'Confronti'
  },
  {
    question: 'Che cosa significa "no data"?',
    answer: 'Significa che il bundle non offre un valore affidabile per quella vista: il dato puo mancare, essere troppo parziale o non agganciarsi bene alla geometria. Non va letto come valore basso.',
    tag: 'No data'
  },
  {
    question: 'Qual e la differenza tra storico e armonizzato?',
    answer: "Storico conserva il perimetro dell'epoca; armonizzato cerca un confronto su confini costanti. Storico e piu fedele al momento elettorale, armonizzato e piu utile per serie temporali comparabili.",
    tag: 'Boundary'
  },
  {
    question: 'Posso citare una vista in un report o in un articolo?',
    answer: 'Si, ma conviene citare anche metrica, anno, modalita territoriale, base geometrica e livello di evidenza. Il pannello "Livello di evidenza e citazione" serve proprio a questo.',
    tag: 'Citazione'
  },
  {
    question: 'Il progetto si usa solo dal sito?',
    answer: 'No. Il bundle dichiara manifest, prodotti dati, provenance, contracts e loader ufficiali Python/R, cosi la stessa release puo essere letta anche da codice e non solo dalla UI.',
    tag: 'Programmatico'
  }
];

export const DEFAULT_SITE_MANIFESTO = {
  title: 'Una base elettorale che non ti chiede di scegliere tra rigore e accessibilita.',
  standfirst: 'Sotto c e una release leggibile da codice; sopra, un sito che prova a spiegare, confrontare e dichiarare i limiti senza nasconderli.',
  statement: 'Non una mappa che suggerisce una storia sola, ma un atlante che lascia emergere storie diverse sullo stesso terreno dichiarato.'
};

export const DEFAULT_SIGNATURE_PILLARS = [
  {
    key: 'same_engine',
    eyebrow: 'Stesso motore',
    title: 'Pubblico, briefing, ricerca',
    body: 'Tre porte di ingresso, una sola base: puoi partire semplice e scendere fino a release, contracts e accesso programmatico senza cambiare oggetto.'
  },
  {
    key: 'declared_limits',
    eyebrow: 'Limiti dichiarati',
    title: 'No-data e copertura non vengono nascosti',
    body: 'La parte divulgativa non finge completezza: rende leggibili coverage, evidenza e guardrail invece di trasformare il vuoto in storytelling.'
  },
  {
    key: 'release_backed',
    eyebrow: 'Release-backed',
    title: 'Ogni vista vive dentro una release',
    body: 'Manifest, products, provenance, contracts, citation e loader ufficiali spostano il progetto da dashboard gradevole a oggetto piu archivistico.'
  },
  {
    key: 'boundary_aware',
    eyebrow: 'Boundary-aware',
    title: 'I confini fanno parte della lettura',
    body: 'Storico, armonizzato e basi geometriche non sono dettagli tecnici nascosti: sono parte della promessa metodologica e della UX.'
  }
];
