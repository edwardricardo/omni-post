---
name: feedback-audit-deletion
description: "Edward's audit method + deletion discipline: 3 questions, orphan ≠ delete, pattern not instance, duplication registry"
metadata:
  type: feedback-canon
  owner: edward
  loaded: every-session-via-claude-local-md
---

# Audit Method & Deletion Discipline

> Personal canon: how to audit (pattern-first, not instance-first), what questions
> to ask before recommending any delete, and the duplication registry policy.
> Auto-loaded via `@~/.claude/feedback/audit-deletion.md` in `CLAUDE.local.md`.

**Owner:** Edward
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Rule: Three questions before recommending code deletion

Before recommending deletion of ANY code, ALWAYS ask three questions:

1. **Origin + intent**: When was this written, by whom, why? (Search git log, comments, design docs, roadmap.)
2. **Current purpose**: What is this code supposed to do? (Read code + JSDoc + tests + context.)
3. **Duplication check**: Does something else implement this? (Grep cross-codebase.)

Only if all three converge on "obsolete / no purpose / duplicated" → propose DELETE. If one suggests "valid intent pending wire" → propose IMPLEMENT or WIRE, not delete.

**Why:** Edward (2026-04-30, exact): _"antes de recomendar algo código para eliminación siempre debes hacerte esa 3 preguntas… no estamos construyendo esto porque sí, no siempre la vía más corta y la que se hace más rápido es la mejor, siempre lo será la que le brinde más y mejores opciones tanto al negocio como al usuario."_ Concrete failure: recommending DELETE of event snapshot infrastructure because it had zero call sites, despite backend fully implementing it and business needing aggregates → delete cost 1370+ LOC plus future capability loss.

**How to apply:**

- Bloque "Las 3 preguntas" explicit in proposal:
  - Origin: git log + comments + design docs + roadmap.
  - Purpose: read code + JSDoc + tests, understand responsibility.
  - Duplication: grep cross-codebase for equivalent.
- Only if three converge on "obsolete" → propose DELETE.
- If one points to "infrastructure prevista no-wireada" → IMPLEMENT or WIRE.
- Estimation is info, NOT decision factor. Decision = "what gives more options."
- Cero excepciones: orphan code is preparation for future, not necessarily trash, until proven otherwise.

---

## Rule: Orphan code ≠ code to delete — investigate WHY it's orphan

Frontend orphan-detection tools (knip, madge, cruiser, jscpd) only confirm "no caller." They don't tell you whether the gap is accidental (forgotten wire-up) or deliberate (abandoned feature). For each orphan candidate, audit the FULL feature surface (backend, tests, related code) before classifying as DELETE.

**Why:** Edward interrupted an audit when I was about to delete the "notifications constellation" (~470 LOC frontend + ~900+ LOC backend = 1370+ LOC integrated, SSE-implemented, tests-written, DB model, migrations). The only missing piece: UNA línea mounting the bell in layout.tsx. All tools confirmed "orphan frontend." NONE asked "is the backend corresponding implemented?" (2026-05-08).

**How to apply:**

1. Per orphan candidate, inspect the complete feature:
   - Backend exists? (`grep -rn "/<endpoint>" apps/api/src` → if rutas exist, feature 95%, not scaffolding.)
   - Integration tests? (MSW handlers + tests = feature designed to work.)
   - Domain entity? (Prisma model + migration = feature first-class.)
   - LOC total? (>500 integrated = almost never DELETE reasonable.)
2. Categorize:
   - **DEAD-DUPLICATE**: feature covered by other code + has consumers → safe DELETE.
   - **DEAD-INFRA-OPTIONAL**: utility never adopted, no backend, no roadmap → DELETE.
   - **FORGOTTEN-FEATURE**: orphan frontend + backend implemented OR detailed tests → NEVER DELETE without explicit product decision. Wire-up usually cheap; delete is expensive.
   - **GENESIS-SCAFFOLDING-DEAD**: orphan no-backend, no-tests, no-purpose, no-equivalent → DELETE post-3Q.
3. Audit produces categorization + product decisions pending, NOT automatic deletes.
4. Three-question filter is NOT substitute for feature-surface inspection — it fails on FORGOTTEN-FEATURE (feature has clear intent, no duplication — yet correct answer is "wire", not "delete").
5. Tooling confidence ≠ business decision. Tools answer "no caller." Humans answer "should exist."

---

## Rule: Orphan as SIGNAL, not CONCLUSION — analyze flow end-to-end for missing links

When an audit flags an artefact as orphan, the flag is a hypothesis, not the verdict. **Apply the three questions to the complete feature flow** the artefact is part of, not just the single file. A flow broken at one eslabón may need FIX at a different eslabón, or DELETE if all eslabones except the flagged are also broken.

**Why:** Audit flagged `inboxSyncWorker` as not in Dockerfile CMD (consumer-side missing). The three questions applied to the END-TO-END flow revealed the producer (`DispatchInboxSyncUseCase`) was also broken (DI-registered, zero callers). Fixing only the consumer would have left the producer orphan. Correct answer: WIRE both extremes, not just bootstrap (2026-05-11, FN-015).

**How to apply:**

- When a finding points to an artefact, map the complete flow it participates in:
  - **What is it?** Artefact + role in flow.
  - **End-to-end flow**: producer → transport/queue → consumer → persistence → UI/output.
  - **Per eslabón**: exists, executes, has callers?
- For each broken eslabón: is it a bug latent, optimization defensive, or conscious decision?
- Audit produces flow-map + per-eslabón assessment. The recommendation may differ from the audit's original suggestion (which flagged one piece).
- Anti-pattern: "el artefacto está huérfano → DELETE" collapses all three questions into one.

---

## Rule: Audit method discipline — pattern, not instance; broad before scope-lock; re-audit at close

When a roadmap entry says "L-538 Invoice.amount Float," that's an INSTANCE. The PATTERN is "money-as-Float." Audit by pattern repo-wide before locking scope. Document method (regex, filters, count pre/post-filter) in the plan.

**Why:** L-538 names one hit. Pattern audit would find all 7 hits, not 3 in-scope. Edward: _"Hasta cuando te seguirás confiando y equivocando en diagnosticar?"_ — recurring method failure, not instance-miss (2026-05-01).

**How to apply:**

1. Roadmap entry = floor, not ceiling.
2. **First step**: broad-pattern grep repo-wide. Output appears in plan's "estado verificado."
3. **Filters scrutinized**: not data-shopping. Each `-v` justified with code evidence.
4. **Document counts**:
   ```
   Pattern: money-as-Float
   Raw grep: 7 hits
   Excluded: 4 (Stripe external, verified [path:line])
   In-scope: 3
   ```
5. **Double-pass**: first by name, second by behavior signature (stricter).
6. **Re-audit before batch close**: if in-scope count > 0 still, batch not done.
7. **DB ground-truth**: for constraints (FK gaps, etc.), the schema file is a starting point; the DB query is the arbiter. Prisma-generated implicit FKs may exist in DB despite schema gap.

---

## Rule: Audit with incision — apply canon uniformly, no classification excuses

Audits MUST be strict and consistent. Same anti-pattern across different files = same severity. Never use "feature-gap" or "different category" to excuse a finding. Apply canon uniformly.

**Why:** Edward (2026-05-01): _"sigue sobreviendo todo en lugar de ser mas inciso, mas estricto, estas para escrutinar todo no para hacer de la vista gorda y pensar que todo esta correcto, es una mala práctica."_ I surfaced `templateAnalytics.trackTemplateUsage()` returning success while persisting nothing (silent-fake-success = L-27 severity) but undersold it as "feature-gap, not compliance-critical" using file description as excuse.

**How to apply:**

1. Pattern-matching is the test, not naming. Find X in file A → grep for X in all files. Filter by behavior, not category.
2. Severity follows the bug, not the feature. Silent-fake-success in analytics = same severity as silent-fake-success in logging.
3. Verify caller behavior, not file description. If callers report success to clients, the "stub" is dishonest at the route layer.
4. No "tracked under different L-\* numbers" excuses. Document new patterns at the same severity tier as comparable findings.
5. If uncertain: surface explicitly ("Found X, similar to Y, I think lower severity because Z, want strict review?") — don't unilaterally excuse.

---

## Rule: One-by-one + edge questions unlock cross-pattern bugs

When auditing multiple similar items (deps, files, exports), apply the three-question filter **one-by-one** and allow Edward's edge-case questions ("how does X work then?") to surface bugs batch-cleanup misses.

**Why:** Audit flagged `@providers/instagram` as unused in admin. One-by-one approach + Edward's question "how are posts published then?" revealed 3 bugs: orphan in admin (original), orphan in client (same Genesis fossil), and missing-declared in workers (work-by-hoisting latent bug). Batch-cleanup would have found 1 (2026-05-08).

**How to apply:**

- When tool flags N items "same type" → don't bulk-fix.
- Per item: narrate origin + purpose + where it's ACTUALLY used (cross-app/cross-package/cross-test).
- Accept Edward's edge-questions — they unlock broad-pattern audit that reveals inverse bugs (missing instead of unused).
- Batch-cleanup might be efficient; one-by-one is thorough.
- Applies to: orphan deps, unused exports, dead types, unused env vars.

---

## Rule: Register duplications in a dedicated .md, don't repair in-silo

When you find code that **duplicates functionality already written**, register it in a dedicated duplications markdown (e.g., `docs/reports/code-duplications.md`) with entry: (1) what duplicates what (paths + symbols), (2) which is more complete, (3) verdict proposed. Do NOT repair it in the same moment.

**Why:** The code is black-box with frequent duplication (workers reimplementing use-cases as inline queries, never calling the hexagonal version already written). Repairing in-silo mixes scope and risks; deleting without the three questions is dangerous. Flagging preserves the decision to do it properly (2026-05-20, F1-CLI-1).

**How to apply:**

- At detection: append to duplications markdown (create if needed; respect Documentation Policy = under `/docs/`).
- Entry: duplicated ↔ canonical, which is more complete, verdict (REMOVE+wire / MERGE / KEEP-both).
- **CRITICAL**: before closing the plan/session where duplication was detected, resolve every entry. Resolution = remove duplicate + wire to canonical (or MERGE or explicit KEEP), not just flag.
- Relates to: [[feedback_no_patches]], [[feedback_orphan_not_equal_delete]], [[feedback_three_questions_before_delete]], [[feedback_backlog_during_implementation]].

---

## Rule: Runtime-validity audit, not import-graph only

Verification that code is truly "alive" requires checking runtime dependencies exist, not just that imports are clean and DI binding exists. A module can have clean imports, DI registration, and consumers yet be a **façade ghost** pointing to nonexistent runtime infra.

**Why:** Cited `DatabaseOptimizer.ts` as canon-alive because DI-registered + consumers exist + typecheck passes. Missing: all its `$queryRaw` queries target DB views/functions that DON'T exist in migrations. ~500 LOC façade → Edward: "Qué clase de auditoría hiciste tú?" (2026-05-12, FN-007/008/009).

**How to apply:**

- For any finding claiming "dead" or "canon redundant" involving DB/SQL:
  - `grep -rE "\\$queryRaw|\\$executeRaw" <file>` → extract references.
  - Cross-check against `infra/prisma/migrations/` + `schema.prisma`.
  - If reference is system view, verify extension enabled.
- For "use X instead of Y" recommendations: verify X has complete foundation (DB + env + reachable APIs + tests passing).
- Before scope-lock on a finding, sweep the cluster: if target uses raw SQL → all raw-SQL code in same domain.
- In audit trackers: distinguish `dead-code` (no consumers) vs `façade-dead` (consumers exist, runtime deps don't).

---

## Rule: No reference to replaced code in comments/JSDoc

Comments, JSDoc, file descriptions must NOT mention: what's being replaced, migrations in-progress, legacy code, versions before, plan phases, canon sections, scope justifications, bugs fixed, or temporal attribution ("since 2026", "recent change").

**Why:** Future readers don't care what was replaced. Those comments rot with time when the migration completes. They belong in PR description + git log, not source. Edward repeated this (2026-04-XX, 2026-05-02). DI refactors especially: never comment "Injected Prisma client" or "composition root owns singleton" — only "Prisma client for [what queries]."

**How to apply:**

1. Before writing @description / file header: "Would this description make sense if code always was this way?" If no, remove the temporal part.
2. Describe ONLY current responsibility + contract.
3. Triggers to avoid: "previously", "formerly", "legacy", "deprecated" (unless `@deprecated` real), "replacing", "migration", "transition", batch/sprint/phase references, "old vs new", canon sections, "F0 ships X; F1 adds Y", "bug latent since", "regression guard", DI editorializing ("injected", "composition root owns").

---

## How to extend

Adding a new audit/deletion rule:

1. Append a `## Rule: <short title>` section with Rule / **Why** / **How to apply**.
2. If the rule extends "3 preguntas" → reference [[three-questions]] explicitly and explain the extension.
3. Cross-link with `[[rule-name]]` to related rules.
