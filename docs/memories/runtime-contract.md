---
name: feedback-runtime-contract
description: "Edward's runtime + frontend-backend contract canon: verify at runtime, MSW canon, frontend follows backend"
metadata:
  type: feedback-canon
  owner: edward
  loaded: every-session-via-claude-local-md
---

# Runtime Verification & Frontend-Backend Contract

> Personal canon: how to verify code actually works at runtime (not just compile +
> test), the rules for client-tests (MSW v2 vs vitest vs Playwright), and the
> directional contract between frontend and backend.
> Auto-loaded via `@~/.claude/feedback/runtime-contract.md` in `CLAUDE.local.md`.

**Owner:** Edward
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Rule: Frontend couples to backend, never the reverse

**The fundamental principle (Edward 2026-05-20):** Frontend must always couple to backend. Backend never couples to frontend. Frontend always adjusts to backend; backend is the solid part of the project.

**Why:** Backend is where features are modeled and decisions of canon are made (CQRS DTOs, domain, aggregates, outbox). Frontend is the mutable view that must respect that authority. When frontend anticipates a future server contract that doesn't exist, results are functionally broken when the real canon differs (2026-05-20, F0-CLI-2 before rewrite: `ConversationListItem.unreadCount` undefined in runtime because server returned flat `SocialMessageDTO`, not anticipated shape).

**How to apply:**

- Mismatch of contract (TS types, response shapes, enum values, naming) → **client adjusts**. No server transforms, no shims, no invented DTOs.
- DTOs from server (`SocialMessageDTO`, `RepurposeProposalDto`) are the source of truth. Client types mirror 1:1.
- Need a projection/aggregate server doesn't deliver? (e.g., "unreadCount") → new query server-side, not client aggregation.
- Divergence makes frontend temporarily lack a feature? → goes to backlog as feature gap, not patched client-side.
- **Antipatterns**: ❌ Inventing shapes client-side awaiting server. ❌ Client transforms enriching server DTO ad-hoc. ❌ Changing server DTO because client expected different name. ❌ Divergent client types "in case" server changes.
- **Canon**: ✅ Client imports shapes from server; wire always `{ok, data: <ServerDTO>}`; client types mirror DTO directly. ✅ New field needed → design server-side CQRS query first. ✅ Drift detected → rewrite client.

---

## Rule: MSW v2 is canon for client test mocking

For integration tests in `apps/client/tests/integration/`, the canon is **MSW v2**, not `vi.stubGlobal("fetch", mockFetch)`. Handlers per-domain live in `tests/mocks/handlers/`, registered in barrel `index.ts`, integrated with `tests/mocks/server.ts` (setupServer).

**Why:** Edward (2026-05-20): repo migrated; legacy `vi.stubGlobal` still exists but is NOT canon. The migration POC documented it explicitly. MSW v2 intercepts at the network level (Service Worker in browser, fetch interceptor in Node) and returns real `Response` objects, not fragile stubs that skip middleware/rewrites.

**How to apply:**

- For EACH new hook/page under `apps/client/` calling `/api/backend/*`:
  1. Add `tests/mocks/handlers/<domain>.ts` exporting `<domain>Handlers: HttpHandler[]`.
  2. Register in `tests/mocks/handlers/index.ts`.
  3. In test: `beforeAll(() => server.listen({onUnhandledRequest:"error"}))` + `afterEach(() => server.resetHandlers())` + `afterAll(() => server.close())`.
  4. Per-test overrides: `server.use(http.get(...))`.
- NO `vi.stubGlobal("fetch", ...)` for new tests.
- Legacy tests with `vi.stubGlobal` are NOT canon; don't migrate inline (avoid churn). Mark as SMELL + defer to dedicated test-review workstream.

---

## Rule: Vitest vs MSW decision tree — know when to use each

Vitest is the runner; MSW is for intercepting HTTP. Use vitest always; MSW only when code makes network calls.

**Why:** MSW intercepts network (Service Worker, fetch interceptor); vitest runs tests. MSW ≠ vitest; they're complementary. Edward (2026-05-20).

**How to apply:**:

| Scenario                                                   | Tools                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Unit test pure function / logic / no network / no heavy DI | vitest + `vi.mock()` / `vi.spyOn()`                                                |
| Service / use-case with internal deps (repos, ports)       | vitest + mock adapters via `vi.mock()` or factory pattern                          |
| React component rendering pre-received data                | vitest + `@testing-library/react` + mocked deps                                    |
| Hook / page fetching from API                              | vitest + **MSW v2**                                                                |
| Client integration test (hooks → fetch → response)         | vitest + **MSW**                                                                   |
| Backend test (API layer)                                   | vitest unit + `node:test` integration, **NO MSW** (use `app.inject()` or DI mocks) |
| E2E real browser/backend                                   | Playwright, not vitest/MSW                                                         |

- If component is clearly unit (pure rendering), but test feels complex → testing wrong layer, drop a level.
- MSW > `vi.stubGlobal` because MSW models network fidelity (headers, CORS, streaming, status codes).

---

## Rule: Proxy smoke test required for client UI before commit

For ANY UI/hook new in `apps/client/`, before committing, smoke-test the proxy real with curl. Type-check + tests ≠ feature correct. The proxy has its own logic (cookie inject, auth flow) only tested with HTTP request real.

**Why:** CLAUDE.md dictates: _"For UI or frontend changes, start the dev server and use the feature in a browser before reporting complete. Make sure to test golden path and edge cases; monitor regressions. Type checking and test suites verify code correctness, not feature correctness."_ I ignored this in F0-CLI-1/2. Tests passed (MSW mocks fetch, doesn't exercise the proxy). But the proxy's `next.config.mjs` rewrite was confiscating all `/api/backend/*` calls before the route handler, forwarding with the `backend/` prefix embedded → API returned 404. Broke Repurpose + Inbox in runtime until I finally smoke-tested (2026-05-20).

**How to apply:**

- After typecheck + tests green, BEFORE commit:
  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" \
    http://omnipost-dev:3200/api/backend/<endpoint>
  ```
- Expected: 401 (no auth cookie — endpoint reached backend correctly). NOT 404 (proxy roto). NOT 500 (upstream error).
- If UI render verification also needed (visual: badges, states) and no browser available: state explicitly ("can't verify render visual, depend on tests"). Do NOT claim success.
- **Relates to**: MSW + vitest exercise the client-side logic, not the proxy. Smoke test exercises the proxy.

---

## Rule: Runtime-validity preflight before ExitPlanMode — verify critical premisas

Before invoking ExitPlanMode, run "runtime-validity pre-flight check" on critical plan premisas. If the plan says "extend X" or "use Y" or "handler Z is live," grep callers + read where Z should be wired.

**Why:** Violated this in F0-WRK-2. Plan assumed "InboxEventHandlers exists and currently does NOT trigger triage" → I interpreted as "live but non-functional." Reality: completely dormant (nobody invokes). Invalidated plan premise only during execution → rework-churn, Edward lost confidence (2026-05-19).

**How to apply:**

- Plan says "extend / hook / use X" where X is a class/method/handler:
  1. Grep callers in `apps/api/src/`, `apps/workers/`, `apps/client/`, `packages/`.
  2. If callers = only definition + DI registration → X is **dormant** (forgotten-feature, not canon-live).
  3. If X depends on event/subscription, verify concrete wire (not just "event exists").
  4. Report findings in plan-mode Phase 3 before final plan file.
- Applies to: use cases, adapters/repos (resueltos por DI + callers), domain events, background tasks, schedulers.
- If plan premise falls: declare invalidation explicitly, propose options, don't decide in silence.

---

## Rule: Feature trace matrix is source of truth for roadmap; canon index may be stale

The **main source of truth** is the **feature trace matrix** (`docs/product/FEATURE_TRACE_MATRIX_ES.md` + `IMPLEMENTATION_PLAN_ES.md`). The **canon index** is a hint; its information **may be stale** and MUST be confirmed via web research before treating it as current.

**Why:** APIs, pricing, best-practices change (e.g., X moved to paid $0.005/read Feb 2026; Threads added keyword search 2025-2026). Static canon index leads to outdated decisions. Index guides; web confirms (2026-05-20, F0-CLI-1).

**How to apply:**

- Planning/executing roadmap tasks: (1) read feature trace matrix + DoD as ground truth, (2) read canon index as hint, (3) **WebSearch to confirm** critical external facts (API capabilities, pricing, deprecations) before fixing in design.

---

## Rule: Feed the backlog live during implementation — every smell detected during recon/work

In each roadmap task (recon + implementation + PR review), if you detect a smell **localized** out-of-scope, register it in `docs/reports/roadmap-detected-smells-backlog.md` (SMELL-N) during the batch, not waiting for post-phases audit. Continuous feeding replaces periodic sweeps.

**Why:** Edward wants the backlog to grow orgánicamente as work proceeds, so detected + not-noted smells don't become latent bombs (2026-05-19).

**How to apply:**

- **SÍ goes to backlog** (localized smells): dead code, duplication, casts, dirty comments, anti-patterns, forgotten-features, type smells.
- **ALSO goes** — hallazgos with **estado incierto** (unclear if dead, orphan, duplication, drift, etc.). If you find it and don't know what it is → note it. The verdict is pending, not excluded.
- **NO va** — refactors arquitectónicos already decided + in roadmap, canon decisions already agreed, tasks user explicitly moved from backlog to roadmap.
- Origin attribution: `SMELL-N | <TaskID> recon` / `<TaskID> implementation` / `AUDIT-N`.

---

## How to extend

Adding a new runtime/contract rule:

1. Append a `## Rule: <short title>` section with Rule / **Why** / **How to apply**.
2. If the rule names a specific test framework + scenario, add it to the "Vitest vs MSW vs Playwright" matrix instead of a standalone rule.
3. Cross-link with `[[rule-name]]` to related rules.
