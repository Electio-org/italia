#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class LombardiaCameraBundle:
    root: Path
    manifest: Dict[str, Any]

    @property
    def version(self) -> str:
        return str((self.manifest.get("project") or {}).get("version") or "")

    @property
    def files(self) -> Dict[str, str]:
        return dict(self.manifest.get("files") or {})

    def resolve(self, relpath: str) -> Path:
        return (self.root / relpath).resolve()

    def read_csv(self, relpath: str, **kwargs) -> pd.DataFrame:
        return pd.read_csv(self.resolve(relpath), **kwargs)

    def read_json(self, relpath: str) -> Dict[str, Any]:
        return json.loads(self.resolve(relpath).read_text(encoding='utf-8'))

    def load_dataset(self, dataset_key: str, **kwargs):
        rel = self.files.get(dataset_key)
        if not rel:
            raise KeyError(f"Dataset non dichiarato nel manifest: {dataset_key}")
        path = self.resolve(rel)
        suffix = path.suffix.lower()
        if suffix == '.csv':
            return pd.read_csv(path, **kwargs)
        if suffix in {'.json', '.geojson'}:
            return json.loads(path.read_text(encoding='utf-8'))
        raise ValueError(f"Formato non gestito: {path.name}")

    def list_products(self) -> List[Dict[str, Any]]:
        rel = self.files.get('dataProducts')
        if not rel:
            return []
        return list((self.read_json(rel).get('products') or []))

    def product_catalog(self) -> Dict[str, Any]:
        rel = self.files.get('productCatalog')
        if not rel:
            return {'products': []}
        return self.read_json(rel)

    def product_manifest(self, product_key: str) -> Dict[str, Any]:
        catalog = self.product_catalog()
        record = next((item for item in (catalog.get('products') or []) if item.get('product_key') == product_key), None)
        if not record:
            raise KeyError(f"Prodotto non dichiarato nel catalogo: {product_key}")
        rel = record.get('manifest_path')
        if not rel:
            raise KeyError(f"Manifest non dichiarato per il prodotto: {product_key}")
        return self.read_json(rel)

    def product_inventory(self, product_key: str) -> Dict[str, Any]:
        manifest = self.product_manifest(product_key)
        return dict(manifest.get('inventory') or {})

    def release_manifest(self) -> Dict[str, Any]:
        rel = self.files.get('releaseManifest')
        if not rel:
            return {}
        return self.read_json(rel)

    def result_shards(self) -> Dict[str, Any]:
        rel = self.files.get('municipalityResultsLongByElectionIndex')
        if not rel:
            return {}
        return self.read_json(rel)

    def summary_shards(self) -> Dict[str, Any]:
        rel = self.files.get('municipalitySummaryByElectionIndex')
        if not rel:
            return {}
        return self.read_json(rel)

    def verify_integrity(self) -> Dict[str, Any]:
        release = self.release_manifest()
        entries = release.get('file_entries') or {}
        problems = []
        checked = 0
        for dataset_key, meta in entries.items():
            rel = meta.get('path') or self.files.get(dataset_key)
            if not rel:
                problems.append({"dataset_key": dataset_key, "issue": "missing_path"})
                continue
            path = self.resolve(rel)
            if not path.exists():
                problems.append({"dataset_key": dataset_key, "issue": "missing_file", "path": rel})
                continue
            checked += 1
            expected = meta.get('sha256')
            if expected and _sha256_file(path) != expected:
                problems.append({"dataset_key": dataset_key, "issue": "sha256_mismatch", "path": rel})
        return {
            "checked": checked,
            "problems": problems,
            "ok": not problems,
        }


    def available_elections(self) -> pd.DataFrame:
        return self.load_dataset('electionsMaster')

    def load_results_for_election(self, election_key: str, **kwargs) -> pd.DataFrame:
        shard_payload = self.result_shards()
        shard_paths = shard_payload.get('shards') or {}
        rel = shard_paths.get(election_key)
        if rel:
            return self.read_csv(rel, **kwargs)
        df = self.load_dataset('municipalityResultsLong', **kwargs)
        return df[df['election_key'] == election_key].reset_index(drop=True)

    def load_summary_for_election(self, election_key: str, **kwargs) -> pd.DataFrame:
        shard_payload = self.summary_shards()
        shard_paths = shard_payload.get('shards') or {}
        rel = shard_paths.get(election_key)
        if rel:
            return self.read_csv(rel, **kwargs)
        df = self.load_dataset('municipalitySummary', **kwargs)
        return df[df['election_key'] == election_key].reset_index(drop=True)

    def load_product_dataset(self, product_key: str, role: str = 'primary', **kwargs):
        manifest = self.product_manifest(product_key)
        dataset = next((entry for entry in (manifest.get('datasets') or []) if entry.get('role') == role or entry.get('dataset_key') == role), None)
        if not dataset:
            raise KeyError(f"Dataset role non trovato nel prodotto {product_key}: {role}")
        return self.load_dataset(str(dataset['dataset_key']), **kwargs)

    def filter_summary(self, election_key: Optional[str] = None, province: Optional[str] = None, municipality_id: Optional[str] = None) -> pd.DataFrame:
        df = self.load_summary_for_election(election_key) if election_key is not None else self.load_dataset('municipalitySummary')
        if election_key is not None:
            df = df[df['election_key'] == election_key]
        if province is not None and 'province' in df.columns:
            df = df[df['province'] == province]
        if municipality_id is not None and 'municipality_id' in df.columns:
            df = df[df['municipality_id'] == municipality_id]
        return df.reset_index(drop=True)

    def recipes(self) -> List[Dict[str, Any]]:
        rel = self.files.get('researchRecipes')
        if not rel:
            return []
        payload = self.read_json(rel)
        return list(payload.get('recipes') or payload or [])

    def site_guides(self) -> Dict[str, Any]:
        rel = self.files.get('siteGuides')
        if not rel:
            return {}
        return self.read_json(rel)

    def archive_gap_report(self) -> Dict[str, Any]:
        rel = self.files.get('archiveBundleGapReport')
        if not rel:
            return {}
        return self.read_json(rel)

    def citation(self) -> str:
        citation_path = self.root / 'CITATION.cff'
        if citation_path.exists():
            return citation_path.read_text(encoding='utf-8')
        return f"Lombardia Camera Explorer, release {self.version}."

    def current_release(self) -> Dict[str, Any]:
        release = self.release_manifest()
        return {
            'version': self.version,
            'date': ((self.read_json(self.files['updateLog']).get('entries') or [{}])[0].get('date') if self.files.get('updateLog') else None),
            'declared_files': len(self.files),
            'integrity': (release.get('integrity') or {}),
        }

    def summary(self) -> Dict[str, Any]:
        products = self.files.keys()
        archive_gap = self.archive_gap_report()
        return {
            'root': str(self.root),
            'version': self.version,
            'declared_files': sorted(products),
            'data_products': len(self.list_products()),
            'product_catalog_products': len((self.product_catalog().get('products') or [])),
            'has_release_manifest': bool(self.files.get('releaseManifest')),
            'summary_shards': len((self.summary_shards().get('shards') or {})),
            'result_shards': len((self.result_shards().get('shards') or {})),
            'recipes': len(self.recipes()),
            'site_guides': len((self.site_guides().get('layers') or [])),
            'archive_gap_rows': len(archive_gap.get('rows') or []),
            'archive_gap_flagged_elections': (archive_gap.get('summary') or {}).get('with_any_flags', 0),
        }


def locate_manifest(root: Path) -> Path:
    candidates = [root / 'data' / 'derived' / 'manifest.json', root / 'manifest.json']
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError('manifest.json non trovato in data/derived o nella root del bundle')


def load_bundle(root: str | Path = '.') -> LombardiaCameraBundle:
    root_path = Path(root).resolve()
    manifest_path = locate_manifest(root_path)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    bundle_root = manifest_path.parent.parent.parent if manifest_path.parent.name == 'derived' else manifest_path.parent
    return LombardiaCameraBundle(root=bundle_root, manifest=manifest)


def main() -> int:
    parser = argparse.ArgumentParser(description='Loader ufficiale Python per il bundle Lombardia Camera Explorer')
    parser.add_argument('--root', default='.', help='Root del progetto o root del bundle')
    parser.add_argument('--dataset', help='Chiave del dataset da caricare dal manifest')
    parser.add_argument('--head', type=int, default=5, help='Numero di righe da mostrare per i CSV')
    parser.add_argument('--summary', action='store_true', help='Stampa un riepilogo del bundle')
    parser.add_argument('--verify', action='store_true', help='Verifica integrità dei file dichiarati nel release manifest')
    parser.add_argument('--products', action='store_true', help='Stampa i prodotti dati dichiarati')
    parser.add_argument('--recipes', action='store_true', help='Stampa le research recipes dichiarate')
    parser.add_argument('--guides', action='store_true', help='Stampa i site guides machine-readable dichiarati')
    parser.add_argument('--citation', action='store_true', help='Stampa la citazione del progetto / bundle')
    parser.add_argument('--product-catalog', action='store_true', help='Stampa il catalogo prodotti dichiarato')
    parser.add_argument('--product-manifest', help='Stampa il manifest del prodotto indicato')
    parser.add_argument('--product-inventory', help='Stampa l inventory del prodotto indicato')
    args = parser.parse_args()

    bundle = load_bundle(args.root)
    did_something = False

    if args.summary or (not args.dataset and not args.verify and not args.products):
        print(json.dumps(bundle.summary(), ensure_ascii=False, indent=2))
        did_something = True
    if args.products:
        print(json.dumps(bundle.list_products(), ensure_ascii=False, indent=2))
        did_something = True
    if args.recipes:
        print(json.dumps(bundle.recipes(), ensure_ascii=False, indent=2))
        did_something = True
    if args.guides:
        print(json.dumps(bundle.site_guides(), ensure_ascii=False, indent=2))
        did_something = True
    if args.product_catalog:
        print(json.dumps(bundle.product_catalog(), ensure_ascii=False, indent=2))
        did_something = True
    if args.product_manifest:
        print(json.dumps(bundle.product_manifest(args.product_manifest), ensure_ascii=False, indent=2))
        did_something = True
    if args.product_inventory:
        print(json.dumps(bundle.product_inventory(args.product_inventory), ensure_ascii=False, indent=2))
        did_something = True
    if args.citation:
        print(bundle.citation())
        did_something = True
    if args.verify:
        report = bundle.verify_integrity()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        did_something = True
        if not report.get('ok'):
            return 1
    if args.dataset:
        obj = bundle.load_dataset(args.dataset)
        if isinstance(obj, pd.DataFrame):
            print(obj.head(args.head).to_string(index=False))
        else:
            if isinstance(obj, dict) and 'features' in obj:
                print(json.dumps({'type': obj.get('type'), 'features': len(obj.get('features') or [])}, ensure_ascii=False, indent=2))
            else:
                print(json.dumps(obj, ensure_ascii=False, indent=2)[:4000])
        did_something = True

    return 0 if did_something else 0


if __name__ == '__main__':
    raise SystemExit(main())
