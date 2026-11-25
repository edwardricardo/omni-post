"""Tests of pre_bash: what a command really writes, Postgres probed, npx."""

import contextlib
import io
import json
import socketserver
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402
import pre_bash  # noqa: E402
import pre_edit_planmode_guard as planmode  # noqa: E402
from _common import repository_of, shell_segments  # noqa: E402

# Built in pieces: the LIVE pre_bash of the session that wrote this read the
# command text and blocked on these strings inside a heredoc.
MIGRATE = "pnpm db:" + "migrate"
PRISMA_MIGRATE = "pnpm prisma " + "migrate deploy"
NPM_INSTALL = "npm " + "install left-pad"


class _Gate(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._log = mock.patch.object(_common, "LOG_PATH", Path(self._tmp.name) / "hooks.log")
        self._log.start()

    def tearDown(self):
        self._log.stop()
        self._tmp.cleanup()

    def _verdict(self, gate, *args) -> str:
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                gate(*args)
            except SystemExit as raised:
                return f"blocked({raised.code})"
        return "allowed"


class PublicationGateTests(_Gate):
    """With no publication token, only a real publication is blocked."""

    def setUp(self):
        super().setUp()
        self._tokens = mock.patch.object(_common, "ALLOWED_TOKENS_DIR", Path(self._tmp.name) / "allowed")
        self._tokens.start()

    def tearDown(self):
        self._tokens.stop()
        super().tearDown()

    def test_a_line_that_only_names_the_token_path_is_not_blocked(self):
        line = "git status --porcelain && jq -r .expires_at /root/omni-post/.claude/.allowed/" + "push"
        self.assertEqual(self._verdict(pre_bash.gate_git_push_requires_token, line), "allowed")

    def test_a_real_publication_without_a_token_is_blocked(self):
        line = "cd /wt && git " + "push --atomic origin a:refs/heads/a"
        self.assertEqual(self._verdict(pre_bash.gate_git_push_requires_token, line), "blocked(2)")


class GateOrderTests(_Gate):
    """A valid push token authorizes the publication, not the rest of the line:
    the publication gate used to exit early and skip every gate after it."""

    def setUp(self):
        super().setUp()
        store = Path(self._tmp.name) / "allowed"
        store.mkdir()
        (store / "push").write_text(json.dumps({"operation": "push", "expires_at": "2099-01-01T00:00:00+00:00"}))
        self._tokens = mock.patch.object(_common, "ALLOWED_TOKENS_DIR", store)
        self._tokens.start()

    def tearDown(self):
        self._tokens.stop()
        super().tearDown()

    def _main(self, command: str) -> int:
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": self._tmp.name})
        with mock.patch("sys.stdin", io.StringIO(payload)), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                pre_bash.main()
        return raised.exception.code

    def test_a_valid_push_token_does_not_let_the_rest_of_the_line_through(self):
        self.assertEqual(self._main("git push origin a"), 0, "the token is valid")
        self.assertEqual(self._main("git push origin a && echo x > .claude/settings.json"), 2)


class SensitiveWriteGateTests(_Gate):
    """Without a token: blocks only when a write construct POINTS AT the path."""

    def setUp(self):
        super().setUp()
        self._token = mock.patch.object(pre_bash, "check_grant_token", return_value="missing")
        self._token.start()

    def tearDown(self):
        self._token.stop()
        super().tearDown()

    def _gate(self, command: str) -> str:
        return self._verdict(pre_bash.gate_sensitive_path_writes_require_token, command)

    def test_a_heredoc_that_only_names_the_path_is_not_a_write_to_it(self):
        self.assertEqual(self._gate("cat > /tmp/x.py <<'EOF'\nprint('.claude/hooks-py/_common.py')\nEOF"), "allowed")

    def test_read_only_redirections_are_not_writes(self):
        self.assertEqual(self._gate("python3 -m unittest discover -s .claude/hooks-py/tests 2>/dev/null"), "allowed")
        self.assertEqual(self._gate("rg -n x .github/workflows/ci.yml 2>&1 | tail -3"), "allowed")
        self.assertEqual(self._gate("bat infra/prisma/schema.prisma"), "allowed")

    def test_a_redirection_or_tee_onto_the_path_is_a_write(self):
        self.assertEqual(self._gate("echo x > .claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("echo x >.claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("printf y >>../.env"), "blocked(2)")
        self.assertEqual(self._gate("printf y >> ../.env"), "blocked(2)")
        self.assertEqual(self._gate("cat x | tee -a .github/workflows/ci.yml"), "blocked(2)")

    def test_the_rule_that_counts_the_error_sites_is_written_only_with_a_token(self):
        self.assertEqual(self._gate("echo x > packages/eslint-plugin-errors/src/index.js"), "blocked(2)")
        self.assertEqual(self._gate("printf y >> scripts/testing/lib/error-scope.mjs"), "blocked(2)")
        self.assertEqual(self._gate("cp /tmp/gate.mjs scripts/testing/error-sites-gate.mjs"), "blocked(2)")

    def test_reading_the_rule_or_writing_its_neighbours_is_not_blocked(self):
        self.assertEqual(self._gate("node scripts/testing/error-sites-gate.mjs --base main"), "allowed")
        self.assertEqual(self._gate("rg -n S9 scripts/testing/error-sites-gate.mjs | tail -3"), "allowed")
        self.assertEqual(self._gate("echo x > scripts/testing/error-registry-gate.mjs"), "allowed")
        self.assertEqual(self._gate("echo x > packages/eslint-plugin-testing/src/index.js"), "allowed")

    def test_the_reminder_the_stall_alarm_speaks_through_is_written_only_with_a_token(self):
        self.assertEqual(self._gate("echo x > scripts/testing/lib/issue-reminder.mjs"), "blocked(2)")
        self.assertEqual(self._gate("cp /tmp/quiet.mjs scripts/testing/lib/issue-reminder.mjs"), "blocked(2)")

    def test_reading_the_reminder_or_running_a_gate_that_uses_it_is_not_blocked(self):
        self.assertEqual(self._gate("rg -n remindIssues scripts/testing/lib/issue-reminder.mjs"), "allowed")
        self.assertEqual(self._gate("node scripts/testing/patched-dependencies-gate.mjs --remind"), "allowed")
        self.assertEqual(self._gate("node scripts/testing/error-sites-gate.mjs --stalled --days 14 --remind"), "allowed")

    def test_deleting_or_copying_onto_the_path_is_a_write(self):
        self.assertEqual(self._gate("rm -rf .claude/hooks-py/tests"), "blocked(2)")
        self.assertEqual(self._gate("cp .env.example .env"), "blocked(2)")
        self.assertEqual(self._gate("mv x infra/prisma/migrations/0001"), "blocked(2)")

    def test_reading_a_sensitive_source_to_copy_it_elsewhere_is_not_a_write_to_it(self):
        self.assertEqual(self._gate("cp .env /tmp/x"), "allowed")

    def test_constructs_whose_target_is_in_code_block_by_mention(self):
        self.assertEqual(self._gate("sd -i 'a' 'b' .claude/hooks-py/x.py"), "blocked(2)")
        self.assertEqual(self._gate("python3 -c \"open('.env','w')\""), "blocked(2)")
        self.assertEqual(self._gate("git checkout -- .claude/hooks-py/_common.py"), "blocked(2)")

    def test_an_untokenizable_command_falls_back_to_mention(self):
        self.assertEqual(self._gate("echo 'x > .claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("rm -rf .claude/hooks-py/tests 'unclosed"), "blocked(2)")

    def test_a_valid_token_lets_the_write_through(self):
        with mock.patch.object(pre_bash, "check_grant_token", return_value=None):
            self.assertEqual(self._gate("echo x > .claude/settings.json"), "allowed")

    def test_moving_a_hook_away_or_switching_it_off_is_a_write(self):
        self.assertEqual(self._gate("mv .claude/hooks-py/pre_bash.py /tmp/x"), "blocked(2)")
        self.assertEqual(self._gate("chmod -x .claude/hooks-py/pre_bash.py"), "blocked(2)")
        self.assertEqual(self._gate("touch .claude/settings.json"), "blocked(2)")
        self.assertEqual(self._gate("rm -rf .claude/hooks-py"), "blocked(2)")

    def test_a_write_after_a_newline_or_inside_a_shell_script_is_a_write(self):
        self.assertEqual(self._gate("ls\nrm -rf .claude/hooks-py/tests"), "blocked(2)")
        self.assertEqual(self._gate('bash -c "rm -rf .claude/hooks-py/tests"'), "blocked(2)")
        self.assertEqual(self._gate("echo x >| .claude/settings.json"), "blocked(2)")

    def test_an_untokenizable_line_with_a_file_redirection_or_an_interpreter_stays_refused(self):
        for command in (
            "echo 'x' 2>/dev/null > .env 'unclosed",
            "echo x 2>&1 >.claude/settings.json 'unclosed",
            "echo x >& .github/workflows/ci.yml 'unclosed",
            "echo x >>.env 'unclosed",
            "python3 -c \"import os; os.remove('.env')\" 'unclosed 2>/dev/null",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_a_real_write_in_code_or_in_command_position_stays_refused_through_every_construct(self):
        for command in (
            'bash -c "sed -i s/a/b/ .claude/settings.json"',
            "sh -c 'git checkout -- .github/workflows/ci.yml'",
            'eval "sed -i s/a/b/ .env"',
            "eval 'git checkout -- .env'",
            "echo .env | xargs sed -i s/a/b/",
            "env LC_ALL=C sed -i s/a/b/ .env",
            "sudo sed -i s/a/b/ .env",
            "nohup perl -i -pe s/a/b/ .env",
            "time sed -i s/a/b/ .env",
            "python3 -c \"open('.env','w').write('x')\"",
            "node -e \"require('fs').writeFileSync('.env','x')\"",
            "bash <<'EOF'\nsed -i s/a/b/ .env\nEOF",
            "python3 - <<'EOF'\nopen('.env','w')\nEOF",
            "cat <<'EOF' | bash\ngit checkout -- .env\nEOF",
            "ls | sed -i s/a/b/ .env",
            "true && git checkout -- .env",
            "false || git restore .env",
            "ls; sd -i a b .env",
            'echo "$(sed -i s/a/b/ .env)"',
            "echo `git checkout -- .env`",
            "cat <(sed -i s/a/b/ .env)",
            "ls\nsed -i s/a/b/ .env",
            "watch -n1 'sed -i s/a/b/ .env'",
            "git -C . checkout -- .env",
            "/usr/bin/sed -i s/a/b/ .env",
            'git rebase --exec "sed -i s/a/b/ .env" HEAD~1',
            "git -c core.pager='sed -i s/a/b/ .env' log",
            'GIT_EDITOR="sed -i s/a/b/ .env" git commit',
            "cat > /tmp/w.mjs <<'EOF'\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], 'x')\nEOF\nnode /tmp/w.mjs .env",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_code_handed_to_another_program_is_read_with_the_whole_line(self):
        for command in (
            "echo 'sed -i s/a/b/ .env' | bash",
            "printf '%s\\n' 'git checkout -- .env' | sh",
            "bash <<< 'sed -i s/a/b/ .env'",
            "python3 <<< \"open('.env','w').write('x')\"",
            "python3 - <<< \"open('.env','w').write('x')\"",
            ". <(echo 'sed -i s/a/b/ .env')",
            "c='sed -i s/a/b/ .env'; $c",
            "c='sed -i s/a/b/ .env' && eval \"$c\"",
            "export GIT_EDITOR='sed -i s/a/b/ .env'; git commit --amend",
            "declare -x GIT_EDITOR='sed -i s/a/b/ .env'; git commit --amend",
            "awk 'BEGIN{system(\"sed -i s/a/b/ .env\")}'",
            "vim -es -c '!sed -i s/a/b/ .env' -c q",
            "make --eval='x:; sed -i s/a/b/ .env' x",
            "tar -cf /dev/null /etc/hostname --checkpoint=1 --checkpoint-action=exec='sed -i s/a/b/ .env'",
            "gdb -batch -ex 'shell sed -i s/a/b/ .env'",
            "rsync -e 'sh -c \"sed -i s/a/b/ .env\"' a b",
            "find . -exec python3 -c \"open('.env','w')\" \\;",
            "/usr/bin/python3 -c \"open('.env','w')\"",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_an_untokenizable_redirection_to_a_file_stays_refused(self):
        for command in ("echo x >| .env 'unclosed", "rg x .env > /dev/null.bak 'unclosed", "rg x .env >/dev/nullx 'unclosed"):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_a_git_write_through_a_global_option_is_refused_when_its_own_words_name_the_path(self):
        for command in (
            "git -C /root/omni-post checkout -- .claude/hooks-py/x.py",
            "git --exec-path=/tmp/x checkout -- .claude/hooks-py/x.py",
            "git --config-env=core.pager=PAGER checkout -- .claude/settings.json",
            "git -c core.x=y restore .claude/settings.json",
            "git --git-dir=/r/.git --work-tree=/r rm .github/workflows/ci.yml",
            'bash -c "git -C /r checkout -- .env"',
            "eval 'git -C /r checkout -- .env'",
            "echo \"$(git -C /r checkout -- .env)\"",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_a_git_write_two_scripts_deep_is_refused(self):
        self.assertEqual(self._gate("bash -c \"bash -c 'git -C /root/omni-post checkout -- .claude/hooks-py/x.py'\""), "blocked(2)")
        self.assertEqual(self._gate("bash -c \"bash -c '/usr/bin/sed -i s/a/b/ .claude/settings.json'\""), "blocked(2)")

    def test_an_unreadable_sibling_does_not_switch_the_word_reading_off(self):
        self.assertEqual(self._gate("git -C /root/omni-post checkout -- .claude/hooks-py/x.py; echo \"$(echo 'unclosed)\""), "blocked(2)")

    def test_a_script_that_cannot_be_read_is_judged_by_mention(self):
        for command in (
            "echo \"$(git -C /r checkout -- .claude/hooks-py/x.py 'unclosed)\"",
            "echo \"$(/usr/bin/sed -i s/a/b/ .claude/settings.json 'unclosed)\"",
            "git -C /r restore .claude/settings.json 'unclosed",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._gate(command), "blocked(2)")

    def test_a_git_write_in_a_deep_unquoted_substitution_is_refused(self):
        deep = "echo " + "$(echo " * 12 + "git -C /r checkout -- .claude/hooks-py/x.py" + ")" * 12
        self.assertEqual(self._gate(deep), "blocked(2)")

    def test_a_script_past_the_depth_limit_is_judged_by_mention(self):
        # Each level quotes the next, so no word of an outer level holds the write.
        command = "bash -c \"bash -c 'git -C /r checkout -- .claude/hooks-py/x.py'\""
        pre_bash.script_words.cache_clear()
        self.addCleanup(pre_bash.script_words.cache_clear)
        with mock.patch.object(pre_bash, "MAX_SHELL_DEPTH", 1):
            self.assertEqual(pre_bash.strict_write_patterns(command), {"/.claude/hooks-py/"})
            self.assertEqual(self._gate(command), "blocked(2)")

    def test_an_unreadable_sibling_that_names_no_guarded_path_adds_no_refusal(self):
        for command in (
            "git -C /tmp/wt checkout -q main; echo \"$(echo 'unclosed)\"",
            "rg -n x src/app.ts; echo \"$(git -C /tmp/wt checkout -q main 'unclosed)\"",
            "echo \"$(echo checkout .env; git status 'unclosed)\"",
        ):
            with self.subTest(command=command):
                self.assertEqual(pre_bash.strict_write_patterns(command), set())
                self.assertEqual(self._gate(command), "allowed")

    def test_the_word_reading_judges_only_the_paths_a_command_names_itself(self):
        self.assertEqual(pre_bash.strict_write_patterns("git -C /r checkout -- .claude/hooks-py/x.py"), {"/.claude/hooks-py/"})
        self.assertEqual(pre_bash.strict_write_patterns("/usr/bin/sed -i s/a/b/ .env"), {"/.env"})
        self.assertEqual(pre_bash.strict_write_patterns("set -a; . ./.env.test; set +a; git -C /tmp/wt checkout -q main"), set())
        self.assertEqual(pre_bash.strict_write_patterns("git -C /r log -- .env"), set())
        # The patterns read these lines whole; the word reading adds only what they miss.
        self.assertEqual(pre_bash.strict_write_patterns("perl -i -pe s/a/b/ .env"), set())
        self.assertEqual(pre_bash.strict_write_patterns('rg "sed -i" .env'), set())
        self.assertEqual(self._gate("set -a; . ./.env.test; set +a; git -C /tmp/wt checkout -q main"), "allowed")

    def test_a_relative_write_is_read_from_the_directory_it_is_written_in(self):
        self.assertEqual(self._gate("cd .claude && rm -rf hooks-py"), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_sensitive_path_writes_require_token, "echo x > pre_bash.py", Path("/r/.claude/hooks-py")), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_sensitive_path_writes_require_token, "echo x > notes.md", Path("/r/docs")), "allowed")


class WriteTargetsTests(unittest.TestCase):
    def test_targets_named_by_the_command(self):
        self.assertEqual(pre_bash.write_targets("echo x > a.txt && tee -a b.txt < c && rm -rf -- d e"), ["a.txt", "b.txt", "d", "e"])
        self.assertEqual(pre_bash.write_targets("cmd 2>/dev/null 2>&1 | tail"), [])
        self.assertEqual(pre_bash.write_targets("dd if=x of=y bs=1"), ["y"])
        self.assertEqual(pre_bash.write_targets("FOO=1 sudo cp a b"), ["b"])
        self.assertEqual(pre_bash.write_targets("cp -r a b dir/ && ln -s t l && rm a b"), ["dir/", "l", "a", "b"])

    def test_every_redirection_that_writes_names_its_target(self):
        self.assertEqual(pre_bash.write_targets("a >| f && b <> g && c >& h && d >&2 && e >&-"), ["f", "g", "h"])

    def test_mv_writes_its_sources_and_touch_and_chmod_their_operands(self):
        self.assertEqual(pre_bash.write_targets("mv a b dir/"), ["a", "b", "dir/"])
        self.assertEqual(pre_bash.write_targets("touch a && chmod 600 b && chown u:g c"), ["a", "600", "b", "u:g", "c"])

    def test_effective_targets_follow_cd_and_nested_scripts(self):
        self.assertEqual(
            pre_bash.effective_write_targets("cd sub && touch a && cd /abs && touch b", Path("/r")),
            ["/r/sub/a", "/abs/b"],
        )
        self.assertEqual(pre_bash.effective_write_targets("bash -c 'touch a'", Path("/r")), ["/r/a"])
        self.assertEqual(pre_bash.effective_write_targets("cd - && touch a", Path("/r")), ["a"])

    def test_untokenizable_is_none(self):
        self.assertIsNone(pre_bash.write_targets("echo 'unclosed"))

    def test_shell_segments(self):
        self.assertEqual(shell_segments("a b && c|d; e"), [["a", "b"], ["c"], ["d"], ["e"]])
        self.assertIsNone(shell_segments("echo 'unclosed"))


class NpxGateTests(_Gate):
    def test_npx_is_blocked_like_npm(self):
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "npx cowsay hi"), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, NPM_INSTALL), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "pnpm dlx cowsay hi"), "allowed")

    def test_a_package_tool_run_in_command_position_or_in_code_stays_refused(self):
        for command in (
            "npx lint-staged",
            "/usr/bin/npx lint-staged",
            "yarn add left-pad",
            "sudo npm install -g x",
            "env FOO=1 npx foo",
            "nohup npx foo",
            "time npx foo",
            "echo a | xargs npx foo",
            'bash -c "npx foo"',
            "sh -c 'npm install x'",
            'eval "npm install x"',
            'echo "$(npx foo)"',
            "echo `npx foo`",
            "cat <(npx foo)",
            "bash <<'EOF'\nnpx foo\nEOF",
            "python3 -c \"import os; os.system('cd /x && npx foo')\"",
            "node -e \"require('child_process').execSync('cd /x && npx foo')\"",
            # Code handed to an interpreter cannot be read as shell words: a mention there counts.
            "python3 - <<'EOF'\ntext = 'never npx lint-staged'\nEOF",
            "ls\nnpx foo",
            "ls | npx foo",
            "true && yarn install",
            "ls; npm ci",
            "npx foo 'unclosed",
            "(npx knip --reporter json > /tmp/k.json)",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, command), "blocked(2)")

    def test_the_word_reading_refuses_only_the_runs_the_convention_names(self):
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "/usr/bin/npm install x"), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "/usr/bin/npm view left-pad version"), "allowed")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "(/usr/bin/npx)"), "allowed")

    def test_a_package_tool_in_code_handed_to_another_program_stays_refused(self):
        for command in (
            "echo 'cd /x && npx foo' | bash",
            "printf '%s\\n' 'cd /x && npm install y' | sh",
            "bash <<< 'cd /x && npx foo'",
            "python3 <<< \"import os; os.system('cd /x && npx foo')\"",
            ". <(echo 'cd /x && npx foo')",
            "c='cd /x && npx foo'; $c",
            "c='cd /x && npx foo' && eval \"$c\"",
            "export GIT_EDITOR='cd /x && npx foo'; git commit --amend",
            "declare -x GIT_EDITOR='cd /x && npx foo'; git commit --amend",
            "awk 'BEGIN{system(\"cd /x && npx foo\")}'",
            "vim -es -c '!cd /x && npx foo' -c q",
            "make --eval='x:; cd /x && npx foo' x",
            "tar -cf /dev/null /etc/hostname --checkpoint=1 --checkpoint-action=exec='cd /x && npx foo'",
            "gdb -batch -ex 'shell cd /x && npx foo'",
            "rsync -e 'sh -c \"cd /x && npx foo\"' a b",
        ):
            with self.subTest(command=command):
                self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, command), "blocked(2)")

    def test_a_package_tool_in_a_script_that_cannot_be_read_is_judged_by_mention(self):
        for command in (
            "echo \"$(/usr/bin/npx foo 'unclosed)\"",
            "echo \"$(npm install x 'unclosed)\"",
            "(yarn add x 'unclosed)",
            "echo " + "$(echo " * 12 + "/usr/bin/npx foo" + ")" * 12,
        ):
            with self.subTest(command=command):
                self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, command), "blocked(2)")

    def test_an_unreadable_sibling_that_names_no_tool_adds_no_refusal(self):
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "pnpm dlx x; echo \"$(echo 'unclosed)\""), "allowed")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "echo \"$(pnpm exec npxx 'unclosed)\""), "allowed")

    def test_a_package_tool_two_scripts_deep_is_refused(self):
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "bash -c \"bash -c 'npx foo'\""), "blocked(2)")
        self.assertEqual(self._verdict(pre_bash.gate_no_npm_yarn_or_npx, "echo \"$(echo \\\"$(/usr/bin/npx foo)\\\")\""), "blocked(2)")


class _CountingPattern:
    """A compiled pattern whose searches are counted."""

    def __init__(self, pattern, counter: list[int]):
        self._pattern = pattern
        self._counter = counter

    def search(self, text):
        self._counter[0] += 1
        return self._pattern.search(text)


class WordReadingCostTests(_Gate):
    """A hook that times out does not refuse: the word reading must stay linear
    in the length of the command, whatever its shape."""

    def setUp(self):
        super().setUp()
        self._token = mock.patch.object(pre_bash, "check_grant_token", return_value="missing")
        self._token.start()

    def tearDown(self):
        self._token.stop()
        super().tearDown()

    @staticmethod
    def _many_editors(count: int) -> str:
        return "true .claude/settings.json" + " sed" * count + "; sed -i s/a/b/ .claude/settings.json"

    @staticmethod
    def _many_gits(count: int, subcommand: str = "checkout") -> str:
        return "git" + " -C git" * count + f" {subcommand} -- .claude/settings.json"

    def _searches(self, command: str) -> int:
        counter = [0]
        patterns = [_CountingPattern(rx, counter) for rx in pre_bash.COARSE_WRITE_RES]
        with mock.patch.object(pre_bash, "COARSE_WRITE_RES", patterns):
            self.assertEqual(self._verdict(pre_bash.gate_sensitive_path_writes_require_token, command), "blocked(2)")
        return counter[0]

    def test_the_in_place_reading_searches_once_per_command_not_once_per_word(self):
        few, many = self._searches(self._many_editors(10)), self._searches(self._many_editors(1000))
        self.assertEqual(few, many, "searches must not grow with the number of editor words")
        with mock.patch.object(pre_bash, "_in_place_edit", wraps=pre_bash._in_place_edit) as reading:
            self._verdict(pre_bash.gate_sensitive_path_writes_require_token, self._many_editors(1000))
        self.assertLessEqual(reading.call_count, 2, "one reading per command of the line")

    def test_the_git_reading_walks_each_word_once(self):
        for subcommand, verdict in (("checkout", "blocked(2)"), ("status", "allowed")):
            with self.subTest(subcommand=subcommand):
                with mock.patch.object(_common, "_git_subcommand_at", wraps=_common._git_subcommand_at) as walk:
                    self.assertEqual(self._verdict(pre_bash.gate_sensitive_path_writes_require_token, self._many_gits(1000, subcommand)), verdict)
                self.assertLessEqual(walk.call_count, 2, "a git word an earlier git consumed as an option value is not walked again")

    def test_a_hostile_command_of_8_kb_is_decided_in_under_2_seconds(self):
        import time

        for command in (
            self._many_editors(2000),
            self._many_gits(1200),
            self._many_gits(1200, "status"),
            "echo " + "$(echo " * 1000 + ")" * 1000,
        ):
            with self.subTest(size=len(command), head=command[:20]):
                started = time.monotonic()
                self._verdict(pre_bash.gate_sensitive_path_writes_require_token, command)
                self._verdict(pre_bash.gate_no_npm_yarn_or_npx, command)
                self.assertLess(time.monotonic() - started, 2.0)

    def test_the_one_pass_reading_agrees_with_the_in_place_pattern(self):
        import random

        pieces = ["sed", "sd", "perl", "ruby", "-i", "-in", "-i.bak", "ased", "sedx", "x", "|", ";", " ", "\n", "'", "s/a/b/", "-", "i"]
        rng = random.Random(20261125)
        for _ in range(4000):
            text = "".join(rng.choice(pieces) for _ in range(rng.randint(0, 12)))
            with self.subTest(text=text):
                self.assertEqual(pre_bash._in_place_edit(text), pre_bash.COARSE_WRITE_RES[0].search(text) is not None)


class MigrateGateTests(_Gate):
    def _listening_port(self) -> int:
        server = socketserver.TCPServer(("127.0.0.1", 0), socketserver.BaseRequestHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        return server.server_address[1]

    def test_database_url_is_read_from_the_root_env_file(self):
        root = Path(self._tmp.name)
        (root / ".env").write_text('OTHER=1\nDATABASE_URL="postgresql://u:p@db.example:5433/omnipostdb?schema=public"\n')
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": ""}):
            self.assertEqual(pre_bash.database_target(), ("db.example", 5433))
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root / "nowhere"), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": "postgres://u:p@h/x"}):
            self.assertEqual(pre_bash.database_target(), ("h", 5432))
        with mock.patch.object(pre_bash, "PROJECT_ROOT", root / "nowhere"), mock.patch.dict(pre_bash.os.environ, {"DATABASE_URL": ""}):
            self.assertIsNone(pre_bash.database_target())

    def test_migrate_is_blocked_only_when_postgres_does_not_answer(self):
        port = self._listening_port()
        with mock.patch.object(pre_bash, "database_target", return_value=("127.0.0.1", port)):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, MIGRATE), "allowed")
        with mock.patch.object(pre_bash, "postgres_reachable", return_value=False), mock.patch.object(pre_bash, "database_target", return_value=("127.0.0.1", 1)):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, PRISMA_MIGRATE), "blocked(2)")
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, "ls"), "allowed")
        with mock.patch.object(pre_bash, "database_target", return_value=None):
            self.assertEqual(self._verdict(pre_bash.gate_db_migrations_require_running_db, MIGRATE), "allowed")

    def test_postgres_reachable_measures_a_socket(self):
        self.assertTrue(pre_bash.postgres_reachable("127.0.0.1", self._listening_port()))
        self.assertFalse(pre_bash.postgres_reachable("127.0.0.1", 1, timeout=0.5))


class EditedRepositoryTests(unittest.TestCase):
    def test_the_plan_mode_guard_judges_the_edited_files_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            (repo / ".git").mkdir(parents=True)
            inside = repo / "apps" / "x.ts"
            inside.parent.mkdir(parents=True)
            inside.write_text("")
            self.assertEqual(repository_of(inside), repo)
            self.assertIsNone(repository_of(Path(tmp) / "elsewhere" / "y.ts"))
            self.assertEqual(planmode.edited_repository(str(inside)), repo.resolve())
            with mock.patch.object(planmode, "PROJECT_ROOT", Path("/fallback")):
                self.assertEqual(planmode.edited_repository(str(Path(tmp) / "elsewhere" / "y.ts")), Path("/fallback"))


if __name__ == "__main__":
    unittest.main()
