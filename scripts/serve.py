#!/usr/bin/env python3
"""Zero-dependency dev server with content-encoding for the static bundle.

`python -m http.server` is convenient but it does not honor
`Accept-Encoding`, so the browser always downloads the uncompressed
`.geojson`/`.topojson`/`.csv` files even though pre-compressed `.gz`
siblings ship in the bundle. For the Italia Camera Explorer this means
roughly 3.5 MB of boundary data per page load instead of ~400 KB.

This wrapper serves the pre-compressed `.br` (Brotli) or `.gz` (Gzip)
sibling when it exists and the browser advertises support, and otherwise
falls back to the uncompressed asset. It also adds conservative
`Cache-Control` headers that are safe for a development workflow.

Usage:

    python scripts/serve.py            # serves :8000 from the repo root
    python scripts/serve.py --port 8080
    python scripts/serve.py --dir /some/path --host 127.0.0.1

The static file layout is left untouched; no transformation happens on
disk.
"""

from __future__ import annotations

import argparse
import mimetypes
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

mimetypes.add_type("application/json", ".topojson")
mimetypes.add_type("application/geo+json", ".geojson")
mimetypes.add_type("text/csv", ".csv")

COMPRESSED_ENCODINGS = (
    (".br", "br"),
    (".gz", "gzip"),
)


class CompressedStaticHandler(SimpleHTTPRequestHandler):
    """HTTP handler that serves pre-compressed siblings when available."""

    def send_head(self):  # noqa: D401 - parent docstring applies
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        accepted = self._accepted_encodings()
        for suffix, token in COMPRESSED_ENCODINGS:
            if token in accepted and os.path.isfile(path + suffix):
                return self._serve_compressed(path, suffix, token)

        return super().send_head()

    def _accepted_encodings(self) -> set[str]:
        header = self.headers.get("Accept-Encoding", "") or ""
        tokens = set()
        for part in header.split(","):
            name = part.strip().split(";", 1)[0].strip().lower()
            if name:
                tokens.add(name)
        return tokens

    def _serve_compressed(self, base_path: str, suffix: str, token: str):
        compressed_path = base_path + suffix
        try:
            stat = os.stat(compressed_path)
        except OSError:
            return super().send_head()
        ctype, _ = mimetypes.guess_type(base_path)
        if ctype is None:
            ctype = "application/octet-stream"
        try:
            fh = open(compressed_path, "rb")
        except OSError:
            return super().send_head()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Content-Encoding", token)
        self.send_header("Vary", "Accept-Encoding")
        self.send_header(
            "Last-Modified", self.date_time_string(int(stat.st_mtime))
        )
        # Cache-Control is appended in end_headers() for every response.
        self.end_headers()
        return fh

    def end_headers(self):  # type: ignore[override]
        # Leave long-lived caching to production hosting (Netlify / Cloudflare
        # Pages / GitHub Pages); in dev we want instant cache invalidation.
        # `no-store` on the service worker defeats Chrome's stubborn SW-script
        # HTTP cache so bumped `SW_VERSION`s land on the next reload.
        path = getattr(self, "path", "") or ""
        if path.rstrip("/").endswith("service-worker.js"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0", help="bind host (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="bind port (default 8000)")
    parser.add_argument(
        "--dir",
        default=str(Path(__file__).resolve().parent.parent),
        help="directory to serve (default repo root)",
    )
    args = parser.parse_args(argv)

    os.chdir(args.dir)
    httpd = HTTPServer((args.host, args.port), CompressedStaticHandler)
    print(f"serving {args.dir} on http://{args.host}:{args.port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("bye")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
