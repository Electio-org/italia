from pathlib import Path
import unittest

from clients.python.lce_loader import load_bundle


class LoaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[3]
        cls.bundle = load_bundle(cls.root)

    def test_manifest_version(self):
        self.assertTrue(self.bundle.version)

    def test_can_read_summary(self):
        summary = self.bundle.load_dataset('municipalitySummary')
        self.assertIn('municipality_id', summary.columns)

    def test_products_declared(self):
        products = self.bundle.list_products()
        self.assertGreaterEqual(len(products), 3)

    def test_integrity_report_ok(self):
        report = self.bundle.verify_integrity()
        self.assertTrue(report['ok'], report)


    def test_can_filter_summary(self):
        summary = self.bundle.filter_summary(election_key=self.bundle.available_elections().iloc[0]['election_key'])
        self.assertIn('election_key', summary.columns)

    def test_can_read_results_shard_for_election(self):
        shard_keys = list((self.bundle.result_shards().get('shards') or {}).keys())
        if not shard_keys:
            self.skipTest('No result shards declared in this bundle')
        rows = self.bundle.load_results_for_election(shard_keys[0])
        self.assertIn('election_key', rows.columns)

    def test_recipes_present(self):
        self.assertGreaterEqual(len(self.bundle.recipes()), 1)


    def test_site_guides_present(self):
        self.assertGreaterEqual(len(self.bundle.site_guides().get('layers') or []), 1)

    def test_citation_present(self):
        self.assertIn('cff-version', self.bundle.citation())

    def test_archive_gap_report_present(self):
        report = self.bundle.archive_gap_report()
        self.assertIn('rows', report)
        self.assertGreaterEqual(len(report.get('rows') or []), 1)


if __name__ == '__main__':
    unittest.main()
