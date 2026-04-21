// Standalone script for municipality-detail.html.
// Reads ?id=<municipality_id> from the URL, fetches the slim derived CSVs
// already shipped with the bundle, and renders anagrafica + storico.
// Charts are intentionally deferred to a later commit — the goal of this
// skeleton is to get the dashboard → detail link working end-to-end.

const DERIVED = 'data/derived';

const els = {
  name: document.getElementById('detail-name'),
  standfirst: document.getElementById('detail-standfirst'),
  error: document.getElementById('detail-error'),
  anagrafica: document.getElementById('detail-anagrafica'),
  historyBody: document.getElementById('detail-history-body'),
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtInt(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('it-IT');
}

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: (params.get('id') || '').trim(),
    election: (params.get('election') || '').trim(),
  };
}

function showError(message) {
  if (!els.error) return;
  els.error.textContent = message;
  els.error.classList.remove('hidden');
}

async function fetchCsv(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fetch ${path} → ${res.status}`);
  const text = await res.text();
  return new Promise((resolve, reject) => {
    if (typeof window.Papa === 'undefined') {
      reject(new Error('PapaParse non caricato'));
      return;
    }
    window.Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: result => resolve(result.data || []),
      error: err => reject(err),
    });
  });
}

function renderAnagrafica(record) {
  if (!els.anagrafica) return;
  if (!record) {
    els.anagrafica.innerHTML = '<div class="detail-placeholder detail-placeholder-muted">Nessuna anagrafica disponibile per questo comune.</div>';
    return;
  }
  const fields = [
    ['ID comune', record.municipality_id],
    ['Nome corrente', record.name_current || record.municipality_name],
    ['Provincia', record.province_current || record.province],
    ['Regione', record.region_current || record.region],
    ['ID geometrico corrente', record.geometry_id_current || record.geometry_id],
    ['Popolazione (ultima)', fmtInt(record.population_latest)],
    ['Stato territoriale', record.territorial_status || 'attivo'],
  ];
  els.anagrafica.innerHTML = fields
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([label, value]) => `
      <div class="detail-kv">
        <span class="detail-kv-label">${escapeHtml(label)}</span>
        <span class="detail-kv-value">${escapeHtml(value)}</span>
      </div>
    `)
    .join('');
}

function renderHistory(rows) {
  if (!els.historyBody) return;
  if (!rows.length) {
    els.historyBody.innerHTML = '<tr><td colspan="5" class="detail-placeholder detail-placeholder-muted">Nessun risultato summary disponibile per questo comune.</td></tr>';
    return;
  }
  const sorted = rows.slice().sort((a, b) => {
    const ya = Number(a.election_year || a.year || 0);
    const yb = Number(b.election_year || b.year || 0);
    return ya - yb;
  });
  els.historyBody.innerHTML = sorted.map(row => `
    <tr>
      <td>${escapeHtml(row.election_label || row.election_key || '—')}</td>
      <td>${escapeHtml(row.election_year || row.year || '—')}</td>
      <td>${fmtPct(row.turnout_pct)}</td>
      <td>${fmtInt(row.voti_validi || row.valid_votes)}</td>
      <td>${fmtInt(row.elettori || row.electors)}</td>
    </tr>
  `).join('');
}

async function main() {
  const { id } = getParams();
  if (!id) {
    showError('Parametro "id" mancante. Apri il dettaglio da un comune selezionato sulla dashboard.');
    if (els.name) els.name.textContent = 'Dettaglio comune';
    return;
  }

  try {
    const [municipalities, summary] = await Promise.all([
      fetchCsv(`${DERIVED}/municipalities_master.csv`),
      fetchCsv(`${DERIVED}/municipality_summary.csv`).catch(() => []),
    ]);

    const record = municipalities.find(row => (row.municipality_id || '').trim() === id) || null;
    const rows = summary.filter(row => (row.municipality_id || '').trim() === id);

    const displayName = record?.name_current || record?.municipality_name || record?.name_historical || id;
    if (els.name) els.name.textContent = displayName;
    if (els.standfirst) {
      const province = record?.province_current || record?.province || '';
      const region = record?.region_current || record?.region || '';
      const bits = [province, region].filter(Boolean).join(' · ');
      els.standfirst.textContent = bits
        ? `${bits} — scheda del comune: anagrafica, storico elezioni, grafici in arrivo.`
        : 'Scheda del comune: anagrafica, storico elezioni, grafici in arrivo.';
    }
    document.title = `Electio Italia | ${displayName}`;

    renderAnagrafica(record);
    renderHistory(rows);
  } catch (err) {
    console.error(err);
    showError('Errore nel caricamento dei dati del comune. Riprova aggiornando la pagina.');
  }
}

main();
