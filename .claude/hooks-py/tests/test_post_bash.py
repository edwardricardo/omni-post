"""Tests of post_bash: the publication token is consumed only by a real publication."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import post_bash  # noqa: E402


class TokenConsumptionTests(unittest.TestCase):
    """The consumer reads a publication exactly as the gate does (runs_git_push)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.token = root / "allowed" / "push"
        self.token.parent.mkdir()
        self.token.write_text(json.dumps({"operation": "push", "expires_at": "2099-01-01T00:00:00+00:00"}))
        self._patches = [
            mock.patch.object(post_bash, "ALLOWED_TOKENS_DIR", self.token.parent),
            mock.patch.object(_common, "LOG_PATH", root / "hooks.log"),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def _run(self, command: str) -> None:
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
        with mock.patch("sys.stdin", io.StringIO(payload)), self.assertRaises(SystemExit):
            post_bash.main()

    def test_a_line_that_only_names_the_token_path_leaves_the_token(self):
        self._run("git status && jq -r .expires_at " + str(self.token))
        self.assertTrue(self.token.exists())

    def test_a_real_publication_consumes_the_token(self):
        self._run("cd /wt && git " + "push origin a")
        self.assertFalse(self.token.exists())

    def test_an_unreadable_line_is_read_the_conservative_way_as_the_gate_reads_it(self):
        self._run("git " + "push origin 'unterminated")
        self.assertFalse(self.token.exists())


if __name__ == "__main__":
    unittest.main()
