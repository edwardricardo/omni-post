"""Tests del hook de prompt: la forma del contexto que inyecta."""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import user_prompt_submit as ups  # noqa: E402


def _fake_git(args: list[str], default: str = "") -> str:
    # `status --porcelain`: un unstaged y un untracked; `rev-list`: "<behind>\t<ahead>".
    return {"status": " M a.ts\n?? b.ts", "rev-list": "2\t1"}.get(args[1], default)


class BuildContextShapeTests(unittest.TestCase):
    """`build_context` corre sobre git patcheado: lo que se afirma es qué campo
    lleva cada línea, no el estado del repo donde corre el test."""

    def test_context_carries_branch_status_canon_index_and_no_plan_line(self):
        with mock.patch.object(ups, "current_branch", return_value="workstream/x"), \
                mock.patch.object(ups, "run", side_effect=_fake_git):
            lines = ups.build_context("hola").split("\n")
        self.assertIn("branch: workstream/x", lines)
        self.assertIn("uncommitted: 0 staged, 1 unstaged, 1 untracked", lines)
        self.assertIn("ahead/behind: 1/2", lines)
        self.assertTrue(any(line.startswith("canon_index") for line in lines), lines)
        # El candidato muerto `.claude/current-batch-plan.md` se fue; el plan
        # activo real (desde el transcript) llega en su propio cambio.
        self.assertFalse(any(line.startswith("active_plan") for line in lines), lines)

    def test_detached_head_or_no_repository_is_named_not_blank(self):
        with mock.patch.object(ups, "current_branch", return_value=""), \
                mock.patch.object(ups, "run", return_value=""):
            lines = ups.build_context("hola").split("\n")
        self.assertIn("branch: (no branch)", lines)
        self.assertIn("ahead/behind: n/a", lines)


class FindFilesInPromptTests(unittest.TestCase):
    """Las rutas del prompt se resuelven contra PROJECT_ROOT, no contra el cwd
    del proceso del hook: la sesión puede arrancar en un subdirectorio."""

    def test_relative_paths_resolve_against_the_project_root_from_any_cwd(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        root = tmp / "repo"
        (root / "apps").mkdir(parents=True)
        (root / "apps" / "x.ts").write_text("/**\n * @file x.ts\n * @layer infrastructure\n */\n")
        absolute = tmp / "outside.md"
        absolute.write_text("# doc\n")
        # Un cwd distinto de la raíz, con un señuelo que SOLO existe relativo a él.
        elsewhere = tmp / "elsewhere" / "apps"
        elsewhere.mkdir(parents=True)
        (elsewhere / "missing.ts").write_text("")
        previous = os.getcwd()
        os.chdir(elsewhere.parent)
        self.addCleanup(os.chdir, previous)
        with mock.patch.object(ups, "PROJECT_ROOT", root):
            out = ups.find_files_in_prompt(f"mirá apps/x.ts, {absolute} y apps/missing.ts")
        self.assertEqual(out, ["- apps/x.ts (existing, @layer infrastructure)", f"- {absolute} (existing)"])


class CanonIndexAgeLineTests(unittest.TestCase):
    """La línea `canon_index…` sale de la ruta que `canon_research_index_path()`
    devuelve al correr (el directorio de memoria), exista el índice o no."""

    def _context(self, index: Path) -> list[str]:
        with mock.patch.object(ups, "canon_research_index_path", return_value=index), \
                mock.patch.object(ups, "current_branch", return_value="workstream/x"), \
                mock.patch.object(ups, "run", return_value=""):
            return ups.build_context("hola").split("\n")

    def test_age_in_minutes_when_the_index_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = Path(tmp) / "canon_research_index.md"
            index.write_text("# canon\n")
            self.assertIn("canon_index_age: 0 min", self._context(index))

    def test_not_found_when_the_memory_dir_has_no_index(self):
        self.assertIn("canon_index: not found", self._context(Path("/nonexistent/canon_research_index.md")))


if __name__ == "__main__":
    unittest.main()
