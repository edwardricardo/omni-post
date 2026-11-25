"""Tests of pre_edit: which paths need the sensitive-edit token."""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_bash  # noqa: E402
import pre_edit  # noqa: E402

# One path under each pattern, as an Edit names it: absolute, in a checkout.
GUARDED = {
    "/.claude/hooks-py/": "/r/.claude/hooks-py/pre_bash.py",
    "/.claude/settings.json": "/r/.claude/settings.json",
    "/.claude/settings.local.json": "/r/.claude/settings.local.json",
    "/.claude/bin/": "/r/.claude/bin/omnipost-allow",
    "/infra/prisma/schema.prisma": "/r/infra/prisma/schema.prisma",
    "/infra/prisma/migrations/": "/r/infra/prisma/migrations/0001_init/migration.sql",
    "/.env": "/r/.env.test",
    "/encryption/": "/r/packages/encryption/src/index.ts",
    "/.github/workflows/": "/r/.github/workflows/ci.yml",
    "/packages/eslint-plugin-errors/": "/r/packages/eslint-plugin-errors/src/index.js",
    "/scripts/testing/lib/error-scope.mjs": "/r/scripts/testing/lib/error-scope.mjs",
    "/scripts/testing/error-sites-gate.mjs": "/r/scripts/testing/error-sites-gate.mjs",
    "/scripts/testing/lib/issue-reminder.mjs": "/r/scripts/testing/lib/issue-reminder.mjs",
    "/.husky/": "/r/.husky/pre-commit",
}


class SensitivePathTests(unittest.TestCase):
    def test_each_guarded_path_is_matched_by_its_own_pattern(self):
        self.assertEqual(sorted(GUARDED), sorted(pre_edit.SENSITIVE_PATTERNS), "one sample per pattern")
        for pattern, path in GUARDED.items():
            with self.subTest(path=path):
                self.assertEqual(pre_edit.is_sensitive(path), pattern)

    def test_the_commit_gate_and_its_shim_are_guarded(self):
        self.assertEqual(pre_edit.is_sensitive("/r/.husky/pre-commit"), "/.husky/")
        self.assertEqual(pre_edit.is_sensitive("/r/.husky/_/h"), "/.husky/")

    def test_paths_beside_the_guarded_ones_are_not_sensitive(self):
        for path in ("/r/docs/husky.md", "/r/.claude/feedback/workflow.md", "/r/scripts/testing/error-registry-gate.mjs", "", "/r/apps/api/src/app.ts"):
            with self.subTest(path=path):
                self.assertIsNone(pre_edit.is_sensitive(path))


class PreEditHookTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._log = mock.patch.object(_common, "LOG_PATH", Path(self._tmp.name) / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _main(self, file_path: str, token: str | None) -> int:
        payload = json.dumps({"tool_name": "Edit", "tool_input": {"file_path": file_path}})
        with mock.patch.object(pre_edit, "check_grant_token", return_value=token), mock.patch("sys.stdin", io.StringIO(payload)):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                pre_edit.main()
        return raised.exception.code

    def test_an_edit_of_the_commit_gate_needs_the_token(self):
        self.assertEqual(self._main("/r/.husky/pre-commit", "missing"), 2)
        self.assertEqual(self._main("/r/.husky/pre-commit", None), 0)

    def test_an_edit_of_a_path_no_pattern_names_passes_without_a_token(self):
        self.assertEqual(self._main("/r/docs/notes.md", "missing"), 0)


class BashWriteOfTheCommitGateTests(unittest.TestCase):
    """pre-bash reads the same list, so a shell write of the commit gate needs the token too."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._log = mock.patch.object(_common, "LOG_PATH", Path(self._tmp.name) / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _verdict(self, command: str) -> str:
        with mock.patch.object(pre_bash, "check_grant_token", return_value="missing"), contextlib.redirect_stderr(io.StringIO()):
            try:
                pre_bash.gate_sensitive_path_writes_require_token(command)
            except SystemExit as raised:
                return f"blocked({raised.code})"
        return "allowed"

    def test_a_shell_write_of_the_commit_gate_is_blocked_and_reading_it_is_not(self):
        self.assertEqual(self._verdict("printf 'exit 0\\n' > .husky/pre-commit"), "blocked(2)")
        self.assertEqual(self._verdict("chmod -x .husky/pre-commit"), "blocked(2)")
        self.assertEqual(self._verdict("bat -pp .husky/pre-commit"), "allowed")


if __name__ == "__main__":
    unittest.main()
