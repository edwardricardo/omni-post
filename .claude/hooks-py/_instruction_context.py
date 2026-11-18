"""Helpers shared by the three hooks that enforce the instruction context.

ADR-0045 decides that a session which lacks a required instruction file is
blocked, and that an edit of a file a moved record governs waits until the
session has opened that record. Three hooks carry it out:

  instructions_loaded.py           InstructionsLoaded: records each instruction
                                   file the harness reports as loaded.
  user_prompt_instruction_check.py UserPromptSubmit: blocks the prompt of a
                                   session whose record lacks a required file.
  pre_tool_record_guard.py         PreToolUse, run twice: `record` notes each
                                   Read or Grep that opens a record; `judge`
                                   refuses a write of a governed file until the
                                   session, or the agent writing, opened its
                                   record.

This module holds what they share: the manifest, the per-session state files,
the marker of a checkout whose local files were seen loaded, and the one read
that decides whether a file stands on disk. It imports the standard library
only, and `_common` lazily for the log line. The recorder never imports
`_common` unless it logs. The guard's `record` mode runs only on Read and Grep,
and returns before importing this module or `_common` on a Read of a file that
is not Markdown; on a Read of a Markdown file or a Grep it imports both and
reads the call. The `judge` mode imports both on every Edit, Write, MultiEdit
and Bash call. Measured costs, a median of ten runs, are in the guard's
section of ADR-0045.

Every read of a path opens it once and asks the open descriptor what it is, so
the answer cannot belong to a different file than the one read; a named pipe
is opened without waiting for a writer.
"""

import fcntl
import hashlib
import json
import os
import re
import stat
import time
from dataclasses import dataclass
from pathlib import Path

# The repository the hooks belong to: .claude/hooks-py/<this file> -> root,
# never the process cwd (the reason is the one `_common.PROJECT_ROOT` states).
PROJECT_ROOT = Path(__file__).resolve().parents[2]

MANIFEST = ".claude/instruction-manifest.json"
STATE_DIR = Path(".claude") / "state" / "instruction-context"
LOADED = "loaded"
READS = "reads"

# The Maintainer's switch: in the environment the hooks run with, it turns the
# session check and the record guard off. Hooks inherit the harness's
# environment, and an `env` block in any settings source reaches them as well
# (measured with a `--settings` file). The pre-edit and pre-bash gates guard
# every file whose path holds `/.claude/settings.json` or
# `/.claude/settings.local.json`: the project's, the local and the user's
# settings. They do not guard the managed settings
# (`/etc/claude-code/managed-settings.json`), a `--settings` file or argument, a
# user settings directory moved by `CLAUDE_CONFIG_DIR`, or the environment of the
# terminal that starts the harness. So the switch can be set without the
# Maintainer; what keeps it from staying on unseen, whoever sets it, is the
# warning the check shows at every prompt and the line it writes to hooks.log.
SWITCH_ENV = "MAINTAINER_DISABLE_INSTRUCTION_CHECK"

# The marker of a checkout whose local files the recorder once saw loaded: one
# file per checkout, named by the sha256 of the checkout's real path, in a
# directory of its own under the user's `~/.claude/`. It lives outside the
# checkout so that deleting every local file, as `git clean -fdX` does, cannot
# silence their requirement. The harness names its own entries there after its
# features (settings.json, projects, plans, debug, ...); none is this name, and
# a file inside it is a 64-digit hexadecimal name.
# Residual limits, stated: a checkout that moves to another real path starts
# with no marker, so the requirement of its local files restarts at its next
# load of one; and a session can remove the marker with a Bash command, which
# no hook refuses. Removing it takes a deliberate act on a file outside the
# checkout, the same class as a line forged into a reads file.
MARKERS_DIR_NAME = "instruction-context-markers"

# A session id names a state file, so it is held to a shape no path can escape.
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

# State files of sessions nobody resumed for this long are removed.
STATE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

MISSING = "is missing"
_READ_CHUNK = 64 * 1024


class ManifestError(Exception):
    """The manifest cannot be read, or does not have the shape the hooks read."""


class ManifestMissing(ManifestError):
    """The root holds no manifest: it is not a checkout of this project."""


class NotARegularFile(OSError):
    """A path names a directory, a pipe or a device, not a file."""


@dataclass(frozen=True)
class RecordEntry:
    """A moved record: the rule that governs files with it, and the document."""

    rule: str
    document: str


@dataclass(frozen=True)
class Manifest:
    """The parts of `.claude/instruction-manifest.json` the hooks read."""

    tracked: tuple[str, ...]
    local: tuple[str, ...]
    records: tuple[RecordEntry, ...]


def log(tag: str, message: str) -> None:
    """One hooks.log line through `_common`'s logger, the single writer of
    its format. A failure to write it never changes what a hook decides."""
    try:
        from _common import make_logger

        make_logger(tag)[0](message)
    except (ImportError, OSError):
        pass


def read_regular_file(path: Path) -> bytes:
    """The bytes of `path`, opened once. Raises FileNotFoundError when nothing
    stands there, NotARegularFile for anything but a file, and OSError when it
    cannot be read."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise NotARegularFile(f"{path} is not a regular file")
        chunks: list[bytes] = []
        while chunk := os.read(descriptor, _READ_CHUNK):
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def probe(path: Path) -> str | None:
    """None when `path` is a regular file holding at least one readable byte;
    otherwise what is wrong with it, as the end of a sentence about the file."""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except (FileNotFoundError, NotADirectoryError):
        return MISSING
    except OSError as error:
        return f"could not be opened ({error.strerror or error})"
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            return "is not a regular file"
        if not os.read(descriptor, 1):
            return "is empty"
        return None
    except OSError as error:
        return f"could not be read ({error.strerror or error})"
    finally:
        os.close(descriptor)


def is_relative_path(value: object) -> bool:
    """A repository-relative path, as the instruction-context gate reads one:
    a non-empty string with no leading slash, no backslash and no empty, `.`
    or `..` segment."""
    return (
        isinstance(value, str)
        and value != ""
        and not value.startswith("/")
        and "\\" not in value
        and all(segment not in ("", ".", "..") for segment in value.split("/"))
    )


def load_manifest(root: Path) -> Manifest:
    """The manifest of the checkout at `root`. Raises ManifestMissing when the
    root holds none, and ManifestError when it cannot be read or is not the
    shape below; the gate holds every other field, so only these are read."""
    path = root / MANIFEST
    try:
        text = read_regular_file(path).decode("utf-8")
    except FileNotFoundError as error:
        raise ManifestMissing(f"{MANIFEST} does not exist in {root}") from error
    except (OSError, UnicodeDecodeError) as error:
        raise ManifestError(f"{MANIFEST} could not be read: {error}") from error
    try:
        data = json.loads(text)
    except ValueError as error:
        raise ManifestError(f"{MANIFEST} is not JSON: {error}") from error
    if not isinstance(data, dict):
        raise ManifestError(f"{MANIFEST} does not hold one JSON object")
    tracked, local, records = data.get("tracked"), data.get("local"), data.get("records")
    if not (isinstance(tracked, list) and tracked and all(map(is_relative_path, tracked))):
        raise ManifestError(f"{MANIFEST}: tracked must be a non-empty list of repository-relative paths")
    if not (isinstance(local, list) and all(map(is_relative_path, local))):
        raise ManifestError(f"{MANIFEST}: local must be a list of repository-relative paths")
    if not isinstance(records, list):
        raise ManifestError(f"{MANIFEST}: records must be a list")
    entries: list[RecordEntry] = []
    for index, record in enumerate(records):
        if not (
            isinstance(record, dict)
            and is_relative_path(record.get("rule"))
            and is_relative_path(record.get("document"))
        ):
            raise ManifestError(f"{MANIFEST}: records[{index}] must name a rule and a document")
        entries.append(RecordEntry(record["rule"], record["document"]))
    return Manifest(tuple(tracked), tuple(local), tuple(entries))


def is_main_checkout(root: Path) -> bool:
    """A main checkout holds its `.git` directory; a linked worktree holds a
    `.git` file, and an exported tree none. Only a main checkout can hold the
    local files, which git ignores and no worktree receives."""
    return (root / ".git").is_dir()


def markers_dir() -> Path:
    """The directory of the markers: `~/.claude/<MARKERS_DIR_NAME>`."""
    return Path(os.path.expanduser("~")) / ".claude" / MARKERS_DIR_NAME


def marker_path(root: Path, markers: Path | None = None) -> Path:
    """The marker of the checkout at `root`, keyed by its real path."""
    real = os.path.realpath(root)
    return (markers or markers_dir()) / hashlib.sha256(real.encode("utf-8")).hexdigest()


def local_files_seen(root: Path, markers: Path | None = None) -> bool:
    """Whether the marker of `root` stands. Raises OSError when its directory
    cannot be read, or NotARegularFile when the marker is not a file: the
    caller then cannot tell, and refuses rather than guess."""
    path = marker_path(root, markers)
    try:
        mode = os.stat(path, follow_symlinks=False).st_mode
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(mode):
        raise NotARegularFile(f"{path} is not a regular file")
    return True


def mark_local_files_seen(root: Path, markers: Path | None = None) -> bool:
    """Writes the marker of `root` once, never through a symbolic link; True
    when this call wrote it, False when it already stood."""
    path = marker_path(root, markers)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        return False
    try:
        os.write(descriptor, (json.dumps({"checkout": os.path.realpath(root), "t": time.time()}) + "\n").encode("utf-8"))
    finally:
        os.close(descriptor)
    return True


def required_files(root: Path, manifest: Manifest, local_seen: bool) -> list[str]:
    """The files a session in `root` must have loaded: every tracked entry,
    and every local entry when the checkout's marker stands (`local_seen`) or
    when it is a main checkout that holds any local entry.

    A clone the local files were never copied to holds none of them and has
    no marker, so its sessions are not blocked for lacking them. The checkout
    they were loaded in carries the marker, so deleting every one of them
    there is a lack, not a choice; a checkout meant to have none drops its
    marker by hand."""
    required = list(manifest.tracked)
    holds_one = is_main_checkout(root) and any(probe(root / name) != MISSING for name in manifest.local)
    if local_seen or holds_one:
        required.extend(manifest.local)
    return required


def state_file(root: Path, session_id: object, kind: str) -> Path:
    """The state file of one session: `.claude/state/instruction-context/
    <session_id>.<kind>.jsonl` under `root`. Raises ValueError for a session
    id that is not a plain token."""
    if not isinstance(session_id, str) or not SESSION_ID_RE.match(session_id):
        raise ValueError(f"the hook input carries no usable session id ({session_id!r})")
    return root / STATE_DIR / f"{session_id}.{kind}.jsonl"


def append_entry(path: Path, entry: dict) -> bool:
    """Appends `entry` as one JSON line under an exclusive lock, creating the
    file and its directory; True when it is the file's first line. The file is
    never written through a symbolic link."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = (json.dumps(entry, sort_keys=True) + "\n").encode("utf-8")
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        first = os.fstat(descriptor).st_size == 0
        os.write(descriptor, line)
    finally:
        os.close(descriptor)
    return first


def read_entries(path: Path) -> list[dict] | None:
    """The JSON objects of a state file, one per line; None when the file does
    not exist. A line that is not a JSON object is skipped: it cannot vouch for
    a load or a read, so skipping it can only block, never pass. Raises OSError
    when the file cannot be read."""
    try:
        raw = read_regular_file(path)
    except FileNotFoundError:
        return None
    entries: list[dict] = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            entries.append(value)
    return entries


def prune_state(root: Path, now: float, max_age: float = STATE_MAX_AGE_SECONDS) -> int:
    """Removes the state files under `root` not written for `max_age` seconds;
    returns how many. A file another process removes first is skipped.

    The age is read from one stat and the removal names the path again, so a
    file written between the two is removed with its new line. That costs only
    a session idle for the whole age: its record goes, and the block message's
    repair, resuming the session once, writes it again."""
    try:
        entries = list(os.scandir(root / STATE_DIR))
    except FileNotFoundError:
        return 0
    removed = 0
    for entry in entries:
        if not entry.name.endswith(".jsonl"):
            continue
        try:
            if now - entry.stat(follow_symlinks=False).st_mtime <= max_age:
                continue
            os.unlink(entry.path)
        except FileNotFoundError:
            continue
        removed += 1
    return removed


def relative_to_root(root: Path, path: str) -> str | None:
    """`path` relative to `root`, with `/` separators; None when it lies
    outside the root."""
    relative = os.path.relpath(path, root)
    if relative == "." or relative.startswith(".." + os.sep) or relative == "..":
        return None
    return relative.replace(os.sep, "/")
