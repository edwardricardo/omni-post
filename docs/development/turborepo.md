# Turborepo

OmniPost uses [Turborepo](https://turbo.build) for build orchestration and local caching across the monorepo. It skips redundant work on packages that have not changed, significantly reducing build and test times.

## How it works

Turborepo hashes the inputs (source files, dependencies, environment) of each task. If the inputs haven't changed since the last run, it replays the cached output instead of re-executing the task. The cache is stored in the `.turbo/` directory at the project root.

## Commands

### Standard commands (with caching)

```bash
pnpm build        # Build all packages (cached)
pnpm test         # Run all test suites (cached)
pnpm typecheck    # Type-check all packages (cached)
pnpm lint         # Lint all packages (cached)
```

### Filtered commands

```bash
# Run tests for a specific package
pnpm turbo run test --filter=@providers/x

# Run tests only for packages changed since last commit
pnpm turbo run test --filter=...[HEAD^1]

# Run build for a package and all its dependencies
pnpm turbo run build --filter=@apps/api...
```

### Cache management

```bash
# Bypass cache for a single run
pnpm turbo run build --force

# Delete the entire local cache
rm -rf .turbo
```

## CI integration

### Daily CI (PRs and pushes)

The main CI workflow (`.github/workflows/ci.yml`) uses Turborepo caching via `actions/cache`. Only packages with changed inputs are re-built and re-tested.

### Nightly full suite

The nightly workflow (`.github/workflows/nightly.yml`) runs at 3:00 AM UTC with `--force`, bypassing all caches. This catches dormant failures in untouched packages that would otherwise remain invisible. On failure, it automatically opens a GitHub issue.

## Configuration

- `turbo.json` at the project root defines the task pipeline
- Each task declares its dependencies (`dependsOn`) and output artifacts (`outputs`)
- `dev` tasks are never cached (`persistent: true`)
- `test:e2e` tasks are never cached (depend on external state)
