function within(root, selector) {
  const descendants = [...root.querySelectorAll(selector)];
  if (root.matches?.(selector)) descendants.unshift(root);
  return descendants;
}

function enhanceButtons(root) {
  within(root, 'button').forEach((button) => {
    if (button.dataset.tablerifiedButton === '1') return;
    button.classList.add('btn');
    if (button.classList.contains('small-btn')) {
      button.classList.add('btn-sm');
    }
    const isGhost = button.classList.contains('ghost-btn');
    const inUtilityZone = button.closest(
      '.toolbar-right, .jump-nav, .table-pager, .map-header-actions, .detail-actions-row, .selection-dock-actions, .command-header, .panel-header, .compare-map-toolbar, .site-nav, .dashboard-section-tabs, .map-toolbar-buttons, .doc-card-head, .timeline-controls'
    );
    if (isGhost || inUtilityZone) {
      button.classList.add('btn-outline-secondary');
    } else {
      button.classList.add('btn-primary');
    }
    button.dataset.tablerifiedButton = '1';
  });
}

function enhanceControls(root) {
  within(root, 'select').forEach((select) => {
    select.classList.add('form-select');
  });
  within(root, 'textarea').forEach((textarea) => {
    textarea.classList.add('form-control');
  });
  within(root, 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"]')
    .forEach((input) => {
      input.classList.add('form-control');
    });
  within(root, 'input[type="range"]').forEach((input) => {
    input.classList.add('form-range');
  });
  within(root, 'input[type="checkbox"], input[type="radio"]').forEach((input) => {
    input.classList.add('form-check-input');
  });
}

function enhanceTables(root) {
  within(root, 'table').forEach((table) => {
    table.classList.add('table', 'table-vcenter');
  });
  within(root, '.table-wrap, .doc-table-wrap').forEach((wrapper) => {
    wrapper.classList.add('table-responsive');
  });
}

function enhanceBadges(root) {
  within(root, '.pill, .meta-pill, .doc-pill, .severity-pill').forEach((badge) => {
    badge.classList.add('badge', 'rounded-pill');
    if (badge.classList.contains('muted')) {
      badge.classList.add('text-bg-light');
    }
  });
}

function enhanceSurfaces(root) {
  within(root,
      '.panel, .brand, .overview-card, .doc-card, .stat-card, .site-doc-hero, .doc-section, .selection-dock-main, .onboarding-dialog, .command-dialog, .helper-card, .detail-meta-block, .hero-stat-card'
    )
    .forEach((surface) => {
      surface.classList.add('lce-surface');
    });
}

function enhanceNavigation(root) {
  within(root, '.site-nav a').forEach((link) => {
    link.classList.add('nav-link');
    const icon = link.querySelector('i');
    if (icon) {
      icon.classList.add('site-nav-icon');
    }
    if (link.classList.contains('is-active')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

function enhanceDom(root = document) {
  enhanceButtons(root);
  enhanceControls(root);
  enhanceTables(root);
  enhanceBadges(root);
  enhanceSurfaces(root);
  enhanceNavigation(root);
}

document.addEventListener('DOMContentLoaded', () => {
  enhanceDom(document);

  let scheduled = false;
  const pending = new Set();
  const observer = new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) pending.add(node);
    }));
    if (!pending.size) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const added = new Set(pending);
      pending.clear();
      added.forEach(root => {
        if (!root.isConnected) return;
        for (let parent = root.parentElement; parent; parent = parent.parentElement) {
          if (added.has(parent)) return;
        }
        enhanceDom(root);
      });
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
});
