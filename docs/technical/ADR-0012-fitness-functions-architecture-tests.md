# ADR-0012: 22 Fitness Functions as architecture-test layer in CI

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

ADRs 0002-0008 establish architectural rules (hexagonal layering,
DDD, CQRS, Result types, DI composition root, saga canon). Rules
that exist only in documents are eventually violated. The TS/JS
ecosystem doesn't have a mature `ArchUnit` equivalent (Java's
canonical architecture-test library). Three failure modes:

1. **Doc rot.** Devs read CLAUDE.md once at onboarding, then forget
   the layering rules. New code violates them.
2. **Code review fatigue.** Reviewers asked to manually check "did
   this PR introduce a Prisma import in a route?" eventually miss
   one. The violation lands in main.
3. **Refactors regress canon.** A large refactor (S3.4c migrating
   `GatewayBillingService` to ports) is easy to silently undo
   ("just one direct prisma call for performance, I promise") if
   nothing structurally prevents it.

We need automated structural checks running on every PR.

## Decision

**Adopt grep-based fitness functions as a lightweight ArchUnit
equivalent. 22 distinct rules, each with a one-line regex + hard-zero
threshold, wired into `.github/workflows/fitness.yml` and documented
in `CLAUDE.md §Automated Compliance Checks`.**

### Pattern

Each fitness function is:

1. A regex that detects a violation pattern in source files.
2. A scope (paths to scan, paths to exclude).
3. A hard-zero threshold (any new match fails the workflow with an
   `::error` annotation).

Example (`#22` introduced in S5):

```bash
grep -rlE "^\s*\*\s*@layer application\s*$" apps/api/src --include="*.ts" | wc -l
# Must be 0; CI fails if not.
```

### The 22 rules

1. No Prisma singleton imports in routes
2. Domain layer is framework-free
3. No `any` in domain/application/infrastructure
4. No raw `throw` in domain/application
5. No `@ts-ignore`/`@ts-nocheck` in production source
6. CQRS handlers don't touch Prisma directly
7. No `randomUUID` in dedupeKey
8. No sprint/phase references in source comments
9. Every `.ts`/`.tsx` file has `@file` header
10. No invalid `@layer` values (only `domain`/`application`/`infrastructure`)
11. No raw `setInterval` in backend
12. Every React component file has `@component` tag
13. No direct `pino` instantiation in `apps/api` (use `createLogger`)
14. No `private *Cache = new Map()` per-class caches (OWASP A07)
15. No insecure secret fallbacks (CWE-798)
16. No direct `process.env.*` in `apps/api/src` outside `config/env.ts`
17. No direct `process.env.*` in Next.js apps outside `lib/env.ts`
18. No direct `argon2.hash`/`argon2.verify` outside canonical helper
19. No `process.env.*` reads inside provider Adapter classes
20. No legacy BullMQ `addRepeatable` / `repeatable` API
21. No Prisma singleton imports outside composition roots (DI guard)
22. No `@layer application` in `apps/api/src/` (post-`application-services-to-core` workstream)

### Extending the suite

Adding a new fitness check requires three coordinated edits, in
order:

1. Add the regex to `CLAUDE.md §Automated Compliance Checks` with a
   one-line description of the threat being prevented + justify
   exclusions.
2. Add the corresponding step in `.github/workflows/fitness.yml`
   mirroring the regex exactly (**paste, don't paraphrase** —
   drift between the doc and the workflow is the failure mode).
3. Verify `count = 0` on `main` before merging the wire. If
   non-zero on existing code, document the baseline + ramp-down
   plan as a backlog entry rather than locking in non-zero noise.

## Rationale

1. **Hard-zero discipline.** Every fitness function is hard-zero on
   main. There's no "we'll fix the 3 existing violations
   eventually." Any new violation fails CI immediately.
2. **Mechanical execution.** Each rule is `grep -rlE | wc -l`
   pipelines — trivial to read, trivial to verify locally before
   pushing.
3. **Boundary enforcement that survives refactors.** When a major
   refactor (S3/S4) lands, the fitness functions verify the
   structure end-to-end. Drift impossible.
4. **CI-visible failures.** `::error` annotations on GitHub Actions
   surface violations directly on the PR diff. Reviewers see the
   problem without searching.
5. **Lightweight.** No new dependency, no JVM-equivalent runtime.
   `grep` + `wc` in bash + `if [ "$COUNT" -gt 0 ]; then exit 1; fi`.

## Alternatives Considered

- **No automated architecture tests.** Rejected — see Context
  failure modes.
- **TypeScript-based `ArchUnitTs` (community equivalents).**
  Considered. Rejected as overkill: the regex approach captures
  ~95% of what we'd need and has zero deps.
- **ESLint custom rules.** Considered. Rejected because (a) some
  rules need cross-file scope which is awkward in ESLint, and (b)
  ESLint config drift is a real risk; bash regex is paste-into-CI
  obvious.
- **dependency-cruiser ONLY.** Already use it for layer boundary
  rules (`core-domain-no-framework`,
  `core-application-no-infrastructure`). But depcruise is graph-
  based; it can't catch "no `any` in domain", "no `setInterval`
  outside scheduler-adapter", "no `console.log` in production
  source". Fitness regex covers the gap.

## Consequences

**Positive**

- 22 architectural invariants enforced on every PR with zero false
  negatives (regex either matches or doesn't).
- The `CLAUDE.md` doc IS the spec; the workflow file is a paste-
  for-paste mirror. Single source of truth.
- Refactor regressions are impossible: any attempt to undo a
  canon decision (e.g., re-introduce `@layer application` in
  apps/api/src after S5) fails the corresponding fitness check.
- New rule introduction is mechanical: a 3-edit recipe Edward can
  execute or ask Claude to execute in 10 minutes.

**Negative / costs**

- **Regex false positives** are possible. Each rule has explicit
  exclusion paths in its regex (e.g., `#11` excludes
  `enhancedValidator.ts` which holds `"setInterval("` as a literal
  string in a security denylist). Maintaining these exclusions is
  ongoing.
- **Rule drift between CLAUDE.md and workflow.** The "paste don't
  paraphrase" rule mitigates but doesn't eliminate. Workflow is
  the runtime authority; doc is the human-readable form.
- **Some violations are caught only at CI**, not at typecheck. Devs
  pushing without running locally see the failure 2-5 minutes
  later. Acceptable trade-off vs the cost of installing a custom
  ESLint plugin.

## Revisit if

If a new fitness rule needs cross-file structural reasoning that
regex can't express (e.g., "every aggregate must have a corresponding
repository port"), we either (a) implement it in depcruise (more
graph-based capability), or (b) write a tiny TS-AST script using
ts-morph or the TypeScript compiler API. Bar for adopting either:
≥3 fitness rules can't be expressed in regex without false-positive
risk.

## Risks and Mitigations

| Risk                                                                           | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Regex drift between CLAUDE.md and workflow.yml                                 | "Paste, don't paraphrase" rule in CLAUDE.md §"Extending the suite". Both must update in the same PR.                                   |
| Exclusion list becomes unmaintainable                                          | Each fitness step in the workflow has comments explaining every exclusion. PRs that add new exclusions must justify in commit message. |
| Local development without running fitness locally                              | Pre-commit hook (lint-staged) does not run fitness (too slow); devs can run individual rules manually. CI is the safety net.           |
| Rule baseline drift over time (rules that used to be hard-zero now have noise) | Each rule's introduction PR establishes `count = 0`; any new violation fails CI. The hard-zero is structurally maintained.             |

## References

- "Building Evolutionary Architectures" — Ford, Parsons, Kua —
  O'Reilly 2017 (origin of "fitness function" term)
- "ArchUnit" (Java) — https://www.archunit.org/
- OmniPost `CLAUDE.md §Automated Compliance Checks (CI Fitness Functions)`
- File: `.github/workflows/fitness.yml`
- ADR-0011 — workstream that introduced fitness `#22`
