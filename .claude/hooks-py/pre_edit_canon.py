#!/usr/bin/env python3
"""Pre-edit canon orquestador (Batch 5a).

Para cada Edit/Write/MultiEdit, clasifica el archivo por path, busca canon
relevante en `canon-index.json`, e inyecta resumen como `additionalContext`.
Cumple `feedback_check_canon_index_first.md` proactivamente sin frenar el flujo.

Arquitectura 4-stage (sin web search):
  1. CLASSIFY — file_path → path patterns matched
  2. LOOKUP   — canon entries cuyo appliesTo incluye paths que matchean
  3. FALLBACK — miss = log a canon-misses.log + allow sin contexto
  4. INJECT   — formato top-3 entries en additionalContext

Staleness embedded: si canon-index.json synthesizedAt > 30 días, agregar
warning al inicio del contexto.

Este hook NUNCA bloquea: exit 0 siempre. Errores se loguean y allowean.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import make_logger, read_hook_input  # noqa: E402

HOOK_NAME = "pre-edit-canon"
log, _block, _allow = make_logger(HOOK_NAME)

CANON_INDEX_PATH = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon-index.json"
)
MISSES_LOG = Path(".claude/canon-misses.log")
MAX_ENTRIES_INJECTED = 3
STALE_THRESHOLD_DAYS = 30


def emit_no_context() -> None:
    """Exit 0 sin inyectar nada."""
    sys.exit(0)


def emit_context(additional_context: str) -> None:
    """Exit 0 con additionalContext en stdout."""
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": additional_context,
        }
    }
    print(json.dumps(output))
    sys.exit(0)


def load_index() -> dict | None:
    if not CANON_INDEX_PATH.exists():
        log(f"canon-index.json no existe en {CANON_INDEX_PATH}")
        return None
    try:
        with CANON_INDEX_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR leyendo canon-index: {e}")
        return None


def staleness_warning(index: dict) -> str | None:
    """Si la última síntesis es vieja, devolver warning string. Else None."""
    synth_str = index.get("synthesizedAt", "")
    if not synth_str:
        return None
    try:
        synth = datetime.fromisoformat(synth_str)
    except ValueError:
        return None
    if synth.tzinfo is None:
        synth = synth.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - synth).days
    if age_days > STALE_THRESHOLD_DAYS:
        return (
            f"[STALE CANON: index sintetizado hace {age_days} días "
            f"(umbral {STALE_THRESHOLD_DAYS}d). Verificá relevancia antes de aplicar.]"
        )
    return None


def find_matches(file_path: str, index: dict) -> list[dict]:
    """Devuelve canon entries cuyo appliesTo matchea file_path.

    Match = cualquier path en appliesTo es substring de file_path.
    Ranking: longer matched-path = más específico = mayor prioridad.
    """
    matches = []
    for entry in index.get("entries", {}).values():
        applies_to = entry.get("appliesTo", [])
        best_specificity = 0
        for path in applies_to:
            if path and path in file_path:
                if len(path) > best_specificity:
                    best_specificity = len(path)
        if best_specificity > 0:
            matches.append((best_specificity, entry))
    # Sort: more specific first; tie-break by recency (date desc).
    matches.sort(key=lambda t: (-t[0], t[1].get("date", "")), reverse=False)
    matches.sort(key=lambda t: t[0], reverse=True)
    return [entry for _, entry in matches]


def format_entry(entry: dict) -> str:
    """Renderiza un entry como bloque markdown compacto."""
    lines = [f"### {entry['topic']}"]
    confidence = entry.get("confidence", "high")
    area = entry.get("area", "")
    if confidence == "low":
        lines.append(f"_[SUGGESTION, low confidence]_ — {area}")
    else:
        lines.append(f"_[CANON, follow strictly]_ — {area}")
    if entry.get("keyTakeaway"):
        lines.append(f"**Key takeaway**: {entry['keyTakeaway']}")
    if entry.get("patternAdopted"):
        lines.append(f"**Pattern adopted**: {entry['patternAdopted']}")
    sources = entry.get("sources", [])
    if sources:
        urls = ", ".join(s.get("url", "") for s in sources[:2] if s.get("url"))
        if urls:
            lines.append(f"Sources: {urls}")
    return "\n".join(lines)


def format_context(matches: list[dict], file_path: str, stale: str | None) -> str:
    parts = [f"[Canon for {file_path}]"]
    if stale:
        parts.append(stale)
    parts.append("")
    for entry in matches[:MAX_ENTRIES_INJECTED]:
        parts.append(format_entry(entry))
        parts.append("")
    if len(matches) > MAX_ENTRIES_INJECTED:
        parts.append(
            f"({len(matches) - MAX_ENTRIES_INJECTED} más entries relevantes "
            f"en canon-index.json — top {MAX_ENTRIES_INJECTED} mostradas)"
        )
    return "\n".join(parts).strip()


def log_miss(file_path: str, tool_name: str) -> None:
    """Append a miss event to canon-misses.log para review humana."""
    try:
        MISSES_LOG.parent.mkdir(parents=True, exist_ok=True)
        with MISSES_LOG.open("a", encoding="utf-8") as f:
            f.write(
                f"{datetime.now(timezone.utc).isoformat()}\t{tool_name}\t{file_path}\n"
            )
    except OSError as e:
        log(f"WARN: no se pudo escribir canon-misses.log: {e}")


def main() -> None:
    try:
        data = read_hook_input(log)
    except SystemExit:
        emit_no_context()
        return  # unreachable

    tool_name = data.get("tool_name", "")
    file_path = data.get("tool_input", {}).get("file_path", "")

    if tool_name not in ("Edit", "Write", "MultiEdit"):
        emit_no_context()

    if not file_path:
        emit_no_context()

    log(f"inspecting: tool={tool_name}, path={file_path}")

    index = load_index()
    if not index:
        emit_no_context()

    matches = find_matches(file_path, index)
    if not matches:
        log(f"canon MISS: {file_path}")
        log_miss(file_path, tool_name)
        emit_no_context()

    stale = staleness_warning(index)
    log(f"canon HIT: {len(matches)} entries for {file_path} (top {MAX_ENTRIES_INJECTED} injected)")
    emit_context(format_context(matches, file_path, stale))


if __name__ == "__main__":
    main()
