"""Build crawlable language pages and discovery files from the public site config.

Run from any directory: python scripts/build_discovery.py
Only configured public pages are included; private repositories and local files are never scanned.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
from datetime import datetime, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "seo/site.json").read_text(encoding="utf-8"))
BASE = CONFIG["url"]
PERSON = {"@type": "Person", "@id": "https://simoneghezzicolombo.github.io/#person", "name": "Simone Ghezzi Colombo", "url": "https://simoneghezzicolombo.github.io/"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class Localize(HTMLParser):
    def __init__(self, pairs=None, dictionary=None):
        super().__init__(convert_charrefs=True)
        self.pairs, self.dictionary = pairs or {}, dictionary or {}
        self.output, self.raw, self.skip = [], None, None

    def handle_decl(self, decl):
        self.output.append(f"<!{decl}>")

    def handle_comment(self, text):
        self.output.append(f"<!--{text}-->")

    def handle_starttag(self, tag, attributes):
        if self.skip:
            return
        attrs = dict(attributes)
        for attr, value in list(attrs.items()):
            if attr in ("alt", "title", "aria-label", "content") and value in self.pairs:
                attrs[attr] = self.pairs[value]
        for source, target in (("data-i18n-alt", "alt"), ("data-i18n-src", "src"), ("data-i18n-aria-label", "aria-label")):
            if attrs.get(source) in self.dictionary:
                attrs[target] = self.dictionary[attrs[source]]
        encoded = "".join(f' {key}' if value is None else f' {key}="{html.escape(value, quote=True)}"' for key, value in attrs.items())
        self.output.append(f"<{tag}{encoded}>")
        if attrs.get("data-i18n") in self.dictionary:
            self.output.append(html.escape(self.dictionary[attrs["data-i18n"]], quote=False))
            self.skip = tag
        if tag in ("script", "style"):
            self.raw = tag

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.skip:
            if tag != self.skip:
                return
            self.skip = None
        self.output.append(f"</{tag}>")
        if self.raw == tag:
            self.raw = None

    def handle_data(self, data):
        if self.skip:
            return
        if self.raw:
            self.output.append(data)
            return
        text = data.strip()
        if text in self.pairs:
            data = data.replace(text, self.pairs[text])
        self.output.append(html.escape(data, quote=False))


def translations():
    config = CONFIG.get("translate")
    if not config:
        return None
    source = (ROOT / config["source"]).read_text(encoding="utf-8")
    if config["kind"] == "portfolio":
        script = "const fs=require('fs'),vm=require('vm');const s=fs.readFileSync(0,'utf8');const a=s.indexOf('const translations =');const b=s.indexOf('const demoText',a);console.log(JSON.stringify(vm.runInNewContext(s.slice(a,b)+';translations')));"
        return json.loads(subprocess.run(["node", "-e", script], input=source, text=True, encoding="utf-8", capture_output=True, check=True).stdout)
    marker = f"const {config['constant']} = "
    start = source.index(marker) + len(marker)
    pairs = json.loads(source[start:source.index("\n];", start) + 2])
    first, second = config["order"]
    return {second: dict(pairs), first: {b: a for a, b in pairs}}


def head_metadata(source, page, language="it"):
    url = urljoin(BASE, page.get("url", ""))
    title = page.get(f"title_{language}", page["title"])
    description = page.get(f"description_{language}", page["description"])
    source = re.sub(r'<!-- search-discovery:start -->[\s\S]*?<!-- search-discovery:end -->\s*', '', source)
    source = re.sub(r'<html\b[^>]*>', f'<html lang="{language}">', source, count=1, flags=re.I)
    def language_link(match):
        tag = re.sub(r'\saria-current="[^"]*"', '', match.group(0))
        return tag[:-1] + ' aria-current="page">' if f'data-lang-toggle="{language}"' in tag else tag
    source = re.sub(r'<a\b[^>]*data-lang-toggle="(?:it|en)"[^>]*>', language_link, source)
    source = re.sub(r'<title>[\s\S]*?</title>', f'<title>{html.escape(title)}</title>', source, count=1, flags=re.I)
    source = re.sub(r'<meta\b(?=[^>]*\bname=[\"\']description[\"\'])[^>]*>', f'<meta name="description" content="{html.escape(description, quote=True)}">', source, count=1, flags=re.I)
    source = re.sub(r'<link\b(?=[^>]*\brel=[\"\'](?:canonical|alternate)[\"\'])[^>]*>\s*', '', source, flags=re.I)
    source = re.sub(r'<meta\b(?=[^>]*(?:property=[\"\'](?:og:|article:)|name=[\"\'](?:twitter:|robots|author)[^\"\']*[\"\']))[^>]*>\s*', '', source, flags=re.I)
    website_id = BASE + "#website"
    webpage = {"@type": page.get("type", "WebPage"), "@id": url + "#webpage", "url": url, "name": title, "description": description, "inLanguage": language, "isPartOf": {"@id": website_id}}
    website = {"@type": "WebSite", "@id": website_id, "url": BASE, "name": CONFIG["name"], "description": CONFIG["description"], "inLanguage": CONFIG.get("languages", ["it"])}
    graph = [website, webpage]
    if page.get("type") == "ProfilePage":
        webpage["mainEntity"] = {"@id": PERSON["@id"]}
    if CONFIG.get("author", True):
        graph.append(PERSON)
        webpage["author"] = {"@id": PERSON["@id"]}
        website["creator"] = {"@id": PERSON["@id"]}
    if page.get("dataset"):
        dataset = {"@type": "Dataset", "@id": url + "#dataset", "url": url, "name": title, "description": description, "creator": {"@id": PERSON["@id"]}, **page["dataset"]}
        webpage["mainEntity"] = {"@id": dataset["@id"]}
        graph.append(dataset)
    block = ['<!-- search-discovery:start -->', f'<link rel="canonical" href="{html.escape(url, quote=True)}">', '<meta name="robots" content="index,follow,max-image-preview:large">']
    if CONFIG.get("author", True):
        block.append('<meta name="author" content="Simone Ghezzi Colombo">')
    image = urljoin(BASE, CONFIG.get("image", "social-preview.png"))
    for property_name, value in (("og:type", "website"), ("og:site_name", CONFIG["name"]), ("og:title", title), ("og:description", description), ("og:url", url), ("og:image", image), ("og:image:alt", CONFIG.get("image_alt", CONFIG["name"])), ("og:locale", "en_GB" if language == "en" else "it_IT")):
        block.append(f'<meta property="{property_name}" content="{html.escape(value, quote=True)}">')
    for name, value in (("twitter:card", "summary_large_image"), ("twitter:title", title), ("twitter:description", description), ("twitter:image", image)):
        block.append(f'<meta name="{name}" content="{html.escape(value, quote=True)}">')
    if page.get("localized"):
        for lang, href in (("it", ""), ("en", "index-en.html"), ("x-default", "")):
            block.append(f'<link rel="alternate" hreflang="{lang}" href="{urljoin(BASE, href)}">')
        locale_metadata = {lang: {"title": page.get(f"title_{lang}", page['title']), "description": page.get(f"description_{lang}", page['description'])} for lang in ('it', 'en')}
        block.append('<script id="search-locale-metadata" type="application/json">' + json.dumps(locale_metadata, ensure_ascii=False).replace('</', '<\\/') + '</script>')
    block.extend([f'<link rel="alternate" type="application/rss+xml" title="{html.escape(CONFIG["name"], quote=True)}" href="{BASE}feed.xml">', f'<link rel="sitemap" type="application/xml" href="{BASE}sitemap.xml">', '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/") + '</script>', '<!-- search-discovery:end -->'])
    source = source.replace("</head>", "\n" + "\n".join(block) + "\n</head>", 1)
    if CONFIG.get("author", True) and BASE != PERSON["url"]:
        source = re.sub(r'<nav\b[^>]*data-research-network[^>]*>[\s\S]*?</nav>\s*', '', source)
        label = "Research projects and datasets" if language == "en" else "Progetti di ricerca e dataset"
        navigation = f'<nav data-research-network aria-label="{label}" style="max-width:1100px;margin:24px auto;padding:20px;display:flex;flex-wrap:wrap;gap:16px;font:15px/1.5 system-ui,sans-serif"><a href="https://simoneghezzicolombo.github.io/">Simone Ghezzi Colombo</a><a href="https://simoneghezzicolombo.github.io/progetti/">{label}</a></nav>'
        source = source.replace("</body>", navigation + "\n</body>", 1)
    return source


def write(name, text):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def sitemap(urls):
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{xml_escape(url)}</loc></url>\n' for url in sorted(set(urls))) + '</urlset>\n'


def build():
    localized = translations()
    urls = []
    for page in CONFIG["pages"]:
        source = (ROOT / page["path"]).read_text(encoding="utf-8")
        languages = CONFIG.get("languages", ["it"]) if page.get("localized") else [page.get("language", "it")]
        for language in languages:
            output = source
            if page.get("localized") and localized:
                parser = Localize(dictionary=localized[language]) if CONFIG["translate"]["kind"] == "portfolio" else Localize(pairs=localized[language])
                parser.feed(source)
                output = ''.join(parser.output)
            current = dict(page)
            name = page["path"]
            if page.get("localized") and language == "en":
                name, current["url"] = "index-en.html", "index-en.html"
            write(name, head_metadata(output, current, language))
            urls.append(urljoin(BASE, current.get("url", "")))
    urls.extend(urljoin(BASE, value) for value in CONFIG.get("extra_urls", []))
    write("sitemap-main.xml" if CONFIG.get("sitemap_index") else "sitemap.xml", sitemap(urls))
    if CONFIG.get("sitemap_index"):
        maps = [BASE + "sitemap-main.xml", *CONFIG["sitemap_index"]]
        write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <sitemap><loc>{xml_escape(url)}</loc></sitemap>\n' for url in maps) + '</sitemapindex>\n')
    links = [f"# {CONFIG['name']}", "", f"> {CONFIG['description']}", "", "## Public pages", ""]
    for page in CONFIG["pages"]:
        links.append(f"- [{page['title']}]({urljoin(BASE, page.get('url', ''))}): {page['description']}")
    for link in CONFIG.get("resources", []):
        links.append(f"- [{link['name']}]({urljoin(BASE, link['url'])}): {link['description']}")
    links.extend(["", "## Attribution and interpretation", "", CONFIG.get("citation", "Author: Simone Ghezzi Colombo. Cite the relevant page and the original data sources. These are independent research projects, not official institutional services."), ""])
    write("llms.txt", '\n'.join(links))
    items = CONFIG.get("feed_items", [{"title": CONFIG["name"], "url": BASE, "description": CONFIG["description"], "date": CONFIG["published"]}])
    if (ROOT / 'seo/projects.json').is_file():
        items = [{"title": item['name'], "url": item['url'], "description": item['description'], "date": CONFIG['published']} for item in json.loads((ROOT / 'seo/projects.json').read_text(encoding='utf-8'))]
    rss = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>', f'<title>{xml_escape(CONFIG["name"])}</title><link>{xml_escape(BASE)}</link><description>{xml_escape(CONFIG["description"])}</description>', f'<atom:link href="{BASE}feed.xml" rel="self" type="application/rss+xml"/>']
    for item in items:
        date = format_datetime(datetime.fromisoformat(item["date"]).replace(tzinfo=timezone.utc))
        rss.append(f'<item><title>{xml_escape(item["title"])}</title><link>{xml_escape(item["url"])}</link><guid isPermaLink="true">{xml_escape(item["url"])}</guid><description>{xml_escape(item["description"])}</description><pubDate>{date}</pubDate></item>')
    write("feed.xml", '\n'.join([*rss, '</channel></rss>', '']))
    print(f"Discovery built for {CONFIG['name']}: {len(urls)} canonical URLs")


if __name__ == "__main__":
    build()
