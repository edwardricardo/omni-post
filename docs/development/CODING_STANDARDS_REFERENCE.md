# Coding Standards — Reference

**Owner:** Maintainers
**Rules:** [CODING_STANDARDS.md](CODING_STANDARDS.md). This file holds their rationale, their examples and how to extend them, each under the heading of the section it belongs to.

---

## Testing

### Reference: the lint rules that hold this list

`pnpm lint` holds part of the list at `error`. Every test file takes `no-console`, which allows `console.warn` and `console.error`, the stderr writers `testing/no-stdout-in-node-test` points a node:test diagnostic to. Every test file takes the three rules of the classifier of `packages/eslint-plugin-testing`, in vitest and node:test alike: `testing/no-empty-test` (no assertion runs in the block), `testing/no-tautological-assertion` (every assertion is true by construction) and `testing/no-existence-only-test` (every assertion on every path checks only presence, type or truthiness). Every test file outside `e2e/` takes `testing/no-fixed-time-wait`. The files Vitest collects also take `vitest/expect-expect`, `no-conditional-expect`, `valid-expect`, `no-standalone-expect`, `no-identical-title`, `no-commented-out-tests`, `no-disabled-tests` and `no-focused-tests`: every test file but `*.integration.test.*`, `*.live.test.*`, `security/tests/` and `e2e/`, a static approximation of what the reach engine (`pnpm --filter @packages/test-contracts reach --json`) reports.

`eslint-suppressions.json` lists the violations the tree held when the rules landed; ESLint generates it (`--suppress-rule`). When a pull request deletes or fixes a suppressed block, the entry it leaves unused makes `pnpm lint` exit 2 while the file is still linted. A deleted file is the gap: its entries stay unreported until `eslint . --prune-suppressions` runs.

### Reference: what a cancelled test means

A cancelled test means one of:

- The test file doesn't use the correct test framework (`describe`/`it` from `node:test`) — rewrite or delete it
- A prior test leaked resources (open handles, timers, DB connections) causing `--test-force-exit` to kill pending tests — fix the leak
- A module resolution error (`ERR_MODULE_NOT_FOUND`) crashed the process before tests ran — fix the import or build dependency

### Reference: how vitest is kept off the other tiers

`RESERVED_TIER_EXCLUDES` (`packages/vitest-shared`) keeps vitest off the last four suffixes: `defineWorkspaceVitestConfig` adds it to the `exclude` of every config built through it, and the four app configs (`apps/api`, `apps/workers`, `apps/admin`, `apps/client`), which compose their own config, spread it by hand.

### Reference: Backend Unit Test Pattern (Vitest)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

describe("Feature Name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Specific Functionality", () => {
    it("returns expected result when given valid input", async () => {
      const result = await serviceUnderTest.method(testData);
      assert.ok(result.ok, "Operation should succeed");
      assert.strictEqual(result.value.property, expectedValue);
    });
  });
});
```

### Reference: Backend Integration Test Pattern (node:test)

```typescript
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("Integration Feature", () => {
  before(async () => {
    /* one-time setup — DB, Redis, etc. */
  });
  after(async () => {
    /* cleanup */
  });

  it("returns expected result against real services", async () => {
    const result = await serviceUnderTest.method(testData);
    assert.ok(result.ok, "Operation should succeed");
  });
});
```

---

## Documentation

### Reference: where `pnpm check:jsdoc` runs

`pnpm check:jsdoc` is `scripts/testing/jsdoc-touched-gate.mjs`, with its rules in `eslint.jsdoc.config.ts`. It runs in lint-staged on the staged files, as the battery step `jsdoc` against the merge base with `origin/main`, and in CI as fitness #47 against the pull request's base. A file no change touches is not checked, and `pnpm lint` does not load these rules. `pnpm check:jsdoc --all` lists every file still in violation with its count.

### Reference: examples and the variations seen

- `GatewayBillingService.ts` → `@layer application`
- `PrismaPostRepository.ts` → `@layer infrastructure`
- `billingWebhookRoutes.ts` → `@layer infrastructure`
- `PostRepository.ts` (interface) → `@layer domain`
- `PaymentAdapter.ts` (port contract in `packages/ports/`) → `@layer domain`
- `CampaignList.tsx` (React component) → `@layer infrastructure`
- `dashboard/page.tsx` (Next.js page) → `@layer infrastructure`
- `postRoutes.test.ts` (unit test) → `@layer infrastructure`

Variations that were written and are refused: `test`, `integration`, `unit`, `testing`, `presentation`, `page`, `hooks`, `ui`, `client-components`, `client-hooks`, `client-pages`, `client-state`, `client-lib`, `client-tests`, `ports`, `provider`, `test-infrastructure`, `infrastructure (routes)`, `routes`, `service`, `handler`.

---

## How to extend

Adding or amending coding rules:

1. **New naming convention** → append a row to the Naming table; add a fitness regex if the convention is grep-able.
2. **New TypeScript rule** → add a bullet to §TypeScript Strict Mode, with a concrete example when the rule needs one.
3. **New test framework rule** → update the §Test Framework Rules tables, and the reference pattern it changes.
4. **New `@layer` value** → forbidden. Three values total (`domain`, `application`, `infrastructure`). Amendments require an ADR.
5. **New mandatory artefact per change** → extend §Mandatory Requirements for Every Change. Keep the bar high but realistic.
6. **Amending a rule** → ADR required, in the shape of the latest ones. Update [CODING_STANDARDS.md](CODING_STANDARDS.md) with the new wording + link the ADR.
7. **New story requirement or runner change** → ADR (ADR-0035 is the current one); update §Test Framework Rules, §Mandatory Requirements for Every Change and `docs/frontend/REACT_STANDARDS.md` together.

Companion fitness checks live in `docs/development/FITNESS_FUNCTIONS.md §Inventory`:

- `#3` no `any` in domain/app/infra · `#4` no raw throws in domain/app · `#5` no `@ts-ignore` · `#8` no sprint/phase refs · `#9` @file header coverage · `#10` valid @layer values · `#12` @component on React components · `#37` coverage floors never descend · `#47` method-level JSDoc on every touched file (`pnpm check:jsdoc`).
