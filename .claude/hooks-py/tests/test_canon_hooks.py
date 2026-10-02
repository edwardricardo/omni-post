"""Tests of the hooks that read canon-index.json: the path is resolved on every call."""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_edit_canon as canon  # noqa: E402
import pre_edit_decision_guard as guard  # noqa: E402


class LoadIndexResolvesThePathAtEachCallTests(unittest.TestCase):
    """`load_index` calls `canon_index_path()` when it runs, not on import: the
    path that held at import time does not stay bound to the process."""

    def _index(self, tmp: str, name: str, payload: dict) -> Path:
        path = Path(tmp) / name
        path.write_text(json.dumps(payload))
        return path

    def test_pre_edit_canon(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = self._index(tmp, "a.json", {"entries": {"a": {}}}), self._index(tmp, "b.json", {"entries": {"b": {}}})
            with mock.patch.object(canon, "canon_index_path", return_value=first):
                self.assertEqual(canon.load_index(), {"entries": {"a": {}}})
            with mock.patch.object(canon, "canon_index_path", return_value=second):
                self.assertEqual(canon.load_index(), {"entries": {"b": {}}})

    def test_pre_edit_decision_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = self._index(tmp, "a.json", {"entries": {"a": {}}}), self._index(tmp, "b.json", {"entries": {"b": {}}})
            with mock.patch.object(guard, "canon_index_path", return_value=first):
                self.assertEqual(guard.load_index(decision_ids="p"), {"entries": {"a": {}}})
            with mock.patch.object(guard, "canon_index_path", return_value=second):
                self.assertEqual(guard.load_index(decision_ids="p"), {"entries": {"b": {}}})


class NonObjectIndexIsUnreadableTests(unittest.TestCase):
    """An index that is valid JSON but not an object (`[]`, `null`) is reported as
    UNREADABLE and the hook exits 0 — never an AttributeError while reading it."""

    def _run(self, module, call, document: str = "[]"):
        with tempfile.TemporaryDirectory() as tmp:
            index = Path(tmp) / "canon-index.json"
            index.write_text(document)
            out = io.StringIO()
            with mock.patch.object(module, "canon_index_path", return_value=index), \
                    mock.patch.object(module, "log"), \
                    contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
                call()
            self.assertEqual(raised.exception.code, 0)
            return json.loads(out.getvalue())["hookSpecificOutput"]["additionalContext"]

    def test_pre_edit_canon(self):
        self.assertIn("canon-index.json UNREADABLE", self._run(canon, lambda: canon.load_index()))

    def test_pre_edit_decision_guard(self):
        self.assertIn("canon-index.json UNREADABLE", self._run(guard, lambda: guard.load_index(decision_ids="p")))

    def test_an_object_without_entries_is_unreadable_too(self):
        self.assertIn("object without entries", self._run(canon, lambda: canon.load_index(), document="{}"))
        self.assertIn("object without entries", self._run(guard, lambda: guard.load_index(decision_ids="p"), document="{}"))

    def test_an_empty_entries_object_is_a_readable_empty_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            index = Path(tmp) / "canon-index.json"
            index.write_text('{"entries": {}}')
            with mock.patch.object(canon, "canon_index_path", return_value=index):
                self.assertEqual(canon.load_index(), {"entries": {}})
            with mock.patch.object(guard, "canon_index_path", return_value=index):
                self.assertEqual(guard.load_index(decision_ids="p"), {"entries": {}})


class PreEditCanonStalenessTests(unittest.TestCase):
    """The STALE CANON line of `pre_edit_canon` comes from the same reason as
    the prompt line: a source newer than the synthesis, a dead pattern, or a
    missing `synthesizedAt`. An old index from an unchanged source warns nothing."""

    def _warning(self, index: dict, source_offset: float = -3600.0) -> str | None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "canon_research_index.md"
            source.write_text("# canon\n")
            synthesized = index.get("synthesizedAt")
            base = datetime.fromisoformat(synthesized).timestamp() if synthesized else 0.0
            os.utime(source, (base + source_offset, base + source_offset))
            with mock.patch.object(canon, "canon_index_path", return_value=Path(tmp) / "canon-index.json"), \
                    mock.patch.object(canon, "canon_research_index_path", return_value=source):
                return canon.staleness_warning(index)

    def _index(self, synthesized: str | None = "2020-01-01T00:00:00+00:00", applies_to: tuple[str, ...] = (".claude/hooks-py/",)) -> dict:
        index: dict = {"entries": {"e": {"key": "e", "appliesTo": list(applies_to)}}}
        if synthesized is not None:
            index["synthesizedAt"] = synthesized
        return index

    def test_age_alone_is_not_a_warning(self):
        self.assertIsNone(self._warning(self._index()))

    def test_a_source_newer_than_the_synthesis_warns(self):
        self.assertIn("modified after synthesizedAt", self._warning(self._index(), source_offset=3600.0) or "")

    def test_a_dead_pattern_warns_and_is_named(self):
        warning = self._warning(self._index(applies_to=(".claude/hooks-py/", "apps/zz-no-such-dir-fixture/"))) or ""
        self.assertTrue(warning.startswith("[STALE CANON: "), warning)
        self.assertIn("apps/zz-no-such-dir-fixture/", warning)

    def test_missing_synthesized_at_warns(self):
        self.assertIn("synthesizedAt missing", self._warning(self._index(synthesized=None)) or "")


class DecisionGuardWithoutIndexTests(unittest.TestCase):
    """End to end through `main()`: with a decision pattern in the diff and no
    index, the guard reports the blindness and does NOT emit a DECISION GAP — a
    gap emitted without an index is false, since there is nothing to compare."""

    def _run_main(self, tmp: str, index_document: str | None, notices: Path | None = None) -> str:
        index = Path(tmp) / "canon-index.json"
        if index_document is not None:
            index.write_text(index_document)
        elif index.exists():
            index.unlink()
        payload = {
            "tool_name": "Edit",
            "tool_input": {"file_path": "apps/api/src/auth/token.ts", "old_string": "", "new_string": "jwt.sign(payload, key)"},
            "session_id": "s-e2e",
        }
        out = io.StringIO()
        with mock.patch.object(guard, "canon_index_path", return_value=index), \
                mock.patch.object(guard, "log"), \
                mock.patch.object(guard, "DECISION_GAPS_LOG", Path(tmp) / "gaps.log"), \
                mock.patch.object(_common, "NOTICES_LOG", notices or Path(tmp) / "notices.log"), \
                mock.patch.dict(os.environ, {"EDWARD_AUTHORIZED_HEURISTIC": ""}), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps(payload))), \
                contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as raised:
            guard.main()
        self.assertEqual(raised.exception.code, 0)
        return out.getvalue()

    def test_missing_index_reports_blindness_not_a_gap(self):
        with tempfile.TemporaryDirectory() as tmp:
            context = json.loads(self._run_main(tmp, None))["hookSpecificOutput"]["additionalContext"]
        self.assertIn("canon-index.json MISSING", context)
        self.assertIn("jwt-algorithm", context)
        self.assertNotIn("DECISION GAP", context)

    def test_the_session_told_blind_is_told_recovered_with_the_gap(self):
        # Same session: first without an index (MISSING), then with a readable one —
        # the context carries RECOVERED before the gap, and only that once.
        with tempfile.TemporaryDirectory() as tmp:
            notices = Path(tmp) / "notices.log"
            self.assertIn("canon-index.json MISSING", json.loads(self._run_main(tmp, None, notices))["hookSpecificOutput"]["additionalContext"])
            context = json.loads(self._run_main(tmp, '{"entries": {}}', notices))["hookSpecificOutput"]["additionalContext"]
            self.assertTrue(context.startswith("[canon] canon-index.json RECOVERED at "), context)
            self.assertIn("DECISION GAP", context)
            again = json.loads(self._run_main(tmp, '{"entries": {}}', notices))["hookSpecificOutput"]["additionalContext"]
            self.assertNotIn("RECOVERED", again)

    def test_an_index_that_covers_nothing_still_emits_the_gap(self):
        # Positive control: the same input, with a readable empty index, is a gap.
        with tempfile.TemporaryDirectory() as tmp:
            context = json.loads(self._run_main(tmp, '{"entries": {}}'))["hookSpecificOutput"]["additionalContext"]
        self.assertIn("DECISION GAP", context)
        self.assertIn("jwt-algorithm", context)


if __name__ == "__main__":
    unittest.main()
