"""Tests of stop: the Maintainer's kill switch ends the hook before any audit runs.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""

import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import stop  # noqa: E402


class KillSwitchTests(unittest.TestCase):
    """Through `main()`, with one audit reporting an open item and no file read."""

    def _run_main(self, switch: str) -> tuple[int, str, mock.Mock]:
        audit = mock.Mock(return_value=["an open item"])
        out = io.StringIO()
        with mock.patch.object(stop, "log"), \
                mock.patch.object(stop, "audit_missing_tests", audit), \
                mock.patch.object(stop, "audit_missing_headers", mock.Mock(return_value=[])), \
                mock.patch.dict(os.environ, {"MAINTAINER_DISABLE_STOP_HOOK": switch}), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps({}))), \
                contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            stop.main()
        return raised.exception.code, out.getvalue(), audit

    def test_the_switch_set_to_yes_skips_every_audit(self):
        code, out, audit = self._run_main("yes")

        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        audit.assert_not_called()

    def test_without_the_switch_an_open_item_blocks_the_turn_and_names_the_switch(self):
        code, out, audit = self._run_main("")

        self.assertEqual(code, 0)
        audit.assert_called_once()
        decision = json.loads(out)
        self.assertEqual(decision["decision"], "block")
        self.assertIn("MAINTAINER_DISABLE_STOP_HOOK=yes", decision["reason"])


if __name__ == "__main__":
    unittest.main()
