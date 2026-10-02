"""Tests of the prompt hook: active plan from the transcript, `git status`
counts, and the canon index status line."""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime
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

    def test_context_carries_branch_status_canon_index_and_the_plan_line(self):
        with mock.patch.object(ups, "current_branch", return_value="workstream/x"), \
                mock.patch.object(ups, "run", side_effect=_fake_git):
            lines = ups.build_context("hola", "").split("\n")
        self.assertIn("branch: workstream/x", lines)
        self.assertIn("uncommitted: 0 staged, 1 unstaged, 1 untracked", lines)
        self.assertIn("ahead/behind: 1/2", lines)
        self.assertTrue(any(line.startswith("canon_index") for line in lines), lines)
        self.assertIn("active_plan: none", lines)

    def test_detached_head_or_no_repository_is_named_not_blank(self):
        with mock.patch.object(ups, "current_branch", return_value=""), \
                mock.patch.object(ups, "run", return_value=""):
            lines = ups.build_context("hola", "").split("\n")
        self.assertIn("branch: (no branch)", lines)
        self.assertIn("ahead/behind: n/a", lines)


class FindActivePlanTests(unittest.TestCase):
    def _transcript(self, tmp: Path, *paths: str) -> Path:
        t = tmp / "t.jsonl"
        t.write_text("".join('{"tool_input": {"file_path": "%s"}}\n' % p for p in paths))
        return t

    def test_last_plan_referenced_in_the_transcript_wins(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            (tmp / ".claude" / "plans").mkdir(parents=True)
            a, b = tmp / ".claude" / "plans" / "a.md", tmp / ".claude" / "plans" / "b.md"
            a.write_text("a")
            b.write_text("b")
            self.assertEqual(ups.find_active_plan(str(self._transcript(tmp, str(a), str(b)))), b)

    def test_plan_deleted_after_being_referenced_is_not_active(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            gone = tmp / ".claude" / "plans" / "gone.md"
            self.assertIsNone(ups.find_active_plan(str(self._transcript(tmp, str(gone)))))

    def test_no_transcript_means_no_plan(self):
        self.assertIsNone(ups.find_active_plan(""))
        self.assertIsNone(ups.find_active_plan("/nonexistent/transcript.jsonl"))


class RunKeepsPorcelainColumnsTests(unittest.TestCase):
    def test_leading_space_of_the_first_line_survives(self):
        # ` M file` = sin stagear; strip() se comía esa columna y contaba 1 staged.
        self.assertEqual(ups.run(["printf", " M x\n"]), " M x")


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


LIVE_PATTERN = ".claude/hooks-py/"
DEAD_PATTERN = "apps/zz-no-such-dir-fixture/"
SYNTHESIZED = "2026-05-07T12:00:00+00:00"
SYNTHESIZED_EPOCH = datetime.fromisoformat(SYNTHESIZED).timestamp()


def _write_index(tmp: Path, payload: object | None = None, *, applies_to: tuple[str, ...] = (LIVE_PATTERN,)) -> Path:
    if payload is None:
        payload = {"synthesizedAt": SYNTHESIZED, "entries": {"e": {"key": "e", "appliesTo": list(applies_to)}}}
    index = tmp / "canon-index.json"
    index.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    return index


def _write_source(tmp: Path, seconds_after_synthesis: float) -> Path:
    source = tmp / "canon_research_index.md"
    source.write_text("# canon\n")
    mtime = SYNTHESIZED_EPOCH + seconds_after_synthesis
    os.utime(source, (mtime, mtime))
    return source


class CanonIndexLineTests(unittest.TestCase):
    """The prompt's `canon_index…` line: `current` with entries and date, or
    `STALE — <reason>` when the index does not reflect its source or the tree,
    or `MISSING <path>`. Age alone is not a reason."""

    def _context_through_main(self, index: Path, source: Path) -> list[str]:
        out = io.StringIO()
        with mock.patch.object(ups, "canon_index_path", return_value=index), \
                mock.patch.object(ups, "canon_research_index_path", return_value=source), \
                mock.patch.object(ups, "current_branch", return_value="workstream/x"), \
                mock.patch.object(ups, "run", return_value=""), \
                mock.patch.object(ups, "log"), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps({"prompt": "hello"}))), \
                contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            ups.main()
        self.assertEqual(raised.exception.code, 0)
        return json.loads(out.getvalue())["hookSpecificOutput"]["additionalContext"].split("\n")

    def _canon_line(self, index: Path, source: Path) -> str:
        return next(line for line in self._context_through_main(index, source) if line.startswith("canon_index"))

    def test_a_current_index_reports_its_entries_and_synthesis_date(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            line = self._canon_line(_write_index(tmp), _write_source(tmp, -3600))
        self.assertEqual(line, "canon_index: current (1 entries, synthesized 2026-05-07)")

    def test_an_old_index_from_an_unchanged_source_is_current_not_stale(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            index = _write_index(tmp, {"synthesizedAt": "2020-01-01T00:00:00+00:00", "entries": {}})
            source = tmp / "canon_research_index.md"
            source.write_text("# canon\n")
            os.utime(source, (0, 0))
            line = self._canon_line(index, source)
        self.assertTrue(line.startswith("canon_index: current"), line)

    def test_an_index_older_than_its_markdown_is_stale(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            line = self._canon_line(_write_index(tmp), _write_source(tmp, 3600))
        self.assertTrue(line.startswith("canon_index: STALE — "), line)
        self.assertIn("modified after synthesizedAt", line)

    def test_a_dead_pattern_in_an_otherwise_current_index_is_stale_and_named(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            line = self._canon_line(_write_index(tmp, applies_to=(LIVE_PATTERN, DEAD_PATTERN)), _write_source(tmp, -3600))
        self.assertTrue(line.startswith("canon_index: STALE — "), line)
        self.assertIn(DEAD_PATTERN, line)
        self.assertIn("1 dead appliesTo", line)

    def test_missing_or_unparseable_synthesized_at_is_stale(self):
        for payload, expected in (
            ({"entries": {}}, "synthesizedAt missing"),
            ({"synthesizedAt": "not-a-date", "entries": {}}, "synthesizedAt unparseable"),
        ):
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as d:
                tmp = Path(d)
                line = self._canon_line(_write_index(tmp, payload), _write_source(tmp, -3600))
                self.assertTrue(line.startswith("canon_index: STALE — "), line)
                self.assertIn(expected, line)

    def test_unreadable_json_is_stale_and_names_the_error_class(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            line = self._canon_line(_write_index(tmp, "{not json"), _write_source(tmp, -3600))
        self.assertTrue(line.startswith("canon_index: STALE — "), line)
        self.assertIn("JSONDecodeError", line)

    def test_an_unexpected_failure_is_named_in_the_line_not_silenced(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            index, source = _write_index(tmp), _write_source(tmp, -3600)
            with mock.patch.object(ups, "canon_index_staleness", side_effect=RuntimeError("boom")):
                line = self._canon_line(index, source)
        self.assertEqual(line, "canon_index: STALE — status check failed (RuntimeError)")

    def test_missing_index_or_source_is_reported_with_its_path(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            source = _write_source(tmp, -3600)
            self.assertEqual(self._canon_line(tmp / "absent.json", source), f"canon_index: MISSING {tmp / 'absent.json'}")
            self.assertEqual(self._canon_line(_write_index(tmp), tmp / "absent.md"), f"canon_index: MISSING {tmp / 'absent.md'}")


if __name__ == "__main__":
    unittest.main()
