"""Tests de `_common`: lo que los hooks comparten.

stdlib solamente (`python3 -m unittest discover -s .claude/hooks-py/tests
-t .claude/hooks-py`): los hooks no tienen runner propio. Contratos cubiertos:
qué branch lee un gate (`current_branch`) y el repo de cada `git commit`
(`commit_repos`, `git_invocations`); dónde vive la memoria y desde qué raíz
se deriva (`memory_dir`, las rutas de los índices); la forma única de la línea
de hooks.log; el aviso de archivo ausente, su deduplicación por sesión y el
aviso de recuperación; qué hook es ejecutable y está cableado; y qué ve
stop.py desde un subdirectorio.
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
    commit_repos,
    current_branch,
    emit_missing_file_context,
    git_invocations,
    git_subcommands,
    memory_dir,
    notice_already_sent,
    notice_seen,
    recovered_file_notice,
)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _init(repo: Path, branch: str) -> None:
    # `git init -b` pide git 2.28; `symbolic-ref` sobre el HEAD aún sin commits
    # deja la misma rama en cualquier git.
    _git(repo, "init", "-q")
    _git(repo, "symbolic-ref", "HEAD", f"refs/heads/{branch}")


def _commit(repo: Path) -> None:
    # Un commit vacío con identidad fija: `git worktree add` y `checkout --detach`
    # necesitan al menos uno, y la identidad no debe depender del config global.
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x")


FALLBACK = Path("/session/cwd")


class CommitReposTests(unittest.TestCase):
    def test_leading_cd_with_and(self):
        self.assertEqual(commit_repos("cd /wt && git commit -m x", FALLBACK), [Path("/wt")])

    def test_leading_cd_with_newline(self):
        self.assertEqual(commit_repos("cd /wt\ngit commit -m x", FALLBACK), [Path("/wt")])

    def test_leading_cd_with_semicolon(self):
        self.assertEqual(commit_repos("cd /wt; git commit -m x", FALLBACK), [Path("/wt")])

    def test_quoted_path_with_spaces(self):
        self.assertEqual(commit_repos('cd "/w t" && git commit', FALLBACK), [Path("/w t")])

    def test_relative_cd_resolves_against_fallback(self):
        self.assertEqual(commit_repos("cd apps/api && git commit", FALLBACK), [FALLBACK / "apps/api"])

    def test_git_dash_c_resolves_against_cd_base(self):
        self.assertEqual(commit_repos("cd /wt && git -C sub commit", FALLBACK), [Path("/wt/sub")])

    def test_git_work_tree_resolves_like_dash_c(self):
        self.assertEqual(commit_repos("git --work-tree /wt commit", FALLBACK), [Path("/wt")])

    def test_repeated_dash_c_compose_in_order(self):
        self.assertEqual(commit_repos("git -C /a -C b commit", FALLBACK), [Path("/a/b")])

    def test_no_cd_no_dash_c_returns_fallback(self):
        self.assertEqual(commit_repos("git commit -m x", FALLBACK), [FALLBACK])

    def test_cd_not_at_start_is_ignored(self):
        self.assertEqual(commit_repos("echo hi && cd /wt && git commit", FALLBACK), [FALLBACK])

    def test_dash_c_of_another_invocation_does_not_move_the_commit(self):
        # Un `git -C /otro status` antes de un `git commit` sin -C commitea en el
        # cwd de la sesión; leer /otro era un fail-open.
        self.assertEqual(commit_repos("git -C /other status && git commit -m x", FALLBACK), [FALLBACK])

    def test_each_commit_has_its_own_repo(self):
        self.assertEqual(commit_repos("git -C /x commit -m a && git commit -m b", FALLBACK), [Path("/x"), FALLBACK])

    def test_dash_c_inside_a_quoted_argument_is_text(self):
        self.assertEqual(commit_repos('git log --grep="git -C /tmp" && git commit', FALLBACK), [FALLBACK])

    def test_no_commit_means_no_repo_to_check(self):
        self.assertEqual(commit_repos("git -C /x status", FALLBACK), [])

    def test_untokenizable_command_falls_back_to_the_base(self):
        self.assertEqual(commit_repos("cd /wt && git commit -m 'unclosed", FALLBACK), [Path("/wt")])


class GitSubcommandsTests(unittest.TestCase):
    def test_plain_commit(self):
        self.assertIn("commit", git_subcommands("git commit -m x"))

    def test_dash_c_path_before_subcommand(self):
        self.assertIn("commit", git_subcommands("git -C /wt commit -m x"))

    def test_work_tree_value_before_subcommand(self):
        self.assertIn("commit", git_subcommands("git --work-tree /wt commit -m x"))

    def test_config_with_quoted_value(self):
        self.assertIn("commit", git_subcommands('git -c "user.name=Foo Bar" commit -m x'))

    def test_log_grep_commit_is_not_a_commit(self):
        self.assertEqual(git_subcommands("git log --grep commit"), {"log"})

    def test_git_inside_a_string_does_not_count(self):
        self.assertEqual(git_subcommands('echo "git commit"'), set())

    def test_several_invocations(self):
        self.assertEqual(git_subcommands("cd /wt && git fetch && git commit -m x"), {"fetch", "commit"})

    def test_glued_separator_does_not_hide_the_subcommand(self):
        self.assertEqual(git_subcommands("git commit&&git fetch"), {"commit", "fetch"})
        self.assertEqual(git_subcommands("git commit -m x;git fetch"), {"commit", "fetch"})

    def test_separator_inside_a_quoted_value_is_still_a_value(self):
        self.assertEqual(git_subcommands('git -c "k=a;b" commit'), {"commit"})
        self.assertEqual(git_subcommands('git commit -m "a && b"'), {"commit"})

    def test_invocations_carry_their_own_trees(self):
        self.assertEqual(git_invocations("git -C /a status && git --work-tree /b commit"), [("status", ["/a"]), ("commit", ["/b"])])

    def test_unparseable_falls_back_to_conservative_match_and_leaves_a_trace(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(_common, "LOG_PATH", Path(tmp) / "hooks.log"):
            self.assertEqual(git_subcommands("git commit -m 'unclosed"), {"commit"})
            self.assertEqual(git_subcommands("echo 'unclosed"), set())
            self.assertEqual((Path(tmp) / "hooks.log").read_text(encoding="utf-8").count("respaldo solo-commit"), 2)


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
        _commit(main_root)
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
        # Las tres fallas que el resolvedor atrapa: sin git, git fuera de un
        # repo (exit 128) y git colgado; cada una cae al respaldo, no lo
        # memoriza y lo anota UNA vez.
        failures = [
            OSError("no git"),
            subprocess.CalledProcessError(128, ["git", "rev-parse"]),
            subprocess.TimeoutExpired(["git", "rev-parse"], 2),
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as tmp:
                _common._MEMORY_DIR_CACHE = None
                _common._MEMORY_DIR_WARNED = False
                fake_root = Path(tmp) / "repo"
                fake_root.mkdir()
                with mock.patch.object(_common, "PROJECT_ROOT", fake_root), mock.patch.object(
                    _common, "LOG_PATH", Path(tmp) / "hooks.log"
                ), mock.patch.object(_common.subprocess, "run", side_effect=failure):
                    fallback = Path.home() / ".claude" / "projects" / str(fake_root.resolve()).replace("/", "-") / "memory"
                    self.assertEqual(memory_dir(), fallback)
                    self.assertEqual(memory_dir(), fallback)
                    self.assertIsNone(_common._MEMORY_DIR_CACHE)
                    self.assertEqual((Path(tmp) / "hooks.log").read_text().count(_common.MEMORY_DIR_FALLBACK_NOTE), 1)

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


class EmitAdditionalContextTests(unittest.TestCase):
    def _emit(self, body: str, prefix: tuple[str, ...] = ()) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            _common.emit_additional_context("PreToolUse", body, prefix)
        self.assertEqual(raised.exception.code, 0)
        return out.getvalue()

    def test_nothing_to_say_prints_nothing(self):
        self.assertEqual(self._emit(""), "")

    def test_prefix_lines_come_first_separated_by_a_blank_line(self):
        payload = json.loads(self._emit("body", ("[canon] x RECOVERED at /p",)))
        self.assertEqual(payload["hookSpecificOutput"]["additionalContext"], "[canon] x RECOVERED at /p\n\nbody")
        self.assertEqual(json.loads(self._emit("", ("only prefix",)))["hookSpecificOutput"]["additionalContext"], "only prefix")


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
            _commit(repo)
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
                pre_bash.gate_commit_only_in_allowed_branch("git commit -m x", Path("/session"))
            self.assertEqual(blocked.exception.code, 2)
            with mock.patch.object(pre_bash, "current_branch", return_value="workstream/x"):
                pre_bash.gate_commit_only_in_allowed_branch("git commit -m x", Path("/session"))

    def test_each_distinct_repo_is_probed_once(self):
        import pre_bash

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(_common, "LOG_PATH", Path(tmp) / "hooks.log"), \
                mock.patch.object(pre_bash, "current_branch", return_value="workstream/x") as probe:
            pre_bash.gate_commit_only_in_allowed_branch("git commit -m a && git commit -m b", Path("/session"))
            self.assertEqual(probe.call_count, 1)
            pre_bash.gate_commit_only_in_allowed_branch("git -C /x commit -m a && git commit -m b", Path("/session"))
            self.assertEqual(probe.call_count, 3)
            self.assertIn("commit gate: /session -> branch 'workstream/x'", (Path(tmp) / "hooks.log").read_text(encoding="utf-8"))

    def test_planmode_guard_treats_detached_head_as_not_a_workstream_branch(self):
        import pre_edit_planmode_guard as guard

        self.assertIsNone(guard.WORKSTREAM_BRANCH_RE.match(""))
        self.assertIsNone(guard.WORKSTREAM_BRANCH_RE.match("HEAD"))
        self.assertIsNotNone(guard.WORKSTREAM_BRANCH_RE.match("workstream/x"))


class MissingFileContextTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._patch = mock.patch.object(_common, "NOTICES_LOG", Path(self._tmp.name) / "notices.log")
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._tmp.cleanup()

    def _emit(self, session_id: str) -> str:
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            emit_missing_file_context("canon", "canon-index.json", Path("/x/canon-index.json"), "blind", hook_event="PreToolUse", session_id=session_id)
        self.assertEqual(raised.exception.code, 0)
        return out.getvalue()

    def test_emits_one_additional_context_line_and_exits_zero(self):
        payload = json.loads(self._emit(""))
        self.assertEqual(payload["hookSpecificOutput"]["hookEventName"], "PreToolUse")
        self.assertEqual(
            payload["hookSpecificOutput"]["additionalContext"],
            "[canon] canon-index.json MISSING at /x/canon-index.json — blind",
        )

    def test_second_notice_in_the_same_session_is_silent(self):
        self.assertTrue(self._emit("s1"))
        self.assertEqual(self._emit("s1"), "")
        self.assertTrue(self._emit("s2"))

    def test_without_session_id_every_notice_is_sent(self):
        self.assertFalse(notice_already_sent("", "k"))
        self.assertFalse(notice_already_sent("", "k"))

    def test_a_tab_inside_an_identifier_cannot_split_the_marker(self):
        # Sin escape, ("s\t1", "k") y ("s", "1\tk") escribirían el MISMO marcador.
        self.assertFalse(notice_already_sent("s\t1", "k"))
        self.assertTrue(notice_already_sent("s\t1", "k"))
        self.assertTrue(notice_seen("s\t1", "k"))
        self.assertFalse(notice_seen("s", "1\tk"))
        self.assertFalse(notice_already_sent("s", "1\tk"))
        self.assertTrue(notice_already_sent("s", "1\tk"))
        # Un salto de línea partiría el REGISTRO: también se escapa.
        self.assertFalse(notice_already_sent("s\n1", "k"))
        self.assertTrue(notice_already_sent("s\n1", "k"))
        self.assertEqual(len(_common.NOTICES_LOG.read_text(encoding="utf-8").splitlines()), 1)

    def test_recovery_is_announced_once_after_a_failure_notice_in_the_session(self):
        path = Path("/x/canon-index.json")
        self.assertIsNone(recovered_file_notice("canon", "canon-index.json", path, "s1"))
        self.assertTrue(self._emit("s1"))
        self.assertEqual(recovered_file_notice("canon", "canon-index.json", path, "s1"), "[canon] canon-index.json RECOVERED at /x/canon-index.json")
        self.assertIsNone(recovered_file_notice("canon", "canon-index.json", path, "s1"))
        self.assertIsNone(recovered_file_notice("canon", "canon-index.json", path, "s2"))

    def test_other_sessions_are_pruned_when_a_new_session_records(self):
        self.assertTrue(self._emit("s1"))
        self.assertTrue(self._emit("s2"))
        lines = _common.NOTICES_LOG.read_text(encoding="utf-8").splitlines()
        self.assertEqual([line.split("\t")[0] for line in lines], ["s2"])

    def test_lookup_and_record_happen_under_an_exclusive_lock(self):
        with mock.patch.object(_common.fcntl, "flock") as flock:
            self.assertFalse(notice_already_sent("s1", "k"))
        flock.assert_called_once()
        self.assertEqual(flock.call_args.args[1], _common.fcntl.LOCK_EX)

    def test_unwritable_log_still_sends_every_notice_and_leaves_a_trace(self):
        # El padre del log es un ARCHIVO: mkdir y open fallan con OSError.
        blocker = Path(self._tmp.name) / "blocker"
        blocker.write_text("")
        with mock.patch.object(_common, "NOTICES_LOG", blocker / "notices.log"), \
                mock.patch.object(_common, "LOG_PATH", Path(self._tmp.name) / "hooks.log"):
            self.assertTrue(self._emit("s1"))
            self.assertTrue(self._emit("s1"))
            self.assertIn("sin deduplicar", (Path(self._tmp.name) / "hooks.log").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
