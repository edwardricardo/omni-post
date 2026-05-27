---
name: feedback-tools-infra
description: "Edward's tooling + infrastructure canon: pnpm-only, LXC memory caps, DB migrations, version pinning, specialists"
metadata:
  type: feedback-canon
  owner: edward
  loaded: every-session-via-claude-local-md
---

# Tools, Infrastructure & Machine Constraints

> Personal canon: tool choices (pnpm, turbo, specialists), machine constraints
> (homelab LXC 9GB RAM), and the dev-loop hygiene (migrations, version pinning,
> commit heap, UoW mandatory).
> Auto-loaded via `@~/.claude/feedback/tools-infra.md` in `CLAUDE.local.md`.

**Owner:** Edward
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Rule: Always use pnpm, never npm/npx

Use `pnpm` for ALL package management and script execution, never `npm` or `npx`.

**Why:** Running `npx` produces `npm warn Unknown project config "public-hoist-pattern"` warnings because the project uses pnpm workspaces with pnpm-specific config that npm doesn't understand.

**How to apply:**

- `pnpm exec vitest run` not `npx vitest run`.
- `pnpm exec stryker run` not `npx stryker run`.
- `pnpm --filter @apps/api test` not `npm test`.
- `pnpm add` not `npm install`.

---

## Rule: Use specialist agents for UI/CSS debugging

When debugging React/Radix/Tailwind CSS issues (component not visible, selectors wrong, animations broken), delegate to `react-frontend-specialist` agent immediately instead of iterating manually.

**Why:** The specialist found in minutes that Radix UI v1.4.3 dropped `data-radix-*` attributes that v1.0.x had — something manual CSS debugging would have cost hours. Manual iteration with grep/build cycles is slow and error-prone.

**How to apply:**

- When CSS/styling fix doesn't work after 2 attempts → stop and delegate to `react-frontend-specialist` with full context (what was tried, what failed).

---

## Rule: Memory-constrained environment — tests by-file, not full suite by default

The homelab LXC has 9GB RAM with ~1.4GB baseline. Running the full test suite consistently OOMs and collapses the box. Default to tests-by-file; full suite only when suspecting genuine regressions + warning Edward first.

**Why:** Full suite OOM causes box collapse and lost work (2026-05-23). Heap caps were calibrated and default behavior is per-file testing.

**How to apply:**

- **Daily**: `pnpm --filter @apps/api exec vitest run <path/to/file.test.ts>` (one or pouch files).
- **Incremental**: `pnpm test` (turbo HEAD^1 filter) when verifying a narrow change.
- **Full suite exception**: only when suspecting regressions (shared-type change, major refactor). Warn Edward first.
- **Heap caps**: `tsc --noEmit` ≤ 5120 MB, `vitest` ≤ 3072 MB. NEVER `--max-old-space-size=8192`.
- **OOM recovery**: process OOM is recoverable (thrown error); box OOM is not (lost state).
- Cap protects the box: if Node exceeds cap, it throws "heap out of memory" vs OOM-killing the LXC.
- Prefer lint/format by file too: `eslint <files>`, `prettier --write <files>` not full repo.
- Note: contradicts partial guidance on `feedback_use_turbo_for_tests` (turbo full); memory limitant takes priority.

---

## Rule: Database migrations always executed with services up

When a plan includes Prisma migration, it is MANDATORY to: (1) `pnpm db:up` to start PostgreSQL + Redis, (2) wait until healthy, (3) run migration, (4) immediately `pnpm --filter @infra/prisma exec prisma generate`, (5) verify with `pnpm exec prisma migrate status`.

**Why:** Migrations must actually run against the DB. Skipping leaves the migration pending and generates confusion. Schema and Prisma client must stay in sync.

**How to apply:**

- At start of any plan with `schema.prisma` changes:
  1. `pnpm db:up` (PostgreSQL + Redis).
  2. Wait healthy.
  3. `pnpm --filter @infra/prisma exec prisma db:migrate dev --name <name>`.
  4. `pnpm --filter @infra/prisma exec prisma generate` IMMEDIATELY after (DO NOT SKIP).
  5. Verify with `pnpm exec prisma migrate status`.
  6. Continue with rest of plan.

---

## Rule: Pin to last stable version, never auto-update ranges

When updating dependencies, ALWAYS pin to the latest STABLE version (never canary/RC/beta/alpha/next) and NEVER use semver ranges that allow auto-update (`^`, `~`, `latest`, `*`). Version must be exact literal in package.json.

**Why:** Edward (2026-05-06): control over when upgrades occur (not silent auto-update), reproducibility (same lockfile across machines/time), pre-prod stability (no unintended churn). If a library only exposes canary/RC, that's a red flag the feature isn't ready.

**How to apply:**

1. `pnpm view <pkg> versions --json` → filter for versions NOT containing `canary|rc|beta|alpha|preview|next|nightly`. Take the latest.
2. In `package.json`: exact number only — `"next": "16.2.4"` not `"^16.2.4"`.
3. If repo has existing `^` ranges: don't replicate. Apply pinning to new deps; change others when touched.
4. Peer-dependency ranges are OK (they're constraints, not statements of intent about auto-update).
5. **Non-negotiable rule.**

---

## Rule: Regenerate Prisma client immediately after schema migration

After ANY change to `infra/prisma/schema.prisma` and running the migration, **immediately regenerate the Prisma client**:

```bash
pnpm --filter @infra/prisma exec prisma generate
```

**Why:** Migrations update the DB but DO NOT regenerate the client. The runtime client at `infra/prisma/generated/prisma/client/` lives in `node_modules`. Without `prisma generate`, runtime sees the old shape and queries referencing new columns fail with `Unknown argument 'X'` PrismaClientValidationError. Real pre-prod incident: Phase 3b added `nextRetryAt` to `SagaInstance`; migration applied; client not regenerated → API boot succeeded but background task failed every 5s with the error until regenerated.

**How to apply:**

- Mandatory workflow: schema edit → migrate → **generate** → typecheck (catches missing fields).
- If runtime error "Unknown argument 'X'" and field exists in schema → regenerate before debugging.
- The `postinstall` hook in `infra/prisma/package.json` runs `prisma generate` — explains why `pnpm install` fresh works but mid-session migrations don't.

---

## Rule: UoW mandatory for ALL mutating use cases

Every new use case that writes to a repository MUST use the Unit of Work pattern for transactional atomicity. No exceptions, no workarounds.

**Why:** Edward explicitly required UoW expansion to all 56 mutating use cases (completed 2026-03-28). Pattern guarantees atomic repo writes + event dispatch. New code must follow (2026-04-30).

**How to apply:**

- For any `*UseCase.ts` that writes to repo:
  1. Import `UnitOfWork` from domain repositories.
  2. Add as LAST optional constructor parameter.
  3. Wrap repo operations in `doWork` + `executeInTransaction`.
  4. Update DI container to pass `TOKENS.UnitOfWork`.
  5. CLAUDE.md section "Unit of Work" has the full pattern.

---

## Rule: Tests must pass before commit

All code created or modified must pass its respective tests before commit. Lint passing is not sufficient. Typecheck passing is not sufficient. **Barre**: existing tests green + new tests for modified code green.

**Why:** Lint + typecheck cover syntactic/type correctness. Tests cover semantic correctness (code does what it says). Refactor that typechecks but breaks runtime is latent debt that surfaces in production (2026-05-11).

**How to apply:**

- After modification: run suite of affected package:
  - Backend: `pnpm --filter @apps/api test` or `pnpm test` (turbo incremental).
  - Frontend: same pattern.
  - Packages: `pnpm --filter @packages/<name> test`.
- Failing tests = blocked commit. Fix bugs or update tests for new contract.
- Checklist: (1) lint clean, (2) typecheck clean, (3) tests clean (existing + new).

---

## Rule: Involve security-auditor agent in testing

In all testing activities (unit tests, integration, mutation, security), always involve the `appsec-security-auditor` agent. Security perspective must be present in test design, not just dedicated security audits.

**Why:** Edward wants security considerations in every test session — attack vectors, input validation, OAuth flows, credential handling, etc. (not just func coverage) (2026-05-20).

**How to apply:**

- When writing new tests or planning test sessions: proactively launch `appsec-security-auditor` for security review suggestions + additional security tests relevant to code under test.

---

## Rule: Long-lived blocking Redis connections must NOT set commandTimeout

Never set `commandTimeout` on long-lived blocking Redis connections (BullMQ Workers, pub/sub subscribers). Use `lockDuration` + `keepAlive` for liveness; blocking commands (BZPOPMIN, XREAD BLOCK, SUBSCRIBE) can legitimately idle for seconds while waiting.

**Why:** When ioredis fires `commandTimeout` on a blocking call mid-flight, it cancels the legitimate block and surfaces as "Command timed out" even though Redis is healthy. Documented in BullMQ issue #2619. Pre-prod incident in this repo: Workers + subscribers spammed timeout errors under healthy Redis (2026-05, corrected post-hoc).

**How to apply:**

- **Worker connection**: `{ maxRetriesPerRequest: null, connectTimeout: 10_000, keepAlive: 30_000 }` — NO commandTimeout.
- **Subscriber via factory**: `createRedisConnection({ maxRetriesPerRequest: null })` — same.
- **Subscriber via duplicate**: `parent.duplicate({ commandTimeout: 0 })` to override inherited timeout (ioredis treats 0/null as disabled).
- **Producer (Queue.add)**: `commandTimeout: 5_000` is fine (non-blocking).
- **Cache / GET-SET**: `commandTimeout: 5_000` is fine.
- The factory at `apps/api/src/lib/redis.ts:createRedisConnection` auto-applies long-lived canon when `maxRetriesPerRequest === null`.
- Liveness enforced by: `lockDuration` (BullMQ, default 30s/we use 60s) + `stalledInterval` (30s) + TCP `keepAlive: 30_000` + `connectTimeout: 10_000` (dial-in only, not steady-state).

---

## Rule: Node heap caps for headroom + avoid commandTimeout OOM in pre-commit lint

Pre-commit eslint (lint-staged → type-aware ESLint) OOMs at default Node heap when staged files touch domain code with large type graphs. Prefix git commit with NODE_OPTIONS heap to give the process memory.

**Why:** eslint type-aware loads a large type graph; husky subprocess doesn't inherit the `--max-old-space-size` you use for manual runs. Commit aborts with V8 crash (`husky - pre-commit script failed (code 1)`) not a lint error. Also applies to manual eslint on domain files (2026-05-23, B5).

**How to apply:**

- Never use `--no-verify` (suppresses gate = time-bomb, forbidden).
- Correct fix: enlarge heap for the process:
  ```bash
  NODE_OPTIONS=--max-old-space-size=8192 git commit -m "..."
  ```
- Lint runs complete with memory. Applies also to `pnpm --filter @apps/api exec eslint <domain-files>` manual.

---

End of consolidated memory.

## How to extend

Adding a new tool/infra rule:

1. Append a `## Rule: <short title>` section with Rule / **Why** / **How to apply**.
2. If the rule is about a specific dev-box constraint (memory, network), include the box version/date so it stays auditable.
3. If the rule replaces an older one, mark the older as `**Status:** Superseded by [[<new>]]` — preserves the why-we-changed trail.
4. Cross-link with `[[rule-name]]` to related rules.
