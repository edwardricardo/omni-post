#!/usr/bin/env python3
"""Pre-bash hook — blocks forbidden commands before they run."""

import os
import re
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    GIT_PUSH_RE,
    PROJECT_ROOT,
    check_grant_token,
    commit_repos,
    current_branch,
    git_subcommands,
    make_logger,
    read_hook_input,
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
_WRITE_VERBS = frozenset({"tee", "cp", "mv", "install", "rsync", "ln", "rm", "rmdir", "unlink", "shred", "truncate", "dd"})
# Of these, the source is only read: the destination is the LAST operand.
_DESTINATION_LAST_VERBS = frozenset({"cp", "mv", "install", "rsync", "ln"})
_REDIRECTS = frozenset({">", ">>", "&>", "&>>"})
_NOT_A_FILE = frozenset({"/dev/null", "/dev/stdout", "/dev/stderr"})
_ENV_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
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


def write_targets(command: str) -> list[str] | None:
    """Paths that the write constructs of `command` name as a destination:
    redirections (except /dev/null and the `>&N`), the last operand of
    cp/mv/install/rsync/ln (the source is only read), every operand of
    tee/rm/rmdir/unlink/shred/truncate, and `dd of=`; None when it cannot be
    tokenized."""
    segments = shell_segments(command)
    if segments is None:
        return None
    targets: list[str] = []
    for segment in segments:
        words: list[str] = []
        i = 0
        while i < len(segment):
            tok = segment[i]
            if tok in _REDIRECTS and i + 1 < len(segment):
                target = segment[i + 1]
                if target not in _NOT_A_FILE and not target.startswith("&"):
                    targets.append(target)
                i += 2
            elif tok.startswith(("<", ">")):
                # input, heredoc or descriptor duplication: operator and operand are not arguments
                i += 2
            else:
                words.append(tok)
                i += 1
        while words and (_ENV_ASSIGNMENT_RE.match(words[0]) or words[0] in ("sudo", "command", "nice")):
            words.pop(0)
        if not words or words[0] not in _WRITE_VERBS:
            continue
        verb, args = words[0], words[1:]
        if verb == "dd":
            targets.extend(arg[3:] for arg in args if arg.startswith("of="))
            continue
        if "--" in args:
            args = args[args.index("--") + 1:]
        operands = [arg for arg in args if not arg.startswith("-")]
        if verb in _DESTINATION_LAST_VERBS and len(operands) >= 2:
            operands = operands[-1:]
        targets.extend(operands)
    return targets


def gate_sensitive_path_writes_require_token(command: str) -> None:
    """Require the `sensitive-edit` token when Bash writes a sensitive path.

    Same contract as pre-edit, same pattern list (imported, not copied): what
    Edit/Write cannot touch without a token, Bash cannot either.

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
    if not mentioned:
        return
    targets = write_targets(command)
    coarse = any(rx.search(command) for rx in COARSE_WRITE_RES)
    if targets is None:
        coarse = coarse or _UNTOKENIZABLE_WRITE_RE.search(command) is not None
        targets = []
    matched_path = next(
        (pattern for pattern in mentioned if coarse or any(_mentions(pattern, target) for target in targets)),
        None,
    )
    if matched_path is None:
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
        f"Ask Edward to run 'omnipost-allow sensitive-edit' (TTL 15 min), "
        f"as for push. If the command only READS, rewrite it without "
        f"write constructs on that path."
    )


log, block, allow = make_logger(HOOK_NAME)


# ────────────────────────────────────────────────────────────────────
# Gates — each one checks a single thing.
# ────────────────────────────────────────────────────────────────────


def gate_git_push_requires_token(command: str) -> None:
    """Block the remote-publish command unless a valid token exists.

    Validation delegated to the shared `check_grant_token` helper — the
    same contract pre-edit uses for `sensitive-edit` (no drift).

    LIMITATION: matches variants with intermediate flags (-C /path,
    --git-dir, ...) but not && composition (cd /path && ...).
    """
    if not GIT_PUSH_RE.search(command):
        return

    status = check_grant_token("push", log)
    if status is None:
        log("push token valid, deferring consumption to post-hook")
        allow("remote publish authorized via valid token")

    messages = {
        "missing": (
            "Remote publish requires authorization. Ask Edward in chat; "
            "he runs 'omnipost-allow push' and you retry."
        ),
        "corrupt": (
            "Authorization token corrupt. Edward must inspect "
            ".claude/.allowed/push, delete it, and re-run 'omnipost-allow push'."
        ),
        "malformed": (
            "Authorization token malformed (missing/!expires_at). "
            "Edward must re-run 'omnipost-allow push'."
        ),
        "expired": (
            "Authorization token expired. "
            "Ask Edward for a fresh one via 'omnipost-allow push'."
        ),
    }
    block(messages[status])


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

    gate_git_push_requires_token(command)
    gate_sensitive_path_writes_require_token(command)
    gate_no_npm_yarn_or_npx(command)
    gate_no_co_authored_in_commit(command)
    gate_commit_only_in_allowed_branch(command, Path(data.get("cwd") or PROJECT_ROOT))
    gate_db_migrations_require_running_db(command)
    gate_no_patches_in_ts_writes(command)

    allow("command passed all gates")


if __name__ == "__main__":
    main()
