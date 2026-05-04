export const q = id => document.getElementById(id);

export const safeNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  const normalized = compact.includes(',') && compact.includes('.')
    ? (compact.lastIndexOf(',') > compact.lastIndexOf('.')
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, ''))
    : compact.includes(',')
      ? compact.replace(',', '.')
      : compact;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
};

export const fmtPct = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1);
export const fmtPctSigned = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}`;
export const fmtInt = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('it-IT');
export const uniqueSorted = values => [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))].sort((a, b) => String(a).localeCompare(String(b), 'it'));
export const mean = values => {
  const arr = values.filter(v => Number.isFinite(v));
  return arr.length ? d3.mean(arr) : null;
};

// Order matters: more specific patterns must come BEFORE more generic ones.
// All regexes are case-insensitive. Word boundaries \b are used wherever a bare
// substring would risk matching unrelated labels (e.g. /lega/ would match
// "Sviluppo-Legalità", /grillo/ would match "Lista dei Grilli Parlanti").
//
// Coverage targets, in priority order:
//  1. No substring leaks (audit-tested against all 469 unique party_raw labels).
//  2. Every party that hits ≥ 0.5% national share in any Italian Camera election
//     1946-2022 must have an explicit mapping (no falling to gray).
//  3. Major historical/recurring parties (DC, PCI, PSI, MSI, monarchici, …) must
//     map to a family/bloc that reflects their political tradition.
export const PARTY_FALLBACKS = [
  // --- Hard-left / extra-parliamentary ---
  [/rifondazione (comunista|miss)|^prc$|^rc$/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'Rifondazione Comunista' }],
  [/comunisti italiani|^pdci$|partito dei comunisti/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#991b1b', display: 'Comunisti Italiani' }],
  [/partito comunista dei lavoratori|alternativa comunista|^pcl$|sinistra critica|pc\(marx-len\)/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'PC Lavoratori / Sin. Critica' }],
  [/^pdup\b|^p\.?\s?d\.?\s?u\.?\s?p\.?$|democrazia proletaria|^dem\.?\s?prol\b|nuova sin(istra)?\.?\s?unit/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'PDUP / DemProl' }],
  [/il manifesto|^manifesto$/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#9f1239', display: 'Il Manifesto' }],
  [/sinistra ecologia liberta|^sel$/i, { family: 'ecologista', bloc: 'sinistra', color: '#b91c1c', display: 'SEL' }],
  [/sinistra arcobaleno|la sinistra l.?arcobaleno/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#dc2626', display: 'Sinistra Arcobaleno' }],
  [/rivoluzione civile/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#9f1239', display: 'Rivoluzione Civile' }],
  [/liberi e uguali|^leu$/i, { family: 'centro-sinistra', bloc: 'sinistra', color: '#dc2626', display: 'LeU' }],
  [/potere al popolo|^pap$|per una sinistra rivoluzionaria/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'Potere al Popolo' }],
  [/la rosa nel pugno|riformisti italiani/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec4899', display: 'Rosa nel Pugno' }],
  [/fr\.?\s?democr\.?\s?popolare|fronte democratico popolare/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#b91c1c', display: 'Fr. Democratico Popolare' }],
  [/^pci$|^p\.?\s?c\.?\s?i\.?$|partito comunista italiano|partito comunista\b/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#c62828', display: 'PCI' }],

  // --- Centro-sinistra storica ---
  [/^pds$|democratici di sinistra|democratici sinistra|^ds$|^d\.?\s?s\.?$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#dc2626', display: 'PDS / DS' }],
  [/l['\u2019]ulivo|^ulivo$|pop[\.\-\s]+svp[\.\-\s]+pri[\.\-\s]+ud[\.\-\s]+prodi|prodi.?presidente/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#ef4444', display: "L'Ulivo" }],
  [/la margherita|^margherita$|fiore margherita|democrazia e liberta/i, { family: 'cattolico-popolare', bloc: 'centro-sinistra', color: '#f97316', display: 'La Margherita' }],
  [/centro democratico|democrazia e solidarieta|alleanza democratica/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#ef4444', display: 'Centro Democratico / AD' }],
  [/la rete\b|mov\.?\s?dem\b|movimento democratico/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#fb7185', display: 'La Rete' }],
  [/italia europa insieme|^insieme\b/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#f87171', display: 'Italia Europa Insieme' }],
  [/^i socialisti\b/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec4899', display: 'I Socialisti' }],
  [/partito democratico|^pd$|^p\.?\s?d\.?$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#d32f2f', display: 'PD' }],

  // --- Socialisti / verdi / radicali ---
  [/sinistra italiana|^verdi$|^verdi\b|avs|alleanza verdi|federazione.*verdi|verdi.*verdi|verdi-verdi|lista verde|il girasole|sdi.?verdi|verdi.?sdi/i, { family: 'ecologista', bloc: 'sinistra', color: '#2f855a', display: 'Verdi / AVS' }],
  [/^psu\b|partito socialista unificato|un\.?\s?social\.?\s?indip|unione socialista indipendente/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#f9a8d4', display: 'PSU / Soc. Indip.' }],
  [/unita.?popolare/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec4899', display: 'Unità Popolare' }],
  [/^psi$|socialista|psiup|nuovo psi|socialdemocrazia/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec407a', display: 'PSI' }],
  [/^psdi$|socialdemocratic/i, { family: 'socialdemocratico', bloc: 'centro-sinistra', color: '#f472b6', display: 'PSDI' }],
  [/radical|pannella|bonino|^p\.?\s?rad\b/i, { family: 'radicale', bloc: 'liberale', color: '#8b5cf6', display: 'Radicali' }],

  // --- Centro / liberale-riformista ---
  [/scelta civica|monti per l/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fb923c', display: 'Scelta Civica' }],
  [/futuro e liberta|^fli$/i, { family: 'liberale-riformista', bloc: 'centro-destra', color: '#fdba74', display: 'FLI' }],
  [/fare per fermare/i, { family: 'liberale-riformista', bloc: 'centro', color: '#f59e0b', display: 'Fare' }],
  [/lega d.?azione|movimento per le autonomie|\bmpa\b|movimento per l.?autonomia|grande sud/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: "Lega d'Azione / MpA" }],
  [/\bazione\b|^az$|italia viva|^iv$|renew|^calenda$/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fb923c', display: 'Azione / IV' }],
  [/italia dei valori|di pietro|^idv$/i, { family: 'liberale-riformista', bloc: 'centro-sinistra', color: '#fcd34d', display: 'IdV' }],
  [/\+europa|piu europa/i, { family: 'liberale-riformista', bloc: 'centro', color: '#22d3ee', display: '+Europa' }],
  [/^pri\b|repubblican|^all\.?\s?repubblicana\b/i, { family: 'laico-repubblicano', bloc: 'centro', color: '#10b981', display: 'PRI' }],
  [/\bpli\b|liberale italiano|liberali per l|federalisti liberali/i, { family: 'liberale', bloc: 'centro-destra', color: '#0284c7', display: 'PLI' }],
  [/patto segni|patto per l.?italia/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fbbf24', display: 'Patto Segni' }],
  [/rinnovamento it|lista dini|dini lista|^ri-dini\b/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fdba74', display: 'Rinnovamento (Dini)' }],
  [/democrazia europea|^d\.?\s?e\.?$/i, { family: 'liberale-riformista', bloc: 'centro', color: '#facc15', display: 'Democrazia Europea' }],
  [/^comunita\b|movimento comunita/i, { family: 'liberale', bloc: 'centro', color: '#06b6d4', display: 'Comunità' }],

  // --- Liberale-conservatore storico ---
  [/un\.?\s?democ\.?\s?nazionale|unione democratica nazionale|^udn\b|all\.?\s?democ\.?\s?nazionale/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#1d4ed8', display: 'UDN' }],
  [/blocco nazionale|blocco naz\.?\s?liberta/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: 'Blocco Nazionale' }],

  // --- Centro cattolico ---
  [/unione di centro|^udc$|^u\.?\s?d\.?\s?c\.?$|ccd-cdu|^ccd$|^cdu$|udeur|u\.?\s?d\.?\s?eur\b|popolari uniti|unione popolare/i, { family: 'cattolico-popolare', bloc: 'centro', color: '#fbbf24', display: 'UDC' }],
  [/partito popolare italiano|^ppi$|^p\.?\s?p\.?\s?i\.?$|popolare italian|partito cristiano sociale/i, { family: 'cattolico-popolare', bloc: 'centro-sinistra', color: '#fde68a', display: 'PPI' }],
  [/il popolo della famiglia|popolo della famiglia/i, { family: 'cattolico-popolare', bloc: 'centro-destra', color: '#fcd34d', display: 'Popolo della Famiglia' }],
  [/^dc\b|democrazia cristiana/i, { family: 'cattolico-popolare', bloc: 'centro', color: '#2e7d32', display: 'DC' }],

  // --- Centro-destra liberal-conservatore ---
  [/forza italia|^fi$|^f\.?\s?i\.?$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#1976d2', display: 'Forza Italia' }],
  [/popolo della liberta|^pdl$|^p\.?\s?d\.?\s?l\.?$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#1d4ed8', display: 'PdL' }],
  [/noi (con l|moderati)|civica popolare|toti.*brugnaro|noi di centro/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: 'Noi Moderati' }],
  // FIX (PR #16): was /lega|.../ which leaked into "Sviluppo-Legalità". Now \blega\b plus
  // explicit liga regional variants. Lega d'Azione is matched earlier so unaffected.
  [/\blega\b|leganord|^ln$|\bliga\b/i, { family: 'regionalista', bloc: 'centro-destra', color: '#2e7d32', display: 'Lega' }],

  // --- Destra nazionale ---
  [/alleanza nazionale|^an$/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e40af', display: 'AN' }],
  [/fratelli d.?italia|^fdi$/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e3a8a', display: 'FdI' }],
  [/casapound|forza nuova|fiamma tricolore|destra nazionale|\bmsi\b|movimento sociale|la destra|forza del popolo|italia agli italiani|mov\.?\s?soc\.?\s?tricolore|alternativa sociale|\bmussolini\b/i, { family: 'destra nazionale', bloc: 'destra', color: '#0d47a1', display: 'Destra naz.' }],
  [/^dn\b|^dn-cd\b|democrazia nazionale/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e40af', display: 'DN' }],
  [/italexit|paragone\b|italia sovrana e popolare|^isp\b|^vita$|lista vita|^no euro\b/i, { family: 'destra nazionale', bloc: 'destra', color: '#0c4a6e', display: 'Sovranisti' }],

  // --- Monarchici ---
  [/^pnm\b|partito nazionale monarchico|p\.?\s?naz\.?\s?monarchico|p\.?\s?naz\.?\s?mon\.|^pmp\b|p\.?\s?monarchico|pdium|partito democratico italiano di unit.?\s?monarchica|all\.?\s?monarc|mov\.?\s?dem\.?\s?monarc|alleanza monarchica|\bmonarchic/i, { family: 'monarchico', bloc: 'destra', color: '#7c2d12', display: 'Monarchici' }],

  // --- Populista ---
  [/movimento 5 stelle|^m5s$|beppegrillo|impegno civico|\bgrillo\b|\bconte\b/i, { family: 'populista', bloc: 'populista', color: '#f59e0b', display: 'M5S' }],
  [/fronte (dell.?\s?)?uomo qualunque|fr\.?\s?uomo qualunque|qualunqui/i, { family: 'populista', bloc: 'populista', color: '#fb923c', display: 'Uomo Qualunque' }],

  // --- Pensionati ---
  [/partito pensionat|part\.?\s?naz\.?\s?pens\b|^pens\b/i, { family: 'pensionati', bloc: 'centro', color: '#a1a1aa', display: 'Pensionati' }],

  // --- Regional autonomista ---
  [/^svp\b|sudtiroler|sud tirol|die freiheitlichen|union fur sud|valle d.aosta|union valdotaine|^ppst\b|partito popolare sudtirolese|svp\s*[\-\s\.]*\s*patt|^patt\b/i, { family: 'regionalista', bloc: 'centro-destra', color: '#16a34a', display: 'Autonomisti' }],
  [/mov\.?\s?indipend\.?\s?sic|movimento indipendentista siciliano|^mis\b|sud chiama nord|cateno de luca/i, { family: 'regionalista', bloc: 'centro-destra', color: '#16a34a', display: 'Sicilianisti' }],
  [/^ps\.?\s?d.?\s?az\b|partito sardo d.?azione|^psdaz\b|^piemont\b/i, { family: 'regionalista', bloc: 'centro-destra', color: '#22c55e', display: 'Autonomisti regionali' }],
];

export const BLOCK_COLORS = {
  'sinistra': '#c62828',
  'centro-sinistra': '#ef5350',
  'centro': '#64748b',
  'liberale': '#8b5cf6',
  'centro-destra': '#1d4ed8',
  'destra': '#0f172a',
  'populista': '#f59e0b',
  'regionalista': '#2e7d32',
  'altro': '#475569'
};

export const FAMILY_COLORS = {
  'cattolico-popolare': '#b45309',
  'sinistra storica': '#b91c1c',
  'sinistra socialista': '#db2777',
  'destra nazionale': '#1e3a8a',
  'liberal-conservatore': '#2563eb',
  'centro-sinistra': '#dc2626',
  'regionalista': '#15803d',
  'populista': '#d97706',
  'ecologista': '#047857',
  'radicale': '#7c3aed',
  'liberale-riformista': '#ea580c',
  'laico-repubblicano': '#0f766e',
  'liberale': '#0369a1',
  'liberale-conservatore': '#1d4ed8',
  'socialdemocratico': '#ec4899',
  'monarchico': '#7c2d12',
  'pensionati': '#71717a',
  'altro': '#64748b'
};

export const AREA_PRESETS = [
  { value: 'all', label: 'Tutta la Lombardia', tokens: [] },
  { value: 'brianza_milan', label: 'Milano + Brianza + Lecchese', tokens: ['milano', 'monza', 'brianza', 'lecco'] },
  { value: 'insubria', label: 'Insubria / laghi', tokens: ['varese', 'como', 'lecco', 'sondrio'] },
  { value: 'ovest', label: 'Lombardia occidentale', tokens: ['milano', 'varese', 'como', 'pavia', 'lodi', 'monza', 'brianza'] },
  { value: 'est', label: 'Lombardia orientale', tokens: ['bergamo', 'brescia', 'cremona', 'mantova'] },
  { value: 'alpina', label: 'Fascia alpina', tokens: ['sondrio', 'bergamo', 'brescia', 'lecco', 'como', 'varese'] },
  { value: 'bassa', label: 'Bassa / padana', tokens: ['pavia', 'lodi', 'cremona', 'mantova'] },
  { value: 'custom', label: 'Selezione manuale', tokens: null }
];

export const FALLBACK_PARTY_OPTIONS = [
  'DC', 'PCI', 'PSI', 'MSI', 'Forza Italia', 'PD', 'Lega', 'FdI', 'M5S', 'AVS / Verdi'
];
