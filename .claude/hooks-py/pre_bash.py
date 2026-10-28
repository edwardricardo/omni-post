#!/usr/bin/env python3
"""Pre-bash hook — blocks forbidden commands before they run."""

import fnmatch
import os
import re
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    ENV_ASSIGNMENT_RE,
    INLINE_CODE,
    INTERPRETER_RE,
    MAX_SHELL_DEPTH,
    PROJECT_ROOT,
    STDIN_SCRIPT,
    check_grant_token,
    claim_grant,
    command_fingerprint,
    command_words,
    commit_repos,
    current_branch,
    format_local,
    git_subcommands,
    grant_cli_invocations,
    make_logger,
    nested_scripts,
    program_index,
    read_hook_input,
    runs_git_push,
    shell_segments,
)

# THE SAME list pre-edit gates on, imported rather than copied. A second copy of
# these patterns would drift the moment one file gained a path the other did not
# — and a sensitive-path list that disagrees with itself protects whichever half
# the writer did not go through.
from pre_edit import SENSITIVE_PATTERNS  # noqa: E402

HOOK_NAME = "pre-bash"
ALLOWED_BRANCH_PREFIX = "workstream/"

# Detects commands that write (redirect / tee) to a .ts/.tsx file.
# Covers: 'cat > foo.ts <<EOF', 'echo ... > bar.tsx', 'tee baz.ts'.
WRITES_TS_RE = re.compile(r"(>\s*\S*\.tsx?\b|\btee\s+\S*\.tsx?\b)")
# Syntactic type-check suppressions forbidden by CLAUDE.md.
TS_IGNORE_RE = re.compile(r"@ts-(ignore|nocheck)")
CONSOLE_LOG_RE = re.compile(r"\bconsole\.log\s*\(")
# Production paths where console.log is forbidden.
PROD_PATH_RE = re.compile(r"(apps/api/src/|packages/[^/]+/src/)")
# Prisma migration commands that need a running DB.
PNPM_MIGRATE_RE = re.compile(r"pnpm\s+(?:db:migrate|db:push|prisma\s+migrate)")

# What counts as WRITING a path through Bash. It exists because the sensitive-
# path gate lived only in pre-edit, which inspects `tool_input.file_path` — a
# field Bash does not have. An agent denied the `Edit` on
# `.github/workflows/fitness.yml` had already written the file with `python3`
# through Bash: the gate did not fail, that path simply never went through it.
#
# Two classes. The constructs whose DESTINATION is read from the command
# (redirection, tee, cp/mv/rm/…, dd of=) block only when that destination is the
# sensitive path: `cat > /tmp/x <<EOF` with the path inside the heredoc,
# `2>/dev/null` or `2>&1` are NOT writes to that path — measured: three false
# blocks in one day teach people to dodge the gate, which is how gates die. The
# constructs whose destination sits in code or in arguments the text does not
# order (`sed -i`, `open('w')`, `git checkout`) block by mention.
# `touch` creates a file, `chmod`/`chown`/`chgrp` change who may read or run
# one: `chmod -x` on a hook leaves it unfired, which is how a gate is switched off.
_WRITE_VERBS = frozenset(
    {"tee", "cp", "mv", "install", "rsync", "ln", "rm", "rmdir", "unlink", "shred", "truncate", "dd",
     "touch", "chmod", "chown", "chgrp"}
)
# Of these, the source is only read: the destination is the LAST operand. `mv`
# is not one of them: it removes its sources, so every operand is written.
_DESTINATION_LAST_VERBS = frozenset({"cp", "install", "rsync", "ln"})
# `>|` writes even under noclobber; `<>` opens the file for reading AND writing.
_REDIRECTS = frozenset({">", ">>", "&>", "&>>", ">|", "<>"})
_NOT_A_FILE = frozenset({"/dev/null", "/dev/stdout", "/dev/stderr"})
_ENV_ASSIGNMENT_RE = ENV_ASSIGNMENT_RE
COARSE_WRITE_RES = [
    re.compile(r"\b(?:sd|sed|perl|ruby)\b[^|;]*\s-i\b"),            # in-place edit
    re.compile(r"\bpython3?\b[^|;]*\bopen\s*\([^)]*['\"][wax]"),   # open(...,'w')
    re.compile(r"\bnode\b[^|;]*\bwrite(?:File|FileSync)\b"),        # fs.writeFile
    re.compile(r"\bgit\s+(?:checkout|restore|apply|revert|rm|clean)\b"),  # restore or delete content
]
# Fallback when the command cannot be tokenized (unclosed quote): every
# redirection or write verb counts, by mention.
_UNTOKENIZABLE_WRITE_RE = re.compile(r">>?|\b(?:" + "|".join(sorted(_WRITE_VERBS)) + r")\b")


def _mentions(pattern: str, text: str) -> bool:
    """`pattern` (with a leading "/", as in pre-edit) named in `text`.

    It is also compared without that slash, because a command usually cites
    relative paths — but with a BOUNDARY: a bare `in` made `.env` match INSIDE
    `process.env`, which appears in countless legitimate read-only commands.
    `process.env` does not match (the `s` precedes it); `.env`, `cp .env`,
    `../.env` and `--env-file=.env` do.
    """
    stripped = pattern.lstrip("/")
    return pattern in text or re.search(r"(?<![A-Za-z0-9_])" + re.escape(stripped), text) is not None


def _segment_write_targets(segment: list[str]) -> list[str]:
    """The destinations one command writes: see `write_targets`."""
    targets: list[str] = []
    words: list[str] = []
    i = 0
    while i < len(segment):
        tok = segment[i]
        operand = segment[i + 1] if i + 1 < len(segment) else None
        if tok in _REDIRECTS and operand is not None:
            if operand not in _NOT_A_FILE and not operand.startswith("&"):
                targets.append(operand)
            i += 2
        elif tok == ">&" and operand is not None and not operand.isdigit() and operand != "-":
            # `>& file` sends stdout and stderr to a file; `2>&1` only duplicates a descriptor
            if operand not in _NOT_A_FILE:
                targets.append(operand)
            i += 2
        elif tok.startswith(("<", ">")):
            # input, heredoc or descriptor duplication: operator and operand are not arguments
            i += 2
        else:
            words.append(tok)
            i += 1
    start = program_index(words)
    words = [] if start is None else words[start:]
    while words and (_ENV_ASSIGNMENT_RE.match(words[0]) or words[0] in ("sudo", "command", "nice")):
        words.pop(0)
    if not words or Path(words[0]).name not in _WRITE_VERBS:
        return targets
    verb, args = Path(words[0]).name, words[1:]
    if verb == "dd":
        targets.extend(arg[3:] for arg in args if arg.startswith("of="))
        return targets
    if "--" in args:
        args = args[args.index("--") + 1:]
    operands = [arg for arg in args if not arg.startswith("-") and arg not in ("(", ")", "{", "}")]
    if verb in _DESTINATION_LAST_VERBS and len(operands) >= 2:
        operands = operands[-1:]
    targets.extend(operands)
    return targets


def write_targets(command: str) -> list[str] | None:
    """Paths that the write constructs of `command` name as a destination:
    redirections (except /dev/null and the `>&N`), the last operand of
    cp/install/rsync/ln (the source is only read), every operand of
    mv/tee/rm/rmdir/unlink/shred/truncate/touch/chmod/chown/chgrp, and
    `dd of=`; None when it cannot be tokenized."""
    segments = shell_segments(command)
    if segments is None:
        return None
    return [target for segment in segments for target in _segment_write_targets(segment)]


def _moved_base(base: str | None, operands: list[str]) -> str | None:
    """The directory a `cd`/`pushd` with `operands` moves `base` to, or None
    when it cannot be read from the text (`cd`, `cd -`, `cd ~`, a variable).
    An empty `base` is the starting directory when no session cwd is known:
    `cd .claude` from it is `.claude`."""
    destination = next((operand for operand in operands if not operand.startswith("-")), None)
    if destination is None or destination.startswith(("~", "$")):
        return None
    if destination.startswith("/") or base == "":
        return destination
    return None if base is None else f"{base}/{destination}"


def _resolved(base: str | None, target: str) -> str:
    """`target` as written from `base`; as given when it is absolute or the
    base is unknown or the starting directory."""
    return target if not base or target.startswith(("/", "~")) else f"{base}/{target}"


def effective_write_targets(command: str, cwd: Path | None = None, depth: int = 0) -> list[str] | None:
    """`write_targets` of `command` and of every script it hands to a shell
    (`bash -c "…"`, `$(…)`, a heredoc fed to a shell), each relative target
    resolved against the directory it is written from: `cwd`, moved by every
    `cd` or `pushd` before it. None when some part cannot be tokenized.

    Read without the directory, `cd .claude/.allowed && touch push` writes
    `push`, which names nothing; and read without the nested script, `bash -c
    "rm …"` writes nothing at all."""
    segments = shell_segments(command)
    scripts = nested_scripts(command)
    if segments is None or scripts is None or depth > MAX_SHELL_DEPTH:
        return None
    base: str | None = "" if cwd is None else str(cwd)
    targets: list[str] = []
    for segment in segments:
        words = command_words(segment)
        index = program_index(words)
        if index is not None and words[index] in ("cd", "pushd"):
            base = _moved_base(base, words[index + 1:])
            continue
        targets.extend(_resolved(base, target) for target in _segment_write_targets(segment))
    for script in scripts:
        nested = effective_write_targets(script, cwd, depth + 1)
        if nested is None:
            return None
        targets.extend(nested)
    return targets


def _targets_pattern(pattern: str, target: str) -> bool:
    """`target` is the sensitive `pattern` or lies under it. A directory named
    without its trailing slash (`rm -rf .claude/hooks-py`) is the directory
    the pattern names (`/.claude/hooks-py/`)."""
    return _mentions(pattern, target) or _mentions(pattern, target.rstrip("/") + "/")


def gate_sensitive_path_writes_require_token(command: str, cwd: Path | None = None) -> None:
    """Require the `sensitive-edit` token when Bash writes a sensitive path.

    Same contract as pre-edit, same pattern list (imported, not copied): what
    Edit/Write cannot touch without a token, Bash cannot either. The write
    targets are read as `effective_write_targets` reads them: relative to the
    session `cwd` and to each `cd`, and inside every script handed to a shell.

    READING STAYS FREE, deliberately: `bat schema.prisma`, `rg x migrations/`
    or a `prisma migrate diff` are used all the time and mutate nothing.
    Blocking every mention would make inspection unusable and push people to
    find a way around it, which is exactly how gates die.

    LIMIT, stated plainly: this is a tripwire, not a sandbox. A shell can
    obfuscate the path with variables, `eval`, base64 or a script on disk that
    builds the path in pieces, and no inspection of the command will see it.
    What it closes is the ACCIDENTAL bypass and the convenience one — it raises
    the cost of evasion from "wrote python3 instead of Edit" to "a deliberate
    act of concealment". That jump is the point; claiming full equivalence with
    pre-edit would be the kind of lie this repo hunts down.
    """
    mentioned = [pattern for pattern in SENSITIVE_PATTERNS if _mentions(pattern, command)]
    targets = effective_write_targets(command, cwd)
    coarse = any(rx.search(command) for rx in COARSE_WRITE_RES)
    if targets is None:
        coarse = coarse or _UNTOKENIZABLE_WRITE_RE.search(command) is not None
        targets = []
    matched_path = next(
        (
            pattern
            for pattern in SENSITIVE_PATTERNS
            if (coarse and pattern in mentioned) or any(_targets_pattern(pattern, target) for target in targets)
        ),
        None,
    )
    if matched_path is None:
        if mentioned:
            log(f"sensitive path {mentioned[0]} mentioned, no write construct targets it — read-only, allowed")
        return

    status = check_grant_token("sensitive-edit", log)
    if status is None:
        log(f"sensitive Bash write to {matched_path} authorized via valid sensitive-edit token")
        return

    block(
        f"Bash writes a sensitive path ({matched_path}) without a token: {status}.\n"
        f"It is the SAME gate pre-edit applies to Edit/Write — with the gate only "
        f"on Edit, a `python3`, an `sd -i` or a `>` went around it without anyone "
        f"noticing.\n"
        f"Ask the Maintainer to run 'omnipost-allow sensitive-edit' (TTL 15 min), "
        f"as for push. If the command only READS, rewrite it without "
        f"write constructs on that path."
    )


log, block, allow = make_logger(HOOK_NAME)


# ────────────────────────────────────────────────────────────────────
# Gates — each one checks a single thing.
# ────────────────────────────────────────────────────────────────────


# A mention of the grant store: `.allowed` as a path segment.
_GRANT_STORE_RE = re.compile(r"(?<![\w.-])\.allowed(?![\w-])")
_GLOB_CHARS = frozenset("*?[")
# Programs that run another program given as an argument; with a write verb
# among their arguments (`xargs rm`, `find … -exec rm`) the write is theirs.
_RUNS_ITS_ARGUMENTS = frozenset({"xargs", "parallel", "find", "env", "timeout", "nohup", "nice", "watch", "sudo", "command"})


def _segment_names(part: str, name: str, previous: str) -> bool:
    """One path segment `part` is `name`, or a glob that matches it which a
    shell would expand to it: one that starts with a dot, or any glob right
    under `.claude` (`dotglob` makes `*` match dot files)."""
    if part == name:
        return True
    return bool(_GLOB_CHARS.intersection(part)) and fnmatch.fnmatchcase(name, part) and (part.startswith(".") or previous == ".claude")


def names_grant_store(target: str) -> bool:
    """Whether writing `target` writes the grant store: a path with a
    `.allowed` segment, or the `.claude` directory that holds it (`rm -rf
    .claude` deletes the store with it). Globs that would expand to either
    count."""
    parts = os.path.normpath(target).split("/")
    for index, part in enumerate(parts):
        if _segment_names(part, ".allowed", parts[index - 1] if index else ""):
            return True
    return _segment_names(parts[-1], ".claude", parts[-2] if len(parts) > 1 else "")


def _every_segment(command: str, depth: int = 0) -> list[list[str]]:
    """The commands of `command` and of every script it hands to a shell; a
    part that cannot be tokenized contributes nothing (the callers have read
    it as untokenizable already)."""
    segments = shell_segments(command) or []
    if depth > MAX_SHELL_DEPTH:
        return segments
    for script in nested_scripts(command) or []:
        segments.extend(_every_segment(script, depth + 1))
    return segments


def grant_store_write(command: str, cwd: Path | None = None) -> str | None:
    """How `command` writes the grant store, or None when it does not.

    Read as the sensitive-path gate reads a write — the destinations of
    redirections and write verbs, relative to the session `cwd` and to each
    `cd`, inside every script handed to a shell — and, because this directory
    is where authority lives, more strictly: by mention of `.allowed`, any
    in-place edit or file write in code, any interpreter, any write verb run
    through `xargs`/`find -exec`/`-delete`, and, on a line the tokenizer
    cannot read, any redirection or write verb at all. Reading stays free:
    `ls`, `eza`, `cat`, `bat` and `jq` on the store write nothing.
    """
    mentions = _GRANT_STORE_RE.search(command) is not None
    targets = effective_write_targets(command, cwd)
    coarse = any(rx.search(command) for rx in COARSE_WRITE_RES)
    if targets is None:
        if mentions and (coarse or _UNTOKENIZABLE_WRITE_RE.search(command)):
            return "a line the tokenizer cannot read names the grant store beside a write construct"
        return None
    hit = next((target for target in targets if names_grant_store(target)), None)
    if hit is not None:
        return f"it writes {hit}"
    if not mentions:
        return None
    if coarse:
        return "an in-place edit or a file write in code names the grant store"
    for segment in _every_segment(command):
        words = command_words(segment)
        index = program_index(words)
        if index is None:
            continue
        name = Path(words[index]).name
        if INTERPRETER_RE.match(name):
            return f"{name} runs code on a line that names the grant store"
        later = words[index + 1:]
        if name in _RUNS_ITS_ARGUMENTS and any(Path(word).name in _WRITE_VERBS or word == "-delete" for word in later):
            return f"{name} runs a write on a line that names the grant store"
    return None


def gate_grant_store_is_owner_only(command: str, cwd: Path | None = None) -> None:
    """Blocks every Bash write to `.claude/.allowed/`. No token unlocks it: a
    session that could write the store could issue its own push grant, and
    the `sensitive-edit` token it might hold is itself a file there."""
    how = grant_store_write(command, cwd)
    if how is None:
        return
    block(
        f"Bash writes the grant store (.claude/.allowed/): {how}. No session writes it, "
        f"with or without a token: only the Maintainer issues, extends or revokes grants, from "
        f"their own terminal, with 'omnipost-allow'. Reading it (ls, eza, cat, bat, jq) "
        f"stays allowed; 'omnipost-allow status' lists what is pending."
    )


def _describe_invocation(arguments: list[str]) -> str:
    if arguments in ([STDIN_SCRIPT], [INLINE_CODE]):
        return f"it hands {arguments[0]} to a shell or an interpreter on a line that names omnipost-allow"
    return f"it runs 'omnipost-allow{''.join(' ' + argument for argument in arguments)}'"


# On a line the tokenizer cannot read: a mention of the CLI that is not exactly
# `omnipost-allow status` followed by the end of a command.
_GRANT_CLI_FALLBACK_RE = re.compile(r"(?<![\w-])omnipost-allow(?![\w-])(?!\s+status[ \t]*(?:$|[;&|)\n]))", re.MULTILINE)


def gate_only_the_owner_issues_grants(command: str) -> None:
    """Blocks every run of `omnipost-allow` except `omnipost-allow status`.

    Grants are the Maintainer's act: a session that ran `omnipost-allow push` would
    authorize itself. The CLI is read as `grant_cli_invocations` reads it —
    by basename or path, through `bash -c`, a substitution, `python3 <path>`,
    a wrapper such as `timeout` or `xargs` — and a line the tokenizer cannot
    read that names it is refused unless every mention is `status`. No token
    unlocks it. Reading the CLI's source (`bat`, `rg`, `git diff`) is not
    running it.
    """
    invocations = grant_cli_invocations(command)
    if invocations is None:
        if not _GRANT_CLI_FALLBACK_RE.search(command):
            return
        how = "a line the tokenizer cannot read names omnipost-allow with something other than 'status'"
    else:
        refused = [arguments for arguments in invocations if arguments != ["status"]]
        if not refused:
            if invocations:
                log("omnipost-allow status: read-only, allowed")
            return
        how = _describe_invocation(refused[0])
    block(
        f"{how}. Grants are the Maintainer's: only the Maintainer issues, extends or revokes "
        f"them, from their own terminal; no token unlocks this. A session may run "
        f"'omnipost-allow status' and nothing else. Ask the Maintainer in chat."
    )


_PUSH_MESSAGES = {
    "missing": (
        "Remote publish requires authorization. Ask the Maintainer in chat; "
        "the Maintainer runs 'omnipost-allow push' (or 'omnipost-allow push --count K --ttl N' for "
        "consecutive windows) and you retry."
    ),
    "corrupt": (
        "Authorization token corrupt. The Maintainer must inspect "
        ".claude/.allowed/push, delete it ('omnipost-allow revoke push'), and re-run 'omnipost-allow push'."
    ),
    "malformed": (
        "Authorization token malformed (missing/invalid expires_at or grants). "
        "The Maintainer must re-run 'omnipost-allow push'."
    ),
    "expired": (
        "Authorization token expired: every push window is over. "
        "Ask the Maintainer for a fresh one via 'omnipost-allow push'."
    ),
}


def gate_git_push_requires_token(command: str) -> None:
    """Block the remote-publish command unless a push window is open now.

    `claim_grant` records the command on the grant of that window, and
    post-bash consumes exactly that grant: one publication per window. What
    counts as a publication is `runs_git_push`, the reading post-bash uses:
    the two hooks cannot disagree about which line published. It returns
    instead of allowing, so the gates after it still run: an early exit here
    let `git push && <write to a hook>` through every other gate.
    """
    if not runs_git_push(command):
        return

    check = claim_grant("push", command_fingerprint(command), log)
    if check.reason is None:
        log("push grant claimed, deferring consumption to post-hook")
        return
    if check.reason == "not-yet-open" and check.next_opens_at is not None:
        message = (
            f"Authorization not yet open: the next window opens at {format_local(check.next_opens_at)}. "
            f"Each window allows one publication; retry once it opens, or ask the Maintainer."
        )
    else:
        message = _PUSH_MESSAGES.get(
            check.reason, f"Authorization unavailable ({check.reason}). Ask the Maintainer in chat."
        )
    block(message)


def gate_no_npm_yarn_or_npx(command: str) -> None:
    pattern = r"(^|\s)(npm|yarn)\s+(install|i|add|ci|run|exec|update|upgrade)"
    if re.search(pattern, command):
        block("OmniPost convention: use pnpm, never npm/yarn. Rewrite the command with 'pnpm'.")
    if re.search(r"(^|\s)npx\s+\S", command):
        block("OmniPost convention: use `pnpm dlx` / `pnpm exec`, never npx. Rewrite the command.")


def gate_no_co_authored_in_commit(command: str) -> None:
    if "commit" not in git_subcommands(command):
        return
    if re.search(r"co-authored-by:\s*claude", command, re.IGNORECASE):
        block("Trailer 'Co-Authored-By: Claude' is forbidden. Remove it and retry.")


def gate_commit_only_in_allowed_branch(command: str, session_cwd: Path) -> None:
    """Blocks `git commit` outside a `workstream/*` branch.

    The branch is read in the repository EACH commit points at (`cd <path> &&`,
    or the `-C`/`--work-tree` of THAT invocation; otherwise the session `cwd`)
    — not in the cwd of the hook process, which never sees the branch of a
    `cd <worktree> && git commit`.

    `session_cwd` is the `cwd` of the hook input: the directory where the Bash
    tool runs the command, and the one a relative `cd` resolves against. Each
    distinct repository is probed ONCE and the probe stays in hooks.log, so a
    divergence between that cwd and the real one is visible.
    """
    for repo in dict.fromkeys(commit_repos(command, session_cwd)):
        branch = current_branch(repo)
        log(f"commit gate: {repo} -> branch '{branch}'")
        if not branch.startswith(ALLOWED_BRANCH_PREFIX):
            block(
                f"Branch '{branch}' in {repo} does not accept commits. "
                f"Only {ALLOWED_BRANCH_PREFIX}*."
            )


_DATABASE_URL_RE = re.compile(r"^\s*(?:export\s+)?DATABASE_URL=['\"]?postgres(?:ql)?://[^@\s]+@([^:/?\s'\"]+)(?::(\d+))?")


def database_target() -> tuple[str, int] | None:
    """(host, port) of DATABASE_URL — from the environment or the root `.env` —
    or None when there is none to read."""
    lines = []
    if os.environ.get("DATABASE_URL"):
        lines.append(f"DATABASE_URL={os.environ['DATABASE_URL']}")
    try:
        lines.extend((PROJECT_ROOT / ".env").read_text(encoding="utf-8").splitlines())
    except OSError:
        pass
    for line in lines:
        match = _DATABASE_URL_RE.match(line)
        if match:
            return match.group(1), int(match.group(2) or 5432)
    return None


def postgres_reachable(host: str, port: int, timeout: float = 2.0) -> bool:
    """True when something accepts TCP on host:port (the DB lives in another
    LXC: `docker ps` here never saw it, so a container check measures nothing)."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def gate_db_migrations_require_running_db(command: str) -> None:
    """Blocks the Prisma migrations when Postgres does not answer where
    DATABASE_URL says it is."""
    if not PNPM_MIGRATE_RE.search(command):
        return
    target = database_target()
    if target is None:
        log("migrate gate: no DATABASE_URL to probe — not blocking")
        return
    host, port = target
    if not postgres_reachable(host, port):
        block(
            f"Postgres does not answer at {host}:{port} (DATABASE_URL). Start the DB "
            f"(`pnpm db:up`) before migrating."
        )


def gate_no_patches_in_ts_writes(command: str) -> None:
    """Blocks @ts-ignore/@ts-nocheck in any write to .ts/.tsx, and
    console.log when the write goes to apps/api/src/ or packages/*/src/.

    Applies only when the command clearly writes (redirect, tee). Avoids
    false positives from read commands such as `grep '@ts-ignore'`.
    """
    if not WRITES_TS_RE.search(command):
        return
    if TS_IGNORE_RE.search(command):
        block(
            "@ts-ignore / @ts-nocheck are forbidden in production code "
            "(CLAUDE.md zero-tolerance). Resolve the type properly — use "
            "interfaces, generics, or `unknown` + type guard."
        )
    if PROD_PATH_RE.search(command) and CONSOLE_LOG_RE.search(command):
        block(
            "console.log is forbidden in production (CLAUDE.md 'Zero console.* in "
            "production code'). Use `createLogger(name)` from `apps/api/src/lib/logger.ts` "
            "or `@observability/logger`, whichever applies."
        )


# ────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────


def main() -> None:
    data = read_hook_input(log)

    tool_name = data.get("tool_name", "")
    command = data.get("tool_input", {}).get("command", "")

    if tool_name != "Bash":
        allow(f"not bash (tool={tool_name})")

    log(f"inspecting: {command}")
    session_cwd = Path(data.get("cwd") or PROJECT_ROOT)

    # The two Maintainer-only gates come first and no token reaches them.
    gate_only_the_owner_issues_grants(command)
    gate_grant_store_is_owner_only(command, session_cwd)
    gate_sensitive_path_writes_require_token(command, session_cwd)
    gate_no_npm_yarn_or_npx(command)
    gate_no_co_authored_in_commit(command)
    gate_commit_only_in_allowed_branch(command, session_cwd)
    gate_db_migrations_require_running_db(command)
    gate_no_patches_in_ts_writes(command)
    # Last: it claims a push grant, which only a command every other gate let
    # through may do.
    gate_git_push_requires_token(command)

    allow("command passed all gates")


if __name__ == "__main__":
    main()
