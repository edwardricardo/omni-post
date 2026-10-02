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

import fcntl
import json
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NoReturn


# Repository root, resolved from the location of THIS file
# (.claude/hooks-py/_common.py -> .claude/ -> root), never from the process
# cwd. Claude Code runs the hooks with the session's cwd, which can be a
# subdirectory: with cwd-relative paths, a token created at the root was
# invisible from apps/api ("missing") and every hook seeded an orphan
# `.claude/` in whatever directory it happened to run in.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

LOG_PATH = PROJECT_ROOT / ".claude" / "hooks.log"

# Time-boxed authorization tokens created by `.claude/bin/omnipost-allow`.
# One token per operation (`push`, `sensitive-edit`, ...). Validated
# identically by pre-bash and pre-edit (shared contract, no drift).
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
_SHELL_SEPARATORS = frozenset({"&&", "||", ";", "|"})
# Fallback when shlex cannot tokenize (unclosed quote): the conservative form
# `git … commit` within one shell segment. Only `commit` is recoverable this
# way; a gate on another subcommand cannot rely on the fallback.
_GIT_COMMIT_FALLBACK_RE = re.compile(r"\bgit\b[^|;&\n]*\bcommit\b")


def _unquote(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        return token[1:-1]
    return token


def _shell_tokens(command: str) -> list[str]:
    """Shell tokens with `&&`, `||`, `;` and `|` as tokens of their OWN even when
    glued (`git commit&&…`); inside quotes they remain text. Raises ValueError
    on an unclosed quote, like shlex.split."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def shell_segments(command: str) -> list[list[str]] | None:
    """The commands of `command` as token lists, split at `&&`, `||`, `;` and
    `|` (glued separators included); None when it cannot be tokenized."""
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


def runs_git_push(command: str) -> bool:
    """Whether `command` publishes: some git invocation in it has `push` as
    its REAL subcommand, read the way the commit gate reads `commit`.

    The earlier test was a regex for the words `git` and `push` anywhere on the
    line, so a line that only read the token's own path
    (`.claude/.allowed/push`), searched for the word, or named a branch after it
    passed for a publication: the pre hook demanded a token and the post hook
    CONSUMED it, with nothing published (measured 2026-10-02, hooks.log
    11:05:19). `git stash push` is a local stash, not a publication.

    A script passed to a shell with `-c` (`bash -c "git push …"`) is read too,
    since the quoted script would otherwise be one opaque token. A line shlex
    cannot tokenize falls back to the broad regex, on the conservative side.
    Not covered, stated: a publication inside a script file or a function is
    invisible to any reading of the command line.
    """
    try:
        _shell_tokens(command)
    except ValueError as e:
        _append_log(f"runs_git_push: untokenizable command ({e}); conservative fallback")
        return bool(_GIT_PUSH_FALLBACK_RE.search(command))
    if "push" in git_subcommands(command):
        return True
    for segment in shell_segments(command) or []:
        if Path(segment[0]).name not in _SHELLS:
            continue
        for i, tok in enumerate(segment[1:-1], start=1):
            if tok.startswith("-") and not tok.startswith("--") and "c" in tok[1:]:
                if runs_git_push(segment[i + 1]):
                    return True
                break
    return False


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


def check_grant_token(operation: str, log_fn: Callable[[str], None]) -> str | None:
    """Validate the time-boxed token for `operation` in .claude/.allowed/<op>.

    Returns None when the token is valid (not expired). Returns the reason
    ("missing"|"corrupt"|"malformed"|"expired") otherwise, deleting the file
    when expired. Identical contract for `push` and `sensitive-edit`.
    """
    token_path = ALLOWED_TOKENS_DIR / operation
    if not token_path.exists():
        return "missing"
    try:
        with token_path.open("r") as f:
            token_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log_fn(f"ERROR: token {operation} unreadable: {e}")
        return "corrupt"
    expires_at_str = token_data.get("expires_at")
    if not expires_at_str:
        log_fn(f"ERROR: token {operation} missing expires_at")
        return "malformed"
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
    except ValueError as e:
        log_fn(f"ERROR: token {operation} invalid expires_at: {e}")
        return "malformed"
    if datetime.now(timezone.utc) >= expires_at:
        log_fn(f"token {operation} expired (was {expires_at_str})")
        try:
            token_path.unlink()
        except OSError:
            pass
        return "expired"
    log_fn(f"token {operation} valid (expires {expires_at_str})")
    return None
