const normalize = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function createMunicipalitySearch(municipalities, aliases = []) {
  const exact = new Map();
  const entries = municipalities.map(row => {
    const name = row.name_current || row.municipality_name || row.name_historical || '';
    const province = row.province_current || row.province || '';
    return { id: row.municipality_id, label: province ? `${name} (${province})` : name, names: new Set() };
  }).filter(entry => entry.id && entry.label);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const addName = (id, name) => {
    const entry = byId.get(id);
    const key = normalize(name);
    if (!entry || !key) return;
    entry.names.add(key);
    if (!exact.has(key)) exact.set(key, new Set());
    exact.get(key).add(entry);
  };
  municipalities.forEach(row => {
    const entry = byId.get(row.municipality_id);
    if (!entry) return;
    [entry.label, row.municipality_id, row.name_current, row.name_historical,
      row.municipality_name, ...String(row.alias_names || '').split('|')]
      .forEach(name => addName(entry.id, name));
  });
  aliases.forEach(row => addName(row.municipality_id, row.alias));
  entries.sort((a, b) => a.label.localeCompare(b.label, 'it'));
  return {
    entries,
    find(query) {
      const key = normalize(query);
      if (!key) return [];
      if (exact.has(key)) return [...exact.get(key)];
      const starts = entries.filter(entry => [...entry.names].some(name => name.startsWith(key)));
      return starts.length ? starts : entries.filter(entry => [...entry.names].some(name => name.includes(key)));
    }
  };
}
