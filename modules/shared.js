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
// All regexes are case-insensitive and most use \b boundaries to avoid
// substring leaks (e.g. "azione" matching "Rifondazione").
export const PARTY_FALLBACKS = [
  // --- Hard-left ---
  [/rifondazione (comunista|miss)|^prc$|^rc$/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'Rifondazione Comunista' }],
  [/comunisti italiani|^pdci$|partito dei comunisti/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#991b1b', display: 'Comunisti Italiani' }],
  [/partito comunista dei lavoratori|alternativa comunista|^pcl$/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'PC Lavoratori' }],
  [/sinistra ecologia liberta|^sel$/i, { family: 'ecologista', bloc: 'sinistra', color: '#b91c1c', display: 'SEL' }],
  [/rivoluzione civile/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#9f1239', display: 'Rivoluzione Civile' }],
  [/liberi e uguali|^leu$/i, { family: 'centro-sinistra', bloc: 'sinistra', color: '#dc2626', display: 'LeU' }],
  [/potere al popolo|^pap$|per una sinistra rivoluzionaria/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'Potere al Popolo' }],
  [/la rosa nel pugno|riformisti italiani/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec4899', display: 'Rosa nel Pugno' }],
  [/^pci$|^p\.?\s?c\.?\s?i\.?$|partito comunista italiano|partito comunista\b/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#c62828', display: 'PCI' }],

  // --- Centro-sinistra storica ---
  [/^pds$|democratici di sinistra|democratici sinistra|^ds$|^d\.?\s?s\.?$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#dc2626', display: 'PDS / DS' }],
  [/l['\u2019]ulivo|^ulivo$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#ef4444', display: "L'Ulivo" }],
  [/la margherita|^margherita$|fiore margherita|democrazia e liberta/i, { family: 'cattolico-popolare', bloc: 'centro-sinistra', color: '#f97316', display: 'La Margherita' }],
  [/centro democratico|democrazia e solidarieta/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#ef4444', display: 'Centro Democratico' }],
  [/partito democratico|^pd$|^p\.?\s?d\.?$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#d32f2f', display: 'PD' }],

  // --- Socialisti / verdi / radicali ---
  [/sinistra italiana|verdi|avs|alleanza verdi|federazione.*verdi|verdi.*verdi|verdi-verdi|lista verde/i, { family: 'ecologista', bloc: 'sinistra', color: '#2f855a', display: 'Verdi / AVS' }],
  [/^psi$|socialista|psiup|nuovo psi/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec407a', display: 'PSI' }],
  [/^psdi$|socialdemocratic/i, { family: 'socialdemocratico', bloc: 'centro-sinistra', color: '#f472b6', display: 'PSDI' }],
  [/radical|pannella|bonino/i, { family: 'radicale', bloc: 'liberale', color: '#8b5cf6', display: 'Radicali' }],

  // --- Centro / liberale-riformista ---
  [/scelta civica|monti per l/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fb923c', display: 'Scelta Civica' }],
  [/futuro e liberta|^fli$/i, { family: 'liberale-riformista', bloc: 'centro-destra', color: '#fdba74', display: 'FLI' }],
  [/fare per fermare/i, { family: 'liberale-riformista', bloc: 'centro', color: '#f59e0b', display: 'Fare' }],
  [/lega d.?azione|movimento per le autonomie|^mpa$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: "Lega d'Azione / MpA" }],
  [/\bazione\b|^az$|italia viva|^iv$|renew|^calenda$/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fb923c', display: 'Azione / IV' }],
  [/italia dei valori|di pietro|^idv$/i, { family: 'liberale-riformista', bloc: 'centro-sinistra', color: '#fcd34d', display: 'IdV' }],
  [/\+europa|piu europa/i, { family: 'liberale-riformista', bloc: 'centro', color: '#22d3ee', display: '+Europa' }],
  [/^pri\b|repubblican/i, { family: 'laico-repubblicano', bloc: 'centro', color: '#10b981', display: 'PRI' }],
  [/\bpli\b|liberale italiano|liberali per l|federalisti liberali/i, { family: 'liberale', bloc: 'centro-destra', color: '#0284c7', display: 'PLI' }],

  // --- Centro cattolico ---
  [/unione di centro|^udc$|^u\.?\s?d\.?\s?c\.?$|ccd-cdu|^ccd$|^cdu$|udeur|popolari uniti|unione popolare/i, { family: 'cattolico-popolare', bloc: 'centro', color: '#fbbf24', display: 'UDC' }],
  [/partito popolare italiano|^ppi$|^p\.?\s?p\.?\s?i\.?$|popolare italian/i, { family: 'cattolico-popolare', bloc: 'centro-sinistra', color: '#fde68a', display: 'PPI' }],
  [/^dc\b|democrazia cristiana/i, { family: 'cattolico-popolare', bloc: 'centro', color: '#2e7d32', display: 'DC' }],

  // --- Centro-destra liberal-conservatore ---
  [/forza italia|^fi$|^f\.?\s?i\.?$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#1976d2', display: 'Forza Italia' }],
  [/popolo della liberta|^pdl$|^p\.?\s?d\.?\s?l\.?$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#1d4ed8', display: 'PdL' }],
  [/noi (con l|moderati)|civica popolare|toti.*brugnaro|noi di centro/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: 'Noi Moderati' }],
  [/lega|leganord|^ln$|lega nord|lega per salvini|\blega salvini\b/i, { family: 'regionalista', bloc: 'centro-destra', color: '#2e7d32', display: 'Lega' }],

  // --- Destra nazionale ---
  [/alleanza nazionale|^an$/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e40af', display: 'AN' }],
  [/fratelli d.?italia|^fdi$/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e3a8a', display: 'FdI' }],
  [/casapound|forza nuova|fiamma tricolore|destra nazionale|\bmsi\b|movimento sociale|la destra|forza del popolo|italia agli italiani/i, { family: 'destra nazionale', bloc: 'destra', color: '#0d47a1', display: 'Destra naz.' }],

  // --- Populista ---
  [/movimento 5 stelle|^m5s$|beppegrillo|impegno civico|\bgrillo\b|\bconte\b/i, { family: 'populista', bloc: 'populista', color: '#f59e0b', display: 'M5S' }],

  // --- Regional autonomista (extra) ---
  [/^svp$|sudtiroler|sud tirol|die freiheitlichen|union fur sud|valle d.aosta|union valdotaine/i, { family: 'regionalista', bloc: 'centro-destra', color: '#16a34a', display: 'Autonomisti' }],
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
  'socialdemocratico': '#ec4899',
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
