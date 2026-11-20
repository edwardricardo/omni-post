# Fitness functions: the check blocks

> The block of every numbered fitness check: the threat it prevents, its scope and its exclusions, its command, its fail-closed paths and its residual limits. This document is read as a file and searched by number, `rg -n '^# <number>\.' docs/development/FITNESS_FUNCTIONS.md`, and it is never imported: it is not part of the context a session loads by itself ([ADR-0045](../technical/ADR-0045-instruction-context-budget.md)).

**Owner:** Maintainers

The rules of the suite (its thresholds and baselines, the list of every check by number with how it runs, and how to extend it) are in [CLAUDE.md](../../CLAUDE.md) §Automated Compliance Checks. The blocks below left that section on 2026-11-18, byte for byte. In a block, "here" and "this section" name this document, and a bare `§Name` names a section of `CLAUDE.md`.

## Check blocks

````bash
# 1. No Prisma singleton imports in routes. Hard-zero.
# Glob fixed to *[Rr]outes* — the old *routes* was case-sensitive and missed
# every PascalCase *Routes.ts, so this guard silently passed on admin routes.
grep -rn "import { prisma" apps/api/src/ --include="*[Rr]outes*" | wc -l

# 2. Domain + application core is framework-free.
# Scope repointed: `apps/api/src/domain/` no longer exists — the layers moved to
# `packages/core/` in the relocation fitness #22 enforces. A `grep -r` on an
# absent directory exits 2, prints nothing, and `| wc -l` renders that as 0, so
# this guard reported a clean domain over code it never opened. The scope is the
# whole `packages/core` tree because the canon forbids concrete infrastructure in
# BOTH layers it holds (application imports domain only, never an adapter), and
# because a per-context package is added by creating a directory — a scope that
# names them one by one goes stale the same way the old path did. Tests are out:
# they are `@layer infrastructure` and legitimately name the technologies they
# replace with doubles.
grep -rn "prisma\|fastify\|redis\|bullmq" packages/core --include="*.ts" | \
  grep -vE "/dist/|/node_modules/|/tests/|\.test\.ts:" | wc -l

# 3. No `any` in the core (domain + application) or in apps/api infrastructure.
# Same repoint as #2: two of the three original path arguments were gone, so
# grep errored on them and the surviving `infrastructure` arm carried the whole
# check while the annotation still claimed all three layers.
# Refined regex: `\bas any\b` (word boundary before `as`) avoids matching
# "h*as any*" in JSDoc prose like "Check if project has any channels".
# Also exclude lines that start with `*` (JSDoc) or `//` (line comment), plus
# tests — a negative test may need `as any` to construct invalid state, which is
# the `test-fixture` scenario in §Pragmatic Exceptions.
# packages/adapters/db-prisma joined the scope with the Post persistence relocation (measured 0 at
# entry); its tests/ are excluded by the same /tests/ filter as everywhere else.
grep -rnE "(:\s+any\b|\bas any\b|<any>)" \
  packages/core apps/api/src/infrastructure packages/adapters/db-prisma \
  --include="*.ts" | \
  grep -vE "/dist/|/node_modules/|/tests/|\.test\.ts:" | \
  grep -vE "//.*any|^[^:]+:[0-9]+:\s*\*" | wc -l

# 4. No raw throws in the core (domain + application).
# Same repoint as #2/#3, and the most misleading of the three: BOTH of its path
# arguments were gone, so it scanned nothing at all. Canon: fallible operations
# return `Result<T, DomainError>` and a throw never crosses a layer boundary.
# Excludes dist, node_modules, tests, and comment lines — `MAY throw` in JSDoc
# prose is documentation, not a statement.
# The four excepted files each hold a real `throw`. They are named here, with a
# remove-when apiece, so the debt is attributable rather than absorbed by a path
# that reads as green:
#   - GatewayBillingService.ts + TrialManagementService.ts: the throw is the
#     rollback signal inside `unitOfWork.executeInTransaction()` — an interactive
#     Prisma transaction aborts only by throwing — and the method's own
#     try/catch converts it to `err(...)`. It never leaves the service.
#     Remove-when: MET (ADR-0023). `UnitOfWork.executeResultInTransaction` IS the
#     explicit abort this asked for: a callback that resolves to `err` rolls the
#     transaction back and gets its `err` returned unchanged, with no throw in
#     the core. Migrating these 15 throws onto it is a NAMED SEPARATE CHANGE —
#     own bounded context, own regressions — so the exception stays listed until
#     that change lands, and it is now scheduled debt, not open-ended debt.
#   - DeletePostUseCase.ts: exhaustiveness guard on a `never`, unreachable by
#     construction; deleting it would make a new caller kind fall through in
#     silence. Remove-when: the caller union is closed by a compiler-checked
#     schema that makes the default arm impossible to write.
#   - ComplianceService.ts: NOT audited-safe, and the reason this exception list
#     is explicit. `getGdprSettings()` / `getSecuritySettings()` are typed
#     `Promise<GdprSettings>` / `Promise<SecuritySettings>`, so their throws DO
#     escape the application layer — a live canon violation the dead scope was
#     concealing. Remove-when: both getters return `Result<T, DomainError>` and
#     every caller narrows on `.ok`.
grep -rn "throw " packages/core --include="*.ts" | \
  grep -vE "/dist/|/node_modules/|/tests/|\.test\.ts:" | \
  grep -vE "^[^:]+:[0-9]+:\s*(\*|//)" | \
  grep -vE "/GatewayBillingService\.ts|/TrialManagementService\.ts|/ComplianceService\.ts|/DeletePostUseCase\.ts" | wc -l

# 5. No @ts-ignore in production source
# packages/*/src/ is ONE directory level deep and never reached packages/adapters/db-prisma/src/;
# the relocated Post persistence adapters live there, so it is named explicitly (0 at entry). The
# general two-level widening is unmeasured — backlog.
grep -rn "@ts-ignore\|@ts-nocheck" apps/api/src/ packages/*/src/ packages/adapters/db-prisma/src/ \
  --include="*.ts" | wc -l

# 6. CQRS handlers don't touch Prisma directly
grep -rn "prisma\." apps/api/src/cqrs/handlers/ --include="*.ts" | wc -l

# 7. No randomUUID in dedupeKey
grep -rn "dedupeKey.*randomUUID\|dedupeKey.*Math.random" \
  apps/api/src/ packages/ --include="*.ts" | wc -l

# 8. No sprint/phase references in source comments (repo-wide, excluding test sandboxes
# and Prisma's generated client mirror). Catches: "Sprint N", "Sprint X", "Phase N",
# "Part of Sprint X", the legacy "T0A_" / "T0-A" task-batch prefixes, and the
# parenthesised phase/task shorthand "(P8)" / "(P2-1)" / "(P3-A)" / "(P1-DI-7)" used
# during the @core + prisma→DI migrations. Prisma-safe: `\(P[0-9]\)` matches only a
# single digit and `\(P[0-9]+-` requires a dash, so Prisma error codes like "(P2002)"
# (P + 4 digits, no dash) are NOT flagged. All belong in git history, not source
# comments where they rot.
grep -rnE "Part of Sprint|Phase.*Sprint|Sprint [0-9A-Z]|Phase [0-9]|T0A_|T0-A|\(P[0-9]\)|\(P[0-9]+-[A-Za-z0-9]" \
  apps/ packages/ infra/ --include="*.ts" --include="*.tsx" --include="*.prisma" | \
  grep -vE "node_modules|dist|\.next|infra/prisma/generated/" | wc -l

# 9. No files missing @file header (all repo, target: 0).
# Excludes Next.js auto-generated `next-env.d.ts` (regenerated on every build,
# see https://nextjs.org/docs/app/api-reference/config/typescript — "should not be edited").
grep -rL "@file" apps/ packages/ --include="*.ts" --include="*.tsx" | \
  grep -v "node_modules\|dist\|\.next\|next-env\.d\.ts" | wc -l

# 10. No invalid @layer values (all repo, only domain/application/infrastructure)
grep -rn "@layer" apps/ packages/ --include="*.ts" --include="*.tsx" | \
  grep -v "node_modules\|dist\|\.next" | \
  grep -v "@layer application\|@layer domain\|@layer infrastructure" | wc -l

# 11. No raw setInterval in backend (scheduler-adapter excepted).
grep -rnE "setInterval\(" apps/api/src apps/workers/src packages/ --include="*.ts" | \
  grep -vE "default-scheduler|node_modules|dist|\.test\.|/tests/|eslint\.config" | wc -l

# 12. Every React component file carries an @component tag.
# Scan component directories and fail if any canonical component .tsx lacks @component.
# Excludes hooks (use*.tsx) and helper modules (camelCase exports, not PascalCase components).
for f in $(find apps/admin/components apps/client/components packages/ui/src/components \
  -type f -name "*.tsx" 2>/dev/null | grep -v "\.stories\.\|\.test\.\|\.next"); do
  basename=$(basename "$f")
  # Skip hooks — use*.tsx follow the hook convention, document them with @hook, not @component.
  case "$basename" in use*) continue;; esac
  # Skip helper modules that don't export any PascalCase component.
  if ! grep -qE "^export (default )?(function|const) [A-Z]" "$f"; then continue; fi
  grep -q "@component" "$f" || echo "MISSING @component: $f"
done | wc -l

# 13. No direct `pino` instantiation in apps/api production code — every
# logger MUST come from the `createLogger` factory in `apps/api/src/lib/logger.ts`
# so redaction paths and service bindings are uniform. Excludes the factory
# file itself and tests.
grep -rnE "^import pino\b|^const \w+ = pino\(" apps/api/src --include="*.ts" | \
  grep -v "lib/logger\.ts\|\.test\.\|/tests/" | wc -l

# 14. No `private *Cache = new Map()` per-class caches in apps/api/src/.
# Reason: cross-pod cache coherence (OWASP A07:2021) — per-instance Maps
# can't propagate invalidations between pods, so revoked permissions /
# stale credentials stay valid on adjacent pods until local TTL expires.
# All cross-pod cached state MUST go through TOKENS.CachePort. Excludes
# tests + test directories (test fixtures legitimately use Maps).
grep -rnE "^\s+private \w*[Cc]ache.*= new Map" apps/api/src --include="*.ts" | \
  grep -v "\.test\.\|/tests/" | wc -l

# 15. No insecure secret fallbacks (CWE-798) in apps/api/src + apps/workers/src
# + packages/providers/*/src.
# Reason: `process.env.X || "dev-only-..."`, `... ?? ""`, `... || generated()`
# patterns let the app boot with hard-coded / empty / per-restart secrets,
# masking misconfiguration in dev and shipping insecurely to prod. The fix
# is the typed env constant from apps/api/src/config/env.ts (Zod fail-fast)
# in app code, and constructor injection of secrets into provider apiClients.
# The typed constant is matched too: `env.X_SECRET ?? ""` on a variable the
# schema marks optional boots with an empty string that reads as configured,
# and a request then carries it as the secret. An unconfigured secret is an
# absent optional field, never "". `env` matches after any character but `!`
# or an identifier character, so `process.env`, the typed `env` and a member
# chain (`this.env`) are all read, while the boolean guard `!env.X_SECRET ||`
# is not a fallback and is skipped. Residual limits: an alias
# (`const e = env`), bracket access (`env["X_SECRET"]`) or a destructuring
# default is invisible to this line grep.
# Excludes `_template` (scaffolding example).
grep -rnE '(^|[^![:alnum:]_])env\.[A-Z_]*(SECRET|KEY|PASSWORD|TOKEN|CREDENTIAL)[A-Z_]*\s*(\|\||\?\?)' \
  apps/api/src apps/workers/src packages/providers --include="*.ts" | \
  grep -v "node_modules\|\.test\.\|/tests/\|/dist/\|config/env\.ts\|providers/_template/" | wc -l

# 16. No direct `process.env.*` in apps/api/src outside config/env.ts.
# Reason: forces every consumer to go through the Zod-validated `env` constant
# so every secret/config value passes schema validation at boot. Direct
# process.env access is the carrier for #15 violations and bypasses type-safety.
# Exception: process.env.NODE_ENV — Node ecosystem convention treats this as
# runtime-readable everywhere (libraries, tests) and Zod still validates it.
grep -rn "process\.env\." apps/api/src --include="*.ts" | \
  grep -v "config/env\.ts\|/tests/\|\.test\.\|process\.env\.NODE_ENV\b" | wc -l

# 17. No direct `process.env.*` in Next.js apps outside lib/env.ts.
# Reason: Webpack DefinePlugin inlines client `process.env` reads at build time
# — a `process.env.SECRET` referenced in a client component leaks the value
# into the browser bundle. Routing every consumer through `lib/env.ts`
# (@t3-oss/env-nextjs) enforces server/client split via the `clientPrefix`
# convention and fails build when a server secret is referenced from client
# code. Exception: process.env.NODE_ENV (Node ecosystem) + playwright config
# (runs outside Next bundle).
grep -rnE "process\.env\." \
    apps/admin/{app,components,hooks,lib,providers} \
    apps/client/{app,components,hooks,lib,providers} \
    --include="*.ts" --include="*.tsx" | \
  grep -v "lib/env\.ts\|process\.env\.NODE_ENV\b\|/tests/\|\.test\." | wc -l

# 19. No `process.env.*` reads inside provider Adapter classes
# (`packages/providers/*/src/*Adapter.ts`). Reason: provider adapters are
# stateless and receive credentials per-call from the application layer's
# CredentialResolver. Any env read inside the adapter file reintroduces the
# CWE-798 anti-pattern by smuggling secrets through the module rather than via
# constructor / parameter injection. Operational config (REDIS_URL, etc.) that
# legitimately lives in the apiClient layer is allowed there but NOT in the
# adapter file. Excludes `_template`.
grep -rnE "process\.env\." packages/providers/*/src/*Adapter.ts 2>/dev/null | \
  grep -v "providers/_template/\|/dist/" | wc -l

# 18. No direct `argon2.hash` / `argon2.verify` outside the canonical helper
# (`apps/api/src/auth/passwordHashing.ts`). Reason: every password / API-key /
# backup-code hash must use identical Argon2id parameters (RFC 9106 second-
# recommended: m=64MiB, t=3, p=4, hashLength=32, type=argon2id). Direct calls
# scattered across files cause drift — one site uses lib defaults, another
# passes weaker params, none use `needsRehash` for transparent rehash on
# login. Route everything through `hashPassword` / `verifyPassword` /
# `needsRehash` from the helper.
grep -rnE "argon2\.(hash|verify)\(" apps/api/src --include="*.ts" | \
  grep -v "passwordHashing\.ts\|/tests/\|\.test\." | wc -l

# 20. No legacy BullMQ repeatable API. Reason: `addRepeatable` /
# `getRepeatableJobs` / `removeRepeatableByKey` / `removeRepeatable` are
# deprecated since BullMQ 5.16.0 and removed in v6; the canonical recurring
# primitive is `Queue.upsertJobScheduler` (idempotent by scheduler id, no
# manual de-dup). The four method names are BullMQ-exclusive, so this is a
# precise hard-zero with no false positives (unlike a bare `repeat:` which
# collides with domain fields like `cronExpression` and provider API params
# such as Facebook insights `repeat: number`). Excludes tests + sandboxes.
grep -rnE "\.(addRepeatable|getRepeatableJobs|removeRepeatableByKey|removeRepeatable)\(" \
  apps/*/src packages/*/src --include="*.ts" | \
  grep -vE "node_modules|/dist/|\.test\.|/tests/" | wc -l

# 21. No Prisma singleton imports outside composition roots. THE DI guard:
# only a composition root may import the `prisma` singleton; every other unit
# RECEIVES PrismaClient (or a port) by constructor injection (see §Dependency
# Injection). Scope: apps/api/src + apps/workers/src. Exceptions: the api
# composition root (infrastructure/container/), the api bootstrap (index.ts),
# the workers composition root (**/container/), and tests. Hard-zero (the
# prisma→DI remediation is complete). Supersedes #1 (routes are a subset of
# "outside composition roots").
grep -rlE "import \{[^}]*\bprisma\b[^}]*\} from \"@infra/prisma\"" \
  apps/api/src apps/workers/src --include="*.ts" | \
  grep -vE "/infrastructure/container/|/index\.ts$|/container/|\.test\.|/tests/" | wc -l

# 22. No `@layer application` files in apps/api/src — application code lives
# in `packages/core/application/` after the application-services-to-core
# workstream (S1'→S4). Adding `@layer application` inside apps/api/src
# reintroduces the inverted-dependency smell the workstream eliminated;
# new application-layer code MUST go to `packages/core/application/<context>/`
# and apps/api consumers import it as `@core/application/<context>/<Service>.js`.
# Scope: apps/api/src. Hard-zero (S5 closed the workstream — count = 0 at
# branch tip).
grep -rlE "^\s*\*\s*@layer application\s*$" apps/api/src --include="*.ts" | wc -l

# 23. No raw Prisma queries (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`,
# `$executeRawUnsafe`) outside the tenant guard extension or composition
# root. Raw queries BYPASS the Prisma `$extends` tenant-guard middleware
# (S2.1b) because Prisma extensions only hook the typed query API. Any
# raw SQL touching tenant-scoped tables MUST either (a) wrap in a UoW
# (RLS layer 2 catches it via SET LOCAL app.account_id from
# TenantContext) or (b) explicitly opt-in via `withSystemContext()` for
# admin/system flows. Hard-zero: new raw queries require explicit ADR
# justification + this fitness exception updated. Scope: apps/api/src +
# apps/workers/src + packages/adapters/db-prisma/src. Exceptions: the tenant
# guard extension itself, Prisma client construction, and tests (which can stub).
grep -rnE "\.\\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\(" \
  apps/api/src apps/workers/src packages/adapters/db-prisma/src --include="*.ts" 2>/dev/null | \
  grep -vE "/extensions/tenantGuard|/infrastructure/container/|/tests/|\.test\." | \
  grep -vE "/events/EventStore\.ts|/PrismaStyleGuideRuleRepository\.ts|/PrismaGlossaryRepository\.ts" | \
  grep -vE "/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts" | wc -l
# Exceptions (as of the close of S2.1d) — all are audited-safe, no known-gap:
#   - events/EventStore.ts: StoredEvent is a global table (no accountId). OK.
#   - PrismaStyleGuideRuleRepository.ts + PrismaGlossaryRepository.ts:
#     raw pgvector UPDATEs — AUDITED S2.1d, both filter by
#     `AND "accountId" = ${requireTenantContext().accountId}`. CWE-639 closed.
#     Why they stay an exception: the regex cannot validate the AND clause in
#     a multi-line Prisma.sql; a periodic manual audit is documented in
#     `docs/security/MULTI_TENANT_AUDIT_2026-05-27.md`.
#   - packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts (relocated from
#     apps/api/src/infrastructure/unitofwork/ with the Post persistence adapters): emits
#     `set_config('app.account_id', ..., true)` to bind the RLS GUC at tx start — THE
#     canonical entry point for tenant scope in transactions. INERT TODAY, stated so nobody
#     reads it as coverage: the statement is a TAGGED TEMPLATE (tx.$queryRaw`...`) and this
#     regex is anchored on `\(`, so the line has never matched (SMELL-111's class). Kept
#     because it turns live the day SMELL-111 closes the regex; deleting it instead needs
#     authorisation (the plan row FITNESS-INERT-TERMS, docs/product/plan/cross-cutting.md, owns it).
#   - packages/adapters/db-prisma/src entered this scope with that relocation. Measured at
#     entry: 0 paren-form calls. Its one tagged-template site, resilience.ts:308
#     (prisma.$queryRaw`SELECT 1`, a connection probe touching no tenant table), is
#     invisible to this regex for the same reason and gets NO exception line — a second
#     inert line would be fat, not coverage; SMELL-111's closure enrols it.

# 24. Canon child docs MUST exist + have §How to extend + Owner (anti-deletion).
# Hard-zero (any missing file or missing required section fails CI). Acts as a
# deletion guardrail: any PR that deletes a canon child or strips its required
# structure hard-fails CI before merge. The 4 children are auto-loaded via
# @-imports in CLAUDE.md (Claude Code memory system); losing one silently
# strips load-bearing rules from every future session.
for f in docs/architecture/ARCHITECTURE_CANON.md \
         docs/development/CODING_STANDARDS.md \
         docs/security/SECURITY_CANON.md \
         docs/observability/LOGGING_CANON.md; do
  if [ ! -f "$f" ]; then echo "MISSING canon child: $f"; exit 1; fi
  grep -q '^## How to extend' "$f" || { echo "MISSING §How to extend in $f"; exit 1; }
  grep -q '^\*\*Owner:' "$f" || { echo "MISSING **Owner:** in $f"; exit 1; }
done

# 25. Circuit-breaker fail-fast for writes. Two-part hard-zero.
# Threat: a write-path fallback resolves provider failures with a synthetic
# receipt ({id:"queued",status:"pending"}) instead of surfacing an error —
# silently losing the post. Root cause: SOCIAL_POST_FALLBACK was removed in
# PR1; DEFAULT_EXTERNAL_API_OPTIONS was flipped to fallbackEnabled:false;
# this guard locks both invariants so they cannot regress.
#
# Part A: the DEFAULT_EXTERNAL_API_OPTIONS block must not contain
# fallbackEnabled:true (fail-fast must remain the default).
grep -nA6 "DEFAULT_EXTERNAL_API_OPTIONS: ExternalApiOptions = {" \
  packages/adapters/external-apis/src/circuitBreaker.ts | \
  grep -E "fallbackEnabled:\s*true" | wc -l        # expect 0
#
# Part B: no explicit fallbackEnabled:true paired with a write-verb operation
# name in providers/adapters/apps/api/src (excluding tests). If a write-path
# call ever opts in to fallback, the synthetic-receipt anti-pattern re-enters.
grep -rn "fallbackEnabled: true" \
  packages/providers packages/adapters apps/api/src --include="*.ts" | \
  grep -vE "/tests/|\.test\." | \
  grep -E "(post-tweet|post-to-page|publish-media|create-container|create-stories|create-reels|send-message|send-photo|send-video|send-poll|send-document|send-audio|create-story|create-pin|create-post|upload-video|upload-short|upload-media|schedule|process-video|process-segment|optimize-reel|create-thumbnail|create-stream|start-stream|stop-stream)" | wc -l  # expect 0

# 26. No `.js`-on-`.ts` relative imports in bundler-compiled FRONTEND dirs.
# Next 16 Turbopack canNOT resolve a written `./x.js` back to its `./x.ts`
# source (vercel/next.js #82945 OPEN); the NodeNext `.js` extension convention
# is BACKEND-only (api/workers/@core/* run via NodeNext). The Next apps and the
# frontend-only packages they compile from src use `moduleResolution: bundler`
# = extensionless. A path-agnostic codemod that adds `.js` in these dirs
# silently breaks `next dev` / `next build`. Hard-zero. See ADR-0017 §4.
grep -rnE 'from "\.\.?/[^"]*\.js"' \
  apps/admin apps/client packages/ui/src packages/api-errors/src \
  packages/query-client/src packages/observability/browser-logger/src \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=.next --exclude-dir=node_modules --exclude-dir=dist | wc -l  # expect 0

# 27. Dev/test/CI source-resolution invariants (the dev-prod-resolution-model
# contract — ADR-0017 §1c). Two parts, hard-zero. Prevents re-introducing the
# exports->dist breakage: workspace `exports` point at dist (correct for the prod
# image, which builds dist first), so dev/test/CI consumers must opt into the
# `development`->src conditional export, and Next builds must build @shared/types
# dist first.
#
# Part A: every source-mode `node --import tsx` test/seed/service invocation
# (which resolves BARE workspace specifiers via Node `exports`, NOT tsconfig
# paths) MUST pass `--conditions development`, else it lands on the unbuilt dist.
# `apps/workers/package.json` + `src/bootstrap.ts` are in scope because CI now
# boots the workers from source in the integration job: without the condition the
# worker resolves ~12 workspace packages to a dist CI never builds, dies during
# boot, and the readiness gate reports "not ready" for a reason that has nothing
# to do with the queue it exists to prove.
grep -rnE "node ([^|&]*)--import tsx" \
  apps/api/package.json apps/api/scripts/run-tests.sh infra/prisma/package.json \
  apps/workers/package.json | \
  grep -E -- "--test|security/tests|seed\.ts|src/bootstrap\.ts" | \
  grep -v -- "--conditions development" | \
  grep -vE '"dev":|dump:openapi' | wc -l  # expect 0
#
# Part B: the size-limit job must build the Next apps via `turbo run build` (build
# task dependsOn:["^build"] -> builds @shared/types#build first), never a bare
# `pnpm --filter @apps/... build` (which skips the @shared/types dist the apps
# consume via Option-B tsconfig paths -> Turbopack "Module not found").
grep -nE "pnpm --filter @apps/(admin|client)( --filter @apps/(admin|client))* build" \
  .github/workflows/audit.yml | wc -l  # expect 0

# 28. Fastify `trustProxy` comes ONLY from the derived policy. An ALLOWLIST, and it
# used to be a denylist — the inversion is the point, not a refactor.
#
# The old form banned `trustProxy: true` and REQUIRED the numeric
# TRUSTED_PROXY_HOP_COUNT. Fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) then deleted numeric
# hop-count trust outright: `getTrustProxyFn` now returns `() => false` for a number,
# because — upstream's words — hop-count-only trust cannot validate the immediate
# peer. So the old check REQUIRED the spelling that had become dangerous, and was
# blind to it: measured, `trustProxy: 2` planted in index.ts returned count=0 and
# passed cleanly, while `trustProxy: true` was caught. A gate that mandates the
# defect it exists to prevent is worse than no gate.
#
# A denylist cannot fix this: the dangerous set is now open-ended (any number, any
# hand-rolled `(addr, hop) => hop < N` function that would type-check, keep tests
# green, and deliberately restore the patched vulnerability). So the check inverts:
# every `trustProxy:` in the scope MUST be the single derived binding
# `FASTIFY_TRUST_PROXY`, which `apps/api/src/security/trustedProxy.ts` computes from
# the boot-validated TRUSTED_PROXY_MODE + TRUSTED_PROXY_RANGES pair. Anything else —
# `true`, a number, a literal, an inline function — is a violation by construction,
# without this list needing to predict it.
#
# The trust model itself is unrepresentable-when-invalid rather than checked: the
# policy type carries a NON-EMPTY TUPLE for its ranges, so "trusted-ranges with no
# ranges" is not a value the program can hold, and the env schema refuses to boot on
# an inconsistent pair (including a lingering TRUSTED_PROXY_HOP_COUNT, whose silent
# acceptance would let an operator believe hop trust is still in force). See
# ADR-0021 and SECURITY_CANON.md §Rate Limiting. Scope: apps/api/src +
# apps/workers/src. Excludes tests and the deriving module itself.
grep -rnE "trustProxy:" apps/api/src apps/workers/src --include="*.ts" | \
  grep -vE "/tests/|\.test\.|/security/trustedProxy\.ts:" | \
  grep -vE "trustProxy:\s*FASTIFY_TRUST_PROXY\b" | wc -l   # expect 0

# 29. No raw client-IP header reads outside the canonical resolver. Every security
# decision keyed by client IP MUST go through resolveClientIp(); a direct
# x-forwarded-for / x-real-ip read is the carrier for the leftmost-entry spoof
# (see SECURITY_CANON.md §Rate Limiting). Scope: apps/api/src + apps/workers/src.
# Excludes the resolver file itself and tests.
grep -rniE '"x-forwarded-for"|"x-real-ip"|headers\[.x-forwarded-for|headers\[.x-real-ip' \
  apps/api/src apps/workers/src --include="*.ts" | \
  grep -vE "resolveClientIp|/tests/|\.test\." | wc -l   # expect 0

# 30. Every test file has exactly one collector run by a required check, or is quarantined.
# Threat: a test file no collector runs never executes, while it still reads as coverage in the
# tree, in review and in a coverage report that counts only what ran. A file two collectors run
# executes twice, under two environments, and its green says nothing about the tier it was written
# for. A collector whose CI job is not a required check gates nothing. Measured at the baseline
# commit of the testing refoundation tracker (its metric M5; the tracker left the tree on
# 2026-11-10, ADR-0044): 23 orphan test files and at least 10 collected twice.
# WHAT IT RUNS: the base commit's quarantine read with `git show` into a file, then
# `pnpm --filter @packages/test-contracts reach --quarantine quarantine.json --base <that file>`, the
# reach engine packages/test-contracts/src/reach.ts, pinned by its own suites under
# packages/test-contracts/tests/, which Package Tests runs. The disk is `git ls-files` filtered to
# test-shaped names: `.test.` or `.spec.` before a JavaScript or TypeScript extension, or `.k6.js`,
# at the end of the name. Four collectors say
# what they run: vitest asks every tracked `vitest.config.*` for its files through the node API and
# keeps what that same resolution holds of the config's `exclude`, which C2 reads; node:test is
# `apps/api/scripts/run-tests.sh --list`; Playwright is `playwright test --list` per tracked config;
# k6 is every tracked `*.k6.js`. packages/test-contracts/collectors.json maps each collector to the
# CI jobs that run it, and .github/rulesets/main.json lists the required checks.
#   R1: outside the quarantine, each test-shaped file is collected exactly once, by a source a
#       required check runs.
#   R2: each collectors.json entry names a job that exists, a `run` of one of its steps contains
#       the entry's entrypoint, and every check name the job renders is a required check.
#   R3: each quarantine entry is a tracked file that no source a required check runs collects, and
#       the base commit's quarantine already holds it: the quarantine may only shrink.
#   C1: each directory that holds a tracked `vitest.config.*` has a tracked package.json whose
#       `scripts.test` is exactly `vitest run`. A bare `vitest` watches whenever a terminal is
#       attached, so the same script ends in CI and never ends in a developer's shell; with one
#       script everywhere, `pnpm --filter <package> test` is one run in both.
#   C2: the resolved `exclude` of each tracked `vitest.config.*`, of its root config and of every
#       project it declares, contains every entry of RESERVED_TIER_EXCLUDES, compared as written.
#       It reads the collector's own resolution, never the config's text, so the factory's merge
#       and vitest's defaults count; a project is held on its own, because an inline project
#       without `extends: true` resolves vitest's default `exclude`, not its root's. The four
#       hand-written app configs (api, workers, admin, client) spread the list by hand, and a
#       config that drops it collects a reserved-suffix file R1 sees only once its own tier
#       collects it too.
# THE BASE: a pull request's base commit (`github.event.pull_request.base.sha`), on a push the
# commit before it (`HEAD~1`), handed in as FITNESS_BASE_REF; a local run without it compares
# against origin/main. The checkout fetches full history so either commit is readable.
# THE QUARANTINE: packages/test-contracts/quarantine.json, `{ "entries": [{ "path", "reason",
# "owner", "since" }] }`, every field non-empty: why the file runs nowhere, the work unit that ends
# that, and the day it entered. run-tests.sh reads the same file and keeps its apps/api/tests entries
# out of every tier. On 2026-10-14 it holds the 29 test-shaped files no required check runs: 9
# Playwright specs, 6 k6 scenarios, 7 security/tests suites, the 3 dark live suites, 2 admin fetch
# scripts, postgres-stress.test.ts and the provider template's sandbox test. An entry leaves in the
# pull request that gives its file a collector; none enters, because R3 refuses it against the base.
# WHERE IT RUNS, and why: the `test-contracts` job of fitness.yml (check `Test Contracts`, 10-minute
# timeout), not the Fitness Functions job: the collectors load every vitest and Playwright config,
# so they need the installed tree, which the Fitness Functions job never installs.
# FAIL-CLOSED, exit 1: an input the engine cannot read in full is an error, never an empty answer:
# fewer than 800 test-shaped tracked files, fewer than 80 vitest configs (the collector, C1 and C2
# each hold that floor), no Playwright config, a vitest or Playwright config or the node:test
# listing that collects no file, no tracked `*.k6.js`, a listing that fails, a vitest config whose
# `exclude` C2 never read (one only the CLI fallback lists, which resolves no config, or one no
# listing reaches), and a collectors.json, ruleset, package manifest, quarantine or base
# quarantine that is missing or does not parse; a workflow collectors.json names that cannot be
# read breaks R2. Two cases stop the step before the engine runs, each with its own `::error`: a
# base ref that does not resolve to a commit (a push whose commit has no parent has no `HEAD~1`,
# so it fails here by construction), and a base commit that holds no quarantine.json. A usage
# error exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) on a push the base is `HEAD~1`, so a push of
# several commits holds only its last commit to shrink-only, and an entry added by an earlier one
# passes; (2) a pull request whose base branch predates quarantine.json fails closed until it
# rebases, because its base has no quarantine to compare against; (3) .github/rulesets/main.json is
# a hand-kept mirror of the classic branch protection, which CI cannot read, so nothing compares
# the two by machine and a change to a required check edits the mirror in the same pull request;
# (4) test-shaped is a name: a test under another name (a `.disabled` or `.old` tail, a helper) is
# invisible to the disk side; (5) R2 proves a required job runs the collector's entrypoint, not that
# the run executes every file the source collects; (6) a source covered by a collectors.json entry
# that breaks R2 still counts as run in the summary and in R1; the run fails on R2 all the same, so
# the verdict holds and only the count reads high; (7) the static Part C clause that was to refuse a
# factory-owned key in either `mergeConfig` argument was retired on 2026-10-14, because the factory
# returns `mergeConfig(base, overrides)`, vite concatenates arrays and 0 of the 93 configs call
# `mergeConfig`, so no argument can drop the reserved excludes; the gap was the four hand-written
# configs, which C2 holds.
BASE_REF="${FITNESS_BASE_REF:-origin/main}"
BASE_QUARANTINE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/base-quarantine.json"
BASE_COMMIT=$(git rev-parse --verify --quiet "$BASE_REF^{commit}")   # expect exit 0: the ref names a commit
git show "$BASE_COMMIT:packages/test-contracts/quarantine.json" > "$BASE_QUARANTINE"   # expect exit 0
pnpm --filter @packages/test-contracts reach --quarantine quarantine.json --base "$BASE_QUARANTINE"   # expect exit 0 and:
#   reach: PASS
#   summary: <N> test-shaped tracked files; <C> collected by <S> sources, <R> of them run by a
#   required check; <P> vitest packages held to the script contract; <K> vitest configs held to
#   the exclude contract; 0 violations; 0 errors; quarantine shrink check ran

# 31. No vacuous-pass escape hatch in a test entry point. Two parts, hard-zero.
# Threat: a suite that collects ZERO tests and still exits 0. The nightly chaos
# job ran `vitest run tests/chaos/` for the life of that workflow against
# node:test files vitest's `include` globs never covered, collected nothing, and
# reported green over scenarios it never executed.
#
# Part A: no `passWithNoTests` in any tracked `*.json`, `*.ts`, `*.mts` or `*.yml`
# file of the repository, whichever directory it sits in: package manifests,
# vitest configs, scripts and the workflows that invoke vitest alike. Vitest
# defaults it to false — zero collected is exit 1 — so every occurrence is an
# explicit opt-OUT of the one default that notices an empty run, and it keeps
# reporting green forever once a rename or an `include` change breaks collection.
# The pattern is `pass[W]ithNoTests`: the workflow step is itself a tracked
# `.yml` file, and the bracket class keeps its own text from matching. The scope
# is held to a floor of PART_A_SCOPE_FLOOR files and a `git grep` exit above 1
# fails the step, so a missing checkout cannot read as a clean zero. Residual
# limit, stated: GitHub runs the step under `bash -e`, so it captures `git grep`'s
# exit 1, which means no match, with `|| ASTATUS=$?` and fails only on an exit
# above 1; a future shift of git's exit codes would surface through the
# PART_A_SCOPE_FLOOR floor and fitness #34's pairing rather than through that
# capture.
# Out of scope, stated: `*.yaml`, `*.js`, `*.mjs` and `*.cjs`. Measured on
# 2026-10-14: none holds the flag, the 4 `.yaml` files are the lockfile, the
# workspace manifest and two tool configs, and all 93 tracked vitest configs are
# `.ts`; a vitest config or script written in one of those extensions would
# escape this part.
# The repository tracks about 3,100 JSON, TypeScript and workflow files (3132 on
# 2026-10-16), so a count below 2500 means a partial checkout, not a smaller tree.
PART_A_SCOPE_FLOOR=2500
SCOPE=$(git ls-files -- '*.json' '*.ts' '*.mts' '*.yml' | wc -l) || SCOPE=0
[ "$SCOPE" -ge "$PART_A_SCOPE_FLOOR" ]   # expect exit 0 (3132 on 2026-10-16)
git grep -nE 'pass[W]ithNoTests' -- '*.json' '*.ts' '*.mts' '*.yml' | wc -l   # expect 0
#
# Part B: the node:test runner must KEEP its zero-collection guards and read its
# counts from the summary reporter. node:test has no equivalent default: it
# counts a file that registers no test as one passing test, and counts read from
# a formatted report parse as zero the day its text changes. So
# apps/api/scripts/run-tests.sh takes each file's counts from the one anchored
# `@@SUMMARY` line of scripts/testing/node-summary-reporter.mjs, which reads
# Node's documented test events and leaves that stand-in pass uncounted (design
# decision DD-7: Node ships no JSON reporter), and carries the zero check itself
# — once per file and once on the total. Both zero terms are pinned because
# deleting either restores the silent green with nothing left to notice it; the
# reporter's assignment is pinned, and the TAP reporter must be gone.
grep -c '\[ "\$tests" -eq 0 \]' apps/api/scripts/run-tests.sh          # expect >= 1
grep -c '\[ "\$TOTAL_TESTS" -eq 0 \]' apps/api/scripts/run-tests.sh    # expect >= 1
grep -c '^SUMMARY_REPORTER=.*/scripts/testing/node-summary-reporter\.mjs"$' apps/api/scripts/run-tests.sh   # expect >= 1
grep -c -- '--test-reporter=tap' apps/api/scripts/run-tests.sh   # expect 0

# 32. No committed skipped or focused test. CODING_STANDARDS §Zero Cancelled
# Tests states this as canon; nothing enforced it mechanically. A committed
# `.only(` is the sharper harm of the two: the runner then executes ONLY that
# test and every sibling in the file reports green without running.
# `forbidOnly: true` catches `.only` at RUNTIME, but only in the 5 of 83 vitest
# configs that set it; this catches both forms statically, in every package and
# both frameworks, before a runner is even chosen.
# Two deliberate non-matches:
#   - `.todo(` marks a test that was never written — a declared gap, not a
#     written test switched off. The canon forbids `.skip` and `.only`, not the
#     backlog marker.
#   - The runtime form `t.skip("...")` inside a node:test body is a conditional
#     skip decided at execution time, which a static grep cannot tell from a
#     legitimate one. It has its own gate: run-tests.sh fails any TIER-driven
#     batch that reports a non-zero skip count, which is the only place the
#     distinction (was the service supposed to be there?) is actually knowable.
grep -rnE "\b(it|test|describe|suite)\.(skip|only)\(" \
  apps/ packages/ --include="*.test.ts" --include="*.test.tsx" | \
  grep -vE "node_modules|/dist/" | wc -l   # expect 0

# 33. Every ROOT-level tsconfig reached by an `extends` from a workspace tsconfig
# MUST be listed in turbo.json `globalDependencies`. Threat: turbo hashes
# per-package inputs plus globalDependencies and NOTHING else, so a root config a
# package merely extends is invisible to that package's hash. Editing it
# invalidates ZERO cache entries and every dependent task replays a `dist`
# compiled with the PREVIOUS compiler settings (target, module, declaration,
# skipLibCheck) under a green exit code — a false green, reproduced end-to-end in
# docs/reports/CI_CACHE_INTEGRITY_AUDIT.md. Membership is a shell-pattern match
# because turbo accepts glob entries in globalDependencies — a literal compare
# would flag configs a glob already covers. The second pass walks ONE extends hop
# from every root config that is listed or demanded by the first pass: a
# root->root chain link (live today: tsconfig.build.base.json extends
# tsconfig.base.json) is equally invisible to every per-package hash, and since
# each properly listed link becomes checkable itself, longer chains are covered
# link by link. Two skips, both justified: non-relative extends targets resolve
# into node_modules and change only with the lockfile, which turbo already hashes
# on its own; targets that resolve inside a workspace directory stay covered by
# that package's own input hash — in-tree today every relative target resolves to
# a root config, so this second skip currently matches nothing. Hard-zero.
set -uo pipefail
GLOBALS=$(tr -d ' \n' < turbo.json | grep -oE '"globalDependencies":\[[^]]*\]' | \
  grep -oE '"[^"]*"' | tr -d '"' | grep -v '^globalDependencies$' || true)
listed() {
  # set -f keeps glob entries as case patterns instead of expanding them
  # against the working directory; restored on every return path.
  set -f
  for entry in $GLOBALS; do
    case "$1" in $entry) set +f; return 0;; esac
  done
  set +f
  return 1
}
MISSING=""
REACHED=""
for cfg in $(find apps packages infra -name 'tsconfig*.json' \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.next/*' \
    -not -path '*/.turbo/*' 2>/dev/null); do
  for target in $(grep -oE '"extends"[[:space:]]*:[[:space:]]*(\[[^]]*\]|"[^"]*")' "$cfg" 2>/dev/null | \
      grep -oE '"[^"]*"' | tr -d '"' | grep -v '^extends$' || true); do
    case "$target" in ./*|../*) ;; *) continue;; esac
    resolved=$(realpath -m --relative-to="$PWD" "$(dirname "$cfg")/$target" 2>/dev/null || true)
    case "$resolved" in "" | */*) continue;; esac
    REACHED="$REACHED $resolved"
    listed "$resolved" || MISSING="$MISSING$cfg -> $resolved\n"
  done
done
for cfg in tsconfig*.json; do
  [ -f "$cfg" ] || continue
  if ! listed "$cfg"; then case " $REACHED " in *" $cfg "*) ;; *) continue;; esac; fi
  for target in $(grep -oE '"extends"[[:space:]]*:[[:space:]]*(\[[^]]*\]|"[^"]*")' "$cfg" 2>/dev/null | \
      grep -oE '"[^"]*"' | tr -d '"' | grep -v '^extends$' || true); do
    case "$target" in ./*|../*) ;; *) continue;; esac
    resolved=$(realpath -m --relative-to="$PWD" "$(dirname "$cfg")/$target" 2>/dev/null || true)
    case "$resolved" in "" | */*) continue;; esac
    listed "$resolved" || MISSING="$MISSING$cfg -> $resolved\n"
  done
done
COUNT=$(printf "%b" "$MISSING" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 34. Every `::error` emitted from a workflow step MUST pair with a real failure
# mechanism (`exit <n>`, `exit "$VAR"`, `core.setFailed`) in the SAME step.
# `echo "::error..."` only ANNOTATES — the step still exits 0 and the run stays
# green, so an unpaired ::error is a failure that fails nothing. Pairing is
# per-STEP, not per-file: every ::error in fitness.yml pairs with an exit 1 in
# its own step and passes. `::warning` is out of scope — advisory by design
# (audit.yml carries intentional ones). Residual limits, stated honestly: this is
# a line-based tripwire, not a YAML parser — an emission not written as
# `echo "::error` (printf, github-script core.error) is invisible to it, and a
# mechanism named only in a comment inside the step satisfies the pairing.
# Hard-zero.
set -uo pipefail
VIOLATIONS=$(for wf in .github/workflows/*.yml; do
  awk -v f="$wf" '
    /^[[:space:]]*-[[:space:]]+(name|uses):/ {
      if (in_step && has_err && !has_fail) print f " line " start ": step emits ::error without exit/core.setFailed";
      in_step=1; has_err=0; has_fail=0; start=NR;
    }
    /echo "::error/ { has_err=1 }
    /exit[[:space:]]+[1-9]|exit[[:space:]]+"?\$[A-Za-z_]|core\.setFailed/ { has_fail=1 }
    END { if (in_step && has_err && !has_fail) print f " line " start ": step emits ::error without exit/core.setFailed" }
  ' "$wf"
done)
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 35. Every per-package turbo.json that declares `"outputs": []` for build MUST
# belong to a package whose build script is verdict-only (`tsc --noEmit`).
# Threat: an EMITTING build paired with `outputs: []` earns a green cache entry
# that restores NOTHING — every later cache hit replays "built" while the dist
# is missing (the silent-cache-of-nothing defect, the converse of ci.yml's
# no-output-files gate). The override is legitimate ONLY while the build writes
# no files; a build that starts emitting must delete the override in the same
# change. Hard-zero.
set -uo pipefail
VIOLATIONS=""
for tj in $(find apps packages infra -name 'turbo.json' -not -path '*/node_modules/*' 2>/dev/null); do
  tr -d ' \n' < "$tj" | grep -q '"build":{[^}]*"outputs":\[\]' || continue
  pkg="$(dirname "$tj")/package.json"
  script=$([ -f "$pkg" ] && tr -d '\n' < "$pkg" | grep -oE '"build":[[:space:]]*"[^"]*"' | head -1 || true)
  printf '%s' "$script" | grep -qE 'tsc[^"]*--noEmit' || VIOLATIONS="$VIOLATIONS$tj -> ${script:-no build script}\n"
done
COUNT=$(printf "%b" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 36. Every POSITIVE scope glob of every vitest config matches at least one tracked file.
# Threat: a scope glob that matches nothing is a gate reporting green over code it never read: a
# `test.include` glob that collects no file, or a `coverage.include` glob whose floor is measured
# over no file. It is the CLASS "dead scope = infallible gate", whose third occurrence created this
# check: fitness #2/#3/#4 grepped relocated directories, and the per-glob coverage thresholds kept
# "gating" `src/domain/**` + `src/application/**` after both layers moved to packages/core. Its
# first form read the include arrays of apps/api/vitest.config.ts alone, as text, so the other
# configs went unread: resolving them all found `tests/**/*.test.tsx` in
# packages/query-client/vitest.config.ts, matching no file, and the glob was deleted.
# WHAT IT RUNS: `pnpm --filter @packages/test-contracts scopes`, packages/test-contracts/src/scopes.ts,
# pinned by tests/scopes.test.ts beside the reach engine's suites, which Package Tests runs. It lists
# the tracked files with `git ls-files` and resolves every tracked `vitest.config.*` with vitest's
# own config loader (`createVitest`, through `withVitest`, the vitest collector's resolution), so it
# reads the globs a run applies: the shared factory's merge, `projects` and vitest's defaults
# included. Two scopes: the `test.include` of every project, relative to the project's directory,
# and the root config's `coverage.include`, relative to its root, wherever a config sets one. Each
# positive glob must match at least one tracked file, and each scope must hold at least one positive
# glob (rule S1).
# POSITIVE globs only, deliberately: a negation matching zero files is inert PROTECTION — harmless
# fat — and flagging it would push authors to delete real exclusions to get green. A glob is a
# negation the way tinyglobby, vitest's globber, reads one: a leading `!` not followed by `(`.
# WHERE IT RUNS, and why: the `test-contracts` job of fitness.yml (check `Test Contracts`), beside
# #30, not the Fitness Functions job: resolving a config loads it and everything it imports, so the
# check needs the installed tree, which the Fitness Functions job never installs.
# FAIL-CLOSED, exit 1: fewer than 80 tracked vitest configs (`VITEST_CONFIG_FLOOR`, the vitest
# collector's own floor), a config vitest cannot resolve (named with its error, never a silent
# zero), a scope with no positive glob, and a file listing that fails. A usage error exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) `coverage.include` is read only where a config
# sets one, apps/api alone today, until coverage is measured in every package (WU-5.1); (2) no
# Playwright project is read, so one that collects no spec stays unseen until the E2E reconstruction
# brings Playwright projects here; (3) resolution runs vitest's config loader, so a config with side
# effects at import runs them; (4) matching is Node's `path.matchesGlob` over the tracked files,
# which agrees with vitest's picomatch on the forms the tree uses (`**`, braces, extglobs, classes)
# and is the stricter of the two on dot-named segments: its wildcards skip them, so a glob whose only
# files sit under a dot-named directory reached by a wildcard reads as dead, a false red and never a
# false green; (5) a glob whose every file an `exclude` removes still passes: the check proves the
# scope names files, not that a run keeps them, which is #30's part.
pnpm --filter @packages/test-contracts scopes   # expect exit 0 and:
#   scopes: PASS
#   summary: <R> of <C> tracked vitest configs resolved; <G> positive scope globs checked;
#   0 violations; 0 errors

# 37. Coverage threshold floors never descend vs the PR base. The four literal
# thresholds in apps/api/vitest.config.ts (lines/functions/branches/statements)
# are a RATCHET: `autoUpdate` raises each number to the measured value in the
# commit that earns it, so the only hand-written move this guard must reject is
# a LOWERED number. Runs on `pull_request` only — its subject is the PR's delta
# against its base, which a push run does not have (the CI step skips cleanly
# there; locally it compares against origin/main, or set FITNESS_BASE_REF to any
# ref/sha — CI passes the PR base sha through that same env var).
#
# WHAT IT RUNS: `node scripts/testing/coverage-floor-gate.mjs`, the rule in one
# script, pinned by apps/api/tests/unit/scripts/coverageFloorGate.test.ts. The CI
# step runs the same command after resolving the base: the checkout is shallow, so
# it fetches an unresolvable base in up to 3 bounded attempts first. Node built-ins
# only, because the Fitness Functions job installs nothing. Until 2026-10-29 the
# rule was a node heredoc written twice, byte for byte, here and in the step, with
# no suite: every change edited both copies and proved its red by hand.
#
# WHAT IT READS: the GLOBAL `thresholds: {` block only, with block-comment bytes
# dropped and per-scope blocks (nested one level deeper) ignored. Both matter. A
# `/* */` wrapped around the live block left the four literals byte-identical to
# a line scanner, so the first form of this guard kept comparing numbers that no
# longer configured anything; and a per-scope block — which CODING_STANDARDS
# §Coverage Targets requires (Domain 90 / Application 85 / Infrastructure 70) —
# made it see two `lines:` and refuse to run, which reads as a broken check and
# teaches the author to edit the guard instead of the coverage.
#
# FAIL-CLOSED ON BOTH SIDES. Head: no global block, or more than one literal per
# metric at its top level, exits 1. Base: absent-on-base still passes BY METRIC
# (a base with ZERO literals for a metric is the pre-ratchet format and has no
# comparable floor), but TWO or more is ambiguity and exits 1 as well — while the
# base side merely `continue`d, a base of 90/90/90/90 carrying a per-scope block
# let a descent to 56.9 through on all four metrics at once. An unresolvable base
# ref exits 1: in CI after 3 bounded fetch retries, with a message that names the
# transient possibility so a network blip is not read as a violation, and in the
# script itself whenever FITNESS_BASE_REF names no commit.
#
# THE LEGITIMATE DESCENT, implemented rather than only named: deleting covered
# code can lower aggregate coverage. That descent ships with a
# `// canon-exception: <scenario>` marker — scenario from the §Pragmatic
# Exceptions allowed list — on the lowered literal's own line or the line
# directly above it, and the guard accepts THAT metric while logging what it
# accepted and why. The marker rides in the diff, so a human still approves it in
# review. The first form named this path in its `::error` without implementing
# it: the step is a REQUIRED context, so the only real exit was an admin
# override, and a guard whose stated remedy does not work teaches people to
# delete the guard. A scenario listed in SUBJECTS names its subject after a
# colon, in that grammar: `decorative-demolition:2.8.1a` names the demolition
# slice the committed ledger lists (ADR-0039), and the bare scenario is not
# honoured. A marker already on the base for that metric is refused; each descent
# carries its own. Remove-when: never — a marker answers for the one descent it
# shipped with, and one left above a literal would otherwise wave every later
# drop through.
#
# SLICE MEMBERSHIP (ADR-0039). A `decorative-demolition:<id>` marker is honoured
# only when head's ledger.json lists the slice `<id>`, records it deleted, and
# records a descent of that metric whose `from` and `to` are the base's literal and
# the head's, and when the base's ledger.json (read with `git show`) does not
# already record it deleted: the marker belongs only in the pull request that
# deletes the slice's tests. Each refusal names the id and the metric. The ledgers
# are read only when such a marker answers for a descent, and one that is absent
# from either side, no JSON, or without a `slices` object of slice objects fails
# closed; a marker of any other scenario never reads them.
#
# EXIT CODES: 0 no floor lowered without a marker of its own; 1 a lowered floor,
# or an input the gate could not read; 2 a usage error (the command takes no
# argument).
#
# RESIDUAL LIMITS, stated rather than implied: (1) only apps/api/vitest.config.ts
# and its global block are read, until #37 is rebuilt over every config; (2)
# membership proves the ledger records the slice's deletion and its descent, never
# that the deletion explains the descent: the review of the deletion pull request reads
# that, since the tracker that compared the expected drop with the real one left the
# tree on 2026-11-10 (ADR-0044); (3) the ledger
# read is the committed one, and that it matches the tree is #52's part.
# Hard-zero.
node scripts/testing/coverage-floor-gate.mjs   # expect exit 0 and:
#   coverage-floor-gate: 4 floors of apps/api/vitest.config.ts compared with <base>
#   (<sha>): 0 lowered with no honoured marker

# 38. Soft-delete read coherence: no read of a swept soft-deletable model without
# its deletedAt filter. Closes the CLASS behind B-READS: the delete went soft and
# ~90 read sites kept returning rows the tenant had deleted — including
# getProjectAccess, an access GATE — while every suite stayed green. Per-site
# fixes drift back; this holds the class.
# SCOPE, two lists, both fail-closed against drift:
#   - SWEPT: the four models whose read surface the sweep covers
#     (account, channel, post, project) — every read of them is checked.
#   - UNSWEPT quarantine: six models that carry deletedAt (most with live
#     soft-delete writers) whose read surface was never swept. A measured
#     residual, not a pass — sweeping them is its own body of work (the plan
#     row SOFTDELETE-READ-SWEEP, docs/product/plan/cross-cutting.md). The list may only
#     SHRINK (floor 6, enforced): enrolling a model moves it to SWEPT in the
#     same change that sweeps its reads.
#   A deletedAt-bearing model in NEITHER list fails outright, so a NEW
#   soft-deletable model cannot land unswept and unnoticed — the drift class
#   that let DeletionRecord land unenrolled (#39 is this gate's tenant-guard
#   twin), and a listed name whose column is gone fails too, so no stale slot
#   can be inherited.
# PASS RULES per hit: (a) `deletedAt` inside the call window (call line + 9
# lines); findUnique/findUniqueOrThrow are ALWAYS flagged — their where takes
# unique fields and the swept convention for live reads is findFirst; (b) the
# greppable marker `DELIBERATE soft-delete-sweep exception` within 15 lines
# above through 9 below — the sweep's convention for reads that MUST see
# soft-deleted rows (restore, hard-delete probes/snapshots, impact counts,
# version-conflict recovery, the publish worker's SOFT_DELETED classifier); (c)
# a named file exception below. Lines carrying `typeof` are skipped
# (type-position references, not executed queries).
# packages/adapters/db-prisma is NOT excluded — it is RATCHETED. An earlier
# form of this check excluded that directory outright, on the stated premise
# that it held "dead unwired duplicates already flagged for deletion". That
# premise is FALSE, and was measured false: `createPrismaRepoAdapter` is
# imported by apps/api/src/index.ts, apps/api/src/health/healthRoutes.ts,
# apps/workers/src/publishWorker.ts and apps/workers/src/mentionIngestWorker.ts,
# and it constructs the Account / Project / Post / Channel / Thread
# repositories in that package (UNUSED_CODE_INVENTORY.md marks only cached.ts
# and its neighbours delete-recommended; it records the 7 repo factories as
# CONSUMED). Their unfiltered reads are live — 12 at the original measurement,
# 11 once the publish-worker liveness gate marked its deliberate read —
# including ChannelRepository.ts `getChannelOwnerAccountId`, an OWNERSHIP read
# of exactly the getProjectAccess shape that motivated this gate. So a blanket
# exclusion was not a scope decision, it was live B-READS held invisible by a
# false sentence. Sweeping them changes publish-worker and health-route
# behaviour and needs its own tests, so it is owned as SMELL-87 rather than
# done blind here; meanwhile the directory is SCANNED by the same detection and
# its count held against DBPRISMA_BASELINE — it may fall and must never rise,
# so a new unfiltered read there goes red today. RE-MEASURE the count in the
# integration commit and set the baseline to that measured value (the two
# concurrent B1 slices move it); delete the baseline together with the last
# remaining read (or with the package).
# FILE EXCEPTIONS — every entry audited-safe or adjudicated by the Product Owner, each with a
# remove-when; the list may only shrink. Five entries LEFT the previous form of
# this list: PrismaAccountRepository, PrismaProjectRepository and
# PrismaChannelRepository now carry the greppable marker at their hard-delete
# probe/tombstone/impact sites, and projectRoutes + accountRoutes were FIXED
# outright once the partial-unique migration landed (their duplicate name/email
# checks are findFirst + deletedAt: null now — the remove-when was satisfied).
#   - PrismaPostRepository.ts + PrismaPostQueryRepository.ts: reads flow through
#     in-file where-builders that seed `deletedAt: null` (audited: the
#     status-filtered list/count `where` objects, `buildWhereClause`, and the
#     account-scoped list builder) — the seed sits ABOVE the call, outside the
#     detection window. The deliberate sites (hard-delete probe,
#     version-conflict recovery) carry the greppable marker already.
#     Remove-when: the builder reads sit within the window.
#   - SchedulingPostHandlers.ts: whereClause seeded `deletedAt: null` at the
#     builder top (fixed in this sweep), calls beyond the window (audited-safe).
#   - CustomerAccountBillingService.ts + gatewaySwitchProcessor.ts +
#     realtimeWebhookBroadcaster.ts + PrismaAccountBillingRepository.ts:
#     FLAGGED deliberate-candidates — billing webhooks, gateway switches and
#     realtime broadcasts may legitimately resolve a deleted row. Product Owner
#     decision pending; each gets the filter or the marker when adjudicated.
# RESIDUAL LIMITS, stated honestly (the form every check of this suite follows):
#   (1) a where built by a distant builder or variable is invisible — that
#   limit IS the builder-file exceptions above, made explicit; (2) soft-delete
#   does NOT cascade, and the grep only sees that `deletedAt` appears
#   SOMEWHERE in the window, not at the right level — a leaf-only filter on a
#   cross-account read still leaks a soft-deleted project's live children;
#   (3) windows are line-based: a where past 9 lines, a marker past 15,
#   spread/string-built objects — all invisible; (4) nested reads THROUGH a
#   soft-deletable relation on a non-swept accessor
#   (analytics.findMany({ where: { post: ... } })) are not matched at all;
#   (5) a whole-file exception exempts FUTURE reads in that file — the price of
#   not planting lying markers on safe sites; shrink the list; (6) the
#   db-prisma stream is a COUNT, so a new violation there can be masked by
#   fixing an older one in the same change — the standard ratchet tradeoff
#   (#30's), accepted because the alternative on offer was a blanket exclusion
#   that masked every live read permanently. The durable
#   complement (in SOFTDELETE-READ-SWEEP's DoD) is a dev/test-only Prisma $extends that throws on an
#   unfiltered soft-deletable read — it closes (1)-(4) at runtime. Hard-zero.
set -uo pipefail
SCHEMA=infra/prisma/schema.prisma
SWEPT="account channel post project"
UNSWEPT="conversationNote customerUser mediaAsset postComment task template"
DBPRISMA=packages/adapters/db-prisma
DBPRISMA_BASELINE=11
for d in apps/api/src apps/workers/src packages "$DBPRISMA"; do
  [ -d "$d" ] || { echo "fitness #38 scope error: '$d' does not exist — the read scan would silently skip it. If $DBPRISMA was deleted, delete its ratchet here and in fitness.yml in the same change; a baseline naming an absent directory is a gate measuring nothing."; exit 1; }
done
ALL=$(awk '/^model /{m=$2} /^[[:space:]]+deletedAt[[:space:]]/{print tolower(substr(m,1,1)) substr(m,2)}' "$SCHEMA" | sort -u)
[ -n "$ALL" ] || { echo "fitness #38 scope error: zero deletedAt-bearing models extracted from $SCHEMA — the column convention changed or the schema moved; the check would scan for nothing and pass, failing closed instead."; exit 1; }
[ "$(echo $UNSWEPT | wc -w)" -le 6 ] || { echo "fitness #38 scope error: the UNSWEPT quarantine grew past its floor of 6 — it may only shrink. A new soft-deletable model is enrolled by sweeping its reads, not by quarantining it."; exit 1; }
for m in $ALL; do
  case " $SWEPT $UNSWEPT " in *" $m "*) ;; *)
    echo "fitness #38 scope error: model '$m' carries deletedAt but is in neither the SWEPT set nor the UNSWEPT quarantine — sweep its reads and add it to SWEPT (or quarantine it with an owning row of the plan, docs/product/plan/)."; exit 1;;
  esac
done
for m in $SWEPT $UNSWEPT; do
  printf '%s\n' "$ALL" | grep -qx "$m" || { echo "fitness #38 scope error: '$m' is listed but no longer carries deletedAt in $SCHEMA — delete the stale name so a future model cannot inherit its slot."; exit 1; }
done
MODELS=$(printf '%s|' $SWEPT); MODELS=${MODELS%|}
EXCEPTIONS='/PrismaPostRepository\.ts:|/PrismaPostQueryRepository\.ts:|/SchedulingPostHandlers\.ts:|/CustomerAccountBillingService\.ts:|/gatewaySwitchProcessor\.ts:|/realtimeWebhookBroadcaster\.ts:|/PrismaAccountBillingRepository\.ts:'
# ONE detection, two streams: the swept tree is hard-zero, db-prisma is the
# same scan held against its baseline. Identical logic by construction — a
# second copy would drift.
scan_reads() {
  grep -rnE "\.($MODELS)\.(findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|count|aggregate|groupBy)\b" \
      "$@" --include="*.ts" | \
    grep -vE "/node_modules/|/dist/|/tests/|\.test\.ts:" | \
    grep -vE "$EXCEPTIONS" | grep -v "typeof " | \
    while IFS= read -r hit; do
      file=${hit%%:*}; rest=${hit#*:}; ln=${rest%%:*}
      from=$((ln - 15)); [ "$from" -lt 1 ] && from=1
      sed -n "${from},$((ln + 9))p" "$file" | grep -q "DELIBERATE soft-delete-sweep exception" && continue
      if sed -n "${ln},$((ln + 9))p" "$file" | grep -q "deletedAt" && \
         ! printf '%s' "$hit" | grep -qE "\.findUnique(OrThrow)?\b"; then
        continue
      fi
      printf '%s\n' "$hit"
    done
}
VIOLATIONS=$(scan_reads apps/api/src apps/workers/src packages | grep -vF "$DBPRISMA/") || true
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
DBPRISMA_HITS=$(scan_reads "$DBPRISMA") || true
DBCOUNT=$(printf "%s" "$DBPRISMA_HITS" | grep -c . || true)
DBCOUNT=${DBCOUNT:-0}
echo "$COUNT"   # expect 0
echo "$DBCOUNT"  # ratchet — held at DBPRISMA_BASELINE above (SMELL-87); may fall, must never rise

# 39. Every accountId-bearing Prisma model is tenant-guard-enrolled OR in the
# documented cross-tenant denylist. The gate whose absence let DeletionRecord
# land carrying accountId with neither TENANT_SCOPED_MODELS nor any documented
# denylist knowing it existed: the $extends guard silently SKIPS a model it
# does not know (fail-open by construction), so an unenrolled accountId-bearing
# model is cross-tenant by default (CWE-639). Membership is DERIVED, never
# hand-listed: bearing models from schema.prisma (any accountId column —
# optional ones count: AuditLog's searchability column is exactly that shape,
# and optionality does not exempt a model from deciding which side it is on);
# enrollment from the TENANT_SCOPED_MODELS Set in tenantGuard.ts (lowerCamel,
# the Prisma client accessor casing); denylist from the fenced table grid under
# "## Global tables (denylist — guard bypasses)" in
# docs/security/MULTI_TENANT_GUARDS.md (PascalCase; AuditLog and DeletionRecord
# are its two accountId-bearing entries, each with a design note there —
# DeletionRecord deliberately OUTLIVES its tenant: a tombstone scoped to the
# tenant it records would be destroyed by the very deletion it exists to
# witness).
# FAIL-CLOSED: a missing file, zero bearing models, zero enrolled names, or
# zero denylist names is a blind comparison, not a clean one — each exits 1.
# RESIDUAL LIMITS, stated honestly: (1) textual extraction — a renamed Set or
# heading fails closed rather than passing silently, but a SECOND fenced block
# inserted ABOVE the grid inside that doc section would be read as the denylist
# (keep that section prose-only above the grid); (2) the denylist proves
# DOCUMENTATION, not correctness — a model wrongly denylisted passes here and
# is caught in review of the .md diff, exactly like a #30 quarantine reason; (3)
# enrollment proves the guard KNOWS the model, not that RLS or every read path
# is right. Hard-zero.
set -uo pipefail
SCHEMA=infra/prisma/schema.prisma
GUARD=infra/prisma/src/extensions/tenantGuard.ts
DOC=docs/security/MULTI_TENANT_GUARDS.md
for f in "$SCHEMA" "$GUARD" "$DOC"; do
  [ -f "$f" ] || { echo "fitness #39 scope error: $f does not exist — the check would compare against nothing and pass, failing closed instead."; exit 1; }
done
BEARING=$(awk '/^model /{m=$2} /^[[:space:]]+accountId[[:space:]]/{print m}' "$SCHEMA" | sort -u)
[ -n "$BEARING" ] || { echo "fitness #39 scope error: zero accountId-bearing models extracted from $SCHEMA — the column convention changed; failing closed."; exit 1; }
SCOPED=$(sed -n '/TENANT_SCOPED_MODELS = new Set/,/\]);/p' "$GUARD" | grep -oE '"[^"]+"' | tr -d '"')
[ -n "$SCOPED" ] || { echo "fitness #39 scope error: TENANT_SCOPED_MODELS extraction from $GUARD yielded zero names — the Set was renamed or is assembled at runtime; failing closed."; exit 1; }
DENY=$(sed -n '/^## Global tables (denylist/,/^## /p' "$DOC" | sed -n '/^```/,/^```/p' | tr -s ' ' '\n' | grep -E '^[A-Z][A-Za-z0-9]*$' || true)
[ -n "$DENY" ] || { echo "fitness #39 scope error: the fenced table list under '## Global tables (denylist — guard bypasses)' in $DOC yielded zero names — the heading or the grid moved; failing closed."; exit 1; }
VIOLATIONS=$(for model in $BEARING; do
  lower=$(printf '%s' "$model" | awk '{print tolower(substr($0,1,1)) substr($0,2)}')
  printf '%s\n' "$SCOPED" | grep -qx "$lower" && continue
  printf '%s\n' "$DENY" | grep -qx "$model" && continue
  echo "$model: accountId-bearing but neither enrolled in TENANT_SCOPED_MODELS nor named in the documented denylist"
done) || true
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 40. One transaction seam. An ALLOWLIST, the #28 form, in TWO parts.
#
# Threat: layer 2 of tenant isolation is a transaction-local GUC, so a statement is covered
# only if the transaction it runs in bound `app.account_id` first — and an operation that
# opens a transaction of its own leaves its caller's connection, taking its caller's rollback
# with it. Both properties come from ONE seam: `withGucBoundTransaction` binds the scope and
# holds the marker that stops the per-operation binding from re-wrapping anything inside it. A
# transaction opened any other way in application code silently opts out of both.
#
# ALLOWLIST, not denylist, for the #28 reason: the dangerous set is open-ended (a raw batch
# array, a hand-rolled interactive transaction, a future helper that forgets the marker, a
# call that passes a hand-built scope), while the admissible set is small and nameable. So
# each part names what IS allowed and counts everything else, instead of trying to predict
# the next wrong shape.
#
# Home is fitness, not the integration tier: unlike the pg-catalog RLS-coverage gate, whose
# subject is database state a grep cannot read, this invariant is a CALL SHAPE in source —
# exactly what a grep decides.
#
# PART A — no `.$transaction(` in application code outside the three NAMED seams.
# `withGucBoundTransaction` lives in `infra/prisma/src/extensions/tenantGuc.ts`, outside this
# scope, so a call site that goes through it contains no `.$transaction(` at all. The named
# seams are the transaction openers the design keeps: `PrismaUnitOfWork` (which binds the GUC
# and holds the marker itself), `sagaTenant.ts` (the engine's two primitives, which open
# THROUGH the helper), and `db-prisma/ChannelRepository.ts` (the shipped worker-side explicit
# pattern). Comment lines are dropped so prose naming `prisma.$transaction()` is not counted.
#
# `PrismaUnitOfWork` lives at `packages/adapters/db-prisma/src/unitofwork/` since the Post
# persistence adapters were relocated there. The `/saga/sagaTenant\.ts:` term is INERT —
# measured: `apps/api/src/saga/sagaTenant.ts` holds ZERO `.$transaction(` calls (its two
# primitives open THROUGH `withGucBoundTransaction`), so the floor of 3 is carried by TWO
# files: `PrismaUnitOfWork.ts` once and `db-prisma/src/ChannelRepository.ts` twice. The term
# stays listed until its deletion is authorised, and it is named here so a reader does not
# trust a list that is one-third fiction.
#
# FAIL-CLOSED. A zero that comes from the pattern no longer matching anything is not a clean
# scan, it is a blind one: renaming the client method, moving the seams, or dropping the
# scope directory would each print 0 forever. So the seams' own occurrences are counted and
# held against a floor.
set -uo pipefail
for d in apps/api/src packages/adapters/db-prisma/src; do
  [ -d "$d" ] || { echo "fitness #40 scope error: '$d' does not exist — the scan would skip it silently and print 0."; exit 1; }
done
TX_SEAMS='/db-prisma/src/unitofwork/PrismaUnitOfWork\.ts:|/saga/sagaTenant\.ts:|/db-prisma/src/ChannelRepository\.ts:'
tx_calls() {
  grep -rnE "\.\\\$transaction\(" apps/api/src packages/adapters/db-prisma/src --include="*.ts" | \
    grep -vE "/node_modules/|/dist/|/tests/|\.test\.ts:" | \
    grep -vE "^[^:]+:[0-9]+:[[:space:]]*(\*|//)"
}
SEAM_HITS=$(tx_calls | grep -cE "$TX_SEAMS" || true)
if [ "${SEAM_HITS:-0}" -lt 3 ]; then
  echo "fitness #40 scope error: the named seams hold ${SEAM_HITS:-0} \`.\$transaction(\` calls against a floor of 3 — the method was renamed, a seam moved, or the scan stopped matching. Failing closed rather than reporting a clean zero over code it never read."
  exit 1
fi
COUNT=$(tx_calls | grep -vE "$TX_SEAMS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0
#
# PART B — the scope a seam call binds is DERIVED, never hand-built. Closes the residual the
# seam alone leaves open: `withGucBoundTransaction(client, scope, fn)` takes any string, so a
# future site could call `getTenantContext()` itself, or read a request field, and mint a
# scope that disagrees with the one layer 1 injected. `getAmbientGucScope()` resolves it from
# the SAME provider object the tenant guard reads, which is what makes "one provider, no
# second source of tenant truth" a property of the code rather than a habit.
#
# The saga is the one deliberate exception and it is named rather than tolerated: its two
# primitives take the account explicitly because a saga step runs with no ambient request,
# and `sagaTenant.ts` is the module that exists to keep that surface narrow.
#
# Window is the call line plus 3, which covers both the single-line form and the wrapped one
# (`client,` / `getAmbientGucScope(),` on their own lines). A call whose scope argument is
# further away than that is not readable at the call site either, and is a violation for the
# same reason.
#
# The relocated `@core/domain` adapters under packages/adapters/db-prisma/src/{post,outbox,unitofwork}
# have no ambient request either: they take a TenantContextProvider by constructor and derive the
# scope as `resolveGucScope(this.tenantProvider)` — the same function `getAmbientGucScope()` wraps,
# over the provider the composition root handed them. That is the second admissible expression, and
# those three directories are Part B's second scope; each must exist or the check fails closed, which
# also pins the relocation's layout. The FLAT db-prisma files (MentionRepository.ts,
# ProjectRepository.ts, PostRepository.ts — 6 sites measured) keep the explicit-scope worker
# convention and stay OUTSIDE Part B, as residual (4) states; they were not exempted by file because
# the exempt list may only shrink.
PART_B_SCOPE="apps/api/src packages/adapters/db-prisma/src/post packages/adapters/db-prisma/src/outbox packages/adapters/db-prisma/src/unitofwork"
for d in $PART_B_SCOPE; do
  [ -d "$d" ] || { echo "fitness #40 scope error: Part B scope '$d' does not exist — a relocated adapter home is gone, and the scan would skip it silently and print 0."; exit 1; }
done
SCOPE_EXEMPT='/saga/sagaTenant\.ts:'
seam_call_sites() {
  grep -rnE "withGucBoundTransaction\(" $PART_B_SCOPE --include="*.ts" | \
    grep -vE "/node_modules/|/dist/|/tests/|\.test\.ts:" | \
    grep -vE "^[^:]+:[0-9]+:[[:space:]]*(import|\*|//)" | \
    grep -vE "$SCOPE_EXEMPT"
}
SITES=$(seam_call_sites | grep -c . || true)
if [ "${SITES:-0}" -lt 10 ]; then
  echo "fitness #40 scope error: ${SITES:-0} seam call sites found against a floor of 10 — the helper was renamed or the adoption was undone. Failing closed."
  exit 1
fi
UNDERIVED=$(seam_call_sites | while IFS= read -r hit; do
  file=${hit%%:*}; rest=${hit#*:}; ln=${rest%%:*}
  sed -n "${ln},$((ln + 3))p" "$file" | grep -qE "getAmbientGucScope\(\)|resolveGucScope\(this\.tenantProvider\)" || printf '%s\n' "$hit"
done)
BCOUNT=$(printf "%s" "$UNDERIVED" | grep -c . || true)
BCOUNT=${BCOUNT:-0}
echo "$BCOUNT"   # expect 0
#
# RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a parser: a call reached
# through an alias (`const t = prisma.$transaction`) or built by string is invisible — the
# floors above turn a wholesale rename into a red, but not a single deliberately obfuscated
# call. (2) Part B proves the scope EXPRESSION, not that the provider behind it is the guard's
# — that one is structural instead, because `getAmbientGucScope()` and the guard read the same
# exported `ambientTenantContextProvider` object; at the relocated sites the provider's identity
# is a property of the composition root instead, proven by `setupRepositories.test.ts` and
# `tenantGucTransactionBinding.integration.test.ts`. (3) A whole-file seam exemption exempts
# future calls in that file; the exempt list is `sagaTenant.ts` alone and may only shrink.
# (4) The FLAT `packages/adapters/db-prisma` files are in Part A's scope but not Part B's: they
# have no ambient request to derive from, and their explicit-scope convention is the shipped
# worker pattern. Its `{post,outbox,unitofwork}` subdirectories are in BOTH — the relocated
# adapters derive their scope from an injected provider, so the derivation is greppable there.
# (5) `apps/workers/src` IS OUTSIDE BOTH PARTS, and its transactions are therefore UNGATED.
# Part A's scope is `apps/api/src` + `packages/adapters/db-prisma/src`; Part B's is
# `apps/api/src` plus those three relocated subdirectories. Measured at the time of writing: 2
# `.$transaction(` calls live there
# — `services/ChannelAuthFailureRecorder.ts` and `mentionIngestWorker.ts` — and neither part
# reads them. The exclusion is deliberate (the worker process has no ambient request to derive
# a scope from) and is declared in this change's tasks under 6b.7; converting that seam belongs
# to the links that own the worker process. It is named HERE because a residual a future reader
# cannot see in the gate is not a stated residual, and this is the check they will read.

# 41. Single-use claim shape. An ALLOWLIST-by-shape gate in the #28/#40 form, and the CLASS gate the
# admin reset/rotation slice (SMELL-97) owes: a Prisma write whose `data` carries a CONSUMPTION MARKER
# for a single-use credential must name that credential's prior state in the SAME call's `where`.
#
# Threat, in one line: a consuming write that does not name the credential it consumes lets two callers
# consume it once each. Keyed on `{ id }` alone the write matches whether or not the credential still
# exists — EvalPlanQual re-checks only the columns the WHERE names, and `id` is never contested — so two
# presentations of ONE token both pass the read and both write, and the last writer owns the account.
# Named, the write is a compare-and-swap the database serialises, and `count` is the verdict.
#
# POPULATION, measured when the gate landed: 8 marker sites = 7 claim sites + 1 named issuance exception.
# Of the 7 claims, 2 were unsound before this gate's slice and 0 after —
# PasswordService.confirmPasswordReset and authServiceSession.refreshTokens are the two it converted; the
# customer reset claim and the four MFA claims were already sound. SITE_FLOOR holds that population: the
# floor may fall and must never rise — it falls only with the deliberate removal of a site, never to
# absorb a new violation.
# ALLOWLIST by shape: the dangerous set is open-ended, the admissible shape is one sentence. MARKERS are
# the literal `data` forms that consume a credential today:
#   passwordResetToken: null     admin reset consumed
#   resetToken: null             customer reset consumed
#   mfaBackupUsedAt: <value>     backup-code used-map extended (`{}` is a re-enrolment
#                                RESET, excluded by the lookahead)
#   mfaLastUsedTotpStep: <value> TOTP step advanced
#   refreshTokenHash <: , }>     refresh token rotated — the property-shorthand form
#                                `{ refreshTokenHash }` is matched too, so a rotation
#                                is never exempt by syntax
# STRUCTURAL, not line-windowed: each `.update(` / `.updateMany(` / `.upsert(` call's argument is sliced
# to its balanced close (this step's own string- and comment-aware slicer); the `data:` literal (`update:` for upsert)
# is tested for a marker, whose column must then appear as a key in that SAME call's `where:` literal. A
# `select:` cannot satisfy the gate — a line window could not tell the two apart.
# NAMED EXCEPTION, exactly one, held to exactly ONE site so a second write in that file fails closed:
# PrismaAdminSessionRepository.updateRefreshTokenHash is the second step of session ISSUANCE —
# createSession inserts a throwaway hash nobody holds, mints the JWT that embeds the new session id, then
# swaps the real hash in — so no presented credential is consumed. Remove-when: the session id is minted
# before the insert and the final hash written on create. The exemption keys on FILE + COLUMN while its
# justification is a property of the CALLERS: it is sound only while updateRefreshTokenHash has ONE
# caller (verified tree-wide at apply: authServiceCore.ts:383, inside createSession) — a second consuming
# caller would inherit it unseen.
# OUT OF CLASS by decision, not oversight — writes this gate is silent on, and why: idempotent session
# revocations (`isActive: false` keyed on `isActive: true`; revoking twice is one state); the outbox
# work-item lease (a lease, not a credential); the customer refresh flow (a stateless JWT with NO
# server-side consumption marker — SMELL-113's subject, not a marker site); the SECOND admin refresh flow
# (`AdminAuthService.refreshToken`, the ADMIN_JWT_*/TokenService family: compares the stored hash and
# issues only a new ACCESS token — it never rotates, so there is no consuming write for this gate to see;
# its lifetime-of-token non-rotation is its own plan row, DEF-164 (SMELL-118), the admin twin of SMELL-113); and the admin
# reset ISSUANCE that writes the "CHANGE_REQUIRED" sentinel (an issuance, not a consumption — SMELL-110).
# FAIL-CLOSED: a missing scope directory, fewer than SITE_FLOOR marker sites, or an exception count other
# than 1 is a blind scan, not a clean one — exit 1. SCOPE: apps/api/src apps/workers/src packages
# infra/prisma/src, *.ts, minus node_modules/dist/tests/generated. infra/prisma/scripts is OUT
# by path: the backfill's `data: { passwordResetToken: null }` keyed on id is the `migration`
# canon-exception scenario (a one-off over rows it selected itself), and so is every future script there
# — stated, not hidden.
# RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a type-checker: `data` or `where` passed
# by identifier, spread, or built by a helper is invisible — the generic `update(id, data)` helpers on
# the admin-user and MFA adapters are exactly that shape; a claim routed through one must be enrolled by
# hand. (2) The gate proves the column is NAMED in `where`, not that the predicate is right
# (`refreshTokenHash: { not: null }` would pass); the racers own the predicate. (3) The marker list is
# enumerated, not derived from the schema — "single-use" is not a schema property — so a NEW credential
# column is invisible until its marker is added (the How-to-extend step). (4) Cache-backed consumption
# (`OAuthFlowStore.consume`, a read-then-delete outside Prisma) and raw SQL (fitness #23's domain, itself
# blind to tagged templates — SMELL-111) are outside. (5) `upsert`'s `create` arm is not checked:
# creation issues, never consumes. (6) The slicer keeps string-literal bytes and knows no regex literals:
# a marker inside a string is a false positive it does not filter, and a regex literal with an unbalanced
# brace or quote inside a write call mis-slices that call — at a marker site the site is dropped, which
# the floor turns into exit 1 (fail-closed); neither exists in scope today. (7) Line-window matching is
# NOT a limit here: the #38 form pairs `data` and `where` inside a bounded window and misses a call whose
# halves sit further apart; this gate slices the whole argument, so that residual is eliminated and (6)
# replaces it.
# Hard-zero.
set -uo pipefail
for d in apps/api/src apps/workers/src packages infra/prisma/src; do
  [ -d "$d" ] || { echo "fitness #41 scope error: '$d' does not exist — the scan would skip it silently and print 0."; exit 1; }
done
VIOLATIONS=$(node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

const SCOPE = ["apps/api/src", "apps/workers/src", "packages", "infra/prisma/src"];
const SKIP = /(^|\/)(node_modules|dist|tests|generated)\//;
const MARKERS = [
  { column: "passwordResetToken", re: /\bpasswordResetToken\s*:\s*null\b/ },
  { column: "resetToken", re: /\bresetToken\s*:\s*null\b/ },
  { column: "mfaBackupUsedAt", re: /\bmfaBackupUsedAt\s*:\s*(?!\{\s*\})/ },
  { column: "mfaLastUsedTotpStep", re: /\bmfaLastUsedTotpStep\s*:/ },
  { column: "refreshTokenHash", re: /\brefreshTokenHash\s*[:,}]/ },
];
const SITE_FLOOR = 8;
const EXCEPTION = {
  file: "apps/api/src/infrastructure/repositories/PrismaAdminSessionRepository.ts",
  column: "refreshTokenHash",
};
// Slice from `open` at `from` to its balanced `close`, dropping comment bytes and
// skipping brackets inside string/template literals (this step's own slicer).
const sliceBalanced = (src, from, open, close) => {
  let depth = 0;
  let i = from;
  let body = "";
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      body += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === open) depth += 1;
    if (c === close && --depth === 0) return body + c;
    body += c;
    i += 1;
  }
  return null;
};
const literalOf = (args, key) => {
  const m = new RegExp(`(^|[{,\\s])${key}\\s*:\\s*\\{`).exec(args);
  return m === null ? null : sliceBalanced(args, m.index + m[0].length - 1, "{", "}");
};
const files = [];
for (const dir of SCOPE) {
  for await (const f of glob("**/*.ts", { cwd: dir })) {
    const path = `${dir}/${f}`;
    if (!SKIP.test(path) && !path.endsWith(".test.ts")) files.push(path);
  }
}
files.sort();
let sites = 0;
let exceptionHits = 0;
const violations = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const call = /\.(update|updateMany|upsert)\s*\(/g;
  let m;
  while ((m = call.exec(src)) !== null) {
    const args = sliceBalanced(src, m.index + m[0].length - 1, "(", ")");
    if (args === null) continue;
    const data = literalOf(args, m[1] === "upsert" ? "update" : "data");
    if (data === null) continue;
    const line = src.slice(0, m.index).split("\n").length;
    for (const { column, re } of MARKERS) {
      if (!re.test(data)) continue;
      sites += 1;
      if (file === EXCEPTION.file && column === EXCEPTION.column) {
        exceptionHits += 1;
        continue;
      }
      const where = literalOf(args, "where");
      if (where === null) {
        violations.push(`${file}:${line}: ${column} consumed in data, and the call has no where literal to name it`);
        continue;
      }
      if (!new RegExp(`\\b${column}\\s*:`).test(where)) {
        violations.push(`${file}:${line}: ${column} consumed in data but not named in where`);
      }
    }
  }
}
if (sites < SITE_FLOOR) {
  console.error(`fitness #41 scope error: ${sites} marker sites found against a floor of ${SITE_FLOOR} — a marker was renamed, a claim moved out of scope, or the scan stopped matching. Failing closed rather than reporting a clean zero over code it never read.`);
  process.exit(1);
}
if (exceptionHits !== 1) {
  console.error(`fitness #41 scope error: the named exception matched ${exceptionHits} site(s) in ${EXCEPTION.file}; it covers exactly one issuance write. A second write there is not covered by its reasoning, and zero means the site moved — delete the exception with it.`);
  process.exit(1);
}
console.log(violations.join("\n"));
EOF
) || { echo "fitness #41: the scan crashed or the scope is invalid — failing closed (needs node >= 22 for fs.glob)"; exit 1; }
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 42. No install-lifecycle script in a workspace package, except the ONE named.
# The gate the `pnpm deploy` switch owes: both image pipelines now deploy with
# `--ignore-scripts`, because @infra/prisma's `postinstall: prisma generate` has
# no CLI to run in a prod tree and its emit is already inside the dist being
# copied. That flag is correct for THAT package and silent for every other: a
# package that later declares `postinstall`, `prepare` or `install` has its
# script SKIPPED in the production tree with nothing anywhere reporting the
# skip, and the first symptom is a runtime failure in production — the exact
# shape (a green build over work that never ran) this suite exists to prevent.
# MEASURED at the time of writing: 104 manifests under apps/ packages/ infra/,
# of which exactly ONE declares an install-lifecycle script, and it is the named
# exception. So this lands hard-zero with no ramp-down.
# SCOPED TO `.scripts`, VIA jq, AND THAT IS NOT STYLE. A regex over the whole
# manifest matches a DEPENDENCY named `prepare`, `install` or `postinstall` —
# all real, publishable npm names — and would fail the workflow over something
# this gate is explicitly not trying to prevent. The mirror is worse: the
# fail-closed guard below would keep passing on a dependency named `postinstall`
# after the exception's script was deleted, quietly defeating the very intent it
# cites. Asking jq for the keys of `.scripts` removes both paths.
# ONE EXCLUSION VOCABULARY, for the same reason. The floor walk and the
# violation walk must open the SAME files: if the floor counted a directory the
# scan skipped, TOTAL could clear 90 over manifests VIOLATIONS never read, which
# is the failure mode the floor exists to prevent. `manifests()` backs both.
# FAIL-CLOSED on both sides. If the exception stops declaring ANY lifecycle
# script, the check exits 1 rather than quietly exempting whatever is re-created
# at that path — the rule #30's quarantine holds too, where an entry whose file
# is gone fails. And if fewer than 90 manifests are found the workspace layout
# moved and the gate would report a clean zero over packages it never opened, so
# that exits 1 too.
# RESIDUAL LIMIT, stated rather than implied: this proves no manifest DECLARES
# such a script. It does not prove a dependency's install script is unnecessary —
# that is `allowBuilds` in pnpm-workspace.yaml, a different list with a different
# owner. Nor does it prove @infra/prisma's own skip stays safe; that holds only
# while `prisma generate` runs explicitly in the build stage before the deploy,
# which both Dockerfiles do and neither may stop doing.
set -uo pipefail
EXCEPTION="infra/prisma/package.json"
LIFECYCLE_KEYS='["preinstall","install","postinstall","prepare","prepublishOnly"]'
manifests() {
  find apps packages infra -name package.json \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -not -path '*/.next/*' 2>/dev/null
}
declares_lifecycle() {
  jq -e --argjson keys "$LIFECYCLE_KEYS" \
    '(.scripts // {}) | keys_unsorted | any(. as $k | $keys | index($k) != null)' "$1" >/dev/null 2>&1
}
if ! declares_lifecycle "$EXCEPTION"; then
  echo "fitness #42 scope error: the named exception $EXCEPTION no longer declares any install-lifecycle script — delete the exception with it, or a package re-created under that path inherits it unscanned."
  exit 1
fi
TOTAL=$(manifests | wc -l)
if [ "$TOTAL" -lt 90 ]; then
  echo "fitness #42 scope error: only $TOTAL manifests found against a floor of 90 — the workspace layout moved and this gate would report a clean zero over packages it never opened."
  exit 1
fi
VIOLATIONS=$(manifests | while IFS= read -r f; do
  declares_lifecycle "$f" || continue
  [ "$f" = "$EXCEPTION" ] && continue
  echo "$f declares an install-lifecycle script; both image pipelines deploy with --ignore-scripts, so it would be skipped in the production tree with nothing reporting the skip"
done)
COUNT=$(printf "%s" "$VIOLATIONS" | grep -c . || true)
COUNT=${COUNT:-0}
echo "$COUNT"   # expect 0

# 43. One route-test composition root. An ALLOWLIST (the #28/#40 form), two arms.
# Threat: `setupContainer` requires `apiMetrics`, and `apps/api/tests` is opened by NO
# compiler — `tsconfig.json` includes `src` only, `tsconfig.type-tests.json` includes only
# `*.type-test.ts` — so that requirement had an enforcement surface of ONE call site while
# 22 harnesses omitted it and registered `TOKENS.ApiMetrics` as `undefined`. There was no
# runtime signal either: `registerInstance` stored the `undefined` and `resolve` handed
# it straight back instead of throwing "Service not registered", and
# `RedisBruteForceAdapter` then dereferenced it unguarded
# (`:125,:141,:175,:201,:392,:421`) on the customer login path.
# The container has since closed that itself: `registerInstance` throws at registration
# ("Cannot register undefined as an instance: <token>"), so a container built without
# the collector no longer builds. The seam stays the one place a harness composes through.
# ALLOWLIST, not denylist, for the #28 reason: the wrong shapes are open-ended (omit it,
# pass an empty object cast to the type, hand-roll a seventh double) while the admissible
# set is three named files that together OWN the seam — the seam, its suite, and its
# compile-time pin. Everything else in `apps/api/tests` goes through
# `createRouteTestContainer`, whose options type re-adds `apiMetrics` as optional so a
# harness cannot express the omission at all.
# FAIL-CLOSED on scope, twice. A zero that comes from the pattern no longer matching is a
# blind scan, not a clean one: the three allowlisted files must EXIST (an allowlist naming
# a deleted file would exempt whatever is recreated under that path, unscanned), and the
# total invocation count is held against a floor, so renaming `setupContainer` or moving
# the seam goes red instead of reporting a clean zero over code it never read.
set -uo pipefail
SEAM=apps/api/tests/unit/helpers/testContainer.ts
SEAMTEST=apps/api/tests/unit/helpers/testContainer.test.ts
PIN=apps/api/tests/unit/infrastructure/container/containerSetupOptionsContract.type-test.ts
for f in "$SEAM" "$SEAMTEST" "$PIN"; do
  [ -f "$f" ] || { echo "fitness #43 scope error: $f does not exist — the allowlist names a file that is gone, so the scan would print a clean zero over a seam nobody owns."; exit 1; }
done
invocations() {
  grep -rn "setupContainer({" apps/api/src apps/api/tests --include="*.ts" | \
    grep -vE "node_modules|/dist/" | \
    grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)" | \
    grep -v "/container/setup\.ts:"
}
FLOOR=$(invocations | grep -c . || true)
FLOOR=${FLOOR:-0}
if [ "${FLOOR}" -lt 6 ]; then
  echo "fitness #43 scope error: ${FLOOR} invocations found against a floor of 6 — setupContainer was renamed, the seam moved, or the scan stopped matching. Failing closed rather than reporting a clean zero over code it never read."
  exit 1
fi
SRC_BAD=$(invocations | grep "^apps/api/src/" | grep -v "apiMetrics" | grep -c . || true)
TST_BAD=$(invocations | grep "^apps/api/tests/" | grep -vE "^($SEAM|$SEAMTEST|$PIN):" | grep -c . || true)
echo "${SRC_BAD:-0}"   # expect 0 — the production root still passes the bootstrap instance
echo "${TST_BAD:-0}"   # expect 0 — every harness goes through the seam
# FLOOR measured at 6 when the gate landed: `apps/api/src/index.ts:283` (1), the seam's own
# internal call (1), the seam suite's case that a container without the collector is refused
# (1), and the pin's three directions (3) — omission, explicit-undefined, and the positive
# control. The floor
# may RISE with a deliberate new allowlisted call and must never be lowered to absorb a
# violation.
# RESIDUAL LIMITS, stated rather than implied. (1) Textual, not a parser: a call reached
# through an alias or assembled from a string is invisible; the floor turns a wholesale
# rename red, not one deliberately obfuscated call. (2) The SRC arm proves the word
# `apiMetrics` appears on the invocation line, NOT that the value is the scraped collector
# — keeping the option required is the PIN's job, and only the pin can see a `?` appear on
# the signature, which a grep never can. (3) The seam suite calls `setupContainer`
# directly, with no collector, to pin that the container refuses to build; that is exactly
# why $SEAMTEST is allowlisted rather than rewritten to hide its own call from this gate.
# The allowlist may only SHRINK — a fourth name is a fourth file that can drift, so add one
# only with a stated reason. (4) The fail-open this gate was written around is closed in
# the container itself, for every token: `registerInstance` refuses `undefined` at
# registration (SMELL-158). A harness that omits the collector now fails when it builds its
# container, so what this gate still adds is that every harness composes through the seam.

# 44. The fitness inventory is contiguous, its three sources agree, and its count is derived.
# Threat: the one invariant in this suite that nothing measured was the suite ITSELF. A step
# wired without its block, a block whose step was deleted, a number two steps both claim, or a
# count sentence left at the previous value all read as a complete inventory while a check
# silently stops being enforced — and the summary printed a TYPED count that agreed with the
# document no matter what actually ran. Since 2026-11-18 the suite is stated in three files: the
# steps of fitness.yml, the blocks of this document, and the list of CLAUDE.md §Automated
# Compliance Checks, the one of the three a session loads (ADR-0045). A list line that drifts
# from its step tells every session a rule nothing runs, and a block left behind in CLAUDE.md
# grows the loaded context back.
# THE RULE IS A SCRIPT WITH A SUITE, not inline shell: scripts/testing/fitness-inventory-gate.mjs,
# pinned by apps/api/tests/unit/scripts/fitnessInventoryGate.test.ts. The code below is its
# invocation and is the workflow step's body line for line; the script derives N and writes the
# job summary from it, so no count is typed anywhere outside the sentence it checks.
# WHAT IT READS. Workflow side: every step whose `name:` value starts with `#<number>`, double-
# or single-quoted, in any job of fitness.yml, with the lines of the block scalars its own entry
# of the steps list holds (its `run: |` body); an entry opens at a line that starts `- ` and ends
# at the next line, outside a block scalar and not a comment, at its column or to its left, so the
# body of a step with no numbered name, a bare `- run:` or `- uses:` entry included, is never
# credited to the numbered step before it. Block scalars are never read as keys, and an UNQUOTED
# `name: #N` is refused because YAML reads it as a comment. A step's name is a key of its entry
# itself: a numbered `name:` nested below the entry's own keys, in a list or mapping the step
# holds (an item of a list under `with:`, say), is refused because it names no step, and an
# unnumbered one changes nothing. Reference side: every `# N.` line at column 0 inside a fenced
# block of the section `## Check blocks` of this document, which ends at the next level-1 or
# level-2 heading OUTSIDE a fence, so a column-0 `## ` comment inside a block does not truncate
# it. List side: every line of CLAUDE.md §Automated Compliance Checks, outside code blocks, of
# the form `- **#N** <name> — <how>`, where <how> is `shell` for an inline check or one code span
# holding the command its step runs, and the count sentence of that section's prose.
# THE HEADING CONVENTION IS LOAD-BEARING, and the gate says so out loud: a check heading follows
# the fence or a blank line, and a `# N.` line anywhere else is reported by its line number as a
# comment shaped like a heading. A look-alike that does follow a blank line is counted, and then
# surfaces as a duplicate heading or a documented-but-unwired number — red either way. A line of
# the list that opens like an entry (a list marker, then `#` and a digit, bold or not) and is not
# exactly `- **#N** ` with no leading zero is reported by its line number the same way.
# SETS, not sequences, and that distinction is MEASURED rather than stylistic: neither the
# workflow nor this document declares its checks in numeric order, so comparing declaration ORDER
# would go red over placement that changes nothing. Do not "fix" any of the files into numeric
# order to satisfy this gate; it asserts the workflow SET is 1..N with no hole and no duplicate,
# the reference and the list each carry the same set with no duplicate, and exactly one count
# sentence, in CLAUDE.md, states the derived N.
# WHAT FAILS beyond the sets: a list line whose name is not its step's name without the `#N `
# prefix, character for character, and the violation prints the line as it must read; a list line
# that ends in neither ` — shell` nor ` — ` and one code span, or whose code span's text does not
# occur in its step's run body; a `# N.` heading inside a code block of the CLAUDE.md section,
# since the blocks live here; and a count sentence in this document, since the count is stated
# once, in CLAUDE.md.
# FAIL-CLOSED: an unreadable file, zero numbered steps, a numbered name that no entry of a steps
# list holds (a job's, say, whose body no step can be told to own) or that is nested below an
# entry's own keys, a missing section in CLAUDE.md or here, zero headings, zero list lines, a
# fence that never closes, and no count sentence each exit 1 naming the cause — a scan that read
# nothing must never render as a clean inventory.
# RESIDUAL LIMITS, stated rather than implied: (1) textual over the three files, so a step whose
# name is assembled by a matrix, a composite action or a flow-style mapping is invisible to it,
# and a YAML escape in a quoted name is compared as written; (2) a look-alike comment that
# follows a blank line can stand in for a deleted heading with the same number; (3) the command
# check proves the command occurs in the step's run body, not that it is the command the step's
# verdict comes from, and a step whose `run:` is one line has no body and can only be listed as
# `shell`; (4) a block's text and its step's body are still mirrored by hand; (5) it proves the
# inventory is COMPLETE, never that a listed check still measures what its prose claims.
set -euo pipefail
if ! node scripts/testing/fitness-inventory-gate.mjs --summary "${GITHUB_STEP_SUMMARY:-/dev/null}"; then
  echo "::error title=Fitness #44 violation::The fitness inventory has a hole or a duplicate; fitness.yml, the blocks of docs/development/FITNESS_FUNCTIONS.md and the list of CLAUDE.md §Automated Compliance Checks disagree on its set, on a check's name or on its command; the stated count is not the derived N; or the gate could not read one of its inputs. The fitness-inventory-gate lines above name each violation with its file and line."
  exit 1
fi

# 45. The legal inventories are current, and every row they hold is classified.
# Threat: the legal facts register falls silently behind the code. A pull request that adds a
# personal field to the schema, a cookie or a browser-storage key, an OAuth scope or a dependency
# changes what the product stores, sets, asks for or sends, and nothing tied docs/legal/ to that
# change: every per-site update of the register drifted back with the next change that did not
# know the register existed.
# WHAT IT RUNS: `pnpm check:legal`, which is `node scripts/legal/run.mjs --check`, with one
# generator per surface under scripts/legal/, each pinned by its suite in
# apps/api/tests/unit/scripts/*Inventory.test.ts — personal-data (the fields of
# infra/prisma/schema.prisma whose name matches its vocabulary), cookies-and-storage (the cookies
# and the localStorage / sessionStorage keys of the API, both portals and packages/ui),
# oauth-scopes (the connect flows, the provider adapters, the shared provider metadata and the CRM
# authorize routes) and subprocessors (the direct dependencies of every workspace manifest, and
# the services the code reaches by `fetch`). Each regenerates its page in memory and compares it
# with the committed one under docs/legal/inventories/.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, not the Fitness
# Functions job. The pages render through prettier's API, so the generators need the installed
# tree, and the Fitness Functions job installs nothing; dependency-consistency is the job that runs
# `pnpm install --frozen-lockfile`. #44 reads a `#N` step name from any job, so the inventory still
# counts this check.
# WHAT FAILS, each printed as `legal-inventory <name>: <problem>`: a committed page that is missing
# or differs from the regenerated one; a candidate with no entry in
# docs/legal/classification/<name>.json; a stale entry, whose row no longer exists; an entry the
# generator refuses (a status it does not list, no note, a field its status requires left out, a
# `manual` flag on a row the scan finds, an OAuth scope whose declared `sources` differ from the
# scan, a subprocessors `tooling` entry with no note, a name no private workspace carries, or a
# workspace that a manifest which is not tooling declares outside `devDependencies`); and a
# `pending` count above or below the file's `pendingBaseline`.
# NOT APPLICABLE IS A ROW. A touched surface that holds nothing legally relevant is declared in its
# classification file — `not-personal` for a schema field, `library` for a dependency — with a note
# saying why. A pull request sentence or a label never satisfies this check, because nothing reads
# either.
# RECORDED FACTS ONLY. A page carries the facts its generator extracted and the sha256 prefix of
# its classification file and of its normalized scan result: no scan-size counter, no source-file
# hash, no line number and no timestamp. The check therefore fires on a legally relevant change (a
# new or removed field, cookie, scope or dependency, or a reclassification), stays green over a
# change that moves code without moving a fact, and a clean checkout reproduces every page byte for
# byte.
# RATCHET. `pendingBaseline` is the check's one counted residual: the rows that still wait for a
# human classification. It may fall and must never rise, and the check holds it EXACT, so the
# change that classifies a pending row lowers the baseline in the same diff or goes red.
# FAIL-CLOSED: a generator whose scan cannot read its whole scope, or read nothing (a missing root,
# zero models, candidates, call sites, adapter files, scopes, manifests or dependency names, an
# unreadable manifest), reports a scope error and exits 1 instead of rendering an empty inventory
# as clean; a classification file that is missing or not JSON is a problem, never an empty file.
# RESIDUAL LIMITS, stated rather than implied: (1) the vocabularies are enumerated, not derived: a
# personal field whose name matches no token, a cookie set through a helper the scanner does not
# know, and a service reached by `fetch` with no package are invisible until a human adds the
# token, the matcher or a `"manual": true` entry; (2) the four pages are the four surfaces, so a
# recipient no manifest declares and no manual entry names — the hosting provider, the deployment
# platform — appears on no page; (3) a classification is a human judgement, and the check proves
# only that it is present and well formed, never that it is right.
pnpm check:legal   # expect exit 0, and one `is current` line per page:
#   legal-inventory personal-data: docs/legal/inventories/personal-data.generated.md is current
#   legal-inventory cookies-and-storage: docs/legal/inventories/cookies-and-storage.generated.md is current
#   legal-inventory oauth-scopes: docs/legal/inventories/oauth-scopes.generated.md is current
#   legal-inventory subprocessors: docs/legal/inventories/subprocessors.generated.md is current

# 46. The support documents follow their template, and every tree candidate is classified.
# Threat: support documentation falls silently behind the product. A pull request that adds a route
# module, a core package, a worker, a queue or a portal section adds something a ticket can be
# about, and nothing tied docs/support/ to that change: a page written by hand drifts from its
# template, and a capability with no page stays invisible until the first ticket about it.
# WHAT IT RUNS: `pnpm check:support`, which is `node scripts/support/run.mjs --check`, with two
# generators under scripts/support/, pinned by apps/api/tests/unit/scripts/supportIndex.test.ts and
# supportNonFeatures.test.ts, and the flat front-matter grammar they share,
# scripts/support/lib/front-matter.mjs, pinned by supportFrontMatter.test.ts:
#   - index holds every `*.md` directly under docs/support/, its companion pages aside (README.md,
#     _TEMPLATE.md, NON_FEATURES.md, EXCEPTIONS.md), to docs/support/_TEMPLATE.md: the seven
#     front-matter keys (feature, owner, status, verified, paths, covers, legal) and no other; a
#     `feature` equal to the kebab-case file name; a status of live, partial or planned; a
#     `verified` stamp of exactly sha (40 hex), date (YYYY-MM-DD) and by; `paths` that exist, with
#     no glob and a directory ending in /; distinct `covers`; `legal` references that each name a
#     section of docs/legal/REGISTER.md or a row of a generated legal inventory, or `none`; the
#     eight `##` sections in the template's order; and a `## Verification` section that is the one
#     line `Last verified against main <sha> on <date> by <who>`, equal to the stamp. The template
#     is held to the same keys and sections, and each document is one row of docs/support/README.md.
#   - non-features derives every candidate of the tree: a route module of apps/api/src (named
#     `*Routes.ts` or `routes.ts`, or registering a route with a path literal, comments ignored), a
#     package of packages/core, a `*Worker.ts` or `*Handler.ts` directly under apps/workers/src, a
#     value of QUEUE_NAMES in packages/adapters/queue-bullmq/src/constants.ts, and a first route
#     segment of the Admin and client apps under app/[locale]. It joins each `<kind>:<name>` with
#     docs/support/classification/non-features.json — `documented` with the support document that
#     covers it, `non-feature` with the reason support needs no page, or `pending` — and renders
#     docs/support/NON_FEATURES.md.
# Each generator regenerates its page in memory and compares it with the committed one.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside #45 and for its
# reason. Both pages render through prettier's API, by way of the inventory library under
# scripts/legal/lib/ that the legal and support generators share, so the check needs the installed
# tree, and the Fitness Functions job installs nothing. #44 reads a `#N` step name from any job, so
# the inventory still counts this check. The battery runs the same command as its step `support`.
# WHAT FAILS, each printed as `support-docs <generator>: <problem>`: a document off the template
# (the problem names the file, and its line number when the grammar refuses a front-matter line); a
# template whose keys or sections drift from the contract; a committed page that is missing or
# differs from the regenerated one; a candidate with no entry in the classification; a stale entry,
# whose candidate the tree no longer yields; a `documented` entry whose `doc` names no support
# document, or a `doc` on an entry of any other status; an entry the shared loader refuses (a status
# it does not list, an unknown key, a `non-feature` with no note); and a `pending` count above or
# below `pendingBaseline`.
# NOT APPLICABLE IS A ROW. A candidate support needs no page for is declared in the classification
# as `non-feature`, with a note saying why. A pull request sentence or a label never satisfies this
# check, because nothing reads either.
# RECORDED FACTS ONLY. README.md carries the sha256 prefix of its rendered index rows, and
# NON_FEATURES.md that of the derived candidate list and of the classification file; each page's
# summary counts its documents or candidates per status. No scan-size counter (the documents read
# and the candidates per kind are printed by the generators, never written), no hash of a scanned
# source file, no line number and no timestamp. The check therefore fires on a recorded change (a
# document added or removed, a changed status, stamp, capability, legal reference or owner, a
# candidate added or removed, a reclassification), stays green over a change that moves code
# without moving a candidate or edits a document's prose within its template, and a clean checkout
# reproduces both pages byte for byte.
# RATCHET. `pendingBaseline` in the classification file is the check's one counted residual: the
# candidates that still wait for their support page, 184 when this check landed. It may fall and
# must never rise, and the check holds it EXACT, so the change that documents or reclassifies a
# pending candidate lowers the baseline in the same diff or goes red, and a rise can only land as a
# visible edit of the baseline, for review to refuse.
# FAIL-CLOSED: a missing root (docs/support/, its template, apps/api/src, packages/core,
# apps/workers/src, the queue constants file, either portal's app/[locale]) or a kind that yields
# no candidate is a scope error and exits 1 instead of rendering an empty inventory as clean; a
# classification file that is missing or not JSON is a problem, never an empty file. Zero support
# documents is NOT a scope error: it renders an empty index, the state this check landed in.
# RESIDUAL LIMITS, stated rather than implied: (1) the derivation reads the tree by file-name
# convention and path literals, so a capability it does not see (a middleware, an adapter or
# provider package, a page at an app root, a route registered with no path literal in a file not
# named as a route module) has no row, and a support page that describes one names it in its
# `paths`; a path literal on any receiver can raise a false candidate, refused until it is
# classified; (2) the structure check sees no freshness: no stamp date is compared with today and no
# commit is counted since a stamp, so a page whose `paths` changed after its stamp still passes —
# that is SUP-3's part; (3) a classification is a human judgement, and the check proves only that it
# is present and well formed, never that it is right.
pnpm check:support   # expect exit 0, and one `is current` line per page:
#   support-docs index: docs/support/README.md is current
#   support-docs non-features: docs/support/NON_FEATURES.md is current

# 47. Every source file a pull request adds or modifies carries the canon's method-level JSDoc.
# Threat: CODING_STANDARDS §Documentation requires `@method`, `@description`, `@param` and
# `@returns` on every public method, and nothing enforced it. #9 holds the file header only, and
# `pnpm lint` loads no jsdoc rule: measured over the tree on 2026-10-10, 35% of the public methods
# carried no JSDoc at all and 31% carried the canon's tag form.
# WHAT IT RUNS: `pnpm check:jsdoc`, which is `node scripts/testing/jsdoc-touched-gate.mjs`, with
# the rules in `eslint.jsdoc.config.ts` (eslint-plugin-jsdoc). The rules are pinned by
# apps/api/tests/unit/scripts/jsdocRules.test.ts, the gate's mechanics by jsdocTouchedGate.test.ts
# beside it. An exported function carries a block with
# a non-empty `@description`, one `@param` per parameter, and `@returns` unless it returns nothing,
# read from its body or from a `void` or `Promise<void>` annotation. A public method of an exported
# class carries the same block plus `@method`. A React component (a PascalCase or default-exported
# function holding JSX, in a `.tsx` of apps/admin, apps/client or packages/ui) carries a
# description only, in the block's body or in `@description`, and no `@param` or `@returns`,
# because the canon documents props on the interface. Every tag must be one that JSDoc itself
# defines (`@method` and `@function` among them) or one of the canon's own three: `@layer`,
# `@component` and `@hook`; any other tag name is a violation.
# SCOPE: the `.ts` and `.tsx` files under apps/ and packages/ that the pull request adds or modifies
# against its base (a rename counts as an addition), the WHOLE file and not only its edited lines.
# Tests, specs, stories, declaration files, dist, .next and infra/prisma/generated are out. The
# scope is the config's own (its ignores and `files`); the script restates no glob.
# NO BASELINE, NO SUPPRESSIONS FILE: a file no change touches is never read, so the backlog falls
# as the plans touch files, and `pnpm check:jsdoc --all` lists what is left for the reconciliation
# at the end of the current plan. Measured 2026-10-11 on main a5da2a84: 1028 of 2134 in-scope
# files hold 9648 violations. An eslint-disable directive does not exempt a file: a jsdoc message
# it suppressed counts as a violation.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside #45 and #46,
# because ESLint and its plugins need the installed tree; on `pull_request` only, like #37, because
# its subject is the pull request's delta against its base, which a push run does not have. The
# same script runs in lint-staged on the staged files and as the battery step `jsdoc` against the
# merge base with origin/main. `pnpm lint` does not load these rules: ESLint discovers only
# `eslint.config.*`.
# FAIL-CLOSED, exit 2: a base that does not resolve after 3 bounded fetch attempts, a merge base
# that cannot be found (a shallow clone is deepened with the same attempts), a config whose scope no
# longer reaches apps/api/src/index.ts, or `--all` finding no in-scope file. A pull request that
# touches no in-scope file is a clean pass, and its line says so.
# RESIDUAL LIMITS, stated rather than implied: (1) "exported" is syntactic: a function or class
# exported by a separate `export { name }` or `export default name`, a class expression, a
# component wrapped in `forwardRef` or `memo`, an arrow-function class property and an accessor
# need no block; (2) the plugin's tag rules match their context without ancestors, so `@method`
# reaches every documented public method, in an exported class or not; (3) a component is
# recognised by its name and its JSX, not by its type; (4) the gate proves the tags are present and
# non-empty, never that they are right.
JSDOC_BASE_REF="${FITNESS_BASE_REF:-origin/main}" pnpm check:jsdoc   # expect exit 0 and one line:
#   jsdoc-touched-gate: <N> touched in-scope files in <base> (merge base <sha>): zero violations

# 48. Every patched dependency has its record, its patch file and its ADR, and is watched until resolved.
# Threat: a dependency patched through `patchedDependencies` in pnpm-workspace.yaml runs code no
# published release carries. CLAUDE.md §Problem-Solving Standards forbids a temporary patch, so each
# one exists only by a Maintainer's decision in its own ADR (ADR-0037 is the first), and nothing tied the
# key to that decision or to the release that ends it: a key with no record, a record whose patch
# file or ADR is gone, or a file under patches/ that no record names reads as justified while nothing
# justifies it, and a patch whose fix has shipped keeps running after its reason ended. The Maintainer's
# rule of 2026-10-15: every patch is monitored all the time until it is resolved.
# WHAT IT RUNS: `pnpm check:patched-deps`, which is `node scripts/testing/patched-dependencies-gate.mjs
# --check`, pinned by apps/api/tests/unit/scripts/patchedDependenciesGate.test.ts. It reads the
# `patchedDependencies:` block of pnpm-workspace.yaml as text, through the reader the engines and
# override-bands gates share (scripts/testing/workspace-block-reader.mjs), and the records of
# scripts/testing/patched-dependencies.json: one per patch, with its package and exact version, its
# patch file, the upstream pull request, merge commit and release it reproduces, `resolvedBy` (the
# package and the version range whose first stable release ends it), its ADR, `since`, `why` and
# `removeWhen`, every field required. Each key names one exact version and has exactly one record
# with the same package, version and patch file; each record has its key, its patch file under
# patches/ and its ADR on disk; every file under patches/ is named by a record; each
# `resolvedBy.range` parses.
# THE OTHER HALF, deliberately not this check: `--resolution` reads the registry
# (`pnpm view <package> versions time --json`) for every record and exits 1 when a stable release
# inside `resolvedBy.range` is published, naming the lowest one, its publish instant and the record's
# remove-when; `--remind` opens one issue per resolvable patch (label `patched-dependency`), comments
# on it once a day while it stays open (never on the day it opened it), and reopens it if it is closed
# while the patch stands, so a second run on the same day repeats none of it. It runs every 6 hours in
# .github/workflows/patched-dependencies.yml and never in pull-request CI, so an upstream release never
# blocks unrelated work. The gate's exit codes are the same in every mode: 0 clean, 1 a verdict (here
# an inconsistency, there a resolvable patch), 2 a usage error, 3 an input it could not read, and 3
# wins when both occur. The workflow retries only 3, three attempts 30 s then 60 s apart, and fails
# under one title for 1 and another for 3, so a transient read failure never reads as a resolvable
# patch.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside the gates that own
# pnpm-workspace.yaml (holds, engines, override bands). It reads tracked files only: no install, no
# registry, no API. The battery runs the same rule as its step `patched-deps`.
# WHAT FAILS, exit 1, each printed as `patched-dependencies-gate: <problem>`: a key that names no exact
# version, a key with no well-formed record, a key whose patch file differs from its record's, a
# record with no key, a record whose patch file or ADR is missing, a file under patches/ no record
# names, a record missing a field or holding it in the wrong shape, a duplicate record or key, and a
# `resolvedBy.range` that does not parse.
# FAIL-CLOSED, exit 3: an unreadable workspace or records file, a records file with no `entries`
# array, a block line that is not one flat `key: value` entry, a `patchedDependencies` key spelled
# any way but as one plain column-0 block (a flow mapping, a quoted or nested key, a second block),
# which the text reader could not see, and a `patches/` directory that exists but cannot be listed;
# in the other half, a registry document `pnpm view` cannot produce or that lists no versions or no
# publish times, a record too malformed to measure, and a GitHub call that fails. A usage error
# exits 2. Zero patches in the workspace and in the records is a clean pass that says so: the state
# the repository returns to when its last patch leaves, `patches/` gone with it.
# RESIDUAL LIMITS, stated rather than implied: (1) `resolvedBy.range` is the comparator subset of
# semver (`<`, `<=`, `>`, `>=`, `=` or none on an exact X.Y.Z, joined by spaces and `||`); `^`, `~`,
# partial versions and prereleases are refused rather than guessed; (2) the check proves a record
# exists and is well formed, never that the patch reproduces the upstream change it names, which
# review reads; (3) the resolution half proves a release inside the range is published, not that it
# carries the fix, and between two scheduled runs, up to 6 hours, a resolvable patch is not yet
# reported.
pnpm check:patched-deps   # expect exit 0 and, with no patch, this one line:
#   0 patched dependencies: none in patchedDependencies, none recorded, no file under patches/ (a clean pass)
# With a patch, one line per patch (tab-separated) and a summary:
#   <package>@<version>  patch  consistent
#   1 patched dependency checked against patchedDependencies, patches/ and the ADRs: 1 consistent, 0 violation(s)

# 49. Every test-block lint rule stays at `error`, and no inline directive turns one off.
# Threat: eslint-suppressions.json holds the test blocks that cannot fail, and the tests that hide
# from their runner, at the count the tree had when their rules landed, and lets it only shrink: a
# deleted block whose entry is not pruned makes `pnpm lint` exit 2 while its file is still linted. A
# deleted FILE is the gap: its entries stay unused and unreported until `eslint . --prune-suppressions`
# runs, so the change that deletes a test file runs the prune. That ratchet counts only while
# each rule is an error. At `warn` or `off` every entry of the rule goes unused, a prune deletes
# them, and the class grows back with nothing counting it; an inline `eslint-disable` takes one
# block out of the count without pruning anything.
# WHAT IT READS. Part A: eslint.config.ts, as text. Each of the twelve rules keeps its `error` line
# exactly as prettier writes it: the eight `vitest/*` rules of the block over the files Vitest
# collects (expect-expect's `"error",` on the line after its key), the three `testing/*` rules of
# the block over every test file, and `"no-console": ["error", { allow: ["warn", "error"] }]` as
# the first rule of the block that opens with `files: testFiles,`, so `console.log` and the other
# stdout writers stay errors in test code. It holds the count of lines that turn `no-console` off,
# written as `"off"`, `0`, `["off"]` or `[0]` (the spellings the weakened scan reads), with line
# comments stripped first so a comment that quotes the pattern is not counted, at exactly two, the
# browser-logger console adapter and the scripts, stories and seeds block, and prints the lines it
# counted on a mismatch, so an exemption in any of those spellings and any layout, a single-line
# block, a multi-line one or a one-line object, is a visible edit of this pin: the runner's three
# entry points, the files of a third block, left with WU-2.7 on 2026-10-29. No line of the file sets one of the eleven
# test-block rules to `off` or `warn`, by name or by number, alone or at the head of an array;
# `no-console` is left out of that scan, because its `off` lines are the two pinned blocks. Part
# B: no tracked .ts or .tsx file holds an `eslint-disable` directive that names one of the twelve
# rules (0 on 2026-10-24); eslint.config.ts is out of that scan, since it names the rules by
# design.
# FAIL-CLOSED: a missing eslint.config.ts and a git grep that cannot read the tree each exit 1; a
# pin that matches nothing is a violation, never a pass.
# RESIDUAL LIMITS, stated rather than implied: (1) textual over the config: a rule switched off
# through a variable, a spread or a severity built at run time passes, and so does a later block
# that narrows a rule's glob; only the resolved config (`eslint --print-config <file>`) sees those,
# and it needs the installed tree; (2)
# the pins are indentation-exact, so a reformat that moves a line fails closed, red rather than
# green; (3) a blanket `eslint-disable` that names no rule is not counted; (4) the `off` count is a
# pin on a number, so removing one of the two blocks moves it as a new one would; (5) the count
# strips `//` comments before it reads, so a `no-console` severity quoted in a comment is not
# counted, one quoted in a string literal would be (none exists), and one spelled any other way
# than the four literals is residual (1); (6) it proves the rules are on, never that the
# suppressions file matches the tree, which `pnpm lint` proves by its exit 2.
set -uo pipefail
CONFIG=eslint.config.ts
[ -f "$CONFIG" ]   # expect exit 0
for rule in vitest/no-conditional-expect vitest/valid-expect vitest/no-standalone-expect \
    vitest/no-identical-title vitest/no-commented-out-tests vitest/no-disabled-tests \
    vitest/no-focused-tests testing/no-empty-test testing/no-existence-only-test \
    testing/no-tautological-assertion; do
  grep -cxF "      \"$rule\": \"error\"," "$CONFIG"   # expect >= 1 for each rule
done
grep -A1 -xF '      "vitest/expect-expect": [' "$CONFIG" | grep -cxF '        "error",'   # expect >= 1
grep -A2 -xF '    files: testFiles,' "$CONFIG" | \
  grep -cxF '      "no-console": ["error", { allow: ["warn", "error"] }],'   # expect >= 1
sed -E 's://.*$::' "$CONFIG" | grep -cE '"no-console": *("off"|0\b|\[ *("off"|0\b))'   # expect 2 (the console adapter and the scripts block)
RULES_RE='vitest/(expect-expect|no-conditional-expect|valid-expect|no-standalone-expect|no-identical-title|no-commented-out-tests|no-disabled-tests|no-focused-tests)|testing/(no-empty-test|no-existence-only-test|no-tautological-assertion)'
grep -cE "\"($RULES_RE)\": *(\"(off|warn)\"|[01]\b|\[ *(\"(off|warn)\"|[01]\b))" "$CONFIG"   # expect 0
git grep -nE "eslint-disable[^*]*($RULES_RE|no-console)" -- '*.ts' '*.tsx' ':!eslint.config.ts' | wc -l   # expect 0

# 50. Every direct dependency proves its use with real sites in the tree, or carries the Maintainer's decision.
# Threat: a direct dependency is declared, pinned, patched and audited for years with nothing asking
# what uses it. #45's subprocessors inventory records which dependencies reach production, never
# whether anything loads them. On 2026-10-22 `@monaco-editor/react`, `@fastify/rate-limit`,
# `papaparse` and `react-email` were each found by hand to serve two files or fewer and removed one
# at a time (#678, #679, #698, #694), and the method left no record a later pass could compare
# against; `@fastify/websocket` had no site from the first commit on, hidden by a knip
# `ignoreDependencies` entry, until deps-remove-1 removed both on 2026-10-25.
# WHAT IT RUNS: `pnpm check:deps-ledger`, which is `node scripts/testing/dependency-ledger.mjs
# --check`, over the files `git ls-files` lists. The site reader,
# scripts/testing/lib/dependency-sites.mjs, reads every tracked JS/TS module's syntax tree through
# the `typescript` package and gives each site of a declared name its kind (runtime-import,
# type-only, test-mock, config-string) and its path class: test, production (below a workspace
# directory) or config. The manifest side, scripts/testing/lib/dependency-manifests.mjs, derives the
# workspace manifests from the `packages:` globs and holds them to the legal scan's, reads the
# catalogs, the `bin` names of each declaring package's installed copy and their binary sites
# (manifest scripts, the root lint-staged, .husky/*, workflows, composite actions, tracked *.sh),
# and the css sites (`@import`, `@plugin`, `@config` in tracked stylesheets). The core,
# scripts/testing/lib/dependency-ledger-core.mjs, counts each name's real sites in distinct files:
# an `@types/*` row the type-only files of its target, in any class; a production name its runtime
# imports and stylesheets in production files; a dev-only name every runtime import, stylesheet and
# binary site, and the config strings of config files; a mock never counts. A name with fewer than
# REAL_SITE_FLOOR = 3 real sites is under the floor. A config string in one of the ledger's own
# files, its five modules and its two suites (`LEDGER_FILES` in the command), is not a site:
# those files name the fields, protocols and tools the ledger reads and plant packages as
# fixtures; their imports still count. The command renders the record,
# dependency-ledger.json at the root (every name's declarations and `bin` names, and for a name
# under the floor its real count and its sites by kind and class), compares it byte for byte with
# the committed one, and joins every name with the Maintainer's decisions in
# scripts/testing/dependency-decisions.json: `kept` (a ground from a closed list, its utility, the
# replacement weighed, decidedOn), `remove` (utility, replacement, decidedOn, an optional slice) or
# `pending` (an optional note); a name under the floor with no entry is pending. The modules and the
# command are pinned by apps/api/tests/unit/scripts/dependencySites.test.ts and
# dependencyLedger.test.ts.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside #45 and for its
# reason: the record renders through prettier's API and the `bin` names come from the installed
# tree, and that job runs `pnpm install --frozen-lockfile`. #44 reads a `#N` step name from any
# job, so the inventory still counts this check. The battery runs the same command as its step
# `deps-ledger`.
# WHAT FAILS, exit 1, each printed as `dependency-ledger: <problem>`: a committed record that
# differs from the rendered one, each difference named (`drift: the summary differs`,
# `drift: <name>: in the tree, not in the committed record`, `in the committed record, not in the
# tree`, `its row differs`); an entry off its status's rules (a field the status needs left out or
# one it never carries, a ground outside the list, a `planned` entry whose note names no plan
# item (an id of the plan's shape, `STOR-5` or `N-COR-9`: the shape, not the plan's list, so a note
# citing only an `ADR-0028` or a `CVE-2026-1234` passes it and review confirms the item), a
# decidedOn that is not a calendar day, a `manual` flag); a stale entry (a name no manifest declares, or a name at or above the floor whose
# entry is not `remove`); a `floor` other than 3, a `generator` other than the command, an unknown
# top-level key, `entries` that is not an object, a `pendingBaseline` that is not a non-negative
# integer; and a `pending` count above or below `pendingBaseline`. Write mode, `pnpm deps:ledger`,
# writes the record and prints the same problems with exit 1.
# RECORDED FACTS ONLY. The record carries what a decision reads and nothing that moves when a file
# merely imports a name above the floor: no clock, no commit, no absolute path, no scan-size
# counter, no version (the lockfile and pnpm-workspace.yaml stay the source), and no site of a name
# above the floor (`--sites <name>` prints those on demand). It moves on a fact a decision reads: a
# declaration added or removed, a name crossing the floor, a site of a name under it added, moved
# or removed, a decision written. A clean checkout reproduces it byte for byte.
# RATCHET. `pendingBaseline` is the check's one counted residual: the names under the floor that
# wait for the Maintainer's decision, 128 when this check landed. It may fall and must never rise, and
# the check holds it EXACT, so the change that decides a pending name lowers the baseline in the
# same diff or goes red, and a new name under the floor goes red until it is decided or the
# baseline is raised in a visible edit, for review to refuse.
# FAIL-CLOSED, exit 3, which wins over 1, so nothing is written or compared from a partial read: a
# git listing that fails, lists nothing or holds no JS/TS file; an unreadable pnpm-workspace.yaml,
# one with no `packages:` block, or a catalog line the reader cannot read; a catalog reference the
# catalogs do not hold; manifests derived from the globs that differ from the legal scan's; a
# missing workspace root, an unreadable manifest, zero manifests beyond the root or zero names; an
# installed copy of a declaring package that cannot be read; a tracked module, stylesheet, hook,
# workflow or script that cannot be read, or a module the parser refuses; the legal classification
# unreadable, not JSON or holding a refused `tooling` entry; a decisions file that is missing, empty
# or not JSON; a Prettier configuration the render cannot read; any exception a read throws (the
# legal scan's ENOTDIR on a workspace root that is a file); in `--check`, no committed record, or
# one that cannot be read, with its own error. A usage error exits 2. The legal scan walks the
# filesystem while the derived manifests read git's listing, so an untracked package.json under
# apps/, packages/ or infra/ exits 3 too: fail-closed by design, cleared by tracking or deleting it.
# RESIDUAL LIMITS, stated rather than implied: (1) JSON, YAML and Markdown configs are not scanned
# for package names, so a plugin named only there (.secretlintrc.json, .size-limit.json) reads as
# zero sites and the Maintainer's entry names the file; (2) a string literal equal to a package name in
# a config-class JS/TS file counts as a site even when it is data, and so does a string-literal
# type (`type P = "x"`): an over-count toward `kept`, never toward removal; (3) a package loaded by
# code the tree does not track, the generated Prisma client, reads as zero sites, and a JSDoc
# `import("x")` type in a .js or .mjs file is not read; (4) the unit is the file, so a tool invoked
# from sixty scripts of one manifest is one site; (5) in command text, an inline trailing comment
# and a YAML `name:` line still read as commands, `./node_modules/.bin/<bin>` and a bin followed by
# a comma are not read, and .scss loses whole-line comments only; (6) `LEDGER_FILES` is a list of
# seven files, held to the tree by a suite case that requires each to exist, so a new ledger module
# or suite counts its config strings until it is listed; (7) the floor is one number for every
# kind: a hexagonal adapter with one site reads as under it, and its entry says `kept` on the ground
# `single-adapter`; (8) `pnpm dlx <pkg>` names no declared dependency and has no row, and a package
# imported but declared nowhere is knip's `unlisted` finding, not a row; (9) a decision is a human
# judgement, and the check proves only that it is present, well formed and still applies, never
# that it is right.
pnpm check:deps-ledger   # expect exit 0 and one line:
#   dependency-ledger: dependency-ledger.json is current
pnpm deps:ledger   # writes the record and prints one line with the tree's counts, of this shape:
#   dependency-ledger: wrote dependency-ledger.json: <M> manifests, <N> names, <A> at or above the floor, <U> under it (<Z> at zero); pending <P> of baseline <P>

# 51. Every portal's message catalogs are complete and valid ICU for every locale its routing declares.
# Threat: a portal ships a locale whose catalog lacks keys, carries a message that does not parse, or
# drops an argument another locale passes, and next-intl renders the key path, throws, or prints the
# message without its value. Each portal carried its own validator,
# apps/admin/scripts/i18n-validate.mjs and apps/client/scripts/i18n-validate.mjs, run only by its
# package's `i18n:lint` script, which no workflow, battery step or hook called: the check existed and
# enforced nothing. Each also hard-coded
# its locale list (`["en", "es"]` and `["es", "en"]`), so a third locale would have been checked by neither, and neither
# read the arguments inside a rich-text tag (`<b>{name}</b>`), which 18 of the catalogs' 40 tags hold.
# WHAT IT RUNS: `pnpm check:i18n`, which is `node scripts/testing/i18n-lint.mjs`, one script for every
# portal, pinned by apps/api/tests/unit/scripts/i18nLint.test.ts. A portal is every directory directly
# under apps/ that holds both `i18n/routing.ts` and `messages/`. For each, the locales are the
# basenames of `messages/*.json`, and the routing's `locales: [...]` array and `defaultLocale: "..."`
# are read from routing.ts with anchored regular expressions; the two locale sets must be equal. The
# reference locale is `defaultLocale`. Every leaf of every catalog (objects recursed by key, arrays by
# index) must be a string that parses as ICU MessageFormat through @formatjs/icu-messageformat-parser;
# every other locale must hold the reference's key set, in both directions, and per message the
# reference's set of argument names and rich-text tag names, collected through plural and select
# branches and inside tags. For the catalogs, a new locale is therefore its two natural edits, its
# catalog and its entry in the routing's `locales`, and the gate names the half that is missing.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside #45 and #50,
# because the ICU parser comes from the installed tree and that job runs `pnpm install
# --frozen-lockfile`. #44 reads a `#N` step name from any job, so the inventory still counts this
# check. The battery runs the same command as its step `i18n`.
# WHAT FAILS, exit 1, each printed to stderr as `i18n-lint <portal>: <problem>`: a catalog its routing
# does not list (`messages/fr.json exists but apps/admin/i18n/routing.ts does not list "fr"`); a
# listed locale with no catalog (`apps/admin/i18n/routing.ts lists "fr" but messages/fr.json does not
# exist`); a `defaultLocale` outside `locales`; a key the reference holds and a locale lacks, or one a
# locale holds and the reference lacks, each named with its locale; a catalog whose top level is not
# an object; a leaf that is not a string; a message that does not parse as ICU, named with its
# locale, its key and the parser's error; and a message whose argument or tag-name set differs from
# the reference's, both sets printed.
# FAIL-CLOSED, exit 3, which wins over 1: fewer than 2 portals discovered (`--root` at a tree with
# none included), a `--root` that is not a directory, a routing.ts that cannot be read or holds no
# readable `locales` array of string literals (on one line or wrapped onto several) or no
# `defaultLocale` string literal, or more than one of either, a `messages/` with no catalog, and a
# catalog that cannot be read or does not parse as JSON, each named with its file. A usage error, an
# unknown flag, a `--root` with no value or a `--root` given twice, exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) routing.ts is read as text, so a locale list built
# by code (a spread, an imported constant, a computed array) is invisible and reads as no `locales`
# array, exit 3, rather than being guessed; (2) a portal outside apps/, or one that keeps its
# catalogs anywhere but `messages/<locale>.json`, is not discovered; (3) argument parity compares
# names, never argument types or the branch keys of a plural or select, so `{count, number}` against
# `{count}` passes; (4) the check proves a catalog is complete and well formed, never that a
# translation is right, and the TypeScript check of `t()` keys, not this one, proves the keys the code
# uses exist; (5) the gate reads the catalogs and routing.ts and nothing else, so code that keeps
# its own locale list or formats with a fixed locale is invisible to it, and a new locale needs every
# such site as well.
pnpm check:i18n   # expect exit 0 and, on stdout:
#   i18n-lint: PASS
#   admin: 2 locales (en, es), <m> messages, reference en
#   client: 2 locales (en, es), <m> messages, reference en

# 52. The committed test ledger is what the tree yields.
# Threat: the demolition slices delete tests by the list the Maintainer approves, and that list is
# `ledger.json`. A ledger the tree no longer yields still reads as the approved inventory while it
# names blocks that moved, files that left and verdicts the classifier no longer gives, so a slice
# could delete a test nobody listed or keep one the list says goes. `pnpm check:ledger` existed and
# ran in no workflow, battery step or hook.
# WHAT IT RUNS: `pnpm check:ledger`, which is `node scripts/testing/ledger.mjs --check`, pinned by
# apps/api/tests/unit/scripts/ledger.test.ts. It rebuilds the ledger from the tree (one row per
# test-shaped file, runner, helper and dead-suffix file; each test-shaped file's blocks classified by
# @packages/eslint-plugin-testing and joined to the reach engine's sources and the quarantine; its
# subject, its copies and each helper's importers measured), applies the Maintainer's overlay
# (docs/development/testing-refoundation/adjudications.json, which holds only confirmations, and
# slices.json beside it), and compares the rendered bytes with `ledger.json` at the root and with
# docs/development/testing-refoundation/LEDGER.md.
# THE SLICE GRAMMAR: slices.json is `{ "slices": { "<id>": { "files": [...] } } }`, and the pull
# request that deletes a slice's tests adds `"deleted": { "files": n, "blocks": n }`, its drop, and
# may add `"floors": { "<metric>": { "from": x, "to": y } }`, each a descent of a floor #37 holds
# (lines, functions, branches, statements). The recorded drop is frozen: the ledger renders it as
# written and never recomputes it from rows, which a deleted file no longer has, and
# `summary.deleted` is its sum over the deleted slices. A path has left the tree when `git ls-files`
# no longer lists it, never merely because the ledger holds no row for it. A deleted slice's paths
# may have left the tree, each with the shape of a ledger row; a whole-file slice, one that records
# every file it lists deleted, refuses every path the tree still tracks, a row or not, and a slice
# that keeps some of its files must record as deleted exactly its paths that left the tree. The
# overlay holds only live rows: the deletion pull request removes its own entries from
# adjudications.json.
# WHERE IT RUNS, and why: in the test-contracts job of fitness.yml, beside #30 and #36, because the
# ledger runs the reach engine, which needs the installed tree that job installs. #44 reads a `#N`
# step name from any job. The battery runs the same command as its step `ledger`.
# WHAT FAILS, exit 1: a row of `ledger.json` or the page that differs from the rebuilt one, each
# differing row named by its path and a differing summary or page named as a whole; and an overlay
# entry or slice assignment the ledger refuses (a path the ledger does not list, a status other
# than `confirmed`, a slice id outside ADR-0039's grammar, a path in two slices, an unknown key,
# `floors` on a slice that records no deletion; for a deleted slice, a malformed `deleted` or
# `floors`, a tracked path in a whole-file slice, a path that left the tree with no shape of a
# ledger row, a deleted-file count that is not the paths that left the tree; and an overlay entry
# for a path a slice records deleted, refused with the instruction to remove it). The repair
# is `pnpm ledger`, committed with the change that moved the rows: a test file added, edited,
# renamed or removed, or a source change that moves a subject or an importer count.
# FAIL-CLOSED, exit 3, which wins over 1: `git ls-files` failing or listing no test-shaped file; the
# workspace manifest, the quarantine or a listed file unreadable; the reach engine printing no report
# or reporting an input of its own unread; an overlay or slice file that is no JSON, writes a key
# twice or is not its one object; no committed `ledger.json` or page; and an unreadable Prettier
# configuration. A usage error exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) the check proves the committed record is what the
# tree yields, never that a machine verdict is right: a Maintainer confirmation in the overlay is what
# settles a row; (2) `probes.json`, the hard probe's record beside the ledger, is not checked: each
# probe names the hashes of its test and its subject, so a stale probe can be told apart, but nothing
# compares them with the tree; (3) the ledger's own limits hold, stated in the header of
# scripts/testing/ledger.mjs: a module or project whose references cannot be read leaves every
# importer count unmeasured rather than read as zero; (4) a recorded drop is taken as written:
# nothing proves a listed path that left the tree was ever a test, since the ledger reads no
# history, so a path with a test's shape that the tree never held, a typo included, is accepted
# and counted as deleted, and the deletion pull request's review reads the list; nothing derives
# `deleted.blocks` either, and for a slice that keeps its files (block deletion) the grammar
# accepts the block count while no prediction of it exists (`--area` lists DELETE rows only), so
# review alone checks it; (5) `floors` proves the shape of a descent, never that
# `apps/api/vitest.config.ts` carries it.
pnpm check:ledger   # expect exit 0 and:
#   ledger: ledger.json is current
#   ledger: docs/development/testing-refoundation/LEDGER.md is current

# 53. Every tracked artifact is in English and names roles, never a person.
# Threat: an artifact written in Spanish, or one that names the person who decided instead of the
# role that decides (Product Owner, Maintainer), reads as the official record while it shuts out
# every reader who does not read Spanish and ties each decision to one individual. Nothing counted
# either, so every change could add more: on main @ 1939e73a, 208 tracked files outside the
# exemptions held 2197 Spanish lines and 788 name mentions, 85 of them in the testing refoundation
# tracker alone.
# WHAT IT RUNS: `pnpm check:artifact-language`, which is `node
# scripts/testing/artifact-language-gate.mjs`, pinned by
# apps/api/tests/unit/scripts/artifactLanguageGate.test.ts. It lists the regular files git tracks
# (`git ls-files --stage`, modes 100644 and 100755, so a symbolic link or a submodule is never read
# through), skips a binary one (a NUL byte in its first 8000 bytes, git's own test), and counts per
# file two things: Spanish lines, a line holding one of the characters Spanish spelling uses and
# English never does (the acute vowels, n with tilde, u with diaeresis, the inverted question and
# exclamation marks) or at least two distinct words of the script's list of frequent Spanish
# function words that are rare as English words; and name mentions, each of the person's name words
# in any case, where a letter or a digit continues a word and anything else ends it, after every
# `github.com/edwardricardo/` URL is cut from the line up to its first character outside the
# URL-safe set, since a permalink is an address. The GitHub handle is not a mention, so the files
# that hold only the handle (CODEOWNERS, .github/dependabot.yml) need no exemption. It compares both
# counts of every file with scripts/testing/artifact-language-baseline.json,
# `{ "<path>": { "spanish": n, "names": n } }`, keyed per file and holding only files that count:
# equal in both directions, and a file the baseline does not name must count zero.
# EXEMPTIONS. The allowlist in the script names a file, one line of a file, a file with the English
# twin that must be tracked beside it, or a rule over paths, with the counters it exempts and its
# reason: docs/GOVERNANCE.md and the one `GRANT_ISSUER = "..."` line of .claude/hooks-py/_common.py
# for names; the two `es.json` catalogs, the i18n fixtures, the Unicode fixtures,
# apps/client/components/shared/LanguageSwitcher.tsx for its endonym comment, the Unicode fold table's
# generator
# and the vendored Unicode Character Database file, DEF-151's InboxEventHandlers.ts, and
# docs/product/INVESTOR_ES.md and MARKETING_ES.md beside their `_EN` twins, for Spanish; and for
# both, the gate and its suite, and every `migration.sql` under infra/prisma/migrations. A new
# exemption is a reviewed edit of the allowlist, with its reason. The generated records (ledger.json,
# LEDGER.md, probes.json, dependency-ledger.json, the generated legal and support pages,
# eslint-suppressions.json, the generated API types, the Unicode fold table, pnpm-lock.yaml) are
# excluded from both counters because a generator writes them, each entry naming its generator;
# the exclusion is structural, so it holds while a record counts zero and a record is never counted
# twice. `--write` rewrites the baseline from the tree, or deletes it once every count is zero and
# prints `every count is zero: deleted scripts/testing/artifact-language-baseline.json`; from then on
# the gate requires zero. With an inert exemption `--write` still writes the baseline, then exits 1
# on that exemption. The baseline file itself is never counted.
# WHERE IT RUNS, and why: in the `fitness` job of fitness.yml, which installs nothing, beside #44:
# the gate reads git's listing and the tracked files and imports nothing beyond Node's own modules.
# The battery runs it through its alias, `pnpm check:artifact-language`, as its step `artifact-language`.
# WHAT FAILS, exit 1, each printed to stderr as `artifact-language-gate: <problem>`: a counter above
# its baseline entry, named with its file, its count, the entry and its line numbers (`<file>:
# spanish 1, baseline 0: new debt at line 270`); a counter below it, a stale entry to lower in the
# same change (`stale baseline. Lower it to <n>`); an entry for a file git no longer tracks; a
# baseline that still exists once every count is zero; no baseline while a file still counts, which
# lists every file that counts; an exemption whose file or English twin git does not track, whose
# rule matches no tracked file, or whose line rule matches other than exactly one line of its file;
# an exemption that exempts no counted line today (`exempts no counted line: delete its entry`), so
# a fixed text cannot leave an inert exemption behind; and a generated record git does not track.
# FAIL-CLOSED, exit 3, which wins over 1: `git ls-files` failing or listing no file, a tracked file
# that cannot be read, and a baseline that cannot be read, is not JSON, or is not an object whose
# every entry holds exactly the two counts as non-negative integers, not both zero; a baseline that
# `--write` cannot write; and any unexpected error, printed as `the scan failed: <message>`. A missing
# baseline is read as zero required, never as permission. A usage error, an unknown flag, or
# `--write` or `--root` given twice, exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) the heuristic is a floor: Spanish with no accented
# character and fewer than two of the listed function words on a line is invisible, and so are
# accents written decomposed (NFD) and any file not encoded in UTF-8, such as Latin-1; (2) it also
# counts what is not Spanish: a French, German, Italian or Portuguese word with one of the
# characters, and two place names on one line that each begin with a Spanish article; on main @
# 1939e73a every one of the 155 lines it counted by function words alone held Spanish; (3) it counts,
# never names lines: a change that fixes one line of a file and adds another keeps the file's count
# and passes, and the line numbers printed for new debt are the defence (fitness #38's tradeoff); (4)
# a file exemption covers its whole file, so new prose in an exempt file is unseen; (5) every
# `migration.sql` is exempt from both counters, applied or not, so a new migration's Spanish comment
# passes before it is ever applied; (6) only the name words count: the GitHub handle and any other
# spelling of the person are unseen, and so is a name the person never wrote out; (7) it reads the
# working tree of the files git lists, so an untracked file is not counted until it is added.
node scripts/testing/artifact-language-gate.mjs   # expect exit 0 and one line:
#   artifact-language-gate: <T> tracked files; <S> Spanish lines and <M> name mentions in <F> files equal scripts/testing/artifact-language-baseline.json
node scripts/testing/artifact-language-gate.mjs --write   # rewrites the baseline and prints one line:
#   artifact-language-gate: wrote scripts/testing/artifact-language-baseline.json: <F> files, <S> Spanish lines, <M> name mentions

# 54. Every test block a pull request deletes or rewrites has a committed mutation-diff record that covers it.
# Threat: a deleted or rewritten test block reads as an improvement in review while it can take with
# it the only check of a behaviour. The test ledger names each block by id and bodyHash, and the
# differential mutation tool (WU-2.3b, `pnpm mutation-diff`) measures what a deletion or a rewrite
# costs, but nothing required its record: measured at main 05d4b83d (2026-11-08), 18 of the 58
# first-parent merges to main since ledger.json was committed (3ef9bf39, 2026-10-28) removed or
# rewrote 695 blocks, 687 removed and 8 rewritten, with no measurement tied to any of them.
# WHAT IT RUNS: `pnpm check:record-coverage`, which is `node scripts/testing/record-coverage-gate.mjs
# --retire-check`; the battery step and the CI step pass the flag too. Its pure core is
# scripts/testing/lib/record-coverage-core.mjs, pinned by
# apps/api/tests/unit/scripts/recordCoverageGate.test.ts. It runs no mutation. The base is
# FITNESS_BASE_REF, origin/main when unset, resolved to its merge base with HEAD; the base ledger is
# `git show <merge base>:ledger.json`, the head is the working tree (CI checks out HEAD). It binds each
# block id the head lost (a deletion) and each id whose bodyHash changed (a rewrite), and gives each
# one class, in this order: moved (a deletion whose base bodyHash the head holds under an id the base did not hold); live
# (a row whose collectors name node:test's live tier, which needs a running API mutation-diff does not
# start); no-collector (a row with `collectors: []`, which nothing runs); behaviour change (its
# test imports a changed source directly, by a relative specifier or a bare specifier
# tsconfig.base.json's `paths` maps, read at the base for a deletion and at the head for a rewrite; a
# string literal holding the source's path is not an import, except in a test under
# apps/api/tests/unit/scripts/ where a string literal outside its comments is, or ends after a `/` with, the
# path of a changed source under scripts/testing/, and so is the run of consecutive string-literal
# arguments of one `path.join(...)` call, joined with `/`, the call written in code outside its comments,
# never text inside a string); covered (a case of a committed record under
# docs/development/testing-refoundation/mutations/*.record.json lists the id with both bodyHash values
# equal to the ledgers', `null` at the head for a deletion, its kind, and SAFE for a deletion or GAIN
# for a rewrite; a BEHAVIOUR-CHANGED case, the tool's measured verdict for a test whose base form
# fails on the new code while the head is green, is listed as a behaviour change); or refused.
# WHERE IT RUNS, and why: in the `fitness` job of fitness.yml, which installs nothing, after #53: the
# gate and its core import Node's own modules only. On pull_request only, like #37 and #47, because its
# subject is the pull request's delta against its base; the step fetches the base in three bounded
# attempts and deepens the shallow checkout until the merge base resolves. The battery runs the same
# command as its step `record-coverage`, against origin/main.
# WHAT FAILS, exit 1, each printed as `record-coverage-gate: refused: <id> (<kind>): <reason>`:
# `no-record`; `stale-record` (a bodyHash of the record differs from the ledgers: re-run
# mutation-diff); `wrong-kind`; `failing-verdict: <verdict>` (NO-GAIN, BROKEN, UNDECIDED, LOST,
# VACUOUS, or a verdict of the other kind); and a record under mutations/ that is not the tool's
# shape, named with its file. Moved, live, no-collector and behaviour-change blocks are listed, never
# refused. RETIRES WHEN, held by the gate under `--retire-check`, which `pnpm check:record-coverage` passes,
# on the head ledger.json: the live class once no row's collectors name the live tier, exit 1 with `the live class matches no ledger row: delete it (its tier left the
# tree)`; the no-collector class once no row has `collectors: []`, exit 1 with `the no-collector class
# matches no ledger row: delete it (its files left the quarantine)`.
# FAIL-CLOSED, exit 3: a base that does not resolve or shares no merge base with HEAD; ledger.json
# unreadable, not JSON or with no `files` array on either side; a tsconfig.base.json that is not JSON;
# git failing. No mutations/ directory with a refused block is exit 1, not 3. A usage error exits 2:
# the command takes no argument but `--retire-check` and `--summary <file>`, which appends the lines as a Markdown table,
# the job summary's way.
# RESIDUAL LIMITS, stated rather than implied: (1) it reads the committed ledgers, and that they
# match the tree is #52's part; (2) it proves a matching record exists, never that its mutation was
# realistic or the record genuine, which the verifier's re-run of mutation-diff proves; (3) a rename
# with a body edit reads as a deletion plus an addition, and a deletion whose body the head holds
# under a new id, a new copy included, reads as moved; (4) the
# import exclusion reads direct imports only and the script suites' rule a whole literal or the literal
# run of one `path.join` call only, read with the test's `//` and `/* */` comments stripped, so a test
# that reaches a changed source through another module, a path built from fragments other than the
# consecutive literal arguments of a `path.join` call (a non-literal argument ends a run; `path.resolve`,
# concatenation, a template literal and a bare `join` import stay unseen), a path written only in a
# comment, a literal outside apps/api/tests/unit/scripts/ or a changed file outside scripts/testing/
# needs the tool's measured BEHAVIOUR-CHANGED verdict in a committed record; (5) a file the ledger excludes is
# invisible; (6) a block's bodyHash covers its callback body only, so a row deleted from an `it.each`
# table, or an expected value weakened in one, changes no id and no hash and binds nothing (plan
# row RECORD-COVERAGE-EACH-TABLES); (7) a live-tier or no-collector block is listed, never measured.
pnpm check:record-coverage   # expect exit 0, 0 refused, and first one line:
#   record-coverage-gate: <n> bound blocks against <base> (<sha>): <c> covered, <m> moved, <l> live, <q> no-collector, <b> behaviour change, <r> refused

# 55. The auto-loaded instruction files match their manifest and budget, and the hooks that enforce them are wired.
# Threat: the instruction content every session loads by itself grows with nothing counting it,
# until the model refuses the project. Measured (ADR-0045): the loaded project instruction files
# grew from 449 KB on 2026-10-15 to 572 KB on 2026-11-14, and the largest model then refused every
# request of the project because of the instruction content alone. Moving the records out was the
# repair; this check keeps the context from growing back unnoticed, and keeps wired the hooks that
# hold the manifest in every session.
# WHAT IT RUNS: `pnpm check:instruction-context`, which is `node
# scripts/testing/instruction-context-gate.mjs`, pinned by
# apps/api/tests/unit/scripts/instructionContextGate.test.ts. The script's header states the rule
# in full, and this block summarises it. It reads git's listing with its file modes, the manifest
# .claude/instruction-manifest.json, the entry files the harness reads from the project root
# (CLAUDE.md always; .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/AGENTS.md when git
# tracks them), every file an `@` token of a loaded file or of any tracked rule names, followed
# with no depth limit, and every tracked rule under .claude/rules/. A rule is path-scoped, and its
# body uncounted, only when its front matter proves it under a narrow grammar: `paths:` and a block
# list of double-quoted globs, at least one of which, trimmed and with one trailing `/**` cut, is
# neither empty nor `**`; any other rule counts as loaded. The manifest is `{ version: 1, tracked,
# local, records, budget }`: the files every checkout loads, the files only the main checkout
# holds, each record moved out of the loaded files with its rule and the globs of that rule that
# match nothing today (`emptyGlobs`, glob to reason), and the byte ceiling (`bytes`) with its
# target (`target`).
# WHERE IT RUNS, and why: in the `fitness` job of fitness.yml, which installs nothing: the gate
# reads git's listing and the tracked files and imports nothing beyond Node's own modules. The
# static battery runs the same command as its step `instruction-context`.
# WHAT FAILS, exit 1, each line naming its rule: A1 an import that resolves to a file outside the
# repository; L1 a path git tracks as a symbolic link or a submodule at .claude, at .claude/rules
# or under it; M1 the tracked list differs from the derived set in either direction, names a file
# git does not track, or names one twice; M2 a local entry git tracks, one the tracked set loads,
# or one named twice; B1 the derived set's bytes above budget.bytes; B2 budget.bytes more than
# 1,024 bytes above them, a stale ceiling (`--write` lowers it and never raises it); B3
# budget.bytes above the target with no targetOwedBy, a targetOwedBy that does not start with a
# plan item id, or one left once the context meets the target; R1 a record's rule that is not a
# tracked Markdown file under .claude/rules/, whose front matter does not prove it path-scoped,
# that imports a file, or that does not name its document; R2 a record git does not track, one the
# context loads, or one that is not a Markdown file; R3 a glob of the rule that matches no tracked
# file and no emptyGlobs entry explains, an emptyGlobs entry whose glob matches a file or that the
# rule does not list, and an entry with no reason; W1 the hooks that enforce the manifest at run
# time are not in place: .claude/settings.json tracked, setting no disableAllHooks and no
# MAINTAINER_DISABLE_INSTRUCTION_CHECK or AI_AGENT in its env, and running the four entries (the
# instruction recorder, the check at UserPromptSubmit, and the record guard's record and judge
# modes), each an allowlist of keys, with the hook files tracked and the hooks executable.
# FAIL-CLOSED, exit 3, which wins over 1: git's listing failing, longer than the buffer the gate
# reads it into, or listing no file; a manifest that cannot be read, is not JSON or is not the
# shape above; a CLAUDE.md that is missing, unreadable or not a regular file; an entry file, a
# rule, an imported file or the settings that cannot be read; and a file the derivation or W1
# reads that git tracks and the checkout lacks. A usage error exits 2.
# FALSE REDS, the over-counts kept on purpose, each cleared by listing the file or rewording:
# every `@` token is read wherever it is written, code and comments included, and every prefix of
# it; imports are followed past the harness's hops and its skips are not applied; a tracked
# AGENTS.md counts; a rule the harness would read as scoped but outside the grammar counts as
# loaded; every link under .claude/rules/ is refused; the bytes are the files' bytes, front matter
# and HTML comments included.
# RESIDUAL LIMITS, stated rather than implied: (1) content the harness loads on a match, after
# session start, is not counted: a path-scoped rule's body, a subdirectory's instruction files and
# the rules of a subdirectory's .claude/rules; (2) a session started in a subdirectory also loads
# the files between it and the root; (3) only tracked rules and tracked entry files are read, so
# the local list names what one checkout holds; (4) the user's and the organization's instruction
# files and auto memory belong to the machine, not the checkout; (5) B3 checks the shape of
# targetOwedBy, not that a plan document names that item; (6) matching is Node's
# path.matchesGlob, whose wildcards skip dot-named segments, so a glob whose only files sit under a
# dot-named directory reads as matching nothing, a false red; (7) W1 proves the hooks are in place,
# not that they behave, which their own suites under .claude/hooks-py/tests/ hold; (8) W1 reads the
# tracked .claude/settings.json only; (9) onFailure has effect from Claude Code 2.1.295, and an
# older harness lets the call through when a hook cannot start.
# RETIRES WHEN: targetOwedBy left the manifest on 2026-11-18, once the check blocks left CLAUDE.md
# and the context fell under its target, which now holds as a hard cap; the check itself retires
# only by an ADR that records a measurement of the model provider's limit on instruction content
# showing no budget is needed.
node scripts/testing/instruction-context-gate.mjs   # expect exit 0 and one line:
#   instruction-context-gate: <F> auto-loaded files, <B> bytes of a budget of <B> (within the target of 250000); <R> records, <G> globs (<E> empty by entry); 4 of 4 hook entries wired; 0 violations

# 56. No closed feature has an open item under its record.
# Threat: a feature closes while items of its record are open, and those items lose their date and
# their owner: no slice opens the feature again, so nothing schedules them and nothing says they
# wait. Measured on 2026-11-20: F-01 closed with #916 while 24 rows of its record were open (the
# cross-cutting item ROWS-WAIT-UNDER-CLOSED-F-01), and F-02 came within one change of closing
# with 22. The Product Owner's rule of that day: no feature closes with an open item (ADR-0046).
# WHAT IT RUNS: `pnpm check:plan-closure`, which is `node scripts/testing/plan-closure-gate.mjs`,
# pinned by apps/api/tests/unit/scripts/planClosureGate.test.ts. The script's header states the
# rule in full, and this block summarises it. Fenced code blocks are never read, in the plan or in
# the records. It reads the first table of `## The chain` in docs/product/PLAN.md by its `#` and
# `State` columns and, for each row whose State is `closed`, the record that the one heading of
# docs/product/plan/chain.md or docs/product/plan/areas.md whose text is that id alone, or that id
# followed by a space, opens, up to the next heading of its level or above. The record's items are
# the entries of its `Attached (<n>)` list and of every list whose bold label, colon inside the
# bold, starts with `Findings`: each entry is a line indented two spaces, `  - **<id>**: <text>`
# with an optional `(<reference>)` after the id, and a line indented four spaces or more that opens
# no list continues the entry above it; a `  - Note: <text>` entry is not an item, and every other
# list of the record is prose. An item is closed when its text starts with one of two forms, each
# with no punctuation of its own, the rest of the item's text following it: `Closed by #<n>`, the
# number from 1 with no leading zero and ending its word, or `Closed by decision of the
# <Product Owner|Maintainer> on <YYYY-MM-DD>: <the decision>`, the date a calendar date no later
# than the day the check runs (UTC) and the decision holding at least one word of three letters or
# more. Every other item is open. Only the chain table holds a state.
# WHERE IT RUNS, and why: in the `fitness` job of fitness.yml, which installs nothing: the gate reads
# three Markdown files and imports nothing beyond Node's own modules, which is why it keeps its own
# entry-point check rather than importing lib/record-helpers.mjs, a module that imports prettier.
# The battery runs it through its alias, `pnpm check:plan-closure`, as its static step
# `plan-closure`.
# WHAT FAILS, exit 1, each on stderr as `plan-closure-gate: <problem>`: an open item under a closed
# feature, named with the feature, its line in the table, the item's id, its line and its list; an
# item that starts `Closed by`, in any case, in neither form, named as such; then the line `<k> open
# items under <c> closed features`. A feature that is `open` or `in progress` is never judged.
# FAIL-CLOSED, exit 3, which wins over 1 and prints the open items too: the plan, chain.md or
# areas.md that cannot be read; no `## The chain` section, or two; a section with no table; a table
# with no `#` or no `State` column, a row whose cells are not the header's, a row with no id, an id
# listed twice, or no feature row; a state other than open, in progress and closed; a closed
# feature whose record no heading opens, or more than one does; a record with no `Attached (<n>)`
# list, or whose `<n>` is not the number of items read under it; an entry of an item list that is
# neither an item nor a note, a mis-indented entry included; a nested list entry under an entry of
# an item list, whether it holds an item or prose, because an item written there could not be told
# from prose; a continuation of an entry whose text starts like an item (after its indentation, a
# bold id, an optional reference and a colon), because an open item written there would read as
# the entry above it; any line of the record shaped like an item (a bold text that ends with
# neither a colon nor a space, then `: `, anywhere on the line outside an inline code span, a span
# counting only when every backtick run of the line pairs with a later run of the same length) that
# an item list reads neither as an entry nor as an entry's continuation: an item at the record's
# top level, after
# a line that ended its list, under a label whose colon is outside the bold, in a prose list, inside
# a note or on a label's line; and a fenced code block still open at the end of its file, named in
# the record of the closed feature that opens it, else in its file, because every line after it
# would read as code. A usage error, anything but no argument or `--root <dir>`, exits 2.
# RESIDUAL LIMITS, stated rather than implied: (1) it reads the plan by its line shapes, not with a
# Markdown parser; (2) it proves the form of a marker, never that pull request #<n> resolved the
# item or that the decision was taken; (3) an item attached to a closed feature from outside its
# record, such as a cross-cutting row that names the feature or a list placed after a heading that
# ends the record, is not read; (4) a record's prose lists (`Wrong as read`, `To build`) hold no
# item, so a defect they describe in prose is not judged; (5) the table's `Closed by` column is not
# compared with the items; (6) the areas outside the chain have no state: the header of their
# table in docs/product/PLAN.md (line 86 at commit 6bc6482b) is
# `| Area | Features | End to end today | Old rows attached | Refoundation units |`, with no
# `State` column, and a feature of an area carries a `Today` verdict, not a state (the
# `| Feature | Who | Today | Depends on |` tables of docs/product/plan/areas.md), so an area's open
# rows are never judged; a feature of an area is judged once it joins the chain table; (7) an
# item-shaped text in the middle of a continuation line is that entry's text and is not read: only
# a continuation that starts like an item is refused; (8) the false positives left, both refused on
# purpose rather than let an item hide: a line of a closed feature's record, outside a code span
# and not the continuation of an entry of an item list, that writes a bold text followed by `: `
# (`the role **SUPER_ADMIN**: every permission`), and a line holding an unpaired backtick run,
# which is scanned whole, its code text included; such a line is reworded, or its backticks
# paired. An unclosed fence in the plan before `## The chain` hides the section too, so the gate
# prints both failures; after the chain table it prints the fence's failure, and the table is read.
# RETIRES WHEN: the plan leaves the tree under the Plan closure rule of CLAUDE.md, or a recorded
# decision of the Product Owner lets a feature close with an open item.
node scripts/testing/plan-closure-gate.mjs   # expect exit 0 and one line:
#   plan-closure-gate: <N> features in the chain table, <C> closed; <I> items under the records of the closed features, every one closed

# 57. The error registry is whole, and the list of existing error sites only shrinks.
# Threat: an error's code, status and text are written where it is raised or answered, so no
# place holds them and no front can look a code up. Measured on main at 55fecbe5c on 2026-11-20:
# about 12 vocabularies held about 200 codes, the API answered a failure in 6 body shapes, about
# 100 places turned a code into a status, and core and API held about 500 inline English
# sentences (ADR-0047, Context). The lint rule errors/no-inline-error refuses a new one. The sites
# the tree held when it was turned on, 3,492 in 522 files and 129 contexts on 2026-11-20, are a
# list that could stand still, rise, or fall with no conversion while every other check stays
# green. This check holds the registry whole and that list to falling only.
# WHAT IT RUNS: `pnpm check:errors`, which is `node scripts/testing/error-registry-gate.mjs &&
# node scripts/testing/error-sites-gate.mjs`, so a failure of the first skips the second; pinned
# by errorRegistryGate.test.ts, errorReferencePage.test.ts, errorSitesGate.test.ts and
# errorScope.test.ts under apps/api/tests/unit/scripts/. Each script's header states its rules in
# full, and this block summarises them. The rule's scope has one home,
# scripts/testing/lib/error-scope.mjs: every tracked .ts, .tsx, .mts and .cts file that its named
# list of exclusions for errors/no-inline-error does not exclude. Both gates read it, and
# eslint.config.ts builds the rule's block from the same list and options.
# THE REGISTRY GATE reads the registry's barrel and every domains/<name>.ts under
# packages/shared/src/error-registry/, loaded with jiti; the portals as #51 discovers them (a
# directory under apps/ with i18n/routing.ts and messages/), with their default locale and their
# catalogs; the history, through the sites gate's own reader; and the tracked files of the
# rule's scope. R1 every domains/<name>.ts has a name of the grammar
# `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` and exports one table, <NAME>_ERRORS, whose entries are of that
# domain, domains/ holds nothing but such files, and ERROR_TABLES holds every domain file's table
# once; R2 every key matches
# `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`, is at most 63 characters and is its entry's code; R3 no code is
# in two tables; R4 the category is one of the thirteen and the status one of its statuses; R5 the
# message is one line that is not blank and holds a letter outside its placeholders, and its
# `{name}` placeholders are exactly the declared parameters; R6 parameter names match
# `^[a-z][A-Za-z0-9]*$`, kinds are string, number, boolean or string[], and `fronts` is a list
# that names each portal at most once and only portals the tree holds; R7 a portal whose default
# locale's catalog holds `errorCodes` is enrolled, and every catalog of it holds a text for each
# code that names it and for nothing else, reading only that code's declared parameters, a number
# or a plural only a number one, a select only a string or boolean one, no date or time, and no
# tag; R8 every code is read in code as `<TABLE>.<CODE>`, or through a namespace as
# `ns.<TABLE>.<CODE>`, in a file of the scope outside the registry directory, a comment, a string
# and a computed member being no reference; R9
# docs/api/ERROR_CODES.md is byte for byte what scripts/testing/lib/error-reference-page.mjs
# renders from the registry and the history (`--write` rewrites it); R10 the word `defineErrors`
# occurs in no file of the scope outside the registry directory, in code, a string or a comment;
# R11 every name ending in `_ERRORS` that an `of` call reads as its first argument is a table of
# ERROR_TABLES.
# THE SITES GATE reads the `errors/` entries of eslint-suppressions.json, which ESLint writes and
# holds in both directions for every file it lints; the rows of scripts/testing/error-sites-history/;
# git's listing; ESLint's resolved configuration of every tracked TypeScript file
# (`ESLint#isPathIgnored`, `ESLint#calculateConfigForFile`); the rule package's manifest and
# sources; and the portals' catalogs. Always: S1 every path of the baseline is a regular file git
# tracks; S2 it is in its rule's scope; S3 the history exists exactly while the baseline holds an
# `errors/` entry, every row is a birth or a row of fixed and moved sites, every rule born is one
# the gate holds and is born once, every rule with entries is born, and the births minus
# everything fixed equal, per context, what the baseline yields; S4 the list of exclusions names only what exists, an entry of kind outside-src takes no
# file under a `src` directory and every entry carries what its kind claims, no JavaScript file
# lies under a `src` directory outside an excluded root, the plugin's package exports its `src`
# and its `src` imports nothing outside itself but the allowed built-ins, the rule's `bodyWriter`
# option names a tracked file, and on every tracked file of the scope ESLint does not ignore it,
# the rule is at `error` with exactly the held options, the plugin is the package's own object, no
# processor reads the file, and its parser and language are the ones the gate holds; S5 no file of
# the scope holds an `eslint-disable` directive that names an `errors/` rule or names no rule, nor
# an `eslint` configuration comment that names an `errors/` rule, no tracked package.json, hook
# under .husky/ or workflow holds `pass-on-unpruned-suppressions`, and the root `lint` script is
# the one the gate holds. Against a base, the head being HEAD, every path of the base read through
# the renames git reports (S6a): S6 no count of a rule the base's history bore rises, and no path
# gains an entry, but by the birth of a rule or a recorded move into it; S7 a count falls only
# where git reports a change of the file's content, or its deletion; S8 a renamed file of the
# base's baseline stays in its rule's scope, and a portal whose catalogs hold `errorCodes` on the
# base holds it in every catalog on the head; S9 when the rule's package, the sites gate or the
# scope module differs from the base, no count of a rule the base's history bore differs; S10
# every row of the base is on the head unchanged, the head adds the one row the difference yields
# when a count, a context's total or a birth differs and none otherwise, and no row it adds is
# dated after today in UTC.
# WHERE IT RUNS, and why: in the dependency-consistency job of fitness.yml, beside #45 to #48, #50
# and #51, because the registry is loaded from source with jiti and the sites gate asks the
# installed ESLint for each file's configuration. It runs on push and on pull_request. On a pull
# request FITNESS_BASE_REF is the event's base sha, fetched in up to three attempts, and a base
# that does not resolve fails the step; on a push the variable is empty, the sites gate prints
# `base: none (S6 to S10 skipped)`, and every other rule runs. The battery runs the same command as
# its static step `errors`, with FITNESS_BASE_REF as the base when it is set, else the merge base
# of HEAD and origin/main, the local counterpart of the pull request's comparison; when git finds
# no merge base the step passes origin/main itself, never an empty base, and a name that does not
# resolve fails it closed. The scheduled half is no verdict of this check: error-sites-stall.yml
# runs the sites gate with `--stalled --days 14 --remind` every day, and keeps one issue, labelled
# error-sites-stalled, while the list is above zero and no row is dated in the last 14 days.
# WHAT FAILS, exit 1: a verdict of either gate, each on stderr, as `error-registry-gate: <code or
# path>: <problem> (R<n>)` or `error-sites-gate: <path or context>: <problem>`; a rise names the
# base's count, the head's and the command that lowers it, and a missing row the `--record`
# command that writes it.
# FAIL-CLOSED, exit 3, which wins over 1 and prints the verdicts too. The registry gate: a root
# that is not a directory; an exclusion list that is not a non-empty list of entries, each with a
# glob the matcher reads and a known kind; fewer than two portals; a routing file that cannot be
# read or holds no one `defaultLocale` line; a catalog that is not JSON or not an object, a default
# locale with no catalog, or a text of an enrolled portal that is not valid ICU; domains/ missing
# or holding no <name>.ts; the barrel or a domain file that cannot be loaded; ERROR_TABLES
# missing, not an array or empty; a history its reader cannot read, or a row it reports that is not
# the format of its rows; the page unreadable for a reason other than its absence, unrenderable,
# or, under `--write`, unwritable; `git ls-files` failing or listing no source file of the scope,
# or a file of the scope that cannot be read; the command that cannot load the sites gate's
# reader; and any other failure of the command's run, printed as `error-registry-gate: the run
# failed before reaching a verdict: <reason>` rather than left to Node's exit 1, the code of a
# verdict. The sites gate: `git ls-files` failing or
# listing nothing; eslint-suppressions.json, on the head or the base, that cannot be read, is not
# JSON or is not ESLint's shape for an `errors/` entry (a missing file is no entry, as ESLint reads
# it), or a history entry, on either side, that is no row file, is not JSON or is not a row; a held rule with no list or no options; a glob the matcher does not
# read; ESLint's configuration that cannot be resolved; the plugin's manifest, a source file or a
# catalog that cannot be read; a base that cannot be resolved; a git call against the base that
# fails for a reason other than a path absent there. A check that needs an input that was not read
# is skipped, never run on part of it. A usage error exits 2.
# RESIDUAL LIMITS, stated rather than implied. Of the rule, whose header lists what it does not
# see: (1) a class that extends an error class under a name that does not end in `Error`, built
# with `new`; (2) a construction through the prototype (`Object.create(X.prototype)`); (3) a
# wrapper of a reply helper under a name the rule's options do not list; (4) a failure answered by
# hand in a shape the rule does not follow: a body in a variable sent with the default status, a
# status set apart from its `send`, a reply under another name, the raw response, or a value that
# carries a `statusCode` and is answered at that status; on the registry path none of them reaches
# a front with a text of its own (ADR-0047, decision 2.3). Of the registry gate: R8 proves a
# reference, not an emission; R1 cannot see a domain file's type-only export; R10 reads text, so a
# name assembled from parts passes it, and the rule's `registryDefinition` reads the import that
# such a read needs; R11 reads calls by their syntax; R7 holds a text to its code, not to the
# code's meaning; R9 names a stale page and not the line that differs; an entry that omits a portal
# that does receive its code passes, and that portal shows its generic text. Of the sites gate: a
# count is not a line, so a change that fixes one site of a file and adds another keeps its count;
# a change of the rule that moves no count passes S9, and a later change that prunes a file it
# edited passes S7, which is why the rule package, the scope module and the sites gate are guarded
# paths of the hooks (ADR-0047, decision 4.5), in force once that change reaches main; S7, S9 and
# `--record` read the changes from HEAD, so a change not committed is not seen by them; the
# directive scan reads text, so a string that spells a directive is reported as one; the plugin's
# imports are read from its syntax, so a module it loads with no import and no `require` call
# (`process.getBuiltinModule`) is not seen; a file deleted and added again under a root the scope
# excludes whole (the fronts and the tooling packages) leaves the list with no conversion, and
# nothing refuses a backend import of such a package; a push with no pull request has no base,
# and branch protection is what stops it. A base other than the merge base of what is compared
# reads the main branch's changes after the merge base as the change's own. In the battery the
# head is the branch and the base its merge base with origin/main, so a base ahead of it comes only
# from a FITNESS_BASE_REF that names one, or from origin/main's tip when git finds no merge base
# and that name resolves: S6 can then name a count the main branch lowered since as a rise, S10 a
# row it added since as deleted, and S9 any count that differs once it changed the rule's files
# since, all false reds. A change that appears only once the main branch is merged is seen by CI,
# and in the battery only once the branch takes the main branch. In CI the base is the
# pull request's base sha, as for #37, and the head the merge ref: when that base lags the merge
# ref's first parent, S9 can name a false red the same way, and S10 one when the main branch's
# later row sits beside the pull request's or beside a count it does not cover. Either way S7 can
# pass: a count the change lowered in a file it did not edit reads as a fall with changed content
# when the main branch edited that file since, so a count lowered by something S4 and S9 do not
# watch (a parser's version in the lockfile, for one) is not refused. The import rule that keeps
# production from importing test code, `production-imports-no-test-code` of
# .dependency-cruiser.cjs, takes as origins only the modules under a `src` directory of the roots
# it cruises and the infrastructure modules reached from them: the files of the scope outside a
# `src` directory (infra/prisma/seed.ts, infra/prisma/prisma.config.ts, infra/prisma/scripts/*,
# apps/api/vitest.coverage-thresholds.ts) are no origins, and an import through a variable or
# through `createRequire` is not seen. The parser block of eslint.config.ts names `.ts` and `.tsx`
# only, so the first `.mts` or `.cts` file of the scope turns S4 red, its parser not the one the
# gate holds, until that block names the extension: it fails closed. The exclusion
# `packages/*/*/tests/**` of the scope list, and `TESTS_BESIDE_SOURCE` of .dependency-cruiser.cjs,
# match a grouped package's `tests` directory and also `packages/<package>/src/tests/`, which the
# list means to leave in scope; no such directory exists, and once one does S4 turns red on its
# files and the import rule refuses an import of them (the plan item
# TESTS-BESIDE-SOURCE-GLOBS-MATCH-A-PACKAGE-SRC-TESTS-DIRECTORY). Of the stall: a row's date is what its author wrote, the
# clock read only to refuse a date after today, and `--stalled` trusts it; two runs of one day
# that read different counts both comment; it says the list moved inside the window, not that its
# pace is enough, and it blocks no merge. scripts/testing/lib/issue-reminder.mjs, which it calls
# to keep the issue and which the patched-dependencies gate shares, is a guarded path as the gate
# is, so a change to either gate's reminder waits for a window of the Maintainer.
# RETIRES WHEN, part by part (ADR-0047, decision 4): the baseline, its history, S3 and S6 to S10
# once every count is zero, when the history is deleted and the sites gate keeps only "no entry of
# an `errors/` rule", S4 and S5; S4 and the guard with the rule; the stall alarm when the history
# is deleted; the per-portal start of R7 when both portals hold `errorCodes`; the registry gate and
# the reference page never while the registry exists.
pnpm check:errors   # expect exit 0 and, on stdout:
#   error-registry-gate: PASS
#   <n> codes in <m> domains
#   admin: enrolled, <k> codes   (or: admin: not enrolled)
#   client: enrolled, <k> codes   (or: client: not enrolled)
#   error-sites-gate: PASS
#   error-sites-gate: <N> sites in <C> contexts
#   error-sites-gate: base: <ref>   (or: base: none (S6 to S10 skipped))
````

## Not a numbered check

**Not a numbered check — the integration-tier RLS coverage gate.** One
invariant in this suite's remit cannot live here, and saying so is the point:
whether row security actually covers every guard-enrolled table is DATABASE
state. `pg_class.relrowsecurity`, `pg_class.relforcerowsecurity`, the table
owner and `pg_policy` are not greppable, and the fitness workflow runs no
Postgres service — a check written here could only ever assert that a migration
file contains the word `ENABLE`, which is not the same claim. The gate is
therefore an integration test, and it is named here so the gate inventory stays
complete rather than silently short by one:

| Field            | Value                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suite            | `apps/api/tests/integration/rls-tenant-isolation.integration.test.ts` — `describe("pg_catalog coverage gate")`                                                                     |
| Runner           | the services tier of `apps/api/scripts/run-tests.sh`, which collects every `*.integration.test.ts` (fitness #30: a file `run-tests.sh --list` does not reach never executes)       |
| CI job           | `Integration Tests` in `.github/workflows/ci.yml`, on every `pull_request`, against the migrated Postgres service                                                                  |
| Passes only when | for every model in `getTenantScopedModels()`: `relrowsecurity` is true **and** ≥1 policy exists **and** (the app role does not own the table **or** `relforcerowsecurity` is true) |
| Red demonstrated | all three partial states planted, each a real non-zero exit, restored and re-confirmed green — recorded in `docs/technical/ADR-0022-rls-enforcement-posture.md` §Coverage-gate red |

The three partial states are named separately by the failure message because
they fail in OPPOSITE directions and need opposite repairs: policy-without-RLS
**leaks**, RLS-without-policy **denies**, owner-without-`FORCE` **leaks** again.
A generic "RLS not covered" would send the reader toward the wrong fix.
