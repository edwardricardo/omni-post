#!/usr/bin/env python3
"""PreToolUse hook — refuses a write of a file a moved record governs until the
session, or the agent writing, has opened that record (ADR-0045, decision 3).

A record moved out of the auto-loaded context (the first is the dependency
audit record) is read as a file, and a path-scoped rule under `.claude/rules/`
says so when a governed file is touched. The rule alone cannot hold the line:
it loads after the first write of a new file, and never for a file in a sibling
worktree. So `.claude/settings.json` runs this hook twice, told apart by its
argument, and both keyed by session and by agent (`main` for the session):

  record  on Read and Grep, with no `onFailure`: when the call opens a record
          document, one line goes to
          `.claude/state/instruction-context/<session_id>.reads.jsonl`. It never
          refuses: a failure to record only means a later write asks again.
  judge   on Edit, Write, MultiEdit and Bash, with `"onFailure": "block"`: for
          each file the call writes, its own checkout is found, and when that
          checkout's manifest lists a record whose rule governs the file, the
          record must stand there and the same agent must have opened it in an
          earlier call of this session. Otherwise the call is refused with the
          rule's text and the way to open the record.

WHAT OPENS A RECORD: a tool call the harness performed on it, and nothing else:
  - the Read tool on the record;
  - the Grep tool whose `path` (the working directory when absent) is the record
    or a directory that holds it, when its `glob` and `type`, if given, still
    select the record; a directory search skips dot-named directories, as rg
    does.
  A Bash command opens nothing, `rg` and `bat` included: its text says what it
  would run, not what ran (`false && rg x <record>` names a search that never
  happens), so the guard does not read it. The natural sequence is to find the
  lines you need with `rg -n '<term>' <record>`, then Read that range. Opening
  counts, not reading the record whole: a record is large, and its rule says
  how to search it. An opening by the session does not count for an agent,
  nor an agent's for the session.

WHAT IS JUDGED: an Edit, Write or MultiEdit of its file. In a Bash command, and
in every script it hands to a shell (`bash -c`, a substitution, a heredoc fed
to a shell): every destination `pre_bash.effective_write_targets` derives
(redirections, tee, cp, mv, rm, touch, chmod and the other verbs it lists);
every word of a command that holds one of pre-bash's `COARSE_WRITE_RES`
writers whose file is a word of the command (`sed`, `perl` or `ruby` with `-i`
as a word of its own; `git checkout`, `restore`, `apply`, `revert`, `rm`,
`clean`) or that is `sd`, which edits in place by default; and, for a pnpm
command that writes them, `package.json` of the directory it runs in with the
checkout's `pnpm-lock.yaml` and `pnpm-workspace.yaml`. pnpm is read when it
runs directly or through one of PNPM_LAUNCHERS (`corepack pnpm`, `npx pnpm`,
`env … pnpm`).

THE PNPM COMMANDS: every builtin and alias pnpm 12.6.0's `pnpm help` lists (it
refuses `pnpm help -a`), each in one class by what `pnpm help <command>` says
it writes, and where marked by a measurement in a scratch workspace:
  PNPM_WRITES     judged, each under the condition that decides it;
  PNPM_LEAVES     writes no manifest, lockfile or workspace file: passes;
  PNPM_RUNS_CODE  runs a script, a package or a shell command, and writes
                  nothing the guard derives: passes unjudged (the residual);
  PNPM_PREFIXES   `recursive`, `multi` and `m`: the command after it decides.
A word that is no builtin is a script name, so it runs code. The suite reads
the installed pnpm's list and fails naming a command that is in no class, so a
pnpm that adds one goes red until it is classified. PNPM_LEAVES holds where
the lockfile already records pnpm itself (`packageManagerDependencies`), as
this repository's does: measured, pnpm 12.6.0 writes `pnpm-lock.yaml` on most
commands (`list`, `why`, `view`, `outdated`, `root`, `pkg get`) when it does not.

RESIDUAL LIMITS, stated: A write the guard cannot derive passes unjudged: a
script or a pnpm command that runs code, an interpreter one-liner (`python3 -c`,
`node -e`, `perl -pi`), another package manager, a path built from a variable,
`git apply`, and a checkout or a rebase that names no governed file. A line
written into a reads file by hand counts as an opening: `.claude/state/` is not
a guarded path, so only a deliberate act gets there. Two commands are refused
that write no governed file, and each costs one Read of the record: `git
restore --staged package.json`, which changes only the index, and `CI=true pnpm
install`, which pnpm runs frozen in CI.

FAIL-CLOSED in `judge`: input that is not JSON, an edit that names no file, a
manifest or a rule that cannot be read, a mode the settings did not give, and
any exception refuse the call with exit 2; the manifest and a broken rule can
still be edited, so the repair is never locked out. A Bash command that cannot
be read as shell words is refused when its text holds the word `pnpm` or a name
the last named segment of a governed glob matches (`package.json`, `patches`),
the names read from the rules' `paths:`; one that holds neither writes no
governed file the guard could derive, and passes. A checkout with no manifest
is not this project, and a file outside every repository is not governed.

THE SWITCH: with `MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes` in the environment
the hook runs with, no call is judged and the log keeps a line for each.

RETIRED WHEN: per record, its document leaves the tree, or every row of it is
derived by a gate from machine-readable data, so a skipped search cannot lose a
fact; the hook goes with the last record.
"""

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

HOOK_NAME = "pre-tool-record-guard"
HOOK_DIR = Path(__file__).resolve().parent
# The same name as `_instruction_context.SWITCH_ENV`, read before that module is
# imported; a test holds the two equal.
SWITCH_ENV = "MAINTAINER_DISABLE_INSTRUCTION_CHECK"
RECORD_MODE = "record"
JUDGE_MODE = "judge"
EDIT_TOOLS = frozenset({"Edit", "Write", "MultiEdit"})
OPENING_TOOLS = frozenset({"Read", "Grep"})
RECORD_SUFFIX = ".md"
MAIN_AGENT = "main"
MARKDOWN_TYPES = frozenset({"md", "markdown"})

# The pnpm builtins and aliases that write a manifest, the lockfile or the
# workspace file, each with the condition under which it does (pnpm 12.6.0):
#   always              the help names one of them, or does not rule them out:
#                       `lane next` (measured: the workspace file), `prune`
#                       (measured: the lockfile), `runtime` and `env` (save to
#                       `devEngines.runtime` by default), `shim` (a project's
#                       shims), `deploy` (a package.json in its directory),
#                       `with` (another pnpm, whose commands this list does not
#                       hold), `self-update`, `approve-builds`, `link`, `unlink`;
#   unless-frozen       the install family, unless `--frozen-lockfile` ("Don't
#                       generate a lockfile") holds and no LOCKFILE_WRITERS flag;
#   with-lockfile-flag  `ci` and `pipeline` install frozen, unless a
#                       LOCKFILE_WRITERS flag, `--frozen-lockfile=false` or
#                       `--lockfile` (remove the lockfile) is given;
#   with-fix            `audit --fix` and `--interactive` write overrides into
#                       the workspace file or re-resolve the lockfile;
#   unless-check        `dedupe` edits the lockfile unless `--check`;
#   with-lockfile       `clean --lockfile` removes the lockfile (measured);
#   project-location    `config set` and `config delete` write the workspace file
#                       with `--location project` and the user's config.yaml
#                       otherwise (measured);
#   pkg-write           `pkg set`, `delete` and `fix` write package.json.
PNPM_WRITES = {
    **dict.fromkeys(
        ("add", "update", "up", "upgrade", "remove", "uninstall", "rm", "un", "uni", "import", "patch-commit",
         "patch-remove", "set-script", "ss", "init", "version", "approve-builds", "link", "ln", "unlink", "dislink",
         "prune", "lane", "runtime", "rt", "env", "shim", "self-update", "deploy", "with"),
        "always",
    ),
    **dict.fromkeys(("install", "i", "install-test", "it"), "unless-frozen"),
    **dict.fromkeys(("ci", "clean-install", "ic", "install-clean", "pipeline"), "with-lockfile-flag"),
    "audit": "with-fix",
    "dedupe": "unless-check",
    **dict.fromkeys(("clean", "purge"), "with-lockfile"),
    **dict.fromkeys(("config", "c", "set"), "project-location"),
    "pkg": "pkg-write",
}
# The builtins that write no manifest, lockfile or workspace file: they read,
# print, talk to the registry, or touch only the store, the cache, the user's
# own files or files of their own (`change` writes `.changeset/`, measured;
# `patch` an edit directory; `sbom` and `pack-app` their output).
PNPM_LEAVES = frozenset({
    "access", "bugs", "issues", "list", "ls", "ll", "la", "licenses", "licences", "why", "view", "info", "show", "v",
    "sbom", "whoami", "deprecate", "undeprecate", "unpublish", "star", "unstar", "stars", "dist-tag", "dist-tags",
    "ping", "doctor", "search", "s", "se", "find", "outdated", "peers", "patch", "change", "completion", "find-hash",
    "bin", "root", "prefix", "get", "store", "cache", "cat-file", "cat-index", "ignored-builds", "fetch", "docs",
    "home", "repo", "setup", "login", "adduser", "team", "owner", "owners", "logout", "edit", "profile", "token",
    "xmas", "help", "pack-app",
})
# The builtins that run code the guard cannot read: a script, a package's
# lifecycle scripts (`rebuild`, `pack`, `publish`, `stage`), or a command.
PNPM_RUNS_CODE = frozenset({
    "test", "t", "tst", "run", "run-script", "start", "stop", "restart", "exec", "dlx", "create", "tasks", "rebuild",
    "rb", "pack", "publish", "stage",
})
PNPM_PREFIXES = frozenset({"recursive", "multi", "m"})
# The install flags whose help says they write, or may write, the lockfile.
LOCKFILE_WRITERS = frozenset({
    "--no-frozen-lockfile", "--fix-lockfile", "--lockfile-only", "--prefer-frozen-lockfile",
    "--merge-git-branch-lockfiles", "--update-checksums",
})
AUDIT_FIXES = frozenset({"--fix", "-i", "--interactive"})
PNPM_VALUE_FLAGS = frozenset({"-C", "--dir", "-F", "--filter", "--filter-prod", "--reporter", "--loglevel", "--store-dir", "--lockfile-dir", "--modules-dir", "--virtual-store-dir", "--workspace-concurrency", "--location"})
PNPM_FLAGS = frozenset({
    "-r", "--recursive", "-w", "--workspace-root", "-s", "--silent", "--stream", "--parallel", "--aggregate-output",
    "--no-bail", "--bail", "--color", "--no-color", "-D", "--save-dev", "-P", "--save-prod", "-O", "--save-optional",
    "-E", "--save-exact", "--offline", "--prefer-offline", "--ignore-scripts", "--frozen-lockfile", "--check",
    "-v", "--version", "-y", "--yes",
})
# Programs that run the pnpm named after them with its own arguments.
PNPM_LAUNCHERS = frozenset({"corepack", "npx", "env", "sudo", "timeout", "nice", "nohup", "command", "xargs"})
PNPM_WRITES_FILES = ("package.json",)
PNPM_ROOT_WRITES = ("pnpm-lock.yaml", "pnpm-workspace.yaml")
# Programs that edit the files they name in place by default.
IN_PLACE_EDITORS = frozenset({"sd"})

# An unreadable command is held to these: the word pnpm, and the words split
# at the characters a shell or an option joins them with.
PNPM_WORD_RE = re.compile(r"(?<![\w.-])pnpm(?![\w-])")
WORD_SPLIT_RE = re.compile(r"[\s'\"`<>|;&()$\\{}=,]+")

# One glob line of the front matter the instruction-context gate requires of a
# record's rule: two spaces, a dash, a space, a double-quoted glob with no
# escape and no control character.
GLOB_LINE_RE = re.compile(r'^  - "([^"\\\x00-\x1f\x7f]*)"$')

OPENING_FORMS = (
    "What opens it: the Read tool on it; the Grep tool with it, or a directory that holds it, as its path, "
    "with a glob or type, if given, that still selects it. A Bash command does not count, rg and bat included: "
    "its text says what it would run, not what ran."
)


@dataclass(frozen=True)
class Opening:
    """A path a Read or a Grep call opens, absolute and resolved, with the
    filters that decide which files under a directory a Grep reads."""

    path: str
    globs: tuple[str, ...] = ()
    types: tuple[str, ...] = ()


def _log(message: str) -> None:
    """A hooks.log line; never raises, so no decision depends on it."""
    try:
        sys.path.insert(0, str(HOOK_DIR))
        from _common import make_logger

        make_logger(HOOK_NAME)[0](message)
    except Exception:  # noqa: BLE001 - the log line is best effort by contract
        pass


def parse_rule(text: str) -> tuple[list[str], str] | None:
    """The globs and the body of a rule written in the form the gate requires
    of a record's rule: a `---` line, `paths:`, one quoted glob per line, and
    the closing `---`; None for anything else."""
    if not text.startswith("---\n"):
        return None
    close = text.find("---", 4)
    after = text[close + 3:] if close != -1 else ""
    if close == -1 or text[close - 1] != "\n" or not (after == "" or after.startswith("\n")):
        return None
    lines = [line for line in text[4:close].split("\n") if line]
    if len(lines) < 2 or lines[0] != "paths:":
        return None
    globs: list[str] = []
    for line in lines[1:]:
        match = GLOB_LINE_RE.match(line)
        if match is None:
            return None
        globs.append(match.group(1))
    return globs, after.lstrip("\n")


def _closing(text: str, start: int, opening: str, closing: str) -> int:
    depth = 0
    for index in range(start, len(text)):
        if text[index] == opening:
            depth += 1
        elif text[index] == closing:
            depth -= 1
            if depth == 0:
                return index
    return -1


def _alternatives(text: str) -> list[str]:
    parts, depth, current = [], 0, ""
    for char in text:
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
            continue
        depth += {"{": 1, "}": -1}.get(char, 0)
        current += char
    return [*parts, current]


def _pattern(glob: str) -> str:
    """A regular expression for `glob`: `**/` any number of whole segments, a
    trailing `**` anything, `*` and `?` within one segment, `[…]` a class and
    `{a,b}` either branch. Wildcards also match dot-named segments, so the
    guard governs at least every file the harness's matcher would."""
    out: list[str] = []
    index = 0
    while index < len(glob):
        if glob.startswith("**/", index):
            out.append("(?:[^/]*/)*")
            index += 3
            continue
        if glob.startswith("**", index):
            out.append(".*")
            index += 2
            continue
        char = glob[index]
        if char == "*":
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        elif char == "[" and (end := glob.find("]", index + 2)) != -1:
            body = glob[index + 1:end]
            out.append("[" + ("^" + body[1:] if body.startswith("!") else body).replace("\\", "\\\\") + "]")
            index = end + 1
            continue
        elif char == "{" and (end := _closing(glob, index, "{", "}")) != -1:
            out.append("(?:" + "|".join(_pattern(branch) for branch in _alternatives(glob[index + 1:end])) + ")")
            index = end + 1
            continue
        else:
            out.append(re.escape(char))
        index += 1
    return "".join(out)


def glob_matches(glob: str, path: str) -> bool:
    """Whether the relative `path` matches a glob, read as the harness and the
    gate read a rule's glob, and as rg reads `--glob`: a glob with no slash
    matches at any depth, and a leading slash anchors it to the root."""
    if glob.startswith("/"):
        body = glob[1:]
    elif "/" in glob:
        body = glob
    else:
        body = "**/" + glob
    return re.fullmatch(_pattern(body), path) is not None


def _resolve(base: str, path: str) -> str:
    return os.path.realpath(os.path.join(base, os.path.expanduser(path)))


def _cwd(data: dict) -> str:
    import _instruction_context as ic

    cwd = data.get("cwd")
    return cwd if isinstance(cwd, str) and os.path.isabs(cwd) else str(ic.PROJECT_ROOT)


def _take_value(args: list[str], index: int, attached: str) -> tuple[str | None, int]:
    """The value of a flag: the text attached to it, or the next word."""
    if attached:
        return attached, index
    if index < len(args):
        return args[index], index + 1
    return None, index


def call_openings(data: dict) -> list[Opening]:
    """The paths a Read or a Grep call opens; none for any other tool."""
    tool = data.get("tool_name")
    tool_input = data.get("tool_input")
    if tool not in OPENING_TOOLS or not isinstance(tool_input, dict):
        return []
    cwd = _cwd(data)
    if tool == "Read":
        target = tool_input.get("file_path")
        return [Opening(_resolve(cwd, target))] if isinstance(target, str) and target else []
    target = tool_input.get("path")
    if target is not None and not (isinstance(target, str) and target):
        return []
    glob, kind = tool_input.get("glob"), tool_input.get("type")
    if (glob is not None and not isinstance(glob, str)) or (kind is not None and not isinstance(kind, str)):
        return []
    return [Opening(_resolve(cwd, target or "."), (glob,) if glob else (), (kind,) if kind else ())]


def _selects(opening: Opening, document: str) -> bool:
    """Whether `opening` reads the record at `document` (both resolved)."""
    if opening.path == document:
        relative = os.path.basename(document)
    elif document.startswith(opening.path.rstrip("/") + "/") and os.path.isdir(opening.path):
        relative = document[len(opening.path.rstrip("/")) + 1:]
        if any(part.startswith(".") for part in relative.split("/")):
            return False
    else:
        return False
    includes = [glob for glob in opening.globs if not glob.startswith("!")]
    excludes = [glob[1:] for glob in opening.globs if glob.startswith("!")]
    if includes and not any(glob_matches(glob, relative) for glob in includes):
        return False
    if any(glob_matches(glob, relative) for glob in excludes):
        return False
    return not opening.types or any(kind in MARKDOWN_TYPES for kind in opening.types)


def opened_records(data: dict) -> list[tuple[str, Path]]:
    """The record documents the call opens, each with its checkout."""
    import _instruction_context as ic
    from _common import repository_of

    manifests: dict[Path, object] = {}
    found: list[tuple[str, Path]] = []
    for opening in call_openings(data):
        root = repository_of(Path(opening.path))
        if root is None:
            continue
        if root not in manifests:
            try:
                manifests[root] = ic.load_manifest(root)
            except ic.ManifestError:
                manifests[root] = None
        manifest = manifests[root]
        for record in manifest.records if manifest is not None else ():
            document = os.path.realpath(root / record.document)
            if _selects(opening, document) and (record.document, root) not in found:
                found.append((record.document, root))
    return found


def _agent(data: dict) -> str:
    agent = data.get("agent_id")
    return agent if isinstance(agent, str) and agent else MAIN_AGENT


def note_reads(data: dict, state_root: Path) -> int:
    """Records each record document the call opens, under the session's state
    in `state_root`; returns how many. Raises ValueError for a session id that
    names no state file."""
    import _instruction_context as ic

    opened = opened_records(data)
    if not opened:
        return 0
    path = ic.state_file(state_root, data.get("session_id"), ic.READS)
    for document, root in opened:
        ic.append_entry(path, {"agent": _agent(data), "document": document, "root": str(root), "tool": data.get("tool_name")})
    return len(opened)


def _segments_with_base(command: str, cwd: str) -> list[tuple[list[str], str | None]] | None:
    """Every command of `command` from its program on, with the directory it
    runs in as the text says: `cwd`, moved by each `cd` or `pushd` before it,
    None after one the text does not resolve. None when unreadable."""
    from _common import command_words, program_index, shell_segments

    segments = shell_segments(command)
    if segments is None:
        return None
    base: str | None = cwd
    out: list[tuple[list[str], str | None]] = []
    for segment in segments:
        words = command_words(segment)
        start = program_index(words)
        if start is None:
            continue
        words = words[start:]
        if words[0] in ("cd", "pushd"):
            target = next((word for word in words[1:] if not word.startswith("-")), None)
            if target is None or target.startswith(("~", "$")) or (base is None and not target.startswith("/")):
                base = None
            else:
                base = _resolve(base or "/", target)
            continue
        out.append((words, base))
    return out


def pnpm_arguments(words: list[str]) -> list[str] | None:
    """The arguments pnpm receives from one command: `pnpm …`, or the words
    after the first `pnpm` or `pnpm@<version>` a launcher names; None when the
    command does not run pnpm."""
    program = Path(words[0]).name
    if program == "pnpm":
        return words[1:]
    if program in PNPM_LAUNCHERS:
        for index, word in enumerate(words[1:], start=1):
            if Path(word).name == "pnpm" or word.startswith("pnpm@"):
                return words[index + 1:]
    return None


def pnpm_writes(subcommand: str | None, positionals: list[str], flags: dict[str, str]) -> bool:
    """Whether a pnpm command writes a manifest, the lockfile or the workspace
    file, by PNPM_WRITES and the flags its condition names."""
    condition = PNPM_WRITES.get(subcommand or "")
    if condition is None:
        return False
    unfrozen = bool(LOCKFILE_WRITERS & flags.keys()) or flags.get("--frozen-lockfile") == "false"
    if condition == "always":
        return True
    if condition == "unless-frozen":
        return unfrozen or flags.get("--frozen-lockfile") not in ("", "true")
    if condition == "with-lockfile-flag":
        return unfrozen or "--lockfile" in flags
    if condition == "with-fix":
        return bool(AUDIT_FIXES & flags.keys())
    if condition == "unless-check":
        return "--check" not in flags
    if condition == "with-lockfile":
        return "--lockfile" in flags
    if condition == "project-location":
        action = "set" if subcommand == "set" else (positionals[0] if positionals else "")
        return action in ("set", "delete") and flags.get("--location") == "project"
    if condition == "pkg-write":
        return bool(positionals) and positionals[0] in ("set", "delete", "fix")
    return True


def pnpm_targets(args: list[str], base: str) -> list[str]:
    """The files a pnpm with `args`, run in `base`, may write: none unless
    `pnpm_writes` says it writes them. An unknown flag before the subcommand
    makes every word a candidate subcommand, judged as one that writes."""
    from _common import repository_of

    directory, subcommand, uncertain = base, None, False
    flags: dict[str, str] = {}
    positionals: list[str] = []
    index = 0
    while index < len(args):
        word = args[index]
        index += 1
        if word == "--":
            break
        if word.startswith("-") and word != "-":
            name, equals, value = word.partition("=")
            if name in PNPM_VALUE_FLAGS and not equals:
                value, index = _take_value(args, index, "")
            if name in ("-C", "--dir") and value:
                directory = _resolve(base, value)
            elif name not in PNPM_VALUE_FLAGS and name not in PNPM_FLAGS and subcommand is None:
                uncertain = True
            flags[name] = value or ""
            continue
        if subcommand is None:
            if word not in PNPM_PREFIXES:
                subcommand = word
        else:
            positionals.append(word)
    writes = pnpm_writes(subcommand, positionals, flags) or (uncertain and any(word in PNPM_WRITES for word in args))
    if not writes:
        return []
    targets = [os.path.join(directory, name) for name in PNPM_WRITES_FILES]
    root = repository_of(Path(directory))
    if root is not None:
        targets.extend(str(root / name) for name in PNPM_ROOT_WRITES)
    return targets


def bash_write_targets(data: dict, command: str, depth: int = 0) -> list[str] | None:
    """The files a Bash command writes, as the header lists, in the command and
    in every script it hands to a shell; None when some part cannot be read as
    shell words."""
    from _common import MAX_SHELL_DEPTH, nested_scripts
    from pre_bash import COARSE_WRITE_RES, effective_write_targets

    cwd = _cwd(data)
    segments = _segments_with_base(command, cwd)
    scripts = nested_scripts(command)
    # effective_write_targets reads the nested scripts itself, so it runs once, on the whole command.
    direct = effective_write_targets(command, Path(cwd)) if depth == 0 else []
    if segments is None or scripts is None or direct is None or depth > MAX_SHELL_DEPTH:
        return None
    targets = [_resolve(cwd, target) for target in direct]
    for words, base in segments:
        where = base or cwd
        if Path(words[0]).name in IN_PLACE_EDITORS or any(rx.search(" ".join(words)) for rx in COARSE_WRITE_RES):
            targets.extend(_resolve(where, word) for word in words[1:] if not word.startswith("-"))
        arguments = pnpm_arguments(words)
        if arguments is not None:
            targets.extend(pnpm_targets(arguments, where))
    for script in scripts:
        nested = bash_write_targets(data, script, depth + 1)
        if nested is None:
            return None
        targets.extend(nested)
    return list(dict.fromkeys(targets))


def governed_names(roots: list[Path]) -> list[str]:
    """The last named segment of every glob of every record's rule in the
    checkouts at `roots` (`**/package.json` gives `package.json`, `patches/**`
    gives `patches`, a glob of `**` alone gives `*`). Raises ManifestError,
    OSError or UnicodeDecodeError when a manifest or a rule cannot be read, and
    ValueError for a rule not in the form the gate requires."""
    import _instruction_context as ic

    names: list[str] = []
    for root in roots:
        try:
            manifest = ic.load_manifest(root)
        except ic.ManifestMissing:
            continue
        for record in manifest.records:
            rule = parse_rule(ic.read_regular_file(root / record.rule).decode("utf-8"))
            if rule is None:
                raise ValueError(f"the rule {record.rule} does not open with the paths: front matter the gate requires")
            for glob in rule[0]:
                segments = [segment for segment in glob.split("/") if segment not in ("", "**")]
                names.append(segments[-1] if segments else "*")
    return list(dict.fromkeys(names))


def unreadable_refusal(data: dict, command: str, state_root: Path) -> str | None:
    """For a Bash command that cannot be read as shell words: the refusal when
    its text holds the word pnpm or a name a governed glob matches, read from
    the rules of the command's checkout and of the hooks'; None otherwise."""
    import _instruction_context as ic
    from _common import repository_of

    lead = (
        "The record guard refused this Bash command: it cannot be read as shell words (an unclosed quote, or "
        "nesting deeper than pre-bash reads)"
    )
    roots: list[Path] = []
    for start in (Path(_cwd(data)), state_root):
        root = repository_of(start)
        if root is not None and root not in roots:
            roots.append(root)
    try:
        names = governed_names(roots)
    except (ic.ManifestError, OSError, UnicodeDecodeError, ValueError) as error:
        return f"{lead}, and the names a record governs cannot be read ({error}), so the guard cannot tell whether it writes one. Correct it and run it again."
    named = ["the word pnpm"] if PNPM_WORD_RE.search(command) else []
    patterns = [re.compile(_pattern(name)) for name in names]
    for word in WORD_SPLIT_RE.split(command):
        for segment in word.split("/"):
            if segment and segment not in named and any(pattern.fullmatch(segment) for pattern in patterns):
                named.append(segment)
    if not named:
        return None
    return (
        f"{lead}, and its text names {', '.join(named)}, which a governed write could hold, so the guard cannot "
        "tell what it writes. Correct it and run it again."
    )


class Judge:
    """Judges writes of one call: caches the agent's recorded openings."""

    def __init__(self, data: dict, state_root: Path):
        self.data = data
        self.state_root = state_root
        self.agent = _agent(data)
        self._reads: list[dict] | None = None

    def _opened(self, document: str) -> bool:
        import _instruction_context as ic

        if self._reads is None:
            self._reads = ic.read_entries(ic.state_file(self.state_root, self.data.get("session_id"), ic.READS)) or []
        return any(entry.get("agent") == self.agent and entry.get("document") == document for entry in self._reads)

    def judge(self, tool: str, absolute: str) -> str | None:
        """None when a write of `absolute` may proceed; otherwise the refusal."""
        import _instruction_context as ic
        from _common import repository_of

        root = repository_of(Path(absolute))
        relative = None if root is None else ic.relative_to_root(root, absolute)
        if root is None or relative is None:
            return None
        try:
            manifest = ic.load_manifest(root)
        except ic.ManifestMissing:
            return None
        except ic.ManifestError as error:
            if relative == ic.MANIFEST:
                return None
            return (
                f"The record guard refused this {tool} of {relative}: {error}, so the guard cannot tell which files "
                f"a record governs. Repair the manifest first (an edit of {ic.MANIFEST} passes), or restore it: "
                f"git -C {root} checkout -- {ic.MANIFEST}"
            )
        for record in manifest.records:
            if relative == record.document:
                continue
            refusal = self._judge_record(ic, tool, root, relative, record)
            if refusal:
                return refusal
        return None

    def _judge_record(self, ic, tool: str, root: Path, relative: str, record) -> str | None:
        exempt = relative in (ic.MANIFEST, record.rule)
        try:
            rule = parse_rule(ic.read_regular_file(root / record.rule).decode("utf-8"))
        except (OSError, UnicodeDecodeError) as error:
            if exempt:
                return None
            return (
                f"The record guard refused this {tool} of {relative}: the rule {record.rule} could not be read "
                f"({error}), so the guard cannot tell which files it governs. Restore it: git -C {root} checkout -- {record.rule}"
            )
        if rule is None:
            if exempt:
                return None
            return (
                f"The record guard refused this {tool} of {relative}: the rule {record.rule} does not open with the "
                "paths: front matter the instruction-context gate requires, so the guard cannot tell which files it "
                f"governs. Repair it (an edit of the rule passes), or restore it: git -C {root} checkout -- {record.rule}"
            )
        globs, body = rule
        if not any(glob_matches(glob, relative) for glob in globs):
            return None
        problem = ic.probe(root / record.document)
        if problem is not None:
            return (
                f"The record guard refused this {tool}: {relative} is governed by the record {record.document}, and "
                f"{record.document} {problem} in {root}. Restore it: git -C {root} checkout -- {record.document}"
            )
        try:
            opened = self._opened(record.document)
        except ValueError as error:
            return f"The record guard refused this {tool} of {relative}: {error}, so the guard cannot tell whether this session opened {record.document}."
        return None if opened else _refusal(tool, relative, record, body, root, self.agent)


def _refusal(tool: str, relative: str, record, body: str, root: Path, agent: str) -> str:
    import _instruction_context as ic

    who = "this session" if agent == MAIN_AGENT else f"the agent {agent}"
    return "\n".join(
        [
            f"The record guard refused this {tool}: {relative} is governed by the record {record.document}, "
            f"and {who} has not opened that record yet.",
            "",
            f"The rule {record.rule} says:",
            body.strip(),
            "",
            f"Open the record before the write: find the lines you need with rg -n '<term>' {root}/{record.document}, "
            "then Read that range with the Read tool, or search the record with the Grep tool. Then make the write "
            "again. An opening by the session does not count for an agent, nor an agent's for the session: each "
            "opens the record itself.",
            OPENING_FORMS,
            f"To work while this waits, the Maintainer starts the session with {ic.SWITCH_ENV}=yes.",
        ]
    )


def judge_call(data: dict, state_root: Path) -> str | None:
    """None when the call may proceed; otherwise the refusal, with what is
    wrong and its repair. The openings are looked up under `state_root`."""
    tool = data.get("tool_name")
    tool_input = data.get("tool_input")
    if tool in EDIT_TOOLS:
        file_path = tool_input.get("file_path") if isinstance(tool_input, dict) else None
        if not isinstance(file_path, str) or not file_path:
            return f"The record guard refused this {tool}: it names no file, so the guard cannot tell whether a record governs it."
        return Judge(data, state_root).judge(str(tool), _resolve(_cwd(data), file_path))
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        return "The record guard refused this Bash call: it carries no command, so the guard cannot tell what it writes."
    targets = bash_write_targets(data, command)
    if targets is None:
        return unreadable_refusal(data, command, state_root)
    judge = Judge(data, state_root)
    for target in targets:
        refusal = judge.judge("Bash command", target)
        if refusal:
            return refusal
    return None


def _refuse(text: str) -> None:
    try:
        print(text, file=sys.stderr)
    finally:
        _log("BLOCK: " + text.splitlines()[0])
        sys.exit(2)


def _record(data: object) -> None:
    """The `record` mode: notes the openings of a record, and never refuses.
    A call of any tool but Read and Grep, and a Read of a file that is not
    Markdown, return before anything is imported."""
    if not isinstance(data, dict):
        sys.exit(0)
    tool, tool_input = data.get("tool_name"), data.get("tool_input")
    if tool not in OPENING_TOOLS or not isinstance(tool_input, dict):
        sys.exit(0)
    if tool == "Read" and not str(tool_input.get("file_path", "")).endswith(RECORD_SUFFIX):
        sys.exit(0)
    try:
        sys.path.insert(0, str(HOOK_DIR))
        import _instruction_context as ic

        note_reads(data, ic.PROJECT_ROOT)
    except Exception as error:  # noqa: BLE001 - a read is never refused; the write asks again
        _log(f"could not record the opening of a record ({type(error).__name__}: {error})")
    sys.exit(0)


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        raw = sys.stdin.read()
    except Exception:  # noqa: BLE001 - unreadable input is refused below as input that is not JSON
        raw = ""
    try:
        data = json.loads(raw)
    except ValueError:
        data = None
    if mode == RECORD_MODE:
        _record(data)
    if mode != JUDGE_MODE:
        _refuse(
            f"The record guard ran without its mode (argument {mode!r}): .claude/settings.json runs it as "
            "`pre_tool_record_guard.py record` and `pre_tool_record_guard.py judge`. Run pnpm check:instruction-context."
        )
    if not isinstance(data, dict):
        _refuse("The record guard could not read its input as a JSON object, so it cannot tell what this call writes.")
    tool = data.get("tool_name")
    if tool not in EDIT_TOOLS and tool != "Bash":
        sys.exit(0)
    if os.environ.get(SWITCH_ENV) == "yes":
        tool_input = data.get("tool_input")
        target = tool_input.get("file_path", tool_input.get("command")) if isinstance(tool_input, dict) else None
        _log(f"SWITCH: {SWITCH_ENV}=yes, {tool} of {target} not judged")
        sys.exit(0)
    try:
        sys.path.insert(0, str(HOOK_DIR))
        import _instruction_context as ic

        refusal = judge_call(data, ic.PROJECT_ROOT)
    except Exception as error:  # noqa: BLE001 - an exception must refuse the call, never let it through
        refusal = (
            f"The record guard failed ({type(error).__name__}: {error}) and refuses this {tool}. Report it to the "
            f"Maintainer; to work meanwhile, the Maintainer starts the session with {SWITCH_ENV}=yes."
        )
    if refusal:
        _refuse(refusal)
    sys.exit(0)


if __name__ == "__main__":
    main()
