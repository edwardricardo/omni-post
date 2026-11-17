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

Before you change a version, an override, an ignored advisory, a patch, a hold or a base image, search the record for the package by name and read its row and its floor-history note, not the whole file. Record the change in that document in the same pull request. The obligation is stated in the section "Dependency audit record" of `docs/security/SECURITY_CANON.md`, and the rules of the audit in `docs/security/dependency-audit-policy.md`.
