---
paths:
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - "package.json"
  - "**/package.json"
  - ".trivyignore"
  - "patches/**"
  - "**/Dockerfile*"
  - "docs/deployment/base-images.md"
  - "docs/security/dependency-audit-policy.md"
  - "docs/security/DEPENDENCY_AUDIT_RECORD.md"
  - "scripts/testing/holds-gate.mjs"
  - "scripts/testing/override-bands-gate.mjs"
  - "scripts/testing/patched-dependencies-gate.mjs"
  - "scripts/testing/patched-dependencies.json"
  - "scripts/testing/toolchain-population.json"
  - "scripts/testing/maturity-watchlist.json"
---

The file you touched is governed by the dependency audit record, `docs/security/DEPENDENCY_AUDIT_RECORD.md`. It is not in your context and it is large: read it as a file, never import it.

Before you change a version, an override, an ignored advisory, a patch, a hold or a base image, search the record for the package by name and read its row and its floor-history note, not the whole file. Record the change in that document in the same pull request. An Edit, Write or MultiEdit of a file this rule governs, and a Bash command that writes one where the guard can derive it (a redirection, `cp`, `rm`, an in-place editor such as `sd`, or a `pnpm` command that writes a manifest, the lockfile or the workspace file), is refused until the session, or the agent writing, has opened the record with the Read tool or the Grep tool. A Bash command does not count, `rg` included: find the row's lines with `rg -n '<package>'` on the record, then Read that range. A write the guard cannot derive passes unjudged: a script or a pnpm command that runs code, an interpreter one-liner (`python3 -c`, `node -e`, `perl -pi`), another package manager, a path built from a variable, `git apply`, and a checkout or a rebase that names no governed file. This obligation still holds for it. The obligation is stated in the section "Dependency audit record" of `docs/security/SECURITY_CANON_REFERENCE.md`, and the rules of the audit in `docs/security/dependency-audit-policy.md`.
