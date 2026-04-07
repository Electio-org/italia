function enhanceButtons(root) {
  root.querySelectorAll('button').forEach((button) => {
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
  root.querySelectorAll('select').forEach((select) => {
    select.classList.add('form-select');
  });
  root.querySelectorAll('textarea').forEach((textarea) => {
    textarea.classList.add('form-control');
  });
  root
    .querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"]')
    .forEach((input) => {
      input.classList.add('form-control');
    });
  root.querySelectorAll('input[type="range"]').forEach((input) => {
    input.classList.add('form-range');
  });
  root.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((input) => {
    input.classList.add('form-check-input');
  });
}

function enhanceTables(root) {
  root.querySelectorAll('table').forEach((table) => {
    table.classList.add('table', 'table-vcenter');
  });
  root.querySelectorAll('.table-wrap, .doc-table-wrap').forEach((wrapper) => {
    wrapper.classList.add('table-responsive');
  });
}

function enhanceBadges(root) {
  root.querySelectorAll('.pill, .meta-pill, .doc-pill, .severity-pill').forEach((badge) => {
    badge.classList.add('badge', 'rounded-pill');
    if (badge.classList.contains('muted')) {
      badge.classList.add('text-bg-light');
    }
  });
}

function enhanceSurfaces(root) {
  root
    .querySelectorAll(
      '.panel, .brand, .overview-card, .doc-card, .stat-card, .site-doc-hero, .doc-section, .selection-dock-main, .onboarding-dialog, .command-dialog, .helper-card, .detail-meta-block, .hero-stat-card'
    )
    .forEach((surface) => {
      surface.classList.add('lce-surface');
    });
}

function enhanceNavigation(root) {
  root.querySelectorAll('.site-nav a').forEach((link) => {
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
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceDom(document);
    });
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
});
