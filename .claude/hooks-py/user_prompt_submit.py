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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import LOG_PATH, PROJECT_ROOT, canon_research_index_path, current_branch  # noqa: E402

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


def file_age_min(path: Path) -> int | None:
    if not path.exists():
        return None
    age_sec = datetime.now().timestamp() - path.stat().st_mtime
    return int(age_sec / 60)


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
    research_index = canon_research_index_path()
    branch = current_branch(PROJECT_ROOT)
    counts = status_counts()
    ab = ahead_behind(branch)
    canon_age = file_age_min(research_index)
    active_plan = find_active_plan(transcript_path)
    files = find_files_in_prompt(prompt)

    lines = [
        f"branch: {branch or '(no branch)'}",
        f"uncommitted: {counts['staged']} staged, {counts['unstaged']} unstaged, {counts['untracked']} untracked",
        f"ahead/behind: {ab}",
    ]
    if canon_age is not None:
        lines.append(f"canon_index_age: {canon_age} min")
    else:
        lines.append(f"canon_index: MISSING {research_index}")
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
