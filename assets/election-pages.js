// Progressive enhancement only: every result and source is present in the HTML.
const partyRows = [...document.querySelectorAll('[data-party]')];
const search = document.querySelector('[data-party-search]');
const showAll = document.querySelector('[data-show-all]');
const status = document.querySelector('[data-party-status]');
let expanded = false;
const normalize = value => value.toLocaleLowerCase('it').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
function filterParties() {
  const query = normalize(search?.value || '');
  let visible = 0;
  partyRows.forEach((row, index) => {
    const matches = normalize(row.dataset.search).includes(query);
    row.hidden = !matches || (!query && !expanded && index >= 8);
    if (!row.hidden) visible += 1;
  });
  if (status) status.textContent = query
    ? `${visible} ${visible === 1 ? 'lista trovata' : 'liste trovate'}.`
    : `${visible} di ${partyRows.length} liste visualizzate. Quote calcolate su tutte le liste, anche quelle non visualizzate.`;
  if (showAll) {
    showAll.hidden = Boolean(query) || partyRows.length <= 8;
    showAll.textContent = expanded ? 'Mostra le prime 8' : 'Mostra tutte le liste';
    showAll.setAttribute('aria-pressed', String(expanded));
  }
}
search?.addEventListener('input', filterParties);
showAll?.addEventListener('click', () => { expanded = !expanded; filterParties(); });
const sort = document.querySelector('[data-region-sort]');
sort?.addEventListener('change', () => {
  const body = document.querySelector('[data-region-table]');
  const rows = [...body.querySelectorAll('[data-region]')];
  rows.sort((a, b) => sort.value === 'name'
    ? a.dataset.name.localeCompare(b.dataset.name, 'it')
    : Number(b.dataset[sort.value]) - Number(a.dataset[sort.value]) || a.dataset.name.localeCompare(b.dataset.name, 'it'));
  body.append(...rows);
});
document.querySelectorAll('[data-enhanced]').forEach(element => { element.hidden = false; });
filterParties();
