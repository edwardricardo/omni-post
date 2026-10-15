"""Helpers shared by every OmniPost Python hook.

Reusable building blocks: logger factory, JSON-stdin reader, git helpers,
and shared regex constants. Each hook imports what it needs.

Typical use from a hook:

    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _common import make_logger, read_hook_input, GIT_PUSH_RE

    log, block, allow = make_logger("pre-bash")

    def main():
        data = read_hook_input(log)
        ...
"""

import contextlib
import fcntl
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterator, NoReturn


# Repository root, resolved from the location of THIS file
# (.claude/hooks-py/_common.py -> .claude/ -> root), never from the process
# cwd. Claude Code runs the hooks with the session's cwd, which can be a
# subdirectory: with cwd-relative paths, a token created at the root was
# invisible from apps/api ("missing") and every hook seeded an orphan
# `.claude/` in whatever directory it happened to run in.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

LOG_PATH = PROJECT_ROOT / ".claude" / "hooks.log"

# The grant store: one file per operation (`push`, `sensitive-edit`, ...),
# written by `.claude/bin/omnipost-allow` and read by every hook through the
# grant functions at the end of this module (shared contract, no drift). No
# session writes it: pre-edit and pre-bash block every write to it, token or not.
ALLOWED_TOKENS_DIR = PROJECT_ROOT / ".claude" / ".allowed"


def _main_repository_root(root: Path) -> tuple[Path, bool]:
    """Root of the MAIN worktree of the repository that contains `root`, and
    whether git resolved it.

    Claude Code names the auto memory directory after the git repository, not
    the worktree: "all worktrees and subdirectories within the same repo share
    one auto memory directory" (code.claude.com/docs/en/memory, Storage
    location). From a linked worktree `PROJECT_ROOT` is the worktree, but its
    `--git-common-dir` is the main one's `.git`, and the parent of that `.git`
    is the path Claude Code builds the name from. Without git, or with a bare
    repository, it falls back to `root` and says so (False).
    """
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return root, False
    common_dir = Path(result.stdout.strip()).resolve()
    return (common_dir.parent, True) if common_dir.name == ".git" else (root, False)


def _write_log_line(tag: str, message: str) -> None:
    """The ONLY shape of a hooks.log line: `[iso-local] [tag] message`.

    make_logger uses it with the hook's name; _common, which has no hook name,
    with `_common`. One writer: the format cannot diverge.
    """
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"[{datetime.now().isoformat()}] [{tag}] {message}\n")


def _append_log(line: str) -> None:
    """A hooks.log line from _common; an I/O failure does not stop a hook."""
    try:
        _write_log_line("_common", line)
    except OSError:
        pass


# `memory_dir` memoizes ONLY a successful resolution, so a transient git
# failure does not pin the fallback path; the fallback notice is logged once
# per process. Each hook is a new, single-threaded process: the memo is valid
# within that process and needs no lock. The hooks that read the index
# resolve it on USE (`canon_index_path()`), not on import: a transient
# failure during the import does not leave the process looking at the
# fallback, and a hook that exits without reading the index does not pay for
# the subprocess.
_MEMORY_DIR_CACHE: Path | None = None
_MEMORY_DIR_WARNED = False
MEMORY_DIR_FALLBACK_NOTE = "memory_dir: git did not resolve the main root; path derived from PROJECT_ROOT, not cached"


def _resolve_memory_dir() -> tuple[Path, bool]:
    """The project's auto memory and whether git resolved the main root.

    It is Claude Code's naming contract: `~/.claude/projects/<root with "/"
    -> "-">/memory` (`/root/omni-post` -> `-root-omni-post`), one directory per
    repository shared by its worktrees; canon-index.json and
    canon_research_index.md live there. It costs one `git rev-parse` (measured
    0.8 ms). Both outcomes start from a RESOLVED path (no symlinks): the git
    one is resolved by `_main_repository_root`; the fallback one is resolved
    here, so a PROJECT_ROOT reached through a symlink does not invent a second
    name.
    """
    root, resolved = _main_repository_root(PROJECT_ROOT)
    if not resolved:
        root = root.resolve()
    slug = str(root).replace("/", "-")
    return Path.home() / ".claude" / "projects" / slug / "memory", resolved


def memory_dir() -> Path:
    global _MEMORY_DIR_CACHE, _MEMORY_DIR_WARNED
    if _MEMORY_DIR_CACHE is not None:
        return _MEMORY_DIR_CACHE
    path, resolved = _resolve_memory_dir()
    if resolved:
        _MEMORY_DIR_CACHE = path
    elif not _MEMORY_DIR_WARNED:
        # The fallback is not cached, but its notice is: once per process.
        _MEMORY_DIR_WARNED = True
        _append_log(f"{MEMORY_DIR_FALLBACK_NOTE} ({PROJECT_ROOT})")
    return path


def canon_index_path() -> Path:
    """Path of canon-index.json — the JSON the edit hooks read — resolved on
    use, not on import (see memory_dir)."""
    return memory_dir() / "canon-index.json"


def canon_research_index_path() -> Path:
    """Path of canon_research_index.md — the markdown the JSON at
    `canon_index_path` is generated from — resolved on use, not on import."""
    return memory_dir() / "canon_research_index.md"


# Glob characters: `pre_edit_canon` matches `appliesTo` as a SUBSTRING of the
# edited path, so a pattern containing `*` or `[` never matches anything.
_GLOB_CHARS = frozenset("*?[]{}")
MAX_NAMED_DEAD_PATTERNS = 3


def applies_to_pattern_is_live(pattern: str, root: Path = PROJECT_ROOT) -> bool:
    """True when `pattern` can fire: root-relative (no leading `/`), free of
    glob characters, and naming a file or directory that exists under `root`.

    A pattern that fails this never matches a repository path: the entry
    carrying it goes silent and nothing reports it.
    """
    if not isinstance(pattern, str) or not pattern or pattern.startswith("/") or _GLOB_CHARS.intersection(pattern):
        return False
    return (root / pattern).exists()


def dead_applies_to_patterns(index: dict, root: Path = PROJECT_ROOT) -> dict[str, list[str]]:
    """Each dead pattern in the index -> the sorted keys of the entries that
    carry it. Empty when every pattern can fire."""
    dead: dict[str, set[str]] = {}
    for key, entry in index.get("entries", {}).items():
        applies_to = entry.get("appliesTo") if isinstance(entry, dict) else None
        for pattern in applies_to if isinstance(applies_to, list) else []:
            if not applies_to_pattern_is_live(pattern, root):
                dead.setdefault(str(pattern), set()).add(str(entry.get("key", key)))
    return {pattern: sorted(keys) for pattern, keys in sorted(dead.items())}


def read_canon_index(path: Path) -> tuple[dict | None, str | None]:
    """(index, None) when `path` holds a JSON object with `entries`; (None,
    reason) when it cannot be read or has another shape. Reads the file once."""
    try:
        index = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return None, f"{path.name} unreadable ({type(e).__name__})"
    if not isinstance(index, dict) or not isinstance(index.get("entries"), dict):
        return None, f"{path.name} is not a JSON object with entries"
    return index, None


def parse_synthesized_at(index: dict) -> datetime | None:
    """The index's `synthesizedAt` as an aware datetime (UTC when it carries no
    zone), or None."""
    raw = index.get("synthesizedAt")
    if not isinstance(raw, str):
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def canon_index_staleness(
    index_path: Path,
    source_path: Path,
    root: Path = PROJECT_ROOT,
    index: dict | None = None,
) -> str | None:
    """Why the canon index does not reflect its source or the tree, or None.

    Reasons, joined when there are several: unreadable JSON (naming the error
    class), `synthesizedAt` missing or unparseable, the markdown modified after
    the synthesis (or absent: without a source there is nothing to check
    against), and dead `appliesTo` patterns (up to MAX_NAMED_DEAD_PATTERNS
    named, plus the total). Age alone is NOT a reason: an index synthesized
    months ago from a source that has not changed is current. `index` avoids
    reading the JSON again when the caller already loaded it.
    """
    if index is None:
        index, error = read_canon_index(index_path)
        if error:
            return error
    reasons: list[str] = []
    synthesized = parse_synthesized_at(index)
    if "synthesizedAt" not in index:
        reasons.append("synthesizedAt missing")
    elif synthesized is None:
        reasons.append(f"synthesizedAt unparseable ({index.get('synthesizedAt')!r})")
    try:
        source_mtime = datetime.fromtimestamp(source_path.stat().st_mtime, timezone.utc)
    except OSError as e:
        reasons.append(f"source {source_path.name} not readable ({type(e).__name__})")
    else:
        if synthesized is not None and source_mtime > synthesized:
            reasons.append(
                f"source {source_path.name} modified after synthesizedAt "
                f"({source_mtime.isoformat(timespec='seconds')} > {synthesized.isoformat(timespec='seconds')})"
            )
    dead = dead_applies_to_patterns(index, root)
    if dead:
        named = ", ".join(list(dead)[:MAX_NAMED_DEAD_PATTERNS])
        more = f" (+{len(dead) - MAX_NAMED_DEAD_PATTERNS} more)" if len(dead) > MAX_NAMED_DEAD_PATTERNS else ""
        reasons.append(f"{len(dead)} dead appliesTo pattern(s): {named}{more}")
    return "; ".join(reasons) or None


def make_logger(hook_name: str) -> tuple[Callable[[str], None], Callable[[str], None], Callable[[str], None]]:
    """Creates the 3 functions (log, block, allow) bound to a hook_name.

    log(msg) — appends a timestamped entry to hooks.log.
    block(reason) — prints to stderr + logs + exit 2 (CC reads it as a veto).
    allow(reason) — logs + exit 0.
    """

    def log(message: str) -> None:
        _write_log_line(hook_name, message)

    def block(reason: str) -> None:
        print(f"BLOCKED [{hook_name}]: {reason}", file=sys.stderr)
        log(f"BLOCK: {reason}")
        sys.exit(2)

    def allow(reason: str = "ok") -> None:
        log(f"ALLOW: {reason}")
        sys.exit(0)

    return log, block, allow


def read_hook_input(log_fn: Callable[[str], None]) -> dict:
    """Parses the stdin JSON that CC passes to the hook. Exits 1 on failure."""
    raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        log_fn(f"ERROR: invalid JSON: {e}")
        sys.exit(1)


def current_branch(repo: Path | None = None) -> str:
    """Branch checked out in `repo` (default PROJECT_ROOT), or '' on failure.

    `symbolic-ref --short HEAD` (not `rev-parse --abbrev-ref HEAD` nor `branch
    --show-current`, which requires git >= 2.22): it also reads a freshly
    created branch with no commits, fails on a detached HEAD and returns ''
    (which blocks), and exists in every git since 1.7.
    The `cwd` is explicit because without it git reads the hook process's cwd,
    which is never the repository a `cd <worktree> && git commit` points at:
    the commit gate would validate the branch of the live repository, not the
    commit's. A nonexistent `repo` returns '' — the caller decides (the commit
    gate blocks).
    """
    try:
        result = subprocess.run(
            ["git", "symbolic-ref", "--short", "HEAD"],
            cwd=repo or PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return ""


# `cd <path> &&`, `cd <path>;` or `cd <path>` + newline at the START of the
# command. The path may be single- or double-quoted. The newline counts:
# measured, without it `cd X\ngit commit` resolved to the session cwd and the
# gate validated another repository. Deliberate limits (only the FIRST cd,
# only when it opens the command, no `cd -` nor variables): see the
# commit_repos docstring.
_CD_PREFIX_RE = re.compile(r"""^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)[ \t]*(?:&&|;|\n)""")
# Global git options whose value travels in the NEXT token. The ones of the
# form `--option=value` and the flags without a value skip themselves.
_GIT_VALUE_OPTIONS = frozenset(
    {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
     "--super-prefix", "--config-env", "--list-cmds", "--attr-source"}
)
# The ones that move the tree THAT git invocation acts on
# (`git -C a -C b commit` is `cd a; cd b; git commit`).
_GIT_TREE_OPTIONS = frozenset({"-C", "--work-tree"})
# What ends one command and starts the next. The newline is one: the shell runs
# `ls\nbash -c '…'` as two commands, and a reading that kept them as one saw
# `ls` as the program and never the shell after it.
_SHELL_SEPARATORS = frozenset({"&&", "||", ";", "|", "&", "|&", "\n"})
# Fallback when shlex cannot tokenize (unclosed quote): the conservative form
# `git … commit` within one shell segment. Only `commit` is recoverable this
# way; a gate on another subcommand cannot rely on the fallback.
_GIT_COMMIT_FALLBACK_RE = re.compile(r"\bgit\b[^|;&\n]*\bcommit\b")


def _unquote(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        return token[1:-1]
    return token


# What shlex reads as punctuation: its own set plus the newline, which it
# otherwise reads as whitespace (see _SHELL_SEPARATORS).
_PUNCTUATION = "();<>|&\n"
_PUNCTUATION_SET = frozenset(_PUNCTUATION)


def _separator(run: str) -> str:
    """One separator for a run shlex glued (`;\n`, `\n\n`): the newline when
    the run holds one, else the run itself when it is a separator the shell
    knows, else `;`."""
    if "\n" in run:
        return "\n"
    return run if run in _SHELL_SEPARATORS else ";"


def _split_punctuation_run(token: str) -> list[str]:
    """A token shlex glued from punctuation characters, split the way the
    shell reads it: each `(` and `)` alone, and a run of separators as one
    separator. Redirections (`>`, `>&`, `<<`) and words come back unchanged."""
    if not token or "<" in token or ">" in token or not set(token) <= _PUNCTUATION_SET:
        return [token]
    parts: list[str] = []
    run = ""
    for char in token:
        if char in "()":
            if run:
                parts.append(_separator(run))
                run = ""
            parts.append(char)
        else:
            run += char
    if run:
        parts.append(_separator(run))
    return parts


def _lex(text: str) -> list[str]:
    """shlex over `text` with the newline as a separator. Raises ValueError on
    an unclosed quote, like shlex.split."""
    lexer = shlex.shlex(text, posix=True, punctuation_chars=_PUNCTUATION)
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    return [part for token in lexer for part in _split_punctuation_run(token)]


# `<<DELIM`, `<<-DELIM`, `<<'DELIM'`, `<<"DELIM"`, `<<\DELIM`; not `<<<`, a
# here-string, whose word stays on the line.
_HEREDOC_RE = re.compile(r"(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]*)'|\"([^\"\n]*)\"|(\\?)([^\s;&|<>()'\"`]+))")
# Programs that read a heredoc as text and run none of it. A heredoc fed to any
# other program — a shell, an interpreter, or one this list does not know — is
# read as a script, on the conservative side.
_HEREDOC_TEXT_READERS = frozenset(
    {"cat", "tee", "git", "gh", "jq", "yq", "wc", "sort", "uniq", "head", "tail", "grep", "rg",
     "column", "tr", "base64", "diff", "cmp", "sha256sum", "md5sum", "read"}
)


@dataclass(frozen=True)
class Heredoc:
    """A heredoc body: whether the shell expands `$(…)` and backticks in it
    (an unquoted delimiter), and whether the program it feeds only reads text."""

    body: str
    expands: bool
    is_text: bool


def _heredoc_is_text(line: str, match: re.Match) -> bool:
    """Whether the heredoc `match` opens on `line` feeds a program that only
    reads text: the program of the command the operator belongs to (inside an
    enclosing `$(`, as in `--body "$(cat <<'EOF'`), with no pipe after the
    operator to carry the text on to another program."""
    if "|" in line[match.end():]:
        return False
    prefix = line[:match.start()]
    opened = prefix.rfind("$(")
    if opened >= 0 and ")" not in prefix[opened:]:
        prefix = prefix[opened + 2:]
    try:
        tokens = _lex(prefix)
    except ValueError:
        return False
    segment: list[str] = []
    for token in tokens:
        segment = [] if token in _SHELL_SEPARATORS else [*segment, token]
    words = command_words(segment)
    index = program_index(words)
    return index is not None and Path(words[index]).name in _HEREDOC_TEXT_READERS


def heredocs(command: str) -> tuple[str, list[Heredoc]]:
    """`command` without its heredoc bodies, and the bodies.

    A body is not part of the command line: read as tokens, a commit message
    or a PR body written through `cat <<'EOF'` turned its lines into
    commands, and its words into a publication or a write. An operator whose
    delimiter line never comes is not read as a heredoc, so nothing after it
    is hidden.
    """
    if "<<" not in command:
        return command, []
    lines = command.split("\n")
    kept: list[str] = []
    found: list[Heredoc] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        kept.append(line)
        i += 1
        for match in _HEREDOC_RE.finditer(line):
            delimiter = next(g for g in (match.group(2), match.group(3), match.group(5)) if g is not None)
            strip_tabs = match.group(1) == "-"
            end = next(
                (j for j in range(i, len(lines)) if (lines[j].lstrip("\t") if strip_tabs else lines[j]) == delimiter),
                None,
            )
            if end is None:
                break
            quoted = match.group(5) is None or bool(match.group(4))
            found.append(Heredoc("\n".join(lines[i:end]), not quoted, _heredoc_is_text(line, match)))
            i = end + 1
    return "\n".join(kept), found


def _shell_tokens(command: str) -> list[str]:
    """Shell tokens with `&&`, `||`, `;`, `|`, `&`, `|&` and the newline as
    tokens of their OWN even when glued (`git commit&&…`), and each `(` and `)`
    alone; inside quotes they remain text. Heredoc bodies are left out (see
    `heredocs`) and a backslash-newline joins two lines, as in the shell.
    Raises ValueError on an unclosed quote, like shlex.split."""
    text, _ = heredocs(command)
    return _lex(text.replace("\\\n", ""))


def shell_segments(command: str) -> list[list[str]] | None:
    """The commands of `command` as token lists, split at `&&`, `||`, `;`, `|`,
    `&`, `|&` and the newline (glued separators included); None when it cannot
    be tokenized."""
    try:
        tokens = _shell_tokens(command)
    except ValueError:
        return None
    segments: list[list[str]] = [[]]
    for tok in tokens:
        if tok in _SHELL_SEPARATORS:
            segments.append([])
        else:
            segments[-1].append(tok)
    return [seg for seg in segments if seg]


ENV_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# Words that open a command without being its program: grouping, negation,
# the keywords of a compound command, and the `$` of an unquoted `$(`.
_COMMAND_PREFIXES = frozenset({"(", ")", "{", "}", "!", "$", "if", "then", "else", "elif", "do", "while", "until", "time", "exec"})


def command_words(segment: list[str]) -> list[str]:
    """The words of one command: its tokens without redirections (operator and
    operand) and without the descriptor number glued before one (`2>`)."""
    words: list[str] = []
    i = 0
    while i < len(segment):
        token = segment[i]
        if token.startswith(("<", ">")) or token in ("&>", "&>>"):
            if words and words[-1].isdigit():
                words.pop()
            i += 2
            continue
        words.append(token)
        i += 1
    return words


def program_index(words: list[str]) -> int | None:
    """Index of the program in `words`: the first word that is not a command
    prefix nor a variable assignment; None when there is none."""
    for index, word in enumerate(words):
        if word not in _COMMAND_PREFIXES and not ENV_ASSIGNMENT_RE.match(word):
            return index
    return None


def substitutions(text: str) -> list[str]:
    """The bodies of the `$(…)`, `<(…)`, `>(…)` and backtick substitutions in
    `text` outside single quotes, where the shell runs them. An unclosed one
    reads to the end of the text, on the conservative side."""
    bodies: list[str] = []
    i, length = 0, len(text)
    quote: str | None = None
    while i < length:
        char = text[i]
        if quote == "'":
            quote = None if char == "'" else quote
            i += 1
            continue
        if char == "\\":
            i += 2
            continue
        if char == "'" and quote is None:
            quote = "'"
        elif char == '"':
            quote = None if quote == '"' else '"'
        elif char == "`":
            end = text.find("`", i + 1)
            bodies.append(text[i + 1:] if end < 0 else text[i + 1:end])
            i = length if end < 0 else end + 1
            continue
        elif char in "$<>" and text.startswith("(", i + 1):
            depth, j = 1, i + 2
            while j < length and depth:
                depth += {"(": 1, ")": -1}.get(text[j], 0)
                j += 1
            bodies.append(text[i + 2:j - 1] if depth == 0 else text[i + 2:])
            i = j
            continue
        i += 1
    return bodies


def shell_scripts(segment: list[str]) -> list[str]:
    """The `-c` script of each shell named in `segment` (`bash -c "…"`, and as
    the argument of a wrapper: `sudo bash -c "…"`). As the shell itself does,
    `c` anywhere in a short-option cluster (`-c`, `-lc`, `-ic`) sets the
    option, and the script is the first argument after the cluster that is not
    an option."""
    scripts: list[str] = []
    for index, token in enumerate(segment):
        if Path(token).name not in _SHELLS:
            continue
        flags = [i for i in range(index + 1, len(segment)) if _sets_shell_command_flag(segment[i])]
        if not flags:
            continue
        script = next((tok for tok in segment[flags[0] + 1:] if not tok.startswith("-")), None)
        if script is not None:
            scripts.append(script)
    return scripts


def nested_scripts(command: str) -> list[str] | None:
    """Every script `command` hands to a shell: the `-c` script of a shell, the
    body of each substitution, each heredoc that is not plain text, and the
    substitutions inside a text heredoc whose delimiter is unquoted (the shell
    expands those). None when the command cannot be tokenized."""
    segments = shell_segments(command)
    if segments is None:
        return None
    text, docs = heredocs(command)
    scripts = [script for segment in segments for script in shell_scripts(segment)]
    scripts.extend(substitutions(text))
    for doc in docs:
        if not doc.is_text:
            scripts.append(doc.body)
        elif doc.expands:
            scripts.extend(substitutions(doc.body))
    return scripts


def repository_of(path: Path) -> Path | None:
    """The root of the repository that contains `path` (the first parent with
    `.git`), or None outside any repository."""
    for candidate in (path, *path.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def git_invocations(command: str) -> list[tuple[str, list[str]]]:
    """Each git invocation in `command`: (subcommand, the trees THAT invocation
    received through `-C`/`--work-tree`, in order).

    Tokenizes with shlex instead of an option regex: `git --work-tree /p
    commit` and `git -c "user.name=Foo Bar" commit` carry the subcommand after
    a value no regex absorbed, and that gap skipped the branch gate and the
    Co-Authored-By gate at once. A quoted string is ONE token: a `git commit`
    or a `git -C` inside it does not count. A glued separator (`commit&&`) is
    a separate token and does not hide the subcommand. When shlex cannot
    tokenize, it falls back to the conservative regex: [("commit", [])] or
    nothing.
    """
    try:
        tokens = _shell_tokens(command)
    except ValueError as e:
        _append_log(f"git_invocations: untokenizable command ({e}); commit-only fallback")
        return [("commit", [])] if _GIT_COMMIT_FALLBACK_RE.search(command) else []
    found: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(tokens):
        if tokens[i] != "git" and not tokens[i].endswith("/git"):
            i += 1
            continue
        trees: list[str] = []
        j = i + 1
        while j < len(tokens):
            tok = tokens[j]
            if tok in _GIT_TREE_OPTIONS and j + 1 < len(tokens):
                trees.append(tokens[j + 1])
                j += 2
                continue
            if tok in _GIT_VALUE_OPTIONS:
                j += 2
                continue
            if tok.startswith("-"):
                j += 1
                continue
            if tok in _SHELL_SEPARATORS:
                break
            found.append((tok, trees))
            break
        i = max(j, i + 1)
    return found


def git_subcommands(command: str) -> set[str]:
    """Git subcommands invoked in `command` (`commit`, `fetch`, …); see git_invocations."""
    return {subcommand for subcommand, _ in git_invocations(command)}


# Shells whose `-c <script>` argument is itself a command line to read.
_SHELLS = frozenset({"bash", "sh", "zsh", "dash"})
# What a line that cannot be tokenized counts as for the publication gate: the
# broad shape `git … push` (local `git stash push` excluded). Deliberately
# conservative — a line that cannot be read is treated as a publication, so
# the gate asks for the token and the post hook consumes it.
_GIT_PUSH_FALLBACK_RE = re.compile(r"\bgit\b(?!\s+stash\b)\s.*\bpush\b")


MAX_SHELL_DEPTH = 8


def runs_git_push(command: str, depth: int = 0) -> bool:
    """Whether `command` publishes: some git invocation in it has `push` as
    its REAL subcommand, read the way the commit gate reads `commit`.

    The earlier test was a regex for the words `git` and `push` anywhere on the
    line, so a line that only read the token's own path
    (`.claude/.allowed/push`), searched for the word, or named a branch after it
    passed for a publication: the pre hook demanded a token and the post hook
    CONSUMED it, with nothing published (measured 2026-10-02, hooks.log
    11:05:19). `git stash push` is a local stash, not a publication.

    Every script the command hands to a shell is read too (`nested_scripts`):
    a `bash -c "git push …"` script, a `$(…)` or backtick substitution, and a
    heredoc fed to a shell, since each would otherwise be one opaque token.
    A heredoc that is plain text (a commit message, a PR body) is not read:
    its words publish nothing. Nesting deeper than `MAX_SHELL_DEPTH` scripts,
    and a line shlex cannot tokenize, fall back to the broad regex, on the
    conservative side. Not covered, stated: a publication inside a script file
    or a function is invisible to any reading of the command line.
    """
    scripts = nested_scripts(command)
    if scripts is None or depth > MAX_SHELL_DEPTH:
        _append_log(f"runs_git_push: unreadable or nested past {MAX_SHELL_DEPTH} (depth {depth}); conservative fallback")
        return bool(_GIT_PUSH_FALLBACK_RE.search(command))
    if "push" in git_subcommands(command):
        return True
    return any(runs_git_push(script, depth + 1) for script in scripts)


# The command that issues grants. Only the owner runs it, from his own
# terminal; a session may run `omnipost-allow status` and nothing else.
GRANT_CLI = "omnipost-allow"
GRANT_CLI_MENTION_RE = re.compile(r"(?<![\w-])omnipost-allow(?![\w-])")
# Interpreters that run code given on their command line or on stdin.
INTERPRETER_RE = re.compile(r"^(?:python[0-9.]*|pypy3?|node|nodejs|perl|ruby|php|deno|bun|tsx|lua)$")
# Programs that only read, print, copy or compare the files they are given:
# the CLI named as their argument is a file, not a command. Any other program
# that receives it (`timeout`, `xargs`, `env`, `sudo`, an interpreter, one this
# list does not know) is read as running it, on the conservative side.
_MENTION_ONLY_PROGRAMS = frozenset(
    {"bat", "batcat", "cat", "less", "more", "head", "tail", "rg", "grep", "egrep", "fgrep", "eza", "exa", "ls",
     "fd", "find", "wc", "file", "stat", "sha256sum", "sha1sum", "sha512sum", "md5sum", "cksum", "b2sum", "diff",
     "cmp", "readlink", "realpath", "dirname", "basename", "which", "type", "whereis", "echo", "printf", "git",
     "jq", "yq", "od", "xxd", "hexdump", "strings", "du", "tree", "sort", "uniq", "cut", "column", "nl", "cp",
     "rsync", "install", "ln", "mv", "tee", "test", "[", "chmod", "touch", "cd", "pushd"}
)
# The `find` actions that run a program.
_FIND_RUNNERS = frozenset({"-exec", "-execdir", "-ok", "-okdir"})
# What an invocation that is not a plain argv is recorded as, so the gate can
# name it; none of these is `["status"]`.
STDIN_SCRIPT = "<a script read from standard input>"
INLINE_CODE = "<inline code>"


def _is_grant_cli(token: str) -> bool:
    """`token` names the CLI: by basename or path, with the backtick or `$(`
    of a substitution still around it."""
    return Path(token.strip("`$()")).name == GRANT_CLI


def _reads_stdin_script(program: str, arguments: list[str]) -> bool:
    """Whether `program` (a shell or an interpreter) takes its script from
    standard input: no inline code, and no script operand or the operand `-`."""
    name = Path(program).name
    if name in _SHELLS:
        if any(_sets_shell_command_flag(argument) for argument in arguments):
            return False
        operand = next((argument for argument in arguments if not argument.startswith("-")), None)
        return operand is None or "-s" in arguments
    if INTERPRETER_RE.match(name):
        if any(argument in ("-c", "-e", "-m", "-p", "--eval", "--print") for argument in arguments):
            return False
        operand = next((argument for argument in arguments if argument == "-" or not argument.startswith("-")), None)
        return operand is None or operand == "-"
    return False


def grant_cli_invocations(command: str, depth: int = 0, mentioned: bool | None = None) -> list[list[str]] | None:
    """The arguments of every invocation of `omnipost-allow` in `command`, and
    in every script it hands to a shell; None when some part cannot be
    tokenized or nests past `MAX_SHELL_DEPTH`.

    An invocation is the CLI as a program (by basename or path, after any
    prefix such as `(`, `!`, `exec` or `FOO=1`), the CLI as the argument of a
    program that is not mention-only (`python3 …/omnipost-allow push`,
    `timeout 5 omnipost-allow push`, `find … -exec omnipost-allow …`), inline
    code that names it (`python3 -c "…omnipost-allow…"`), and a shell or an
    interpreter that reads its script from standard input on a line that names
    it (`echo omnipost-allow push | sh`).

    LIMIT, stated plainly: a copy of the CLI under another name, a variable
    that holds its name, or a script file that runs it are invisible to any
    reading of the command line; the hard block raises the cost from running
    it to a deliberate act of concealment, and claims no more.
    """
    if mentioned is None:
        mentioned = GRANT_CLI_MENTION_RE.search(command) is not None
    scripts = nested_scripts(command)
    segments = shell_segments(command)
    if scripts is None or segments is None or depth > MAX_SHELL_DEPTH:
        return None
    found: list[list[str]] = []
    for segment in segments:
        words = command_words(segment)
        index = program_index(words)
        if index is None:
            continue
        program, arguments = words[index], words[index + 1:]
        name = Path(program.strip("`$()")).name
        if _is_grant_cli(program):
            found.append(arguments)
            continue
        mention_only = name in _MENTION_ONLY_PROGRAMS and not (name == "find" and _FIND_RUNNERS.intersection(arguments))
        if name == "command" and arguments[:1] in (["-v"], ["-V"]):
            mention_only = True
        if not mention_only:
            found.extend(arguments[i + 1:] for i, argument in enumerate(arguments) if _is_grant_cli(argument))
        if INTERPRETER_RE.match(name) and any(GRANT_CLI in argument and not _is_grant_cli(argument) for argument in arguments):
            found.append([INLINE_CODE])
        if mentioned and _reads_stdin_script(program, arguments):
            found.append([STDIN_SCRIPT])
    for script in scripts:
        nested = grant_cli_invocations(script, depth + 1, mentioned)
        if nested is None:
            return None
        found.extend(nested)
    return found


def _sets_shell_command_flag(token: str) -> bool:
    """A short-option cluster that sets the shell's `-c` (`-c`, `-lc`, `-ic`)."""
    return token.startswith("-") and not token.startswith("--") and "c" in token[1:]


def commit_repos(command: str, fallback: Path) -> list[Path]:
    """The directory EACH `git commit` in `command` acts on.

    A leading `cd <path>` — with `&&`, `;` or a newline — changes the base for
    the whole command; the `-C`/`--work-tree` of THAT invocation resolve
    against the base, in order, as the shell would. Those of ANOTHER
    invocation do not count: `git -C /other status && git commit` commits in
    `fallback`, the `cwd` Claude Code passes in the hook input.

    Limits, stated plainly: only the FIRST `cd`, and only when it opens the
    command; `cd -`, variables or subshells are not expanded. A wrongly
    resolved path points at a directory without a repository, and
    `current_branch` returns '' — it fails closed, not open.
    """
    base = fallback
    cd_match = _CD_PREFIX_RE.match(command)
    if cd_match:
        base = fallback / Path(_unquote(cd_match.group(1))).expanduser()
    repos: list[Path] = []
    for subcommand, trees in git_invocations(command):
        if subcommand != "commit":
            continue
        repo = base
        for tree in trees:
            repo = repo / Path(tree).expanduser()
        repos.append(repo)
    return repos


NOTICES_LOG = PROJECT_ROOT / ".claude" / "context-notices.log"


def _notice_field(value: str) -> str:
    """One field of the notices log: a tab separates fields and a newline
    separates records, so a tab, a newline or a backslash inside the value is
    escaped and cannot split the marker or the record."""
    return value.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")


def _notice_key(tag: str, name: str, state: str) -> str:
    """The key of a notice about a file: emit_missing_file_context writes it
    and recovered_file_notice reads it; one shape, one place."""
    return f"{tag}:{name}:{state}"


def emit_additional_context(hook_event: str, body: str = "", prefix: tuple[str, ...] = ()) -> NoReturn:
    """Prints ONE `additionalContext` — the `prefix` lines first (e.g. the
    RECOVERED notice), then `body` — and exits 0. With no text, exits 0 silently."""
    text = "\n\n".join([*prefix, body]).strip()
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": hook_event, "additionalContext": text}}))
    sys.exit(0)


def notice_seen(session_id: str, key: str) -> bool:
    """True when `key` was already recorded in `session_id` (read only, records nothing)."""
    if not session_id:
        return False
    marker = f"{_notice_field(session_id)}\t{_notice_field(key)}\t"
    try:
        return any(line.startswith(marker) for line in NOTICES_LOG.read_text(encoding="utf-8").splitlines())
    except OSError:
        return False


def notice_already_sent(session_id: str, key: str) -> bool:
    """True when `key` was already notified in `session_id`; otherwise records it and returns False.

    A missing-file notice reaches the context ONCE per session: the model keeps
    it, and repeating it on every Edit (the decision guard runs on all of them)
    would be noise with no new information. Without a session_id nothing is
    deduplicated.

    Lookup and record happen under `flock`: the PreToolUse hooks of one Edit
    run in parallel, and without the lock both could read "not notified" and
    both notify. The file keeps only the current session — recording drops the
    lines of other sessions — so it never grows past a handful of lines. When
    it cannot be read or written (OSError) the notice is sent anyway: better a
    repeated notice than a silent blindness; the failure stays in hooks.log.
    """
    if not session_id:
        return False
    session_field = _notice_field(session_id)
    marker = f"{session_field}\t{_notice_field(key)}"
    try:
        NOTICES_LOG.parent.mkdir(parents=True, exist_ok=True)
        with NOTICES_LOG.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            handle.seek(0)
            lines = handle.read().splitlines()
            if any(line.startswith(marker + "\t") for line in lines):
                return True
            kept = [line for line in lines if line.startswith(session_field + "\t")]
            handle.seek(0)
            handle.truncate()
            handle.write("".join(f"{line}\n" for line in kept) + f"{marker}\t{datetime.now().isoformat()}\n")
    except OSError as e:
        _append_log(f"notice_already_sent: {NOTICES_LOG} unavailable ({e}); notice sent without deduplication")
        return False
    return False


def emit_missing_file_context(
    tag: str,
    name: str,
    path: Path,
    consequence: str,
    *,
    hook_event: str,
    state: str = "MISSING",
    session_id: str = "",
) -> NoReturn:
    """Emits ONE `additionalContext` line about a missing file and exits 0.

    A missing input file recorded only in hooks.log leaves the hook "working"
    without data where nobody sees it; this sends the blindness to the model's
    context, which is who can report it. With `session_id`, the second time in
    the same session exits silently.
    """
    if notice_already_sent(session_id, _notice_key(tag, name, state)):
        sys.exit(0)
    emit_additional_context(hook_event, f"[{tag}] {name} {state} at {path} — {consequence}")


def recovered_file_notice(tag: str, name: str, path: Path, session_id: str = "") -> str | None:
    """`[tag] name RECOVERED at path` when THIS session already reported that
    file as MISSING or UNREADABLE and has not reported the recovery yet;
    otherwise None.

    The hook puts it before whatever it emits: the model that read "blind
    until …" learns it no longer is, instead of carrying an expired blindness
    for the rest of the session. It is recorded like any notice: once per
    session.
    """
    failed = any(notice_seen(session_id, _notice_key(tag, name, state)) for state in ("MISSING", "UNREADABLE"))
    if not failed or notice_already_sent(session_id, _notice_key(tag, name, "RECOVERED")):
        return None
    return f"[{tag}] {name} RECOVERED at {path}"


# ────────────────────────────────────────────────────────────────────
# Authorization grants: `.claude/.allowed/<operation>`
#
# A grant is a window `[not_before, expires_at)`. `omnipost-allow push --count 3
# --ttl 60` leaves three consecutive one-hour windows in one file. A push is
# allowed while one window contains now, and post-bash consumes the grant that
# authorized it, so each window allows one publication; a window opens at its
# own start time even when the grant before it was used early. A
# `sensitive-edit` grant is valid for its whole window and is never consumed.
# ────────────────────────────────────────────────────────────────────

# How long a CLAIMED grant outlives its window. A push pre-bash authorized a
# second before its window closed finishes after it, and post-bash must still
# find the grant that authorized it: without it, post-bash would consume the
# grant of the NEXT window. Ten minutes is the Bash tool's longest foreground
# timeout, so no authorized command is still running after it.
GRANT_CLAIM_GRACE = timedelta(minutes=10)
# The most windows one `omnipost-allow` call creates: twelve one-hour windows
# are a night; a larger number is likelier a typo than a plan.
MAX_GRANTS_PER_CALL = 12
GRANT_ISSUER = "edward"


def now_utc() -> datetime:
    """The instant every grant decision reads: one seam, so the tests freeze
    the clock instead of sleeping across a window boundary."""
    return datetime.now(timezone.utc)


def format_local(moment: datetime) -> str:
    """`moment` in the machine's local time, the clock the owner reads."""
    return moment.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def command_fingerprint(command: str) -> str:
    """What pre-bash records on the grant it authorizes and post-bash looks
    for: both hooks receive the same command text."""
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def _parse_instant(raw: object) -> datetime:
    """An ISO-8601 instant, aware (UTC when it carries no zone). Raises ValueError."""
    if not isinstance(raw, str):
        raise ValueError(f"not a timestamp: {raw!r}")
    moment = datetime.fromisoformat(raw)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


@dataclass
class Grant:
    """One window during which an operation is allowed, and the command that
    claimed it, if one did."""

    id: str
    not_before: datetime
    expires_at: datetime
    created_at: datetime
    ttl_minutes: int | None = None
    claimed_at: datetime | None = None
    claim_fingerprint: str | None = None

    def is_open(self, now: datetime) -> bool:
        return self.not_before <= now < self.expires_at

    def is_expired(self, now: datetime) -> bool:
        """Past its window, and past the claim grace when a command claimed it."""
        grace = GRANT_CLAIM_GRACE if self.claimed_at is not None else timedelta(0)
        return now >= self.expires_at + grace

    def window(self) -> str:
        return f"{self.not_before.isoformat()} -> {self.expires_at.isoformat()}"

    def to_json(self) -> dict:
        data: dict = {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "not_before": self.not_before.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "ttl_minutes": self.ttl_minutes,
        }
        if self.claimed_at is not None:
            data["claimed_at"] = self.claimed_at.isoformat()
            data["claim_fingerprint"] = self.claim_fingerprint
        return data

    @classmethod
    def from_json(cls, raw: object) -> "Grant":
        """A grant as `to_json` writes it. Raises KeyError, TypeError or
        ValueError on any other shape, an empty window included."""
        if not isinstance(raw, dict):
            raise TypeError("a grant is not a JSON object")
        ttl = raw.get("ttl_minutes")
        if ttl is not None and (isinstance(ttl, bool) or not isinstance(ttl, int)):
            raise ValueError(f"ttl_minutes is not an integer: {ttl!r}")
        grant = cls(
            id=str(raw["id"]),
            not_before=_parse_instant(raw["not_before"]),
            expires_at=_parse_instant(raw["expires_at"]),
            created_at=_parse_instant(raw.get("created_at", raw["not_before"])),
            ttl_minutes=ttl,
            claimed_at=_parse_instant(raw["claimed_at"]) if raw.get("claimed_at") else None,
            # A claim is its time and its fingerprint together, as `to_dict` writes them: a
            # fingerprint with no claim time is no claim, so post-bash never selects by it.
            claim_fingerprint=raw.get("claim_fingerprint") if raw.get("claimed_at") else None,
        )
        if grant.not_before >= grant.expires_at:
            raise ValueError(f"grant {grant.id} has an empty window")
        return grant


@dataclass
class GrantCheck:
    """What the grant file of an operation allows now. `reason` is None when a
    window is open (`grant` is its grant); otherwise one of "missing",
    "corrupt", "malformed", "expired" or "not-yet-open" (`next_opens_at` says
    when the next window opens)."""

    reason: str | None
    grant: Grant | None = None
    next_opens_at: datetime | None = None


@dataclass
class _GrantFile:
    """A grant file as read: the grants still pending after pruning, how many
    the file held, and why it could not be read, if it could not."""

    operation: str
    grants: list[Grant]
    held: int
    reason: str | None

    def pruned(self) -> bool:
        """Whether reading changed what the file must hold."""
        return self.reason is None and (len(self.grants) != self.held or not self.grants)


def grant_file(operation: str) -> Path:
    return ALLOWED_TOKENS_DIR / operation


@contextlib.contextmanager
def _grant_store_lock() -> Iterator[None]:
    """Serializes each read-modify-write of the store: the PreToolUse hooks of
    two Bash calls in one turn run at the same time. The lock is taken on the
    directory itself, so the store holds no lock file; without the directory
    there is no file to race on."""
    try:
        descriptor: int | None = os.open(ALLOWED_TOKENS_DIR, os.O_RDONLY)
    except OSError:
        descriptor = None
    try:
        if descriptor is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _grants_from(raw: object, now: datetime) -> list[Grant]:
    """The grants a file holds. The single-window shape `omnipost-allow` wrote
    before grants existed (an `expires_at`, no `grants`) is one grant from its
    `created_at` (or now) to its `expires_at`, so a token issued before the
    upgrade keeps working. Raises KeyError, TypeError or ValueError."""
    if not isinstance(raw, dict):
        raise TypeError("the file is not a JSON object")
    if "grants" in raw:
        if not isinstance(raw["grants"], list):
            raise TypeError("grants is not a list")
        return [Grant.from_json(item) for item in raw["grants"]]
    if not raw.get("expires_at"):
        raise ValueError("missing expires_at")
    expires_at = _parse_instant(raw["expires_at"])
    created_at = _parse_instant(raw["created_at"]) if raw.get("created_at") else now
    ttl = raw.get("ttl_minutes")
    return [Grant("legacy", created_at, expires_at, created_at, ttl if isinstance(ttl, int) else None)]


def _load_grants(operation: str, now: datetime, log_fn: Callable[[str], None]) -> tuple[list[Grant], str | None]:
    path = grant_file(operation)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [], "missing"
    except (OSError, ValueError) as error:
        log_fn(f"ERROR: token {operation} unreadable: {error}")
        return [], "corrupt"
    try:
        return _grants_from(raw, now), None
    except (KeyError, TypeError, ValueError) as error:
        log_fn(f"ERROR: token {operation} malformed: {error!r}")
        return [], "malformed"


def _open_grant_file(operation: str, now: datetime, log_fn: Callable[[str], None]) -> _GrantFile:
    """Reads the grant file of `operation` and drops the grants whose window
    (and claim grace) is over, logging each."""
    grants, reason = _load_grants(operation, now, log_fn)
    kept: list[Grant] = []
    for grant in grants:
        if grant.is_expired(now):
            claimed = "" if grant.claimed_at is None else ", claimed and past its grace"
            log_fn(f"grant {operation}/{grant.id} pruned: window {grant.window()} is over{claimed}")
        else:
            kept.append(grant)
    return _GrantFile(operation, kept, len(grants), reason)


def _store_grants(operation: str, grants: list[Grant], log_fn: Callable[[str], None]) -> None:
    """Writes the grants of `operation` atomically — a temporary file renamed
    over the old one, so a reader never sees half a file — or deletes the file
    when no grant remains. Raises OSError."""
    path = grant_file(operation)
    if not grants:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
            log_fn(f"grant file {operation} removed: no grant remains")
        return
    payload = {"operation": operation, "authorized_by": GRANT_ISSUER, "grants": [grant.to_json() for grant in grants]}
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{operation}.", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


def _save(store: _GrantFile, log_fn: Callable[[str], None]) -> None:
    """`_store_grants` from a hook, which must not crash on a store it cannot
    write: the failure is logged and the decision already taken stands."""
    try:
        _store_grants(store.operation, store.grants, log_fn)
    except OSError as error:
        log_fn(f"ERROR: grant file {store.operation} not written: {error}")


def _verdict(grants: list[Grant], now: datetime, held_any: bool) -> GrantCheck:
    open_now = [grant for grant in grants if grant.is_open(now)]
    if open_now:
        return GrantCheck(None, min(open_now, key=lambda grant: grant.expires_at))
    upcoming = [grant.not_before for grant in grants if grant.not_before > now]
    if upcoming:
        return GrantCheck("not-yet-open", next_opens_at=min(upcoming))
    return GrantCheck("expired" if held_any else "missing")


def _log_verdict(operation: str, check: GrantCheck, log_fn: Callable[[str], None]) -> None:
    if check.grant is not None:
        log_fn(f"token {operation} valid (grant {check.grant.id}, window {check.grant.window()})")
    elif check.reason == "not-yet-open" and check.next_opens_at is not None:
        log_fn(f"token {operation} not yet open (next window opens {check.next_opens_at.isoformat()})")
    elif check.reason == "expired":
        log_fn(f"token {operation} expired (every window is over)")


def inspect_grants(operation: str, log_fn: Callable[[str], None]) -> GrantCheck:
    """What the grant file of `operation` allows now, pruning what is over (and
    deleting the file when nothing remains)."""
    now = now_utc()
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        if store.reason is not None:
            return GrantCheck(store.reason)
        if store.pruned():
            _save(store, log_fn)
        check = _verdict(store.grants, now, store.held > 0)
    _log_verdict(operation, check, log_fn)
    return check


def check_grant_token(operation: str, log_fn: Callable[[str], None]) -> str | None:
    """None when a window of `operation` contains now; otherwise why not
    ("missing", "corrupt", "malformed", "expired", "not-yet-open"). Nothing is
    consumed: the contract of `sensitive-edit`, read identically by pre-edit,
    pre-bash and the tripwire blocker."""
    return inspect_grants(operation, log_fn).reason


def claim_grant(operation: str, fingerprint: str, log_fn: Callable[[str], None]) -> GrantCheck:
    """`inspect_grants`, recording on the open grant the command it authorizes
    (`claimed_at`, `claim_fingerprint`), so post-bash consumes that grant and
    no other even when the command finishes after its window. A claim of a
    grant some command already claimed replaces it: that command never reached
    post-bash (a failed push), and a retry is entitled to the same window."""
    now = now_utc()
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        if store.reason is not None:
            return GrantCheck(store.reason)
        check = _verdict(store.grants, now, store.held > 0)
        grant = check.grant
        if grant is not None:
            if grant.claim_fingerprint is not None:
                again = "the same command, a retry" if grant.claim_fingerprint == fingerprint else "another command"
                log_fn(f"grant {operation}/{grant.id} claimed again by {again}: the previous claim never reached post-bash")
            grant.claimed_at, grant.claim_fingerprint = now, fingerprint
            log_fn(f"grant {operation}/{grant.id} claimed by command {fingerprint[:12]} (window {grant.window()})")
        if grant is not None or store.pruned():
            _save(store, log_fn)
    _log_verdict(operation, check, log_fn)
    return check


def consume_grant(operation: str, fingerprint: str, log_fn: Callable[[str], None]) -> Grant | None:
    """Removes the ONE grant that authorized the command with `fingerprint`:
    the one pre-bash claimed for it (its latest claim, when a retry claimed a
    later window), or, when no claim names it, the grant whose window contains
    now. The windows after it keep their start times. Returns the grant, or
    None when there was none to consume."""
    now = now_utc()
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        if store.reason is not None:
            log_fn(f"no {operation} grant to consume ({store.reason})")
            return None
        claimed = [grant for grant in store.grants if grant.claim_fingerprint == fingerprint]
        grant = max(claimed, key=lambda g: g.claimed_at or g.not_before) if claimed else _verdict(store.grants, now, True).grant
        if grant is None:
            log_fn(f"no {operation} grant claimed by command {fingerprint[:12]} and none open now: nothing consumed")
        else:
            store.grants = [other for other in store.grants if other is not grant]
            how = "its claim" if claimed else "no claim recorded, the grant open now"
            log_fn(f"grant {operation}/{grant.id} consumed ({how}; window {grant.window()})")
        if grant is not None or store.pruned():
            _save(store, log_fn)
    return grant


@dataclass
class GrantIssue:
    """What `add_grants` did: the grants that were pending, the new ones, and
    why the old file was replaced instead of extended, if it was."""

    pending: list[Grant]
    created: list[Grant]
    replaced: str | None


def add_grants(operation: str, count: int, ttl_minutes: int, log_fn: Callable[[str], None]) -> GrantIssue:
    """Appends `count` consecutive windows of `ttl_minutes` each, starting now
    or, when grants are pending, when the last pending window ends. A file
    that cannot be read is replaced. Raises ValueError on a count outside
    1..MAX_GRANTS_PER_CALL or a non-positive TTL, and OSError when the store
    cannot be written."""
    if not 1 <= count <= MAX_GRANTS_PER_CALL:
        raise ValueError(f"count must be between 1 and {MAX_GRANTS_PER_CALL}, received {count}")
    if ttl_minutes <= 0:
        raise ValueError(f"TTL must be positive, received {ttl_minutes}")
    now = now_utc()
    ALLOWED_TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        replaced = store.reason if store.reason in ("corrupt", "malformed") else None
        if replaced:
            log_fn(f"grant file {operation} was {replaced}: replaced by the new grants")
        pending = list(store.grants)
        start = max([now, *(grant.expires_at for grant in pending)])
        step = timedelta(minutes=ttl_minutes)
        created = [
            Grant(uuid.uuid4().hex[:12], start + k * step, start + (k + 1) * step, now, ttl_minutes)
            for k in range(count)
        ]
        _store_grants(operation, pending + created, log_fn)
        for grant in created:
            log_fn(f"grant {operation}/{grant.id} created: window {grant.window()}")
    return GrantIssue(pending, created, replaced)


def pending_grants(operation: str, log_fn: Callable[[str], None]) -> tuple[list[Grant], str | None]:
    """The pending grants of `operation`, pruned as every read prunes, and the
    reason the file could not be read (None when it was read or is absent)."""
    now = now_utc()
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        if store.pruned():
            _save(store, log_fn)
    return store.grants, None if store.reason == "missing" else store.reason


def revoke_grants(operation: str, log_fn: Callable[[str], None]) -> tuple[int, str | None] | None:
    """Deletes every grant of `operation`. None when there was no grant file;
    otherwise the number of pending grants it deleted and, when the file could
    not be read, why. An unreadable file is deleted too: it grants nothing, and
    revoking removes authority; the caller reports it as unreadable rather than
    as a file that held no grant."""
    now = now_utc()
    with _grant_store_lock():
        store = _open_grant_file(operation, now, log_fn)
        if store.reason == "missing":
            return None
        with contextlib.suppress(FileNotFoundError):
            grant_file(operation).unlink()
        if store.reason is None:
            log_fn(f"grants {operation} revoked: {len(store.grants)} pending grant(s) deleted")
        else:
            log_fn(f"grants {operation} revoked: the file was unreadable ({store.reason}) and was deleted")
    return len(store.grants), store.reason
