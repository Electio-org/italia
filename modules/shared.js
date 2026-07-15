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
  [/rifondazione comunista|^prc$|^rc$/i, { family: 'sinistra storica', bloc: 'sinistra', color: '#7f1d1d', display: 'Rifondazione Comunista' }],
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
  [/lega d.?azione|movimento per le autonomie|\bmpa\b|movimento per l.?autonomia|grande sud/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: "Lega d'Azione / MpA" }],
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
  [/forza italia|^fi$|^f\.?\s?i\.?$/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#1976d2', display: 'Forza Italia' }],
  [/popolo della liberta|^pdl$|^p\.?\s?d\.?\s?l\.?$/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#1d4ed8', display: 'PdL' }],
  [/noi (con l|moderati)|civica popolare|toti.*brugnaro|noi di centro/i, { family: 'liberale-conservatore', bloc: 'centro-destra', color: '#3b82f6', display: 'Noi Moderati' }],
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
  [/movimento 5 stelle|^m5s$|beppegrillo|\bgrillo\b|\bconte\b/i, { family: 'populista', bloc: 'populista', color: '#f59e0b', display: 'M5S' }],
  [/fronte (dell.?\s?)?uomo qualunque|fr\.?\s?uomo qualunque|qualunqui/i, { family: 'populista', bloc: 'populista', color: '#fb923c', display: 'Uomo Qualunque' }],

  // --- Pensionati ---
  [/partito pensionat|part\.?\s?naz\.?\s?pens\b|^pens\b/i, { family: 'pensionati', bloc: 'centro', color: '#a1a1aa', display: 'Pensionati' }],

  // --- Regional autonomista ---
  [/^svp\b|sudtiroler|sud tirol|die freiheitlichen|union fur sud|valle d.aosta|union valdotaine|^ppst\b|partito popolare sudtirolese|svp\s*[\-\s\.]*\s*patt|^patt\b/i, { family: 'regionalista', bloc: 'regionalista', color: '#16a34a', display: 'Autonomisti' }],
  [/mov\.?\s?indipend\.?\s?sic|movimento indipendentista siciliano|^mis\b|sud chiama nord|cateno de luca/i, { family: 'regionalista', bloc: 'regionalista', color: '#16a34a', display: 'Sicilianisti' }],
  [/^ps\.?\s?d.?\s?az\b|partito sardo d.?azione|^psdaz\b|^piemont\b/i, { family: 'regionalista', bloc: 'regionalista', color: '#22c55e', display: 'Autonomisti regionali' }],
];

// Ordine canonico dei blocchi politici: continuum destra → sinistra,
// poi populista / regionalista / altro come categorie "fuori asse".
// Questa è la sequenza che il legend, le tabelle e i timeline devono
// rispettare; l'ordine di inserimento delle chiavi qui è la fonte di
// verità (Object.keys preserva l'insertion order). BLOCK_ORDER è
// derivato per i siti che non possono dipendere dall'iteration order
// dell'oggetto (es. score comparators).
export const BLOCK_COLORS = {
  'destra': '#0f172a',
  'centro-destra': '#1d4ed8',
  'liberale': '#8b5cf6',
  'centro': '#64748b',
  'centro-sinistra': '#ef5350',
  'sinistra': '#c62828',
  'populista': '#f59e0b',
  'regionalista': '#2e7d32',
  'altro': '#475569'
};

// Runtime party taxonomy: re-applies PARTY_FALLBACKS (this file) against
// a party_raw label. Used both to color rows in the UI and — critically —
// to RE-INFER `bloc` / `party_family` at load time for the results-long
// rows, overriding whatever the Python preprocessor wrote into the CSV.
//
// Why this override exists: `scripts/preprocess.py` ships with a much
// shorter PARTY_FALLBACKS list (~11 entries) than this file (~80+),
// so the CSV ends up with hundreds of historically significant parties
// stamped `bloc=altro` (L'Ulivo, AN, UDC, RC, IdV, Pensionati, Verdi
// pre-AVS, Rosa nel Pugno, Comunisti Italiani, …). That breaks every
// bloc-aware aggregation downstream. Until the CSV is regenerated
// from a single source of truth (see follow-up), the JS list is the
// authoritative taxonomy at runtime.
//
// Contract:
//   - Pure function of the input string. Always returns the same 4 keys.
//   - On no match: returns the generic `altro` family/bloc but echoes
//     the raw label as `display` so the UI never renders an empty cell.
//   - Callers that want to know whether a match occurred should compare
//     the returned `family` to the literal string `'altro'`, OR call
//     `inferredPartyMetaOrNull(label)` if they want a falsy on miss.
export function inferPartyMeta(label) {
  const raw = String(label || '').trim();
  const match = PARTY_FALLBACKS.find(([re]) => re.test(raw));
  const meta = match ? match[1] : { family: 'altro', bloc: 'altro', color: '#64748b', display: raw || 'N/D' };
  return {
    display: meta.display || raw || 'N/D',
    family: meta.family || 'altro',
    bloc: meta.bloc || 'altro',
    color: meta.color || '#64748b'
  };
}

// Same as inferPartyMeta but returns null when no PARTY_FALLBACKS regex
// matches. Callers that want to keep the CSV's existing value when the
// JS list has no opinion should prefer this.
export function inferredPartyMetaOrNull(label) {
  const raw = String(label || '').trim();
  const match = PARTY_FALLBACKS.find(([re]) => re.test(raw));
  return match ? match[1] : null;
}

export function partyTaxonomyKey(electionKey, partyRaw) {
  return `${String(electionKey || '').trim()}__${String(partyRaw || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('it')}`;
}

export function buildPartyTaxonomyLookup(rows = []) {
  const lookup = new Map();
  rows.forEach(row => {
    const key = partyTaxonomyKey(row?.election_key, row?.party_raw);
    if (!row?.election_key || !row?.party_raw || lookup.has(key)) return;
    lookup.set(key, {
      display: row.party_display_name || row.party_std || row.party_raw,
      party_std: row.party_std || row.party_raw,
      family: row.party_family || 'altro',
      bloc: row.bloc || 'altro',
      color: row.color || '#64748b',
      classification_status: row.classification_status || 'curated_exact',
      notes: row.notes || ''
    });
  });
  return lookup;
}

export function resolvePartyMeta(lookup, electionKey, partyRaw) {
  if (!lookup?.get || !electionKey || !partyRaw) return null;
  return lookup.get(partyTaxonomyKey(electionKey, partyRaw)) || null;
}

// Resolve the historical pre-vote electoral coalition for a (election,
// party_raw) pair. Reads the per-election lookup that `data.js` builds
// from `data/derived/electoral_coalitions.json` at load time. Returns
// the coalition record or `null` if:
//   - the catalog is absent (file missing — graceful no-op);
//   - the election predates 1994 (no formal pre-vote coalitions);
//   - the party_raw label is not in the curated coalition for that year
//     (e.g. minor / regional lists that ran alone).
//
// The catalog uses the canonical party_raw strings from the master CSV
// to avoid regex-soup; matching is done lowercase to absorb the small
// number of casing inconsistencies that survive the preprocessor.
export function coalitionForParty(state, electionKey, partyRaw) {
  if (!state || !electionKey || !partyRaw) return null;
  const lookup = state.coalitionLookupByElection;
  if (!lookup || typeof lookup.get !== 'function') return null;
  const partyMap = lookup.get(electionKey);
  if (!partyMap) return null;
  return partyMap.get(String(partyRaw).trim().toLowerCase()) || null;
}

// True when the active election has at least one declared electoral
// coalition. Used by UI surfaces that want to hide / disable the
// "coalition" view for pre-1994 elections, where coalitions did not
// exist as a pre-vote construct in Italy.
export function hasCoalitionData(state, electionKey) {
  if (!state || !electionKey) return false;
  const partyMap = state.coalitionLookupByElection?.get?.(electionKey);
  return !!(partyMap && partyMap.size);
}

export const BLOCK_ORDER = Object.keys(BLOCK_COLORS);

const BLOCK_RANK = new Map(BLOCK_ORDER.map((b, i) => [b, i]));

// Ordinatore stabile per chiavi di blocco. Sconosciuti finiscono in
// coda (rank = BLOCK_ORDER.length), poi `altro` per ultimo.
export function compareBlocks(a, b) {
  const ra = BLOCK_RANK.has(a) ? BLOCK_RANK.get(a) : BLOCK_ORDER.length;
  const rb = BLOCK_RANK.has(b) ? BLOCK_RANK.get(b) : BLOCK_ORDER.length;
  if (ra !== rb) return ra - rb;
  return String(a || '').localeCompare(String(b || ''), 'it');
}


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
  'agrario': '#6b7f2a',
  'altro': '#64748b'
};

// Macro-aree d'Italia + alcune regioni di interesse storico/elettorale.
// `regions` indica le regioni amministrative ISTAT da includere; il match
// avviene contro la colonna `region` del comune (resa case-insensitive e
// normalizzata da normalizeTextToken). `tokens` resta supportato come
// fallback per match contro il nome della provincia (utile per cluster
// trasversali tipo "Triangolo industriale").
export const AREA_PRESETS = [
  { value: 'all', label: 'Tutta Italia', regions: [], tokens: [] },
  { value: 'nord_ovest', label: 'Nord-Ovest', regions: ['Piemonte', "Valle d'Aosta", 'Liguria', 'Lombardia'] },
  { value: 'nord_est', label: 'Nord-Est', regions: ['Veneto', 'Trentino-Alto Adige', 'Friuli Venezia Giulia', 'Friuli-Venezia Giulia', 'Emilia-Romagna'] },
  { value: 'centro', label: 'Centro', regions: ['Toscana', 'Umbria', 'Marche', 'Lazio'] },
  { value: 'sud', label: 'Sud', regions: ['Abruzzo', 'Molise', 'Campania', 'Puglia', 'Basilicata', 'Calabria'] },
  { value: 'isole', label: 'Isole', regions: ['Sicilia', 'Sardegna'] },
  { value: 'lombardia', label: 'Lombardia', regions: ['Lombardia'] },
  { value: 'piemonte', label: 'Piemonte', regions: ['Piemonte'] },
  { value: 'veneto', label: 'Veneto', regions: ['Veneto'] },
  { value: 'emilia_romagna', label: 'Emilia-Romagna', regions: ['Emilia-Romagna'] },
  { value: 'lazio', label: 'Lazio', regions: ['Lazio'] },
  { value: 'campania', label: 'Campania', regions: ['Campania'] },
  { value: 'sicilia', label: 'Sicilia', regions: ['Sicilia'] },
  { value: 'custom', label: 'Selezione manuale', regions: null, tokens: null }
];

export const FALLBACK_PARTY_OPTIONS = [
  'DC', 'PCI', 'PSI', 'MSI', 'Forza Italia', 'PD', 'Lega', 'FdI', 'M5S', 'AVS / Verdi'
];
