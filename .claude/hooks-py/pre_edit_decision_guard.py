#!/usr/bin/env python3
"""Pre-edit decision-guard hook.

Detecta patrones de decisión técnica de alto riesgo en el diff y avisa cuando
no hay canon que los cubra. Hoy: ADVISORY ONLY — emite warning vía
additionalContext, nunca bloquea (Phase 1 calibration).

Patrones cubiertos (starter set):
  - argon2-params       — Argon2 hash/verify parameter choice (RFC 9106)
  - jwt-algorithm       — JWT signing algorithm
  - oauth-scopes        — OAuth scope declaration
  - cors-config         — CORS configuration
  - session-cookie      — Session/cookie security flags (httpOnly/secure/sameSite)
  - csp-header          — Content Security Policy
  - rate-limit          — Rate limiting config

Para cada match, busca en `canon-index.json`:
  1. Strict: entries cuyo `decisionGuards: [...]` contiene el pattern_id.
  2. Fallback: keyword-match contra topic/area/summary/keyTakeaway/key.

Si ninguno cubre → emit advisory warning + log a `canon-decision-gaps.log`
para calibración antes de subir a hard-gate (exit 2) en una iteración futura.

Bypass case-by-case: env var `EDWARD_AUTHORIZED_HEURISTIC=yes` silencia el
warning para esta invocación (registrado en log para auditoría).

Este hook NUNCA bloquea: exit 0 siempre.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    PROJECT_ROOT,
    canon_index_path,
    emit_missing_file_context,
    make_logger,
    read_hook_input,
)

HOOK_NAME = "pre-edit-decision-guard"
log, _block, _allow = make_logger(HOOK_NAME)

DECISION_GAPS_LOG = PROJECT_ROOT / ".claude" / "canon-decision-gaps.log"
HEURISTIC_OVERRIDES_LOG = PROJECT_ROOT / ".claude" / "heuristic-overrides.log"

DECISION_PATTERNS: list[dict] = [
    {
        "id": "argon2-params",
        "regex": re.compile(r"argon2\.(?:hash|verify)\s*\("),
        "description": "Argon2 hash/verify parameter choice (RFC 9106 second recommendation)",
        "canon_keywords": ["argon2", "rfc 9106", "rfc-9106", "password hashing"],
    },
    {
        "id": "jwt-algorithm",
        "regex": re.compile(r"\b(?:jsonwebtoken|jwt\.(?:sign|verify)|JsonWebToken)\b"),
        "description": "JWT signing algorithm choice (RFC 8725 BCP)",
        "canon_keywords": ["jwt", "rfc 8725", "rfc-8725", "jose", "jws"],
    },
    {
        "id": "oauth-scopes",
        "regex": re.compile(
            r"scope[s]?\s*[:=]\s*['\"][^'\"]*\b(?:read|write|manage|admin|publish)"
        ),
        "description": "OAuth scope declaration (least-privilege per provider docs)",
        "canon_keywords": ["oauth", "scope"],
    },
    {
        "id": "cors-config",
        "regex": re.compile(r"@fastify/cors|\bcors\s*\(\s*\{|origin\s*:\s*['\"]"),
        "description": "CORS configuration (origin whitelist, credentials)",
        "canon_keywords": ["cors"],
    },
    {
        "id": "session-cookie",
        "regex": re.compile(r"\b(?:httpOnly|sameSite|secure)\s*:\s*"),
        "description": "Session/cookie security flag",
        "canon_keywords": ["cookie", "session", "samesite", "owasp a07", "owasp-a07"],
    },
    {
        "id": "csp-header",
        "regex": re.compile(r"Content-Security-Policy|contentSecurityPolicy"),
        "description": "Content Security Policy",
        "canon_keywords": ["csp", "content security policy", "content-security-policy"],
    },
    {
        "id": "rate-limit",
        "regex": re.compile(r"@fastify/rate-limit|\brateLimit\s*\("),
        "description": "Rate limiting configuration",
        "canon_keywords": ["rate limit", "rate-limit", "ddos"],
    },
]


def emit_no_warning() -> None:
    sys.exit(0)


def emit_warning(content: str) -> None:
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": content,
        }
    }
    print(json.dumps(output))
    sys.exit(0)


def load_index(pattern_ids_text: str, session_id: str = "") -> dict:
    """Carga canon-index.json o avisa EN EL CONTEXTO y sale (exit 0).

    Sin índice no hay forma de saber si una decisión está cubierta, así que
    NO se emite un DECISION GAP: con el índice ausente, cada detección se
    volvía un gap falso (75 avisos, todos falsos, mientras la ruta apuntaba a
    /home/edward/...). Se reporta la ceguera, no un hallazgo inventado — una
    vez por sesión; lo que seguía (gaps y overrides) comparaba contra nada.
    """
    path = canon_index_path()
    consequence = f"decision-gap check for {pattern_ids_text} is blind until it exists"
    if not path.exists():
        log(f"canon-index.json no existe en {path} — sin DECISION GAP, avisado en el contexto")
        emit_missing_file_context("canon", "canon-index.json", path, consequence, session_id=session_id)
    try:
        with path.open("r", encoding="utf-8") as f:
            index = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR leyendo canon-index: {e} — sin DECISION GAP, avisado en el contexto")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            f"decision-gap check for {pattern_ids_text} is blind until it is readable ({type(e).__name__})",
            state="UNREADABLE",
            session_id=session_id,
        )
    if not isinstance(index, dict) or not isinstance(index.get("entries"), dict):
        # JSON válido pero sin la forma que se lee (un objeto con `entries`): un
        # `{}` o un `[]` compararían contra nada y callarían el gap sin avisar.
        found = type(index).__name__ if not isinstance(index, dict) else "object without entries"
        log(f"canon-index.json no tiene la forma esperada ({found}) — sin DECISION GAP, avisado en el contexto")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            f"decision-gap check for {pattern_ids_text} is blind until it is a JSON object with entries ({found} found)",
            state="UNREADABLE",
            session_id=session_id,
        )
    return index


def extract_diff_text(data: dict) -> str:
    """Extrae texto a verificar de tool_input según tool_name."""
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    chunks: list[str] = []
    if tool_name == "Edit":
        chunks.append(tool_input.get("new_string", ""))
    elif tool_name == "Write":
        chunks.append(tool_input.get("content", ""))
    elif tool_name == "MultiEdit":
        for edit in tool_input.get("edits", []):
            chunks.append(edit.get("new_string", ""))
    return "\n".join(chunks)


def canon_covers_pattern(index: dict, pattern: dict) -> bool:
    """True si algún canon entry cubre este pattern (strict o keyword fallback)."""
    pattern_id = pattern["id"]
    keywords = [kw.lower() for kw in pattern.get("canon_keywords", [])]
    for entry in index.get("entries", {}).values():
        guards = entry.get("decisionGuards", [])
        if pattern_id in guards:
            return True
        haystack = " ".join(
            [
                entry.get("topic", ""),
                entry.get("area", ""),
                entry.get("summary", ""),
                entry.get("keyTakeaway", ""),
                entry.get("key", ""),
            ]
        ).lower()
        for kw in keywords:
            if kw and kw in haystack:
                return True
    return False


def log_event(path: Path, file_path: str, pattern_id: str, suffix: str = "") -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with path.open("a", encoding="utf-8") as f:
            f.write(f"{ts}\t{file_path}\t{pattern_id}\t{suffix}\n")
    except OSError as e:
        log(f"WARN: no se pudo escribir {path}: {e}")


def main() -> None:
    try:
        data = read_hook_input(log)
    except SystemExit:
        emit_no_warning()
        return

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        emit_no_warning()

    file_path = data.get("tool_input", {}).get("file_path", "")
    diff_text = extract_diff_text(data)
    if not diff_text:
        emit_no_warning()

    matched: list[dict] = []
    for pattern in DECISION_PATTERNS:
        if pattern["regex"].search(diff_text):
            matched.append(pattern)

    if not matched:
        emit_no_warning()

    log(f"detected {len(matched)} decision patterns in {file_path}")

    index = load_index(", ".join(p["id"] for p in matched), data.get("session_id", ""))
    gaps: list[dict] = []
    for pattern in matched:
        if canon_covers_pattern(index, pattern):
            continue
        gaps.append(pattern)
        log_event(DECISION_GAPS_LOG, file_path, pattern["id"])

    if not gaps:
        log("all decision patterns covered by canon — silent")
        emit_no_warning()

    if os.environ.get("EDWARD_AUTHORIZED_HEURISTIC") == "yes":
        for p in gaps:
            log_event(HEURISTIC_OVERRIDES_LOG, file_path, p["id"], "EDWARD_AUTHORIZED_HEURISTIC")
        log(
            f"{len(gaps)} gaps overridden by EDWARD_AUTHORIZED_HEURISTIC for {file_path}"
        )
        emit_no_warning()

    lines = [f"[DECISION GAP — {file_path}]", ""]
    lines.append(
        "Las siguientes decisiones técnicas en el diff NO tienen canon entry que las cubra:"
    )
    lines.append("")
    for p in gaps:
        lines.append(f"  - **{p['id']}** — {p['description']}")
    lines.append("")
    lines.append(
        "**Advisory** (no bloqueante). Antes de aplicar el cambio, considerá pedirle a Edward:"
    )
    lines.append("  (a) iniciar canon research para esta decisión, o")
    lines.append(
        "  (b) confirmar que ya autorizó la heurística (set `EDWARD_AUTHORIZED_HEURISTIC=yes` en la session)."
    )
    lines.append("")
    lines.append(
        "Logged a `.claude/canon-decision-gaps.log` para calibrar antes de subir a hard-gate."
    )

    emit_warning("\n".join(lines))


if __name__ == "__main__":
    main()
