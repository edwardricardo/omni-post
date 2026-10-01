"""Tests de `_common`: resolución de rutas y avisos al contexto.

stdlib solamente (`python3 -m unittest discover -s .claude/hooks-py/tests
-t .claude/hooks-py`): los hooks no tienen runner propio y este contrato —
dónde vive la memoria y desde qué raíz se deriva, qué branch lee un gate — decidía sin ninguna
aserción que lo sostuviera.
"""

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
from _common import (  # noqa: E402
    PROJECT_ROOT,
    canon_index_path,
    canon_research_index_path,
    current_branch,
    memory_dir,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _init(repo: Path, branch: str) -> None:
    # `git init -b` pide git 2.28; `symbolic-ref` sobre el HEAD aún sin commits
    # deja la misma rama en cualquier git.
    _git(repo, "init", "-q")
    _git(repo, "symbolic-ref", "HEAD", f"refs/heads/{branch}")


class MemoryDirTests(unittest.TestCase):
    def setUp(self):
        _common._MEMORY_DIR_CACHE = None
        _common._MEMORY_DIR_WARNED = False

    def tearDown(self):
        _common._MEMORY_DIR_CACHE = None
        _common._MEMORY_DIR_WARNED = False

    def test_linked_worktree_derives_from_the_main_repository(self):
        # Lo que Claude Code hace: un solo directorio de memoria por repositorio,
        # compartido por sus worktrees; el nombre sale del principal, no del enlazado.
        # Limpieza en orden inverso de registro: primero el worktree enlazado,
        # después el directorio temporal; así corre aunque la aserción falle.
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        main_root = tmp / "main"
        main_root.mkdir()
        _init(main_root, "workstream/x")
        _git(main_root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x")
        linked = tmp / "linked"
        _git(main_root, "worktree", "add", "-q", str(linked))
        self.addCleanup(_git, main_root, "worktree", "remove", "--force", str(linked))
        with mock.patch.object(_common, "PROJECT_ROOT", linked.resolve()):
            expected = Path.home() / ".claude" / "projects" / str(main_root.resolve()).replace("/", "-") / "memory"
            self.assertEqual(memory_dir(), expected)
            # La resolución exitosa queda memorizada: la segunda llamada no vuelve a git.
            self.assertEqual(_common._MEMORY_DIR_CACHE, expected)
            with mock.patch.object(_common.subprocess, "run", side_effect=AssertionError("git must not run again")):
                self.assertEqual(memory_dir(), expected)

    def test_falls_back_to_project_root_without_git_and_does_not_cache_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_root = Path(tmp) / "repo"
            fake_root.mkdir()
            with mock.patch.object(_common, "PROJECT_ROOT", fake_root), mock.patch.object(
                _common, "LOG_PATH", Path(tmp) / "hooks.log"
            ), mock.patch.object(_common.subprocess, "run", side_effect=OSError("no git")):
                fallback = Path.home() / ".claude" / "projects" / str(fake_root.resolve()).replace("/", "-") / "memory"
                self.assertEqual(memory_dir(), fallback)
                self.assertEqual(memory_dir(), fallback)
                self.assertIsNone(_common._MEMORY_DIR_CACHE)
                self.assertEqual((Path(tmp) / "hooks.log").read_text().count("sin caché"), 1)

    def test_fallback_resolves_a_symlinked_project_root(self):
        # Sin git, el nombre sale de la ruta REAL: un PROJECT_ROOT alcanzado por
        # symlink no inventa un segundo directorio de memoria.
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        real = tmp / "real"
        real.mkdir()
        link = tmp / "link"
        link.symlink_to(real, target_is_directory=True)
        with mock.patch.object(_common, "PROJECT_ROOT", link), mock.patch.object(
            _common, "LOG_PATH", tmp / "hooks.log"
        ), mock.patch.object(_common.subprocess, "run", side_effect=OSError("no git")):
            expected = Path.home() / ".claude" / "projects" / str(real.resolve()).replace("/", "-") / "memory"
            self.assertEqual(memory_dir(), expected)

    def test_index_paths_derive_from_the_memory_dir(self):
        with mock.patch.object(_common, "memory_dir", return_value=Path("/m")):
            self.assertEqual(canon_index_path(), Path("/m") / "canon-index.json")
            self.assertEqual(canon_research_index_path(), Path("/m") / "canon_research_index.md")


class HooksLogTests(unittest.TestCase):
    def test_common_and_hook_lines_share_one_format(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(_common, "LOG_PATH", Path(tmp) / "hooks.log"):
            log, _block, _allow = _common.make_logger("some-hook")
            log("a")
            _common._append_log("b")
            lines = (Path(tmp) / "hooks.log").read_text().splitlines()
        self.assertRegex(lines[0], r"^\[\d{4}-\d{2}-\d{2}T[0-9:.]+\] \[some-hook\] a$")
        self.assertRegex(lines[1], r"^\[\d{4}-\d{2}-\d{2}T[0-9:.]+\] \[_common\] b$")


class CurrentBranchTests(unittest.TestCase):
    def test_reads_the_branch_of_the_repository_it_is_given(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init(repo, "refound/0-x")
            self.assertEqual(current_branch(repo), "refound/0-x")

    def test_reads_a_branch_with_no_commits_yet(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init(repo, "workstream/fresh")
            self.assertEqual(current_branch(repo), "workstream/fresh")

    def test_detached_head_is_no_branch(self):
        # Un HEAD suelto no es `workstream/*`: el gate de commits debe bloquear.
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init(repo, "workstream/x")
            _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x")
            _git(repo, "checkout", "-q", "--detach")
            self.assertEqual(current_branch(repo), "")

    def test_returns_empty_outside_a_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(current_branch(Path(tmp)), "")


HOOKS_DIR = PROJECT_ROOT / ".claude" / "hooks-py"


class HookScriptsTests(unittest.TestCase):
    """settings.json invoca cada hook por su ruta, sin `python3` delante: el
    shebang y el bit de ejecución SON el contrato. Una copia que pierde el bit
    deja al hook sin dispararse, con exit EACCES que nadie lee.

    Dos contratos, dos tests: el bit y el shebang se afirman sobre el
    directorio (sobreviven a cualquier reorganización de settings.json); el
    cableado se afirma aparte, y falla cuando settings.json cambia de forma,
    que es un hecho que este contrato tiene que ver, no una razón para callar.
    """

    def _hook_scripts(self) -> list[Path]:
        return sorted(p for p in HOOKS_DIR.glob("*.py") if p.name != "_common.py")

    def _wired_commands(self) -> list[str]:
        settings_path = PROJECT_ROOT / ".claude" / "settings.json"
        try:
            settings = json.loads(settings_path.read_text())
            return [
                hook["command"]
                for event in settings["hooks"].values()
                for matcher in event
                for hook in matcher["hooks"]
            ]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.fail(f"{settings_path} no tiene la forma esperada (hooks -> matchers -> hooks[].command): {exc!r}")

    def test_every_hook_script_is_executable_and_starts_with_a_shebang(self):
        scripts = self._hook_scripts()
        self.assertGreaterEqual(len(scripts), 10, scripts)
        for script in scripts:
            with self.subTest(script=script.name):
                self.assertTrue(os.access(script, os.X_OK), f"{script.name} lost its executable bit")
                self.assertTrue(script.read_text().startswith("#!/usr/bin/env python3"))

    def test_settings_wires_exactly_the_scripts_in_the_hooks_dir_by_path(self):
        # Un script sin cablear es código muerto; un comando sin archivo es un
        # hook que nunca dispara. Las dos listas tienen que ser la misma.
        wired = {PROJECT_ROOT / c.replace("$CLAUDE_PROJECT_DIR/", "") for c in self._wired_commands()}
        self.assertEqual(wired, set(self._hook_scripts()))


class StopAuditsTests(unittest.TestCase):
    """Las auditorías de stop.py listan y abren archivos relativos a PROJECT_ROOT,
    sea cual sea el cwd del proceso. Antes `ls-files` corría en el cwd: desde un
    subdirectorio ningún path empezaba con `apps/` y ambas pasaban sin mirar."""

    def test_untracked_source_without_header_or_test_is_reported_from_a_subdirectory_cwd(self):
        import stop

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _init(root, "workstream/x")
            source = root / "apps" / "api" / "src" / "auth" / "thing.ts"
            source.parent.mkdir(parents=True)
            source.write_text("export const thing = 1;\n")
            previous = os.getcwd()
            os.chdir(source.parent)
            self.addCleanup(os.chdir, previous)
            with mock.patch.object(stop, "PROJECT_ROOT", root):
                self.assertEqual(stop.get_new_files([".ts"]), ["apps/api/src/auth/thing.ts"])
                headers = stop.audit_missing_headers()
                tests = stop.audit_missing_tests()
        self.assertTrue(any("apps/api/src/auth/thing.ts" in issue for issue in headers), headers)
        self.assertTrue(any("apps/api/src/auth/thing.ts" in issue for issue in tests), tests)


class DetachedHeadDownstreamTests(unittest.TestCase):
    """`current_branch` devuelve '' en HEAD suelto (antes: 'HEAD'). Para los dos
    consumidores da lo mismo que cualquier otro nombre que no sea workstream/*:
    el gate de commits bloquea y el guard de plan-mode no aplica."""

    def test_commit_gate_blocks_on_detached_head(self):
        import pre_bash

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(_common, "LOG_PATH", Path(tmp) / "hooks.log"), \
                mock.patch.object(pre_bash, "current_branch", return_value=""), \
                contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as blocked:
                pre_bash.gate_commit_only_in_allowed_branch("git commit -m x")
            self.assertEqual(blocked.exception.code, 2)
            with mock.patch.object(pre_bash, "current_branch", return_value="workstream/x"):
                pre_bash.gate_commit_only_in_allowed_branch("git commit -m x")

    def test_planmode_guard_treats_detached_head_as_not_a_workstream_branch(self):
        import pre_edit_planmode_guard as guard

        self.assertIsNone(guard.WORKSTREAM_BRANCH_RE.match(""))
        self.assertIsNone(guard.WORKSTREAM_BRANCH_RE.match("HEAD"))
        self.assertIsNotNone(guard.WORKSTREAM_BRANCH_RE.match("workstream/x"))


if __name__ == "__main__":
    unittest.main()
