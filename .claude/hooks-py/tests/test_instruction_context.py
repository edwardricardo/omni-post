"""Tests of the instruction-context recorder and of the check that blocks a
session lacking a required instruction file.

Two kinds of case. The rules of the check run in process through
`check_session`, over a fixture checkout and a fake clock, so a wait is
measured without sleeping. Everything a process shows — the exit code, what
reaches stderr and stdout, the log line, the state file — runs the hook as the
harness does: a copy of the hooks in a fixture checkout, its JSON on stdin.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HOOKS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS_DIR))

import _instruction_context as ic  # noqa: E402
import user_prompt_instruction_check as check  # noqa: E402

SESSION = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"
TRACKED = ("CLAUDE.md", "docs/canon.md")
LOCAL = ("CLAUDE.local.md", ".claude/CLAUDE.md")
HOOK_FILES = ("_common.py", "_instruction_context.py", "instructions_loaded.py", "user_prompt_instruction_check.py")
# The value Claude Code 2.1.326 sets for its hooks, measured with a dumping hook.
HARNESS = "claude-code_2-1-326_harness"


class FakeClock:
    """A monotonic clock that moves only when the check sleeps; `on_sleep`
    runs once, at the first sleep, to change the world mid-wait."""

    def __init__(self, on_sleep=None):
        self.now = 0.0
        self.slept = 0.0
        self.sleeps = 0
        self._on_sleep = on_sleep

    def clock(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps += 1
        self.now += seconds
        self.slept += seconds
        if self._on_sleep is not None:
            action, self._on_sleep = self._on_sleep, None
            action()


class Checkout:
    """A fixture checkout: `CLAUDE.md` importing one canon document, a manifest
    naming both as tracked and the two local files, and `.git` as a directory
    (a main checkout) or a file (a linked worktree)."""

    def __init__(self, test: unittest.TestCase, *, main: bool = True, local: tuple[str, ...] = LOCAL):
        tmp = Path(tempfile.mkdtemp(prefix="instruction-context-test-")).resolve()
        test.addCleanup(shutil.rmtree, tmp, True)
        self.home = tmp / "home"
        self.markers = self.home / ".claude" / ic.MARKERS_DIR_NAME
        self.root = tmp / "repo"
        self.root.mkdir()
        if main:
            (self.root / ".git").mkdir()
        else:
            (self.root / ".git").write_text("gitdir: /elsewhere/.git/worktrees/repo\n")
        self.write("CLAUDE.md", "# Fixture\n\n@docs/canon.md\n")
        self.write("docs/canon.md", "# Canon\n")
        for name in local:
            self.write(name, "# Local rules\n")
        self.manifest({"version": 1, "tracked": list(TRACKED), "local": list(LOCAL), "records": []})

    def write(self, relative: str, text: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def manifest(self, data) -> None:
        self.write(ic.MANIFEST, data if isinstance(data, str) else json.dumps(data))

    def record(self, *names: str, session: str = SESSION, **fields) -> Path:
        path = ic.state_file(self.root, session, ic.LOADED)
        for name in names:
            entry = {"file_path": str(self.root / name), "memory_type": "Project", "load_reason": "session_start"}
            entry.update(fields)
            ic.append_entry(path, entry)
        return path

    def install_hooks(self) -> Path:
        """Copies the hooks two levels below the root, where they resolve the
        root as their project, as `.claude/hooks-py/` does in the repository."""
        directory = self.root / "tooling" / "hooks"
        directory.mkdir(parents=True)
        for name in HOOK_FILES:
            shutil.copy2(HOOKS_DIR / name, directory / name)
        return directory

    def run_hook(self, name: str, payload, *, switch: str = "", harness: str | None = HARNESS) -> subprocess.CompletedProcess:
        env = {key: value for key, value in os.environ.items() if key not in (ic.SWITCH_ENV, check.HARNESS_ENV)}
        env["HOME"] = str(self.home)
        if harness is not None:
            env[check.HARNESS_ENV] = harness
        if switch:
            env[ic.SWITCH_ENV] = switch
        stdin = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run(
            [sys.executable, str(self.root / "tooling" / "hooks" / name)],
            input=stdin, capture_output=True, text=True, env=env, timeout=30, check=False,
        )

    def log_lines(self, tag: str) -> list[str]:
        try:
            text = (self.root / ".claude" / "hooks.log").read_text()
        except FileNotFoundError:
            return []
        return [line for line in text.splitlines() if f"[{tag}]" in line]


def prompt(session: str = SESSION) -> dict:
    return {"session_id": session, "hook_event_name": "UserPromptSubmit", "prompt": "Hola"}


def loaded_event(root: Path, name: str, session: str = SESSION, **fields) -> dict:
    event = {
        "session_id": session,
        "hook_event_name": "InstructionsLoaded",
        "file_path": str(root / name),
        "memory_type": "Project",
        "load_reason": "session_start",
    }
    event.update(fields)
    return event


class CheckSessionTests(unittest.TestCase):
    """The rules, in process, over a fake clock."""

    def _check(self, checkout: Checkout, clock: FakeClock | None = None) -> check.Outcome:
        clock = clock or FakeClock()
        return check.check_session(checkout.root, SESSION, markers=checkout.markers, clock=clock.clock, sleep=clock.sleep)

    def test_a_complete_record_passes_without_waiting(self):
        checkout = Checkout(self)
        checkout.record(*TRACKED, *LOCAL)
        clock = FakeClock()

        outcome = self._check(checkout, clock)

        self.assertEqual(outcome.blocked, [])
        self.assertEqual(outcome.required, 4)
        self.assertEqual(clock.sleeps, 0)

    def test_a_tracked_file_missing_from_the_checkout_blocks_at_once_and_names_its_repair(self):
        checkout = Checkout(self)
        (checkout.root / "docs" / "canon.md").unlink()
        clock = FakeClock()

        outcome = self._check(checkout, clock)

        self.assertEqual(clock.sleeps, 0)
        self.assertEqual(len(outcome.blocked), 1)
        self.assertIn("docs/canon.md is missing from the checkout", outcome.blocked[0])
        self.assertIn(f"git -C {checkout.root} checkout -- docs/canon.md", outcome.blocked[0])

    def test_an_empty_or_unreadable_required_file_blocks_at_once(self):
        checkout = Checkout(self)
        checkout.write("docs/canon.md", "")

        outcome = self._check(checkout)

        self.assertIn("docs/canon.md is empty", outcome.blocked[0])

    def test_a_required_file_that_is_a_directory_blocks_without_hanging(self):
        checkout = Checkout(self)
        (checkout.root / "docs" / "canon.md").unlink()
        (checkout.root / "docs" / "canon.md").mkdir()

        outcome = self._check(checkout)

        self.assertIn("docs/canon.md is not a regular file", outcome.blocked[0])

    def test_a_named_pipe_at_a_required_path_blocks_without_waiting_for_a_writer(self):
        checkout = Checkout(self)
        (checkout.root / "docs" / "canon.md").unlink()
        os.mkfifo(checkout.root / "docs" / "canon.md")

        outcome = self._check(checkout)

        self.assertIn("docs/canon.md is not a regular file", outcome.blocked[0])

    def test_a_main_checkout_that_holds_a_local_file_requires_every_local_file(self):
        checkout = Checkout(self, local=("CLAUDE.local.md",))
        checkout.record(*TRACKED, "CLAUDE.local.md")

        outcome = self._check(checkout)

        self.assertEqual(outcome.required, 4)
        self.assertEqual(len(outcome.blocked), 1)
        self.assertIn(".claude/CLAUDE.md is missing from the checkout", outcome.blocked[0])
        self.assertIn("delete its line from local in .claude/instruction-manifest.json", outcome.blocked[0])

    def test_a_main_checkout_that_holds_no_local_file_requires_the_tracked_set_alone(self):
        checkout = Checkout(self, local=())
        checkout.record(*TRACKED)

        outcome = self._check(checkout)

        self.assertEqual(outcome.blocked, [])
        self.assertEqual(outcome.required, 2)

    def test_a_linked_worktree_requires_the_tracked_set_alone_though_it_holds_a_local_file(self):
        checkout = Checkout(self, main=False, local=("CLAUDE.local.md",))
        checkout.record(*TRACKED)

        outcome = self._check(checkout)

        self.assertEqual(outcome.blocked, [])
        self.assertEqual(outcome.required, 2)

    def test_a_record_that_completes_during_the_wait_passes(self):
        checkout = Checkout(self)
        checkout.record(*TRACKED)
        clock = FakeClock(on_sleep=lambda: checkout.record(*LOCAL))

        outcome = self._check(checkout, clock)

        self.assertEqual(outcome.blocked, [])
        self.assertEqual(clock.sleeps, 1)

    def test_no_record_blocks_after_the_bounded_wait_and_says_to_resume_once(self):
        checkout = Checkout(self)
        clock = FakeClock()

        outcome = self._check(checkout, clock)

        self.assertAlmostEqual(clock.slept, check.WAIT_SECONDS, delta=check.POLL_SECONDS)
        self.assertEqual(len(outcome.blocked), 1)
        line = outcome.blocked[0]
        self.assertIn(f"No record of the instruction files loaded in session {SESSION} exists", line)
        self.assertIn("already running when the instruction hooks reached this checkout", line)
        self.assertIn(f"resume it once (claude --resume {SESSION})", line)
        self.assertIn("pnpm check:instruction-context", line)

    def test_a_file_on_disk_the_harness_never_reported_blocks_after_the_wait(self):
        checkout = Checkout(self)
        checkout.record("CLAUDE.md", *LOCAL)
        clock = FakeClock()

        outcome = self._check(checkout, clock)

        self.assertGreaterEqual(clock.slept, check.WAIT_SECONDS)
        self.assertEqual(len(outcome.blocked), 1)
        self.assertIn("docs/canon.md is in the checkout, and the harness did not report it as loaded", outcome.blocked[0])
        self.assertIn(f"claude --resume {SESSION}", outcome.blocked[0])

    def test_a_load_reported_by_its_resolved_path_counts(self):
        checkout = Checkout(self)
        alias = checkout.root.parent / "alias"
        alias.symlink_to(checkout.root)
        path = ic.state_file(checkout.root, SESSION, ic.LOADED)
        for name in (*TRACKED, *LOCAL):
            ic.append_entry(path, {"file_path": str(alias / name), "load_reason": "session_start"})

        self.assertEqual(self._check(checkout).blocked, [])

    def test_a_malformed_record_line_vouches_for_nothing(self):
        checkout = Checkout(self)
        path = checkout.record(*TRACKED, "CLAUDE.local.md")
        with path.open("a") as handle:
            handle.write('{"file_path": "' + str(checkout.root / ".claude" / "CLAUDE.md") + '"\n')

        outcome = self._check(checkout)

        self.assertIn(".claude/CLAUDE.md is in the checkout, and the harness did not report it", outcome.blocked[0])

    def test_a_missing_manifest_blocks_with_its_repair(self):
        checkout = Checkout(self)
        (checkout.root / ic.MANIFEST).unlink()

        outcome = self._check(checkout)

        self.assertIn(".claude/instruction-manifest.json does not exist", outcome.blocked[0])
        self.assertIn(f"git -C {checkout.root} checkout -- .claude/instruction-manifest.json", outcome.blocked[0])

    def test_a_manifest_with_an_empty_tracked_list_blocks(self):
        checkout = Checkout(self)
        checkout.manifest({"version": 1, "tracked": [], "local": [], "records": []})

        outcome = self._check(checkout)

        self.assertIn("tracked must be a non-empty list", outcome.blocked[0])

    def test_files_loaded_at_start_that_the_manifest_does_not_list_are_named(self):
        checkout = Checkout(self)
        checkout.record(*TRACKED, *LOCAL)
        checkout.write(".claude/rules/always.md", "# Always\n")
        checkout.record(".claude/rules/always.md")
        checkout.record("docs/nested/CLAUDE.md", load_reason="nested_traversal")
        checkout.record(".claude/rules/scoped.md", load_reason="path_glob_match")
        checkout.record("docs/agent.md", agent_id="a1")
        ic.append_entry(ic.state_file(checkout.root, SESSION, ic.LOADED), {"file_path": "/elsewhere/CLAUDE.md", "memory_type": "User", "load_reason": "session_start"})

        outcome = self._check(checkout)

        self.assertEqual(outcome.blocked, [])
        self.assertEqual(outcome.unlisted, [".claude/rules/always.md"])


    def test_with_the_marker_every_local_file_is_required_though_none_is_left(self):
        checkout = Checkout(self)
        ic.mark_local_files_seen(checkout.root, checkout.markers)
        for name in LOCAL:
            (checkout.root / name).unlink()
        marker = ic.marker_path(checkout.root, checkout.markers)

        outcome = self._check(checkout)

        self.assertEqual(outcome.required, 4)
        self.assertEqual(len(outcome.blocked), 2)
        self.assertIn("CLAUDE.local.md is missing from the checkout", outcome.blocked[0])
        self.assertIn(f"the marker {marker} records that this checkout has loaded its local files", outcome.blocked[0])
        self.assertIn(f"rm {marker}", outcome.blocked[0])

    def test_with_no_marker_a_checkout_that_holds_no_local_file_is_not_blocked_for_them(self):
        checkout = Checkout(self, local=())
        checkout.record(*TRACKED)

        outcome = self._check(checkout)

        self.assertEqual((outcome.blocked, outcome.required), ([], 2))
        self.assertFalse(checkout.markers.exists())

    def test_a_marker_for_another_checkout_is_ignored(self):
        checkout = Checkout(self, local=())
        other = Checkout(self)
        ic.mark_local_files_seen(other.root, checkout.markers)
        checkout.record(*TRACKED)

        outcome = self._check(checkout)

        self.assertEqual((outcome.blocked, outcome.required), ([], 2))

    def test_an_unreadable_marker_directory_blocks_since_the_check_cannot_tell(self):
        checkout = Checkout(self, local=())
        checkout.markers.parent.mkdir(parents=True)
        checkout.markers.write_text("a file where the markers directory belongs\n")
        checkout.record(*TRACKED)

        outcome = self._check(checkout)

        self.assertEqual(len(outcome.blocked), 1)
        self.assertIn(f"the marker of this checkout's local files, {ic.marker_path(checkout.root, checkout.markers)}, could not be read", outcome.blocked[0])
        self.assertIn(f"Make {checkout.markers} a readable directory again", outcome.blocked[0])

    def test_a_marker_that_is_not_a_regular_file_blocks_with_the_repair_that_fits_it(self):
        for kind, plant in (("a symbolic link", lambda path: path.symlink_to(os.devnull)), ("a directory", lambda path: path.mkdir())):
            with self.subTest(marker=kind):
                checkout = Checkout(self, local=())
                checkout.markers.mkdir(parents=True)
                marker = ic.marker_path(checkout.root, checkout.markers)
                plant(marker)
                checkout.record(*TRACKED)

                outcome = self._check(checkout)

                self.assertEqual(len(outcome.blocked), 1)
                self.assertIn(f"{marker}, is not a regular file", outcome.blocked[0])
                self.assertIn(f"Remove it: rm -r {marker}", outcome.blocked[0])
                self.assertNotIn("readable directory", outcome.blocked[0])
                self.assertTrue(os.path.lexists(marker))

    def test_a_record_that_cannot_be_read_blocks(self):
        cases = {
            "the state directory is a file": lambda c: c.write(".claude/state/instruction-context", "a file\n"),
            "the record is a named pipe": lambda c: (ic.state_file(c.root, SESSION, ic.LOADED).parent.mkdir(parents=True), os.mkfifo(ic.state_file(c.root, SESSION, ic.LOADED))),
        }
        for name, plant in cases.items():
            with self.subTest(name):
                checkout = Checkout(self)
                plant(checkout)

                outcome = self._check(checkout)

                self.assertEqual(len(outcome.blocked), 1)
                self.assertIn("could not be read", outcome.blocked[0])
                self.assertIn(f"claude --resume {SESSION}", outcome.blocked[0])

    def test_an_error_while_reading_the_record_blocks(self):
        checkout = Checkout(self)
        checkout.record(*TRACKED, *LOCAL)
        with mock.patch.object(ic, "read_entries", side_effect=PermissionError(13, "Permission denied")):
            outcome = self._check(checkout)

        self.assertEqual(len(outcome.blocked), 1)
        self.assertIn("could not be read ([Errno 13] Permission denied)", outcome.blocked[0])


class RecorderTests(unittest.TestCase):
    """The recorder as a process: one line per event, never a failure."""

    def test_each_event_appends_one_line_with_the_fields_the_check_reads(self):
        checkout = Checkout(self)
        checkout.install_hooks()

        first = checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.md"))
        second = checkout.run_hook(
            "instructions_loaded.py",
            loaded_event(checkout.root, "docs/canon.md", load_reason="include", parent_file_path=str(checkout.root / "CLAUDE.md")),
        )

        self.assertEqual((first.returncode, first.stdout, first.stderr), (0, "", ""))
        self.assertEqual((second.returncode, second.stdout, second.stderr), (0, "", ""))
        entries = ic.read_entries(ic.state_file(checkout.root, SESSION, ic.LOADED))
        self.assertEqual([entry["file_path"] for entry in entries], [str(checkout.root / "CLAUDE.md"), str(checkout.root / "docs" / "canon.md")])
        self.assertEqual(entries[1]["load_reason"], "include")
        self.assertEqual(entries[1]["parent_file_path"], str(checkout.root / "CLAUDE.md"))

    def test_a_session_id_that_is_not_a_plain_token_writes_nothing(self):
        checkout = Checkout(self)
        checkout.install_hooks()

        result = checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.md", session="../escape"))

        self.assertEqual(result.returncode, 0)
        self.assertFalse((checkout.root / ic.STATE_DIR).exists())
        self.assertTrue(any("no usable session id" in line for line in checkout.log_lines("instructions-loaded")))

    def test_an_unwritable_state_directory_does_not_fail_the_hook(self):
        checkout = Checkout(self)
        checkout.install_hooks()
        checkout.write(".claude/state", "a file where the state directory belongs\n")

        result = checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.md"))

        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        self.assertTrue(any("could not record" in line for line in checkout.log_lines("instructions-loaded")))

    def test_input_that_is_not_json_does_not_fail_the_hook(self):
        checkout = Checkout(self)
        checkout.install_hooks()

        result = checkout.run_hook("instructions_loaded.py", "{ not json")

        self.assertEqual(result.returncode, 0)
        self.assertFalse((checkout.root / ic.STATE_DIR).exists())

    def test_the_first_line_of_a_session_removes_state_files_older_than_the_limit(self):
        checkout = Checkout(self)
        checkout.install_hooks()
        old = checkout.record("CLAUDE.md", session="old-session")
        kept = checkout.record("CLAUDE.md", session="recent-session")
        month = time.time() - ic.STATE_MAX_AGE_SECONDS - 60
        os.utime(old, (month, month))

        checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.md"))

        self.assertFalse(old.exists())
        self.assertTrue(kept.exists())
        self.assertTrue(ic.state_file(checkout.root, SESSION, ic.LOADED).exists())


    def test_the_first_local_file_reported_loaded_writes_the_marker_once(self):
        checkout = Checkout(self)
        checkout.install_hooks()
        marker = ic.marker_path(checkout.root, checkout.markers)

        checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.md"))
        self.assertFalse(marker.exists())
        checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, "CLAUDE.local.md", memory_type="Local"))
        written = marker.read_text()
        checkout.run_hook("instructions_loaded.py", loaded_event(checkout.root, ".claude/CLAUDE.md", memory_type="Local"))

        self.assertEqual(json.loads(written)["checkout"], str(checkout.root))
        self.assertEqual(marker.read_text(), written)
        self.assertEqual(len([line for line in checkout.log_lines("instructions-loaded") if "marked" in line]), 1)


class CheckProcessTests(unittest.TestCase):
    """The check as a process: exit 2 with its message, or exit 0."""

    def setUp(self):
        self.checkout = Checkout(self)
        self.checkout.install_hooks()

    def _run(self, payload=None, **kwargs) -> subprocess.CompletedProcess:
        return self.checkout.run_hook("user_prompt_instruction_check.py", prompt() if payload is None else payload, **kwargs)

    def test_a_complete_record_passes_silently_and_logs_the_pass(self):
        self.checkout.record(*TRACKED, *LOCAL)

        result = self._run()

        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        self.assertTrue(any("ALLOW: 4 required instruction files loaded" in line for line in self.checkout.log_lines(check.HOOK_NAME)))

    def test_a_required_file_that_did_not_load_blocks_with_exit_2_naming_the_file_its_repair_and_the_switch(self):
        self.checkout.write("CLAUDE.md", "# Fixture with its import line deleted\n")
        self.checkout.record("CLAUDE.md", *LOCAL)

        started = time.monotonic()
        result = self._run()
        elapsed = time.monotonic() - started

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("docs/canon.md is in the checkout, and the harness did not report it as loaded", result.stderr)
        self.assertIn("MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes", result.stderr)
        self.assertGreaterEqual(elapsed, check.WAIT_SECONDS)
        self.assertTrue(any("BLOCK:" in line for line in self.checkout.log_lines(check.HOOK_NAME)))

    def test_input_that_is_not_json_blocks(self):
        result = self._run("{ not json")

        self.assertEqual(result.returncode, 2)
        self.assertIn("could not read its input", result.stderr)

    def test_input_without_a_session_id_blocks(self):
        result = self._run({"hook_event_name": "UserPromptSubmit", "prompt": "Hola"})

        self.assertEqual(result.returncode, 2)
        self.assertIn("no usable session id", result.stderr)

    def test_a_missing_manifest_blocks(self):
        (self.checkout.root / ic.MANIFEST).unlink()

        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn(".claude/instruction-manifest.json does not exist", result.stderr)

    def test_a_manifest_that_is_not_json_blocks(self):
        self.checkout.manifest("{ not json")

        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn(".claude/instruction-manifest.json is not JSON", result.stderr)

    def test_an_exception_inside_the_check_blocks_instead_of_letting_the_prompt_through(self):
        (self.checkout.root / "tooling" / "hooks" / "_instruction_context.py").write_text("raise RuntimeError('planted failure')\n")

        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn("the instruction check failed (RuntimeError: planted failure)", result.stderr)
        self.assertIn("MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes", result.stderr)

    def test_a_block_does_not_depend_on_the_log_being_writable(self):
        (self.checkout.root / ".claude" / "hooks.log").mkdir(parents=True)
        (self.checkout.root / "docs" / "canon.md").unlink()

        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn("docs/canon.md is missing from the checkout", result.stderr)

    def test_the_switch_lets_every_prompt_through_with_a_visible_warning_and_a_log_line(self):
        (self.checkout.root / ic.MANIFEST).unlink()

        results = [self._run(switch="yes"), self._run(switch="yes")]

        for result in results:
            self.assertEqual((result.returncode, result.stderr), (0, ""))
            output = json.loads(result.stdout)
            for text in (output["systemMessage"], output["hookSpecificOutput"]["additionalContext"]):
                self.assertIn("The instruction check is switched off", text)
                self.assertIn("unset MAINTAINER_DISABLE_INSTRUCTION_CHECK", text)
            self.assertEqual(output["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        switched = [line for line in self.checkout.log_lines(check.HOOK_NAME) if "SWITCH:" in line]
        self.assertEqual(len(switched), 2)
        self.assertIn(SESSION, switched[0])

    def test_the_switch_set_to_anything_but_yes_leaves_the_check_on(self):
        (self.checkout.root / ic.MANIFEST).unlink()

        result = self._run(switch="1")

        self.assertEqual(result.returncode, 2)
        self.assertIn(".claude/instruction-manifest.json does not exist", result.stderr)

    def test_files_loaded_at_start_that_the_manifest_does_not_list_are_noticed_once_per_session(self):
        self.checkout.record(*TRACKED, *LOCAL)
        self.checkout.write(".claude/rules/always.md", "# Always\n")
        self.checkout.record(".claude/rules/always.md")

        first, second = self._run(), self._run()

        self.assertEqual(first.returncode, 0)
        notice = json.loads(first.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn(".claude/rules/always.md", notice)
        self.assertIn("pnpm check:instruction-context", notice)
        self.assertEqual((second.returncode, second.stdout), (0, ""))


    def test_deleting_every_local_file_once_they_loaded_blocks_the_next_prompt(self):
        for name in LOCAL:
            self.checkout.run_hook("instructions_loaded.py", loaded_event(self.checkout.root, name, memory_type="Local"))
        self.checkout.record(*TRACKED)
        for name in LOCAL:
            (self.checkout.root / name).unlink()

        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn("CLAUDE.local.md is missing from the checkout", result.stderr)
        self.assertIn(f"rm {ic.marker_path(self.checkout.root, self.checkout.markers)}", result.stderr)

    def test_a_harness_older_than_the_one_onfailure_needs_is_refused_with_the_upgrade(self):
        self.checkout.record(*TRACKED, *LOCAL)
        for harness, fragment in (
            ("claude-code_2-1-143_harness", "this session runs Claude Code 2.1.143"),
            ("claude-code_2-1-294_agent", "this session runs Claude Code 2.1.294"),
            (None, "does not name its version (AI_AGENT is unset)"),
            ("other-agent", "names no version in AI_AGENT ('other-agent')"),
        ):
            with self.subTest(harness=harness):
                result = self._run(harness=harness)
                self.assertEqual(result.returncode, 2)
                self.assertIn(fragment, result.stderr)
                self.assertIn("Upgrade Claude Code to 2.1.295 or later", result.stderr)

    def test_a_harness_that_names_no_version_is_told_the_way_through_an_upgrade_cannot_give(self):
        self.checkout.record(*TRACKED, *LOCAL)
        for harness in (None, "other-agent"):
            with self.subTest(harness=harness):
                result = self._run(harness=harness)
                self.assertEqual(result.returncode, 2)
                self.assertIn("no longer names its version in AI_AGENT", result.stderr)
                self.assertIn("MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes", result.stderr)

    def test_an_empty_harness_variable_is_reported_as_empty_not_as_unset(self):
        self.checkout.record(*TRACKED, *LOCAL)

        result = self._run(harness="")

        self.assertEqual(result.returncode, 2)
        self.assertIn("does not name its version (AI_AGENT is empty)", result.stderr)
        self.assertNotIn("AI_AGENT is unset", result.stderr)
        self.assertIn("no longer names its version in AI_AGENT", result.stderr)

    def test_a_harness_that_names_an_old_version_is_told_only_to_upgrade(self):
        self.checkout.record(*TRACKED, *LOCAL)

        result = self._run(harness="claude-code_2-1-143_harness")

        self.assertEqual(result.returncode, 2)
        self.assertNotIn("no longer names its version", result.stderr)

    def test_a_refusal_for_the_harness_does_not_say_instruction_files_are_missing(self):
        self.checkout.record(*TRACKED, *LOCAL)

        result = self._run(harness="claude-code_2-1-143_harness")

        self.assertEqual(result.returncode, 2)
        self.assertNotIn("lacks instruction files", result.stderr)
        self.assertIn("The instruction check blocked this prompt", result.stderr)

    def test_a_harness_of_the_version_onfailure_needs_or_later_passes(self):
        self.checkout.record(*TRACKED, *LOCAL)
        for harness in ("claude-code_2-1-295_harness", "claude-code_2-2-0_agent", "claude-code_3-0-1"):
            with self.subTest(harness=harness):
                self.assertEqual(self._run(harness=harness).returncode, 0)

    def test_an_exception_names_the_session_its_input_carried(self):
        (self.checkout.root / "tooling" / "hooks" / "_instruction_context.py").write_text("raise RuntimeError('planted failure')\n")

        result = self._run()

        self.assertIn(f"(session {SESSION})", result.stderr)
        self.assertNotIn("session unknown", result.stderr)

    def test_no_record_names_every_cause_a_new_session_can_have(self):
        result = self._run()

        self.assertEqual(result.returncode, 2)
        self.assertIn("a full disk", result.stderr)
        self.assertIn("'could not record' line of instructions-loaded", result.stderr)
        self.assertIn("pnpm check:instruction-context", result.stderr)


class SwitchNameTests(unittest.TestCase):
    def test_the_check_and_the_shared_module_name_the_same_switch(self):
        # The check reads the switch before it imports the module, so a broken
        # module cannot keep the switch from opening a session; the two names
        # are therefore two literals, held equal here.
        self.assertEqual(check.SWITCH_ENV, ic.SWITCH_ENV)


class SharedModuleTests(unittest.TestCase):
    def test_a_relative_path_is_refused_when_it_climbs_or_is_absolute(self):
        self.assertTrue(ic.is_relative_path("docs/canon.md"))
        for value in ("", "/etc/passwd", "../x", "a/../b", "a//b", "a\\b", 3, None):
            self.assertFalse(ic.is_relative_path(value), value)

    def test_a_state_file_is_never_written_through_a_symbolic_link(self):
        checkout = Checkout(self)
        target = checkout.root / "elsewhere.jsonl"
        path = ic.state_file(checkout.root, SESSION, ic.LOADED)
        path.parent.mkdir(parents=True)
        path.symlink_to(target)

        with self.assertRaises(OSError):
            ic.append_entry(path, {"file_path": "x"})
        self.assertFalse(target.exists())

    def test_relative_to_root_refuses_a_path_outside_the_root(self):
        root = Path("/repo")
        self.assertEqual(ic.relative_to_root(root, "/repo/docs/a.md"), "docs/a.md")
        self.assertIsNone(ic.relative_to_root(root, "/repo"))
        self.assertIsNone(ic.relative_to_root(root, "/other/a.md"))
        self.assertEqual(ic.relative_to_root(root, "/repo/..hidden/a.md"), "..hidden/a.md")


if __name__ == "__main__":
    unittest.main()
