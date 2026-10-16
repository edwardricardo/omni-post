# Foundation Practices

**Owner:** Platform engineering
**Status:** living document, started 2026-10-15; it grows with every unit that teaches a practice.

The practices the next application adopts from its first commit, so it does not pay twice for what omni-post paid for in rework, the Testing Refoundation above all. The next application shares this repository's stack (TypeScript, Fastify, Next, Prisma on Postgres) and none of its domain: nothing here is about social media, providers or posts. Each entry is one practice, written as what to create and enforce on day one. The document records practices, never which packages to use.

## Where this is going

1. This document grows while the lessons happen.
2. It is turned into a prompt.
3. The prompt generates a skeleton of the next application.
4. The skeleton becomes the template, and counts as one only when every gate it carries shows a real red, a non-zero exit, on a planted violation.

It is read by whoever starts the next application, by whoever writes that prompt, and by every unit in this repository that teaches a practice.

## Entries at a glance

| ID     | Area                 | Practice                                                                    | Kind                  |
| ------ | -------------------- | --------------------------------------------------------------------------- | --------------------- |
| FP-005 | Architecture         | One composition root from the first route; routes never see the container   | construction and gate |
| FP-001 | Testing              | Each test file has exactly one collector, run by a required check           | construction and gate |
| FP-002 | Testing              | A test run that collects zero tests fails                                   | gate                  |
| FP-011 | Testing              | An error double carries the shape measured on the real dependency           | construction          |
| FP-003 | CI and gates         | A gate fails closed when its scope is missing or its scan read nothing      | construction and gate |
| FP-004 | CI and gates         | A gate merges only after its red path shows a real non-zero exit            | construction and gate |
| FP-008 | CI and gates         | Every root config a package extends is part of the build cache key          | gate                  |
| FP-007 | Security and tenancy | Tenant isolation fails closed from the first tenant-bearing model           | construction and gate |
| FP-009 | Dependencies         | A dependency check reads a checked list for what the fields cannot say      | construction and gate |
| FP-010 | Dependencies         | A freshness gate covers every tool in the manifests, families in lockstep   | gate                  |
| FP-006 | Documentation        | Method-level documentation is enforced on every in-scope file from commit 1 | gate and hook         |

## How to use this document

### Entry format

Every entry is a `###` heading with its permanent ID and the practice in one line, followed by four fields:

```markdown
### FP-NNN — <practice in one line>

- **Practice:** what the next application creates or enforces, stated so it can be checked.
- **Why:** what not having it cost omni-post, with the path to the evidence.
- **Day-one enforcement:** the kind (construction, gate or hook), what the next application sets up
  at its first commit, and how omni-post's precedent carries over.
- **Loosen if:** the measurable condition under which the rule may be relaxed, or "never" with the
  reason.
```

IDs are permanent: a new entry takes the next free number, and an entry that a later lesson sharpens is updated in place rather than duplicated.

### Strict first

Every practice starts at its strictest form: at zero, with no baseline and no grandfathered files. Retrofitting strictness costs far more than relaxing it. omni-post made method-level JSDoc canon with nothing enforcing it; its gate, which landed on 2026-10-11, holds only the files a change touches, and the rest waits for a reconciliation that started from 1,028 of 2,134 in-scope files holding 9,648 violations (FP-006). Relaxing a rule that already holds at zero is one edit.

So every strict rule names, in its **Loosen if** field, the measurable condition under which it may be relaxed. A rule is never loosened out of fatigue, and a field that says "never" means never.

### Scar versus lesson

An entry records the practice that makes a defect class impossible, or caught on the first commit that introduces it. It never records omni-post's remediation. Many of omni-post's gates carry the shape of their history: a ratchet, a quarantine, a touched-files scope, a list of excepted files. Those exist because the defect was already in the tree; on day one there is nothing to grandfather, so the entry states the version with an empty baseline.

Each entry says how omni-post's precedent carries over:

| Carry-over       | Meaning                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| By construction  | The next application makes the defect unrepresentable (a type, a fail-closed default, no escape hatch)       |
| Generalized gate | omni-post's gate, without its repository-specific scope, baseline and exceptions, runs from the first commit |
| omni-post only   | The precedent answers a defect the next application cannot have; the lesson stays, the gate does not         |

### Areas

Entries are grouped under one of these areas, in this order: Repository and toolchain, Architecture, Testing, CI and gates, Security and tenancy, Dependencies, Documentation, AI-assisted workflow. An area gets its heading with its first entry.

### How it grows

The "Foundation practices flow" paragraph of [CLAUDE.md](../../CLAUDE.md) §Documentation Policy is the rule: every unit that adds an ADR, adds or changes a CI gate or fitness check, or demolishes and redoes code records here, in the same pull request, the practice it teaches, or says in the pull request body `none for foundation practices — <reason>`. No check reads this document.

## Architecture

### FP-005 — One composition root from the first route; routes receive their use cases, never the container

- **Practice:** Each deployable has one composition root, and it alone wires concrete adapters. A route plugin receives the use cases it calls as its options; neither a route nor a per-request guard can reach the container, a repository, the database client, an adapter or a provider. Layer rules (dependencies point inward, routes reach only use cases) are enforced by a dependency-rule check whose known-violations baseline is empty on the first commit.
- **Why:** A container referenced outside the composition root is a service locator: it hides a module's dependencies until run time ([ARCHITECTURE_CANON.md](../architecture/ARCHITECTURE_CANON.md) §Dependency Injection, decided in [ADR-0033](../technical/ADR-0033-layer-boundaries-and-composition-root-injection.md)). On 2026-10-15 the shrink-only baseline [`.dependency-cruiser-known-violations.json`](../../.dependency-cruiser-known-violations.json) still holds 75 `routes-no-container` entries, 74 route modules and one route-handler module; the routes workstream sized the conversion at about 15,200 lines of code in 49 slices for 25 route files, plus about 1,670 for the other 51 modules ([MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md) §5.12 and §6). The failure is a run-time one: 22 test harnesses omitted a required option and registered the API metrics token as `undefined`, the container handed that `undefined` back without error, and the brute-force adapter dereferenced it on the customer login path (fitness #43 in [CLAUDE.md](../../CLAUDE.md)).
- **Day-one enforcement:** construction and gate. Construction: the composition root exists before the first route; route plugins and guards are typed to take their dependencies as options; the container is attached to neither the server nor the request; tests build routes through the same wiring, so a missing dependency fails to compile instead of resolving to `undefined`. Gate: the dependency-rule check runs in CI with an empty baseline. Carry-over: by construction for the unreachable container, generalized gate for omni-post's rule set without its baseline.
- **Loosen if:** never: a dependency resolved at run time is one that neither the compiler nor a reviewer sees, the failure fitness #43 caught after the fact.

## Testing

### FP-001 — Each test file has exactly one collector, chosen by its file-name suffix, and that collector runs in a required check

- **Practice:** The file-name suffix decides which runner collects a test (unit, integration, live, end-to-end, load); every runner's configuration excludes the other tiers' suffixes; every runner is mapped to a CI job that is a required check. A test file that no required check runs, or that two runners run, is a failure.
- **Why:** A test no collector runs never executes, while it still reads as coverage in the tree, in review and in a coverage report; a file two collectors run executes under two environments, and its green says nothing about the tier it was written for. At the Testing Refoundation baseline (metric M5), omni-post had 23 orphan test files and at least 10 collected twice, and on 2026-10-14 its quarantine still listed 29 test-shaped files that no required check runs (fitness #30 in [CLAUDE.md](../../CLAUDE.md); "The suffix picks the collector" in [CODING_STANDARDS.md](CODING_STANDARDS.md); [TESTING_REFOUNDATION.md](TESTING_REFOUNDATION.md)).
- **Day-one enforcement:** construction and gate. Construction: the suffix table and a shared exclude list exist before the first test, and every runner configuration takes the list. Gate: a reach check lists every tracked test-shaped file, asks each runner what it collects, maps each runner to the required checks, and fails on a file collected zero or two times; its quarantine (path, reason, owner and date per entry) starts empty and may only shrink. Carry-over: generalized gate, fitness #30's reach engine with an empty quarantine.
- **Loosen if:** never for "exactly once": a test that runs nowhere is not a test. The quarantine is the only exception, one named file at a time, and it may only shrink.

### FP-002 — A test run that collects zero tests fails

- **Practice:** Every test entry point treats an empty collection as a failure. No option that lets an empty run pass exists anywhere in the tree, and a runner that counts an empty file as a pass is wrapped so that zero tests, per file and in total, exits non-zero. Counts come from a machine-readable reporter, never from parsing formatted output.
- **Why:** omni-post's nightly chaos job ran `vitest run tests/chaos/` for the life of its workflow against node:test files that vitest's `include` globs never covered; it collected nothing and reported green over scenarios it never executed. node:test counts a file that registers no test as one passing test, and counts parsed from a formatted report read as zero the day its text changes (fitness #31 in [CLAUDE.md](../../CLAUDE.md)).
- **Day-one enforcement:** gate. A check refuses the pass-with-no-tests opt-out in every tracked manifest, configuration and workflow, and holds the runner wrapper's zero guards and its reporter in place. Carry-over: generalized gate, fitness #31.
- **Loosen if:** never: an empty run cannot be told apart from a broken collection.

### FP-011 — A test double of a dependency's error carries the shape measured on the real dependency

- **Practice:** A test that simulates an error a library or driver raises builds it with one shared fixture per error family, and the fixture reproduces the shape measured by raising that error through the real dependency, with the version and the date of the measurement in its header. No test writes such an error as an object literal from memory or from the dependency's documentation. The code that maps a dependency's error to a typed answer also has one integration test that raises the error through the real dependency, and an upgrade of that dependency re-runs the measurement.
- **Why:** omni-post's repositories recognised a unique-constraint violation by `meta.target`, the field the Prisma 5 and 6 query engine filled. Prisma 7 runs every query through a driver adapter, which reports the constraint at `meta.driverAdapterError.cause.constraint` and never sets `meta.target`: measured on PostgreSQL 16 on 2026-10-15 through 7.9.1 and 7.10.0, four readers never matched, and a team invitation colliding with a soft-deleted member answered 400 "Failed to save team member" instead of its documented 409. Every unit suite over those readers stayed green, because their doubles raised the old shape ([`statefulCustomerUserPrismaFake.ts`](../../apps/api/tests/unit/helpers/statefulCustomerUserPrismaFake.ts) before the fix; the measured fixture [`prismaKnownRequestErrors.ts`](../../apps/api/tests/unit/helpers/prismaKnownRequestErrors.ts); the one reader [`constraintViolation.ts`](../../infra/prisma/src/extensions/constraintViolation.ts); the end-to-end proof [`teamInviteDuplicateEmail.integration.test.ts`](../../apps/api/tests/integration/teamInviteDuplicateEmail.integration.test.ts)).
- **Day-one enforcement:** construction. The error fixtures exist before the first test that needs one, each with its measurement header, and the one reader of each error family is a shared module the repositories import, so a shape change is fixed in one place and caught by the integration test that crosses it. Carry-over: by construction.
- **Loosen if:** never: a double written from memory proves only that the code agrees with the memory, which is how four dead branches read as tested.

## CI and gates

### FP-003 — A gate fails closed when its scope path is missing or its scan read nothing

- **Practice:** Every gate asserts that each path it scans exists before scanning, holds the number of files or items it read against a floor, and exits non-zero, distinctly from a violation, when an input cannot be read. A gate's command line refuses an argument it cannot read, such as a flag given no value or an argument it does not know, as a usage error; it never falls back to a default scope. Every positive scope glob of every test and coverage configuration matches at least one tracked file.
- **Why:** `grep -r` on an absent directory exits 2 and prints nothing, and `| wc -l` renders that as `0`: a green annotation over an invariant nobody measured. omni-post's fitness #2, #3 and #4 spent the whole period after a layer relocation in that state, and #4, both of whose path arguments were gone, scanned nothing at all. The third occurrence of the class created fitness #36: per-glob coverage thresholds kept "gating" two directories after both layers moved, and resolving every test configuration found a glob that matched no file ([CLAUDE.md](../../CLAUDE.md) §Automated Compliance Checks). The fallback is the same class: until 2026-10-16 the reach engine's source-resolution check, given `--root` with no value, read `argv[1] ?? findMonorepoRoot()`, so it checked the whole repository and exited 0 over a scope nobody asked for ([`source-resolution.ts`](../../packages/test-contracts/src/source-resolution.ts); book row SB-123 in [review-suggestions-book.md](../reports/review-suggestions-book.md)).
- **Day-one enforcement:** construction and gate. Construction: one shared helper performs the scope assertions and floors, and another parses a gate's arguments strictly (exit 2 on a usage error); every gate calls both, so a new gate cannot skip them. Gate: the scope-glob check, fitness #36's form, runs from the first test configuration. Carry-over: generalized gate.
- **Loosen if:** never: a gate that reads nothing reports its invariant as held.

### FP-004 — A gate merges only after its red path shows a real non-zero exit

- **Practice:** A new or changed gate merges only after a planted violation made it exit non-zero, the tree was restored byte for byte, and the gate passed again. An error annotation never stands in for an exit code.
- **Why:** An `::error` annotation alone leaves the job green and proves nothing (step 3 of "Extending the suite" in [CLAUDE.md](../../CLAUDE.md); fitness #34 pairs every annotation with an exit in the same step). omni-post's fitness #28, in its old form, required the numeric hop-count spelling of `trustProxy` that a framework release had made dangerous; measured, a `trustProxy: 2` planted in the entry file returned count 0 and passed cleanly, while `trustProxy: true` was caught. A gate that mandates the defect it exists to prevent is worse than no gate.
- **Day-one enforcement:** construction and gate. Construction: every gate is a script with its own test suite, and that suite holds at least one planted violation that must exit non-zero, so the red path is proven again on every run instead of once in a pull request. Gate: a check pairs every error annotation in a workflow with an exit in the same step. The generated skeleton is accepted as the template only when every gate it carries shows this red. Carry-over: generalized gate, the self-tested script form of fitness #30 and #44 to #48 plus fitness #34.
- **Loosen if:** never: a gate whose red was never observed is an assertion nobody measured.

### FP-008 — Every root config a package extends is part of the build cache key

- **Practice:** Every root configuration a package extends is an input of that package's build cache entry. A check derives the set from the `extends` chains, root-to-root links included, and fails when a member is missing from the cache's inputs.
- **Why:** omni-post's build cache hashed each package's own inputs plus a declared global list and nothing else, so a root compiler config a package merely extends was invisible to the hash. Editing it invalidated zero cache entries, and every dependent task replayed a `dist` compiled with the previous compiler settings under a green exit code, a false green reproduced end to end in [CI_CACHE_INTEGRITY_AUDIT.md](../reports/CI_CACHE_INTEGRITY_AUDIT.md) (fitness #33 in [CLAUDE.md](../../CLAUDE.md)).
- **Day-one enforcement:** gate. The extends walk, fitness #33's form, runs from the first shared configuration. Carry-over: generalized gate.
- **Loosen if:** never: a stale cache hit is a false green with no visible signal.

## Security and tenancy

### FP-007 — Tenant isolation fails closed from the first tenant-bearing model

- **Practice:** The data-access tenant guard refuses a model it does not know unless that model is on a documented global list. The migration that creates a tenant-bearing table enables row-level security and its policy in the same file. The application connects as a role that owns no table and carries neither superuser nor bypass-row-security, so the policies apply to it.
- **Why:** omni-post's guard silently skips a model it does not know (fail-open by construction), so `DeletionRecord` landed carrying the tenant column with neither the guard's list nor any documented list knowing it existed (fitness #39 in [CLAUDE.md](../../CLAUDE.md)). Row security arrived in ten separate `add_rls_*` migrations between 2026-05-27 and 2026-09-09, and the policy on every guard-enrolled table (58 when measured) did nothing for the running application: it connected as `postgres`, a superuser with `BYPASSRLS` that owned every table, and with tenant B bound a read of `Project` returned tenant A's rows. The integration suite had proven the policy against a synthetic role, not against the application's ([ADR-0022](../technical/ADR-0022-rls-enforcement-posture.md); [RLS_POSTURE_RED_BASELINE.md](../reports/RLS_POSTURE_RED_BASELINE.md)).
- **Day-one enforcement:** construction and gate. Construction: the guard throws on an unknown model; the first migration creates the application role without those attributes; the migration that creates a tenant-bearing table carries its policy. Gate: a check derives the tenant-bearing models from the schema and requires each one to be enrolled or documented, fitness #39's form; an integration test against the migrated database requires, for every enrolled model, row security on, at least one policy, and no ownership by the application role, the form of omni-post's RLS coverage gate, which is an integration test because catalog state is not greppable ([CLAUDE.md](../../CLAUDE.md) §Automated Compliance Checks). Carry-over: by construction for the guard, generalized gate for the enrollment check and the coverage test.
- **Loosen if:** never: omni-post's canon admits no exception for multi-tenant isolation ([CLAUDE.md](../../CLAUDE.md) §Pragmatic Exceptions), and the next application inherits that rule.

## Dependencies

### FP-009 — A check that derives facts from dependency fields reads a checked list for what the fields cannot say, so no package bends a field to suit it

- **Practice:** A package declares under `dependencies` everything its code loads when it runs, and under `devDependencies` only what its tests, types and build use, whether or not it is ever deployed. A check that derives a fact from those fields, such as which dependencies reach production, takes what the fields cannot say from an explicit list in its own input: one entry per package, with the reason it never reaches production. The check refuses an entry with no reason, a name no private workspace carries, and a package that a production manifest declares outside `devDependencies`, and it counts every declaration a tooling package makes as a tooling declaration, so a workspace that only tooling needs is tooling too.
- **Why:** omni-post's legal subprocessors inventory decided "production" from the fields alone: a workspace counted as tooling only when other manifests declared it, and only under `devDependencies`. Its test-contracts package is private, runs only in CI and is declared by no manifest, so moving the four packages its code loads when it runs (`vitest`, `typescript`, `yaml`, `tsx`) to `dependencies` would have recorded them as production recipients in the legal register, and the package kept them under `devDependencies`: a field written to suit a gate instead of to describe the run. Measured on 2026-10-15, a list naming that package was not enough on its own: once it declared the shared test-configuration workspace under `dependencies`, that workspace stopped counting as tooling and `vitest`, its peer, read as production (fitness #45 in [CLAUDE.md](../../CLAUDE.md); [`subprocessors.mjs`](../../scripts/legal/subprocessors.mjs); the `tooling` list of [`subprocessors.json`](../legal/classification/subprocessors.json)).
- **Day-one enforcement:** construction and gate. Construction: the production-or-tooling derivation reads its list from its first commit, empty, and derives tooling as a fixed point over every declaration a tooling package makes. Gate: the inventory check fails on each refused entry, and its suite plants every refusal and a listed package whose run-time dependencies would otherwise read as production. Carry-over: generalized gate, fitness #45's subprocessors generator with its `tooling` list.
- **Loosen if:** never: a field written to suit one check misstates what the package needs to run, and every other tool that reads the field inherits the error. The list grows only by a reviewed entry with its reason.

### FP-010 — A dependency-freshness gate measures every tool the manifests declare, and holds a code generator in lockstep with the runtime packages it generates for

- **Practice:** A freshness check compares every direct development dependency, the tools that build, test, lint and generate code, with its latest stable release past a maturity buffer, and fails once a lag outlives a fixed budget with no recorded hold. Its population is read from the manifests' `devDependencies` by the check itself, never hand-listed: a tool leaves it only by an entry in the check's own list, with its reason, and that list starts empty. A code-generating CLI and the runtime packages it generates for (an ORM's CLI, its client and its driver adapter) are declared as one family, with the reason they move together, and the check fails when any member resolves to a version its siblings do not, whether an importer declares it or another member resolves it as a dependency or a peer.
- **Why:** omni-post's holds gate measures a hand-kept population of testing and quality tools ([`toolchain-population.json`](../../scripts/testing/toolchain-population.json); [ADR-0036](../technical/ADR-0036-dependency-update-cadence.md)). The Prisma CLI, which generates the database client on every install and in the build stage of all four images, was not in it: 7.10.0 matured on 2026-09-01, its 30-day budget ran out on 2026-10-01, and the tree stayed on 7.9.1 until 2026-10-15 with nothing failing, although the catalog comment had recorded on 2026-10-03 that a newer mature release existed. When the family moved that day, lockfile preference kept the `prisma` 7.9.1 peer of `@prisma/client` 7.10.0 under two importers until the three packages were updated together, a split no manifest shows. Since then the gate measures the CLI's freshness and declares the three as the family `prisma`, which it holds to one version, reading the two production members for equality only; with `@prisma/adapter-pg` planted at 7.9.1 it exits 1 naming that member, its version and its importer. Its population is still hand-kept: a tool added to a manifest is not measured until someone lists it ([`holds-gate.mjs`](../../scripts/testing/holds-gate.mjs), residuals 1 and 3; SB-212 in [review-suggestions-book.md](../reports/review-suggestions-book.md) records the same gap for other families).
- **Day-one enforcement:** gate. The freshness check, with its maturity buffer and budget, runs from the first manifest, reads its population from the manifests' `devDependencies` minus a reasoned exclusion list that starts empty, and fails on a family whose members resolve to two versions; each family is declared in the commit that adds its generator. Carry-over: the family check is a generalized gate, the `families` of omni-post's holds gate as they run; the derived population has no precedent here, because omni-post's population is hand-kept, so the next application builds that part new.
- **Loosen if:** never for the derivation or the family check: a hand-kept population drifts from the tree the moment a tool is added, which is how the Prisma CLI went unmeasured. The budget's length is a recorded decision, as ADR-0036's 30 days are, never a per-package exception.

## Documentation

### FP-006 — Method-level documentation is enforced on every in-scope file from the first commit, not only on touched files

- **Practice:** The documentation rules (a file header, and on every exported function and public method a description, one entry per parameter and the return value) run over the whole tree, at zero, in the same lint pass as every other rule, with no baseline and no touched-files scope. An inline disable comment does not exempt a file.
- **Why:** omni-post's canon required method-level JSDoc and nothing enforced it: measured on 2026-10-10, 35% of public methods carried no JSDoc at all and 31% carried the canon's tag form. The gate that landed on 2026-10-11 holds only the files a pull request touches, in a configuration the ordinary lint run does not load, and the rest waits for a reconciliation still open, which started from 1,028 of 2,134 in-scope files holding 9,648 violations that day (fitness #47 in [CLAUDE.md](../../CLAUDE.md); N-CI-5 and N-CI-6 in [MASTER_PLAN_ES.md](../product/MASTER_PLAN_ES.md) §1).
- **Day-one enforcement:** gate and hook. The rules live in the main lint configuration, so the CI lint run and the pre-commit hook enforce them on every file. Carry-over: generalized gate, fitness #47 without the touched-files scope that answers omni-post's backlog.
- **Loosen if:** a measured sample of the documentation shows a required tag restating the type signature in more than half of its occurrences; that tag's requirement is then dropped by a recorded decision, never the whole rule.
