# Feedback Memory Canon — Read-Only Mirror

These 5 files are a **read-only mirror** of the feedback memory canon that
auto-loads into every Claude Code session via `@`-imports in `CLAUDE.local.md`.

## Source of truth vs mirror

- **Source of truth (auto-loaded):** `~/.claude/feedback/*.md` on the dev box.
  These ARE what Claude reads at session start. Edits there take effect next session.
- **Mirror (this directory):** read-only copies committed to the repo so they're
  reachable from any session, IDE, or git history view.

Drift between mirror and source IS possible if the source is edited in-place.
Refresh the mirror with:

```bash
cp ~/.claude/feedback/*.md docs/memories/
```

(or wire a pre-commit hook if drift becomes a recurring issue.)

## The 5 canon files

| File                                       | Covers                                                                |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [workflow.md](workflow.md)                 | Planning, asking, branch, commit, execution discipline                |
| [canon-research.md](canon-research.md)     | Canon-first, research, no-suppression, robustness                     |
| [audit-deletion.md](audit-deletion.md)     | Audit method, 3 preguntas before delete, orphan ≠ delete, duplication |
| [runtime-contract.md](runtime-contract.md) | Frontend-backend contract, runtime verification, MSW canon            |
| [tools-infra.md](tools-infra.md)           | pnpm, LXC memory caps, DB migrations, version pinning, specialists    |

## Origin

Consolidated 2026-05-27 (§1.6 of `docs/architecture/NORMALIZATION_ROADMAP.md`)
from 51 individual `feedback_*.md` files. The originals are archived at
`~/.claude/projects/-root-omni-post/memory/feedback_archive/` for audit reference.
