#!/usr/bin/env python3
"""InstructionsLoaded hook — records each instruction file the harness reports
as loaded, so the check at the prompt can compare them with the manifest.

The harness fires `InstructionsLoaded` once per instruction file it loads: at
session start (`session_start`, and `include` for a file another one imports),
on a match of a path-scoped rule (`path_glob_match`), and again for every start
file when a session is resumed. This hook appends one JSON line per event to
`.claude/state/instruction-context/<session_id>.loaded.jsonl`, which git
ignores; a subagent's events carry the parent's session id and its own
`agent_id`, so its loads land in the same record.

The event cannot block, and this hook never fails: a session id that is not a
plain token writes nothing, and a state directory it cannot write is logged.
The check reads a missing line as a missing load, so a recording that fails
can only block a prompt, never let one through. The first line of a session
removes the state files no session has written for 30 days.

The first time it records a `local` file of the manifest as loaded in this
checkout, it writes the checkout's marker under `~/.claude/` (see
`_instruction_context.MARKERS_DIR_NAME`). From then on the check requires every
local file in this checkout, whether or not it still stands, so deleting all of
them cannot silence their requirement. The marker is checked with one stat; the
manifest is read only while no marker stands.

RETIRED WHEN: the check it feeds retires (see `user_prompt_instruction_check.py`).
"""

import json
import os
import sys
import time
from pathlib import Path

HOOK_NAME = "instructions-loaded"
HOOK_DIR = Path(__file__).resolve().parent
FIELDS = ("file_path", "memory_type", "load_reason", "parent_file_path", "trigger_file_path", "agent_id", "agent_type")


def mark_local(ic, data: dict, markers: Path | None = None) -> bool:
    """Writes the checkout's marker when `data` reports a local file of the
    manifest as loaded and no marker stands yet; True when it wrote it."""
    file_path = data.get("file_path")
    if not isinstance(file_path, str) or os.path.lexists(ic.marker_path(ic.PROJECT_ROOT, markers)):
        return False
    relative = ic.relative_to_root(ic.PROJECT_ROOT, os.path.realpath(file_path))
    if relative is None:
        return False
    try:
        manifest = ic.load_manifest(ic.PROJECT_ROOT)
    except ic.ManifestError:
        return False
    return relative in manifest.local and ic.mark_local_files_seen(ic.PROJECT_ROOT, markers)


def main() -> None:
    sys.path.insert(0, str(HOOK_DIR))
    try:
        import _instruction_context as ic
    except Exception as error:  # noqa: BLE001 - the event cannot block; the check reads the gap
        print(f"[{HOOK_NAME}] the shared module did not import ({type(error).__name__}: {error})", file=sys.stderr)
        sys.exit(0)
    try:
        data = json.loads(sys.stdin.read())
        if not isinstance(data, dict):
            raise ValueError("the hook input is not a JSON object")
        path = ic.state_file(ic.PROJECT_ROOT, data.get("session_id"), ic.LOADED)
        entry = {key: data[key] for key in FIELDS if isinstance(data.get(key), str)}
        entry["t"] = time.time()
        if ic.append_entry(path, entry):
            ic.prune_state(ic.PROJECT_ROOT, time.time())
        if mark_local(ic, data):
            ic.log(HOOK_NAME, f"marked {ic.PROJECT_ROOT} as a checkout that holds its local files: {ic.marker_path(ic.PROJECT_ROOT)}")
    except ValueError as error:
        ic.log(HOOK_NAME, f"nothing recorded: {error}")
    except OSError as error:
        ic.log(HOOK_NAME, f"could not record the load: {error}")
    except Exception as error:  # noqa: BLE001 - the event cannot block; the check reads the gap
        ic.log(HOOK_NAME, f"could not record the load ({type(error).__name__}: {error})")
    sys.exit(0)


if __name__ == "__main__":
    main()
