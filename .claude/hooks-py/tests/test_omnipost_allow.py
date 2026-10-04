"""Tests for `.claude/bin/omnipost-allow`, the CLI that creates the time-boxed
authorization tokens the hooks check.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parents[2] / "bin" / "omnipost-allow"


def _load_cli():
    """The CLI has no `.py` suffix, so it needs an explicit source loader."""
    loader = importlib.machinery.SourceFileLoader("omnipost_allow", str(CLI))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class ListOperationsTests(unittest.TestCase):
    """The operations listing is a table: every description starts at the same
    column, whatever the length of the operation name."""

    def test_descriptions_start_at_the_same_column(self):
        listing = _load_cli().list_operations()
        self.assertGreater(len(listing.splitlines()), 1, listing)
        # " — " is the separator list_operations() writes between the padded
        # operation name and its description, so its index is the column the
        # description starts at; a changed separator makes .index() raise.
        columns = {line.index(" — ") for line in listing.splitlines()}
        self.assertEqual(len(columns), 1, listing)


if __name__ == "__main__":
    unittest.main()
