"""Tests of the record guard: a write of a file a moved record governs waits
until the session, or the agent making it, has opened that record.

The rules run in process through `note_reads` and `judge_call`, over fixture
checkouts; the exit codes, the message, the two modes and the switch run the
hook as the harness does, from a copy of the hooks in a fixture checkout.

Run: python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
"""

import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS_DIR))

import _instruction_context as ic  # noqa: E402
import pre_tool_record_guard as guard  # noqa: E402

SESSION = "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"
AGENT = "a7f3e9c1d2b4"
RULE = ".claude/rules/record.md"
DOCUMENT = "docs/record.md"
RULE_BODY = f"Search `{DOCUMENT}` for the package before a change, and record the change there.\n"
HOOK_FILES = ("_common.py", "_instruction_context.py", "pre_tool_record_guard.py", "pre_bash.py", "pre_edit.py")


def rule_text(*globs: str, body: str = RULE_BODY) -> str:
    return "---\npaths:\n" + "".join(f'  - "{glob}"\n' for glob in globs) + "---\n\n" + body


class Checkout:
    """A fixture checkout with one record: its rule governs `deps/*.yaml` and
    `**/package.json`. The session's state lives under `state_root`, which is
    the checkout itself unless another is given (a sibling worktree)."""

    def __init__(self, test: unittest.TestCase, name: str = "repo", base: Path | None = None, manifest: bool = True):
        if base is None:
            base = Path(tempfile.mkdtemp(prefix="record-guard-test-")).resolve()
            test.addCleanup(shutil.rmtree, base, True)
        self.base = base
        self.root = base / name
        (self.root / ".git").mkdir(parents=True)
        if manifest:
            self.write(ic.MANIFEST, json.dumps({"version": 1, "tracked": ["CLAUDE.md"], "local": [], "records": [{"rule": RULE, "document": DOCUMENT}]}))
            self.write(RULE, rule_text("deps/*.yaml", "**/package.json"))
        self.write(DOCUMENT, "# Record\n\n| package | history |\n")
        self.write("deps/workspace.yaml", "lib: 1.0.0\n")
        self.write("docs/other.md", "# Other\n")

    def write(self, relative: str, text: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def add_second_record(self, *globs: str, body: str = RULE_BODY) -> tuple[str, str]:
        """Gives the checkout a second record beside the first: the manifest
        lists both, the second rule governs `globs` and says `body`, and its
        document exists. Returns the second record's rule and document."""
        rule, document = ".claude/rules/second.md", "docs/second.md"
        self.write(
            ic.MANIFEST,
            json.dumps(
                {
                    "version": 1,
                    "tracked": ["CLAUDE.md"],
                    "local": [],
                    "records": [{"rule": RULE, "document": DOCUMENT}, {"rule": rule, "document": document}],
                }
            ),
        )
        self.write(rule, rule_text(*globs, body=body))
        self.write(document, "# Second record\n")
        return rule, document

    def payload(self, tool: str, tool_input: dict, *, agent: str | None = None, cwd: Path | None = None) -> dict:
        data = {"session_id": SESSION, "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input, "cwd": str(cwd or self.root)}
        if agent is not None:
            data["agent_id"] = agent
            data["agent_type"] = "general-purpose"
        return data

    def edit(self, relative: str, **kwargs) -> dict:
        return self.payload("Edit", {"file_path": str(self.root / relative), "old_string": "a", "new_string": "b"}, **kwargs)

    def bash(self, command: str, **kwargs) -> dict:
        return self.payload("Bash", {"command": command}, **kwargs)

    def reads(self, state_root: Path | None = None) -> list[dict]:
        return ic.read_entries(ic.state_file(state_root or self.root, SESSION, ic.READS)) or []

    def install_hooks(self) -> None:
        directory = self.root / "tooling" / "hooks"
        directory.mkdir(parents=True)
        for name in HOOK_FILES:
            shutil.copy2(HOOKS_DIR / name, directory / name)

    def run_hook(self, payload, *, mode: str = "judge", switch: str = "") -> subprocess.CompletedProcess:
        env = {key: value for key, value in os.environ.items() if key != ic.SWITCH_ENV}
        if switch:
            env[ic.SWITCH_ENV] = switch
        return subprocess.run(
            [sys.executable, str(self.root / "tooling" / "hooks" / "pre_tool_record_guard.py"), *([mode] if mode else [])],
            input=payload if isinstance(payload, str) else json.dumps(payload),
            capture_output=True, text=True, env=env, timeout=30, check=False,
        )


class EditJudgementTests(unittest.TestCase):
    def setUp(self):
        self.checkout = Checkout(self)

    def _judge(self, payload: dict, state_root: Path | None = None) -> str | None:
        return guard.judge_call(payload, state_root or self.checkout.root)

    def _note(self, payload: dict, state_root: Path | None = None) -> None:
        guard.note_reads(payload, state_root or self.checkout.root)

    def test_an_edit_of_a_file_no_rule_governs_passes(self):
        self.assertIsNone(self._judge(self.checkout.edit("src/app.ts")))

    def test_an_edit_of_a_governed_file_with_no_opening_of_the_record_is_refused_with_the_rule(self):
        refusal = self._judge(self.checkout.edit("deps/workspace.yaml"))

        self.assertIn(f"deps/workspace.yaml is governed by the record {DOCUMENT}", refusal)
        self.assertIn(f"The rule {RULE} says:", refusal)
        self.assertIn(RULE_BODY.strip(), refusal)
        self.assertIn(f"find the lines you need with rg -n '<term>' {self.checkout.root}/{DOCUMENT}", refusal)
        self.assertNotIn("<package>", refusal)
        self.assertIn("then Read that range", refusal)
        self.assertIn(guard.OPENING_FORMS, refusal)
        self.assertIn("the Read tool on it", guard.OPENING_FORMS)
        self.assertIn("the Grep tool", guard.OPENING_FORMS)
        self.assertIn("A Bash command does not count", guard.OPENING_FORMS)
        self.assertIn("MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes", refusal)

    def test_with_two_records_a_file_both_govern_needs_both_opened_and_a_file_one_governs_needs_only_that_one(self):
        _, second_document = self.checkout.add_second_record(
            "deps/*.yaml", "scripts/*.mjs", body="Search the second record by number.\n"
        )
        both, second_only = "deps/workspace.yaml", "scripts/gate.mjs"

        first_refusal = self._judge(self.checkout.edit(both))
        self.assertIn(f"{both} is governed by the record {DOCUMENT}", first_refusal)
        self.assertIsNone(self._judge(self.checkout.edit("src/app.ts")))
        second_refusal = self._judge(self.checkout.edit(second_only))
        self.assertIn(f"{second_only} is governed by the record {second_document}", second_refusal)
        self.assertIn("Search the second record by number.", second_refusal)
        self.assertIn(f"rg -n '<term>' {self.checkout.root}/{second_document}", second_refusal)

        self._note(self.checkout.payload("Read", {"file_path": str(self.checkout.root / second_document)}))
        self.assertIsNone(self._judge(self.checkout.edit(second_only)))
        refusal = self._judge(self.checkout.edit(both))
        self.assertIn(f"{both} is governed by the record {DOCUMENT}", refusal)
        self.assertNotIn(second_document, refusal.splitlines()[0])

        self._note(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}))
        self.assertIsNone(self._judge(self.checkout.edit(both)))
        self.assertIsNone(self._judge(self.checkout.edit(second_only)))

    def test_with_two_records_an_opening_of_the_first_alone_does_not_open_a_file_both_govern(self):
        second_rule, second_document = self.checkout.add_second_record("deps/*.yaml")

        self._note(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}))
        refusal = self._judge(self.checkout.edit("deps/workspace.yaml"))

        self.assertIn(f"deps/workspace.yaml is governed by the record {second_document}", refusal)
        self.assertIn(f"The rule {second_rule} says:", refusal)

    def test_a_write_and_a_multi_edit_are_judged_as_an_edit(self):
        root = self.checkout.root
        write = self.checkout.payload("Write", {"file_path": str(root / "deps" / "new.yaml"), "content": "x"})
        multi = self.checkout.payload("MultiEdit", {"file_path": str(root / "apps" / "web" / "package.json"), "edits": []})

        self.assertIsNotNone(self._judge(write))
        self.assertIsNotNone(self._judge(multi))

    def test_a_grep_of_the_record_by_the_session_opens_its_governed_files(self):
        self._note(self.checkout.payload("Grep", {"pattern": "lib", "path": str(self.checkout.root / DOCUMENT)}, cwd=Path("/")))

        self.assertEqual([(e["agent"], e["document"], e["tool"]) for e in self.checkout.reads()], [("main", DOCUMENT, "Grep")])
        self.assertIsNone(self._judge(self.checkout.edit("deps/workspace.yaml")))

    def test_an_opening_by_the_session_does_not_open_the_path_for_an_agent_nor_the_reverse(self):
        self._note(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}))

        self.assertIsNotNone(self._judge(self.checkout.edit("deps/workspace.yaml", agent=AGENT)))

        other = Checkout(self)
        guard.note_reads(other.payload("Read", {"file_path": str(other.root / DOCUMENT)}, agent=AGENT), other.root)
        self.assertIsNotNone(guard.judge_call(other.edit("deps/workspace.yaml"), other.root))
        self.assertIsNone(guard.judge_call(other.edit("deps/workspace.yaml", agent=AGENT), other.root))

    def test_each_accepted_form_of_opening_the_record_counts(self):
        root = self.checkout.root
        openings = [
            ("Read", {"file_path": str(root / DOCUMENT)}),
            ("Read", {"file_path": DOCUMENT}),
            ("Grep", {"pattern": "lib", "path": str(root / DOCUMENT)}),
            ("Grep", {"pattern": "lib", "path": DOCUMENT}),
            ("Grep", {"pattern": "lib", "path": str(root / "docs")}),
            ("Grep", {"pattern": "lib", "path": "docs", "glob": "*.md"}),
            ("Grep", {"pattern": "lib", "path": "docs", "type": "md"}),
            ("Grep", {"pattern": "lib"}),
            ("Grep", {"pattern": "lib", "path": str(root / "docs"), "glob": "record.md", "output_mode": "content", "-n": True}),
        ]
        for tool, tool_input in openings:
            with self.subTest(tool=tool, tool_input=tool_input):
                state = Path(tempfile.mkdtemp()).resolve()
                self.addCleanup(shutil.rmtree, state, True)
                guard.note_reads(self.checkout.payload(tool, tool_input), state)
                self.assertIsNone(guard.judge_call(self.checkout.edit("deps/workspace.yaml"), state))

    def test_no_bash_command_opens_the_record_since_its_text_cannot_say_what_ran(self):
        absolute = self.checkout.root / DOCUMENT
        commands = [
            f"rg -n lib {DOCUMENT}",
            f"rg -n 'no-such-package' {absolute}",
            f"rg -l lib {DOCUMENT}",
            f"rg -m 0 x {DOCUMENT}",
            "rg -n lib docs",
            f"bat {DOCUMENT}",
            f"bat --plain {DOCUMENT} | head -5",
            f"batcat {DOCUMENT}",
            f"false && rg x {DOCUMENT}",
            f"true || rg x {DOCUMENT}",
            f"exit 0; rg x {DOCUMENT}",
            f"if false; then rg x {DOCUMENT}; fi",
            f"cd /nonexistent && rg x {absolute}",
        ]
        for command in commands:
            with self.subTest(command=command):
                state = Path(tempfile.mkdtemp()).resolve()
                self.addCleanup(shutil.rmtree, state, True)
                self.assertEqual(guard.note_reads(self.checkout.bash(command), state), 0)
                self.assertFalse((state / ic.STATE_DIR).exists())
                refusal = guard.judge_call(self.checkout.edit("deps/workspace.yaml"), state)
                self.assertIn("has not opened that record yet", refusal)

    def test_what_does_not_open_the_record_does_not_count(self):
        root = self.checkout.root
        others = [
            ("Bash", {"command": f"rg -n {DOCUMENT} CLAUDE.md"}),
            ("Bash", {"command": f"rg --files {DOCUMENT}"}),
            ("Bash", {"command": f"head -n 0 {DOCUMENT}"}),
            ("Bash", {"command": f"head -c 1 {DOCUMENT}"}),
            ("Bash", {"command": f"tail -n 5 {DOCUMENT}"}),
            ("Bash", {"command": f"wc -l {DOCUMENT}"}),
            ("Bash", {"command": f"test -f {DOCUMENT}"}),
            ("Bash", {"command": f"eza -l {DOCUMENT}"}),
            ("Bash", {"command": "fd record.md docs"}),
            ("Bash", {"command": f"python3 scripts/read.py {DOCUMENT}"}),
            ("Bash", {"command": f"echo {DOCUMENT}"}),
            ("Bash", {"command": f"cd $HOME && rg lib {DOCUMENT}"}),
            ("Grep", {"pattern": "lib", "path": "docs", "glob": "*.ts"}),
            ("Grep", {"pattern": "lib", "path": "docs", "glob": "!*.md"}),
            ("Grep", {"pattern": "lib", "path": "docs", "type": "py"}),
            ("Read", {"file_path": str(root / "docs" / "other.md")}),
            ("Read", {"file_path": str(root / "elsewhere" / DOCUMENT)}),
        ]
        for tool, tool_input in others:
            with self.subTest(tool=tool, tool_input=tool_input):
                self._note(self.checkout.payload(tool, tool_input))
        self.assertEqual(self.checkout.reads(), [])
        self.assertIsNotNone(self._judge(self.checkout.edit("deps/workspace.yaml")))

    def test_a_file_named_as_the_record_in_a_repository_with_no_manifest_opens_nothing(self):
        other = Checkout(self, name="other", base=self.checkout.base, manifest=False)

        self._note(self.checkout.payload("Read", {"file_path": str(other.root / DOCUMENT)}))
        self._note(self.checkout.payload("Grep", {"pattern": "lib", "path": str(other.root / DOCUMENT)}))

        self.assertEqual(self.checkout.reads(), [])
        self.assertIsNotNone(self._judge(self.checkout.edit("deps/workspace.yaml")))
        self.assertIsNone(self._judge(other.edit("deps/workspace.yaml")))

    def test_an_edit_of_the_record_itself_passes(self):
        self.assertIsNone(self._judge(self.checkout.edit(DOCUMENT)))

    def test_a_governed_file_whose_record_is_missing_is_refused(self):
        self._note(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}))
        (self.checkout.root / DOCUMENT).unlink()

        refusal = self._judge(self.checkout.edit("deps/workspace.yaml"))

        self.assertIn(f"{DOCUMENT} is missing in {self.checkout.root}", refusal)

    def test_a_file_in_a_sibling_checkout_is_judged_by_that_checkout_and_opened_from_any_checkout(self):
        sibling = Checkout(self, name="sibling", base=self.checkout.base)
        sibling.write(RULE, rule_text("infra/*.yaml"))
        sibling.write("deps/workspace.yaml", "lib: 9.9.9\n")
        state = self.checkout.root

        self.assertIsNone(guard.judge_call(sibling.edit("deps/workspace.yaml", agent=AGENT), state))
        self.assertIsNotNone(guard.judge_call(sibling.edit("infra/base.yaml", agent=AGENT), state))
        guard.note_reads(sibling.payload("Grep", {"pattern": "lib", "path": str(self.checkout.root / DOCUMENT)}, agent=AGENT), state)
        self.assertIsNone(guard.judge_call(sibling.edit("infra/base.yaml", agent=AGENT), state))

    def test_a_checkout_without_a_manifest_is_not_this_project_and_passes(self):
        (self.checkout.root / ic.MANIFEST).unlink()

        self.assertIsNone(self._judge(self.checkout.edit("deps/workspace.yaml")))

    def test_a_file_outside_every_repository_passes(self):
        outside = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, outside, True)
        payload = self.checkout.payload("Write", {"file_path": str(outside / "deps" / "x.yaml"), "content": ""})

        self.assertIsNone(self._judge(payload))

    def test_a_malformed_manifest_refuses_every_edit_but_one_of_the_manifest(self):
        self.checkout.write(ic.MANIFEST, "{ not json")

        self.assertIn("is not JSON", self._judge(self.checkout.edit("src/app.ts")))
        self.assertIsNone(self._judge(self.checkout.edit(ic.MANIFEST)))

    def test_a_rule_that_does_not_prove_its_scope_refuses_every_edit_but_one_of_the_rule_or_the_manifest(self):
        self.checkout.write(RULE, "---\npaths: deps/*.yaml\n---\n\nbody\n")

        self.assertIn(f"{RULE} does not open with the paths: front matter", self._judge(self.checkout.edit("src/app.ts")))
        self.assertIsNone(self._judge(self.checkout.edit(RULE)))
        self.assertIsNone(self._judge(self.checkout.edit(ic.MANIFEST)))

    def test_a_missing_rule_refuses_every_edit_but_one_of_the_rule_or_the_manifest(self):
        (self.checkout.root / RULE).unlink()

        self.assertIn(f"{RULE} could not be read", self._judge(self.checkout.edit("src/app.ts")))
        self.assertIsNone(self._judge(self.checkout.edit(RULE)))

    def test_an_edit_with_no_file_path_is_refused(self):
        self.assertIn("names no file", self._judge(self.checkout.payload("Edit", {"old_string": "a"})))

    def test_a_governed_edit_from_a_session_with_no_usable_id_is_refused(self):
        payload = self.checkout.edit("deps/workspace.yaml")
        payload["session_id"] = "../escape"

        self.assertIn("no usable session id", self._judge(payload))


class BashJudgementTests(unittest.TestCase):
    """A Bash command is judged by the files it writes, as the header lists."""

    def setUp(self):
        self.checkout = Checkout(self)
        self.checkout.write("apps/web/package.json", "{}\n")

    def _judge(self, command: str, **kwargs) -> str | None:
        return guard.judge_call(self.checkout.bash(command, **kwargs), self.checkout.root)

    def test_each_derived_write_of_a_governed_file_is_refused_with_the_rule(self):
        writes = [
            "sd -i a b deps/workspace.yaml",
            "sd a b deps/workspace.yaml",
            "sed -i s/a/b/ deps/workspace.yaml",
            "echo lib: 2 > deps/workspace.yaml",
            "echo lib: 2 >> deps/new.yaml",
            "printf x | tee deps/workspace.yaml",
            "cp /tmp/x apps/web/package.json",
            "rm deps/workspace.yaml",
            "cd deps && sd x y workspace.yaml",
            'bash -c "echo x > deps/workspace.yaml"',
            "git checkout -- deps/workspace.yaml",
            "pnpm add left-pad",
            "pnpm -C apps/web add left-pad",
            "pnpm --filter web add left-pad",
            "pnpm rm left-pad",
            "pnpm uninstall left-pad",
            "pnpm up",
            "pnpm upgrade lib",
            "pnpm -r update",
            "pnpm install",
            "pnpm i",
            "pnpm install --frozen-lockfile=false",
            "pnpm dedupe",
            "pnpm import",
            "pnpm patch-commit /tmp/patch-dir",
            "pnpm patch-remove lib",
            "pnpm --unknown-flag value add lib",
            "pnpm audit --fix",
            "pnpm recursive add lib",
            "pnpm m install",
            "corepack pnpm add lib",
            "npx pnpm add lib",
            "npx -y pnpm@12.6.0 add lib",
            "bash -c 'pnpm add lib'",
            "echo $(pnpm add lib)",
            "bash -c \"bash -c 'sd a b deps/workspace.yaml'\"",
        ]
        for command in writes:
            with self.subTest(command=command):
                refusal = self._judge(command)
                self.assertIsNotNone(refusal)
                self.assertIn("The record guard refused this Bash command:", refusal)
                self.assertIn(RULE_BODY.strip(), refusal)

    def test_a_command_that_writes_no_governed_file_passes(self):
        for command in (
            "rg -n lib deps/workspace.yaml",
            "bat deps/workspace.yaml",
            "echo x > /tmp/out.txt",
            "sd a b src/app.ts",
            "pnpm install --frozen-lockfile",
            "pnpm i --frozen-lockfile",
            "pnpm dedupe --check",
            "pnpm ci",
            "pnpm view lib version",
            "pnpm run build",
            "pnpm --filter web test",
            "pnpm recursive test",
            "pnpm",
            "pnpm --version",
            "corepack pnpm list",
            "npx pnpm test",
            "bash -c 'pnpm view lib'",
        ):
            with self.subTest(command=command):
                self.assertIsNone(self._judge(command))

    def test_an_argument_longer_than_a_file_name_is_judged_as_a_name_and_does_not_crash_the_guard(self):
        phrase = "x" * 5000
        self.assertIsNone(self._judge(f"sd 'old text' '{phrase}' src/app.ts"))
        self.assertIsNone(guard.judge_call(self.checkout.edit(phrase), self.checkout.root))
        refusal = self._judge(f"sd 'old text' '{phrase}' deps/workspace.yaml")
        self.assertIn("The record guard refused this Bash command:", refusal)

    def test_an_opening_in_the_same_bash_command_does_not_open_the_record(self):
        for command in (
            f"rg -n lib {DOCUMENT} && sd -i a b deps/workspace.yaml",
            f"echo lib: 2 > deps/workspace.yaml; rg -n zz {DOCUMENT}",
            f"rg -n lib {DOCUMENT} && pnpm add left-pad",
        ):
            with self.subTest(command=command):
                self.assertIn("has not opened that record yet", self._judge(command))

    def test_a_write_after_a_read_of_the_record_passes(self):
        self.assertIsNotNone(self._judge("pnpm add left-pad"))

        guard.note_reads(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}), self.checkout.root)

        self.assertIsNone(self._judge("pnpm add left-pad"))
        self.assertIsNone(self._judge(f"rg -n lib {DOCUMENT} && sd -i a b deps/workspace.yaml"))

    def test_a_command_that_cannot_be_read_is_refused_when_its_text_could_name_a_governed_write(self):
        for command, named in (
            ("echo 'unclosed > deps/workspace.yaml", "workspace.yaml"),
            ("echo 'unclosed > apps/web/package.json", "package.json"),
            ("echo 'unclosed && pnpm add lib", "the word pnpm"),
            ("printf $'a\\'b\\n' > deps/new.yaml", "new.yaml"),
        ):
            with self.subTest(command=command):
                refusal = self._judge(command)
                self.assertIn("cannot be read as shell words", refusal)
                self.assertIn(named, refusal)

    def test_a_command_that_cannot_be_read_and_names_no_governed_write_passes(self):
        for command in ("printf $'a\\'b\\n'", "echo 'unclosed > notes.txt", 'echo "it\'s'):
            with self.subTest(command=command):
                self.assertIsNone(self._judge(command))

    def test_the_names_an_unreadable_command_is_held_to_come_from_the_rule(self):
        self.checkout.write(RULE, rule_text("infra/*.toml", "patches/**"))

        self.assertIsNone(self._judge("echo 'unclosed > deps/workspace.yaml"))
        self.assertIsNone(self._judge("echo 'unclosed > other/a.patch"))
        self.assertIn("base.toml", self._judge("echo 'unclosed > infra/base.toml"))
        self.assertIn("patches", self._judge("echo 'unclosed > patches/a.patch"))

    def test_a_command_that_cannot_be_read_is_refused_when_the_rule_cannot_be_read(self):
        self.checkout.write(ic.MANIFEST, "{ not json")

        refusal = self._judge("printf $'a\\'b\\n'")

        self.assertIn("cannot be read as shell words", refusal)
        self.assertIn("is not JSON", refusal)


# One example per condition of `PNPM_WRITES`: commands it judges, and commands it
# lets through. `{set}` and `{delete}` are the action `config` takes and `set`
# does not.
WRITE_EXAMPLES = {
    "always": (["{c}", "{c} lib"], []),
    "unless-frozen": (
        ["{c}", "{c} --frozen-lockfile=false", "{c} --no-frozen-lockfile", "{c} --frozen-lockfile --fix-lockfile",
         "{c} --frozen-lockfile --lockfile-only", "{c} --frozen-lockfile --update-checksums"],
        ["{c} --frozen-lockfile", "{c} --frozen-lockfile=true", "{c} --offline --frozen-lockfile"],
    ),
    "with-lockfile-flag": (
        ["{c} --no-frozen-lockfile", "{c} --frozen-lockfile=false", "{c} --fix-lockfile", "{c} --lockfile-only",
         "{c} --prefer-frozen-lockfile", "{c} --merge-git-branch-lockfiles", "{c} --lockfile"],
        ["{c}", "{c} --frozen-lockfile", "{c} --offline"],
    ),
    "with-fix": (["{c} --fix", "{c} --fix=update", "{c} --fix override", "{c} -i", "{c} --interactive"], ["{c}", "{c} --json"]),
    "unless-check": (["{c}", "{c} --lockfile-only"], ["{c} --check"]),
    "with-lockfile": (["{c} --lockfile"], ["{c}"]),
    "project-location": (
        ["{c} {set}k v --location project", "{c} {set}k v --location=project", "{c} {delete}k --location project"],
        ["{c} {set}k v", "{c} {set}k v --location global", "{c} {set}k v -g"],
    ),
    "pkg-write": (["{c} set a=b", "{c} delete a", "{c} fix"], ["{c} get name", "{c}"]),
}


def installed_pnpm_commands(test: unittest.TestCase) -> tuple[str, set[str]]:
    """The version of the pnpm on PATH and every command and alias its `pnpm
    help` lists, read from the `Commands:` section (pnpm 12.6.0 refuses `pnpm
    help -a`; `pnpm help` lists every command with its aliases). It runs in an
    empty directory, so no project's `packageManager` field picks another pnpm."""
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        test.fail("pnpm is not on PATH, so the classification of its commands cannot be held to the installed pnpm")
    with tempfile.TemporaryDirectory() as cwd:
        version = subprocess.run([pnpm, "--version"], cwd=cwd, capture_output=True, text=True, timeout=60, check=True).stdout.strip()
        text = subprocess.run([pnpm, "help"], cwd=cwd, capture_output=True, text=True, timeout=60, check=True).stdout
    lines = text.splitlines()
    if "Commands:" not in lines:
        test.fail(f"pnpm {version} help has no Commands: section, so its commands cannot be read")
    names: set[str] = set()
    for line in lines[lines.index("Commands:") + 1:]:
        match = re.match(r"^  ([a-z][a-z0-9-]*)(?:\s{2,}(.*))?$", line)
        if match is None:
            break
        names.add(match.group(1))
        aliases = re.search(r"\[alias(?:es)?: ([^\]]+)\]\s*$", match.group(2) or "")
        if aliases:
            names.update(alias.strip() for alias in aliases.group(1).split(","))
    if len(names) < 50 or not {"add", "install", "help"} <= names:
        test.fail(f"read {len(names)} commands from pnpm {version} help, which is not its whole list")
    return version, names


class PnpmClassificationTests(unittest.TestCase):
    """Every builtin of the installed pnpm is classified: it writes a manifest,
    the lockfile or the workspace file (judged), it does not, or it runs code
    the guard cannot read (unjudged, a stated residual)."""

    def setUp(self):
        self.checkout = Checkout(self)

    def _judge(self, command: str) -> str | None:
        return guard.judge_call(self.checkout.bash(command), self.checkout.root)

    def test_every_builtin_of_the_installed_pnpm_is_in_exactly_one_class(self):
        version, listed = installed_pnpm_commands(self)
        classes = {
            "PNPM_WRITES": set(guard.PNPM_WRITES),
            "PNPM_LEAVES": set(guard.PNPM_LEAVES),
            "PNPM_RUNS_CODE": set(guard.PNPM_RUNS_CODE),
            "PNPM_PREFIXES": set(guard.PNPM_PREFIXES),
        }
        for (first, left), (second, right) in itertools.combinations(classes.items(), 2):
            self.assertEqual(sorted(left & right), [], f"commands in both {first} and {second}")
        classified = set().union(*classes.values())
        self.assertEqual(
            sorted(listed - classified), [],
            f"pnpm {version} lists commands in no class: classify each by what `pnpm help <command>` says it writes",
        )
        self.assertEqual(sorted(classified - listed), [], f"classified names pnpm {version} does not list: delete them")

    def test_each_command_that_writes_is_judged_by_the_flags_that_decide_it(self):
        self.assertEqual(set(WRITE_EXAMPLES), set(guard.PNPM_WRITES.values()))
        for command, condition in sorted(guard.PNPM_WRITES.items()):
            action = "" if command == "set" else None
            words = {"set": "set " if action is None else "", "delete": "delete " if action is None else ""}
            judged, passed = WRITE_EXAMPLES[condition]
            for template in judged:
                text = "pnpm " + template.format(c=command, **words)
                with self.subTest(command=text):
                    refusal = self._judge(text)
                    self.assertIsNotNone(refusal)
                    self.assertIn(RULE_BODY.strip(), refusal)
            for template in passed:
                text = "pnpm " + template.format(c=command, **words)
                with self.subTest(command=text):
                    self.assertIsNone(self._judge(text))

    def test_each_command_that_does_not_write_or_that_runs_code_passes(self):
        for command in sorted(guard.PNPM_LEAVES | guard.PNPM_RUNS_CODE):
            for text in (f"pnpm {command}", f"pnpm -r {command} x", f"corepack pnpm {command}"):
                with self.subTest(command=text):
                    self.assertIsNone(self._judge(text))


class GlobTests(unittest.TestCase):
    def test_globs_read_as_the_harness_reads_them(self):
        cases = [
            ("deps/*.yaml", "deps/a.yaml", True),
            ("deps/*.yaml", "deps/sub/a.yaml", False),
            ("**/package.json", "package.json", True),
            ("**/package.json", "apps/web/package.json", True),
            ("package.json", "apps/web/package.json", True),
            ("/package.json", "apps/web/package.json", False),
            ("/package.json", "package.json", True),
            ("patches/**", "patches/a/b.patch", True),
            ("patches/**", "patchesx/a", False),
            ("**/Dockerfile*", "apps/api/Dockerfile.prod", True),
            ("docs/{a,b}.md", "docs/b.md", True),
            ("docs/{a,b}.md", "docs/c.md", False),
            ("scripts/testing/holds-gate.mjs", "scripts/testing/holds-gate.mjs", True),
            ("scripts/testing/holds-gate.mjs", "scripts/testing/holds-gateXmjs", False),
            ("deps/?.yaml", "deps/a.yaml", True),
            ("deps/[ab].yaml", "deps/b.yaml", True),
        ]
        for glob, path, expected in cases:
            with self.subTest(glob=glob, path=path):
                self.assertEqual(guard.glob_matches(glob, path), expected)

    def test_a_rule_is_read_only_in_the_form_the_gate_requires(self):
        self.assertEqual(guard.parse_rule(rule_text("a/*.md", "b/**")), (["a/*.md", "b/**"], RULE_BODY))
        for text in ("no front matter\n", "---\npaths: a\n---\n", "---\npaths:\n  - a/*.md\n---\n", "---\npaths:\n---\n", '---\npaths:\n  - "a"\n'):
            with self.subTest(text=text):
                self.assertIsNone(guard.parse_rule(text))


class GuardProcessTests(unittest.TestCase):
    def setUp(self):
        self.checkout = Checkout(self)
        self.checkout.install_hooks()

    def test_a_refused_edit_exits_2_with_the_rule_on_stderr(self):
        result = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"))

        self.assertEqual(result.returncode, 2)
        self.assertIn(RULE_BODY.strip(), result.stderr)

    def test_a_refused_bash_write_exits_2_and_a_read_only_command_exits_0(self):
        write = self.checkout.run_hook(self.checkout.bash("sd -i a b deps/workspace.yaml"))
        read = self.checkout.run_hook(self.checkout.bash("rg -n lib deps/workspace.yaml"))

        self.assertEqual(write.returncode, 2)
        self.assertIn("deps/workspace.yaml is governed by the record", write.stderr)
        self.assertEqual((read.returncode, read.stderr), (0, ""))

    def test_an_edit_after_a_grep_of_the_record_exits_0(self):
        search = self.checkout.run_hook(self.checkout.payload("Grep", {"pattern": "lib", "path": DOCUMENT}), mode="record")
        edit = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"))

        self.assertEqual((search.returncode, search.stdout, search.stderr), (0, "", ""))
        self.assertEqual((edit.returncode, edit.stderr), (0, ""))

    def test_the_record_mode_records_nothing_for_a_bash_search_and_the_edit_after_it_exits_2(self):
        search = self.checkout.run_hook(self.checkout.bash(f"rg -n lib {DOCUMENT}"), mode="record")
        edit = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"))

        self.assertEqual((search.returncode, search.stdout, search.stderr), (0, "", ""))
        self.assertFalse((self.checkout.root / ic.STATE_DIR).exists())
        self.assertEqual(edit.returncode, 2)
        self.assertIn("A Bash command does not count", edit.stderr)

    def test_a_command_that_cannot_be_read_exits_2_only_when_it_could_name_a_governed_write(self):
        governed = self.checkout.run_hook(self.checkout.bash("echo 'unclosed > deps/workspace.yaml"))
        other = self.checkout.run_hook(self.checkout.bash("printf $'a\\'b\\n'"))

        self.assertEqual(governed.returncode, 2)
        self.assertIn("cannot be read as shell words", governed.stderr)
        self.assertEqual((other.returncode, other.stderr), (0, ""))

    def test_the_record_mode_never_judges_and_the_judge_mode_never_records(self):
        record = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"), mode="record")
        judge = self.checkout.run_hook(self.checkout.bash(f"rg -n lib {DOCUMENT}"))

        self.assertEqual((record.returncode, record.stderr), (0, ""))
        self.assertEqual(judge.returncode, 0)
        self.assertEqual(self.checkout.reads(), [])

    def test_a_read_that_names_no_markdown_file_records_nothing(self):
        result = self.checkout.run_hook(self.checkout.payload("Read", {"file_path": str(self.checkout.root / "deps" / "workspace.yaml")}), mode="record")

        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.checkout.root / ic.STATE_DIR).exists())

    def test_input_that_is_not_json_is_refused_by_the_judge_and_ignored_by_the_recorder(self):
        judge = self.checkout.run_hook("{ not json")
        record = self.checkout.run_hook("{ not json", mode="record")

        self.assertEqual(judge.returncode, 2)
        self.assertIn("could not read its input", judge.stderr)
        self.assertEqual((record.returncode, record.stderr), (0, ""))

    def test_a_guard_run_without_its_mode_refuses(self):
        result = self.checkout.run_hook(self.checkout.edit("src/app.ts"), mode="")

        self.assertEqual(result.returncode, 2)
        self.assertIn("ran without its mode", result.stderr)

    def test_an_exception_refuses_a_judged_call_and_never_a_recorded_read(self):
        (self.checkout.root / "tooling" / "hooks" / "_instruction_context.py").write_text("raise RuntimeError('planted failure')\n")

        edit = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"))
        bash = self.checkout.run_hook(self.checkout.bash("echo x > deps/workspace.yaml"))
        read = self.checkout.run_hook(self.checkout.payload("Read", {"file_path": str(self.checkout.root / DOCUMENT)}), mode="record")

        self.assertEqual(edit.returncode, 2)
        self.assertIn("The record guard failed (RuntimeError: planted failure) and refuses this Edit", edit.stderr)
        self.assertEqual(bash.returncode, 2)
        self.assertEqual((read.returncode, read.stderr), (0, ""))

    def test_the_guard_and_the_shared_module_name_the_same_switch(self):
        self.assertEqual(guard.SWITCH_ENV, ic.SWITCH_ENV)

    def test_the_switch_lets_a_governed_write_through_and_logs_it(self):
        result = self.checkout.run_hook(self.checkout.edit("deps/workspace.yaml"), switch="yes")
        bash = self.checkout.run_hook(self.checkout.bash("pnpm add lib"), switch="yes")

        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual((bash.returncode, bash.stderr), (0, ""))
        log = (self.checkout.root / ".claude" / "hooks.log").read_text()
        self.assertIn(f"[{guard.HOOK_NAME}] SWITCH: {ic.SWITCH_ENV}=yes, Edit of {self.checkout.root}/deps/workspace.yaml not judged", log)
        self.assertIn(f"[{guard.HOOK_NAME}] SWITCH: {ic.SWITCH_ENV}=yes, Bash of pnpm add lib not judged", log)


if __name__ == "__main__":
    unittest.main()
