#!/usr/bin/env python3
"""UserPromptSubmit hook — injects repository context and mentioned files.

Goal: Claude should not need to run `git status` or read canon_research_index
at the start of every turn. The most relevant facts (branch, uncommitted
files, canon index status, active plan, @layer of files mentioned in the
prompt) are injected as `additionalContext` and reach the model's reasoning
before its first answer.

This hook never blocks; on error it logs and exits 0 so the user is not
stopped.
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    LOG_PATH,
    PROJECT_ROOT,
    canon_index_path,
    canon_index_staleness,
    canon_research_index_path,
    current_branch,
    parse_synthesized_at,
    read_canon_index,
)

HOOK_NAME = "user-prompt-submit"
# Los planes reales viven en ~/.claude/plans/*.md (los escribe Plan Mode).
# Un plan es "activo" si esta sesión lo tocó: la referencia aparece en el
# transcript como el file_path de un Read/Edit/Write (mismo patrón que el
# guardia de plan mode). Se lee solo la cola del transcript.
PLAN_FILE_REF_RE = re.compile(r'"file_path"\s*:\s*"([^"]*\.claude/plans/[^"]*\.md)"')
TRANSCRIPT_TAIL_BYTES = 5 * 1024 * 1024
GIT_TIMEOUT_SEC = 2
MAX_FILES_FROM_PROMPT = 5

FILE_PATH_RE = re.compile(
    r"[a-zA-Z0-9_\-/.]+\.(?:ts|tsx|js|jsx|py|md|json|yml|yaml|sql|prisma)\b"
)
LAYER_RE = re.compile(r"@layer\s+(\w+)")


def log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat()
    with LOG_PATH.open("a") as f:
        f.write(f"[{timestamp}] [{HOOK_NAME}] {message}\n")


def run(args: list[str], default: str = "") -> str:
    try:
        result = subprocess.run(
            args,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SEC,
            check=True,
        )
        # rstrip, no strip: en `git status --porcelain` el espacio inicial de la
        # PRIMERA línea es la columna X (" M" = sin stagear); strip() lo comía y
        # ese archivo se contaba como staged.
        return result.stdout.rstrip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return default


def status_counts() -> dict[str, int]:
    out = run(["git", "status", "--porcelain"])
    counts = {"staged": 0, "unstaged": 0, "untracked": 0}
    if not out:
        return counts
    for line in out.split("\n"):
        if len(line) < 2:
            continue
        x, y = line[0], line[1]
        if x == "?" and y == "?":
            counts["untracked"] += 1
            continue
        if x == "!" and y == "!":
            continue
        if x not in (" ", "?"):
            counts["staged"] += 1
        if y not in (" ", "?"):
            counts["unstaged"] += 1
    return counts


def ahead_behind(branch: str) -> str:
    out = run(
        ["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"]
    )
    if not out:
        return "n/a"
    parts = out.split()
    if len(parts) == 2:
        return f"{parts[1]}/{parts[0]}"
    return "n/a"


def canon_index_line() -> str:
    """The canon index status as one line, on every prompt.

    `current (<n> entries, synthesized <date>)`, `STALE — <reason>` (the reason
    comes from `canon_index_staleness`, the same one pre_edit_canon uses) or
    `MISSING <path>` for the JSON or its source. One read of the JSON and no
    subprocess: it runs before every answer.
    """
    try:
        index_path, source_path = canon_index_path(), canon_research_index_path()
        for path in (index_path, source_path):
            if not path.exists():
                return f"canon_index: MISSING {path}"
        index, error = read_canon_index(index_path)
        reason = error or canon_index_staleness(index_path, source_path, index=index)
        if reason:
            return f"canon_index: STALE — {reason}"
        synthesized = parse_synthesized_at(index)
        return f"canon_index: current ({len(index['entries'])} entries, synthesized {synthesized.date().isoformat()})"
    except Exception as e:
        # An index with an unexpected shape must not take down the whole context
        # or leave the line blank: the failure is named and the rest goes on.
        log(f"ERROR evaluating canon-index: {e!r}")
        return f"canon_index: STALE — status check failed ({type(e).__name__})"


def find_active_plan(transcript_path: str) -> Path | None:
    """El último plan de ~/.claude/plans que ESTA sesión leyó o editó.

    Se lee del transcript — la misma señal que usa pre_edit_planmode_guard —
    en vez de un mtime con ventana de 24 h: el mtime lo mueve un `touch` o un
    editor que lo preserva, y una ventana fija convertía un plan viejo en
    "activo" o escondía uno recién escrito. Sin transcript, no hay plan.
    """
    if not transcript_path:
        return None
    try:
        path = Path(transcript_path)
        size = path.stat().st_size
        with path.open("rb") as handle:
            handle.seek(max(0, size - TRANSCRIPT_TAIL_BYTES))
            tail = handle.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    refs = PLAN_FILE_REF_RE.findall(tail)
    if not refs:
        return None
    plan = Path(refs[-1])
    # Referenciado y borrado después: no hay plan activo, no uno fantasma.
    return plan if plan.exists() else None


def extract_layer(path: Path) -> str | None:
    try:
        with path.open("r") as f:
            head = f.read(2000)
    except OSError:
        return None
    m = LAYER_RE.search(head)
    if m:
        return m.group(1)
    return None


def find_files_in_prompt(prompt: str) -> list[str]:
    if not prompt:
        return []
    paths_raw = FILE_PATH_RE.findall(prompt)
    out: list[str] = []
    seen: set[str] = set()
    for p in paths_raw:
        if p in seen:
            continue
        seen.add(p)
        # Rutas del prompt relativas a la raíz del repo, no al cwd del proceso.
        path = Path(p) if Path(p).is_absolute() else PROJECT_ROOT / p
        if not path.exists() or path.is_dir():
            continue
        layer = extract_layer(path)
        suffix = f", @layer {layer}" if layer else ""
        out.append(f"- {p} (existing{suffix})")
        if len(out) >= MAX_FILES_FROM_PROMPT:
            break
    return out


def build_context(prompt: str, transcript_path: str) -> str:
    branch = current_branch(PROJECT_ROOT)
    counts = status_counts()
    ab = ahead_behind(branch)
    active_plan = find_active_plan(transcript_path)
    files = find_files_in_prompt(prompt)

    lines = [
        f"branch: {branch or '(no branch)'}",
        f"uncommitted: {counts['staged']} staged, {counts['unstaged']} unstaged, {counts['untracked']} untracked",
        f"ahead/behind: {ab}",
        canon_index_line(),
    ]
    if active_plan:
        lines.append(f"active_plan: {active_plan.name} (read or edited in this session)")
    else:
        lines.append("active_plan: none")
    if files:
        lines.append("")
        lines.append("Files mentioned in prompt:")
        lines.extend(files)
    return "\n".join(lines)


def main() -> None:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log(f"ERROR: JSON inválido: {e}")
        sys.exit(0)

    prompt = data.get("prompt") or data.get("user_prompt") or ""
    log(f"invoked: prompt_chars={len(prompt)}, keys={list(data.keys())}")

    try:
        ctx = build_context(prompt, data.get("transcript_path", ""))
    except Exception as e:
        log(f"ERROR building context: {e}")
        sys.exit(0)

    output = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": ctx,
        }
    }
    print(json.dumps(output))
    log(f"context injected ({len(ctx)} chars)")
    sys.exit(0)


if __name__ == "__main__":
    main()
