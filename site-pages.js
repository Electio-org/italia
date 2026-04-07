const q = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('it-IT').format(numeric);
}

function formatBytes(bytes) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = numeric;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

function isAbsoluteLikePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(String(value || '')) || /^\/(?!\/)/.test(String(value || '')) || /^https?:\/\//i.test(String(value || ''));
}

function preferredDownloadHref(bundle, datasetKey, meta = {}) {
  const declared = meta.path || '';
  const manifestPath = bundle.manifest?.files?.[datasetKey] || '';
  if (declared && !isAbsoluteLikePath(declared)) return declared;
  if (manifestPath) return manifestPath;
  return declared;
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function severityTone(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'warn') return 'warn';
  if (value === 'error') return 'error';
  return 'info';
}

function metaCount(meta) {
  if (!meta) return 'n.d.';
  if (Number.isFinite(Number(meta.row_count))) return `${formatNumber(meta.row_count)} righe`;
  if (Number.isFinite(Number(meta.feature_count))) return `${formatNumber(meta.feature_count)} feature`;
  const keys = Array.isArray(meta.top_level_keys) ? meta.top_level_keys.length : null;
  if (Number.isFinite(keys)) return `${formatNumber(keys)} chiavi`;
  return 'n.d.';
}

function statCard(label, value, meta) {
  return `
    <article class="stat-card">
      <span class="stat-card-label">${escapeHtml(label)}</span>
      <strong class="stat-card-value">${escapeHtml(value)}</strong>
      <span class="stat-card-meta">${escapeHtml(meta || '')}</span>
    </article>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Impossibile caricare ${path}`);
  }
  return response.json();
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Impossibile caricare ${path}`);
  }
  return response.text();
}

async function loadBundle() {
  const manifest = await fetchJson('data/derived/manifest.json');
  const files = manifest.files || {};
  const payload = { manifest };
  const jsonTargets = {
    releaseManifest: 'releaseManifest',
    dataProducts: 'dataProducts',
    productCatalog: 'productCatalog',
    datasetRegistry: 'datasetRegistry',
    usageNotes: 'usageNotes',
    codebook: 'codebook',
    datasetContracts: 'datasetContracts',
    provenance: 'provenance',
    researchRecipes: 'researchRecipes',
    siteGuides: 'siteGuides',
    updateLog: 'updateLog',
    dataQualityReport: 'dataQualityReport',
    archiveBundleGapReport: 'archiveBundleGapReport',
  };

  await Promise.all(
    Object.entries(jsonTargets).map(async ([targetKey, manifestKey]) => {
      const rel = files[manifestKey];
      if (!rel) return;
      try {
        payload[targetKey] = await fetchJson(rel);
      } catch (error) {
        console.error(error);
      }
    })
  );

  try {
    payload.citation = await fetchText('CITATION.cff');
  } catch (error) {
    console.error(error);
    payload.citation = `Lombardia Camera Explorer ${manifest.version || ''}`.trim();
  }
  return payload;
}

function activateNav() {
  const page = document.body.dataset.sitePage;
  const nav = document.querySelector('.site-nav');
  if (!nav || !page) return;
  const pageToHref = {
    dashboard: 'index.html',
    products: 'products.html',
    'data-download': 'data-download.html',
    'programmatic-access': 'programmatic-access.html',
    'usage-notes': 'usage-notes.html',
    'update-log': 'update-log.html',
  };
  const activeHref = pageToHref[page];
  nav.querySelectorAll('a').forEach((link) => {
    const active = link.getAttribute('href') === activeHref;
    link.classList.toggle('is-active', active);
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function wireCopyButtons() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy-target]');
    if (!button) return;
    const target = q(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent || '');
      const original = button.textContent;
      button.textContent = 'Copiato';
      window.setTimeout(() => {
        button.textContent = original;
      }, 1400);
    } catch (error) {
      console.error(error);
    }
  });
}

function renderDownloadPage(bundle) {
  const registryDatasets = bundle.datasetRegistry?.datasets || [];
  const releaseEntries = bundle.releaseManifest?.file_entries || {};
  const products = bundle.productCatalog?.products || bundle.dataProducts?.products || [];
  const recipes = bundle.researchRecipes?.recipes || [];
  const notes = bundle.usageNotes?.notes || [];
  const quality = bundle.dataQualityReport?.derived_validations || {};
  const archiveGap = bundle.archiveBundleGapReport?.rows || [];
  const archiveGapSummary = bundle.archiveBundleGapReport?.summary || {};
  const archiveGapByKey = new Map(archiveGap.map((row) => [row.consultation_key || row.election_key, row]));
  const usableElectionRows = registryDatasets.filter((row) => row.election_key);
  const geometryRows = registryDatasets.filter((row) => row.dataset_family === 'geometry_boundary');
  const yearsWithCoverage = usableElectionRows.filter((row) => row.status === 'usable').length;

  const stats = [
    ['Release', bundle.manifest.version || 'n.d.', 'Versione dichiarata nel bundle'],
    ['Readiness tecnica', quality.technical_readiness_score ?? quality.readiness_score ?? 'n.d.', 'Controlli tecnici del bundle'],
    ['Copertura sostanziale', quality.substantive_coverage_score ?? bundle.datasetRegistry?.summary?.substantive_readiness ?? 'n.d.', 'Quanto dato utile c e davvero oggi'],
    ['Prodotti dati', products.length, 'Famiglie pubblicate in questa release'],
    ['Elezioni con copertura', yearsWithCoverage, 'Anni almeno utilizzabili nel bundle attuale'],
    ['Basi geometriche', geometryRows.length, 'Boundary pack disponibili'],
    ['Gap forti vs archivio', archiveGapSummary.bundle_severely_partial_vs_archive ?? archiveGapSummary.bundle_below_archive_positive_tables ?? 'n.d.', 'Elezioni dove il bundle resta molto sotto il canonico'],
    ['Vuote ma non vuote nel canonico', archiveGapSummary.bundle_empty_archive_nonempty ?? 'n.d.', 'Elezioni oggi vuote nel bundle ma non nel piu ampio archivio Lombardia'],
  ];
  const statGrid = q('page-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = stats.map(([label, value, meta]) => statCard(label, value, meta)).join('');
  }

  const productGrid = q('product-card-grid');
  if (productGrid) {
    productGrid.innerHTML = products
      .map((product) => {
        const primaryPath = bundle.manifest.files?.[product.primary_dataset_key] || '';
        const companionPath = bundle.manifest.files?.[product.companion_dataset_key] || '';
        return `
          <article class="doc-card">
            <div class="doc-card-head">
              <span class="doc-pill">${escapeHtml(product.kind || 'product')}</span>
              <strong>${escapeHtml(product.title || product.product_key)}</strong>
            </div>
            <p>${escapeHtml((product.intended_use || []).join(' · ') || 'Uso non dichiarato')}</p>
            <div class="doc-meta-list">
              <span><strong>Granularita</strong> ${escapeHtml(product.granularity || 'n.d.')}</span>
              <span><strong>Modo</strong> ${escapeHtml(product.territorial_mode || 'n.d.')}</span>
              <span><strong>Manifest</strong> ${product.manifest_path ? `<a href="${escapeHtml(product.manifest_path)}" download>manifest.json</a>` : 'n.d.'}</span>
              <span><strong>Primario</strong> ${primaryPath ? `<a href="${escapeHtml(primaryPath)}" download>${escapeHtml(product.primary_dataset_key)}</a>` : 'n.d.'}</span>
              <span><strong>Companion</strong> ${companionPath ? `<a href="${escapeHtml(companionPath)}" download>${escapeHtml(product.companion_dataset_key)}</a>` : 'n.d.'}</span>
              <span><strong>Dataset</strong> ${escapeHtml(String(product.dataset_count ?? 'n.d.'))}</span>
              <span><strong>Inventory</strong> ${escapeHtml(String(product.inventory_count ?? 'n.d.'))}</span>
            </div>
            <ul class="doc-list">
              ${(product.inventory_preview || []).map((item) => `<li><code>${escapeHtml(String(item))}</code></li>`).join('')}
              ${(product.guardrails || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
            <div class="doc-card-actions">
              <a class="doc-download-link" href="products.html?product=${encodeURIComponent(product.product_key || '')}">Apri prodotto</a>
            </div>
          </article>
        `;
      })
      .join('');
  }

  const coverageBody = q('coverage-table-body');
  if (coverageBody) {
    coverageBody.innerHTML = usableElectionRows
      .sort((a, b) => Number(a.election_year || 0) - Number(b.election_year || 0))
      .map((row) => {
        const gap = archiveGapByKey.get(row.election_key);
        const archiveHint = gap
          ? `Archivio: ${formatNumber(gap.archive_positive_table_rows || gap.archive_municipality_like_rows || 0)}`
          : '';
        return `
        <tr>
          <td>${escapeHtml(row.election_year || '')}</td>
          <td>${escapeHtml(row.election_key || '')}</td>
          <td><span class="doc-pill tone-${row.status === 'usable' ? 'good' : 'muted'}">${escapeHtml(row.coverage_label || row.status || 'n.d.')}</span></td>
          <td>${escapeHtml(row.territorial_mode || 'n.d.')}</td>
          <td>${escapeHtml(row.boundary_basis || 'auto')}</td>
          <td>${formatNumber(row.summary_rows || 0)}${archiveHint ? `<div class="table-muted">${escapeHtml(archiveHint)}</div>` : ''}</td>
          <td>${formatNumber(row.result_rows || 0)}</td>
        </tr>
      `;
      })
      .join('');
  }

  const filesBody = q('declared-files-table-body');
  if (filesBody) {
    filesBody.innerHTML = Object.entries(releaseEntries)
      .map(([datasetKey, meta]) => {
        const rel = preferredDownloadHref(bundle, datasetKey, meta);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(datasetKey)}</strong>
              <div class="table-muted">${escapeHtml(rel || meta.path || '')}</div>
            </td>
            <td>${escapeHtml(meta.kind || 'n.d.')}</td>
            <td>${formatBytes(meta.size_bytes || 0)}</td>
            <td>${escapeHtml(metaCount(meta))}</td>
            <td><a class="doc-download-link" href="${escapeHtml(rel)}" download>Scarica</a></td>
          </tr>
        `;
      })
      .join('');
  }

  const notesGrid = q('download-notes-grid');
  if (notesGrid) {
    notesGrid.innerHTML = notes
      .map((note) => `
        <article class="doc-card tone-${severityTone(note.severity)}">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(note.severity || 'info')}</span>
            <strong>${escapeHtml(note.title || note.key)}</strong>
          </div>
          <p>${escapeHtml(note.text || '')}</p>
        </article>
      `)
      .join('');
  }

  const recipesGrid = q('download-recipes-grid');
  if (recipesGrid) {
    recipesGrid.innerHTML = recipes
      .map((recipe) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml((recipe.audiences || []).join(' / ') || 'audience')}</span>
            <strong>${escapeHtml(recipe.title || recipe.recipe_key)}</strong>
          </div>
          <p>${escapeHtml(recipe.goal || '')}</p>
          <ul class="doc-list">
            ${(recipe.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
          </ul>
        </article>
      `)
      .join('');
  }

  const archiveGapBody = q('archive-gap-table-body');
  if (archiveGapBody) {
    archiveGapBody.innerHTML = archiveGap
      .sort((a, b) => Number(a.election_year || 0) - Number(b.election_year || 0))
      .map((row) => {
        const flags = row.flags || [];
        const ratio = Number(row.summary_vs_archive_positive_ratio);
        const ratioText = Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : 'n.d.';
        const archiveScope = row.archive_positive_table_rows || row.archive_municipality_like_rows || 0;
        return `
          <tr>
            <td>${escapeHtml(row.election_year || '')}</td>
            <td>${escapeHtml(row.consultation_key || '')}</td>
            <td>${formatNumber(row.bundle_summary_rows || 0)}</td>
            <td>${formatNumber(archiveScope)}</td>
            <td>${escapeHtml(ratioText)}</td>
            <td>${flags.length ? flags.map((flag) => `<span class="doc-pill tone-warn">${escapeHtml(flag)}</span>`).join(' ') : '<span class="doc-pill tone-good">in linea</span>'}</td>
          </tr>
        `;
      })
      .join('');
  }
}

function renderProgrammaticPage(bundle) {
  const releaseEntries = bundle.releaseManifest?.file_entries || {};
  const clients = bundle.dataProducts?.clients || [];
  const recipes = bundle.researchRecipes?.recipes || [];
  const products = bundle.productCatalog?.products || bundle.dataProducts?.products || [];
  const pythonClient = clients.find((client) => String(client.language).toLowerCase() === 'python');
  const rClient = clients.find((client) => String(client.language).toLowerCase() === 'r');
  const cliSnippet = [
    'python clients/python/lce_loader.py --root . --summary',
    'python clients/python/lce_loader.py --root . --products',
    'python clients/python/lce_loader.py --root . --product-catalog',
    'python clients/python/lce_loader.py --root . --product-manifest camera_muni_historical',
    'python clients/python/lce_loader.py --root . --product-inventory camera_muni_historical',
    'python clients/python/lce_loader.py --root . --product-dataset camera_muni_historical:primary --head 8',
    'python clients/python/lce_loader.py --root . --verify',
    'python clients/python/lce_loader.py --root . --dataset municipalitySummary --head 8',
  ].join('\n');

  const stats = [
    ['Loader ufficiali', clients.length, 'Client dichiarati nel sistema prodotti'],
    ['File dichiarati', Object.keys(releaseEntries).length, 'Scope della release corrente'],
    ['Prodotti dati', products.length, 'Catalogo prodotti disponibile'],
    ['Recipes', recipes.length, 'Percorsi machine-readable'],
  ];
  const statGrid = q('programmatic-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = stats.map(([label, value, meta]) => statCard(label, value, meta)).join('');
  }

  const clientGrid = q('client-card-grid');
  if (clientGrid) {
    clientGrid.innerHTML = clients
      .map((client) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(client.language || 'client')}</span>
            <strong>${escapeHtml(client.client_key || 'client')}</strong>
          </div>
          <p>Entrypoint: <code>${escapeHtml(client.entrypoint || 'n.d.')}</code></p>
          <pre class="doc-code" id="client-${slugify(client.client_key)}">${escapeHtml(String(client.example || '').replace(/\\n/g, '\n'))}</pre>
          <button type="button" class="ghost-btn small-btn copy-btn" data-copy-target="client-${slugify(client.client_key)}">Copia snippet</button>
        </article>
      `)
      .join('');
  }

  if (q('python-snippet')) {
    q('python-snippet').textContent = String(pythonClient?.example || '').replace(/\\n/g, '\n');
  }
  if (q('r-snippet')) {
    q('r-snippet').textContent = String(rClient?.example || '').replace(/\\n/g, '\n');
  }
  if (q('cli-snippet')) {
    q('cli-snippet').textContent = cliSnippet;
  }
  if (q('citation-block')) {
    q('citation-block').textContent = bundle.citation || '';
  }

  const productManifestBody = q('product-manifest-table-body');
  if (productManifestBody) {
    productManifestBody.innerHTML = products
      .map((product) => `
        <tr>
          <td>
            <strong>${escapeHtml(product.title || product.product_key)}</strong>
            <div class="table-muted">${escapeHtml(product.product_key || '')}</div>
          </td>
          <td>${product.manifest_path ? `<a class="doc-download-link" href="${escapeHtml(product.manifest_path)}" download>manifest.json</a>` : 'n.d.'}</td>
          <td>${escapeHtml(product.inventory_kind || 'n.d.')}</td>
          <td>${escapeHtml(String(product.inventory_count ?? 'n.d.'))}</td>
          <td>${escapeHtml(product.delivery_strategy || 'declared in manifest')}</td>
        </tr>
      `)
      .join('');
  }

  const recipeBody = q('recipe-table-body');
  if (recipeBody) {
    recipeBody.innerHTML = recipes
      .map((recipe) => `
        <tr>
          <td>${escapeHtml(recipe.title || recipe.recipe_key)}</td>
          <td>${escapeHtml((recipe.audiences || []).join(', ') || 'n.d.')}</td>
          <td>${escapeHtml(recipe.goal || '')}</td>
          <td>${escapeHtml(recipe.jump_target || '')}</td>
        </tr>
      `)
      .join('');
  }

  const contractGrid = q('bundle-contract-grid');
  if (contractGrid) {
    contractGrid.innerHTML = [
      {
        title: 'Manifest e release',
        body: `Versione ${bundle.manifest.version || 'n.d.'} con ${Object.keys(releaseEntries).length} file dichiarati e integrita ${bundle.releaseManifest?.integrity?.all_declared_files_present ? 'ok' : 'da verificare'}.`,
      },
      {
        title: 'Prodotti dati',
        body: `${products.length} famiglie dichiarate, con manifest e inventory dedicati oltre ai guardrail.`,
      },
      {
        title: 'Recipes e guide',
        body: `${recipes.length} recipe e ${bundle.siteGuides?.layers?.length || 0} guide editoriali sopra lo stesso bundle.`,
      },
      {
        title: 'Citazione',
        body: 'Il progetto espone anche una CITATION.cff leggibile dal sito e dal loader.',
      },
    ]
      .map((item) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <strong>${escapeHtml(item.title)}</strong>
          </div>
          <p>${escapeHtml(item.body)}</p>
        </article>
      `)
      .join('');
  }
}

function renderInventoryMarkup(manifest) {
  const inventory = manifest?.inventory || {};
  const entries = inventory.entries || [];
  if (!entries.length) {
    return '<div class="empty-state">Inventory non disponibile per questo prodotto.</div>';
  }
  if (inventory.kind === 'election_datasets') {
    return `
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>Anno</th>
              <th>Election key</th>
              <th>Status</th>
              <th>Summary</th>
              <th>Results</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => `
              <tr>
                <td>${escapeHtml(entry.election_year || '')}</td>
                <td>${escapeHtml(entry.election_key || entry.dataset_key || '')}</td>
                <td><span class="doc-pill">${escapeHtml(entry.coverage_label || entry.status || 'n.d.')}</span></td>
                <td>${entry.download_summary ? `<a class="doc-download-link" href="${escapeHtml(entry.download_summary)}" download>${formatNumber(entry.summary_rows || 0)}</a>` : formatNumber(entry.summary_rows || 0)}</td>
                <td>${entry.download_results ? `<a class="doc-download-link" href="${escapeHtml(entry.download_results)}" download>${formatNumber(entry.result_rows || 0)}</a>` : formatNumber(entry.result_rows || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  if (inventory.kind === 'boundary_years') {
    return `
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>Anno base</th>
              <th>Confini comunali</th>
              <th>Confini provinciali</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => `
              <tr>
                <td>${escapeHtml(entry.geometry_year || '')}</td>
                <td>${entry.municipalities_path ? `<a class="doc-download-link" href="${escapeHtml(entry.municipalities_path)}" download>Municipalities</a>` : 'n.d.'}</td>
                <td>${entry.provinces_path ? `<a class="doc-download-link" href="${escapeHtml(entry.provinces_path)}" download>Provinces</a>` : 'n.d.'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  if (inventory.kind === 'metadata_objects') {
    return `
      <div class="doc-table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Tipo</th>
              <th>Dimensione</th>
              <th>Conteggio</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => `
              <tr>
                <td>${entry.path ? `<a class="doc-download-link" href="${escapeHtml(entry.path)}" download>${escapeHtml(entry.dataset_key || '')}</a>` : escapeHtml(entry.dataset_key || '')}</td>
                <td>${escapeHtml(entry.kind || 'n.d.')}</td>
                <td>${formatBytes(entry.size_bytes || 0)}</td>
                <td>${escapeHtml(metaCount(entry))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  return `
    <ul class="doc-list">
      ${entries.map((entry) => `<li><code>${escapeHtml(JSON.stringify(entry))}</code></li>`).join('')}
    </ul>
  `;
}

async function renderProductsPage(bundle) {
  const products = bundle.productCatalog?.products || [];
  const manifests = await Promise.all(products.map(async (product) => {
    if (!product.manifest_path) return [product.product_key, null];
    try {
      return [product.product_key, await fetchJson(product.manifest_path)];
    } catch (error) {
      console.error(error);
      return [product.product_key, null];
    }
  }));
  const manifestMap = new Map(manifests);
  const selectedProduct = new URLSearchParams(window.location.search).get('product');
  const stats = [
    ['Prodotti', products.length, 'Famiglie pubblicate nella release'],
    ['Inventory entries', products.reduce((sum, product) => sum + Number(product.inventory_count || 0), 0), 'Contenuti dichiarati dentro i prodotti'],
    ['Manifest di prodotto', manifests.filter(([, manifest]) => Boolean(manifest)).length, 'Manifest dedicati disponibili'],
    ['Client ufficiali', (bundle.dataProducts?.clients || []).length, 'Loader dichiarati e riusabili'],
  ];
  const statGrid = q('products-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = stats.map(([label, value, meta]) => statCard(label, value, meta)).join('');
  }

  const productGrid = q('products-overview-grid');
  if (productGrid) {
    productGrid.innerHTML = products.map((product) => `
      <article class="doc-card">
        <div class="doc-card-head">
          <span class="doc-pill">${escapeHtml(product.kind || 'product')}</span>
          <strong>${escapeHtml(product.title || product.product_key)}</strong>
        </div>
        <p>${escapeHtml((product.intended_use || []).join(' · ') || 'Uso non dichiarato')}</p>
        <div class="doc-meta-list">
          <span><strong>Manifest</strong> ${product.manifest_path ? `<a href="${escapeHtml(product.manifest_path)}" download>manifest.json</a>` : 'n.d.'}</span>
          <span><strong>Inventory</strong> ${escapeHtml(String(product.inventory_count ?? 'n.d.'))}</span>
          <span><strong>Delivery</strong> ${escapeHtml(product.delivery_strategy || 'declared')}</span>
        </div>
        <ul class="doc-list">
          ${(product.inventory_preview || []).map((item) => `<li><code>${escapeHtml(String(item))}</code></li>`).join('')}
        </ul>
        <div class="doc-card-actions">
          <a class="doc-download-link" href="#product-${slugify(product.product_key)}">Vai al dettaglio</a>
        </div>
      </article>
    `).join('');
  }

  const details = q('product-detail-list');
  if (details) {
    details.innerHTML = products.map((product) => {
      const manifest = manifestMap.get(product.product_key) || {};
      return `
        <article id="product-${slugify(product.product_key)}" class="doc-card doc-card-wide product-detail-card${selectedProduct === product.product_key ? ' is-focused' : ''}">
          <div class="doc-card-head">
            <div>
              <span class="doc-pill">${escapeHtml(product.kind || 'product')}</span>
              <strong>${escapeHtml(product.title || product.product_key)}</strong>
            </div>
            <a class="doc-download-link" href="${escapeHtml(product.manifest_path || '#')}" download>Scarica manifest</a>
          </div>
          <p>${escapeHtml((product.intended_use || []).join(' · ') || 'Uso non dichiarato')}</p>
          <div class="doc-split-grid">
            <article class="doc-card">
              <div class="doc-card-head"><strong>Product contract</strong></div>
              <ul class="doc-list">
                <li><strong>Delivery:</strong> ${escapeHtml(product.delivery_strategy || 'declared')}</li>
                <li><strong>Primary:</strong> ${escapeHtml(product.primary_dataset_key || 'n.d.')}</li>
                <li><strong>Companion:</strong> ${escapeHtml(product.companion_dataset_key || 'n.d.')}</li>
                <li><strong>Join keys:</strong> ${escapeHtml((product.join_keys || []).join(', ') || 'n.d.')}</li>
              </ul>
            </article>
            <article class="doc-card">
              <div class="doc-card-head"><strong>Guardrail</strong></div>
              <ul class="doc-list">
                ${(product.guardrails || []).length ? (product.guardrails || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>Nessun guardrail aggiuntivo dichiarato.</li>'}
              </ul>
            </article>
          </div>
          <div class="doc-card-head"><strong>Inventory</strong></div>
          ${renderInventoryMarkup(manifest)}
          <div class="doc-card-head"><strong>Dataset del prodotto</strong></div>
          <div class="doc-table-wrap">
            <table class="doc-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Dataset key</th>
                  <th>Path</th>
                  <th>Delivery</th>
                </tr>
              </thead>
              <tbody>
                ${((manifest.datasets || []).map((entry) => `
                  <tr>
                    <td>${escapeHtml(entry.role || '')}</td>
                    <td>${escapeHtml(entry.dataset_key || '')}</td>
                    <td>${entry.path ? `<a class="doc-download-link" href="${escapeHtml(entry.path)}" download>${escapeHtml(entry.path)}</a>` : 'n.d.'}</td>
                    <td>${escapeHtml(entry.delivery_strategy || 'direct')}</td>
                  </tr>
                `).join('')) || '<tr><td colspan="4">Dataset non dichiarati.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      `;
    }).join('');
  }

  if (selectedProduct) {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`product-${slugify(selectedProduct)}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function renderUsageNotesPage(bundle) {
  const notes = bundle.usageNotes?.notes || [];
  const explainers = bundle.siteGuides?.explainers || [];
  const faq = bundle.siteGuides?.faq || [];
  const codebookDatasets = bundle.codebook?.datasets || [];
  const contracts = bundle.datasetContracts?.contracts || [];
  const provenance = bundle.provenance?.entries || [];

  const stats = [
    ['Note', notes.length, 'Guardrail e limiti dichiarati'],
    ['Explainer', explainers.length, 'Guide di lettura pubbliche'],
    ['FAQ', faq.length, 'Domande anticipate per utenti non specialisti'],
    ['Dataset nel codebook', codebookDatasets.length, 'Schema esposto pubblicamente'],
  ];
  const statGrid = q('usage-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = stats.map(([label, value, meta]) => statCard(label, value, meta)).join('');
  }

  const noteGrid = q('usage-note-grid');
  if (noteGrid) {
    noteGrid.innerHTML = notes
      .map((note) => `
        <article class="doc-card tone-${severityTone(note.severity)}">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(note.severity || 'info')}</span>
            <strong>${escapeHtml(note.title || note.key)}</strong>
          </div>
          <p>${escapeHtml(note.text || '')}</p>
        </article>
      `)
      .join('');
  }

  const explainerGrid = q('explainer-grid');
  if (explainerGrid) {
    explainerGrid.innerHTML = explainers
      .map((item) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(item.accent || 'method')}</span>
            <strong>${escapeHtml(item.title || item.key)}</strong>
          </div>
          <p>${escapeHtml(item.body || '')}</p>
        </article>
      `)
      .join('');
  }

  const faqList = q('faq-list');
  if (faqList) {
    faqList.innerHTML = faq
      .map((item) => `
        <details class="doc-accordion-item">
          <summary>
            <span>${escapeHtml(item.question || '')}</span>
            <span class="doc-pill">${escapeHtml(item.tag || 'FAQ')}</span>
          </summary>
          <div class="doc-accordion-body">
            <p>${escapeHtml(item.answer || '')}</p>
          </div>
        </details>
      `)
      .join('');
  }

  const codebookList = q('codebook-list');
  if (codebookList) {
    codebookList.innerHTML = codebookDatasets
      .map((dataset) => `
        <details class="doc-accordion-item">
          <summary>
            <span>${escapeHtml(dataset.title || dataset.dataset)}</span>
            <span class="doc-pill">${formatNumber((dataset.columns || []).length)} colonne</span>
          </summary>
          <div class="doc-accordion-body">
            <div class="doc-table-wrap">
              <table class="doc-table">
                <thead>
                  <tr>
                    <th>Colonna</th>
                    <th>Descrizione</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  ${(dataset.columns || [])
                    .map((column) => `
                      <tr>
                        <td><code>${escapeHtml(column.name)}</code></td>
                        <td>${escapeHtml(column.description || '')}</td>
                        <td>${escapeHtml(column.type_hint || 'n.d.')}</td>
                      </tr>
                    `)
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      `)
      .join('');
  }

  const contractsList = q('contracts-list');
  if (contractsList) {
    contractsList.innerHTML = contracts
      .map((contract) => `
        <details class="doc-accordion-item">
          <summary>
            <span>${escapeHtml(contract.dataset || 'dataset')}</span>
            <span class="doc-pill">${formatNumber((contract.required_columns || []).length)} richieste</span>
          </summary>
          <div class="doc-accordion-body">
            <div class="doc-split-grid">
              <article class="doc-card">
                <div class="doc-card-head"><strong>Required columns</strong></div>
                <ul class="doc-list">
                  ${(contract.required_columns || []).map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}
                </ul>
              </article>
              <article class="doc-card">
                <div class="doc-card-head"><strong>Key columns</strong></div>
                <ul class="doc-list">
                  ${(contract.key_columns || []).map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}
                </ul>
                <div class="doc-card-head contract-rules-head"><strong>Validation rules</strong></div>
                <ul class="doc-list">
                  ${(contract.validation_rules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                </ul>
              </article>
            </div>
          </div>
        </details>
      `)
      .join('');
  }

  const provenanceList = q('provenance-list');
  if (provenanceList) {
    provenanceList.innerHTML = provenance
      .map((entry) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(entry.source_class || entry.kind || 'dataset')}</span>
            <strong>${escapeHtml(entry.dataset_key || 'dataset')}</strong>
          </div>
          <p><code>${escapeHtml(entry.path || '')}</code></p>
          <p>${escapeHtml(entry.produced_by || entry.method || '')}</p>
          <ul class="doc-list">
            ${((entry.transformation_steps || entry.limitations || []).slice(0, 3))
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join('')}
          </ul>
        </article>
      `)
      .join('');
  }
}

function renderUpdateLogPage(bundle) {
  const entries = bundle.updateLog?.entries || [];
  const releaseEntries = bundle.releaseManifest?.file_entries || {};
  const quality = bundle.dataQualityReport?.derived_validations || {};
  const groupedKinds = Object.values(releaseEntries).reduce((accumulator, item) => {
    const kind = item.kind || 'other';
    accumulator[kind] = (accumulator[kind] || 0) + 1;
    return accumulator;
  }, {});

  const stats = [
    ['Ultima release', bundle.manifest.version || 'n.d.', entries[0]?.date || 'Data non dichiarata'],
    ['Readiness tecnica', quality.technical_readiness_score ?? quality.readiness_score ?? 'n.d.', 'Verifica tecnica dichiarata'],
    ['Copertura sostanziale', quality.substantive_coverage_score ?? bundle.datasetRegistry?.summary?.substantive_readiness ?? 'n.d.', 'Coverage effettivo del bundle'],
    ['File dichiarati', Object.keys(releaseEntries).length, 'Scope della release corrente'],
  ];
  const statGrid = q('update-stat-grid');
  if (statGrid) {
    statGrid.innerHTML = stats.map(([label, value, meta]) => statCard(label, value, meta)).join('');
  }

  const releaseSummaryGrid = q('release-summary-grid');
  if (releaseSummaryGrid) {
    releaseSummaryGrid.innerHTML = Object.entries(groupedKinds)
      .map(([kind, count]) => `
        <article class="doc-card">
          <div class="doc-card-head">
            <span class="doc-pill">${escapeHtml(kind)}</span>
            <strong>${formatNumber(count)}</strong>
          </div>
          <p>File di tipo ${escapeHtml(kind)} dichiarati nel release manifest.</p>
        </article>
      `)
      .join('');
  }

  const timelineList = q('timeline-list');
  if (timelineList) {
    timelineList.innerHTML = entries
      .map((entry) => `
        <article class="timeline-item">
          <div class="timeline-marker"></div>
          <div class="timeline-card">
            <div class="timeline-head">
              <span class="doc-pill">${escapeHtml(entry.version || 'release')}</span>
              <strong>${escapeHtml(entry.title || '')}</strong>
            </div>
            <p class="timeline-date">${escapeHtml(entry.date || '')}</p>
            <ul class="doc-list">
              ${(entry.changes || []).map((change) => `<li>${escapeHtml(change)}</li>`).join('')}
            </ul>
          </div>
        </article>
      `)
      .join('');
  }

  const releaseTableBody = q('current-release-table-body');
  if (releaseTableBody) {
    releaseTableBody.innerHTML = Object.entries(releaseEntries)
      .map(([datasetKey, meta]) => `
        <tr>
          <td>${escapeHtml(datasetKey)}</td>
          <td>${escapeHtml(meta.kind || 'n.d.')}</td>
          <td>${formatBytes(meta.size_bytes || 0)}</td>
          <td>${escapeHtml(metaCount(meta))}</td>
        </tr>
      `)
      .join('');
  }
}

async function init() {
  activateNav();
  wireCopyButtons();
  const page = document.body.dataset.sitePage;
  if (!page || page === 'dashboard') return;
  try {
    const bundle = await loadBundle();
    if (page === 'data-download') renderDownloadPage(bundle);
    if (page === 'products') await renderProductsPage(bundle);
    if (page === 'programmatic-access') renderProgrammaticPage(bundle);
    if (page === 'usage-notes') renderUsageNotesPage(bundle);
    if (page === 'update-log') renderUpdateLogPage(bundle);
  } catch (error) {
    console.error(error);
    const target = q('page-load-error');
    if (target) {
      target.innerHTML = `<div class="doc-alert tone-error">Errore di caricamento: ${escapeHtml(error.message)}</div>`;
    }
  }
}

init();
