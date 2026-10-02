#!/usr/bin/env python3
"""Pre-edit canon orchestrator.

For each Edit/Write/MultiEdit, classifies the file by path, looks up relevant
canon in `canon-index.json`, and injects a summary as `additionalContext`.
Applies `feedback_check_canon_index_first.md` proactively without stopping the flow.

4-stage architecture (no web search):
  1. CLASSIFY — file_path → path patterns matched
  2. LOOKUP   — canon entries whose appliesTo matches + relevance ≥ MIN_RELEVANCE
  3. FALLBACK — miss = log to canon-misses.log + allow without context
  4. INJECT   — top-N entries formatted into additionalContext

Staleness: when the index does not reflect its markdown (source modified after
`synthesizedAt`, date missing or unparseable) or carries dead `appliesTo`
patterns, a warning opens the context. Age alone does not count.

Multi-layer dedup (all reset when a new session starts):
  - per-file: each file_path receives canon ONCE per session (later Edits are silent)
  - per-key:  each canon entry is injected ONCE per session (cross-file)
  - hard cap: MAX_INJECTIONS_PER_SESSION bounds the total noise

Relevance scoring (path):
  ratio = len(longest matched path) / len(file_path).
  Matches with ratio < MIN_RELEVANCE are dropped. Avoids injecting broad-scope
  canon (e.g. apps/api/src/) when more specific canon exists.

Content-keyword filter:
  Each canon entry derives a vocabulary from topic + keyTakeaway +
  patternAdopted (tokenized, lowercased, filtered by STOP_WORDS and
  MIN_TOKEN_LEN). A canon fires only if ≥1 vocabulary token appears in the
  diff (new_string / content / MultiEdit edits). A canon with no derivable
  keywords does NOT fire (conservative — avoids noise without signal).

This hook NEVER blocks: always exit 0. Errors are logged and allowed.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    PROJECT_ROOT,
    canon_index_path,
    canon_index_staleness,
    canon_research_index_path,
    emit_additional_context,
    emit_missing_file_context,
    make_logger,
    read_hook_input,
    recovered_file_notice,
)

HOOK_NAME = "pre-edit-canon"
log, _block, _allow = make_logger(HOOK_NAME)

MISSES_LOG = PROJECT_ROOT / ".claude" / "canon-misses.log"
INJECTED_KEYS_LOG = PROJECT_ROOT / ".claude" / "canon-injected-keys.log"
INJECTED_FILES_LOG = PROJECT_ROOT / ".claude" / "canon-injected-files.log"
BLIND_PREFIX = "canon injection is blind until "
MAX_ENTRIES_INJECTED = 2
MAX_INJECTIONS_PER_SESSION = 50
MIN_RELEVANCE = 0.15
MIN_TOKEN_LEN = 3

_TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_]*")

STOP_WORDS: frozenset[str] = frozenset(
    {
        # Pure grammar / pronouns / quantifiers / aux verbs
        "the", "and", "for", "with", "this", "that", "these", "those",
        "from", "into", "onto", "over", "under", "than", "then", "when",
        "where", "what", "which", "while", "have", "has", "had", "been",
        "being", "are", "was", "were", "will", "would", "should", "could",
        "might", "must", "may", "can", "such", "also", "still", "only",
        "between", "among", "some", "any", "every", "each", "multiple",
        "single", "ever", "never", "across", "without", "within", "via",
        "but", "not", "yet", "out", "off", "all", "few", "new", "old",
        "one", "two", "per", "etc", "use", "set", "get", "fix", "add",
        # Programming language keywords (TS/JS surface) — generic in any code
        "import", "export", "const", "let", "var", "function", "async",
        "await", "return", "throw", "throws", "class", "interface", "type",
        "enum", "extends", "implements", "public", "private", "protected",
        "static", "void", "null", "undefined", "true", "false", "boolean",
        "string", "number", "object", "array", "promise", "record",
        "default", "abstract", "readonly", "override",
        # Catch-all architecture words — too broad to discriminate
        "architecture", "system", "design", "feature", "project",
        "context", "concept", "concepts", "approach", "instance", "instances",
        "definition", "definitions", "reference", "references",
        "documentation", "manual", "section", "version",
        # Generic verbs
        "uses", "used", "using", "applied", "applies", "applying",
        "read", "write", "create", "update", "delete", "make", "made",
        "valid", "invalid", "common", "good", "best", "case", "cases",
        "flow", "flows",
    }
)


def tokenize(text: str) -> set[str]:
    """Lowercase tokens ≥ MIN_TOKEN_LEN, filtered by STOP_WORDS."""
    if not text:
        return set()
    tokens: set[str] = set()
    for raw in _TOKEN_PATTERN.findall(text):
        tok = raw.lower()
        if len(tok) < MIN_TOKEN_LEN:
            continue
        if tok in STOP_WORDS:
            continue
        tokens.add(tok)
    return tokens


_canon_keyword_cache: dict[str, set[str]] = {}


def derive_canon_keywords(entry: dict) -> set[str]:
    """Derives keywords from the canon entry's topic + keyTakeaway + patternAdopted.

    Cached per entry key (for the life of the process) to avoid re-tokenizing.
    """
    key = entry.get("key", "")
    cached = _canon_keyword_cache.get(key)
    if cached is not None:
        return cached
    sources = " ".join(
        [
            entry.get("topic", ""),
            entry.get("keyTakeaway", ""),
            entry.get("patternAdopted", ""),
        ]
    )
    kws = tokenize(sources)
    if key:
        _canon_keyword_cache[key] = kws
    return kws


def extract_diff_tokens(data: dict) -> set[str]:
    """Tokens of the diff (new_string / content / MultiEdit edits)."""
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
    return tokenize("\n".join(chunks))


def emit_no_context(prefix: tuple[str, ...] = ()) -> None:
    """Exit 0 without injecting anything, except `prefix` (e.g. the RECOVERED notice)."""
    emit_additional_context("PreToolUse", "", prefix)


def emit_context(additional_context: str, prefix: tuple[str, ...] = ()) -> None:
    """Exit 0 with additionalContext on stdout (`prefix` first)."""
    emit_additional_context("PreToolUse", additional_context, prefix)


def load_index(session_id: str = "") -> dict:
    """Loads canon-index.json, or reports IN THE CONTEXT and exits (exit 0).

    A missing or unreadable index is reported, never a silent `return None`:
    a hook that "works" without injecting anything leaves its only trace in
    hooks.log, which nobody reads during the turn.
    """
    path = canon_index_path()
    if not path.exists():
        log(f"canon-index.json does not exist at {path} — reported in the context")
        emit_missing_file_context("canon", "canon-index.json", path, BLIND_PREFIX + "it exists", hook_event="PreToolUse", session_id=session_id)
    try:
        with path.open("r", encoding="utf-8") as f:
            index = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log(f"ERROR reading canon-index: {e} — reported in the context")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            BLIND_PREFIX + f"it is readable ({type(e).__name__})",
            hook_event="PreToolUse",
            state="UNREADABLE",
            session_id=session_id,
        )
    if not isinstance(index, dict) or not isinstance(index.get("entries"), dict):
        # Valid JSON without the shape the hook reads (an object with `entries`):
        # a `{}` or a `[]` would be a silently empty index, not a visible blindness.
        found = type(index).__name__ if not isinstance(index, dict) else "object without entries"
        log(f"canon-index.json does not have the expected shape ({found}) — reported in the context")
        emit_missing_file_context(
            "canon",
            "canon-index.json",
            path,
            BLIND_PREFIX + f"it is a JSON object with entries ({found} found)",
            hook_event="PreToolUse",
            state="UNREADABLE",
            session_id=session_id,
        )
    return index


def staleness_warning(index: dict) -> str | None:
    """A warning when the index does not reflect its source or the tree; else None.

    The reason comes from `canon_index_staleness`, the same one the prompt
    hook shows: the two surfaces cannot disagree. Age alone does not warn — a
    threshold in days flagged a current index as old and stayed silent about
    one that drifted yesterday.
    """
    reason = canon_index_staleness(canon_index_path(), canon_research_index_path(), index=index)
    if reason:
        return f"[STALE CANON: {reason}. Verify relevance before applying.]"
    return None


def find_matches(
    file_path: str,
    index: dict,
    diff_tokens: set[str],
    min_relevance: float = MIN_RELEVANCE,
) -> list[dict]:
    """Returns the canon entries that pass the path filter + the content-keyword filter.

    Cascade:
      1. Path: any `appliesTo` that is a substring of file_path with
         ratio = len(longest match) / len(file_path) ≥ min_relevance.
      2. Content: ≥1 token derived from the canon (topic + keyTakeaway +
         patternAdopted, filtered by STOP_WORDS) in `diff_tokens`.

    Canons without derivable keywords do NOT fire (conservative; avoids
    injecting broad canons without signal).

    Ranking: path specificity desc, tie-break by recency (date desc).
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
        canon_kws = derive_canon_keywords(entry)
        if not canon_kws:
            continue
        if canon_kws.isdisjoint(diff_tokens):
            continue
        matches.append((best_specificity, entry.get("date", ""), entry))
    matches.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [entry for _, _, entry in matches]


def format_entry(entry: dict) -> str:
    """Renders an entry as a compact markdown block."""
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
            f"({len(matches) - MAX_ENTRIES_INJECTED} more relevant entries "
            f"in canon-index.json — top {MAX_ENTRIES_INJECTED} shown)"
        )
    return "\n".join(parts).strip()


def log_miss(file_path: str, tool_name: str) -> None:
    """Append a miss event to canon-misses.log for human review."""
    try:
        MISSES_LOG.parent.mkdir(parents=True, exist_ok=True)
        with MISSES_LOG.open("a", encoding="utf-8") as f:
            f.write(
                f"{datetime.now(timezone.utc).isoformat()}\t{tool_name}\t{file_path}\n"
            )
    except OSError as e:
        log(f"WARN: could not write canon-misses.log: {e}")


def load_injected_keys(session_id: str) -> set[str]:
    """Set of canon entry keys already injected in this session_id.

    Reads `.claude/canon-injected-keys.log` (format: session_id\tkey\ttimestamp)
    and returns only the keys that belong to the given session_id.
    Other sessions are ignored.
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
    """Append session_id\\tkey\\ttimestamp for each injected key."""
    if not session_id or not keys:
        return
    try:
        INJECTED_KEYS_LOG.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).isoformat()
        with INJECTED_KEYS_LOG.open("a", encoding="utf-8") as f:
            for k in keys:
                f.write(f"{session_id}\t{k}\t{timestamp}\n")
    except OSError as e:
        log(f"WARN: could not write canon-injected-keys.log: {e}")


def load_injected_files(session_id: str) -> set[str]:
    """Set of the file_paths that already received canon in this session_id."""
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
        log(f"WARN: could not write canon-injected-files.log: {e}")


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

    # Per-file dedup: a file_path that already received canon in this session → silent.
    injected_files = load_injected_files(session_id)
    if file_path in injected_files:
        log(f"file already canonized in session={session_id[:8]} — skip")
        emit_no_context()

    # Hard cap: at most MAX_INJECTIONS_PER_SESSION injections in total per session.
    if len(injected_files) >= MAX_INJECTIONS_PER_SESSION:
        log(
            f"session injection cap reached ({MAX_INJECTIONS_PER_SESSION}) — skip"
        )
        emit_no_context()

    index = load_index(session_id)
    recovered = recovered_file_notice("canon", "canon-index.json", canon_index_path(), session_id)
    prefix = (recovered,) if recovered else ()

    diff_tokens = extract_diff_tokens(data)
    if not diff_tokens:
        log(f"diff has no canon-relevant tokens — skip {file_path}")
        emit_no_context(prefix)

    matches = find_matches(file_path, index, diff_tokens)
    if not matches:
        log(
            f"canon MISS (no matches passed path+content filters, "
            f"diff_tokens={len(diff_tokens)}): {file_path}"
        )
        log_miss(file_path, tool_name)
        emit_no_context(prefix)

    # Per-key dedup: drops the entries already injected in this session.
    injected_already = load_injected_keys(session_id)
    new_matches = [m for m in matches if m.get("key") not in injected_already]

    if not new_matches:
        log(
            f"canon HIT but all {len(matches)} matches already injected in session={session_id[:8]} — skip"
        )
        emit_no_context(prefix)

    stale = staleness_warning(index)
    new_keys = [m["key"] for m in new_matches[:MAX_ENTRIES_INJECTED] if m.get("key")]
    log(
        f"canon HIT: {len(matches)} total, {len(new_matches)} new for {file_path} "
        f"(top {MAX_ENTRIES_INJECTED} injected, recording {len(new_keys)} keys)"
    )
    record_injected(session_id, new_keys)
    record_injected_file(session_id, file_path)
    emit_context(format_context(new_matches, file_path, stale), prefix)


if __name__ == "__main__":
    main()
