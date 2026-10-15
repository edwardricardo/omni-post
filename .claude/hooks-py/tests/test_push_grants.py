"""Tests of the grant store: windows, pruning, the legacy shape and the push
gate that reads them.

Every test points `_common.ALLOWED_TOKENS_DIR` and `_common.LOG_PATH` at a
temporary directory and freezes `_common.now_utc`: none reads or writes the
real `.claude/.allowed/`, and none sleeps across a window boundary.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_bash  # noqa: E402
import pre_edit  # noqa: E402

T0 = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)
PUSH = "cd /wt && git push origin workstream/a"


class _Clock:
    """A frozen `now_utc`, moved by the test."""

    def __init__(self) -> None:
        self.moment = T0

    def __call__(self) -> datetime:
        return self.moment

    def at(self, **delta: float) -> None:
        self.moment = T0 + timedelta(**delta)


class _GrantStoreCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.store = self.root / ".claude" / ".allowed"
        self.clock = _Clock()
        self.lines: list[str] = []
        for patch in (
            mock.patch.object(_common, "ALLOWED_TOKENS_DIR", self.store),
            mock.patch.object(_common, "LOG_PATH", self.root / "hooks.log"),
            mock.patch.object(_common, "now_utc", self.clock),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def log(self, message: str) -> None:
        self.lines.append(message)

    def issue(self, operation: str = "push", count: int = 1, ttl: int = 60) -> list[_common.Grant]:
        return _common.add_grants(operation, count, ttl, self.log).created

    def grants(self, operation: str = "push") -> list[dict]:
        return json.loads((self.store / operation).read_text(encoding="utf-8"))["grants"]

    def windows(self, operation: str = "push") -> list[tuple[str, str]]:
        return [(grant["not_before"], grant["expires_at"]) for grant in self.grants(operation)]

    def write_file(self, operation: str, payload: object) -> None:
        self.store.mkdir(parents=True, exist_ok=True)
        text = payload if isinstance(payload, str) else json.dumps(payload)
        (self.store / operation).write_text(text, encoding="utf-8")

    def hooks_log(self) -> str:
        path = self.root / "hooks.log"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def _run(self, hook, payload: dict) -> tuple[str, str]:
        stderr = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(json.dumps(payload))), contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as raised:
                hook.main()
        code = raised.exception.code
        return ("allowed" if code in (0, None) else f"blocked({code})"), stderr.getvalue()

    def pre(self, command: str, cwd: Path | None = None) -> tuple[str, str]:
        return self._run(pre_bash, {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(cwd or self.root)})

    def edit(self, file_path: str, key: str = "file_path") -> tuple[str, str]:
        return self._run(pre_edit, {"tool_name": "Write", "tool_input": {key: file_path}})


def _iso(**delta: float) -> str:
    return (T0 + timedelta(**delta)).isoformat()


class GrantWindowsTests(_GrantStoreCase):
    """What `add_grants` writes: consecutive windows, appended after what is pending."""

    def test_three_windows_are_consecutive_from_the_moment_they_are_issued(self):
        created = self.issue(count=3, ttl=60)
        self.assertEqual(len(created), 3)
        self.assertEqual(
            self.windows(),
            [(_iso(), _iso(hours=1)), (_iso(hours=1), _iso(hours=2)), (_iso(hours=2), _iso(hours=3))],
        )
        for grant in self.grants():
            self.assertEqual(grant["created_at"], _iso())
            self.assertEqual(grant["ttl_minutes"], 60)
            self.assertNotIn("claimed_at", grant)
        self.assertEqual(len({grant["id"] for grant in self.grants()}), 3)
        self.assertEqual(json.loads((self.store / "push").read_text())["operation"], "push")

    def test_a_second_issue_appends_after_the_last_pending_window(self):
        self.issue(count=1, ttl=60)
        self.clock.at(minutes=10)
        self.issue(count=1, ttl=60)
        self.assertEqual(self.windows(), [(_iso(), _iso(hours=1)), (_iso(hours=1), _iso(hours=2))])

    def test_an_issue_after_every_window_is_over_starts_now(self):
        self.issue(count=1, ttl=60)
        self.clock.at(hours=2)
        self.issue(count=1, ttl=30)
        self.assertEqual(self.windows(), [(_iso(hours=2), _iso(hours=2, minutes=30))])

    def test_a_count_outside_one_to_the_cap_or_a_non_positive_ttl_is_refused_and_nothing_is_written(self):
        for count in (0, -1, _common.MAX_GRANTS_PER_CALL + 1):
            with self.subTest(count=count), self.assertRaises(ValueError):
                self.issue(count=count)
        with self.assertRaises(ValueError):
            self.issue(ttl=0)
        self.assertFalse((self.store / "push").exists())
        self.assertEqual(len(self.issue(count=_common.MAX_GRANTS_PER_CALL)), 12)

    def test_a_window_that_has_not_started_allows_nothing_yet(self):
        self.write_file("push", {"operation": "push", "grants": [{"id": "g", "not_before": _iso(hours=1), "expires_at": _iso(hours=2)}]})
        self.assertEqual(_common.check_grant_token("push", self.log), "not-yet-open")

    def test_a_legacy_single_window_file_is_read_as_one_grant(self):
        self.write_file("push", {"operation": "push", "created_at": _iso(minutes=-5), "expires_at": _iso(minutes=10), "ttl_minutes": 15})
        check = _common.inspect_grants("push", self.log)
        self.assertIsNone(check.reason)
        self.assertEqual((check.grant.id, check.grant.not_before, check.grant.expires_at), ("legacy", T0 - timedelta(minutes=5), T0 + timedelta(minutes=10)))

    def test_a_legacy_file_without_created_at_is_open_from_now_until_it_expires(self):
        self.write_file("push", {"operation": "push", "expires_at": _iso(minutes=10)})
        self.assertIsNone(_common.check_grant_token("push", self.log))
        self.clock.at(minutes=10)
        self.assertEqual(_common.check_grant_token("push", self.log), "expired")
        self.assertFalse((self.store / "push").exists())

    def test_a_legacy_file_still_authorizes_a_push(self):
        self.write_file("push", {"operation": "push", "created_at": _iso(), "expires_at": _iso(minutes=15)})
        self.assertEqual(self.pre(PUSH)[0], "allowed")

    def test_a_corrupt_or_malformed_file_is_refused_not_ignored(self):
        cases = {
            "{": "corrupt",
            "[]": "malformed",
            "{}": "malformed",
            json.dumps({"grants": [{"id": "x"}]}): "malformed",
            json.dumps({"grants": [{"id": "x", "not_before": _iso(hours=1), "expires_at": _iso()}]}): "malformed",
            json.dumps({"grants": "nope"}): "malformed",
        }
        for text, reason in cases.items():
            with self.subTest(text=text):
                self.write_file("push", text)
                self.assertEqual(_common.check_grant_token("push", self.log), reason)
                self.assertTrue((self.store / "push").exists(), "an unreadable file is left for the owner to inspect")


class PruningTests(_GrantStoreCase):
    def test_expired_grants_are_pruned_on_every_read_and_the_empty_file_deleted(self):
        first, second = self.issue(count=2, ttl=60)
        self.clock.at(minutes=61)
        self.assertIsNone(_common.check_grant_token("push", self.log))
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id])
        self.assertTrue(any(f"grant push/{first.id} pruned" in line for line in self.lines))
        self.clock.at(hours=2)
        self.assertEqual(_common.check_grant_token("push", self.log), "expired")
        self.assertFalse((self.store / "push").exists())
        self.assertEqual(_common.check_grant_token("push", self.log), "missing")

    def test_a_file_with_no_grant_is_deleted(self):
        self.write_file("push", {"operation": "push", "grants": []})
        self.assertEqual(_common.check_grant_token("push", self.log), "missing")
        self.assertFalse((self.store / "push").exists())


class SensitiveEditGrantTests(_GrantStoreCase):
    def test_a_sensitive_edit_window_is_valid_for_its_whole_length_and_never_consumed(self):
        self.issue("sensitive-edit", count=1, ttl=15)
        before = (self.store / "sensitive-edit").read_text()
        for minute in (0, 7, 14):
            self.clock.at(minutes=minute)
            self.assertIsNone(_common.check_grant_token("sensitive-edit", self.log))
        self.clock.at(minutes=14, seconds=59)
        self.assertEqual(self.edit(str(self.root / ".claude" / "hooks-py" / "x.py"))[0], "allowed")
        self.assertEqual((self.store / "sensitive-edit").read_text(), before, "using it consumes nothing")
        self.clock.at(minutes=15)
        self.assertEqual(_common.check_grant_token("sensitive-edit", self.log), "expired")

    def test_consecutive_sensitive_edit_windows_cover_their_whole_span(self):
        self.issue("sensitive-edit", count=2, ttl=15)
        self.clock.at(minutes=20)
        self.assertIsNone(_common.check_grant_token("sensitive-edit", self.log))


if __name__ == "__main__":
    unittest.main()
