import csv
import gzip
import hashlib
import json
import sys
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_election_pages import aggregate_turnout, valid_turnout


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals, self.links, self.ids, self.schemas = [], [], [], []
        self.h1, self.party_rows, self.raw_json = 0, 0, None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        if tag == 'h1':
            self.h1 += 1
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs['href'])
        if tag in ('a', 'link', 'script'):
            self.links.append(attrs.get('href') or attrs.get('src') or '')
        if tag == 'tr' and 'data-party' in attrs:
            self.party_rows += 1
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.raw_json = ''

    def handle_data(self, data):
        if self.raw_json is not None:
            self.raw_json += data

    def handle_endtag(self, tag):
        if tag == 'script' and self.raw_json is not None:
            self.schemas.append(json.loads(self.raw_json))
            self.raw_json = None


class ElectionPagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = json.loads((ROOT / 'assets/election-pages-data.json').read_text(encoding='utf-8'))
        cls.pages = json.loads((ROOT / 'seo/election-pages.json').read_text(encoding='utf-8'))

    def test_turnout_is_ratio_of_sums_not_mean_of_percentages(self):
        result = aggregate_turnout([{'electors': '100', 'voters': '20'}, {'electors': '900', 'voters': '810'}])
        self.assertEqual(result['turnout'], 83)
        self.assertEqual(result['units'], 2)

    def test_missing_or_invalid_turnout_is_not_zero_filled(self):
        for row in [{'electors': '', 'voters': ''}, {'electors': '100', 'voters': ''},
                    {'electors': '100', 'voters': '101'}, {'electors': '0', 'voters': '0'},
                    {'electors': 'NaN', 'voters': '2'}, {'electors': '100', 'voters': '-1'}]:
            self.assertFalse(valid_turnout(row))
        self.assertIsNone(aggregate_turnout([])['turnout'])
        self.assertEqual(aggregate_turnout([{'electors': '100', 'voters': '0'}])['turnout'], 0)

    def test_models_match_published_source_counts(self):
        self.assertEqual(len(self.audit['elections']), 5)
        self.assertEqual(self.audit['territorial_basis'], '2021-12-31')
        for model in self.audit['elections']:
            with self.subTest(election=model['key']):
                for path, digest in model['input_sha256'].items():
                    self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)
                with gzip.open(ROOT / model['files'][0], 'rt', encoding='utf-8-sig', newline='') as handle:
                    rows = list(csv.DictReader(handle))
                actual = aggregate_turnout(rows)
                self.assertAlmostEqual(actual['turnout'], model['turnout']['turnout'], places=10)
                self.assertEqual(actual['units'], model['turnout']['units'])
                self.assertAlmostEqual(sum(p['share'] for p in model['parties']), 100, places=8)
                self.assertEqual(sum(p['votes'] for p in model['parties']), model['total_votes'])
                self.assertEqual(model['paired_current']['units'], model['common'])
                self.assertEqual(model['paired_previous']['units'], model['common'])
                self.assertAlmostEqual(model['paired_current']['turnout'] - model['paired_previous']['turnout'], model['delta'], places=10)
                self.assertEqual(sum(region['units'] for region in model['regions']), model['common'])

    def test_static_pages_are_complete_and_linked(self):
        self.assertEqual(len(self.pages), 6)
        by_slug = {m['slug']: m for m in self.audit['elections']}
        sitemap = ET.parse(ROOT / 'sitemap.xml').getroot()
        urls = {node.text for node in sitemap.findall('.//{*}loc')}
        for page in self.pages:
            with self.subTest(path=page['path']):
                path = ROOT / page['path']
                source = path.read_text(encoding='utf-8')
                parser = Page()
                parser.feed(source)
                self.assertEqual(parser.h1, 1)
                self.assertEqual(parser.canonicals, ['https://electio-org.github.io/italia/' + page['url']])
                self.assertIn(parser.canonicals[0], urls)
                self.assertEqual(len(parser.ids), len(set(parser.ids)))
                self.assertTrue(parser.schemas)
                for link in parser.links:
                    target = urlsplit(link)
                    if not target.scheme and not target.netloc and target.path:
                        local = (path.parent / unquote(target.path)).resolve()
                        if target.path.endswith('/'):
                            local = local / 'index.html'
                        self.assertTrue(local.is_file(), f'Broken link: {page["path"]} -> {link}')
                if page.get('dataset'):
                    self.assertIn('non il riparto dei seggi', source)
                    self.assertEqual(parser.party_rows, len(by_slug[Path(page['path']).parent.name]['parties']))
                    self.assertIn('data-party-search', source)
                    self.assertIn('data-region-sort', source)
                    self.assertIn('selectedElection=', source)


if __name__ == '__main__':
    unittest.main()
