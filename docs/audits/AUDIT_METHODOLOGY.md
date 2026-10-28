---
title: Full-repo audit methodology
description: Methodology applied in the F5 audit of 2026-05-10/11. A structured inventory of 1477 files across 5 parallel surfaces, with a uniform template and reproducible detection rules.
generated: 2026-05-11
auditor: claude-code
---

# Full-repo audit methodology

> A **reusable** methodology document for a full-repo audit (template + 6 verdict rules + A-E workflow). It captures **how an audit is done** — not the results. (The outputs of the F5 run of 2026-05-11 — INVENTORY_SUMMARY, \_AUDIT_FINDINGS, inventory-\* — were retired after being absorbed into `docs/product/MASTER_PLAN.md`; this doc stays as the methodology for re-auditing.)
>
> This document must let a future auditor (human or agent) repeat the exercise on a later version of the repo and obtain comparable results.

---

## 1. Context and motivation

OmniPost started with `admin` and `client` as a single application. Later an architectural split into two distinct Next.js apps was made, but it was never formally confirmed that:

- The double implementations had been corrected.
- No residual dead code was left from the split.
- The features developed during the transition had been mapped (unmapped → possible duplication or ghost features).

Inherited debt added to this: 4 apps + ~13 sub-packages + 11 social providers + ~250 DI tokens + 70+ REST endpoints + sagas + workers. The Maintainer's concrete operational question was: **what is really in the repo, what does it do, what is duplicated, what is dead, what is implemented but not exposed?**

The F5 audit answers that question as an **evidence-first inventory**, not as a sweep of fixes. It does not touch source code. It only reads + classifies + writes output documents.

## 2. Guiding principles

1. **Evidence first, judgment later.** Every finding is anchored to a path + line, not to intuition. Every verdict comes with the rule that triggered it.
2. **Uniform template across surfaces.** The inventories of the 5 surfaces (`api`, `workers`, `admin`, `client`, `packages`) use the same per-file format, which allows a later mechanical consolidation.
3. **Parallelism when possible.** 4 inventories run simultaneously in the background after the format is validated with one in the foreground. It cuts wall-clock from ~110 min sequential to ~25 min real parallel.
4. **Conservative default.** The default verdict is `VALID`. DEAD / REDUNDANT / FORGOTTEN-FEATURE / MISMATCH is marked only when there is clear mechanical evidence.
5. **Historical memory preserved.** Before deleting obsolete documentation (REMEDIATION_ROADMAP, POST_BACKLOG, 130 closed sprint reports), the non-obvious facts are captured in the assistant's persistent memory, so the audit does not re-classify as dead code what is intentional scaffolding, reversible deletions, monetizable features in flight, or dependencies the Maintainer explicitly declined.
6. **Iteration by surface.** A surface is inventoried completely before moving on to the next. It avoids context switching and allows rules to be cross-validated as they are applied.

## 3. Prerequisites before starting

Before the first inventory, run in order:

1. **Cleanup of obsolete documentation.** Generate `docs/_DOCS_INVENTORY.md`, classifying every `.md` under `docs/`. Delete the ones marked `ARCHIVE` + `DELETE`. This keeps the audit from having to cross-check against documents whose authority has already expired.
2. **Capture of historical context.** Read the master documents that are going to be deleted (in this case REMEDIATION_ROADMAP.md + POST_REMEDIATION_BACKLOG.md) in full and extract **non-obvious facts** that cannot be derived by reading the code:
   - Intentional scaffolding (e.g. `packages/providers/_template/`)
   - Deletions reversible by design
   - Domain naming gotchas (e.g. `Project` ≈ "subaccount")
   - Dependencies the Maintainer explicitly declined
   - Monetizable features in flight (e.g. tier-gated `EventSnapshot`)
   - Decisions taken in past sessions that affect how the code is interpreted

   These facts are saved to the assistant's persistent memory (`memory/project_historical_context.md`). Then the original docs are deleted.

3. **Green CI (minimum viable).** Before auditing, merge or consolidate work in progress so the audit starts from a stable `main`. In this session: merge PR #57 (saga canon retrofit + 14 CWE-639/862/863 security fixes + CI Prisma fix + docs cleanup).
4. **Parallel branches closed.** Do not audit while the same team has open PRs — the code moves under your feet. Close / merge / abandon before auditing.

## 4. Structure of surfaces

5 orthogonal surfaces that cover the monorepo:

| Surface    | Root path           | Focus                                                                                    |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `api`      | `apps/api/src/`     | Fastify backend: routes, use cases, domain, infra, CQRS, sagas, security, features       |
| `workers`  | `apps/workers/src/` | BullMQ workers, processors, recovery, metrics                                            |
| `admin`    | `apps/admin/`       | Next.js staff portal: pages, components, hooks, lib                                      |
| `client`   | `apps/client/`      | Next.js tenant portal: pages, components, hooks, lib                                     |
| `packages` | `packages/*/src/`   | Ports, providers (11), adapters, shared, ui, observability, monitoring, api-common, core |

Tests (`*.test.ts`, `tests/`) were **NOT** inventoried in this audit. They can be a sixth surface if coverage is to be validated.

## 5. Per-file template (uniform)

Every inventoried file produces a block with this shape:

```markdown
### audit-<SURFACE>-<NNN> — <title ≤8 words>

- **Path:** [path/file.ts](path/file.ts)
- **Surface:** api | workers | admin | client | packages
- **Type:** route · use-case · query-handler · command-handler · domain-entity · value-object · aggregate · domain-event · repository-port · repository-impl · saga-definition · saga-step · processor · middleware · DI-tokens · DI-container · security · provider · service · adapter · types · barrel · index · config · observability · page · layout · route-handler · component · hook · lib · store · provider · port-interface · adapter-impl · provider-adapter · provider-apiClient · ui-component · ui-hook · ui-primitive · logger-factory · scheduler · circuit-breaker · health-check · base-route
- **@layer declared:** domain · application · infrastructure · MISSING · INVALID:<value>
- **Actual purpose:** <one sentence — what the code does, NOT what the JSDoc says>
- **Exports / endpoints / handlers:** <exported symbols, HTTP method+path, public methods>
- **Significant imports:** <only cross-package / cross-app, not relative ones>
- **API endpoints consumed (frontend only):** <list of fetch / hook invocations that fan out to endpoints>
- **Admin counterpart? (client only):** <path of the equivalent in apps/admin/ if one exists>
- **Wiring detected (backend only):** <registered in Container? Route registered in index.ts? Processor spawned?>
- **Callers / Consumers:** <rg result capped at 5 lines, or "widely used">
- **Preliminary verdict:** VALID · REDUNDANT · DEAD · FORGOTTEN-FEATURE · MISMATCH · UNKNOWN
- **Notes:** <short bullets — duplications, mismatches, broken imports, raw fetch, unused exports, anti-patterns>
```

The `Wiring`, `API endpoints consumed` and `Admin counterpart` fields are turned on according to the surface.

## 6. Verdicts and detection rules

Each verdict is assigned ONLY if its rule is met. No evidence → default `VALID` (or `UNKNOWN` if the doubt persists).

### 6.1 VALID

It has callers / wiring. It has no obvious smells. Its JSDoc is consistent with the code.

### 6.2 REDUNDANT

Another file in the repo exists with a ≈ identical purpose:

- In the same surface (e.g., two repositories for the same entity).
- Cross-surface (e.g., `apps/admin/lib/X.ts` ↔ `apps/client/lib/X.ts` with the same signature and ≥80% diff overlap).

To confirm cross-surface, run `ls apps/<other>/<same-path>` or `find apps -name "<filename>"`. If a counterpart shows up, run `diff` to confirm the similarity before marking.

### 6.3 DEAD

Exported but with **no caller** in the repo:

- `rg -t ts "import.*\b<symbol>\b" apps packages` → 0 results (excluding the file itself and tests).
- For routes: it is NOT registered in `apps/api/src/index.ts` or in any feature router.
- For processors: it is NOT spawned via `new Worker(queueName, processor)` in `apps/workers/src/index.ts`.
- For DI bindings: it does not appear in `Container.ts`.

### 6.4 FORGOTTEN-FEATURE

The implementation exists + works locally, but an intermediate link is missing:

- A use case implemented and tested, but no route exposes it.
- A route exists but no UI consumes it.
- A UI implemented that calls an endpoint that returns 501 / does not exist.
- A worker implemented but the Dockerfile CMD does not start it → jobs queued with no consumer.
- A cron task implemented but not registered in `BackgroundTaskScheduler`.
- A feature flag wired but permanently `false`.

It is different from DEAD: the code is complete but **something upstream or downstream blocks its use**.

### 6.5 MISMATCH

An internal contradiction that can be detected mechanically:

- The frontend calls `fetch("/api/X")` and `/api/X` does not exist in the route table.
- The frontend calls an admin endpoint (`/admin/...`) from a customer-facing surface (auth fails deterministically).
- A repository impl exists but the port binding points to another class.
- The `@layer` header says `application` but the path is `apps/api/src/infrastructure/...`.
- A TypeScript type exported for an API response does not match what the handler returns.
- A worker expects payload shape `X` but the producer sends shape `Y`.

### 6.6 UNKNOWN

Used **sparingly**. Reserved for:

- Files that look alive but whose wiring cannot be verified (DI factory dispatched, dynamic imports, callback patterns that tree-sitter does not resolve).
- Implementations whose integration needs a deep reading of >3 cross-referenced files.

An aggressive default to UNKNOWN dilutes the audit. If in doubt, prefer VALID + a note in `Notes:` explaining the doubt.

## 7. Operational workflow

### Phase A — Inventory (foreground + parallel)

1. **Pilot surface in the foreground.** Choose the most informative surface (in this session: `admin`, because it was the center of the Maintainer's concern about duplication). Run an agent with the full template and the criteria. Review the formal output: is the enumeration complete? are the verdicts reasonable? is there a balance between VALID and the others? If something is off, adjust the template before launching the rest.
2. **The 4 remaining surfaces in parallel (background).** Launch them in a single response, with `run_in_background: true`. Each agent:
   - Receives the identical template
   - Receives the identical detection criteria
   - Receives the **memory references** specific to its surface (things it must NOT mark as dead)
   - Writes to `docs/audits/inventory-<surface>.md`
   - Reports a summary of ≤200 words at the end
3. **Automatic notification.** As each one finishes, a task notification arrives. Progress is reported to the Maintainer without active polling.

### Phase B — Cross-surface mapping (mechanical)

Cross the 5 inventories to detect relationships that no single-surface agent can see:

- **UI → endpoint:** for each `fetch("/api/X")` in client/admin, verify that `/api/X` exists in `inventory-api.md`. What does not exist → MISMATCH / FORGOTTEN-FEATURE.
- **Use case → route:** for each use case in `inventory-api.md` with a VALID verdict, verify that some route invokes it. A use case with no invoking route → potential FORGOTTEN-FEATURE.
- **Route → use case:** routes that import a use case never registered in DI → MISMATCH.
- **Port → adapter:** ports with no implementing adapter → FORGOTTEN-FEATURE.
- **Adapter → port:** adapters with no port binding → DEAD or MISMATCH.
- **Worker queue → producer:** each declared queue must have a producer in `apps/api` or in another worker. Orphan queues → DEAD.
- **admin↔client duplication:** the same file name in both apps → a candidate for consolidation into `packages/`.

### Phase C — Consolidated findings (item by item)

Take all the non-VALID findings from the 5 inventories + from phase B and catalog them in a single document (`_AUDIT_FINDINGS.md`). Each item:

```markdown
### audit-FN-NN — <title>

- **Category:** dead-code / forgotten-feature / duplication / mismatch / drift / superseded / canon-deviation
- **Surface(s):** ...
- **Evidence:** <paths + grep results>
- **Auditor's honest recommendation:** DELETE-NOW / WIRE-BACKEND / WIRE-UI / CONSOLIDATE-TO-PACKAGE / DECIDE / FIX-NOW
- **Candidate action:** <concrete steps>
- **NEEDS_PRODUCT_OWNER:** yes/no (does it need a product decision?)
- **Blocked by:** <other audit-FN-NN if applicable>
```

### Phase D — Point-by-point review with the Product Owner and the Maintainer

The Product Owner and the Maintainer review each `audit-FN-NN`. They mark:

- ✅ APPROVE — run the candidate action
- ❌ REJECT — the finding is a false positive; why is documented
- 🔄 CHANGE-ACTION — the candidate action is not the right one; the alternative is documented
- ⏸️ DEFER — valid but not now; it gets scheduled

Phase D output: a list of APPROVED actions ordered by blocker. That list is the execution plan.

### Phase E — Execution

Each APPROVED action is executed as one cohesive commit. Branch strategy according to volume.

## 8. Tooling used

| Tool                                                                 | Purpose                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `find <path> -type f -name "*.ts" -not -path "*/node_modules/*" ...` | Enumerating files per surface                                                   |
| `head -25 <file>`                                                    | Reading the JSDoc header + first imports (>90% of files are classified by this) |
| `head -80 <file>`                                                    | When the first 25 do not reveal the purpose                                     |
| `rg -t ts "import.*<symbol>" apps packages \| head -10`              | Caller detection (capped)                                                       |
| `rg -t ts "from \"@<package>/<name>\"" apps packages`                | Cross-package consumer detection                                                |
| `gh run view <id> --log-failed`                                      | For parallel CI audits                                                          |
| `git diff --stat <branch1>..<branch2>`                               | To confirm changes between PRs before merging                                   |
| `git ls-files --error-unmatch <file>`                                | To validate that files to delete are tracked before `git rm`                    |

## 9. Time budgets per surface

Empirical in this session (average overhead of a general-purpose agent):

| Surface                       |    Files | Time        |
| ----------------------------- | -------: | ----------- |
| `admin` (foreground pilot)    |      180 | ~10 min     |
| `workers`                     |       13 | ~5 min      |
| `client`                      |      226 | ~10 min     |
| `api`                         |      823 | ~17 min     |
| `packages`                    |      235 | ~8 min      |
| **Total parallel wall-clock** | **1477** | **~25 min** |
| Estimated sequential total    |        — | ~50 min     |

Total output: ~5 `inventory-<surface>.md` files, ~5000-6000 lines of markdown added.

## 10. Historical memory — how not to misclassify

Before running the audit, the following facts were loaded into persistent memory to avoid false positives. Any future audit must review `memory/project_historical_context.md` or an equivalent before starting:

| Category                       | Examples                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intentional scaffolding        | `packages/providers/_template/` — env reads + raw pino are intentional, to teach the pattern. Fitness checks #15/#19 explicitly exclude this path.                                |
| Reversible deletions           | `apps/admin/providers/ProjectProvider.tsx` (T3-M 2026-04-29). A future `ClientProjectsView` with a SUPER_ADMIN gate would be a distinct entity — do not revive this one.          |
| Domain naming                  | `Project` entity = "subaccount" in the Product Owner's mental model. Renaming `Project → Subaccount` is debt.                                                                     |
| Declined dependencies          | `reg-suit` (2026-05-04 and 2026-05-07), `clinic.js` permanently (2026-05-07). Do NOT propose reinstalling them.                                                                   |
| Monetizable features in flight | Tier-gated `EventSnapshot` (basic 30d / pro 90d / ent 180d+); permission `CONTENT_SNAPSHOT_MANAGE`. Do NOT mark it as dead.                                                       |
| Recent rewrites                | `apps/client/app/dashboard/channels/page.tsx` rewritten 2026-05-07 (PR-16). The disabled "Test"/"Settings" actions were removed intentionally.                                    |
| Known documented debt          | `apps/client/components/ai/AITemplateSelector.tsx` — engagement/readability/virality fields wired with no backend (PR-53/54/55). Mark it FORGOTTEN-FEATURE with an explicit note. |
| Reserved for a migration       | Files in `apps/client/components/publishing/` may be reserved for the T6-D selective rescue (`ContentPreviewSystem`, `provider-previews`). Do NOT blanket-flag them as dead.      |

## 11. Structural output

```
docs/audits/
  AUDIT_METHODOLOGY.md       ← this document
  INVENTORY_SUMMARY.md       ← aggregated summary of the 5 inventories
  _AUDIT_FINDINGS.md         ← consolidated findings item by item, with a recommendation
  inventory-api.md           ← 992 lines, 823 files
  inventory-admin.md         ← 180 files
  inventory-client.md        ← 226 files
  inventory-workers.md       ← 13 files
  inventory-packages.md      ← 235 files
```

The 5 `inventory-*.md` files are **inputs**. `INVENTORY_SUMMARY.md` is the **digest**. `_AUDIT_FINDINGS.md` is the **workbench** for phase D (the point-by-point review).

## 12. Caveats and known false positives

1. **Tree-sitter is blind to dynamic dispatch.** If a symbol is resolved via a DI factory, a dynamic `import()`, a callback registry, or a switch-by-string, `rg` does not detect it as a caller. False DEADs can come up. Mitigation: cap at UNKNOWN for cases where DI factory dispatch is plausible (especially CRM adapters, storage adapters).
2. **Re-exports propagate noise.** An export in an `index.ts` barrel can have 50 callers while none of them touches the original file. If the barrel counts as a caller, the file is not DEAD even if conceptually nobody uses it directly. Solution: when a file only has barrel callers, mark it VALID but document it in the notes.
3. **Tests can hide real usage.** A class used only in tests is NOT VALID in production — it is FORGOTTEN-FEATURE or DEAD. Filter `rg` with `--type-not test` when it matters.
4. **Worker queues can have producers in sagas.** Not only in routes. Also check `apps/api/src/saga/**` when a queue looks orphaned.
5. **Feature flags turn callers on and off.** A caller wrapped in `if (env.FEATURE_X)` can be dormant. This requires reviewing `apps/api/src/config/env.ts` for the feature flag values in each deployment.

## 13. Reproducibility

To repeat this audit on a future version of the repo:

1. Verify a clean branch (`git status` → 0 uncommitted).
2. Read `docs/audits/AUDIT_METHODOLOGY.md` (this document) and `memory/project_historical_context.md`.
3. Re-generate `docs/_DOCS_INVENTORY.md` with the methodology documented above.
4. Run 5 inventories (1 foreground pilot + 4 parallel in the background) with the templates and rules of §5-§6.
5. Generate a new `INVENTORY_SUMMARY.md` and `_AUDIT_FINDINGS.md`.
6. Compare against the previous ones. The differences are the evolution of the repo between audits.

Periodic audits (every 3-6 months) detect drift.
