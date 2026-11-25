"""Tests of pre_read_document_budget: a budget of bytes per document, per agent, per session."""

import contextlib
import fcntl
import io
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import _instruction_context as ic  # noqa: E402
import pre_read_document_budget as guard  # noqa: E402

LINE = "x" * 999 + "\n"  # one line of 1,000 bytes
BIG_LINES = 100  # the big document: 100 lines, 100,000 bytes
SESSION = "session-1"


class _Budget(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.docs = self.root / "docs"
        self.docs.mkdir()
        (self.docs / "big.md").write_text(LINE * BIG_LINES)
        (self.docs / "big.json").write_text(LINE * BIG_LINES)
        (self.docs / "small.md").write_text(LINE * 5)
        (self.docs / "source.py").write_text(LINE * BIG_LINES)
        (self.docs / "README.MD").write_text(LINE * BIG_LINES)
        (self.docs / "notes.md").write_text("notes\n")
        (self.docs / "sub").mkdir()
        (self.docs / "sub" / "notes.md").write_text(LINE * BIG_LINES)
        self.state = self.root / "state-root"
        self.state.mkdir()
        self._log = mock.patch.object(_common, "LOG_PATH", self.root / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def doc(self, name: str) -> str:
        return str(self.docs / name)

    def read(self, name: str, offset: object = None, limit: object = None, agent: str | None = None):
        tool_input: dict = {"file_path": self.doc(name)}
        if offset is not None:
            tool_input["offset"] = offset
        if limit is not None:
            tool_input["limit"] = limit
        return guard.evaluate(self._data("Read", tool_input, agent), self.state)

    def bash(self, command: str, agent: str | None = None, cwd: Path | None = None):
        data = self._data("Bash", {"command": command}, agent)
        data["cwd"] = str(cwd or self.docs)
        return guard.evaluate(data, self.state)

    def _data(self, tool: str, tool_input: dict, agent: str | None) -> dict:
        data = {"session_id": SESSION, "tool_name": tool, "tool_input": tool_input, "cwd": str(self.docs)}
        if agent is not None:
            data["agent_id"] = agent
        return data

    def ledger(self) -> list[dict]:
        return ic.read_entries(ic.state_file(self.state, SESSION, guard.LEDGER_KIND)) or []

    def assertRefused(self, command: str, cwd: Path | None = None):
        self.assertIsNotNone(self.bash(command, cwd=cwd), command)

    def assertAllowed(self, command: str, cwd: Path | None = None):
        self.assertIsNone(self.bash(command, cwd=cwd), command)


class DocumentTests(_Budget):
    def test_a_document_at_or_under_the_budget_is_allowed_whole(self):
        self.assertIsNone(self.read("small.md"))
        self.assertIsNone(self.bash("cat small.md"))
        self.assertEqual(self.ledger(), [])

    def test_a_document_above_the_budget_read_whole_is_refused(self):
        self.assertIsNotNone(self.read("big.md"))
        self.assertIsNotNone(self.read("big.json", offset=1))
        self.assertEqual(self.ledger(), [])

    def test_a_range_inside_the_budget_is_allowed_and_recorded(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=30))
        [entry] = self.ledger()
        self.assertEqual(entry["lines"], [1, 30])
        self.assertEqual(entry["bytes"], [0, 30_000])
        self.assertEqual(entry["agent"], guard.MAIN_AGENT)

    def test_ranges_that_add_up_past_the_budget_are_refused_at_the_one_that_crosses(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=30))
        self.assertIsNotNone(self.read("big.md", offset=31, limit=20))
        self.assertIsNone(self.read("big.md", offset=31, limit=10))
        self.assertIsNotNone(self.read("big.md", offset=41, limit=1))
        self.assertEqual([entry["lines"] for entry in self.ledger()], [[1, 30], [31, 40]])

    def test_the_same_range_read_again_adds_nothing(self):
        for _ in range(3):
            self.assertIsNone(self.read("big.md", offset=1, limit=30))
        self.assertIsNone(self.read("big.md", offset=21, limit=20))
        self.assertIsNone(self.read("big.md", offset=1, limit=40))

    def test_each_agent_has_its_own_ledger(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=40, agent="agent-a"))
        self.assertIsNone(self.read("big.md", offset=41, limit=40, agent="agent-b"))
        self.assertIsNone(self.read("big.md", offset=1, limit=40))
        self.assertIsNotNone(self.read("big.md", offset=41, limit=1, agent="agent-a"))

    def test_each_document_has_its_own_ledger(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=40))
        self.assertIsNone(self.read("big.json", offset=41, limit=40))
        self.assertIsNotNone(self.read("big.json", offset=1, limit=1))

    def test_a_source_file_is_never_refused_nor_read(self):
        with mock.patch.object(guard, "_open_document", side_effect=AssertionError("a source file was opened")):
            self.assertIsNone(self.read("source.py"))
            self.assertIsNone(self.bash("cat source.py"))
        self.assertEqual(self.ledger(), [])

    def test_a_missing_file_is_allowed(self):
        self.assertIsNone(self.read("missing.md"))
        self.assertIsNone(self.bash("cat missing.md"))

    def test_a_read_past_the_end_of_the_document_covers_nothing(self):
        self.assertIsNone(self.read("big.md", offset=40, limit=1))
        self.assertIsNone(self.read("big.md", offset=500, limit=2_000))
        self.assertEqual([entry["bytes"] for entry in self.ledger()], [[39_000, 40_000]])

    def test_reads_by_read_and_by_bash_share_the_ledger(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=30))
        self.assertIsNotNone(self.bash("sed -n '31,50p' big.md"))
        self.assertIsNone(self.bash("sed -n '25,40p' big.md"))


class BashReaderTests(_Budget):
    def test_bat(self):
        self.assertRefused("bat big.md")
        self.assertRefused("bat --style=plain --paging=never big.md")
        self.assertAllowed("bat -r 1:30 big.md")
        self.assertAllowed("bat --line-range 1:30 big.md")
        self.assertAllowed("bat --line-range=11:40 big.md")
        self.assertAllowed("bat -r :40 big.md")
        self.assertRefused("bat -r 41: big.md")
        self.assertRefused("bat -r 41:41 big.md")

    def test_bat_with_two_ranges_counts_both(self):
        self.assertRefused("bat -r 1:30 -r 51:70 big.md")
        self.assertAllowed("bat -r 1:20 -r 51:70 big.md")

    def test_cat_nl_less_and_more_read_the_whole_file(self):
        for program in ("cat", "cat -n", "nl", "nl -ba", "less", "more"):
            self.assertRefused(f"{program} big.md")
            self.assertAllowed(f"{program} small.md")

    def test_head(self):
        self.assertAllowed("head big.md")
        self.assertAllowed("head -n 30 big.md")
        self.assertAllowed("head -30 big.md")
        self.assertRefused("head -n 41 big.md")
        self.assertRefused("head --lines=41 big.md")
        self.assertRefused("head -n -10 big.md")

    def test_head_by_bytes(self):
        self.assertAllowed("head -c 40000 big.md")
        self.assertRefused("head -c 40001 big.md")
        self.assertRefused("head --bytes=50000 big.md")

    def test_tail(self):
        self.assertAllowed("tail big.md")
        self.assertAllowed("tail -n 40 big.md")
        self.assertRefused("tail -n 41 big.md")
        self.assertRefused("tail -n +51 big.md")
        self.assertAllowed("tail -n +61 big.md")

    def test_tail_by_bytes(self):
        self.assertAllowed("tail -c 40000 big.md")
        self.assertRefused("tail -c 40001 big.md")
        self.assertRefused("tail -c +50001 big.md")

    def test_sed(self):
        self.assertAllowed("sed -n '1,30p' big.md")
        self.assertAllowed("sed -n 31,40p big.md")
        self.assertRefused("sed -n '41,50p' big.md")
        self.assertRefused("sed -n 'p' big.md")

    def test_sed_with_several_ranges_counts_them_all(self):
        self.assertRefused("sed -n '1,30p;61,80p' big.md")
        self.assertAllowed("sed -n -e '1,20p' -e '61,80p' big.md")

    def test_a_reader_in_a_later_command_is_read(self):
        self.assertRefused("echo start && cat big.md")
        self.assertRefused("echo start\ncat big.md")

    def test_a_cd_earlier_in_the_command_moves_the_directory_files_resolve_against(self):
        self.assertRefused(f"cd {self.docs} && cat big.md", cwd=self.root)
        self.assertAllowed("cat big.md", cwd=self.root)
        self.assertRefused('cd "$D" && cat big.md')

    def test_a_cd_in_a_pipeline_of_several_commands_does_not_move_the_directory(self):
        self.assertAllowed("cd sub | true; head -n 900 notes.md")
        self.assertRefused("cd sub; head -n 900 notes.md")

    def test_a_command_that_is_not_plain_is_not_judged(self):
        for command in (
            "(cat big.md)",
            "{ cat big.md; }",
            'cat big.md "$(true)"',
            "x=$(cat big.md)",
            "cat big.md `true`",
            "cat <(true) big.md",
            "cat big.md | tee >(wc -c)",
            "bash <<'EOF'\ncat big.md\nEOF",
            "python3 - <<'EOF'\ncat big.md\nEOF",
            "cat big.md <<< x",
            "bash -c 'cat big.md'; cat big.md",
            "sh -c 'cat big.md'",
            "eval true; cat big.md",
            "echo big.md | xargs cat; cat big.md",
            "(cd sub && n=$(ls | wc -l)); head -n 900 notes.md",
            "body=$(bash -c 'cat big.md')",
        ):
            self.assertAllowed(command)
        self.assertEqual(self.ledger(), [])
        self.assertFalse((self.root / "hooks.log").exists())

    def test_a_search_or_a_computation_is_never_counted(self):
        for command in (
            "rg -n needle big.md",
            "jq . big.json",
            "wc -l big.md",
            "awk '{print}' big.md",
            "python3 script.py big.md",
            "cat big.md | rg needle",
            "sed 's/x/y/' big.md",
            "sed '1,50p' big.md",
            "sed -n '/needle/p' big.md",
        ):
            self.assertAllowed(command)
        self.assertEqual(self.ledger(), [])

    def test_a_reader_whose_output_feeds_a_pager_is_still_read(self):
        self.assertRefused("cat big.md | less")
        self.assertRefused("sed -n '1,50p' big.md | cat")

    def test_a_range_the_hook_cannot_compute_skips_only_that_reader_and_is_logged(self):
        self.assertAllowed("L=5; bat -r $L:+8 big.md")
        self.assertIn("FAULT", (self.root / "hooks.log").read_text())
        self.assertRefused("L=5; bat -r $L:+8 big.md; cat big.md")

    def test_a_reader_whose_output_goes_to_a_file_is_not_read(self):
        self.assertAllowed("cat big.md > copy.md")
        self.assertAllowed("cat big.md >> copy.md")
        self.assertAllowed("cat big.md | tee copy.md > /dev/null")
        self.assertAllowed("cat big.md &> copy.md")
        self.assertRefused("cat big.md 2>/dev/null")
        self.assertRefused("cat big.md 2>&1")
        self.assertRefused("cat big.md >&2")
        self.assertEqual(self.ledger(), [])

    def test_input_redirection_to_a_reader_is_read(self):
        self.assertRefused("cat < big.md")
        self.assertAllowed("head -n 30 < big.md")
        self.assertRefused("head -n 41 < big.md")

    def test_tac(self):
        self.assertRefused("tac big.md")
        self.assertAllowed("tac small.md")

    def test_a_reader_behind_timeout(self):
        self.assertRefused("timeout 5 cat big.md")
        self.assertRefused("timeout -s KILL 5s cat big.md")

    def test_a_reader_behind_env(self):
        self.assertRefused("env LC_ALL=C cat big.md")
        self.assertRefused("env -u PAGER bat big.md")

    def test_a_reader_behind_command(self):
        self.assertRefused("command cat big.md")
        self.assertAllowed("command -v cat big.md")

    def test_a_reader_behind_nice(self):
        self.assertRefused("nice -n 5 cat big.md")
        self.assertRefused("nice cat big.md")

    def test_a_reader_behind_sudo(self):
        self.assertRefused("sudo cat big.md")
        self.assertAllowed("sudo -u root head -n 30 big.md")

    def test_a_sudo_whose_options_run_no_command_wraps_nothing(self):
        for option in ("-l", "-v", "-K", "-h", "--list", "--validate", "--help", "--remove-timestamp"):
            self.assertAllowed(f"sudo {option} cat big.md")
        # With a command, `-k` only drops the cached credentials and runs it.
        self.assertRefused("sudo -k cat big.md")


class ReadShapeTests(_Budget):
    def test_a_limit_given_as_a_numeric_string(self):
        self.assertIsNone(self.read("big.md", offset="1", limit="30"))
        self.assertIsNotNone(self.read("big.md", offset="31", limit="11"))
        self.assertEqual([entry["lines"] for entry in self.ledger()], [[1, 30]])

    def test_a_limit_given_as_a_float(self):
        self.assertIsNone(self.read("big.md", offset=1.0, limit=30.0))
        self.assertIsNotNone(self.read("big.md", offset=31.0, limit=11.0))

    def test_a_limit_of_zero_or_below_reads_nothing(self):
        for limit in (0, -5, "0", -1.0):
            self.assertIsNone(self.read("big.md", limit=limit), limit)
        self.assertEqual(self.ledger(), [])


class EdgeTests(_Budget):
    def test_the_document_suffix_is_read_in_any_case(self):
        self.assertIsNotNone(self.read("README.MD"))

    def test_bat_range_from_a_line_and_a_count(self):
        self.assertAllowed("bat -r 1:+39 big.md")
        self.assertRefused("bat -r 1:+40 big.md")

    def test_sed_with_n_and_e_in_one_cluster(self):
        self.assertAllowed("sed -ne '1,30p' big.md")
        self.assertRefused("sed -ne '1,41p' big.md")
        self.assertRefused("sed -ne '1,31p' -e '61,70p' big.md")

    def test_tail_from_a_byte_at_the_budget_boundary(self):
        self.assertAllowed("tail -c +60001 big.md")
        self.assertRefused("tail -c +60000 big.md")

    def test_a_range_already_recorded_adds_nothing_when_the_ledger_is_past_the_budget(self):
        path = ic.state_file(self.state, SESSION, guard.LEDGER_KIND)
        ic.append_entry(path, {"agent": guard.MAIN_AGENT, "file": self.doc("big.md"), "lines": [1, 50], "bytes": [0, 50_000]})
        self.assertIsNone(self.read("big.md", offset=1, limit=10))
        self.assertIsNotNone(self.read("big.md", offset=51, limit=1))


class ConcurrencyTests(_Budget):
    def test_two_parallel_calls_against_one_ledger_see_each_other(self):
        barrier = threading.Barrier(2, timeout=0.3)
        real_read_entries = ic.read_entries

        def read_then_wait(path):
            entries = real_read_entries(path)
            with contextlib.suppress(threading.BrokenBarrierError):
                barrier.wait()
            return entries

        verdicts: dict[str, object] = {}

        def call(name: str, offset: int, limit: int) -> None:
            verdicts[name] = self.read("big.md", offset=offset, limit=limit)

        with mock.patch.object(ic, "read_entries", side_effect=read_then_wait):
            threads = [threading.Thread(target=call, args=("a", 1, 30)), threading.Thread(target=call, args=("b", 31, 20))]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(sorted(verdict is None for verdict in verdicts.values()), [False, True])


class RefusalTextTests(_Budget):
    def test_the_refusal_states_the_size_the_budget_the_amount_read_and_the_way_past(self):
        self.assertIsNone(self.read("big.md", offset=1, limit=30))
        message = self.read("big.md", offset=31, limit=20)
        self.assertIn(self.doc("big.md"), message)
        self.assertIn("100,000 bytes", message)
        self.assertIn("40,000 bytes", message)
        self.assertIn("read 30,000 bytes", message)
        self.assertIn("rg -n", message)
        self.assertIn("script", message)
        self.assertIn("parser", message)


class FaultTests(_Budget):
    def run_main(self, stdin: str) -> tuple[int, str]:
        with mock.patch.object(guard, "_state_root", return_value=self.state), mock.patch(
            "sys.stdin", io.StringIO(stdin)
        ), contextlib.redirect_stderr(io.StringIO()) as stderr:
            try:
                guard.main()
            except SystemExit as raised:
                return int(raised.code or 0), stderr.getvalue()
        return 0, stderr.getvalue()

    def log_text(self) -> str:
        path = self.root / "hooks.log"
        return path.read_text() if path.exists() else ""

    def payload(self, tool: str, tool_input: dict, session: str = SESSION) -> str:
        return json.dumps({"session_id": session, "tool_name": tool, "tool_input": tool_input, "cwd": str(self.docs)})

    def test_a_refusal_exits_with_the_refusing_code(self):
        code, stderr = self.run_main(self.payload("Read", {"file_path": self.doc("big.md")}))
        self.assertEqual(code, 2)
        self.assertIn("40,000 bytes", stderr)

    def test_an_input_that_is_not_json_is_allowed_and_logged(self):
        code, _ = self.run_main("not json")
        self.assertEqual(code, 0)
        self.assertIn("FAULT", self.log_text())

    def test_a_command_the_tokenizer_cannot_read_is_allowed_and_logged(self):
        code, _ = self.run_main(self.payload("Bash", {"command": "cat 'big.md"}))
        self.assertEqual(code, 0)
        self.assertIn("FAULT", self.log_text())

    def test_a_ledger_that_cannot_be_written_is_allowed_and_logged(self):
        (self.state / ".claude").write_text("a file where the state directory goes")
        code, _ = self.run_main(self.payload("Read", {"file_path": self.doc("big.md"), "offset": 1, "limit": 30}))
        self.assertEqual(code, 0)
        self.assertIn("FAULT", self.log_text())

    def test_a_session_id_that_names_no_ledger_is_allowed_and_logged(self):
        code, _ = self.run_main(self.payload("Read", {"file_path": self.doc("big.md")}, session="../x"))
        self.assertEqual(code, 0)
        self.assertIn("FAULT", self.log_text())

    def test_a_file_that_cannot_be_read_is_allowed_and_logged(self):
        with mock.patch.object(guard, "_open_document", side_effect=PermissionError("denied")):
            code, _ = self.run_main(self.payload("Read", {"file_path": self.doc("big.md"), "offset": 1, "limit": 30}))
        self.assertEqual(code, 0)
        self.assertIn("FAULT", self.log_text())

    def _hold_ledger_lock(self, seconds: float) -> None:
        """Holds the ledger's lock from another open file, released after `seconds`."""
        path = ic.state_file(self.state, SESSION, guard.LEDGER_KIND)
        path.parent.mkdir(parents=True, exist_ok=True)
        holder = path.open("a")
        fcntl.flock(holder, fcntl.LOCK_EX)
        release = threading.Timer(seconds, fcntl.flock, args=(holder, fcntl.LOCK_UN))
        release.start()
        self.addCleanup(holder.close)
        self.addCleanup(release.cancel)

    def test_a_ledger_locked_past_the_bound_is_allowed_and_logged_once(self):
        self._hold_ledger_lock(3.0)
        payload = self.payload("Read", {"file_path": self.doc("big.md"), "offset": 1, "limit": 30})
        with mock.patch.object(guard, "LOCK_WAIT_SECONDS", 0.2):
            start = time.monotonic()
            code, _ = self.run_main(payload)
            elapsed = time.monotonic() - start
        self.assertEqual(code, 0)
        self.assertLess(elapsed, 1.5)
        self.assertEqual(self.log_text().count("FAULT"), 1)
        self.assertEqual(self.ledger(), [])

    def test_a_ledger_locked_within_the_bound_is_waited_for(self):
        self._hold_ledger_lock(0.1)
        code, _ = self.run_main(self.payload("Read", {"file_path": self.doc("big.md"), "offset": 1, "limit": 30}))
        self.assertEqual(code, 0)
        self.assertNotIn("FAULT", self.log_text())
        self.assertEqual([entry["lines"] for entry in self.ledger()], [[1, 30]])

    def test_an_allowed_call_exits_zero(self):
        code, _ = self.run_main(self.payload("Read", {"file_path": self.doc("small.md")}))
        self.assertEqual(code, 0)


class CostTests(_Budget):
    """One tokenizing pass per command, none of the shared scans for heredocs
    or nested shells, and one opening per document."""

    def test_a_command_is_tokenized_once_and_never_scanned_for_heredocs_or_shell_scripts(self):
        commands = (
            "cat <<EOF\n" * 200,
            "cat " + "".join(f"<<D{index} " for index in range(80)) + "\n" + "".join(f"D{index}\n" for index in range(80)),
            "sh " * 200 + "-c 'cat notes.md'",
            "cd sub; head -n 30 notes.md | less",
            "(cat big.md)",
        )
        lexed = [0]
        real_lex = guard._lex

        def counting_lex(text):
            lexed[0] += 1
            return real_lex(text)

        refuse = AssertionError("a shared scan for heredocs or nested shells was called")
        for scan in (_common.heredocs, _common.shell_scripts):
            self.assertNotIn(scan, vars(guard).values())
        with mock.patch.object(guard, "_lex", side_effect=counting_lex), mock.patch.object(
            _common, "heredocs", side_effect=refuse
        ), mock.patch.object(_common, "shell_scripts", side_effect=refuse):
            for command in commands:
                before = lexed[0]
                self.bash(command)
                self.assertLessEqual(lexed[0] - before, 1, command[:40])

    def test_one_document_is_opened_once_however_many_readers_name_it(self):
        opened = [0]
        real_open = guard._open_document

        def counting_open(path):
            opened[0] += 1
            return real_open(path)

        command = "cat small.md; head -n 5 source.py; bat -r 1:2 big.md; " * 40
        with mock.patch.object(guard, "_open_document", side_effect=counting_open):
            self.assertIsNone(self.bash(command))
        self.assertEqual(opened[0], 1)


if __name__ == "__main__":
    unittest.main()
