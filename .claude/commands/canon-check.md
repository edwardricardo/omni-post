---
description: Force canon-check citation before architectural/workaround decision. Read all canon docs + feedback files, identify applicable rules, output verdict.
---

# canon-check

You invoked `/canon-check` because you are about to make a decision that may violate canon. Per the **Mandatory Pre-Action Triggers** section of `CLAUDE.md`, certain Edit/Write operations are auto-blocked unless your assistant message contains a valid `canon-check:` line.

## Mandatory protocol

1. **Re-read the relevant canon for the decision at hand.** Pick from:
   - `docs/architecture/ARCHITECTURE_CANON.md` — hexagonal, DDD, CQRS, UoW, Saga, DI
   - `docs/development/CODING_STANDARDS.md` — TypeScript, naming, JSDoc, testing
   - `docs/security/SECURITY_CANON.md` — secrets, env, multi-tenant guards
   - `docs/observability/LOGGING_CANON.md` — logging, redaction, caching, tasks
   - `~/.claude/feedback/workflow.md` — commits, push, branching, asking
   - `~/.claude/feedback/canon-research.md` — research first, no patches, no time-bombs
   - `~/.claude/feedback/audit-deletion.md` — 3 questions, orphan ≠ delete, pattern not instance
   - `~/.claude/feedback/runtime-contract.md` — frontend-backend coupling, MSW canon, smoke tests
   - `~/.claude/feedback/tools-infra.md` — pnpm, LXC, DB migrations, version pinning

2. **For each applicable rule, write:**

   ```
   - <canon-file> §<rule>: ✅ AUTHORIZES — <reason>   OR
   - <canon-file> §<rule>: ❌ FORBIDS — <reason>
   ```

3. **Emit verdict:**
   - If ALL rules ✅ → emit the `canon-check:` line per the format below.
   - If ANY rule ❌ → emit `REJECTED: <reason>` and do NOT proceed with the Edit/Write. Propose canon-aligned alternative.

## Canon-check line format (for the assistant message)

After verdict ✅:

```
canon-check: <canon-file> §<rule-id> — <decision> authorized because <canonical reason>
```

The pre-edit tripwire blocker hook searches the prior assistant message for a line that starts with `canon-check:` and then carries a `.md` path, a `§` rule id, a dash (`—` or `-`) and text after it (`CANON_CHECK_RE` in `.claude/hooks-py/pre_edit_tripwire_blocker.py`). If absent or malformed, the next Edit/Write is blocked.

## Examples

### Example 1 — workaround proposal (rejected)

```
DECISION: "use absolute path @core/security/X from inside packages/core/application/src/ai/"

RULE CHECK:
- feedback/canon-research.md §no-time-bombs: ❌ FORBIDS — workaround without real prevention;
  the cross-package import will resolve but leaves invisible debt.
- ARCHITECTURE_CANON.md §Hexagonal: ❌ FORBIDS — a cross-context import without a port violates
  "dependency direction is always inward".

REJECTED: resolve via SecurityClassifierPort (it already exists in @ports/core).
```

### Example 2 — pattern choice (authorized)

```
DECISION: "extract embeddings to packages/core/embeddings/ as shared kernel"

RULE CHECK:
- ARCHITECTURE_CANON.md §DDD Aggregates: ✅ AUTHORIZES — a shared kernel is a canonical pattern
  (Evans, "Domain-Driven Design" §14.2) when ≥2 contexts depend on the same model.
- feedback/canon-research.md §research-first: ✅ AUTHORIZES — I verified that embeddings has
  3 consumers (ai, glossary, style-guide) and all of them consume the same embedSingle method.

canon-check: ARCHITECTURE_CANON.md §DDD-Aggregates — embeddings shared kernel authorized
because 3 contexts (ai/glossary/style-guide) consume it with the same model, meeting
the shared-kernel criterion (Evans §14.2).
```

### Example 3 — hotfix override

```
DECISION: "add // canon-exception: hotfix:INC-1234 in apps/api/src/billing/X.ts"

RULE CHECK:
- CLAUDE.md §Pragmatic-Exceptions hotfix: ✅ AUTHORIZES — P0/P1 incident with an incident-id,
  ADR follow-up mandatory within ≤5 days.

canon-check: CLAUDE.md §Pragmatic-Exceptions §hotfix — marker authorized;
ADR-NNNN follow-up scheduled for 2026-06-02.
```

## When to invoke `/canon-check`

The tripwire blocker hook will tell you. Specifically, before:

1. Adding `// temporary`, `// puente`, `// bridge`, `// phase-bridge`, `// TODO §`, `// hack` comments.
2. Importing across bounded contexts (`from "@core/<a>"` inside `packages/core/<b>/`).
3. Running mass `sed -i` against import paths.
4. Choosing an architectural pattern (Shared Kernel, ACL, port, extends).
5. Adding `// canon-exception:` markers.
6. Closing a sub-phase with known cross-context violations.

Output a single `canon-check:` line that the hook will accept, OR a `REJECTED:` line that pivots the approach.
