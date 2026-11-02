import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.refresh_release_manifest import summarize_file


class PublishedManifestTests(unittest.TestCase):
    def test_git_hashes_match_published_bytes_despite_windows_newlines(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True).stdout

            git("init")
            (root / ".gitattributes").write_text("*.csv text eol=lf\n*.json text eol=lf\n", encoding="utf-8")
            csv = root / "sample.csv"
            csv.write_bytes(b"id,name\r\n001,Roma\r\n")
            document = root / "sample.json"
            document.write_bytes(b'{"entries":[{}]}\r\n')
            git("add", ".")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture")
            for path in (csv, document):
                published = git("show", f"HEAD:{path.name}")
                info = summarize_file(path, root, git_ref="HEAD")
                self.assertEqual(info["sha256"], hashlib.sha256(published).hexdigest())
                self.assertEqual(info["size_bytes"], len(published))
                self.assertNotEqual(info["sha256"], summarize_file(path, root)["sha256"])
            self.assertEqual(summarize_file(csv, root, "HEAD")["row_count"], 1)
            self.assertEqual(summarize_file(document, root, "HEAD")["entry_count"], 1)
