#!/usr/bin/env python3
"""UserPromptSubmit hook — blocks the prompt of a session that lacks a required
instruction file (ADR-0045, decision 3).

WHY THE PROMPT: no event at session start can block. `SessionStart` shows its
stderr and goes on, and `InstructionsLoaded`, which reports each file the
harness loads, runs asynchronously and ignores its exit code. The first event
that can refuse is the first prompt, and a prompt refused here never reaches
the model. So the check runs at every prompt, over the loads the recorder
(`instructions_loaded.py`) wrote for this session since it started.

WHAT IT REQUIRES: every `tracked` file of `.claude/instruction-manifest.json`,
and every `local` file when the checkout's marker stands (the recorder writes it
the first time it records a local file loaded here) or when the checkout is a
main checkout that holds any of them (`_instruction_context.required_files`).
A required file must stand on disk as a non-empty regular file, which is
decided at once, and must appear in the session's record. The loads are
reported asynchronously, so the record may still be filling when the first
prompt arrives: the check reads it again every POLL_SECONDS for at most
WAIT_SECONDS, and passes the moment it is complete.

THE HARNESS: `.claude/settings.json` wires this hook with
`"onFailure": "block"`, which makes the harness refuse the prompt when the hook
cannot start, exits with a code other than 0 or 2, or times out; the key has
effect from Claude Code 2.1.295 and an older harness ignores it. So the check
refuses a harness that does not name, in `AI_AGENT`, a version of 2.1.295 or
later (measured: `claude-code_2-1-326_harness` for 2.1.326 and
`claude-code_2-1-143_harness` for 2.1.143; the variable is not in the hooks
reference). Residual limit: on an older harness, when this process cannot
start at all (no python3, a file that lost its executable bit), the prompt goes
through; the instruction-context gate holds that each hook file is tracked,
executable and wired with `onFailure`. The value can be forged: an `env` block
in a settings source overrides what the harness sets (measured with a
`--settings` file). The gate refuses `AI_AGENT` in the tracked settings' `env`;
a source the hooks do not guard can still set it, and what a forged value gains
is that fail-open of a check that cannot start, on an old harness, and nothing
else.

FAIL-CLOSED inside the process: every failure ends in exit 2 with a message,
since the harness reads only exit 2 as a refusal of its own choosing: input
that is not JSON, no session id, a harness it cannot place, a missing or
malformed manifest, a marker or a record it cannot read, and any exception,
including one raised while importing the shared module. The refusal does not
depend on the log line being written.

THE SWITCH: `MAINTAINER_DISABLE_INSTRUCTION_CHECK=yes` in the environment the
hook runs with lets every prompt through. It is read before anything that can
fail, so it opens a session whatever state the files are in. Whoever sets it,
in a terminal or in a settings source the hooks do not guard (see
`_instruction_context.SWITCH_ENV`), it cannot stay on in silence: every prompt
shows a warning that says how to switch it back on, and writes a line to
`.claude/hooks.log`.

Files the harness reports as loaded at session start that the manifest does
not list are named once per session in the context and in the log: the
harness's own cross-check of the gate's derivation. They do not block.

A loaded file stays in the record: one that stops loading after the session's
first load of it (its import removed, then a compaction) still passes until
the session ends; only what stands on disk is checked again at every prompt.

RETIRED WHEN: the harness itself refuses a session that lacks a required
instruction file, or `CLAUDE.md` imports nothing and no local file remains.
"""

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

HOOK_NAME = "user-prompt-instruction-check"
EVENT = "UserPromptSubmit"
HOOK_DIR = Path(__file__).resolve().parent
# The same name as `_instruction_context.SWITCH_ENV`: read here, before that
# module is imported, so a module that fails to import cannot hold the switch
# shut. A test holds the two equal.
SWITCH_ENV = "MAINTAINER_DISABLE_INSTRUCTION_CHECK"
WAIT_SECONDS = 5.0
POLL_SECONDS = 0.1
UNLISTED_MEMORY_TYPES = frozenset({"Project", "Local"})
UNLISTED_LOAD_REASONS = frozenset({"session_start", "include", "compact"})
# The first version in which `onFailure` has effect, and where the harness says
# which version it is.
MIN_HARNESS = (2, 1, 295)
HARNESS_ENV = "AI_AGENT"
HARNESS_RE = re.compile(r"^claude-code_(\d+)-(\d+)-(\d+)(?:_|$)")

SWITCH_WARNING = (
    f"The instruction check is switched off ({SWITCH_ENV}=yes): this session is not checked for its "
    "required instruction files, and edits of files a record governs are not guarded. To switch it "
    f"back on, end this session and start it again from a terminal where the variable is unset "
    f"(unset {SWITCH_ENV}), with no settings file that sets it."
)
SWITCH_REPAIR = (
    f"To work while the repair waits, the Maintainer starts the session from a terminal with "
    f"{SWITCH_ENV}=yes; every prompt then warns that the check is off."
)


@dataclass
class Outcome:
    """What the check found: one line per lack, each with its repair (empty
    when the session passes), how many files it required, and the files
    loaded at start that the manifest does not list."""

    blocked: list[str] = field(default_factory=list)
    required: int = 0
    unlisted: list[str] = field(default_factory=list)


def _log(message: str) -> None:
    """A hooks.log line; never raises, so no outcome depends on it."""
    try:
        sys.path.insert(0, str(HOOK_DIR))
        from _common import make_logger

        make_logger(HOOK_NAME)[0](message)
    except Exception:  # noqa: BLE001 - the log line is best effort by contract
        pass


def _emit(output: dict) -> None:
    print(json.dumps(output))


def _session_of(raw: str) -> str:
    """The session id the input carries, for a message; `unknown` when none
    can be read."""
    try:
        data = json.loads(raw)
    except ValueError:
        return "unknown"
    session = data.get("session_id") if isinstance(data, dict) else None
    return session if isinstance(session, str) and session else "unknown"


def _refuse(lines: list[str], session: str) -> None:
    """Exit 2 with every lack and its repair on stderr: the harness shows it
    and the prompt never reaches the model."""
    text = "\n".join(
        [
            f"The instruction check blocked this prompt (session {session}). What it found, each with its repair:",
            *(f"  - {line}" for line in lines),
            "Then send the prompt again.",
            SWITCH_REPAIR,
        ]
    )
    try:
        print(text, file=sys.stderr)
    finally:
        _log(f"BLOCK: session {session}: " + " | ".join(lines))
        sys.exit(2)


def _switched_off(raw: str) -> None:
    """The Maintainer's switch: the warning reaches the person (systemMessage)
    and the model (additionalContext), and the log keeps one line per prompt."""
    _log(f"SWITCH: {SWITCH_ENV}=yes, the check did not run (session {_session_of(raw)})")
    _emit({"systemMessage": SWITCH_WARNING, "hookSpecificOutput": {"hookEventName": EVENT, "additionalContext": SWITCH_WARNING}})
    sys.exit(0)


def harness_problem(value: str | None) -> str | None:
    """None when `value`, the harness's `AI_AGENT`, names Claude Code 2.1.295
    or later; otherwise why the check refuses the session."""
    match = HARNESS_RE.match(value or "")
    if match is None:
        if value is None:
            named = "does not name its version (AI_AGENT is unset)"
        elif value == "":
            named = "does not name its version (AI_AGENT is empty)"
        else:
            named = f"names no version in AI_AGENT ({value!r})"
        described = f"a harness that {named}"
    else:
        version = tuple(int(part) for part in match.groups())
        if version >= MIN_HARNESS:
            return None
        described = "Claude Code " + ".".join(map(str, version))
    minimum = ".".join(map(str, MIN_HARNESS))
    problem = (
        f"this session runs {described}, and the instruction hooks need Claude Code {minimum} or later: from "
        "that version a hook wired with \"onFailure\": \"block\" refuses the prompt when it cannot start, exits "
        "with a code other than 0 or 2, or times out, where an older harness lets the prompt through. Upgrade "
        f"Claude Code to {minimum} or later (claude update, or the IDE extension's update) and start the session again."
    )
    if match is None:
        # The variable is not in the harness's reference, so a later release may stop setting it:
        # an upgrade cannot repair that, and the refusal has to say what can.
        problem += (
            f" If this harness is already {minimum} or later and no longer names its version in {HARNESS_ENV}, "
            "an upgrade does not help: the check has to be taught where the version is reported now, and until "
            "then the switch below is the way through."
        )
    return problem


def _lack_on_disk(ic, root: Path, name: str, manifest, problem: str, marker: Path, seen: bool) -> str:
    where = f"{name} {problem} {'from' if problem == ic.MISSING else 'in'} the checkout."
    if name in manifest.local and name not in manifest.tracked:
        if seen:
            return (
                f"{where} It is a local file git ignores, and the marker {marker} records that this checkout has "
                "loaded its local files: restore it from its backup. When this checkout is meant to hold none, "
                f"remove the marker: rm {marker}"
            )
        return (
            f"{where} It is a local file git ignores, and this checkout holds another one: restore it from its "
            f"backup, or, when it was retired on purpose, delete its line from local in {ic.MANIFEST} with an editor."
        )
    return f"{where} Restore it: git -C {root} checkout -- {name}"


def _lack_in_record(name: str, session: str) -> str:
    return (
        f"{name} is in the checkout, and the harness did not report it as loaded in this session. A file "
        "imported with @ loads only while its import line stands, and one outside the project only once "
        f"its import is approved: restore the import, then end the session and resume it (claude --resume {session})."
    )


def _no_record(ic, root: Path, session: str) -> str:
    return (
        f"No record of the instruction files loaded in session {session} exists "
        f"({ic.STATE_DIR}/{session}.{ic.LOADED}.jsonl in {root}). A session that was already running when "
        "the instruction hooks reached this checkout has none, and neither has one whose record was cleaned "
        f"away: end it and resume it once (claude --resume {session}), and the harness reports every "
        "instruction file again. If a new session shows this, either the recorder could not write (a full "
        f"disk, a file where {ic.STATE_DIR} belongs, a directory it may not write: hooks.log holds a "
        "'could not record' line of instructions-loaded), or it is not wired: run pnpm check:instruction-context."
    )


def _unlisted(ic, root: Path, manifest, entries: list[dict]) -> list[str]:
    listed = set(manifest.tracked) | set(manifest.local)
    names: set[str] = set()
    for entry in entries:
        if entry.get("agent_id") or entry.get("memory_type") not in UNLISTED_MEMORY_TYPES:
            continue
        if entry.get("load_reason") not in UNLISTED_LOAD_REASONS or not isinstance(entry.get("file_path"), str):
            continue
        name = ic.relative_to_root(root, os.path.realpath(entry["file_path"]))
        if name is not None and name not in listed:
            names.add(name)
    return sorted(names)


def check_session(
    root: Path, session: str, *, markers: Path | None = None, clock=time.monotonic, sleep=time.sleep, wait: float = WAIT_SECONDS
) -> Outcome:
    """The check over the checkout at `root` for one session; `markers` is the
    directory of the checkout markers (the user's by default). Raises only on
    an unexpected failure, which the caller turns into a refusal."""
    import _instruction_context as ic

    try:
        manifest = ic.load_manifest(root)
    except ic.ManifestError as error:
        return Outcome(blocked=[f"{error}. Restore it: git -C {root} checkout -- {ic.MANIFEST}"])
    marker = ic.marker_path(root, markers)
    try:
        seen = ic.local_files_seen(root, markers)
    except ic.NotARegularFile:
        return Outcome(
            blocked=[
                f"the marker of this checkout's local files, {marker}, is not a regular file (a symbolic link, a "
                "directory or another kind of file stands there), so the check cannot tell whether this checkout "
                f"must hold them. Remove it: rm -r {marker}. The recorder writes it again, as a regular file, the "
                "next time this checkout loads a local file."
            ]
        )
    except OSError as error:
        return Outcome(
            blocked=[
                f"the marker of this checkout's local files, {marker}, could not be read ({error}), so the check "
                f"cannot tell whether this checkout must hold them. Make {marker.parent} a readable directory again."
            ]
        )
    required = ic.required_files(root, manifest, seen)
    outcome = Outcome(required=len(required))
    for name in required:
        problem = ic.probe(root / name)
        if problem is not None:
            outcome.blocked.append(_lack_on_disk(ic, root, name, manifest, problem, marker, seen))
    if outcome.blocked:
        return outcome
    expected = {name: os.path.realpath(root / name) for name in required}
    record = ic.state_file(root, session, ic.LOADED)
    deadline = clock() + wait
    while True:
        try:
            entries = ic.read_entries(record)
        except OSError as error:
            outcome.blocked = [f"the record {record} could not be read ({error}). Repair its permissions, or delete it and resume the session (claude --resume {session})."]
            return outcome
        loaded = {os.path.realpath(entry["file_path"]) for entry in entries or [] if isinstance(entry.get("file_path"), str)}
        lacking = [name for name, path in expected.items() if path not in loaded]
        if not lacking:
            outcome.unlisted = _unlisted(ic, root, manifest, entries or [])
            return outcome
        if clock() >= deadline:
            outcome.blocked = [_no_record(ic, root, session)] if entries is None else [_lack_in_record(name, session) for name in lacking]
            return outcome
        sleep(POLL_SECONDS)


def _run(raw: str) -> None:
    sys.path.insert(0, str(HOOK_DIR))
    import _instruction_context as ic

    try:
        data = json.loads(raw)
    except ValueError as error:
        _refuse([f"the check could not read its input as JSON ({error})."], "unknown")
    if not isinstance(data, dict):
        _refuse(["the check could not read its input: it is not a JSON object."], "unknown")
    session = data.get("session_id")
    try:
        ic.state_file(ic.PROJECT_ROOT, session, ic.LOADED)
    except ValueError as error:
        _refuse([f"{error}, so the check cannot find what this session loaded."], "unknown")
    problem = harness_problem(os.environ.get(HARNESS_ENV))
    if problem is not None:
        _refuse([problem], session)
    outcome = check_session(ic.PROJECT_ROOT, session)
    if outcome.blocked:
        _refuse(outcome.blocked, session)
    _log(f"ALLOW: {outcome.required} required instruction files loaded (session {session})")
    if outcome.unlisted:
        from _common import notice_already_sent

        if not notice_already_sent(session, "instruction-check:unlisted:" + ",".join(outcome.unlisted)):
            names = ", ".join(outcome.unlisted)
            _log(f"NOTICE: loaded at session start and not in {ic.MANIFEST}: {names}")
            _emit(
                {
                    "hookSpecificOutput": {
                        "hookEventName": EVENT,
                        "additionalContext": (
                            f"[instruction-check] The harness loaded at session start files {ic.MANIFEST} does not "
                            f"list: {names}. The gate pnpm check:instruction-context holds the auto-loaded set to "
                            "the manifest: list each file there, or stop loading it."
                        ),
                    }
                }
            )
    sys.exit(0)


def main() -> None:
    try:
        raw = sys.stdin.read()
    except Exception:  # noqa: BLE001 - unreadable input is refused below as input that is not JSON
        raw = ""
    if os.environ.get(SWITCH_ENV) == "yes":
        _switched_off(raw)
    try:
        _run(raw)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - an exception must block, never let the prompt through
        _refuse(
            [f"the instruction check failed ({type(error).__name__}: {error}). Report it to the Maintainer, with the line hooks.log holds."],
            _session_of(raw),
        )


if __name__ == "__main__":
    main()
