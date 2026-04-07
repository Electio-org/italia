const normalizeTextToken = value => String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

const NOTE_BENIGN_TOKENS = new Set([
  'turnout_from_clean',
  'counts_corrected_from_turnout',
  'party_rows_checked'
]);

export const trustStyle = status => status === 'strong' ? 'ok' : status === 'caution' ? 'partial' : 'missing';

export function parseNoteTokens(note) {
  return String(note || '')
    .split('|')
    .map(token => normalizeTextToken(token))
    .filter(Boolean);
}

export function hasMeaningfulComparabilityNote(note) {
  const tokens = parseNoteTokens(note);
  return tokens.some(token => !NOTE_BENIGN_TOKENS.has(token));
}

export function matchesCompletenessFlag(flag, selectedCompleteness = 'all') {
  const norm = normalizeTextToken(flag || 'unknown');
  if (selectedCompleteness === 'all') return true;
  if (selectedCompleteness === 'complete') return norm.includes('party_results_checked') || norm.includes('complete') || norm === 'ok';
  if (selectedCompleteness === 'non_partial') return !norm.includes('partial') && norm !== 'unknown';
  if (selectedCompleteness === 'partial') return norm.includes('partial');
  if (selectedCompleteness === 'unknown') return !norm || norm === 'unknown';
  return true;
}

export function assessRowTrustPure({ row, lineage = null, hasGeometry = false, metricNeedsCompare = false, compareElection = false, territorialMode = 'historical' }) {
  if (!row) return { score: 0, status: 'fragile', label: 'N/D', reasons: ['Nessun record disponibile per la selezione corrente.'] };
  let score = 100;
  const reasons = [];
  const completeness = normalizeTextToken(row.completeness_flag || row.data_completeness || '');
  const territorialStatus = normalizeTextToken(row.territorial_status || '');
  const noteTokens = parseNoteTokens(row.comparability_note);
  const noteHasMeaning = hasMeaningfulComparabilityNote(row.comparability_note);

  if (hasGeometry && !row.geometry_match) {
    score -= 22;
    reasons.push('join geometrico mancante nella vista corrente');
  }
  if (completeness.includes('partial')) {
    score -= 28;
    reasons.push('dato marcato come parziale');
  } else if (!completeness || completeness === 'unknown') {
    score -= 12;
    reasons.push('completezza non dichiarata');
  } else if (completeness.includes('turnout_only')) {
    score -= 12;
    reasons.push('turnout presente ma risultati di partito assenti');
  }
  if (noteTokens.includes('no_party_rows_detected')) {
    score -= 8;
  }
  if (noteHasMeaning) {
    score -= 12;
    reasons.push('nota di comparabilità presente');
  }
  if (/supp|fuso|merge|rename|stor|harmon|scorpor|derived/.test(territorialStatus)) {
    score -= 10;
    reasons.push('territorio con trasformazioni amministrative');
  }
  if (lineage && (lineage.event_type || lineage.parent_ids || lineage.child_ids)) {
    score -= 6;
    reasons.push('lineage territoriale da considerare');
  }
  if (metricNeedsCompare && !compareElection) {
    score -= 18;
    reasons.push('metrica comparativa senza elezione di confronto');
  }
  if (territorialMode === 'harmonized') {
    score -= 4;
    reasons.push('lettura armonizzata: utile ma meno “osservata” del dato storico puro');
  }
  score = Math.max(0, Math.min(100, score));
  const status = score >= 80 ? 'strong' : score >= 55 ? 'caution' : 'fragile';
  const label = status === 'strong' ? 'Alta' : status === 'caution' ? 'Media' : 'Fragile';
  return { score, status, label, reasons };
}

export function assessViewTrustPure({ rows = [], hasGeometry = false, metricNeedsCompare = false, compareElection = false, territorialMode = 'historical' }) {
  if (!rows.length) return { score: 0, status: 'fragile', label: 'N/D', reasons: ['Nessun comune disponibile con i filtri correnti.'] };
  let score = 100;
  const reasons = [];
  const geometryRows = hasGeometry ? rows.filter(r => r.geometry_match).length : 0;
  const geometryRatio = hasGeometry ? geometryRows / rows.length : null;
  const partialRows = rows.filter(r => normalizeTextToken(r.completeness_flag || r.data_completeness || '').includes('partial')).length;
  const turnoutOnlyRows = rows.filter(r => normalizeTextToken(r.completeness_flag || '').includes('turnout_only')).length;
  const unknownRows = rows.filter(r => ['unknown', ''].includes(normalizeTextToken(r.completeness_flag || r.data_completeness || ''))).length;

  if (hasGeometry) {
    if (geometryRatio < 0.5) {
      score -= 28;
      reasons.push('meno della metà dei comuni filtrati ha join geometrico valido');
    } else if (geometryRatio < 0.9) {
      score -= 14;
      reasons.push('copertura geometrica incompleta');
    }
  } else {
    score -= 18;
    reasons.push('geografie non caricate');
  }
  if (partialRows / rows.length > 0.25) {
    score -= 22;
    reasons.push('quota alta di comuni parziali');
  } else if (partialRows) {
    score -= 10;
    reasons.push('alcuni comuni sono parziali');
  }
  if (turnoutOnlyRows / rows.length > 0.3) {
    score -= 10;
    reasons.push('molti comuni hanno solo turnout e non risultati di partito');
  } else if (turnoutOnlyRows) {
    score -= 4;
    reasons.push('alcuni comuni hanno solo turnout');
  }
  if (unknownRows / rows.length > 0.3) {
    score -= 8;
    reasons.push('completezza spesso non dichiarata');
  }
  if (metricNeedsCompare && !compareElection) {
    score -= 20;
    reasons.push('manca l’elezione di confronto per la metrica selezionata');
  }
  if (territorialMode === 'harmonized') {
    score -= 4;
    reasons.push('stai leggendo una base armonizzata, non puro osservato storico');
  }
  score = Math.max(0, Math.min(100, score));
  const status = score >= 80 ? 'strong' : score >= 55 ? 'caution' : 'fragile';
  const label = status === 'strong' ? 'Alta' : status === 'caution' ? 'Media' : 'Fragile';
  return { score, status, label, reasons, geometryRatio, partialRows, turnoutOnlyRows, totalRows: rows.length };
}
