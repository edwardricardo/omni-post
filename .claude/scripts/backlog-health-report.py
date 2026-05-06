#!/usr/bin/env python3
"""Backlog health report — Phase 1.2 del meta-plan.

Parsea `docs/audits/POST_REMEDIATION_BACKLOG.md` (entries `### PR-N — title`)
y reporta:

- PRs con targetDecision pasada y sin resolución (alarma).
- PRs BLOCKER/HIGH sin movimiento en últimas 4 semanas (stale).
- PRs needsEdward true (top of mind).
- PRs sin originatedFrom (orphans — falta trazabilidad).
- Conteo agregado por slaCategory + por originatedFrom tier.
- Conteo por estado (FIXED / PENDING / WONT_FIX / DEFERRED / etc.).

Schema reconocido (legacy + canonical):
- "Batch de origen" → originatedFrom
- "Fecha de aplicación" → createdAt
- "Estado" → status (FIXED / PENDING / WONT_FIX / ...)
- "Severidad" → slaCategory (mapeo aproximado)
- "Tipo" → type
- Cuerpo libre puede contener "NEEDS_EDWARD", "blocked by", etc.

Uso:
    python3 .claude/scripts/backlog-health-report.py [--out path]
    python3 .claude/scripts/backlog-health-report.py --raw
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


BACKLOG_MD = Path("docs/audits/POST_REMEDIATION_BACKLOG.md")

PR_HEADING_RE = re.compile(r"^###\s+(?P<id>PR-\d+)\s+—\s+(?P<title>.+?)$", re.MULTILINE)
FIELD_RE = re.compile(r"^\*\*(?P<key>[^*:]+):\*\*\s*(?P<value>.+?)$", re.MULTILINE)

# Legacy + canonical field name aliases (case-insensitive)
FIELD_ALIASES = {
    "originatedFrom": ["batch de origen", "originated from"],
    "createdAt": ["fecha de aplicación", "created", "createdat"],
    "status": ["estado", "status"],
    "severity": ["severidad del bug pre-existente", "severidad", "severity"],
    "type": ["tipo", "type"],
    "targetDecision": ["target decision", "targetdecision", "deadline"],
    "slaCategory": ["sla category", "slacategory", "sla"],
    "needsEdward": ["needs edward", "needsedward"],
}

STATUS_FIXED_KEYWORDS = ["fixed", "closed", "done", "completed", "resolved"]
STATUS_WONT_FIX_KEYWORDS = ["wont_fix", "won't fix", "wontfix", "rechazado", "skipped"]
STATUS_DEFERRED_KEYWORDS = ["deferred", "diferido", "later"]

STALE_DAYS = 28  # 4 semanas


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    # Acepta formatos comunes: 2026-04-22, 2026-04-22 (text), etc.
    m = re.search(r"\d{4}-\d{2}-\d{2}", value)
    if not m:
        return None
    try:
        d = datetime.strptime(m.group(0), "%Y-%m-%d")
        return d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def normalize_field_name(raw_key: str) -> str | None:
    """Mapea un raw key del .md (ej. 'Batch de origen') al canonical."""
    raw_lower = raw_key.lower().strip()
    for canonical, aliases in FIELD_ALIASES.items():
        if raw_lower in aliases:
            return canonical
    return None


def classify_status(status_text: str) -> str:
    s = status_text.lower()
    if any(kw in s for kw in STATUS_FIXED_KEYWORDS):
        return "FIXED"
    if any(kw in s for kw in STATUS_WONT_FIX_KEYWORDS):
        return "WONT_FIX"
    if any(kw in s for kw in STATUS_DEFERRED_KEYWORDS):
        return "DEFERRED"
    return "PENDING"


def map_severity_to_sla(severity: str) -> str:
    """Heurística: severidad libre → categoría SLA discreta."""
    s = severity.lower()
    if any(kw in s for kw in ["crítica", "critical", "blocker", "p0"]):
        return "BLOCKER"
    if any(kw in s for kw in ["alta", "high", "p1", "alto"]):
        return "HIGH"
    if any(kw in s for kw in ["bajo", "low", "p3", "trivial"]):
        return "LOW"
    return "MEDIUM"  # default


def parse_pr_entry(pr_id: str, title: str, body: str) -> dict:
    """Extrae fields canonicalizados de un PR entry."""
    fields_raw: dict[str, str] = {}
    for m in FIELD_RE.finditer(body):
        canonical = normalize_field_name(m.group("key"))
        if canonical:
            fields_raw[canonical] = m.group("value").strip()

    status_text = fields_raw.get("status", "")
    status = classify_status(status_text) if status_text else "PENDING"

    # Detecta NEEDS_EDWARD en cuerpo libre.
    needs_edward = "NEEDS_EDWARD" in body or "needs edward" in body.lower()

    # Detecta bloqueadores en cuerpo libre.
    blocked_by_match = re.search(
        r"(?:blocked by|bloqueado por|blocker)[:\s]+([^\.\n]+)", body, re.IGNORECASE
    )
    blocked_by = blocked_by_match.group(1).strip() if blocked_by_match else ""

    severity = fields_raw.get("severity", "")
    sla = (
        fields_raw.get("slaCategory", "").upper()
        if fields_raw.get("slaCategory")
        else map_severity_to_sla(severity)
    )

    return {
        "id": pr_id,
        "title": title.strip(),
        "originatedFrom": fields_raw.get("originatedFrom", ""),
        "createdAt": fields_raw.get("createdAt", ""),
        "status": status,
        "rawStatus": status_text,
        "severity": severity,
        "slaCategory": sla,
        "type": fields_raw.get("type", ""),
        "targetDecision": fields_raw.get("targetDecision", ""),
        "needsEdward": needs_edward,
        "blockedBy": blocked_by,
    }


def parse_backlog(md_text: str) -> list[dict]:
    matches = list(PR_HEADING_RE.finditer(md_text))
    prs = []
    for i, m in enumerate(matches):
        next_start = matches[i + 1].start() if i + 1 < len(matches) else len(md_text)
        body = md_text[m.end():next_start]
        pr = parse_pr_entry(m.group("id"), m.group("title"), body)
        prs.append(pr)
    return prs


def is_stale(pr: dict, today: datetime) -> bool:
    if pr["status"] == "FIXED" or pr["status"] == "WONT_FIX":
        return False
    created = parse_date(pr["createdAt"])
    if not created:
        return False
    return (today - created).days > STALE_DAYS


def render_markdown(prs: list[dict]) -> str:
    today = datetime.now(timezone.utc)

    open_prs = [p for p in prs if p["status"] not in ("FIXED", "WONT_FIX")]
    fixed_prs = [p for p in prs if p["status"] == "FIXED"]
    wontfix_prs = [p for p in prs if p["status"] == "WONT_FIX"]
    deferred_prs = [p for p in prs if p["status"] == "DEFERRED"]

    needs_edward = [p for p in open_prs if p["needsEdward"]]
    orphans = [p for p in prs if not p["originatedFrom"]]

    blockers = [p for p in open_prs if p["slaCategory"] == "BLOCKER"]
    highs = [p for p in open_prs if p["slaCategory"] == "HIGH"]

    stale = [p for p in open_prs if is_stale(p, today)]

    target_passed = []
    for p in open_prs:
        td = parse_date(p["targetDecision"])
        if td and today > td:
            target_passed.append(p)

    sla_counts: dict[str, int] = {}
    for p in open_prs:
        sla_counts[p["slaCategory"]] = sla_counts.get(p["slaCategory"], 0) + 1

    origin_counts: dict[str, int] = {}
    for p in prs:
        origin = p["originatedFrom"] or "(orphan)"
        # Extract just the tier prefix (T0, T1, ...) if it's a batch ID
        m = re.match(r"(T\d+)", origin)
        key = m.group(1) if m else origin[:30]
        origin_counts[key] = origin_counts.get(key, 0) + 1

    lines: list[str] = []
    lines.append("# Backlog Health Report")
    lines.append(f"_Generado: {today.isoformat()}_")
    lines.append(f"_Source: {BACKLOG_MD}_")
    lines.append("")
    lines.append(
        f"**Total**: {len(prs)} | **Open**: {len(open_prs)} | "
        f"**Fixed**: {len(fixed_prs)} | **Deferred**: {len(deferred_prs)} | "
        f"**WontFix**: {len(wontfix_prs)}"
    )
    lines.append("")

    lines.append("## Distribución SLA (open)")
    lines.append("")
    lines.append("| SLA | Count |")
    lines.append("|-----|-------|")
    for sla in ["BLOCKER", "HIGH", "MEDIUM", "LOW"]:
        lines.append(f"| {sla} | {sla_counts.get(sla, 0)} |")
    lines.append("")

    lines.append("## Origen por tier")
    lines.append("")
    lines.append("| Origen | Count |")
    lines.append("|--------|-------|")
    for origin in sorted(origin_counts.keys()):
        lines.append(f"| {origin} | {origin_counts[origin]} |")
    lines.append("")

    if target_passed:
        lines.append("## ⚠️ Target decision passed (alarm)")
        lines.append("")
        lines.append("| PR | Title | Target | Status |")
        lines.append("|----|-------|--------|--------|")
        for p in target_passed:
            lines.append(
                f"| {p['id']} | {p['title']} | {p['targetDecision']} | {p['rawStatus']} |"
            )
        lines.append("")

    if stale:
        lines.append(f"## 🕐 Stale (open + sin movimiento >{STALE_DAYS}d)")
        lines.append("")
        lines.append("| PR | Title | SLA | Created | Origen |")
        lines.append("|----|-------|-----|---------|--------|")
        for p in stale:
            lines.append(
                f"| {p['id']} | {p['title']} | {p['slaCategory']} | "
                f"{p['createdAt']} | {p['originatedFrom']} |"
            )
        lines.append("")

    if needs_edward:
        lines.append("## 👤 NEEDS_EDWARD (open)")
        lines.append("")
        lines.append("| PR | Title | SLA | Created | Origen |")
        lines.append("|----|-------|-----|---------|--------|")
        for p in needs_edward:
            lines.append(
                f"| {p['id']} | {p['title']} | {p['slaCategory']} | "
                f"{p['createdAt']} | {p['originatedFrom']} |"
            )
        lines.append("")

    if blockers:
        lines.append("## 🚨 BLOCKERS open")
        lines.append("")
        for p in blockers:
            lines.append(f"- **{p['id']}** {p['title']} (origen: {p['originatedFrom']})")
        lines.append("")

    if highs:
        lines.append("## ⬆️ HIGH priority open")
        lines.append("")
        for p in highs[:15]:
            lines.append(f"- **{p['id']}** {p['title']} (origen: {p['originatedFrom']})")
        lines.append("")

    if orphans:
        lines.append("## 🧩 Orphans (sin originatedFrom)")
        lines.append("")
        lines.append(f"_{len(orphans)} entries — falta trazabilidad._")
        lines.append("")
        for p in orphans[:10]:
            lines.append(f"- **{p['id']}** {p['title']}")
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="archivo de salida (default stdout)")
    parser.add_argument("--raw", action="store_true", help="output JSON crudo")
    args = parser.parse_args()

    if not BACKLOG_MD.exists():
        print(f"ERROR: {BACKLOG_MD} no existe", file=sys.stderr)
        sys.exit(1)

    md_text = BACKLOG_MD.read_text(encoding="utf-8")
    prs = parse_backlog(md_text)

    if args.raw:
        output = json.dumps(prs, indent=2, ensure_ascii=False) + "\n"
    else:
        output = render_markdown(prs)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
        print(f"Report escrito a {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
