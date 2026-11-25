---
paths:
  - ".github/workflows/fitness.yml"
  - "docs/development/FITNESS_FUNCTIONS.md"
  - "scripts/testing/fitness-inventory-gate.mjs"
  - "scripts/testing/coverage-floor-gate.mjs"
  - "scripts/testing/jsdoc-touched-gate.mjs"
  - "eslint.jsdoc.config.ts"
  - "scripts/testing/patched-dependencies-gate.mjs"
  - "scripts/testing/dependency-ledger.mjs"
  - "scripts/testing/lib/dependency-*.mjs"
  - "scripts/testing/i18n-lint.mjs"
  - "scripts/testing/ledger.mjs"
  - "scripts/testing/artifact-language-gate.mjs"
  - "scripts/testing/record-coverage-gate.mjs"
  - "scripts/testing/lib/record-coverage-core.mjs"
  - "scripts/testing/instruction-context-gate.mjs"
  - "scripts/testing/plan-closure-gate.mjs"
  - "scripts/testing/error-registry-gate.mjs"
  - "scripts/testing/error-sites-gate.mjs"
  - "scripts/testing/lib/error-scope.mjs"
  - "scripts/testing/lib/error-reference-page.mjs"
  - "scripts/testing/lib/git-environment.mjs"
  - "scripts/testing/lib/issue-reminder.mjs"
  - "scripts/legal/**"
  - "scripts/support/**"
  - "packages/test-contracts/src/reach.ts"
  - "packages/test-contracts/src/scopes.ts"
---

The file you touched defines or runs a fitness check. Each check's block (the threat it prevents, its scope and exclusions, its command, its fail-closed paths and its residual limits) is in `docs/development/FITNESS_FUNCTIONS.md`. It is not in your context: read it as a file, never import it.

Before you change a check, its step in `.github/workflows/fitness.yml` or the script it runs, find its block with `rg -n '^# <number>\.' docs/development/FITNESS_FUNCTIONS.md` and Read that range. Record the change there in the same pull request: an inline check's block and its workflow step stay the same text, and a script-backed check's block and step call the same command. A new check takes the next number, a block in the reference, a line in the reference's `## Inventory` and the count sentence of `CLAUDE.md` §Automated Compliance Checks; fitness #44 fails when the workflow steps, the reference blocks and that inventory do not each hold every number from 1 to the highest step number exactly once, when an inventory line's name is not its step's or its command does not occur in that step's run body, when the count sentence does not state that highest number, or when a list line is left in that section of `CLAUDE.md`; "Extending the suite" in the reference gives the steps, the red path included. An Edit, Write or MultiEdit of a file this rule governs, and a Bash write the guard can derive, is refused until the session, or the agent writing, has opened the reference with the Read tool or the Grep tool; a Bash command does not count.
