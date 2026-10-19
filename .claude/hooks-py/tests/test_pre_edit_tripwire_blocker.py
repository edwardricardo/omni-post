"""Tests of pre_edit_tripwire_blocker: which canon-exception markers the tripwire admits."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pre_edit_tripwire_blocker as tripwire  # noqa: E402

CODE_FILE = "apps/api/vitest.config.ts"


def _ids(diff_text: str) -> list[str]:
    return [match["id"] for match in tripwire.find_tripwire_matches(diff_text, CODE_FILE)]


class CanonExceptionScenarioTests(unittest.TestCase):
    def test_admits_a_decorative_demolition_marker_naming_its_ledger_slice(self):
        diff = "        // canon-exception: decorative-demolition:2.8.1a\n        lines: 56.7,\n"

        self.assertNotIn("canon-exception-untagged", _ids(diff))

    def test_admits_every_scenario_of_the_allowed_list(self):
        for scenario in tripwire.ALLOWED_EXCEPTION_SCENARIOS:
            with self.subTest(scenario=scenario):
                self.assertNotIn("canon-exception-untagged", _ids(f"// canon-exception: {scenario}:x\n"))

    def test_blocks_a_marker_whose_scenario_is_not_in_the_allowed_list(self):
        diff = "        // canon-exception: bogus-scenario\n        lines: 56.7,\n"

        self.assertIn("canon-exception-untagged", _ids(diff))

    def test_the_description_names_every_allowed_scenario(self):
        pattern = next(p for p in tripwire.TRIPWIRE_PATTERNS if p["id"] == "canon-exception-untagged")

        for scenario in tripwire.ALLOWED_EXCEPTION_SCENARIOS:
            with self.subTest(scenario=scenario):
                self.assertIn(scenario, pattern["description"])


if __name__ == "__main__":
    unittest.main()
