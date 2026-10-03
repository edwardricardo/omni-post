"""Tests of post_edit against the repository's real secretlint: the file just
written is scanned as a literal path, with the file selection lint-staged uses."""

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import post_edit  # noqa: E402

ROOT = post_edit.PROJECT_ROOT

# Assembled at run time so this source file never holds a detectable credential.
SECRET_CONTENT = "export const probeConfig = { aws_secret" + '_access_key: "' + "Zq7Wx3Rt2Lmn4Pvb9Hk8" * 2 + '" };\n'
CLEAN_CONTENT = "export const probeConfig = { region: \"eu-west-1\" };\n"

# Next.js route segment shapes that are also glob syntax.
ROUTE_SHAPES = ("[id]/page.tsx", "[...path]/route.ts", "(group)/page.tsx")


class PostEditScanTests(unittest.TestCase):
    """Each case runs `main()` with a Write payload and reads the exit code."""

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

    def _run(self, path: Path) -> tuple[int, str]:
        payload = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(path)}})
        stderr = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(payload)), mock.patch("sys.stderr", stderr), \
                self.assertRaises(SystemExit) as raised:
            post_edit.main()
        return raised.exception.code, stderr.getvalue()

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

    def test_the_command_passes_the_path_verbatim_with_both_selection_flags(self):
        path = self._plant("[id]/page.tsx", CLEAN_CONTENT)
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(post_edit.subprocess, "run", return_value=completed) as run:
            code, _ = self._run(path)
        self.assertEqual(code, 0)
        argv = run.call_args.args[0]
        self.assertEqual(argv[-1], str(path))
        self.assertIn("--no-glob", argv)
        self.assertIn("--no-gitignore", argv)


if __name__ == "__main__":
    unittest.main()
