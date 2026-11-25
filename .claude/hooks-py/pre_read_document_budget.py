#!/usr/bin/env python3
"""PreToolUse hook — a budget of bytes an agent may read of one document in a
session, so that a document is queried rather than read whole and read again.

What it enforces. A document is a file whose name ends in one of
`DOCUMENT_SUFFIXES`; source code is not one, since a writer reads the code it
changes. A document at or under `BUDGET_BYTES` is never refused. For a larger
one the hook keeps a ledger per session, per agent (the main session or a
subagent, by the `agent_id` of the hook input) and per file, of the spans read
and the bytes they cover, in `.claude/state/instruction-context/
<session_id>.document-reads.jsonl`, which git ignores. A call is refused when
the union of the spans this agent already read of the file, with the new ones,
would cover more than the budget; reading a span again adds nothing. A span
counts only for the file as it was when it was read, by its size and its
modification time: a log appended to or an output regenerated since is counted
afresh.

- `Read`: the span is `offset` and `limit` (an integer, a float or a numeric
  string); with no `limit` the tool reads `READ_DEFAULT_LIMIT` lines from
  `offset`, and a `limit` of zero or below reads nothing.
- `Bash`: a command is judged only when it is plain: it holds no subshell or
  group (`(`, `)`, `{`, `}`), no command or process substitution (`$(`, a
  backtick, `<(`, `>(`), no heredoc or here-string (`<<`, `<<<`), and no
  command whose program is a shell, `eval` or `xargs`. A command that is not
  plain is allowed, unrecorded and unlogged: the guard is against a habit, and
  a structure it would have to interpret is where its wrong refusals came from.
  In a plain command, read with the hooks' own tokenizer (`_common`), the
  readers are `bat` (`-r`, `--line-range`), `cat`, `tac`, `nl`, `less`, `more`,
  `head` and `tail` (`-n`, `-c`, with their default of 10 lines) and `sed -n`
  with line-number `p` commands only, behind a wrapper of `_WRAPPERS`
  (`timeout`, `env`, `command`, `nice`, `sudo`) or not, from a file named or
  from a redirected standard input (`cat < f`). No range is the whole file.
  What reaches the agent is the output of a pipeline's last command, so a
  reader whose output feeds a search, a computation or a ranged filter
  (`cat f | rg x`, `cat f | bat -r 1:20`) or goes to a file (`cat f > g`) is
  not a read, and one that feeds only a pager (`cat f | less`, a `bat` with no
  range) is. A command that searches or computes (`rg`, `jq`, `wc`,
  `awk`, a script) is never counted: querying is the way past. A `cd` that is
  a command of its own moves the directory files resolve against; one inside a
  pipeline of several commands does not.
- The ledger is read and written under one lock, so two calls of one session
  made in parallel are judged one after the other. A call waits for it at most
  `LOCK_WAIT_SECONDS`; past that the ledger is a fault. An allowed read is
  recorded before the call runs, and stays recorded if the call then fails.

How it fails. A refusal exits 2 with the document's size, the budget, how much
of it this agent has read and the way past. A fault of the hook (an input it
cannot parse, a command the tokenizer cannot read, a file it cannot stat or
read, a ledger it cannot read or write) allows the call and writes one line to
the hooks' log: the guard protects a budget, not a secret, and it never stops a
session by its own error. A range it cannot compute (`bat -r $L:+8`) skips
that reader alone, with a log line. It reads a file only when the file is a document
above the budget and the span does not reach from its first byte to its last,
and only the part the span needs. No token and no variable switches it off: the
budget changes by a pull request.

RETIRED WHEN: the harness itself budgets what an agent reads of one file, or no
tracked document above the budget remains and the plan's parser serves every
read of the plan.
"""

import bisect
import contextlib
import fcntl
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import BinaryIO

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common  # noqa: E402
import _instruction_context as ic  # noqa: E402

HOOK_NAME = "pre-read-document-budget"
log, _block, _allow = _common.make_logger(HOOK_NAME)

BUDGET_BYTES = 40_000
DOCUMENT_SUFFIXES = frozenset({".md", ".mdx", ".txt", ".json", ".jsonl", ".tsv", ".csv", ".log"})
READ_DEFAULT_LIMIT = 2_000
HEAD_TAIL_DEFAULT_LINES = 10
LEDGER_KIND = "document-reads"
MAIN_AGENT = "main"
REFUSING_EXIT_CODE = 2
# How long a call waits for the ledger another call holds, and how often it
# tries again: past the bound the ledger is a fault, and the call is allowed.
LOCK_WAIT_SECONDS = 2.0
_LOCK_RETRY_SECONDS = 0.02
_CHUNK_BYTES = 1 << 20

# A span request, resolved against the file into a byte interval [lo, hi):
#   ("lines", first, last)   lines first..last, 1-based and inclusive; last None is the end
#   ("last_lines", n)        the last n lines
#   ("but_last_lines", n)    every line but the last n
#   ("bytes", lo, hi)        bytes lo..hi, 0-based and half-open; hi None is the end
#   ("last_bytes", n)        the last n bytes
#   ("but_last_bytes", n)    every byte but the last n
Request = tuple
WHOLE: Request = ("lines", 1, None)

# The one tokenizing pass, called through this name so a test can count it.
_lex = _common._lex

# What makes a command not plain: text that opens a command substitution (in
# double quotes too), a heredoc or a here-string; a bracket the tokenizer reads
# as an operator or a group word, which a process substitution `<(`, `>(` also
# leaves; and a program that runs commands it is handed.
_NOT_PLAIN_TEXT = ("<<", "`", "$(")
_NOT_PLAIN_TOKENS = frozenset({"(", ")", "{", "}"})
_NOT_PLAIN_PROGRAMS = _common._SHELLS | {"eval", "xargs"}

_PIPES = frozenset({"|", "|&"})
_READERS = frozenset({"bat", "cat", "tac", "nl", "less", "more", "head", "tail", "sed"})
# Programs that run the command after their own options and operands, with the
# options that take a value and how many operands come before the command.
_WRAPPERS = {
    "timeout": (frozenset({"-s", "--signal", "-k", "--kill-after"}), 1),
    "env": (frozenset({"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}), 0),
    "command": (frozenset(), 0),
    "nice": (frozenset({"-n", "--adjustment"}), 0),
    "sudo": (frozenset({"-u", "--user", "-g", "--group", "-C", "--close-from", "-D", "--chdir", "--host",
                        "-p", "--prompt", "-r", "--role", "-t", "--type", "-T", "--command-timeout", "-U",
                        "--other-user"}), 0),
}
# The options of a wrapper after which it runs no command: `command -v` looks a
# program up; `sudo -l` lists, `-v` refreshes the credentials, `-K` removes
# them and `-h` prints help (sudo's manual). `sudo -k` with a command runs it.
_RUNS_NOTHING = {
    "command": frozenset({"-v", "-V"}),
    "sudo": frozenset({"-l", "--list", "-v", "--validate", "-K", "--remove-timestamp", "-h", "--help"}),
}
# A program that passes its input through unchanged: after a reader, it leaves
# what reaches the agent as the reader printed it.
_PASS_THROUGH = frozenset({"bat", "cat", "nl", "less", "more", "tee"})
_BAT_VALUE_OPTIONS = frozenset(
    {"-l", "--language", "-H", "--highlight-line", "--style", "--theme", "--tabs", "--wrap", "-m",
     "--map-syntax", "--color", "--decorations", "--italic-text", "--paging", "--pager",
     "--terminal-width", "--file-name", "--diff-context", "--ignored-suffix", "--squeeze-limit",
     "--nonprintable-notation", "--binary", "--strip-ansi"}
)
_BAT_SHORT_VALUE_LETTERS = frozenset("rlHm")
# The short options that take a value, per reader of whole files.
_WHOLE_FILE_VALUE_LETTERS = {
    "cat": frozenset(),
    "tac": frozenset("s"),
    "nl": frozenset("bdfhilnsvw"),
    "less": frozenset("bhjkoOpPtTxyz#"),
    "more": frozenset("n"),
}
_TAIL_VALUE_OPTIONS = frozenset({"-s", "--sleep-interval", "--pid", "--max-unchanged-stats"})
_SED_VALUE_OPTIONS = frozenset({"-l", "--line-length"})
_SIZE_SUFFIXES = {
    "": 1, "b": 512, "k": 1024, "K": 1024, "KB": 1000, "KiB": 1024, "M": 1024**2, "MB": 1000**2,
    "MiB": 1024**2, "G": 1024**3, "GB": 1000**3, "GiB": 1024**3,
}
_COUNT_RE = re.compile(r"^([+-]?)(\d+)([A-Za-z]*)$")
_NUMBER_RE = re.compile(r"^\s*[+-]?\d+(?:\.\d*)?\s*$")
_BAT_RANGE_RE = re.compile(r"^(\d*)(?::(\+?)(\d*))?$")
_SED_PRINT_RE = re.compile(r"^(?:(\d+|\$)(?:,(\d+|\$|\+\d+))?)?p$")


class UnreadableRange(ValueError):
    """A range option whose value the hook cannot read: a fault, which allows."""


class LedgerBusy(OSError):
    """The ledger stayed locked past `LOCK_WAIT_SECONDS`: a fault, which allows."""


def _open_document(path: str) -> BinaryIO:
    """The only place the hook opens a file, so its reads can be counted."""
    return open(path, "rb")


class _Document:
    """A document above the budget, opened at most once, and only for a span
    that does not reach from its first byte to its last."""

    def __init__(self, path: str, size: int) -> None:
        self.path = path
        self.size = size
        self._handle: BinaryIO | None = None

    def _file(self) -> BinaryIO:
        if self._handle is None:
            self._handle = _open_document(self.path)
        return self._handle

    def close(self) -> None:
        if self._handle is not None:
            self._handle.close()

    def after_newlines(self, count: int) -> int:
        """The byte offset just after the `count`-th newline; the size when the
        file holds fewer."""
        if count <= 0:
            return 0
        handle = self._file()
        handle.seek(0)
        seen = position = 0
        while chunk := handle.read(_CHUNK_BYTES):
            found = chunk.count(b"\n")
            if seen + found >= count:
                index = -1
                for _ in range(count - seen):
                    index = chunk.index(b"\n", index + 1)
                return position + index + 1
            seen += found
            position += len(chunk)
        return self.size

    def start_of_last_lines(self, count: int) -> int:
        """The byte offset where the last `count` lines begin."""
        if count <= 0:
            return self.size
        handle = self._file()
        handle.seek(self.size - 1)
        needed = count + (1 if handle.read(1) == b"\n" else 0)
        seen, position = 0, self.size
        while position > 0:
            step = min(_CHUNK_BYTES, position)
            position -= step
            handle.seek(position)
            chunk = handle.read(step)
            found = chunk.count(b"\n")
            if seen + found >= needed:
                index = len(chunk)
                for _ in range(needed - seen):
                    index = chunk.rindex(b"\n", 0, index)
                return position + index + 1
            seen += found
        return 0

    def span(self, request: Request) -> tuple[int, int]:
        kind = request[0]
        if kind == "lines":
            first, last = request[1], request[2]
            if first <= 1 and last is None:
                return 0, self.size
            lo = self.after_newlines(first - 1)
            hi = self.size if last is None else self.after_newlines(last)
            return lo, max(lo, hi)
        if kind == "last_lines":
            return self.start_of_last_lines(request[1]), self.size
        if kind == "but_last_lines":
            return 0, self.start_of_last_lines(request[1])
        if kind == "bytes":
            lo = min(max(request[1], 0), self.size)
            hi = self.size if request[2] is None else min(max(request[2], lo), self.size)
            return lo, hi
        if kind == "last_bytes":
            return max(self.size - request[1], 0), self.size
        if kind == "but_last_bytes":
            return 0, max(self.size - request[1], 0)
        raise ValueError(f"unknown span request {request!r}")


def merged(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """The union of `spans` as sorted, disjoint intervals."""
    union: list[tuple[int, int]] = []
    for lo, hi in sorted(span for span in spans if span[1] > span[0]):
        if union and lo <= union[-1][1]:
            union[-1] = (union[-1][0], max(union[-1][1], hi))
        else:
            union.append((lo, hi))
    return union


def covered(spans: list[tuple[int, int]]) -> int:
    """The bytes the union of `spans` covers."""
    return sum(hi - lo for lo, hi in merged(spans))


def _contains(union: list[tuple[int, int]], span: tuple[int, int]) -> bool:
    """Whether the disjoint, sorted `union` already covers `span`."""
    if span[1] <= span[0]:
        return True
    index = bisect.bisect_right(union, (span[0], float("inf"))) - 1
    return index >= 0 and union[index][0] <= span[0] and union[index][1] >= span[1]


# --- what a call reads ------------------------------------------------------


def _resolve(cwd: str, word: str) -> str:
    return os.path.realpath(os.path.join(cwd, os.path.expanduser(word)))


def _cwd(data: dict) -> str:
    cwd = data.get("cwd")
    return cwd if isinstance(cwd, str) and os.path.isabs(cwd) else str(ic.PROJECT_ROOT)


def _add(reads: dict[str, list[Request]], path: str, requests: list[Request]) -> None:
    reads.setdefault(path, []).extend(requests)


def _read_tool_reads(tool_input: dict, cwd: str) -> dict[str, list[Request]]:
    path = tool_input.get("file_path")
    if not isinstance(path, str) or not path:
        return {}
    offset = _whole_number(tool_input.get("offset"))
    limit = _whole_number(tool_input.get("limit"))
    first = offset if offset is not None and offset > 1 else 1
    count = READ_DEFAULT_LIMIT if limit is None else limit
    # A count of zero or below ends before it starts: a span of no byte.
    return {_resolve(cwd, path): [("lines", first, first + count - 1)]}


def _whole_number(value: object) -> int | None:
    """A number of lines the tool input may carry as an integer, a float or a
    numeric string; None for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if math.isfinite(value) else None
    if isinstance(value, str) and _NUMBER_RE.match(value):
        return int(float(value))
    return None


def _count(value: str) -> tuple[str, int]:
    """The sign and the number of a `head`/`tail` count (`20`, `-5`, `+3`, `2K`)."""
    match = _COUNT_RE.match(value)
    if not match or match.group(3) not in _SIZE_SUFFIXES:
        raise UnreadableRange(f"unreadable count {value!r}")
    return match.group(1), int(match.group(2)) * _SIZE_SUFFIXES[match.group(3)]


def _bat_range(value: str) -> Request:
    match = _BAT_RANGE_RE.match(value)
    if not match or (not match.group(1) and not match.group(3)):
        raise UnreadableRange(f"unreadable bat range {value!r}")
    first = int(match.group(1)) if match.group(1) else 1
    if ":" not in value:
        return ("lines", first, first)
    if not match.group(3):
        return ("lines", first, None)
    last = int(match.group(3))
    return ("lines", first, first + last if match.group(2) else last)


def _bat(arguments: list[str]) -> tuple[list[str], list[Request]]:
    files: list[str] = []
    ranges: list[Request] = []
    i = 0
    while i < len(arguments):
        arg = arguments[i]
        i += 1
        if arg == "--":
            files.extend(arguments[i:])
            break
        if arg == "--line-range":
            if i < len(arguments):
                ranges.append(_bat_range(arguments[i]))
            i += 1
        elif arg.startswith("--line-range="):
            ranges.append(_bat_range(arg.split("=", 1)[1]))
        elif arg in _BAT_VALUE_OPTIONS:
            i += 1
        elif arg.startswith("--"):
            continue
        elif arg.startswith("-") and arg != "-":
            for position, letter in enumerate(arg[1:], start=1):
                if letter in _BAT_SHORT_VALUE_LETTERS:
                    value = arg[position + 1:]
                    if not value and i < len(arguments):
                        value = arguments[i]
                        i += 1
                    if letter == "r":
                        ranges.append(_bat_range(value))
                    break
        else:
            files.append(arg)
    return files, ranges or [WHOLE]


def _whole_file_reader(arguments: list[str], short_value_letters: frozenset[str]) -> tuple[list[str], list[Request]]:
    """`cat`, `nl`, `less`, `more`: every file named, whole."""
    files: list[str] = []
    i = 0
    while i < len(arguments):
        arg = arguments[i]
        i += 1
        if arg == "--":
            files.extend(arguments[i:])
            break
        if arg.startswith("+") or arg.startswith("--") or arg == "-":
            continue
        if arg.startswith("-"):
            for position, letter in enumerate(arg[1:], start=1):
                if letter in short_value_letters:
                    if position == len(arg) - 1:
                        i += 1
                    break
            continue
        files.append(arg)
    return files, [WHOLE]


def _head_tail(program: str, arguments: list[str]) -> tuple[list[str], list[Request]]:
    files: list[str] = []
    unit, value = "lines", None
    i = 0
    while i < len(arguments):
        arg = arguments[i]
        i += 1
        if arg == "--":
            files.extend(arguments[i:])
            break
        option = None
        if arg in ("-n", "--lines", "-c", "--bytes"):
            option = arg
            value = arguments[i] if i < len(arguments) else None
            i += 1
        elif arg.startswith(("--lines=", "--bytes=")):
            option, value = arg.split("=", 1)
        elif re.match(r"^-[nc].+", arg):
            option, value = arg[:2], arg[2:]
        elif re.match(r"^-\d+$", arg) or (program == "tail" and re.match(r"^\+\d+$", arg) and not files):
            option, value = "-n", arg if arg.startswith("+") else arg[1:]
        elif arg in _TAIL_VALUE_OPTIONS:
            i += 1
        elif arg.startswith("-") and arg != "-":
            continue
        else:
            files.append(arg)
        if option is not None:
            unit = "bytes" if option in ("-c", "--bytes") else "lines"
    if value is None:
        request: Request = ("lines", 1, HEAD_TAIL_DEFAULT_LINES) if program == "head" else ("last_lines", HEAD_TAIL_DEFAULT_LINES)
        return files, [request]
    sign, number = _count(value)
    if program == "head":
        if sign == "-":
            return files, [("but_last_bytes" if unit == "bytes" else "but_last_lines", number)]
        return files, [("bytes", 0, number) if unit == "bytes" else ("lines", 1, number)]
    if sign == "+":
        return files, [("bytes", max(number - 1, 0), None) if unit == "bytes" else ("lines", max(number, 1), None)]
    return files, [("last_bytes" if unit == "bytes" else "last_lines", number)]


def _sed_requests(scripts: list[str]) -> list[Request] | None:
    """The spans of a `sed -n` script made only of line-number `p` commands;
    None for any other script, which computes rather than prints a range: a
    quit command (`10q`) among them too, since where it stops depends on the
    order the lines are printed in."""
    requests: list[Request] = []
    for script in scripts:
        for command in re.split(r"[;\n]", script):
            command = command.strip()
            if not command:
                continue
            match = _SED_PRINT_RE.match(command)
            if not match:
                return None
            start, end = match.group(1), match.group(2)
            if start is None:
                requests.append(WHOLE)
            elif start == "$":
                requests.append(("last_lines", 1))
            elif end is None:
                requests.append(("lines", int(start), int(start)))
            elif end == "$":
                requests.append(("lines", int(start), None))
            elif end.startswith("+"):
                requests.append(("lines", int(start), int(start) + int(end[1:])))
            else:
                requests.append(("lines", int(start), max(int(start), int(end))))
    return requests or None


def _sed(arguments: list[str]) -> tuple[list[str], list[Request]]:
    quiet = False
    scripts: list[str] = []
    rest: list[str] = []
    i = 0
    while i < len(arguments):
        arg = arguments[i]
        i += 1
        if arg in ("-n", "--quiet", "--silent"):
            quiet = True
        elif arg in ("-e", "--expression"):
            if i < len(arguments):
                scripts.append(arguments[i])
            i += 1
        elif arg.startswith("--expression="):
            scripts.append(arg.split("=", 1)[1])
        elif arg in ("-f", "--file") or arg.startswith(("--file=", "-i", "--in-place")):
            return [], []
        elif arg in _SED_VALUE_OPTIONS:
            i += 1
        elif arg.startswith("-") and arg != "-" and not arg.startswith("--"):
            letters = arg[1:]
            quiet = quiet or "n" in letters
            if "i" in letters or "f" in letters:
                return [], []
            if letters.endswith("e") and i < len(arguments):
                scripts.append(arguments[i])
                i += 1
        elif arg.startswith("--"):
            continue
        else:
            rest.append(arg)
    if not scripts and rest:
        scripts.append(rest.pop(0))
    requests = _sed_requests(scripts) if quiet else None
    return (rest, requests) if requests else ([], [])


def _program_words(words: list[str]) -> list[str] | None:
    """The program a command runs and its arguments, past the command prefixes
    and the wrappers of `_WRAPPERS`; None when it runs none (an option of
    `_RUNS_NOTHING`)."""
    index = _common.program_index(words)
    while index is not None and index < len(words):
        name = Path(words[index]).name
        if name not in _WRAPPERS:
            return words[index:]
        value_options, operands = _WRAPPERS[name]
        index += 1
        while index < len(words):
            word = words[index]
            if word == "--":
                index += 1
                break
            if word in _RUNS_NOTHING.get(name, ()):
                return None
            if word in value_options:
                index += 2
            elif word.startswith("-") and word != "-":
                index += 1
            elif name == "env" and _common.ENV_ASSIGNMENT_RE.match(word):
                index += 1
            else:
                break
        index += operands
    return None


def _stdin_file(segment: list[str]) -> str | None:
    """The file a command's standard input is redirected from (`< f`)."""
    for index, token in enumerate(segment[:-1]):
        if token == "<":
            return segment[index + 1]
    return None


def _reader_words(segment: list[str]) -> list[str]:
    """`_common.command_words`, except that a number before `<` stays a word.
    The tokens do not keep the space between them, so `head -n 30 < f` and
    `3< f` look alike; before an input redirection, a reader's number is its
    count far more often than a descriptor."""
    if "<" not in segment:
        return _common.command_words(segment)
    marked: list[str] = []
    for token in segment:
        if token == "<" and marked and marked[-1].isdigit():
            marked.append("")
        marked.append(token)
    return [word for word in _common.command_words(marked) if word != ""]


def _reader(segment: list[str]) -> tuple[str, list[str], list[Request]] | None:
    """The program, files and spans of one command, when it is a reader. A
    reader named no file reads its redirected standard input, when there is one."""
    words = _program_words(_reader_words(segment))
    if not words:
        return None
    program = Path(words[0]).name
    if program not in _READERS and program != "tee":
        return None
    arguments = words[1:]
    if program == "tee":
        return program, [], []
    if program == "bat":
        files, requests = _bat(arguments)
    elif program in ("head", "tail"):
        files, requests = _head_tail(program, arguments)
    elif program == "sed":
        files, requests = _sed(arguments)
    else:
        files, requests = _whole_file_reader(arguments, _WHOLE_FILE_VALUE_LETTERS[program])
    files = [f for f in files if f != "-"]
    if not files and requests:
        stdin = _stdin_file(segment)
        files = [stdin] if stdin is not None else []
    return program, files, requests


def _known_reader(segment: list[str]) -> tuple[str, list[str], list[Request]] | None:
    """`_reader`, with a range the hook cannot compute (a shell variable) read
    as a fault of this reader alone: it is skipped and logged, and the other
    readers of the command are still judged."""
    try:
        return _reader(segment)
    except UnreadableRange as error:
        _fault(error, "the reader is not counted")
        return None


def _pipelines(tokens: list[str]) -> list[list[list[str]]]:
    """The commands of a token list, grouped into pipelines."""
    pipelines: list[list[list[str]]] = [[[]]]
    for token in tokens:
        if token in _PIPES:
            pipelines[-1].append([])
        elif token in _common._SHELL_SEPARATORS:
            pipelines.append([[]])
        else:
            pipelines[-1][-1].append(token)
    return [[segment for segment in pipeline if segment] for pipeline in pipelines if any(pipeline)]


def _prints_to_a_file(segment: list[str]) -> bool:
    """Whether the command sends its standard output to a file, where it does
    not reach the agent. A duplication onto another descriptor (`>&2`, `2>&1`)
    still reaches it: the tool captures both streams."""
    for index, token in enumerate(segment):
        if not token.startswith(">") and token not in ("&>", "&>>"):
            continue
        if index > 0 and segment[index - 1].isdigit() and segment[index - 1] != "1":
            continue
        if not (token == ">&" and index + 1 < len(segment) and segment[index + 1].isdigit()):
            return True
    return False


def _new_directory(words: list[str] | None, cwd: str) -> str:
    """The directory after a `cd` or `pushd` command, from its program words."""
    if not words or Path(words[0]).name not in ("cd", "pushd"):
        return cwd
    if any("$" in word for word in words[1:]):
        return cwd  # a directory the shell computes: unknown here, so files keep resolving where they did
    targets = [word for word in words[1:] if not word.startswith("-")]
    if not targets:
        return os.path.expanduser("~") if Path(words[0]).name == "cd" else cwd
    return _resolve(cwd, targets[0])


def _bash_reads(command: str, cwd: str) -> dict[str, list[Request]]:
    """The files a plain `command` prints to the agent, with their spans; none
    for a command that is not plain. Raises ValueError when the tokenizer cannot
    read the command."""
    if any(mark in command for mark in _NOT_PLAIN_TEXT):
        return {}
    tokens = _lex(command.replace("\\\n", ""))
    if any(token in _NOT_PLAIN_TOKENS for token in tokens):
        return {}
    pipelines = _pipelines(tokens)
    programs = [[_program_words(_common.command_words(segment)) for segment in pipeline] for pipeline in pipelines]
    if any(words and Path(words[0]).name in _NOT_PLAIN_PROGRAMS for pipeline in programs for words in pipeline):
        return {}
    reads: dict[str, list[Request]] = {}
    for pipeline, words in zip(pipelines, programs):
        start = cwd
        if len(pipeline) == 1:
            cwd = _new_directory(words[0], cwd)
        # Walk back over trailing pagers: a pass-through reader that names no
        # file and no range. One with a range (`bat -r`) is a filter and stops
        # the walk, as `head`, `tail` and `sed` do. Each command is parsed once.
        effective = len(pipeline) - 1
        reader = _known_reader(pipeline[effective])
        while (effective > 0 and reader is not None and reader[0] in _PASS_THROUGH and not reader[1]
               and all(request == WHOLE for request in reader[2])):
            effective -= 1
            reader = _known_reader(pipeline[effective])
        if any(_prints_to_a_file(segment) for segment in pipeline[effective:]):
            continue
        if reader is not None:
            for file in reader[1]:
                _add(reads, _resolve(start, file), reader[2])
    return reads


# --- the decision ------------------------------------------------------------


def _is_document(path: str) -> bool:
    return Path(path).suffix.lower() in DOCUMENT_SUFFIXES


def _agent(data: dict) -> str:
    agent = data.get("agent_id")
    return agent if isinstance(agent, str) and agent else MAIN_AGENT


def _refusal(path: str, size: int, before: int, after: int) -> str:
    return (
        f"{path} is a document of {size:,} bytes, above the read budget of {BUDGET_BYTES:,} bytes "
        f"per document, per agent, per session. This agent has read {before:,} bytes of it, and this "
        f"call would bring it to {after:,}. Query the document instead of reading it: search it with "
        f"`rg -n '<term>' {path}`, extract the rows you need with a script into a small file and read "
        f"that, or use the plan's parser once it exists. The budget changes only by a pull request."
    )


def evaluate(data: dict, state_root: Path) -> str | None:
    """The refusal message for the call `data` describes, or None to allow it;
    an allowed read of a document above the budget is recorded in the ledger
    under `state_root`. Raises on a fault of the hook."""
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    tool = data.get("tool_name")
    cwd = _cwd(data)
    if tool == "Read":
        reads = _read_tool_reads(tool_input, cwd)
    elif tool == "Bash":
        command = tool_input.get("command")
        if not isinstance(command, str):
            return None
        reads = _bash_reads(command, cwd)
    else:
        return None

    with contextlib.ExitStack() as stack:
        return _judge(data, reads, state_root, stack)


@contextlib.contextmanager
def _locked_ledger(path: Path):
    """The ledger's descriptor, held under an exclusive lock from the read that
    decides to the write that records, so that two calls of one session judge
    one after the other. `ic.append_entry` takes the same lock for each line it
    writes, so the lines are written here, in its format, through the
    descriptor that holds it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise LedgerBusy(f"the ledger {path} stayed locked for {LOCK_WAIT_SECONDS} s") from None
                time.sleep(_LOCK_RETRY_SECONDS)
        yield descriptor
    finally:
        os.close(descriptor)


def _judge(data: dict, reads: dict[str, list[Request]], state_root: Path, stack: contextlib.ExitStack) -> str | None:
    agent = _agent(data)
    ledger_path: Path | None = None
    descriptor = -1
    prior: list[dict] = []
    pending: list[dict] = []
    for path, requests in reads.items():
        if not _is_document(path):
            continue
        try:
            status = os.stat(path)
        except (FileNotFoundError, NotADirectoryError):
            continue
        if not os.path.isfile(path) or status.st_size <= BUDGET_BYTES:
            continue
        if ledger_path is None:
            ledger_path = ic.state_file(state_root, data.get("session_id"), LEDGER_KIND)
            descriptor = stack.enter_context(_locked_ledger(ledger_path))
            prior = ic.read_entries(ledger_path) or []
        document = _Document(path, status.st_size)
        try:
            spans = [(request, document.span(request)) for request in requests]
        finally:
            document.close()
        # A file regenerated or appended to since a span was read is another
        # document: only the spans read of it as it is now count.
        version = [status.st_size, status.st_mtime_ns]
        union = merged(
            [tuple(entry["bytes"]) for entry in prior
             if entry.get("agent") == agent and entry.get("file") == path and entry.get("version") == version
             and _is_span(entry.get("bytes"))]
        )
        before = covered(union)
        after = covered(union + [span for _, span in spans])
        if after > BUDGET_BYTES and after > before:
            return _refusal(path, status.st_size, before, after)
        recorded: set[tuple[int, int]] = set()
        for request, span in spans:
            if span in recorded or _contains(union, span):
                continue
            recorded.add(span)
            lines = [request[1], request[2]] if request[0] == "lines" else None
            pending.append({"agent": agent, "file": path, "version": version, "lines": lines, "bytes": list(span)})

    if not pending:
        return None
    first = os.fstat(descriptor).st_size == 0
    os.write(descriptor, "".join(json.dumps(entry, sort_keys=True) + "\n" for entry in pending).encode("utf-8"))
    if first:
        ic.prune_state(state_root, time.time())
    for entry in pending:
        log(f"recorded: agent={entry['agent']} file={entry['file']} bytes={entry['bytes']}")
    return None


def _is_span(value: object) -> bool:
    return isinstance(value, list) and len(value) == 2 and all(isinstance(x, int) for x in value)


def _state_root() -> Path:
    return ic.PROJECT_ROOT


def _fault(error: BaseException, outcome: str = "the call is allowed") -> None:
    with contextlib.suppress(OSError):
        log(f"FAULT: {type(error).__name__}: {error}; {outcome}")


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
        if not isinstance(data, dict):
            raise ValueError("the hook input is not a JSON object")
        refusal = evaluate(data, _state_root())
    except Exception as error:  # noqa: BLE001 — the guard never stops a session by its own fault
        _fault(error)
        sys.exit(0)
    if refusal is None:
        sys.exit(0)
    print(f"BLOCKED [{HOOK_NAME}]: {refusal}", file=sys.stderr)
    with contextlib.suppress(OSError):
        log(f"BLOCK: {refusal}")
    sys.exit(REFUSING_EXIT_CODE)


if __name__ == "__main__":
    main()
