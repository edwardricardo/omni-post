# ADR-0019: pnpm 10.16.0 → 11.13.0 migration — restore `pnpm audit`, unify build allowlist, collapse the vite 7/8 split

- **Status**: Accepted
- **Date**: 2026-07-15
- **Deciders**: Edward Velasquez
- **Supersedes**: — (see "Relationship to ADR-0018" below — this ADR **reverses one scoping clause** of ADR-0018, it does not supersede it)
- **Superseded by**: —

## Context

`pnpm audit` broke repo-wide. The root cause is upstream, not ours: **npm retired
the legacy audit endpoints** (`/-/npm/v1/security/audits` and
`/-/npm/v1/security/audits/quick`), which now return **HTTP 410 Gone**. Every
pnpm 10.x release calls those retired endpoints, so `pnpm audit` — the command
wired into the `dependency-audit-policy` gate and the CI security posture — fails
for the whole monorepo regardless of the advisory state of the tree.

pnpm moved to npm's **replacement bulk advisory endpoint**
(`/-/npm/v1/security/advisories/bulk`) only in **pnpm v11** (pnpm PR #11268 —
a breaking change with **no 10.x backport**). There is no configuration or
override that makes a pnpm 10.x client speak the bulk protocol; the canonical
fix is to upgrade the package manager to pnpm 11. pnpm 11 requires **Node 22+**;
the repo already runs **Node 24**, so the runtime floor was already satisfied.

pnpm 11 also changed **where it reads configuration** and **how it models
build-script approval and freshness**, so the upgrade is not a version-string
bump — it is a config relocation + settings transformation across
`package.json`, `pnpm-workspace.yaml`, and `.npmrc`. Separately, pnpm 11's
stricter `pnpm dedupe --check` surfaced a pre-existing dependency split (vite 7
vs vite 8) that the predecessor baseline had frozen behind a catalog hold; the
migration traced that hold to its real cause and eliminated it at the root.

## Decision

**Upgrade the package manager to `pnpm@11.13.0`** and complete the six
configuration changes pnpm 11 requires, plus the one root-cause dependency fix
its stricter dedupe surfaced. Concretely:

1. **`packageManager` bumped to `pnpm@11.13.0`** (with a regenerated integrity
   hash) in the root `package.json`. `quality/scripts/setup-environment.sh`
   `REQUIRED_PNPM_VERSION` raised from `10` to `11`.

2. **Config relocated out of the `package.json` `pnpm` field** — pnpm 11 **no
   longer reads the `pnpm` field in `package.json`**. Moved **verbatim** into
   `pnpm-workspace.yaml`:
   - `overrides` — all **44 entries**, byte-for-byte (the CVE-floor pins and
     de-dup pins are unchanged; only their file home moves);
   - `auditConfig.ignoreGhsas` — the **3 accepted GHSAs**;
   - `patchedDependencies` — the `@secretlint/node` patch.
     The `package.json` `pnpm` field is now **gone**.

3. **Build-approval settings transformed to `allowBuilds`** — pnpm 11 **removed**
   `onlyBuiltDependencies` and `ignoredBuiltDependencies` and unified them into a
   single **`allowBuilds`** map (`package → boolean`). pnpm 11's `allowBuilds` is
   **exhaustive**: every package that ships a build script must appear in the
   map, allowed (`true`) or denied (`false`). Translation preserving exact
   pnpm-10 behavior:
   - the 4 previously-allowed builders stay allowed (`true`): `prisma`,
     `@prisma/engines`, `@prisma/client`, `esbuild`;
   - `bcrypt` (previously in `ignoredBuiltDependencies`) is denied (`false`);
   - **15 additional build-script packages** that pnpm 10 silently never built
     (because its `onlyBuiltDependencies` allowlist was **exclusive** — anything
     not listed never ran its scripts) are added as `false` for exact parity:
     `argon2`, `sharp`, `@swc/core`, `bufferutil`, `utf-8-validate`,
     `@ast-grep/cli`, `@parcel/watcher`, `@sentry/cli`, `contextify`,
     `core-js-pure`, `es5-ext`, `msgpackr-extract`, `msw`, `protobufjs`,
     `unrs-resolver`. Denying them = the same install artifact pnpm 10 produced.

4. **`.npmrc` non-auth settings moved to `pnpm-workspace.yaml`** — pnpm 11 reads
   **only auth/registry keys** from `.npmrc`. The two non-auth keys were moved
   and renamed to their YAML settings form:
   - `public-hoist-pattern[]=@stryker-mutator/*` → `publicHoistPattern`;
   - `save-prefix=""` → `savePrefix`.

5. **`minimumReleaseAge: 0` set explicitly** — pnpm 11 introduces a new default
   of `1440` minutes (a 1-day maturity hold on newly-published versions). We
   pin it explicitly to `0` to **preserve pnpm-10 behavior**: freshness is
   already governed by ADR-0018 via `taze -l --maturity-period 7`, so a second,
   unrelated maturity window at the installer layer would be redundant and
   confusing. Aligning the installer window to ADR-0018's 7-day buffer
   (`minimumReleaseAge: 10080`) is deliberately deferred (see "Revisit if").

6. **The vite 7/8 split eliminated at its root cause (the notable win).** pnpm
   11's stricter `pnpm dedupe --check` flagged a split: **vite 7.3.5** (the
   frontend catalog pin) vs **vite 8.0.16** (pulled by Storybook). The
   predecessor catalog held `vite: 7.3.5` with the justification "vite 8 breaks
   apps/client JSX/SSR." Investigation found that justification was itself a
   **workaround masking a real defect**: `apps/client`'s `vitest.config.ts` was
   **missing `@vitejs/plugin-react`** — the plugin `apps/admin` already had. The
   vite-7 hold was compensating for the absent plugin, not for a genuine vite 8
   incompatibility. **Fix applied at the root**: added `@vitejs/plugin-react` to
   `apps/client` (and cataloged it, now shared by admin + client). With the
   plugin present, **apps/client 510/510 + apps/admin 106/106** pass under
   vite 8, so the catalog collapsed to a single **`vite: 8.0.16`** and
   `pnpm dedupe --check` exits 0 — **with no gate weakening** (no "smart dedupe"
   tolerance, no split allowlist). This is the root-cause-over-workaround
   principle: the split was a symptom; the missing plugin was the disease.

## Rationale

- **The break is upstream and total.** A 410 on the legacy endpoint is not a
  transient or a tree-state issue — it is an endpoint retirement that no pnpm
  10.x client can route around. pnpm 11's bulk-endpoint support is the only
  supported client-side path back to a working `pnpm audit`.
- **Config relocation is mandatory, not stylistic.** pnpm 11 does not read the
  `pnpm` field in `package.json` nor non-auth keys in `.npmrc`. Leaving them
  there is not "harmless duplication" — it is **silently dead config**: the
  overrides, GHSA ignores, hoist pattern, and save-prefix would simply stop
  applying. Relocation preserves every existing invariant.
- **`allowBuilds` exhaustiveness demands the extra 15 denials.** Under pnpm 11,
  an unlisted build-script package is a prompt/ambiguity, not a silent skip. To
  reproduce pnpm 10's exact install artifact (where only the 4 allowlisted
  builders ran), every other build-script package must be explicitly denied.
  `false` is the parity-preserving choice, not a new policy.
- **Holding `minimumReleaseAge: 0` avoids double-governance.** Freshness policy
  lives in ADR-0018 at the updater layer. Introducing a second maturity window
  at install time would split one concern across two knobs.
- **Root cause over workaround (the vite win).** The vite-7 hold looked like a
  compatibility constraint but was a bandage over a missing test plugin. Fixing
  the plugin let the split collapse honestly — no catalog exception, no dedupe
  tolerance — which is strictly better than a gate that learns to live with the
  split. (Engram obs 313.)

## Alternatives considered

- **Stay on pnpm 10; swap `pnpm audit` for `npm audit`.** Rejected: `npm audit`
  needs a `package-lock.json`, which a pnpm-managed repo does not have (and
  should not generate — a second lockfile is a drift and integrity hazard).
- **Stay on pnpm 10; run `osv-scanner` instead.** Rejected: unverified against
  our advisory-ignore allowlist semantics and our CI gate contract; it would be
  a new, separately-maintained scanner surface rather than a fix to the existing
  `pnpm audit` gate. Not adopted without validation.
- **Stay on pnpm 10; wrap `audit-ci`.** Rejected: `audit-ci` **delegates to
  `pnpm audit`** under the hood, so it inherits the exact same 410 — it moves
  the failure, it does not fix it.
- **Keep the vite 7/8 split and add a "smart dedupe gate" that tolerates it.**
  Rejected in favor of the root-cause plugin fix. Teaching the gate to accept a
  known split weakens the single-version invariant and normalizes the
  workaround; adding `@vitejs/plugin-react` removes the reason the split existed
  at all.
- **Do nothing / defer.** Rejected: `pnpm audit` is a live security gate; a
  gate that cannot run is not an accepted-debt item, it is a blind spot.

## Relationship to ADR-0018 (explicit reversal of one scoping clause)

ADR-0018 (dependency-freshness canon) and its dep-baseline change explicitly
scoped the audit config **out**: it recorded that keeping
`pnpm.auditConfig.ignoreGhsas` (and the security overrides) in the root
`package.json` was correct and that **"moving `auditConfig` to YAML is OUT OF
SCOPE per the change"** (`docs/product/PENDING_WORK_INVENTORY.md §7`). **This ADR
reverses that specific clause.** pnpm 11 makes the `package.json` home
non-functional, so the relocation is now mandatory, not optional. Everything
else in ADR-0018 stands unchanged — the single-version invariant, the exact-pin
catalog model, the transitive CVE-floor policy, and `taze --maturity-period 7`
all continue to govern. The **content** of the overrides / GHSA-ignore / CVE-floor
ledger is untouched; only its **file location** moved from
`package.json` (`pnpm.*`) to `pnpm-workspace.yaml`.

## Consequences

**Positive**

- `pnpm audit --audit-level moderate` works again (via the bulk endpoint) and
  exits **0**, with the 2 accepted advisories still ignored via the migrated
  allowlist.
- One source of truth for pnpm config: `pnpm-workspace.yaml` now holds
  overrides, GHSA ignores, patches, allowlist, hoist pattern, save-prefix, and
  freshness — the `package.json` `pnpm` field and the `.npmrc` non-auth keys no
  longer diverge from what pnpm actually reads.
- The vite catalog is a single `8.0.16`; `apps/client` gains the same
  `@vitejs/plugin-react` test substrate `apps/admin` already had. No dedupe gate
  weakening.
- Node floor (22+) already met; no runtime migration needed.

**Negative / costs**

- The `allowBuilds` map is now **exhaustive and hand-maintained**: any new
  dependency that ships a build script must be explicitly added (allowed or
  denied) or pnpm 11 will flag it. This is a new, ongoing maintenance surface
  (mitigated: parity-preserving default is `false`).
- Every doc that referenced the old config home (`pnpm.overrides` /
  `pnpm.auditConfig.ignoreGhsas` in `package.json`) had to be re-pointed at
  `pnpm-workspace.yaml` (this ADR's doc-audit companion edits).
- `@vitejs/plugin-react` is now a dependency of `apps/client` (cataloged).

## Verification (evidence, all local, all green)

- `tsc` / typecheck: **165 turbo tasks exit 0**.
- `pnpm audit --audit-level moderate`: **exit 0** (bulk endpoint; both accepted
  advisories still ignored via the migrated allowlist).
- `pnpm dedupe --check`: **exit 0**.
- `pnpm install --frozen-lockfile`: **exit 0**.
- The **6 CVE-floor overrides** still resolve to their pins: `tough-cookie
4.1.3`, `@hono/node-server 1.19.13`, `axios 1.17.0`, `form-data`, `ws`,
  `validator`.
- The `@secretlint/node` patch applies; `@stryker-mutator/*` is hoisted.
- Test suites: backend security **658/658**; frontend client **510/510** +
  admin **106/106**.
- **No dependency version drift** beyond the intended vite 7→8 collapse and the
  webpack peer-variant dedupe consolidation.

## Revisit if

- **Align `minimumReleaseAge` to ADR-0018's window.** If we decide the installer
  should mirror the updater's maturity buffer, raise `minimumReleaseAge` from
  `0` to `10080` (7 days) so the install-time hold matches
  `taze --maturity-period 7`.
- **Drop `@vitejs/plugin-react` / revisit vite.** When rolldown's JSX/SSR
  transform gap (the original stated reason for the vite-7 hold, vitejs/vite
  #21505) closes, re-evaluate whether the explicit React plugin is still the
  right substrate for the frontend test configs.
- **pnpm changes config surface again.** If a future pnpm major relocates config
  once more or backports/replaces the bulk audit protocol, revisit the home of
  these settings.

## Risks and Mitigations

| Risk                                                             | Mitigation                                                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A migrated override/GHSA-ignore silently stops applying          | `pnpm audit` exit 0 with the 2 advisories still ignored + all 6 CVE-floor pins re-resolved to their exact versions confirm the relocation is live. |
| `allowBuilds` drift (a new build-script dep runs, or is blocked) | Exhaustive map + parity-preserving `false` default; the 4 required builders remain `true` and are exercised by install.                            |
| The vite 7→8 collapse breaks a frontend test path                | Full suites re-run: client 510/510 + admin 106/106 under vite 8 with the added `@vitejs/plugin-react`.                                             |
| Node floor unmet on some environment                             | pnpm 11 requires Node 22+; repo already on Node 24. Enforced by `REQUIRED_PNPM_VERSION` in `setup-environment.sh`.                                 |

## References

- pnpm 11 bulk-audit-endpoint support — pnpm PR #11268 (breaking, no 10.x backport)
- npm legacy audit endpoint retirement (HTTP 410 on `/-/npm/v1/security/audits{,/quick}`)
- ADR-0018 dependency-freshness canon — `docs/technical/ADR-0018-dependency-freshness-canon.md`
- Root-cause-over-workaround (vite 7/8 collapse via missing `@vitejs/plugin-react`) — engram obs 313
- vite 8 rolldown JSX-in-SSR tracking — vitejs/vite#21505
- Audited audit-ignores ledger — `docs/security/SECURITY_CANON.md §Audited audit-ignores`
- Standing backlog / config-location notes — `docs/product/PENDING_WORK_INVENTORY.md §7`
