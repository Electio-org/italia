import csv
import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_referendum_pilot import complete_counts, parse_archive, sum_counts


class ReferendumCountsTest(unittest.TestCase):
    def test_valid_vote_denominator_and_signed_balance(self):
        row = complete_counts(dict(electors=200, voters=120, yes_votes=30, no_votes=70, blank_votes=5))
        self.assertEqual(row["yes_share"], 30)
        self.assertEqual(row["balance"], -40)
        self.assertEqual(row["turnout_pct"], 60)
        self.assertEqual(row["other_invalid_votes"], 15)

    def test_zero_votes_and_missing_are_not_zero_percent(self):
        row = complete_counts(dict(electors=200, voters=0, yes_votes=0, no_votes=0, blank_votes=0))
        self.assertIsNone(row["yes_share"])
        self.assertIsNone(row["balance"])
        self.assertEqual(row["turnout_pct"], 0)
        missing = complete_counts(dict(electors=200, voters=None, yes_votes=None, no_votes=1, blank_votes=0))
        self.assertIsNone(missing["yes_share"])
        self.assertIsNone(missing["other_invalid_votes"])

    def test_aggregation_sums_counts_before_percentages(self):
        rows = [dict(electors=10, voters=10, yes_votes=9, no_votes=1, blank_votes=0, other_invalid_votes=0),
                dict(electors=90, voters=90, yes_votes=9, no_votes=81, blank_votes=0, other_invalid_votes=0)]
        self.assertEqual(complete_counts(sum_counts(rows))["yes_share"], 18)
        rows[0]["blank_votes"] = None
        self.assertIsNone(sum_counts(rows)["blank_votes"])

    def test_inconsistent_counts_fail_loudly(self):
        with self.assertRaises(ValueError):
            complete_counts(dict(electors=200, voters=10, yes_votes=20, no_votes=20, blank_votes=0))

    def archive(self, rows):
        text = io.StringIO(newline="")
        fields = ["REGIONE", "PROVINCIA", "COMUNE", "NUM_REFERENDUM", "QUESITO", "ELETTORI", "VOTANTI", "NUMVOTISI", "NUMVOTINO", "SCHEDE_BIANCHE"]
        writer = csv.DictWriter(text, fieldnames=fields, delimiter=";")
        writer.writeheader()
        for row in rows:
            writer.writerow(dict(zip(fields, ["Lazio", "Roma", row, "1", "Riforma", 100, 80, 30, 40, 5])))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("referendum.txt", text.getvalue())
        return buffer.getvalue()

    def test_source_parser_and_duplicate_guard(self):
        rows, _ = parse_archive(self.archive(["Roma"]))
        self.assertEqual(rows[0]["valid_votes"], 70)
        with self.assertRaises(ValueError):
            parse_archive(self.archive(["Roma", "Roma"]))


if __name__ == "__main__":
    unittest.main()
