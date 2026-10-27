"""Notify IndexNow only about canonical public URLs in the published sitemap.

The key file verifies control of the public host; it is not an API credential.
This does not submit to Google and cannot guarantee indexing or ranking.
"""
import argparse
import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlsplit


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "PublicResearchDiscovery/1.0", "Accept": "application/xml,text/plain,application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def sitemap_urls(location, host, seen=None):
    seen = seen if seen is not None else set()
    if location in seen:
        return []
    if urlsplit(location).hostname != host:
        raise ValueError("Cross-host sitemap submission is not allowed")
    seen.add(location)
    root = ET.fromstring(fetch(location))
    locations = [node.text for node in root.findall('.//{*}loc')]
    if root.tag.endswith('sitemapindex'):
        return [url for item in locations for url in sitemap_urls(item, host, seen)]
    return locations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path(__file__).resolve().parents[1] / 'seo/indexnow.json')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    host = urlsplit(config['keyLocation']).hostname
    scope = config['keyLocation'].rsplit('/', 1)[0] + '/'
    urls = sorted(set(sitemap_urls(config['sitemap'], host)))
    if not urls or any(urlsplit(url).hostname != host or not url.startswith(scope) for url in urls):
        raise ValueError('The sitemap contains no URLs or URLs outside the verified scope')
    if args.dry_run:
        print(f'Dry run: {len(urls)} canonical URLs on {host}; no notification sent.')
        return
    key = fetch(config['keyLocation']).decode('utf-8').strip()
    if not 8 <= len(key) <= 128 or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' for char in key):
        raise ValueError('Invalid verification file')
    for start in range(0, len(urls), 10000):
        batch = urls[start:start + 10000]
        body = json.dumps({'host': host, 'key': key, 'keyLocation': config['keyLocation'], 'urlList': batch}).encode('utf-8')
        request = urllib.request.Request('https://api.indexnow.org/indexnow', data=body, headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'PublicResearchDiscovery/1.0'}, method='POST')
        with urllib.request.urlopen(request, timeout=45) as response:
            print(f'IndexNow HTTP {response.status}: received {len(batch)} URL notifications for {host}; indexing is not confirmed.')


if __name__ == '__main__':
    main()
