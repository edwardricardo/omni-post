"""Tests de pre_bash: qué escribe de verdad un comando."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_bash  # noqa: E402
from _common import shell_segments  # noqa: E402


class _Gate(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._log = mock.patch.object(_common, "LOG_PATH", Path(self._tmp.name) / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _verdict(self, gate, *args) -> str:
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                gate(*args)
            except SystemExit as raised:
                return f"blocked({raised.code})"
        return "allowed"


class SensitiveWriteGateTests(_Gate):
    """Sin token: bloquea solo cuando una construcción de escritura APUNTA a la ruta."""

    def setUp(self):
        super().setUp()
        self._token = mock.patch.object(pre_bash, "check_grant_token", return_value="missing")
        self._token.start()

    def tearDown(self):
        self._token.stop()
        super().tearDown()

    def _gate(self, command: str) -> str:
        return self._verdict(pre_bash.gate_sensitive_path_writes_require_token, command)

    def test_a_heredoc_that_only_names_the_path_is_not_a_write_to_it(self):
        self.assertEqual(self._gate("cat > /tmp/x.py <<'EOF'\nprint('.claude/hooks-py/_common.py')\nEOF"), "allowed")

    def test_read_only_redirections_are_not_writes(self):
        self.assertEqual(self._gate("python3 -m unittest discover -s .claude/hooks-py/tests 2>/dev/null"), "allowed")
        self.assertEqual(self._gate("rg -n x .github/workflows/ci.yml 2>&1 | tail -3"), "allowed")
        self.assertEqual(self._gate("bat infra/prisma/schema.prisma"), "allowed")

    def test_a_redirection_or_tee_onto_the_path_is_a_write(self):
        self.assertEqual(self._gate("echo x > .claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("echo x >.claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("printf y >>../.env"), "blocked(2)")
        self.assertEqual(self._gate("printf y >> ../.env"), "blocked(2)")
        self.assertEqual(self._gate("cat x | tee -a .github/workflows/ci.yml"), "blocked(2)")

    def test_deleting_or_copying_onto_the_path_is_a_write(self):
        self.assertEqual(self._gate("rm -rf .claude/hooks-py/tests"), "blocked(2)")
        self.assertEqual(self._gate("cp .env.example .env"), "blocked(2)")
        self.assertEqual(self._gate("mv x infra/prisma/migrations/0001"), "blocked(2)")

    def test_reading_a_sensitive_source_to_copy_it_elsewhere_is_not_a_write_to_it(self):
        self.assertEqual(self._gate("cp .env /tmp/x"), "allowed")

    def test_constructs_whose_target_is_in_code_block_by_mention(self):
        self.assertEqual(self._gate("sd -i 'a' 'b' .claude/hooks-py/x.py"), "blocked(2)")
        self.assertEqual(self._gate("python3 -c \"open('.env','w')\""), "blocked(2)")
        self.assertEqual(self._gate("git checkout -- .claude/hooks-py/_common.py"), "blocked(2)")

    def test_an_untokenizable_command_falls_back_to_mention(self):
        self.assertEqual(self._gate("echo 'x > .claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("rm -rf .claude/hooks-py/tests 'unclosed"), "blocked(2)")

    def test_a_valid_token_lets_the_write_through(self):
        with mock.patch.object(pre_bash, "check_grant_token", return_value=None):
            self.assertEqual(self._gate("echo x > .claude/settings.json"), "allowed")


class WriteTargetsTests(unittest.TestCase):
    def test_targets_named_by_the_command(self):
        self.assertEqual(pre_bash.write_targets("echo x > a.txt && tee -a b.txt < c && rm -rf -- d e"), ["a.txt", "b.txt", "d", "e"])
        self.assertEqual(pre_bash.write_targets("cmd 2>/dev/null 2>&1 | tail"), [])
        self.assertEqual(pre_bash.write_targets("dd if=x of=y bs=1"), ["y"])
        self.assertEqual(pre_bash.write_targets("FOO=1 sudo cp a b"), ["b"])
        self.assertEqual(pre_bash.write_targets("cp -r a b dir/ && ln -s t l && rm a b"), ["dir/", "l", "a", "b"])

    def test_untokenizable_is_none(self):
        self.assertIsNone(pre_bash.write_targets("echo 'unclosed"))

    def test_shell_segments(self):
        self.assertEqual(shell_segments("a b && c|d; e"), [["a", "b"], ["c"], ["d"], ["e"]])
        self.assertIsNone(shell_segments("echo 'unclosed"))


if __name__ == "__main__":
    unittest.main()
