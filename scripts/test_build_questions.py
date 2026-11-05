"""Regression tests for PDF formula repair, without requiring PDF input files."""

import subprocess
import sys
import unittest
from pathlib import Path

from build_questions import repair_math_extraction


class FormulaRepairTests(unittest.TestCase):
    def test_root_fraction_examples(self):
        cases = {
            "√(a+b)/2": "√((a+b)/2)",
            "√(a+b+c)/9": "√((a+b+c)/9)",
            "√(a)/2": "√(a)/2",
            "√(+a)/2": "√(+a)/2",
            "√(a+)/2": "√(a+)/2",
            "√(+++)/2": "√((+++)/2)",
            "√(a+b)/1": "√(a+b)/1",
            "√(a+b": "√(a+b",
            "√(a+(b+c))/2": "√(a+(b+c))/2",
            "√(a+b)/2 and √(c+d)/3": "√((a+b)/2) and √((c+d)/3)",
            "√1+2+3/2": "√((1+2+3)/2)",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(repair_math_extraction(source), expected)

    def test_long_malformed_roots_finish(self):
        # Run in a child so a regression fails promptly instead of hanging CI.
        subprocess.run(
            [sys.executable, "-c", """
from build_questions import repair_math_extraction
for suffix in ('', ')', ')/1', ')/2'):
    source = '√(' + '+' * 100_000 + suffix
    expected = '√((' + '+' * 100_000 + ')/2)' if suffix == ')/2' else source
    assert repair_math_extraction(source) == expected
"""],
            cwd=Path(__file__).resolve().parent,
            check=True,
            timeout=10,
        )


if __name__ == "__main__":
    unittest.main()
