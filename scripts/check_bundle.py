#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
from pathlib import Path
import py_compile


def read_csv_rows(path: Path):
    if not path.exists():
        return []
    with path.open(encoding='utf-8', newline='') as fh:
        return list(csv.DictReader(fh))


def extract_table_sort_options(html_text: str):
    match = re.search(r'<select[^>]*id="table-sort"[^>]*>(.*?)</select>', html_text, flags=re.S | re.I)
    if not match:
        return []
    return re.findall(r'<option[^>]*value="([^"]+)"', match.group(1), flags=re.I)


def extract_sorter_keys(js_text: str):
    match = re.search(r'const sorters = \{(.*?)\n\s*};', js_text, flags=re.S)
    if not match:
        return []
    return re.findall(r'\n\s*([a-zA-Z0-9_]+)\s*:', match.group(1))


def extract_declared_functions(js_text: str):
    return set(re.findall(r'function\s+([A-Za-z0-9_]+)\s*\(', js_text))


def extract_imported_names(js_text: str):
    names = set()
    for block in re.findall(r'import\s*\{(.*?)\}\s*from', js_text, flags=re.S):
        for token in block.split(','):
            name = token.strip()
            if not name:
                continue
            names.add(name.split(' as ')[0].strip())
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description='Smoke checks for Lombardia Camera Explorer bundle')
    parser.add_argument('--root', default='.', help='Project root')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    issues = []
    warnings = []

    expected = [
        'index.html',
        'products.html',
        'data-download.html',
        'programmatic-access.html',
        'usage-notes.html',
        'update-log.html',
        'style.css',
        'app.js',
        'site-pages.js',
        'scripts/preprocess.py',
        'scripts/build_web_geometry_pack.py',
        'scripts/import_archive_gap_report.py',
        'scripts/rebuild_bundle_from_camera_opendata_archives.py',
        'scripts/rebuild_modern_bundle_from_archive.py',
        'scripts/rebuild_historical_bundle_from_grouped.py',
        'data/derived/manifest.json',
    ]
    for rel in expected:
        if not (root / rel).exists():
            issues.append(f'missing:{rel}')

    for rel_script in ['scripts/preprocess.py', 'scripts/build_web_geometry_pack.py', 'scripts/import_archive_gap_report.py', 'scripts/rebuild_bundle_from_camera_opendata_archives.py', 'scripts/rebuild_modern_bundle_from_archive.py', 'scripts/rebuild_historical_bundle_from_grouped.py', 'clients/python/lce_loader.py']:
        try:
            tmp_pyc = root / f'_tmp_{Path(rel_script).stem}_check.pyc'
            py_compile.compile(str(root / rel_script), cfile=str(tmp_pyc), doraise=True)
            if tmp_pyc.exists():
                tmp_pyc.unlink()
        except Exception as exc:
            issues.append(f'python_syntax:{rel_script}:{exc}')

    node_bin = shutil.which('node') or shutil.which('nodejs')
    if not node_bin:
        for candidate in [
            Path(r'C:\Program Files\nodejs\node.exe'),
            Path(r'C:\Program Files (x86)\nodejs\node.exe'),
        ]:
            if candidate.exists():
                node_bin = str(candidate)
                break
    if node_bin:
        for js_file in ['app.js', 'site-pages.js']:
            node = subprocess.run([node_bin, '--check', str(root / js_file)], capture_output=True, text=True)
            if node.returncode != 0:
                issues.append(f'js_syntax:{js_file}:{node.stderr.strip() or node.stdout.strip()}')
    else:
        warnings.append('js_syntax:skipped_node_not_found')

    loader_summary = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--summary'], capture_output=True, text=True)
    if loader_summary.returncode != 0:
        issues.append(f'python_loader_smoke:{loader_summary.stderr.strip() or loader_summary.stdout.strip()}')

    loader_verify = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--verify'], capture_output=True, text=True)
    if loader_verify.returncode != 0:
        issues.append(f'python_loader_verify:{loader_verify.stderr.strip() or loader_verify.stdout.strip()}')

    loader_recipes = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--recipes'], capture_output=True, text=True)
    if loader_recipes.returncode != 0:
        issues.append(f'python_loader_recipes:{loader_recipes.stderr.strip() or loader_recipes.stdout.strip()}')

    loader_citation = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--citation'], capture_output=True, text=True)
    if loader_citation.returncode != 0:
        issues.append(f'python_loader_citation:{loader_citation.stderr.strip() or loader_citation.stdout.strip()}')

    loader_guides = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--guides'], capture_output=True, text=True)
    if loader_guides.returncode != 0:
        issues.append(f'python_loader_guides:{loader_guides.stderr.strip() or loader_guides.stdout.strip()}')

    loader_product_catalog = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--product-catalog'], capture_output=True, text=True)
    if loader_product_catalog.returncode != 0:
        issues.append(f'python_loader_product_catalog:{loader_product_catalog.stderr.strip() or loader_product_catalog.stdout.strip()}')
    loader_product_inventory = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--product-inventory', 'camera_muni_historical'], capture_output=True, text=True)
    if loader_product_inventory.returncode != 0:
        issues.append(f'python_loader_product_inventory:{loader_product_inventory.stderr.strip() or loader_product_inventory.stdout.strip()}')
    loader_product_dataset = subprocess.run(['python', str(root / 'clients' / 'python' / 'lce_loader.py'), '--root', str(root), '--product-dataset', 'camera_muni_historical:primary', '--head', '3'], capture_output=True, text=True)
    if loader_product_dataset.returncode != 0:
        issues.append(f'python_loader_product_dataset:{loader_product_dataset.stderr.strip() or loader_product_dataset.stdout.strip()}')

    loader_tests = subprocess.run(['python', '-m', 'unittest', 'clients.python.tests.test_loader'], capture_output=True, text=True, cwd=str(root))
    if loader_tests.returncode != 0:
        issues.append(f'python_loader_tests:{loader_tests.stderr.strip() or loader_tests.stdout.strip()}')
    for pycache in root.rglob('__pycache__'):
        if pycache.is_dir():
            for child in pycache.iterdir():
                if child.is_file():
                    child.unlink()
            pycache.rmdir()

    app_js = (root / 'app.js').read_text(encoding='utf-8') if (root / 'app.js').exists() else ''
    index_html = (root / 'index.html').read_text(encoding='utf-8') if (root / 'index.html').exists() else ''
    sorter_options = extract_table_sort_options(index_html)
    sorter_keys = extract_sorter_keys(app_js)
    missing_sorters = [opt for opt in sorter_options if opt and opt not in sorter_keys]
    if missing_sorters:
        issues.append(f'table_sorter_mismatch:{",".join(missing_sorters)}')

    declared = extract_declared_functions(app_js)
    imported = extract_imported_names(app_js)
    required_runtime = {
        'setupControls','readControls','refreshPartySelector','requestRender','safeRender','renderStatusPanel','setLoading','showToast','selectMunicipality','invalidateDerivedCaches','registerIssue','restoreLocalState','saveLocalState','openOnboarding','closeOnboarding','checkpointHistory','assessRowTrust','assessViewTrust'
    }
    missing_runtime = sorted(name for name in required_runtime if name not in declared and name not in imported)
    if missing_runtime:
        issues.append(f'runtime_missing_functions:{",".join(missing_runtime)}')

    summary = read_csv_rows(root / 'data' / 'derived' / 'municipality_summary.csv')
    results = read_csv_rows(root / 'data' / 'derived' / 'municipality_results_long.csv')
    aliases = read_csv_rows(root / 'data' / 'derived' / 'municipality_aliases.csv')
    manifest = json.loads((root / 'data' / 'derived' / 'manifest.json').read_text(encoding='utf-8')) if (root / 'data' / 'derived' / 'manifest.json').exists() else {}
    files = manifest.get('files', {})

    geom_path = root / (files.get('geometry') or 'data/derived/lombardia_municipalities.geojson')
    geometry = json.loads(geom_path.read_text(encoding='utf-8')) if geom_path.exists() else {'features': []}
    quality = json.loads((root / 'data' / 'derived' / 'data_quality_report.json').read_text(encoding='utf-8')) if (root / 'data' / 'derived' / 'data_quality_report.json').exists() else {}
    elections_master = read_csv_rows(root / 'data' / 'derived' / 'elections_master.csv')

    if quality.get('derived_validations', {}).get('has_errors'):
        warnings.append('derived_validations:has_errors')

    if not geometry.get('features'):
        issues.append('geometry:placeholder_or_missing')

    required_manifest_keys = ['geometryPack', 'geometryPackFull', 'geometryFull', 'provinceGeometryFull', 'dataProducts', 'productCatalog', 'datasetContracts', 'provenance', 'releaseManifest', 'researchRecipes', 'siteGuides', 'municipalitySummaryByElectionIndex', 'municipalityResultsLongByElectionIndex', 'archiveBundleGapReport', 'webGeometryReport']
    for key in required_manifest_keys:
        rel = files.get(key)
        if not rel:
            issues.append(f'manifest:missing_{key}')
        elif not (root / rel).exists():
            issues.append(f'manifest:missing_file_for_{key}')

    if files.get('dataProducts') and (root / files['dataProducts']).exists():
        data_products = json.loads((root / files['dataProducts']).read_text(encoding='utf-8'))
        if not (data_products.get('products') or []):
            issues.append('data_products:empty_products')
        for client in data_products.get('clients') or []:
            entry = client.get('entrypoint')
            if entry and not (root / entry).exists():
                issues.append(f'data_products:missing_client:{entry}')

    if files.get('productCatalog') and (root / files['productCatalog']).exists():
        product_catalog = json.loads((root / files['productCatalog']).read_text(encoding='utf-8'))
        products = product_catalog.get('products') or []
        if not products:
            issues.append('product_catalog:empty_products')
        for product in products:
            manifest_path = product.get('manifest_path')
            if not manifest_path or not (root / manifest_path).exists():
                issues.append(f"product_catalog:missing_manifest:{product.get('product_key')}")
                continue
            product_manifest = json.loads((root / manifest_path).read_text(encoding='utf-8'))
            if not (product_manifest.get('datasets') or []):
                issues.append(f"product_manifest:empty_datasets:{product.get('product_key')}")
            inventory = product_manifest.get('inventory') or {}
            if not (inventory.get('entries') or []):
                issues.append(f"product_manifest:empty_inventory:{product.get('product_key')}")

    if files.get('municipalitySummaryByElectionIndex') and (root / files['municipalitySummaryByElectionIndex']).exists():
        shard_payload = json.loads((root / files['municipalitySummaryByElectionIndex']).read_text(encoding='utf-8'))
        shards = shard_payload.get('shards') or {}
        if not shards:
            warnings.append('summary_shards:empty')
        else:
            missing_shards = [key for key, rel in shards.items() if not (root / rel).exists()]
            if missing_shards:
                issues.append(f'summary_shards:missing_files:{",".join(missing_shards[:10])}')

    if files.get('municipalityResultsLongByElectionIndex') and (root / files['municipalityResultsLongByElectionIndex']).exists():
        shard_payload = json.loads((root / files['municipalityResultsLongByElectionIndex']).read_text(encoding='utf-8'))
        shards = shard_payload.get('shards') or {}
        if not shards:
            warnings.append('result_shards:empty')
        else:
            missing_shards = [key for key, rel in shards.items() if not (root / rel).exists()]
            if missing_shards:
                issues.append(f'result_shards:missing_files:{",".join(missing_shards[:10])}')

    if files.get('releaseManifest') and (root / files['releaseManifest']).exists():
        release_manifest = json.loads((root / files['releaseManifest']).read_text(encoding='utf-8'))
        entries = release_manifest.get('file_entries') or {}
        if not entries:
            issues.append('release_manifest:empty')
        if not (release_manifest.get('integrity') or {}).get('all_declared_files_present'):
            issues.append('release_manifest:declared_files_missing')
        expected_release_scope = set(files.keys()) - {'releaseManifest'}
        actual_release_scope = set(entries.keys())
        allowed_extra_scope = {key for key in actual_release_scope if str(key).startswith('productManifest:')}
        if actual_release_scope != set(files.keys()) and actual_release_scope != expected_release_scope and actual_release_scope != expected_release_scope.union(allowed_extra_scope):
            issues.append('release_manifest:file_scope_mismatch')

    if files.get('datasetContracts') and (root / files['datasetContracts']).exists():
        contracts = json.loads((root / files['datasetContracts']).read_text(encoding='utf-8'))
        if not (contracts.get('contracts') or []):
            issues.append('dataset_contracts:empty')

    if files.get('provenance') and (root / files['provenance']).exists():
        provenance = json.loads((root / files['provenance']).read_text(encoding='utf-8'))
        if len(provenance.get('entries') or []) < 5:
            issues.append('provenance:too_short')

    if files.get('researchRecipes') and (root / files['researchRecipes']).exists():
        recipes = json.loads((root / files['researchRecipes']).read_text(encoding='utf-8'))
        if len(recipes.get('recipes') or []) < 1:
            issues.append('research_recipes:empty')

    if files.get('siteGuides') and (root / files['siteGuides']).exists():
        guides = json.loads((root / files['siteGuides']).read_text(encoding='utf-8'))
        if len(guides.get('layers') or []) < 1:
            issues.append('site_guides:empty_layers')
        if len(guides.get('faq') or []) < 1:
            issues.append('site_guides:empty_faq')

    if files.get('archiveBundleGapReport') and (root / files['archiveBundleGapReport']).exists():
        gap_report = json.loads((root / files['archiveBundleGapReport']).read_text(encoding='utf-8'))
        rows = gap_report.get('rows') or []
        if not rows:
            issues.append('archive_gap_report:empty')

    web_geometry_path = root / (files.get('geometry') or '')
    full_geometry_path = root / (files.get('geometryFull') or '')
    if web_geometry_path.exists() and full_geometry_path.exists():
        web_size = web_geometry_path.stat().st_size
        full_size = full_geometry_path.stat().st_size
        if web_size >= full_size:
            issues.append('geometry_web:not_smaller_than_full')
    web_pack_path = root / (files.get('geometryPack') or '')
    full_pack_path = root / (files.get('geometryPackFull') or '')
    if web_pack_path.exists() and full_pack_path.exists():
        web_pack = json.loads(web_pack_path.read_text(encoding='utf-8'))
        full_pack = json.loads(full_pack_path.read_text(encoding='utf-8'))
        if web_pack == full_pack:
            issues.append('geometry_pack:web_and_full_identical')

    citation_path = root / 'CITATION.cff'
    if not citation_path.exists():
        issues.append('citation:missing_cff')

    bad_share = 0
    for row in results:
        try:
            value = float(row.get('vote_share') or '')
        except Exception:
            continue
        if value < -0.01 or value > 100.01:
            bad_share += 1
    if bad_share:
        warnings.append(f'vote_share_range:{bad_share}')

    misleading = 0
    for row in summary:
        note = str(row.get('comparability_note') or '')
        leader = str(row.get('first_party_std') or '').strip()
        flag = str(row.get('completeness_flag') or '')
        if 'party_rows_checked' in note and not leader:
            misleading += 1
        if not leader and 'turnout_only' not in flag:
            misleading += 1
    if misleading:
        issues.append(f'completeness_semantics:{misleading}')

    leaking_paths = 0
    for row in elections_master:
        blob = ' '.join([str(v) for v in row.values() if v is not None])
        if 'C:\\' in blob or '/Users/' in blob or '/mnt/' in blob or '/home/' in blob:
            leaking_paths += 1
    if leaking_paths:
        issues.append(f'elections_master_path_leak:{leaking_paths}')

    metadata_path_leaks = 0
    for rel in ['data/derived/manifest.json', 'data/derived/release_manifest.json', 'data/derived/web_geometry_report.json', 'data/products/product_catalog.json']:
        path = root / rel
        if not path.exists():
            continue
        blob = path.read_text(encoding='utf-8')
        if 'C:\\' in blob or '/Users/' in blob or '/mnt/' in blob or '/home/' in blob:
            metadata_path_leaks += 1
    if metadata_path_leaks:
        issues.append(f'metadata_path_leak:{metadata_path_leaks}')

    contradicted = 0
    coverage = {}
    for row in summary:
        coverage[row.get('election_key')] = coverage.get(row.get('election_key'), 0) + 1
    for row in elections_master:
        if str(row.get('status') or '').strip().lower() == 'completed' and not coverage.get(row.get('election_key')):
            contradicted += 1
    if contradicted:
        issues.append(f'elections_master_completed_without_rows:{contradicted}')

    if aliases and 'alias_type' not in aliases[0]:
        issues.append('alias_schema:missing_alias_type')

    pycache_dirs = [p for p in root.rglob('__pycache__') if p.is_dir()]
    if pycache_dirs:
        issues.append(f'pycache_shipped:{len(pycache_dirs)}')

    print(json.dumps({
        'root': str(root),
        'summary_rows': len(summary),
        'result_rows': len(results),
        'geometry_features': len(geometry.get('features') or []),
        'technical_readiness': quality.get('derived_validations', {}).get('technical_readiness_score', quality.get('derived_validations', {}).get('readiness_score')),
        'substantive_readiness': quality.get('derived_validations', {}).get('substantive_coverage_score'),
        'issues': issues,
        'warnings': warnings,
        'ok': not any(not issue.startswith('geometry:') for issue in issues)
    }, ensure_ascii=False, indent=2))
    return 0 if not any(not issue.startswith('geometry:') for issue in issues) else 1


if __name__ == '__main__':
    raise SystemExit(main())
