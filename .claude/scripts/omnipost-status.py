#!/usr/bin/env python3
"""omnipost-status — dashboard consolidado de los 4 reports.

Genera un único markdown legible que combina:
  1. Executive summary (top de la página, 1 vistazo)
  2. Batch status report (completo)
  3. Backlog health report (completo)
  4. Canon staleness report (completo)
  5. Exit-criteria validation summary

Por default escribe a `docs/reports/audits/status-<YYYY-MM-DD>.md` y muestra
el path por stderr. Edward abre el .md en su editor; Claude lee el output
entero para resumir verbalmente cuando se le pida.

Uso:
    python3 .claude/scripts/omnipost-status.py
        → escribe docs/reports/audits/status-2026-05-06.md, imprime path

    python3 .claude/scripts/omnipost-status.py --stdout
        → imprime el dashboard completo a stdout (no archivo)

    python3 .claude/scripts/omnipost-status.py --out path/file.md
        → escribe a path custom
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent
CANON_INDEX = Path(
    "/home/edward/.claude/projects/-home-edward-projects-omni-post/memory/canon-index.json"
)
DEFAULT_OUT_DIR = Path("docs/reports/audits")


def run(args: list[str]) -> str:
    try:
        r = subprocess.run(
            args, capture_output=True, text=True, timeout=60, check=False
        )
        return r.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def repo_state() -> dict:
    branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).strip() or "(unknown)"
    porcelain = run(["git", "status", "--porcelain"])
    staged = unstaged = untracked = 0
    for line in porcelain.split("\n"):
        if len(line) < 2:
            continue
        x, y = line[0], line[1]
        if x == "?" and y == "?":
            untracked += 1
            continue
        if x not in (" ", "?"):
            staged += 1
        if y not in (" ", "?"):
            unstaged += 1
    ab_out = run(
        ["git", "rev-list", "--left-right", "--count", f"origin/{branch}...HEAD"]
    ).strip()
    behind, ahead = "0", "0"
    if ab_out:
        parts = ab_out.split()
        if len(parts) == 2:
            behind, ahead = parts[0], parts[1]
    return {
        "branch": branch,
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
        "ahead": ahead,
        "behind": behind,
    }


def parse_batch_raw() -> list[dict]:
    raw = run(["python3", str(SCRIPTS_DIR / "batch-status-report.py"), "--raw"])
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []


def parse_backlog_raw() -> list[dict]:
    raw = run(["python3", str(SCRIPTS_DIR / "backlog-health-report.py"), "--raw"])
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []


def get_full_report(script_name: str, *extra_args: str) -> str:
    return run(["python3", str(SCRIPTS_DIR / script_name), *extra_args])


def canon_compute_stats() -> dict:
    if not CANON_INDEX.exists():
        return {"error": f"canon-index.json no existe en {CANON_INDEX}"}
    try:
        with CANON_INDEX.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return {"error": f"canon-index inválido: {e}"}

    today = datetime.now(timezone.utc)
    entries = data.get("entries", {})
    stale_synth = stale_verify = undated = 0
    for entry in entries.values():
        date_str = entry.get("date", "")
        verified_str = entry.get("lastVerified", "")
        m = re.search(r"\d{4}-\d{2}-\d{2}", date_str) if date_str else None
        if not m:
            undated += 1
            continue
        try:
            d = datetime.strptime(m.group(0), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if (today - d).days > 90:
                stale_synth += 1
        except ValueError:
            undated += 1
            continue
        m_v = re.search(r"\d{4}-\d{2}-\d{2}", verified_str) if verified_str else None
        if m_v:
            try:
                d_v = datetime.strptime(m_v.group(0), "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                )
                if (today - d_v).days > 180:
                    stale_verify += 1
            except ValueError:
                pass

    synth_at = data.get("synthesizedAt", "")
    age_min = None
    if synth_at:
        try:
            d = datetime.fromisoformat(synth_at)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            age_min = int((today - d).total_seconds() / 60)
        except ValueError:
            pass

    return {
        "total": len(entries),
        "stale_synth": stale_synth,
        "stale_verify": stale_verify,
        "undated": undated,
        "index_age_min": age_min,
    }


def validation_stats(closed_batch_ids: list[str]) -> dict:
    if not closed_batch_ids:
        return {"checked": 0, "passing": 0, "failing": [], "skipped": 0}
    passing = 0
    failing: list[dict] = []
    skipped = 0
    for batch_id in closed_batch_ids:
        try:
            r = subprocess.run(
                ["python3", str(SCRIPTS_DIR / "validate-batch-exit.py"), batch_id],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            skipped += 1
            continue
        out = r.stdout
        level = "?"
        for ln in out.split("\n"):
            if ln.startswith("Level requerido:"):
                level = ln.split(":", 1)[1].strip()
                break
        if r.returncode == 0:
            passing += 1
        else:
            warn = ""
            for ln in out.split("\n"):
                if ln.lstrip().startswith("⚠️"):
                    warn = ln.strip()[:120]
                    break
            failing.append({"id": batch_id, "level": level, "warning": warn})
    return {
        "checked": len(closed_batch_ids),
        "passing": passing,
        "failing": failing,
        "skipped": skipped,
    }


def render_executive(snapshot: dict) -> str:
    """Resumen ejecutivo: 1-page top-of-document view."""
    lines: list[str] = []
    today = datetime.now(timezone.utc)

    lines.append(f"# OmniPost — Dashboard de avance")
    lines.append("")
    lines.append(f"_Generado: {today.strftime('%Y-%m-%d %H:%M UTC')}_")
    lines.append("")

    # Repo
    repo = snapshot["repo"]
    lines.append("## Estado del repo")
    lines.append("")
    lines.append(f"- **Branch**: `{repo['branch']}`")
    lines.append(
        f"- **Working tree**: {repo['staged']} staged, {repo['unstaged']} unstaged, {repo['untracked']} untracked"
    )
    lines.append(f"- **Sync con origin**: {repo['ahead']} ahead / {repo['behind']} behind")
    lines.append("")

    # Métricas globales
    lines.append("## Métricas clave")
    lines.append("")

    bs = snapshot["batch_stats"]
    bl = snapshot["backlog_stats"]
    canon = snapshot["canon_stats"]
    val = snapshot["validation"]

    lines.append("### Roadmap de remediación (REMEDIATION_ROADMAP.md)")
    lines.append("")
    if bs["total"] > 0:
        pct_closed = 100 * bs["closed"] // bs["total"]
        bucket_str = ", ".join(
            f"{k}={v}"
            for k, v in sorted(bs["buckets"].items(), key=lambda x: -x[1])
        )
        lines.append(
            f"- **{bs['closed']}/{bs['total']} batches cerrados** ({pct_closed}%)"
        )
        lines.append(f"- **Distribución por calidad**: {bucket_str}")
        if val["checked"] > 0:
            pct_pass = 100 * val["passing"] // val["checked"]
            lines.append(
                f"- **Validation L#**: {val['passing']}/{val['checked']} cumplen su nivel ({pct_pass}%)"
            )
    else:
        lines.append("- (sin datos — verificar batch-status-report)")
    lines.append("")

    lines.append("### Backlog post-remediación (POST_REMEDIATION_BACKLOG.md)")
    lines.append("")
    if bl["total"] > 0:
        sla_str = ", ".join(
            f"{k}={v}"
            for k, v in sorted(
                bl["sla"].items(),
                key=lambda x: ["BLOCKER", "HIGH", "MEDIUM", "LOW"].index(x[0])
                if x[0] in ["BLOCKER", "HIGH", "MEDIUM", "LOW"]
                else 99,
            )
        )
        lines.append(
            f"- **{bl['open']} entries open** ({bl['fixed']} fixed, {bl['deferred']} deferred, {bl['wontfix']} wontfix)"
        )
        lines.append(f"- **SLA (open)**: {sla_str}")
        lines.append(f"- **NEEDS_EDWARD pendientes**: {len(bl['needs_edward'])}")
        lines.append(
            f"- **Stale BLOCKER/HIGH** (>28d): {sum(1 for p in bl['stale'] if p['slaCategory'] in ('BLOCKER', 'HIGH'))}"
        )
        lines.append(
            f"- **Orphans (sin originatedFrom)**: {bl['orphans_count']} — backlog legacy sin trazabilidad"
        )
    else:
        lines.append("- (sin datos — verificar backlog-health-report)")
    lines.append("")

    lines.append("### Canon de research (canon-index.json)")
    lines.append("")
    if "error" not in canon:
        age = (
            f"{canon['index_age_min']} min"
            if canon["index_age_min"] is not None
            else "?"
        )
        lines.append(
            f"- **{canon['total']} entries** (índice regenerado hace {age})"
        )
        lines.append(
            f"- **Stale por synth >90d**: {canon['stale_synth']} | **stale por verify >180d**: {canon['stale_verify']} | **undated**: {canon['undated']}"
        )
    else:
        lines.append(f"- ERROR: {canon['error']}")
    lines.append("")

    # Top actions
    actions = []
    if bl["target_passed"]:
        actions.append(
            (
                "alta",
                f"⚠️ {len(bl['target_passed'])} entries con `targetDecision` pasada — revisá primero",
            )
        )
    if len(bl["needs_edward"]) >= 5:
        actions.append(
            (
                "media",
                f"👤 {len(bl['needs_edward'])} entries `NEEDS_EDWARD` esperando — agendá 1 por semana",
            )
        )
    if val["checked"] > 0 and val["failing"]:
        fail_pct = 100 * len(val["failing"]) // val["checked"]
        if fail_pct > 30:
            actions.append(
                (
                    "media",
                    f"⚠️ {fail_pct}% de closed batches no cumplen su L# — backfill de tests pendiente",
                )
            )
    if "error" not in canon and canon["stale_synth"] > 10:
        actions.append(
            (
                "baja",
                f"🕐 {canon['stale_synth']} canon entries >90d — refresh trimestral",
            )
        )
    bucket_unknown = bs["buckets"].get("unknown", 0)
    if bs["closed"] > 0 and 100 * bucket_unknown // bs["closed"] > 20:
        actions.append(
            (
                "baja",
                f"🔍 {100 * bucket_unknown // bs['closed']}% batches en bucket=unknown — heurística necesita ajuste",
            )
        )

    if actions:
        lines.append("## 🎯 Acciones recomendadas")
        lines.append("")
        for prio, msg in actions:
            lines.append(f"- **[{prio}]** {msg}")
        lines.append("")

    # Top NEEDS_EDWARD detail (lo más accionable)
    if bl["needs_edward"]:
        lines.append("## 👤 Top NEEDS_EDWARD")
        lines.append("")
        lines.append("| PR | Título | SLA | Origen |")
        lines.append("|----|--------|-----|--------|")
        for p in bl["needs_edward"][:10]:
            origin = (p.get("originatedFrom") or "?").split()[0] if p.get(
                "originatedFrom"
            ) else "?"
            title = p["title"][:80].replace("|", "\\|")
            lines.append(
                f"| {p['id']} | {title} | {p['slaCategory']} | {origin} |"
            )
        lines.append("")

    return "\n".join(lines)


def render_dashboard(snapshot: dict, full_reports: dict) -> str:
    """Documento completo: ejecutivo + 4 reports embebidos."""
    parts: list[str] = []
    parts.append(render_executive(snapshot))
    parts.append("---")
    parts.append("")

    # Section 2: Batch status (full)
    parts.append("# 📊 Reporte 1 de 4 — Batch Status (Roadmap)")
    parts.append("")
    parts.append("> _Source: `.claude/scripts/batch-status-report.py`_")
    parts.append("")
    parts.append(full_reports["batch"])
    parts.append("---")
    parts.append("")

    # Section 3: Backlog health (full)
    parts.append("# 📋 Reporte 2 de 4 — Backlog Health")
    parts.append("")
    parts.append("> _Source: `.claude/scripts/backlog-health-report.py`_")
    parts.append("")
    parts.append(full_reports["backlog"])
    parts.append("---")
    parts.append("")

    # Section 4: Canon staleness (full)
    parts.append("# 📚 Reporte 3 de 4 — Canon Staleness")
    parts.append("")
    parts.append("> _Source: `.claude/scripts/canon-staleness-report.py`_")
    parts.append("")
    parts.append(full_reports["canon"])
    parts.append("---")
    parts.append("")

    # Section 5: Validation L# detail
    parts.append("# ✅ Reporte 4 de 4 — Exit-criteria validation (L1/L2/L3)")
    parts.append("")
    parts.append("> _Source: `.claude/scripts/validate-batch-exit.py` corrido sobre cada closed batch_")
    parts.append("")
    val = snapshot["validation"]
    if val["checked"] == 0:
        parts.append("(sin closed batches a validar)")
    else:
        pct = 100 * val["passing"] // val["checked"]
        parts.append(
            f"**{val['passing']}/{val['checked']} closed batches cumplen su nivel** ({pct}%)"
        )
        if val["skipped"]:
            parts.append(f"Skipped (timeout/error): {val['skipped']}")
        parts.append("")
        if val["failing"]:
            parts.append(f"## ❌ Batches que NO cumplen ({len(val['failing'])})")
            parts.append("")
            parts.append("| Batch | Nivel | Razón |")
            parts.append("|-------|-------|-------|")
            for f in val["failing"]:
                reason = (f["warning"] or "sin warning").replace("|", "\\|")
                parts.append(f"| {f['id']} | {f['level']} | {reason} |")
            parts.append("")
            parts.append(
                "_Nota: muchos warnings son de heurística (validate-batch-exit busca un fenced ```bash``` "
                "block en las notas; algunos batches usan texto plano). Un fail no necesariamente significa "
                "que el batch tenga gap real — revisar manualmente los críticos._"
            )

    return "\n".join(parts).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="archivo de salida custom")
    parser.add_argument("--stdout", action="store_true", help="imprime a stdout (no archivo)")
    parser.add_argument("--json", action="store_true", help="output JSON crudo (sin reports embebidos)")
    args = parser.parse_args()

    # Recolectar datos
    batches = parse_batch_raw()
    closed = [b for b in batches if b.get("is_closed")]
    closed_ids = [b["id"] for b in closed]
    buckets: dict[str, int] = {}
    for b in closed:
        buckets[b.get("bucket", "?")] = buckets.get(b.get("bucket", "?"), 0) + 1

    prs = parse_backlog_raw()
    today = datetime.now(timezone.utc)
    open_prs = [p for p in prs if p["status"] not in ("FIXED", "WONT_FIX")]
    fixed = [p for p in prs if p["status"] == "FIXED"]
    deferred = [p for p in prs if p["status"] == "DEFERRED"]
    wontfix = [p for p in prs if p["status"] == "WONT_FIX"]

    sla_counts: dict[str, int] = {}
    for p in open_prs:
        sla_counts[p["slaCategory"]] = sla_counts.get(p["slaCategory"], 0) + 1
    needs_edward = [p for p in open_prs if p["needsEdward"]]
    orphans = [p for p in prs if not p["originatedFrom"]]

    target_passed = []
    stale = []
    for p in open_prs:
        td = p.get("targetDecision", "")
        if td:
            try:
                d = datetime.fromisoformat(td)
                if d.tzinfo is None:
                    d = d.replace(tzinfo=timezone.utc)
                if today > d:
                    target_passed.append(p)
            except ValueError:
                pass
        ca = p.get("createdAt", "")
        if ca:
            m = re.search(r"\d{4}-\d{2}-\d{2}", ca)
            if m:
                try:
                    d = datetime.strptime(m.group(0), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                    if (today - d).days > 28:
                        stale.append(p)
                except ValueError:
                    pass

    snapshot = {
        "generated_at": today.isoformat(),
        "repo": repo_state(),
        "batch_stats": {
            "total": len(batches),
            "closed": len(closed),
            "open": len(batches) - len(closed),
            "buckets": buckets,
        },
        "backlog_stats": {
            "total": len(prs),
            "open": len(open_prs),
            "fixed": len(fixed),
            "deferred": len(deferred),
            "wontfix": len(wontfix),
            "sla": sla_counts,
            "needs_edward": needs_edward,
            "orphans_count": len(orphans),
            "target_passed": target_passed,
            "stale": stale,
        },
        "canon_stats": canon_compute_stats(),
        "validation": validation_stats(closed_ids),
    }

    if args.json:
        print(json.dumps(snapshot, indent=2, ensure_ascii=False, default=str))
        return

    full_reports = {
        "batch": get_full_report("batch-status-report.py"),
        "backlog": get_full_report("backlog-health-report.py"),
        "canon": get_full_report("canon-staleness-report.py"),
    }

    output = render_dashboard(snapshot, full_reports)

    if args.stdout:
        sys.stdout.write(output)
        return

    out_path = args.out or (
        DEFAULT_OUT_DIR / f"status-{today.strftime('%Y-%m-%d')}.md"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(output, encoding="utf-8")

    # Para que Claude lo vea sin perder el dashboard
    print(f"Dashboard escrito a {out_path}", file=sys.stderr)
    sys.stdout.write(output)


if __name__ == "__main__":
    main()
