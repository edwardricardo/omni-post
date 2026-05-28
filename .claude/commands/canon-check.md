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
   - `~/.claude/feedback/audit-deletion.md` — 3 preguntas, orphan ≠ delete, pattern not instance
   - `~/.claude/feedback/runtime-contract.md` — frontend-backend coupling, MSW canon, smoke tests
   - `~/.claude/feedback/tools-infra.md` — pnpm, LXC, DB migrations, version pinning

2. **For each applicable rule, write:**

   ```
   - <canon-file> §<rule>: ✅ AUTORIZA — <reason>   OR
   - <canon-file> §<rule>: ❌ PROHÍBE — <reason>
   ```

3. **Emit verdict:**
   - If ALL rules ✅ → emit the `canon-check:` line per the format below.
   - If ANY rule ❌ → emit `REJECTED: <reason>` and do NOT proceed with the Edit/Write. Propose canon-aligned alternative.

## Canon-check line format (for the assistant message)

After verdict ✅:

```
canon-check: <canon-file> §<rule-id> — <decision> autorizada porque <razón canónica>
```

The pre-edit tripwire blocker hook greps the prior assistant message for `^canon-check:`. If absent or malformed, the next Edit/Write is blocked.

## Examples

### Example 1 — workaround proposal (rejected)

```
DECISION: "use absolute path @core/security/X from inside packages/core/application/src/ai/"

RULE CHECK:
- feedback/canon-research.md §no-time-bombs: ❌ PROHÍBE — workaround sin prevention real;
  cross-package import resolverá pero deja debt invisible.
- ARCHITECTURE_CANON.md §Hexagonal: ❌ PROHÍBE — cross-context import sin port viola
  "dependency direction is always inward".

REJECTED: resolver vía SecurityClassifierPort (existe ya en @ports/core).
```

### Example 2 — pattern choice (authorized)

```
DECISION: "extract embeddings to packages/core/embeddings/ as shared kernel"

RULE CHECK:
- ARCHITECTURE_CANON.md §DDD Aggregates: ✅ AUTORIZA — shared kernel es patrón canónico
  (Evans, "Domain-Driven Design" §14.2) cuando ≥2 contexts dependen del mismo modelo.
- feedback/canon-research.md §research-first: ✅ AUTORIZA — verifiqué que embeddings tiene
  3 consumers (ai, glossary, style-guide) y todos consumen el mismo método embedSingle.

canon-check: ARCHITECTURE_CANON.md §DDD-Aggregates — embeddings shared kernel autorizado
porque 3 contexts (ai/glossary/style-guide) lo consumen con el mismo modelo, cumpliendo
el criterio de shared-kernel (Evans §14.2).
```

### Example 3 — hotfix override

```
DECISION: "add // canon-exception: hotfix:INC-1234 in apps/api/src/billing/X.ts"

RULE CHECK:
- CLAUDE.md §Pragmatic-Exceptions hotfix: ✅ AUTORIZA — P0/P1 incident con incident-id,
  ADR follow-up mandatorio en ≤5 días.

canon-check: CLAUDE.md §Pragmatic-Exceptions §hotfix — marker autorizado;
ADR-NNNN follow-up programado para 2026-06-02.
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
