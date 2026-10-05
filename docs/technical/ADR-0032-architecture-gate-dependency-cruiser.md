# ADR-0032: One architecture gate — dependency-cruiser over the whole resolved graph, with a baseline that only shrinks

- **Status**: Accepted
- **Date**: 2026-10-05
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0033](ADR-0033-layer-boundaries-and-composition-root-injection.md) (the
  architecture decisions these rules encode), [ADR-0002](ADR-0002-hexagonal-architecture.md) (the
  boundary enforcement it promised), [ADR-0012](ADR-0012-fitness-functions-architecture-tests.md)
  (the grep checks a graph does not replace), [ADR-0018](ADR-0018-dependency-freshness-canon.md)
  (the version rule)

## Context

ADR-0002 states that boundary violations "are caught at CI by `dependency-cruiser` — not at code
review". Until PR #408 that held only for relative imports inside one package. Three tools shared
the job, and none of them read the whole import graph.

**dependency-cruiser 17.4.0 dropped every cross-package edge.** `.dependency-cruiser.cjs` excluded
`(^|/)dist/`, and a workspace alias such as `@core/application/UseCase.js` resolves through the
package's `exports` to `packages/<name>/dist/`, so the edge was discarded without a message.
Measured on 2026-10-05: 1,216 modules, 2,169 dependencies, 0 errors and 40 warnings, all
`no-orphans`; of 3,089 workspace-alias import lines in its scope, the graph kept 52. The same
exclude hid `bullmq`, which ships from a `dist/` directory, so `core-domain-no-framework` could
never catch it. Type-only imports were not read at all. Four rules — `domain-no-framework`,
`application-no-infrastructure`, `domain-no-application`, `domain-no-infrastructure` — start from
`apps/api/src/domain/` and `apps/api/src/application/`, which no longer exist, so they match
nothing; they are still in the config at PR #408.

**madge did not see cycles across packages.** `check:circular` ran only in the `code-quality` job
of CI. It read 2,839 of 6,237 import edges and skipped 422 imports, 421 of them through workspace
aliases, so a planted `@core/domain` → `@core/accounts` cycle exited 0 (tracker D43 (e)). madge
8.0.0, the latest release, loses `module` and `moduleResolution` before its resolver runs.

**eslint-plugin-boundaries was blind where most imports are, and stricter than the canon where it
looked** (SMELL-183). No import resolver is configured, so relative imports written with `.js` go
unclassified and workspace aliases pass as external packages; its `domain` and `application`
elements name the deleted directories; its `@prisma/client/*` denials can never match; and only
`apps/api/src/**/*Routes.ts` counts as a route, so the `*Handlers.ts` modules that hold most of the
routes' Prisma code are unchecked (`SchedulingSlotHandlers.ts` alone is 659 lines). Applied
literally to the fully resolved graph, its policies reject 509 non-test edges. Checked against six
primary sources on 2026-10-05 (References), 460 of them are allowed by the canon — infrastructure
importing infrastructure, adapters importing Prisma, ports returning domain types — 43 are real
violations and 6 needed a decision, which [ADR-0033](ADR-0033-layer-boundaries-and-composition-root-injection.md)
takes.

A gate that reports a clean graph it never read is worse than no gate
([CLAUDE.md](../../CLAUDE.md) §Automated Compliance Checks). This repository had three.

## Decision

1. **dependency-cruiser 18.x is the one graph-level architecture gate.** It runs as
   `pnpm check:architecture` in the local battery (`architecture` step) and in the
   `dependency-cruiser` job of `audit.yml`. The fitness greps of ADR-0012 keep the invariants a
   graph cannot see.
2. **It reads the whole resolved source graph.** Shipped in PR #408 (`0e51032a`):
   - 17.4.0 → 18.4.0, the latest mature release;
   - resolution through the `development` export condition, the path mappings of
     `tsconfig.base.json`, and `tsPreCompilationDeps: true`, so type-only imports count;
   - the `dist` exclude narrowed to a workspace package's own `dist/`, so npm packages that ship
     from `dist/` stay visible to the framework rules;
   - the `@shared/types` alias carried by `.dependency-cruiser-resolve.cjs`, the only carrier the
     18.x config schema accepts (it rejects `alias` under `enhancedResolveOptions`);
   - the scope widened to `packages/ports` and `packages/adapters`;
   - `not-to-unresolvable` at `error`: an import the resolver cannot map to a file fails the gate
     instead of thinning the graph.

   Measured on the PR tip: 1,684 modules, 7,325 dependencies, 0 unresolved, 0 violations, 0
   cycles, about 3 s.

3. **`no-circular` replaces madge**, removed in PR #408 with its `check:circular` script and its CI
   step. The planted `@core/domain` → `@core/accounts` cycle that madge passed exits 6 here.
4. **The layer rules encode the canon that ADR-0033 verified**, at `error`, each rule class with a
   red proof (the violation planted, the gate failing, the tree restored byte-exact). They land in
   PR2 of item (v):

   | From                                                                      | May import                                                              | Rejected                                                                                                                       |
   | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | Infrastructure: `apps/api/src`, `packages/adapters`, `packages/providers` | anything                                                                | —                                                                                                                              |
   | Route modules, and the `*Handlers.ts` modules they delegate to            | use cases and queries, their DTOs and errors, domain types used as data | the Prisma client, repositories, adapters, providers, the DI container, a value object to construct (ADR-0033)                 |
   | Application: `packages/core/application`, `packages/core/<context>`       | domain, ports, `@core/application/UseCase`                              | infrastructure, frameworks, `@observability/logger` (its six imports are baseline entries until ADR-0033's `LoggerPort` lands) |
   | Domain: `packages/core/domain`                                            | domain                                                                  | everything else                                                                                                                |
   | Ports: `packages/ports`                                                   | domain, `@core/application/UseCase`                                     | infrastructure                                                                                                                 |

   `packages/shared` stays importable from every layer and imports none of them (the existing
   `shared-no-*` rules), and `no-cross-bounded-context` keeps the contexts of `packages/core`
   apart. The four rules that start from deleted directories leave with this set.

5. **Known violations live in a baseline that only shrinks.** PR2 writes
   `.dependency-cruiser-known-violations.json` with `--baseline-mode shrink-only`, which "keeps
   existing violations, removes fixed violations, but does not add new ones", and sets
   `baseline.staleEntriesSeverity: "error"`, so an entry whose violation was repaired fails the
   gate until the same change removes it. A new violation is not in the file and fails at `error`.
   The file is the deviation state of ADR-0033, edge by edge.
6. **eslint-plugin-boundaries retires in PR2**, with its policies in `eslint.config.ts`, its
   dependency and its pinning suite; SMELL-183 closes with it.

## Rationale

1. **One graph, one resolution.** The layer rules and the cycle check read the same resolved edges.
   Two tools meant two resolutions to keep correct, and each was wrong in its own way.
2. **The resolution is checked, not trusted.** `not-to-unresolvable` turns an import the resolver
   cannot map into a red gate instead of a silently thinner graph. The other half of the old
   failure, a resolved edge dropped by an `exclude`, is covered under Risks.
3. **Rules verified against primary sources reject only real violations.** A gate that rejects
   correct code, as 460 of the plugin's 509 edges would have, teaches people to route around it; a
   gate that rejects only violations can stay at `error`.
4. **The baseline lets the rules be hard today.** The repair that ADR-0033 queues is about 17,000
   CODE lines before the guards are sized. Without a baseline the rules would wait for all of it,
   and new violations would land unseen meanwhile. Stale entries at `error` keep the file equal to
   the code, so it is a measured debt, not a waiver.
5. **The version is the first that can do it.** `--baseline` and `--baseline-mode` first ship in
   18.3.0 and `staleEntriesSeverity` in 18.4.0, which is also the latest mature release (ADR-0018).

## Alternatives Considered

- **Fix eslint-plugin-boundaries' scope and keep both tools.** Configure a resolver, re-point the
  elements, classify the handler modules, and keep the cruiser for cycles. Rejected: two policies
  over the same edges, each with its own resolver and its own element map, is the drift that
  produced SMELL-183, and the plugin's per-file element patterns are what left the `*Handlers.ts`
  modules out. One rule set in one tool removes the class.
- **Repair madge's resolver.** Rejected: the loss of `module` and `moduleResolution` happens in
  madge 8.0.0's hand-off to `filing-cabinet` (D43 (e)), so fixing it needs an override of a
  transitive dependency, while the cruiser already computes the same graph correctly.
- **Hard rules with no baseline: repair everything first.** Rejected: the repairs are a workstream
  queued after N-TEST-1 (ADR-0033). The gate would stay off for all of it, or the rules would be
  weakened to today's tree, which would then read as the canon.
- **Rules at `warn` until the migration ends.** Rejected: a warning that is always present stops
  being read, and the battery verdict reads any warning line as red (D43), so the rules would need
  an exception of their own.

## Consequences

**Positive**

- Every cross-package edge is read, and cycles across packages are found: the plant that madge
  passed fails here.
- One rule set, verified against primary sources, at `error`.
- The remaining debt is listed edge by edge, and the list can only shrink.

**Negative / costs**

- **The baseline is as large as the debt.** PR2 measures it when it writes the file. It is not the
  509 of the boundaries report, which counted 460 edges the canon allows and missed the
  `*Handlers.ts` modules. It holds the deviations ADR-0033 names: the container references of the
  route modules not yet migrated, the Prisma, repository, adapter and provider edges of the route
  and handler modules, the value objects built in routes, and the six `@observability/logger`
  imports until PR3a. From then on it may fall and must never rise; each repair removes its entries
  in the same change, or its stale entries fail the gate.
- **The required check changes name.** Removing madge renamed the `code-quality` job to
  `Code Quality (knip + jscpd)`. The branch protection of `main` still requires
  `Code Quality (knip + jscpd + madge)` and must be updated before PR #408 merges, or that pull
  request waits forever.
- **The version is held one release behind until 18.5.0 matures** on 2026-10-07T19:18Z;
  [SECURITY_CANON.md](../security/SECURITY_CANON.md) carries a pre-registered hold row scheduled
  to it.
- **Resolution depends on two files.** `.dependency-cruiser-resolve.cjs` carries the
  `@shared/types` alias, and a workspace package added without a `development` export condition
  fails `not-to-unresolvable` until it gets one.
- **The plugin's pinning suite goes with it** (`apps/api/tests/unit/lint/boundariesPolicies.test.ts`),
  and `apps/api/tests/unit/lint/architecturePolicies.test.ts` takes its place. It loads
  `.dependency-cruiser.cjs` and pins what the baseline cannot: the exact rule set, each rule's
  severity and anchors (`from`, `to`, `pathNot`, `dependencyTypesNot`), and the `options.exclude`
  scope. A weakened rule leaves a stale entry only where it has entries, so a rule with none
  (`workers-no-api`, `shared-depends-only-on-shared`, the domain and ports rules) could be deleted
  or widened while the gate still exits 0. Measured: with `workers-no-api` removed and
  `core-domain-no-framework` widened to admit `packages/ports`, the gate stayed green and the
  suite failed on both rules. The cruiser rules' own red proofs cover the rest of what the old
  suite pinned.
- **The rules see imports, not calls.** What a module does with an object it receives is outside
  the graph; ADR-0012's revisit names the AST check for that case.

## Revisit if

- dependency-cruiser removes or changes `--baseline-mode shrink-only` or `staleEntriesSeverity`.
- A rule is needed on calls rather than imports: ADR-0012's revisit path, an AST check.
- ADR-0033's migration is dropped. The baseline would then be permanent, and the route rule is
  re-decided openly instead of kept as a list that never shrinks.
- The module or dependency count that `check:architecture` prints falls with no matching deletion of
  code: a resolution regression that `not-to-unresolvable` cannot see (Risks).

## Risks and Mitigations

| Risk                                                                                                                 | Mitigation                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An `exclude` or resolution change drops edges again without leaving them unresolved — the failure this record closes | `not-to-unresolvable` catches only the unresolved half. Every run prints the module and dependency counts (1,684 and 7,325 at PR #408), and the pull request that adds or edits a rule class plants its red proof through a workspace alias. A floor on the counts is not a check today |
| A baseline entry hides a new violation on the same edge                                                              | Entries match on `from`, `to` and rule. A new import between two modules already listed is that same edge, and it is repaired with it                                                                                                                                                   |
| The baseline is regenerated in `full` mode and absorbs a new violation                                               | The file is versioned; a grown entry count shows in the diff of the pull request that grows it, and review refuses it, as for the ratchets of fitness #30 and #38                                                                                                                       |
| A rule pattern stops matching after a path moves, and the rule passes over nothing                                   | PR #408 found two rules that would have gone blind once imports resolved and gave them resolved-path patterns. Every rule change carries its red proof ([CLAUDE.md](../../CLAUDE.md) §Automated Compliance Checks, "Extending the suite", step 3)                                       |
| The renamed required check blocks every merge                                                                        | Edward updates the branch protection before PR #408 merges — done on 2026-10-05 at 05:59Z through the API on his instruction: `Code Quality (knip + jscpd + madge)` → `Code Quality (knip + jscpd)`, 19 required checks before and after                                                |
| 18.5.0 changes behaviour                                                                                             | The hold row schedules the move after maturity, and the rules' red proofs run again on the bump                                                                                                                                                                                         |

## Implementation notes (2026-10-05)

PR2 of decisions 4 to 6 shipped as two pull requests of item (v): `PR v-b`
(#411, `workstream/item-v-rules`, `515487b9`), the layer rules and the baseline, and `PR v-c`
(#412, `workstream/item-v-boundaries`, `63881f50`), the retirement of `eslint-plugin-boundaries`. The
decisions stand as written; these notes record where the code differs from their text.

- **The scope grew in `PR v-b`** beyond the list of decision 2, which is PR #408's. The command also
  cruises `apps/workers/src`, which `workers-no-api` and `api-no-workers` need to keep one
  composition root per executable, and the inherited `(^|/)reports/` exclusion is narrowed to
  `(^|/)reports/mutation/` (`.dependency-cruiser.cjs:362`): it had hidden
  `apps/api/src/reports/reportRoutes.ts` and the whole `packages/core/reports` context. The same pull
  request added `shared-depends-only-on-shared` beside the `shared-no-*` rules of decision 4, the one
  policy of `eslint-plugin-boundaries` the cruiser lacked. Measured: 1,711 modules and 7,488
  dependencies at `PR v-b`, 1,714 and 7,491 at `783aeebe`.
- **A baseline entry matches more than `from`, `to` and rule.** dependency-cruiser also compares the
  edge's dependency types and how it resolved, so rewriting a listed import without removing it (an
  alias for a relative path, a value import for `import type`) turns the entry stale and the edge new
  at once, and the gate stays red until the violation is gone. The header of `.dependency-cruiser.cjs`
  states it, and `apps/api/tests/unit/scripts/architectureBaseline.test.ts` pins the stale-entry
  failure and the shrink-only regeneration on a fixture the tool baselines itself. The case of the
  Risks row "A baseline entry hides a new violation on the same edge" narrows to a second import of
  the same specifier and kind between two listed modules, which dependency-cruiser records as the
  same edge.
- **Shrink-only is a config option, not a flag.** `options.baseline` sets `mode: "shrink-only"` and
  `staleEntriesSeverity: "error"` (`.dependency-cruiser.cjs:383-385`); `check:architecture` reads the
  file through `--ignore-known`, and `check:architecture:update-baseline` regenerates it with
  `--baseline` and formats it with prettier.
- **The baseline was written at 138 entries and holds 124 at `783aeebe`.** At `PR v-b`: 77
  `routes-no-container`, 25 `routes-no-prisma`, 17 `routes-no-repositories`, 8
  `routes-domain-types-only`, 6 `core-application-no-infrastructure` and 5
  `routes-no-adapters-or-providers`. The six `@observability/logger` entries of decision 4's
  application row left when ADR-0033's `LoggerPort` landed, one in `PR v-d1`
  (#413, `workstream/item-v-logger-a`) and five in `PR v-d2` (#414, `workstream/item-v-logger-port`);
  `PR v-e1` (#415), `PR v-e2` (#416) and `PR v-e3` (#417) removed two, one and five route entries.
  At `783aeebe`: 75
  `routes-no-container`, 23 `routes-no-prisma`, 17 `routes-no-repositories`, 8
  `routes-domain-types-only` and 1 `routes-no-adapters-or-providers`.

## References

- Alistair Cockburn, "Hexagonal architecture" — https://alistair.cockburn.us/hexagonal-architecture
- Robert C. Martin, "The Clean Architecture" (2012) —
  https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html
- Mark Seemann, "Service Locator is an Anti-Pattern" (2010) —
  https://blog.ploeh.dk/2010/02/03/ServiceLocatorisanAnti-Pattern/
- Mark Seemann, "Composition Root" (2011) — https://blog.ploeh.dk/2011/07/28/CompositionRoot/
- Mark Seemann, "Instrumentation with Decorators and Interceptors" (2010) —
  https://blog.ploeh.dk/2010/09/20/InstrumentationwithDecoratorsandInterceptors/
- `@fastify/awilix` README — https://github.com/fastify/fastify-awilix
- dependency-cruiser, rules reference (`circular`, `couldNotResolve`) —
  https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md · options
  reference (`baseline`) —
  https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md
- PR #408 — https://github.com/edwardricardo/omni-post/pull/408 (`ba39279b`, `95e2398e`,
  `0e51032a`): the resolution, `no-circular`, `not-to-unresolvable`.
- Research notes, measured or fetched on 2026-10-05 (the maintainer's tooling directory, not in the
  repository): `/root/.claude/omnipost-tools/research-2026-10-04/item-v-dependency-cruiser-map.md`
  (engram 1208), `boundaries-violations-509.classified.json` (engram 1211), `boundaries-repair-plan.md`
  and `boundaries-repair-sizing.md` (engram 1213), in the same directory.
- Repository: `.dependency-cruiser.cjs`, `.dependency-cruiser-resolve.cjs`;
  [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) §Decisions log, D43 and D49;
  [roadmap-detected-smells-backlog.md](../reports/roadmap-detected-smells-backlog.md) SMELL-183;
  [SECURITY_CANON.md](../security/SECURITY_CANON.md) (the `dependency-cruiser` hold row).
