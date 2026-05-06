#!/usr/bin/env python3
"""Pre-edit canon orquestador.

Para cada Edit/Write/MultiEdit, clasifica el archivo por path, busca canon
relevante en `canon-index.json`, e inyecta resumen como `additionalContext`.
Cumple `feedback_check_canon_index_first.md` proactivamente sin frenar el flujo.

Arquitectura 4-stage (sin web search):
  1. CLASSIFY — file_path → path patterns matched
  2. LOOKUP   — canon entries cuyo appliesTo matchea + relevance ≥ MIN_RELEVANCE
  3. FALLBACK — miss = log a canon-misses.log + allow sin contexto
  4. INJECT   — formato top-N entries en additionalContext

Staleness: si canon-index.json synthesizedAt > 30 días, warning al inicio
del contexto.

Dedup multi-capa (todas reset al iniciar nueva session):
  - per-file: cada file_path recibe canon UNA vez por session (subsiguientes Edits silent)
  - per-key:  cada canon entry se inyecta UNA vez por session (cross-file)
  - hard cap: MAX_INJECTIONS_PER_SESSION limita el ruido total

Relevance scoring: ratio = len(longest matched path) / len(file_path).
Filter: matches con ratio < MIN_RELEVANCE quedan fuera. Evita inyectar
canon de scope amplio (e.g. apps/api/src/) cuando existe canon más
específico (e.g. apps/api/src/auth/).

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
INJECTED_KEYS_LOG = Path(".claude/canon-injected-keys.log")
INJECTED_FILES_LOG = Path(".claude/canon-injected-files.log")
MAX_ENTRIES_INJECTED = 2
MAX_INJECTIONS_PER_SESSION = 50
MIN_RELEVANCE = 0.15
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


def find_matches(
    file_path: str, index: dict, min_relevance: float = MIN_RELEVANCE
) -> list[dict]:
    """Devuelve canon entries cuyo appliesTo matchea file_path con relevance ≥ threshold.

    Match = cualquier path en appliesTo es substring de file_path.
    Relevance ratio = len(longest matched-path) / len(file_path).
    Ranking: relevance desc, tie-break por recency (date desc).
    """
    file_len = len(file_path)
    matches: list[tuple[int, str, dict]] = []
    for entry in index.get("entries", {}).values():
        applies_to = entry.get("appliesTo", [])
        best_specificity = 0
        for path in applies_to:
            if path and path in file_path and len(path) > best_specificity:
                best_specificity = len(path)
        if best_specificity == 0:
            continue
        relevance = (best_specificity / file_len) if file_len else 0.0
        if relevance < min_relevance:
            continue
        matches.append((best_specificity, entry.get("date", ""), entry))
    matches.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [entry for _, _, entry in matches]


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


def load_injected_keys(session_id: str) -> set[str]:
    """Set de canon entry keys ya inyectadas en esta session_id.

    Lee `.claude/canon-injected-keys.log` (formato: session_id\tkey\ttimestamp)
    y devuelve solo las keys que correspondan a la session_id pasada.
    Otras sesiones quedan ignoradas.
    """
    if not session_id or not INJECTED_KEYS_LOG.exists():
        return set()
    keys: set[str] = set()
    try:
        with INJECTED_KEYS_LOG.open("r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 2 and parts[0] == session_id:
                    keys.add(parts[1])
    except OSError:
        return set()
    return keys


def record_injected(session_id: str, keys: list[str]) -> None:
    """Append session_id\\tkey\\ttimestamp por cada key inyectada."""
    if not session_id or not keys:
        return
    try:
        INJECTED_KEYS_LOG.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).isoformat()
        with INJECTED_KEYS_LOG.open("a", encoding="utf-8") as f:
            for k in keys:
                f.write(f"{session_id}\t{k}\t{timestamp}\n")
    except OSError as e:
        log(f"WARN: no se pudo escribir canon-injected-keys.log: {e}")


def load_injected_files(session_id: str) -> set[str]:
    """Set de file_paths ya canonizados en esta session_id."""
    if not session_id or not INJECTED_FILES_LOG.exists():
        return set()
    files: set[str] = set()
    try:
        with INJECTED_FILES_LOG.open("r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 2 and parts[0] == session_id:
                    files.add(parts[1])
    except OSError:
        return set()
    return files


def record_injected_file(session_id: str, file_path: str) -> None:
    """Append session_id\\tfile_path\\ttimestamp."""
    if not session_id or not file_path:
        return
    try:
        INJECTED_FILES_LOG.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).isoformat()
        with INJECTED_FILES_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{session_id}\t{file_path}\t{timestamp}\n")
    except OSError as e:
        log(f"WARN: no se pudo escribir canon-injected-files.log: {e}")


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

    session_id = data.get("session_id", "")

    # Per-file dedup: file_path ya canonizado en esta session → silent.
    injected_files = load_injected_files(session_id)
    if file_path in injected_files:
        log(f"file already canonized in session={session_id[:8]} — skip")
        emit_no_context()

    # Hard cap: máximo MAX_INJECTIONS_PER_SESSION inyecciones totales por session.
    if len(injected_files) >= MAX_INJECTIONS_PER_SESSION:
        log(
            f"session injection cap reached ({MAX_INJECTIONS_PER_SESSION}) — skip"
        )
        emit_no_context()

    index = load_index()
    if not index:
        emit_no_context()

    matches = find_matches(file_path, index)
    if not matches:
        log(f"canon MISS (no matches ≥ relevance {MIN_RELEVANCE}): {file_path}")
        log_miss(file_path, tool_name)
        emit_no_context()

    # Per-key dedup: filtra entries que ya fueron inyectadas en esta session.
    injected_already = load_injected_keys(session_id)
    new_matches = [m for m in matches if m.get("key") not in injected_already]

    if not new_matches:
        log(
            f"canon HIT but all {len(matches)} matches ya inyectadas en session={session_id[:8]} — skip"
        )
        emit_no_context()

    stale = staleness_warning(index)
    new_keys = [m["key"] for m in new_matches[:MAX_ENTRIES_INJECTED] if m.get("key")]
    log(
        f"canon HIT: {len(matches)} total, {len(new_matches)} new for {file_path} "
        f"(top {MAX_ENTRIES_INJECTED} injected, recording {len(new_keys)} keys)"
    )
    record_injected(session_id, new_keys)
    record_injected_file(session_id, file_path)
    emit_context(format_context(new_matches, file_path, stale))


if __name__ == "__main__":
    main()
