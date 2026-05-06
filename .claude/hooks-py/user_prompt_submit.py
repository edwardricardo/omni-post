#!/usr/bin/env python3
"""UserPromptSubmit hook — inyecta contexto del repo y de archivos mencionados.

Goal: que Claude no tenga que invocar `git status` ni leer canon_research_index
al inicio de cada turno. Lo más relevante (branch, archivos sin commit, edad
del canon, plan activo, layer de archivos mencionados en el prompt) se inyecta
como `additionalContext` y entra al razonamiento del modelo antes de su
primera respuesta.

Este hook no bloquea; en caso de error logguea y exit 0 para no frenar al
usuario.
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


LOG_PATH = Path(".claude/hooks.log")
HOOK_NAME = "user-prompt-submit"
CANON_INDEX_PATH = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon_research_index.md"
)
ACTIVE_PLAN_CANDIDATES = [
    Path(".claude/current-batch-plan.md"),
]
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
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT_SEC,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return default


def current_branch() -> str:
    return run(["git", "rev-parse", "--abbrev-ref", "HEAD"], default="(unknown)")


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


def file_age_min(path: Path) -> int | None:
    if not path.exists():
        return None
    age_sec = datetime.now().timestamp() - path.stat().st_mtime
    return int(age_sec / 60)


def find_active_plan() -> Path | None:
    for c in ACTIVE_PLAN_CANDIDATES:
        if c.exists():
            return c
    return None


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
        path = Path(p)
        if not path.exists() or path.is_dir():
            continue
        layer = extract_layer(path)
        suffix = f", @layer {layer}" if layer else ""
        out.append(f"- {p} (existing{suffix})")
        if len(out) >= MAX_FILES_FROM_PROMPT:
            break
    return out


def build_context(prompt: str) -> str:
    branch = current_branch()
    counts = status_counts()
    ab = ahead_behind(branch)
    canon_age = file_age_min(CANON_INDEX_PATH)
    active_plan = find_active_plan()
    plan_age = file_age_min(active_plan) if active_plan else None
    files = find_files_in_prompt(prompt)

    lines = [
        f"branch: {branch}",
        f"uncommitted: {counts['staged']} staged, {counts['unstaged']} unstaged, {counts['untracked']} untracked",
        f"ahead/behind: {ab}",
    ]
    if canon_age is not None:
        lines.append(f"canon_index_age: {canon_age} min")
    else:
        lines.append("canon_index: not found")
    if active_plan and plan_age is not None:
        lines.append(f"active_plan: {active_plan.name} ({plan_age} min old)")
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
        ctx = build_context(prompt)
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
