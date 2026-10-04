"""Tests of post_edit against the repository's real secretlint: the file just
written is scanned as a literal path, with the file selection lint-staged uses,
from the root of the git checkout that holds it."""

import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import post_edit  # noqa: E402

ROOT = post_edit.PROJECT_ROOT
REAL_RUN = subprocess.run

# Assembled at run time so this source file never holds a detectable credential.
SECRET_CONTENT = "export const probeConfig = { aws_secret" + '_access_key: "' + "Zq7Wx3Rt2Lmn4Pvb9Hk8" * 2 + '" };\n'
CLEAN_CONTENT = "export const probeConfig = { region: \"eu-west-1\" };\n"

# Next.js route segment shapes that are also glob syntax.
ROUTE_SHAPES = ("[id]/page.tsx", "[...path]/route.ts", "(group)/page.tsx")

# The suite's throwaway repositories must not depend on the machine's git
# identity, hooks or signing setup.
GIT_ISOLATION = (
    "-c", "user.name=post-edit-suite",
    "-c", "user.email=post-edit-suite@example.invalid",
    "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false",
)


def _git(cwd: Path, *args: str) -> None:
    REAL_RUN(["git", *GIT_ISOLATION, *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=10)


def _give_secretlint_setup(checkout: Path, *, installed: bool) -> None:
    """The files the hook looks for before scanning from `checkout`. Only their
    presence matters: the cases that use this capture the secretlint call."""
    for name in (".secretlintrc.json", ".secretlintignore"):
        shutil.copyfile(ROOT / name, checkout / name)
    if installed:
        binary = checkout / "node_modules" / ".bin" / "secretlint"
        binary.parent.mkdir(parents=True)
        binary.touch()


class HookRunMixin:
    """Runs `main()` with a Write payload and reads the exit code."""

    def _run(self, path: Path) -> tuple[int, str]:
        payload = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(path)}})
        stderr = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(payload)), mock.patch("sys.stderr", stderr), \
                self.assertRaises(SystemExit) as raised:
            post_edit.main()
        return raised.exception.code, stderr.getvalue()

    def _scan_call(self, path: Path) -> tuple[list[str], dict]:
        """The argv and keyword arguments of the one secretlint call, with git
        running for real so the checkout is resolved as in a live session."""
        calls = []

        def run(argv, **kwargs):
            if argv[0] == "git":
                return REAL_RUN(argv, **kwargs)
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, "", "")

        with mock.patch.object(post_edit.subprocess, "run", side_effect=run):
            code, stderr = self._run(path)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(len(calls), 1, calls)
        return calls[0]


class PostEditScanTests(HookRunMixin, unittest.TestCase):
    """Files inside the checkout that holds the hook, scanned by real secretlint."""

    @classmethod
    def setUpClass(cls):
        binary = ROOT / "node_modules" / ".bin" / "secretlint"
        if not binary.exists() or shutil.which("pnpm") is None:
            raise AssertionError(f"{binary} or pnpm is missing: install the workspace before running the hook suite")
        # `.tmp/` sits inside the repository, so secretlint runs with the real
        # root configuration, and is git-ignored, so a probe never shows as a change.
        cls._scratch_root = ROOT / ".tmp"
        cls._created_scratch_root = not cls._scratch_root.exists()
        cls._scratch_root.mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        if cls._created_scratch_root and not any(cls._scratch_root.iterdir()):
            cls._scratch_root.rmdir()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(dir=self._scratch_root)
        self.base = Path(self._tmp.name)
        self._log = mock.patch.object(_common, "LOG_PATH", self.base / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _plant(self, relative: str, content: str) -> Path:
        path = self.base / "app" / relative
        path.parent.mkdir(parents=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_a_clean_file_under_a_route_segment_is_scanned_and_allowed(self):
        for shape in ROUTE_SHAPES:
            with self.subTest(shape=shape):
                code, stderr = self._run(self._plant(shape, CLEAN_CONTENT))
                self.assertEqual(code, 0, stderr)

    def test_a_secret_under_a_route_segment_is_blocked_by_the_rule_not_by_a_missing_file(self):
        for shape in ROUTE_SHAPES:
            with self.subTest(shape=shape):
                code, stderr = self._run(self._plant(shape, SECRET_CONTENT))
                self.assertEqual(code, 2)
                self.assertIn("AWSSecretAccessKey", stderr)
                self.assertNotIn("Not found target files", stderr)

    def test_an_env_template_stays_excluded_as_secretlintignore_states(self):
        template = ROOT / ".env.example"
        self.assertTrue(template.exists(), f"{template} is the fixture: it holds example connection strings")
        # Precondition: with no ignore file at all, the template is flagged, so
        # the exit 0 below is the exclusion working and not an empty fixture.
        empty_ignore = self.base / "empty.secretlintignore"
        empty_ignore.write_text("", encoding="utf-8")
        unexcluded = post_edit.subprocess.run(
            [str(ROOT / "node_modules" / ".bin" / "secretlint"), "--secretlintrc", ".secretlintrc.json",
             "--secretlintignore", str(empty_ignore), "--no-gitignore", "--no-glob", "--format", "compact",
             str(template)],
            capture_output=True, text=True, cwd=ROOT, timeout=post_edit.SECRETLINT_TIMEOUT_SEC,
        )
        self.assertEqual(unexcluded.returncode, 1, unexcluded.stdout + unexcluded.stderr)
        code, stderr = self._run(template)
        self.assertEqual(code, 0, stderr)

    def test_the_env_template_stays_excluded_when_the_hook_runs_from_another_checkout(self):
        # An edit in a linked worktree runs the main checkout's hook, so the
        # hook's root is not the checkout that holds the file. A hook root
        # nested here reproduces that with real secretlint and the real ignore
        # file: the template is flagged unless the scan runs from its checkout.
        template = ROOT / ".env.example"
        self.assertTrue(template.exists(), f"{template} is the fixture: it holds example connection strings")
        hook_root = self.base / "hook-root"
        hook_root.mkdir()
        for name in (".secretlintrc.json", ".secretlintignore"):
            shutil.copyfile(ROOT / name, hook_root / name)
        with mock.patch.object(post_edit, "PROJECT_ROOT", hook_root):
            code, stderr = self._run(template)
        self.assertEqual(code, 0, stderr)

    def test_the_command_passes_a_root_relative_path_from_this_checkout_with_both_selection_flags(self):
        path = self._plant("[id]/page.tsx", CLEAN_CONTENT)
        argv, kwargs = self._scan_call(path)
        self.assertEqual(kwargs["cwd"], str(ROOT))
        self.assertEqual(argv[-1], str(path.relative_to(ROOT)))
        self.assertIn("--no-glob", argv)
        self.assertIn("--no-gitignore", argv)

    def test_the_scan_never_lets_pnpm_install_the_checkout_first(self):
        argv, kwargs = self._scan_call(self._plant("page.tsx", CLEAN_CONTENT))
        self.assertEqual(argv[:3], ["pnpm", "exec", "secretlint"])
        self.assertEqual((kwargs.get("env") or {}).get("PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN"), "false")


class PostEditScanRootTests(HookRunMixin, unittest.TestCase):
    """Files outside the checkout that holds the hook: the scan root is resolved
    by real git over throwaway repositories, and the secretlint call is captured."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name).resolve()
        self._log_path = self.base / "hooks.log"
        self._log = mock.patch.object(_common, "LOG_PATH", self._log_path)
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _linked_worktree(self) -> Path:
        main = self.base / "main"
        main.mkdir()
        _git(main, "init", "-q")
        _git(main, "commit", "-q", "--allow-empty", "-m", "init")
        linked = self.base / "linked"
        _git(main, "worktree", "add", "-q", str(linked))
        return linked

    def test_a_file_in_a_linked_worktree_is_scanned_from_that_worktree_with_a_root_relative_path(self):
        linked = self._linked_worktree()
        _give_secretlint_setup(linked, installed=True)
        template = linked / "apps" / "api" / ".env.example"
        template.parent.mkdir(parents=True)
        template.write_text("EXAMPLE=1\n", encoding="utf-8")
        alias = self.base / "alias"
        alias.symlink_to(linked, target_is_directory=True)
        for edited in (template, alias / "apps" / "api" / ".env.example"):
            with self.subTest(edited=str(edited)):
                argv, kwargs = self._scan_call(edited)
                self.assertEqual(kwargs["cwd"], str(linked))
                self.assertEqual(argv[-1], "apps/api/.env.example")

    def test_a_checkout_that_cannot_run_secretlint_is_scanned_from_the_hook_root_as_before(self):
        repo = self.base / "repo"
        repo.mkdir()
        _git(repo, "init", "-q")
        _give_secretlint_setup(repo, installed=False)
        edited = repo / ".env.example"
        edited.write_text("EXAMPLE=1\n", encoding="utf-8")
        argv, kwargs = self._scan_call(edited)
        self.assertEqual(kwargs["cwd"], str(ROOT))
        self.assertEqual(argv[-1], str(edited))
        self.assertIn("node_modules/.bin/secretlint", self._log_path.read_text(encoding="utf-8"))

    def test_a_file_outside_any_git_checkout_is_scanned_from_the_hook_root_as_before(self):
        outside = self.base / "notes.txt"
        outside.write_text("EXAMPLE=1\n", encoding="utf-8")
        probe = REAL_RUN(["git", "-C", str(self.base), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, timeout=10)
        self.assertNotEqual(probe.returncode, 0, f"{self.base} must sit outside any git checkout")
        argv, kwargs = self._scan_call(outside)
        self.assertEqual(kwargs["cwd"], str(ROOT))
        self.assertEqual(argv[-1], str(outside))


if __name__ == "__main__":
    unittest.main()
