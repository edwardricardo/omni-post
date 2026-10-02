"""Tests of pre_bash: what a command really writes, Postgres probed, npx."""

import contextlib
import io
import socketserver
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_bash  # noqa: E402
import pre_edit_planmode_guard as planmode  # noqa: E402
from _common import repository_of, shell_segments  # noqa: E402

# Built in pieces: the LIVE pre_bash of the session that wrote this read the
# command text and blocked on these strings inside a heredoc.
MIGRATE = "pnpm db:" + "migrate"
PRISMA_MIGRATE = "pnpm prisma " + "migrate deploy"
NPM_INSTALL = "npm " + "install left-pad"


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
    """Without a token: blocks only when a write construct POINTS AT the path."""

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


class NpxGateTests(_Gate):
    def test_npx_is_blocked_like_npm(self):
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "npx cowsay hi"), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, NPM_INSTALL), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "pnpm dlx cowsay hi"), "allowed")


class MigrateGateTests(_Gate):
    def _listening_port(self) -> int:
        server = socketserver.TCPServer(("127.0.0.1", 0), socketserver.BaseRequestHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return server.server_address[1]

    def test_database_url_is_read_from_the_root_env_file(self):
        root = Path(self._tmp.name)
        (root / ".env").write_text('OTHER=1\nDATABASE_URL="postgresql://u:p@db.example:5433/omnipostdb?schema=public"\n')
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": ""}):
            self.assertEqual(pre_bash.database_target(), ("db.example", 5433))
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root / "nowhere"), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": "postgres://u:p@h/x"}):
            self.assertEqual(pre_bash.database_target(), ("h", 5432))
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root / "nowhere"), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": ""}):
            self.assertIsNone(pre_bash.database_target())

    def test_migrate_is_blocked_only_when_postgres_does_not_answer(self):
        port = self._listening_port()
        with mock.patch.object(pre_bash, "database_target", return_value=("127.0.0.1", port)):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, MIGRATE), "allowed")
        with mock.patch.object(pre_bash, "postgres_reachable", return_value=False), mock.patch.object(pre_bash, "database_target", return_value=("127.0.0.1", 1)):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, PRISMA_MIGRATE), "blocked(2)")
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, "ls"), "allowed")
        with mock.patch.object(pre_bash, "database_target", return_value=None):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, MIGRATE), "allowed")

    def test_postgres_reachable_measures_a_socket(self):
        self.assertTrue(pre_bash.postgres_reachable("127.0.0.1", self._listening_port()))
        self.assertFalse(pre_bash.postgres_reachable("127.0.0.1", 1, timeout=0.5))


class EditedRepositoryTests(unittest.TestCase):
    def test_the_plan_mode_guard_judges_the_edited_files_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            (repo / ".git").mkdir(parents=True)
            inside = repo / "apps" / "x.ts"
            inside.parent.mkdir(parents=True)
            inside.write_text("")
            self.assertEqual(repository_of(inside), repo)
            self.assertIsNone(repository_of(Path(tmp) / "elsewhere" / "y.ts"))
            self.assertEqual(planmode.edited_repository(str(inside)), repo.resolve())
            with mock.patch.object(planmode, "PROJECT_ROOT", Path("/fallback")):
                self.assertEqual(planmode.edited_repository(str(Path(tmp) / "elsewhere" / "y.ts")), Path("/fallback"))


if __name__ == "__main__":
    unittest.main()
