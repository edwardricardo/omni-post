# Canon Research Index

External sources validated per batch. Consult it BEFORE any new research, to avoid re-investigating.

---

## Code Quality / Dead Code Detection

### knip — recognized canon

- Already documented in commit `e4ccb89` (T1-E revisited). Effective TypeScript 2026 + Vercel adoption.

### jscpd — defaults for TypeScript monorepos

- **URL:** https://github.com/kucherenko/jscpd
- **Summary:** `minTokens: 50`, `threshold: 1` (% duplication), `format: ts/tsx/js/jsx`, ignore `tests/**`, `fixtures/**`, `dist/**`, `.next/**`, `generated/**`, `**/*.stories.tsx`. `exitCode: 1` for a hard fail in CI.
- **Consumed by:** B-tools-1 (2026-05-04) — creation of `jscpd.json` (the previous config was inline defaults).

---

## Security / Authentication

### Brute-force / credential-stuffing protection — OWASP + NIST

- **URLs:** https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html · https://pages.nist.gov/800-63-4/sp800-63b.html (SP 800-63B-4)
- **Summary (canon):** NIST **SHALL** = rate-limiting of failed attempts per account (it prefers throttling over a hard lockout: a high threshold ~100 + progressive delays + IP throttle + CAPTCHA). OWASP: the failure counter is associated with the **ACCOUNT, not the IP** (attackers rotate IPs; IP only as a supplementary throttle, watch out for NAT/shared addresses); lockout with auto-expiry or an **exponential** duration, **DoS**-aware (allow forgot-password even while locked); **CAPTCHA** after a few failures (defense-in-depth, not preventive); **MFA** = defense #1 (99.9% per Microsoft).
- **Consumed by:** B2 of the prisma→DI marathon (2026-05-24) — audit of the 3 divergent implementations (admin Prisma / customer rate-limit-only / orphan Redis). Homologation design in `docs/security/BRUTE_FORCE_HOMOLOGATION_ES.md` (workstream BF-HOMOLOG, backlog SMELL-35).

---

## A11y / E2E

### @axe-core/playwright — canonical helper pattern

- **URL:** https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
- **Summary:** `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa"]).analyze()` returns `{ violations: Violation[] }`. Canonical pattern: a helper file `tests/e2e/utils/a11y.ts` reusable by specs. Filter by `impact in ["serious","critical"]` so as not to fail on minor/moderate noise.
- **Consumed by:** B-tools-1 (2026-05-04) — `apps/admin/tests/e2e/utils/a11y.ts` mirrors the pattern already implemented in `apps/client/tests/e2e/utils/assertions.ts`.

---

## Visual Regression

### reg-suit — storage backend (`reg-publish-github-plugin` does NOT exist)

- **URL:** https://github.com/reg-viz/reg-suit
- **Summary:** the reg-suit canon has official plugins: `reg-publish-s3-plugin`, `reg-publish-gcs-plugin`, `reg-publish-fs-plugin`. There is **NO** official plugin for "snapshots in a branch of the repo". `reg-notify-github-plugin` only notifies via a PR comment; it does not store. The storage decision is a prerequisite for wiring reg-suit.
- **Consumed by:** B-tools-1 (2026-05-04) — reg-suit DEFERRED to PR-48 (storage decision pending).

---

## Git Hygiene

(previous references — T1-C canon revisited, commit `57e3c30`)

---

## Logging / Observability

(previous references — apps/api/src/lib/logger.ts canon — see CLAUDE.md §Logging)

---

## Routing / Navigation / UI Modals

### Next.js useRouter — current canon (v15/v16)

- **URL:** https://nextjs.org/docs/app/api-reference/functions/use-router
- **Summary:** `<Link>` is the default for declarative nav. `useRouter().push()` for programmatic nav after a mutation. `window.location.href = ...` is legitimate for external redirects (Stripe, OAuth) — a false positive if the URL points to a third party (PR-9 documents the 4 valid sites).
- **Consumed by:** original T2-E (2026-04-23) + canon revisited (2026-05-04) — confirmed current, no canon changes.

### React declarative UI — alert/prompt/confirm replacement

- **URL:** https://react.dev/learn/managing-state
- **Summary:** state-driven UI (Dialog primitives) is canon. The native `alert/prompt/confirm` break accessibility (no focus trap, no aria-modal, no custom Escape) and block the event loop. Replace them with controlled components (`<Dialog>`, `<ConfirmDialog>`, `<InputDialog>`).
- **Consumed by:** original T2-E (2026-04-23) — complete migration in apps/client + apps/admin. T2-E canon revisited (2026-05-04) confirms 0 residuals.

### WAI-ARIA APG Modal Dialog

- **URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **Summary:** `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + Escape + focus trap + focus return on close. The Radix Dialog primitive complies out of the box; do not invent custom modals.
- **Consumed by:** T2-E (2026-04-23) — `ConfirmDialog.tsx` + `InputDialog.tsx`, moved to packages/ui, use Radix internally.

---

## CI / Build Caching

### Turborepo configuration — env + globalEnv + outputs

- **URL:** https://turborepo.com/docs/reference/configuration
- **Summary:** per-task `env` declares the vars that enter the cache hash. NOT declaring = cache poisoning. `globalEnv` applies to all. An empty `outputs` caches only logs. `globalDependencies` for files that affect the whole build.
- **Consumed by:** original T2-F (2026-04-23) + canon revisited (2026-05-04) — confirmed current: globalEnv + 5 canon-aligned task env declarations.

### GitHub Actions caching — hashFiles + restore-keys

- **URL:** https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows
- **Summary:** the key must use `hashFiles(lockfile)` for automatic invalidation. Staggered `restore-keys`. Without this, false hits, or it never hits.
- **Consumed by:** T2-F (2026-04-23) — the local composite action `./.github/actions/setup-node-pnpm-cache` implements the pattern. T2-F canon revisited (2026-05-04) detected 1 job (secretlint, introduced by B-tools-2) that re-implemented the setup by hand with no cache — fix applied.

### size-limit — fail on threshold exceed, never swallow with `|| true`

- **URL:** https://github.com/ai/size-limit
- **Summary:** size-limit exists specifically to fail CI when the bundle exceeds the declared threshold. `pnpm exec size-limit > out.json || true` neutralizes the purpose. Canonical pattern: separate the fail-check from the JSON capture in distinct steps.
- **Consumed by:** T2-F canon revisited (2026-05-04) — fix of `audit.yml:235` with an `|| true` that had existed since commit `fd256a2` (it was not a regression; the original T2-F only audited ci.yml).

---

## Error Handling / Result<T,E>

### neverthrow / Result<T,E> canon — current

- **URL:** https://github.com/supermacro/neverthrow
- **Summary:** the `Result<T, E>` pattern. Throws are OK at boundaries with libs (e.g., crypto, HTTP) and for exceptional conditions. NO throw in domain/application — propagate via Result. The custom Result in `packages/shared/src/types.ts:71-76` is the repo's SoT (`Ok<T> | Err<E>` + the helpers `ok`, `err`, `isOk`, `isErr`, `unwrap`, `unwrapOr`).
- **Consumed by:** original T2-G (2026-04-23) + canon revisited (2026-05-04) — confirmed current, no canon changes. Fitness #4 is still clean (0 raw throws in domain/application).

### DomainError hierarchy — apps/api/src/domain/errors/DomainError.ts

- **URL:** internal — `apps/api/src/domain/errors/DomainError.ts`
- **Summary:** an abstract `DomainError` + typed subclasses (`InvariantViolationError`, `EntityNotFoundError`, `InvalidValueError`, etc.). Reuse the hierarchy in use cases — do NOT create redundant errors (e.g., `PricingError` when `InvariantViolationError` applies).
- **Consumed by:** T2-G (2026-04-23) — PricingCalculator uses `InvariantViolationError`. Canon revisited (2026-05-04) confirms it is still current.

### Boundary-throw patterns — legitimate in the infrastructure layer

- **Summary:** `if (!result.ok) throw AppError.externalService(...)` in `apps/api/src/ai/aiService.ts` and `if (!result.ok) throw new Error(...)` in `apps/api/src/saga/SagaIntegration.ts` are canon-aligned: they convert a Result into a throw at the layer boundary (HTTP error handler / queue worker reject). Do NOT confuse them with the Result-then-throw anti-pattern inside domain/application.
- **`as Result<X, E>` casts in application use cases:** 9 canon-aligned sites with the Unit of Work pattern documented in [CLAUDE.md §Unit of Work] — `let result: Result<X, E> = ok(undefined) as Result<X, E>;` is required for mutation inside `unitOfWork.executeInTransaction`.
- **Consumed by:** T2-G canon revisited (2026-05-04) — clarification of the legitimate boundary-layer patterns detected during the audit.

---

## UI / Empty-State Design

### Nielsen Norman empty-state guidance

- **URL:** https://www.nngroup.com/articles/empty-state-interface-design/
- **Summary:** an honest empty state = real status + contextual message + CTA. Never a misleading placeholder (fake metrics, hardcoded scores, model-name labels that do not reflect the current model). Applies to metrics, empty lists, loading states, fallback content.
- **Consumed by:** original T2-H (2026-04-23) — removed fake metrics/scores/model names. T2-H canon revisited (2026-05-04) confirmed the canon is current; it detected orphan dead-types debt + 4 fields planned for client.

### Dead code detection — 3-questions gate (internal canon)

- **URL:** internal — `~/.claude/projects/.../memory/feedback_three_questions_before_delete.md`
- **Summary:** BEFORE declaring code orphaned and removing it, answer explicitly: **(Q1)** What is it? (type, purpose declared in the JSDoc, signature). **(Q2)** What was it supposedly created for? (original intent, business value). **(Q3)** Does anything currently do what it is supposed to do? (real consumers + alternative functionality + feature roadmap). Decision rule: Q3=NO+no roadmap → safe remove; Q3=NO+could-be-a-pending-feature → AskUserQuestion; Q3=YES → it is not dead.
- **Consumed by:** T2-H canon revisited (2026-05-04) — the Maintainer added it to the `pre_delete_gate` preflight. Applying it avoided the wrong removal of 4 fields that turned out to be features planned for client (migrate done + 3 backlog entries instead of a delete).

---

## Architecture / Hexagonal monorepo — code distribution

### Explicit Architecture (Graça) + domain-driven-hexagon (Sairyss) + Composition Root (Seemann) + Nx library-first

- **URLs:**
  - https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/
  - https://github.com/Sairyss/domain-driven-hexagon
  - https://blog.ploeh.dk/2011/07/28/CompositionRoot/ · https://blog.ploeh.dk/2019/06/17/composition-root-location/
  - https://dev.to/artnikbrothers/the-8020-library-first-monorepo-why-your-apps-should-be-almost-empty-1gom · https://nx.dev/blog/virtuous-cycle-of-workspace-structure
- **Summary (backend-flavored canon):** Application Core = Application layer (use cases + **ports**) + Domain layer
  (entities/VOs/events/services). _"Ports belong inside the business logic, adapters belong outside"_ (Graça);
  dependencies point inward; **a single core for multiple entry points** (HTTP, queue, CLI). Concrete TS layers:
  domain (entities/aggregates/VOs/domain events/errors + repository ports), application (use cases/handlers/DTOs),
  interface (controllers + HTTP DTOs), infrastructure (repo impls/adapters/ORM) — Sairyss. **One composition root per
  executable**, at the entry point; the DI container does not leak into the core — Seemann. **Apps = deployment
  containers, not code containers**; logic lives in libs; boundaries **enforced**, not by convention — Nx library-first
  (backend: Graça/Sairyss/Seemann rule; Nx informs the packaging).
- **Verification:** a real WebFetch of all 4 (2026-05). Graça/Sairyss/Seemann = literal quotes confirmed; Nx 80/20 = a
  frontend-flavored source (the packaging applies, not the feature/ui/state taxonomy).
- **Consumed by:** the Option A decision (core→`packages/@core`) + the target graph in
  [`docs/architecture/TARGET_ARCHITECTURE_CANON_ES.md`](https://github.com/edwardricardo/omni-post/blob/0086df48af32db3980680158e8b76ada41358dbf/docs/architecture/TARGET_ARCHITECTURE_CANON_ES.md) (2026-05; removed from the repository on 2026-10-17; git history keeps it, and the link is its last version). There is a legitimate canonical debate: modular monolith /
  in-process consumers (Option B, used to resolve DUP-01/02) is canon too — both ends of the
  decoupling↔simplicity spectrum.

---

### Config injection into use-cases — Composition Root + Primitive Dependencies (Seemann/van Deursen)

- **URLs:**
  - https://blog.ploeh.dk/2011/07/28/CompositionRoot/
  - "Dependency Injection Principles, Practices, and Patterns" (Seemann & van Deursen) — the _Primitive Dependencies_ pattern
  - https://khorikov.org/posts/2019-07-31-commands-primitives/ (primitives cross boundaries)
- **Summary:** an application use case that needs a configuration value (base URL, model name, connection
  string) must **NOT** inject a broad configuration object (an `IConfiguration`/`AppConfig` god object) — that is a
  **Service Locator** smell that hides the consumer's real dependencies. The **Composition Root** (the only place
  that reads the typed/validated config) resolves and **injects the specific values as primitives** by constructor
  (_Primitive Dependencies_). The domain stays pure (Khorikov): no DI and no config; values cross as primitives/DTOs.
- **Verification:** WebSearch 2026-05 (DEV/Clean-Arch sources + ploeh + khorikov.org); the Primitive
  Dependencies pattern and the broad config-object anti-pattern confirmed.
- **Consumed by:** A6.1 (2026-05-25) — removing `config/env` from 5 use cases by injecting `clientUrl` /
  `embeddingModel`+`embeddingDimensions` from `setup*.ts`; NO `AppConfigPort` was created. It applies to the other
  A6 sub-phases that need to inject config (not service ports).

---

## Verification Audit Log

### Verification-by-fetch 2026-05-04 (retroactive)

The 4 batches T2-E/F/G/H of 2026-05-04 were attested as `r2_canon_exhaustive: yes` WITHOUT a real fetch of the canonical URLs — it was use of general knowledge, NOT direct consultation. The Maintainer detected the process failure and requested a retroactive verification. The fetches were run after commit `e36e8aa`, and the findings are documented here for transparency + honest rules 2/3 going forward.

| Canon URL                                              | Fetch result           | Exact quote confirmed                                                                                                          | Notes                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nextjs.org/docs/app/api-reference/functions/use-router | ✅ v16.2.4 current     | YES — `<Link>` recommended, useRouter for programmatic                                                                         | No disruptive new patterns                                                                                                                                                   |
| react.dev/learn/managing-state                         | 🟡 implicit            | NO — the guide does not explicitly forbid alert/prompt/confirm                                                                 | My attestation was a canonical interpretation, not a literal quote of the official doc                                                                                       |
| w3.org/WAI/ARIA/apg/patterns/dialog-modal/             | ✅ current             | YES — role/aria-modal/labelledby/focus-trap/Escape/return                                                                      | ARIA 1.1 established, no updates after 2024                                                                                                                                  |
| turborepo.dev/docs/reference/configuration             | ✅ + 🆕                | YES — per-task env, globalEnv, outputs[]                                                                                       | **NEW, not documented in T2-F:** `globalConfiguration`, `filterUsingTasks`, `watchUsingTaskInputs`, experimental OTEL observability                                          |
| docs.github.com/en/actions/.../caching-dependencies    | ✅ basic pattern       | YES — hashFiles + restore-keys                                                                                                 | The doc fetch does not mention immutable cache/attestations — they may exist in other chunks                                                                                 |
| github.com/ai/size-limit                               | ✅ + 🟡                | YES — `\|\| true` neutralizes enforcement                                                                                      | **My fix of separating the fail-check from the JSON capture is a decision beyond the docs** (a correct interpretation of the spirit, not a pattern documented in the README) |
| github.com/supermacro/neverthrow                       | ✅ current             | YES — Result<T,E>, boundary throws OK                                                                                          | v8.2.0 Feb 2025, no breaking changes. Stable APIs                                                                                                                            |
| nngroup.com/articles/empty-state-interface-design/     | 🟡 3 pillars confirmed | PARTIAL — the 3-pillar guidance (status + contextual + CTA) confirmed; "no fake metrics/scores" is NOT explicit in the article | The article is Kaplan 2021, with no later updates. My attestation of "guidance against fake metrics" was a canonical interpretation of the spirit                            |

### Turborepo future flags — backlog candidate

- **Detected during the 2026-05-04 verification:** turborepo.dev/docs documents features I did NOT consider in T2-F:
  - `globalConfiguration`: an experimental flag for shared task config
  - `filterUsingTasks`: filter the dependency graph by task patterns
  - `watchUsingTaskInputs`: watch mode with input granularity
  - experimental **OTEL observability**
- **Suggested action:** open a backlog entry to evaluate adopting the relevant flags (especially OTEL, which connects with the repo's observability stack).
- **Status:** documented here. Not yet tracked as a PR — waiting for the Maintainer's decision.

### Process correction — going forward

- **Before declaring `r2_canon_exhaustive: yes`** in any future batch: run a real WebFetch of every cited URL. Summarize the exact quote vs the interpretation.
- **Honest attestation:** distinguish "a literal quote of the canon" from "a canonical interpretation of the spirit". Both can be valid, but they must be marked differently.
- **When a WebFetch reveals drift** (new canon, breaking changes, dead URLs): document it here + open a backlog entry if it requires adoption.
