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

export const PARTY_FALLBACKS = [
  [/^dc$|democrazia cristiana/i, { family: 'centro cattolico', bloc: 'centro', color: '#2e7d32', display: 'DC' }],
  [/^pci$|partito comunista/i, { family: 'sinistra', bloc: 'sinistra', color: '#c62828', display: 'PCI' }],
  [/^psi$|socialista/i, { family: 'sinistra socialista', bloc: 'centro-sinistra', color: '#ec407a', display: 'PSI' }],
  [/^msi$|movimento sociale/i, { family: 'destra nazionale', bloc: 'destra', color: '#0d47a1', display: 'MSI' }],
  [/forza italia|^fi$/i, { family: 'liberal-conservatore', bloc: 'centro-destra', color: '#1976d2', display: 'Forza Italia' }],
  [/partito democratico|^pd$/i, { family: 'centro-sinistra', bloc: 'centro-sinistra', color: '#d32f2f', display: 'PD' }],
  [/lega|leganord|^ln$/i, { family: 'regionalista', bloc: 'centro-destra', color: '#2e7d32', display: 'Lega' }],
  [/fratelli d.?italia|^fdi$/i, { family: 'destra nazionale', bloc: 'destra', color: '#1e3a8a', display: 'FdI' }],
  [/movimento 5 stelle|^m5s$/i, { family: 'populista', bloc: 'populista', color: '#f59e0b', display: 'M5S' }],
  [/sinistra italiana|verdi|avs|alleanza verdi/i, { family: 'ecologista', bloc: 'sinistra', color: '#2f855a', display: 'AVS / Verdi' }],
  [/radical/i, { family: 'radicale', bloc: 'liberale', color: '#8b5cf6', display: 'Radicali' }],
  [/azione|italia viva|renew/i, { family: 'liberale-riformista', bloc: 'centro', color: '#fb923c', display: 'Azione / IV' }],
  [/pri|repubblican/i, { family: 'laico-repubblicano', bloc: 'centro', color: '#10b981', display: 'PRI' }],
  [/pli|liberale/i, { family: 'liberale', bloc: 'centro-destra', color: '#0284c7', display: 'PLI' }],
  [/psdi|socialdemocratic/i, { family: 'socialdemocratico', bloc: 'centro-sinistra', color: '#f472b6', display: 'PSDI' }],
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
