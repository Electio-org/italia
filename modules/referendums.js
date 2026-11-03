import { fetchJsonFile } from './data.js';

export const REFERENDUM_METRICS = {
  yes_share: { label: 'Percentuale S\u00ec', unit: '%', domain: [0, 100] },
  turnout: { label: 'Affluenza', unit: '%', domain: [0, 100] },
  balance: { label: 'Vantaggio S\u00ec / No', unit: 'pt', domain: [-100, 100] }
};

const finite = value => typeof value === 'number' && Number.isFinite(value);
const countFields = ['electors', 'voters', 'yes_votes', 'no_votes', 'blank_votes', 'other_invalid_votes'];

export function referendumMetric(row, metric) {
  if (!row) return null;
  if (metric === 'turnout') return finite(row.turnout_pct) ? row.turnout_pct : null;
  if (metric === 'yes_share') return finite(row.yes_share) ? row.yes_share : null;
  if (metric === 'balance') return finite(row.balance) ? row.balance : null;
  return null;
}

export function aggregateReferendumRows(rows) {
  const result = Object.fromEntries(countFields.map(field => [field,
    rows.length && rows.every(row => finite(row[field])) ? rows.reduce((sum, row) => sum + row[field], 0) : null
  ]));
  const valid = finite(result.yes_votes) && finite(result.no_votes) ? result.yes_votes + result.no_votes : null;
  return {
    ...result, valid_votes: valid,
    yes_share: valid > 0 ? result.yes_votes / valid * 100 : null,
    no_share: valid > 0 ? result.no_votes / valid * 100 : null,
    balance: valid > 0 ? (result.yes_votes - result.no_votes) / valid * 100 : null,
    turnout_pct: result.electors > 0 && finite(result.voters) ? result.voters / result.electors * 100 : null
  };
}

export function validateReferendumBundle(bundle) {
  if (bundle?.schema_version !== 1 || !bundle.consultation?.election_key || !Array.isArray(bundle.municipalities)) {
    throw new Error('Formato dei dati referendum non riconosciuto.');
  }
  const byId = new Map();
  for (const row of bundle.municipalities) {
    if (!/^\d{6}$/.test(row.municipality_id) || row.geometry_id !== row.municipality_id || byId.has(row.municipality_id)) {
      throw new Error('Identit\u00e0 comunali non valide nei dati referendum.');
    }
    for (const field of countFields) {
      if (row[field] !== null && (!Number.isSafeInteger(row[field]) || row[field] < 0)) {
        throw new Error(`Conteggio referendum non valido: ${field}`);
      }
    }
    const derived = aggregateReferendumRows([row]);
    for (const field of ['valid_votes', 'yes_share', 'no_share', 'balance', 'turnout_pct']) {
      if (derived[field] === null ? row[field] !== null : !finite(row[field]) || Math.abs(row[field] - derived[field]) > 0.000001) {
        throw new Error(`Percentuale referendum incoerente: ${field}`);
      }
    }
    if (finite(row.voters) && finite(row.valid_votes) && row.valid_votes > row.voters) {
      throw new Error('I voti validi superano i votanti.');
    }
    byId.set(row.municipality_id, row);
  }
  return { ...bundle, byId };
}

export function createReferendumLoader(json = fetchJsonFile) {
  const cache = new Map();
  return {
    catalog: () => json('data/derived/referendums/index.json'),
    load(entry) {
      if (!cache.has(entry.election_key)) {
        const promise = json(entry.path).then(validateReferendumBundle).catch(error => {
          cache.delete(entry.election_key);
          throw error;
        });
        cache.set(entry.election_key, promise);
      }
      return cache.get(entry.election_key);
    }
  };
}
