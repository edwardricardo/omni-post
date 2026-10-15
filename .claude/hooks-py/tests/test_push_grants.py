"""Tests of the grant store: push windows, their claim and consumption, the CLI
that issues them, and the owner-only blocks around the store and the CLI.

Every test points `_common.ALLOWED_TOKENS_DIR` and `_common.LOG_PATH` at a
temporary directory and freezes `_common.now_utc`: none reads or writes the
real `.claude/.allowed/`, and none sleeps across a window boundary.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""

import contextlib
import importlib.machinery
import importlib.util
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
import post_bash  # noqa: E402
import pre_bash  # noqa: E402
import pre_edit  # noqa: E402
from _common import format_local  # noqa: E402

CLI = Path(__file__).resolve().parents[2] / "bin" / "omnipost-allow"
T0 = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)
PUSH = "cd /wt && git push origin workstream/a"
OTHER_PUSH = "cd /wt && git push origin workstream/b"


def _load_cli():
    """The CLI has no `.py` suffix, so it needs an explicit source loader."""
    loader = importlib.machinery.SourceFileLoader("omnipost_allow_grants", str(CLI))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


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

    def post(self, command: str) -> None:
        self._run(post_bash, {"tool_name": "Bash", "tool_input": {"command": command}})

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


class PushGateTests(_GrantStoreCase):
    """pre-bash allows a push only while a window contains now."""

    def test_a_push_before_its_window_says_when_the_window_opens(self):
        self.write_file("push", {"operation": "push", "grants": [{"id": "g", "not_before": _iso(hours=1), "expires_at": _iso(hours=2)}]})
        verdict, message = self.pre(PUSH)
        self.assertEqual(verdict, "blocked(2)")
        self.assertIn(f"not yet open: the next window opens at {format_local(T0 + timedelta(hours=1))}", message)

    def test_a_push_after_every_window_is_over_is_blocked_and_the_file_deleted(self):
        self.issue(count=2, ttl=60)
        self.clock.at(hours=2, minutes=1)
        verdict, message = self.pre(PUSH)
        self.assertEqual(verdict, "blocked(2)")
        self.assertIn("expired", message)
        self.assertFalse((self.store / "push").exists())


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


class PushWindowTests(_GrantStoreCase):
    """pre-bash claims the grant of the open window; post-bash consumes exactly that grant."""

    def test_a_push_inside_window_1_is_allowed_and_claims_grant_1(self):
        first, _, _ = self.issue(count=3, ttl=60)
        self.clock.at(minutes=5)
        self.assertEqual(self.pre(PUSH)[0], "allowed")
        claimed = self.grants()[0]
        self.assertEqual(claimed["id"], first.id)
        self.assertEqual(claimed["claimed_at"], _iso(minutes=5))
        self.assertEqual(claimed["claim_fingerprint"], _common.command_fingerprint(PUSH))
        self.assertNotIn("claimed_at", self.grants()[1])

    def test_post_bash_consumes_only_the_claimed_grant(self):
        _, second, third = self.issue(count=3, ttl=60)
        self.clock.at(minutes=5)
        self.pre(PUSH)
        self.post(PUSH)
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id, third.id])
        self.assertIn("consumed (its claim", self.hooks_log())

    def test_using_window_1_early_leaves_window_2_closed_until_it_opens(self):
        self.issue(count=3, ttl=60)
        self.clock.at(minutes=5)
        self.pre(PUSH)
        self.post(PUSH)
        self.clock.at(minutes=10)
        verdict, message = self.pre(OTHER_PUSH)
        self.assertEqual(verdict, "blocked(2)")
        self.assertIn(format_local(T0 + timedelta(hours=1)), message)
        self.assertEqual(self.windows()[0], (_iso(hours=1), _iso(hours=2)), "window 2 keeps its own start")
        self.clock.at(minutes=60)
        self.assertEqual(self.pre(OTHER_PUSH)[0], "allowed")

    def test_a_push_that_ends_after_its_window_consumes_the_grant_that_authorized_it(self):
        first, second = self.issue(count=2, ttl=60)
        self.clock.at(minutes=59, seconds=59)
        self.assertEqual(self.pre(PUSH)[0], "allowed")
        self.clock.at(minutes=61)
        self.post(PUSH)
        remaining = self.grants()
        self.assertEqual([grant["id"] for grant in remaining], [second.id])
        self.assertNotIn("claimed_at", remaining[0])
        self.assertEqual(self.pre(OTHER_PUSH)[0], "allowed")

    def test_a_retry_after_a_failed_push_is_allowed_and_consumes_once(self):
        first, second = self.issue(count=2, ttl=60)
        self.clock.at(minutes=5)
        self.assertEqual(self.pre(PUSH)[0], "allowed")
        # The push failed: PostToolUse does not fire, so post-bash never runs.
        self.clock.at(minutes=6)
        self.assertEqual(self.pre(PUSH)[0], "allowed")
        self.post(PUSH)
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id])
        self.clock.at(minutes=7)
        self.assertEqual(self.pre(PUSH)[0], "blocked(2)")

    def test_a_retry_crossing_into_the_next_window_consumes_that_window_and_lets_the_old_claim_expire(self):
        first, second, third = self.issue(count=3, ttl=60)
        self.clock.at(minutes=59)
        self.pre(PUSH)  # claims grant 1; the push fails
        self.clock.at(minutes=62)
        self.pre(PUSH)  # the retry claims grant 2
        self.post(PUSH)
        self.assertEqual([grant["id"] for grant in self.grants()], [first.id, third.id])
        self.clock.at(minutes=70)
        self.assertEqual([grant["id"] for grant in self.grants()], [first.id, third.id])
        _common.inspect_grants("push", self.log)
        self.assertEqual([grant["id"] for grant in self.grants()], [third.id])

    def test_a_push_with_no_recorded_claim_consumes_the_grant_open_now(self):
        _, second = self.issue(count=2, ttl=60)
        self.clock.at(minutes=5)
        self.post(PUSH)
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id])

    def test_a_fingerprint_without_a_claim_time_is_no_claim(self):
        _, second = self.issue(count=2, ttl=60)
        payload = json.loads((self.store / "push").read_text())
        payload["grants"][1]["claim_fingerprint"] = _common.command_fingerprint(PUSH)
        self.write_file("push", payload)
        self.clock.at(minutes=5)
        self.post(PUSH)
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id], "the window open now is consumed")

    def test_a_legacy_grant_is_consumed_by_one_push(self):
        self.write_file("push", {"operation": "push", "created_at": _iso(), "expires_at": _iso(minutes=15)})
        self.assertEqual(self.pre(PUSH)[0], "allowed")
        self.post(PUSH)
        self.assertFalse((self.store / "push").exists())

    def test_a_line_that_only_reads_the_store_neither_claims_nor_consumes(self):
        self.issue(count=1, ttl=60)
        before = (self.store / "push").read_text()
        line = "git status && jq -r '.grants[0].expires_at' .claude/.allowed/push"
        self.assertEqual(self.pre(line)[0], "allowed")
        self.post(line)
        self.assertEqual((self.store / "push").read_text(), before)

    def test_a_claimed_grant_outlives_its_window_by_the_grace_and_no_more(self):
        first, second = self.issue(count=2, ttl=60)
        self.clock.at(minutes=59)
        self.pre(PUSH)
        self.clock.at(minutes=60 + 9)
        _common.inspect_grants("push", self.log)
        self.assertEqual([grant["id"] for grant in self.grants()], [first.id, second.id])
        self.clock.at(minutes=60 + 10)
        _common.inspect_grants("push", self.log)
        self.assertEqual([grant["id"] for grant in self.grants()], [second.id])


class CliTests(_GrantStoreCase):
    def setUp(self) -> None:
        super().setUp()
        self.cli = _load_cli()

    def run_cli(self, *arguments: str) -> tuple[int, str, str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = self.cli.main(list(arguments))
        return code, stdout.getvalue(), stderr.getvalue()

    def test_count_three_creates_three_windows_and_prints_them_in_local_time(self):
        code, out, _ = self.run_cli("push", "--count", "3", "--ttl", "60")
        self.assertEqual(code, 0)
        self.assertEqual(len(self.grants()), 3)
        for hour in range(4):
            self.assertIn(format_local(T0 + timedelta(hours=hour)), out)
        self.assertIn("one publication", out)

    def test_running_it_again_appends_after_the_pending_window_and_says_so(self):
        self.run_cli("push", "--count", "1", "--ttl", "60")
        code, out, _ = self.run_cli("push", "--count", "1", "--ttl", "60")
        self.assertEqual(code, 0)
        self.assertIn("Appended after 1 pending grant", out)
        self.assertEqual(self.windows(), [(_iso(), _iso(hours=1)), (_iso(hours=1), _iso(hours=2))])

    def test_a_count_outside_the_cap_or_not_positive_and_a_bad_ttl_are_refused(self):
        for arguments in (("--count", "13"), ("--count", "0"), ("--count", "-2"), ("--ttl", "0")):
            with self.subTest(arguments=arguments):
                code, _, err = self.run_cli("push", *arguments)
                self.assertEqual(code, 1)
                self.assertTrue(err)
        self.assertFalse((self.store / "push").exists())

    def test_the_old_interface_and_defaults_are_unchanged(self):
        self.assertEqual(self.run_cli("push")[0], 0)
        self.assertEqual(self.windows(), [(_iso(), _iso(minutes=15))])
        self.assertEqual(self.run_cli("sensitive-edit", "--ttl", "30")[0], 0)
        self.assertEqual(self.windows("sensitive-edit"), [(_iso(), _iso(minutes=30))])

    def test_an_unknown_operation_is_refused(self):
        code, _, err = self.run_cli("deploy")
        self.assertEqual(code, 1)
        self.assertIn("Unknown operation 'deploy'", err)
        self.assertEqual(self.run_cli("revoke", "deploy")[0], 1)

    def test_status_says_there_is_nothing_pending(self):
        self.assertEqual(self.run_cli("status")[:2], (0, "no pending grants\n"))

    def test_status_lists_every_pending_grant_with_its_window_and_state(self):
        self.run_cli("push", "--count", "2", "--ttl", "60")
        self.run_cli("sensitive-edit")
        self.clock.at(minutes=5)
        self.pre(PUSH)
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 0)
        self.assertIn("push:", out)
        self.assertIn(f"{format_local(T0)} → {format_local(T0 + timedelta(hours=1))}  (open, claimed at {format_local(T0 + timedelta(minutes=5))})", out)
        self.assertIn("(upcoming)", out)
        self.assertIn("sensitive-edit:", out)

    def test_status_exits_1_on_an_unreadable_grant_file(self):
        self.write_file("push", "{")
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 1)
        self.assertIn("unreadable (corrupt)", out)

    def test_revoke_deletes_every_grant_and_logs_it(self):
        self.run_cli("push", "--count", "3")
        code, out, _ = self.run_cli("revoke", "push")
        self.assertEqual(code, 0)
        self.assertIn("3 pending grant(s) deleted", out)
        self.assertFalse((self.store / "push").exists())
        self.assertIn("grants push revoked", self.hooks_log())
        self.assertEqual(self.run_cli("revoke", "push")[:2], (0, "No grants for 'push'.\n"))

    def test_revoke_of_an_unreadable_file_deletes_it_and_says_it_was_unreadable(self):
        self.write_file("push", "{")
        code, out, _ = self.run_cli("revoke", "push")
        self.assertEqual(code, 0)
        self.assertIn("could not be read (corrupt)", out)
        self.assertNotIn("pending grant(s) deleted", out)
        self.assertFalse((self.store / "push").exists())
        self.assertIn("unreadable (corrupt) and was deleted", self.hooks_log())

    def test_every_create_is_logged(self):
        self.run_cli("push", "--count", "2")
        self.assertEqual(self.hooks_log().count("] [omnipost-allow] grant push/"), 2)


class StoreEditBlockTests(_GrantStoreCase):
    """pre-edit refuses the store before any token is read."""

    def test_an_edit_in_the_store_is_blocked_even_with_a_valid_sensitive_edit_token(self):
        self.issue("sensitive-edit", count=1, ttl=15)
        self.assertEqual(self.edit(str(self.root / ".claude" / "hooks-py" / "x.py"))[0], "allowed", "the token IS valid")
        verdict, message = self.edit(str(self.store / "push"))
        self.assertEqual(verdict, "blocked(2)")
        self.assertIn("grant store", message)

    def test_every_spelling_of_a_path_in_the_store_is_blocked(self):
        for path in (
            "/x/.claude/.allowed/push",
            "/x/.claude/.allowed",
            "/x/.claude/./.allowed/push",
            "/x/.claude/hooks-py/../.allowed/sensitive-edit",
            ".claude/.allowed/push",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.edit(path)[0], "blocked(2)")
        self.assertEqual(self.edit("/x/.claude/.allowed/push", key="notebook_path")[0], "blocked(2)")

    def test_a_symlink_into_the_store_is_blocked(self):
        self.store.mkdir(parents=True)
        (self.root / "link").symlink_to(self.store)
        self.assertEqual(self.edit(str(self.root / "link" / "push"))[0], "blocked(2)")

    def test_names_that_only_look_like_the_store_are_not_it(self):
        for path in ("/x/docs/allowed.md", "/x/.claude/allowed/push", "/x/a.allowed/push"):
            with self.subTest(path=path):
                self.assertFalse(pre_edit.is_grant_store(path))


class StoreBashBlockTests(_GrantStoreCase):
    """pre-bash refuses every write to the store, with valid grants of both kinds present."""

    def setUp(self) -> None:
        super().setUp()
        self.issue("push", count=1, ttl=60)
        self.issue("sensitive-edit", count=1, ttl=60)

    def test_every_write_construct_on_the_store_is_blocked(self):
        for command in (
            "echo x > .claude/.allowed/push",
            "echo x >| .claude/.allowed/push",
            "printf '{}' >> /root/omni-post/.claude/.allowed/push",
            "cp a .claude/.allowed/push",
            "cp -r /tmp/.allowed .claude",
            "mv .claude/.allowed/push /tmp/push",
            "rm .claude/.allowed/push",
            "rm -rf .claude",
            "touch .claude/.allowed/push",
            "chmod 600 .claude/.allowed/push",
            "ln -s /tmp/fake .claude/.allowed/push",
            "tee .claude/.allowed/push < /tmp/fake",
            "dd if=/tmp/fake of=.claude/.allowed/push",
            "rm .claude/.allow*/push",
            'bash -c "echo x > .claude/.allowed/push"',
            "sh -c 'rm -f .claude/.allowed/push'",
            "bash -lc 'cd .claude/.allowed && touch push'",
            "cd .claude/.allowed && touch push",
            "cd .claude && rm -rf .allowed",
            "ls\necho x > .claude/.allowed/push",
            "find .claude/.allowed -name push -delete",
            "ls .claude/.allowed | xargs rm",
            "python3 -c \"import pathlib; pathlib.Path('.claude/.allowed/push').write_text('{}')\"",
            "sd -i x y .claude/.allowed/push",
            "python3 - <<'EOF'\nopen('.claude/.allowed/push', 'w').write('{}')\nEOF",
            "echo 'x > .claude/.allowed/push",
        ):
            with self.subTest(command=command):
                verdict, message = self.pre(command)
                self.assertEqual(verdict, "blocked(2)")
                self.assertIn("grant store", message)

    def test_a_write_from_a_session_cwd_inside_the_store_is_blocked(self):
        self.assertEqual(self.pre("touch push", cwd=self.store)[0], "blocked(2)")

    def test_reading_the_store_stays_allowed(self):
        for command in (
            "ls .claude/.allowed",
            "eza -la .claude/.allowed",
            "cat .claude/.allowed/push",
            "bat .claude/.allowed/push",
            "jq -r '.grants[0].expires_at' .claude/.allowed/push",
            "jq . .claude/.allowed/push 2>/dev/null | head -5",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.pre(command)[0], "allowed")


class GrantCliBlockTests(_GrantStoreCase):
    """pre-bash refuses every run of the CLI but `status`."""

    def setUp(self) -> None:
        super().setUp()
        self.issue("push", count=1, ttl=60)

    def test_running_the_cli_is_blocked_however_it_is_spelled(self):
        for command in (
            "omnipost-allow push",
            "omnipost-allow",
            "omnipost-allow sensitive-edit --ttl 30",
            "omnipost-allow revoke push",
            "omnipost-allow status --verbose",
            ".claude/bin/omnipost-allow push --count 3",
            "/root/omni-post/.claude/bin/omnipost-allow push",
            "bash -c 'omnipost-allow push'",
            'sh -c "omnipost-allow push --count 3"',
            "python3 .claude/bin/omnipost-allow push",
            "python3 -I /root/omni-post/.claude/bin/omnipost-allow push",
            "FOO=1 omnipost-allow push",
            "(omnipost-allow push)",
            "timeout 5 omnipost-allow push",
            "sudo -u root omnipost-allow push",
            "echo push | xargs omnipost-allow",
            "find .claude/bin -name x -exec omnipost-allow push \\;",
            'echo "$(omnipost-allow push)"',
            "echo `omnipost-allow push`",
            "ls\nomnipost-allow push",
            "omnipost-allow status && omnipost-allow push",
            "echo omnipost-allow push | sh",
            "python3 -c \"import subprocess; subprocess.run(['omnipost-allow', 'push'])\"",
            "bash <<'EOF'\nomnipost-allow push\nEOF",
            "python3 - <<'EOF'\nimport os\nos.system('omnipost-allow push')\nEOF",
            "git commit -m \"$(omnipost-allow push)\"",
            "omnipost-allow push 'unclosed",
        ):
            with self.subTest(command=command):
                verdict, message = self.pre(command)
                self.assertEqual(verdict, "blocked(2)")
                self.assertIn("only Edward issues", message)

    def test_a_publication_another_gate_refuses_claims_nothing(self):
        verdict, _ = self.pre("git push origin a && omnipost-allow push")
        self.assertEqual(verdict, "blocked(2)")
        self.assertNotIn("claimed_at", self.grants()[0])

    def test_status_is_allowed(self):
        for command in (
            "omnipost-allow status",
            ".claude/bin/omnipost-allow status",
            "python3 .claude/bin/omnipost-allow status",
            "bash -c 'omnipost-allow status'",
            "omnipost-allow status | head -5",
            "omnipost-allow status 2>&1",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.pre(command)[0], "allowed")

    def test_reading_or_naming_the_cli_is_not_running_it(self):
        for command in (
            "bat .claude/bin/omnipost-allow",
            "rg -n omnipost-allow CLAUDE.md",
            "rg -n 'omnipost-allow push' docs",
            "git diff -- .claude/bin/omnipost-allow",
            "which omnipost-allow",
            "command -v omnipost-allow",
            "find .claude -name omnipost-allow",
            # A message written through a heredoc (a tag here: the temporary
            # directory is no repository, so the commit gate would refuse a commit).
            "git tag -a v1 -F - <<'EOF'\nfeat: omnipost-allow push grants\n\n- `omnipost-allow push --count 3`\nEOF",
            "cat > notes.md <<'EOF'\nomnipost-allow push --count 3\nEOF",
            "gh pr create --title t --body \"$(cat <<'EOF'\nRun omnipost-allow push --count 3 --ttl 60\nEOF\n)\"",
        ):
            with self.subTest(command=command):
                self.assertEqual(self.pre(command)[0], "allowed")
        self.assertNotIn("claimed_at", self.grants()[0])


if __name__ == "__main__":
    unittest.main()
