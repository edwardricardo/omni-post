# Parking

Part of [the plan](../PLAN.md).

Ideas with no slice. Nothing here is worked on until the Product Owner moves it into the plan.

- Creation of an Organization by an administrator (decision of 2026-11-10: parked until a sales team needs it).
- Customer app calls derived from the generated API description, so a wrong path or method does not compile (old row API-TYPES-2).
- **CACHE-STAMPEDE-PROTECTION**: Single-flight, early recomputation or stale-while-revalidate for the cache adapter, so concurrent misses of one key do not each run the factory. Parked because no measure shows a thundering herd: protection waits for hot-key metrics to choose the policy (`docs/architecture/caching.md:155-165`, `docs/observability/LOGGING_CANON.md:57`); the port stays the same, since protection is a property of the adapter. Found by: the context diet, T3, the walk of `LOGGING_CANON.md` (2026-11-26, row O05); it was the backlog item PR-29, which the rewrite of `docs/architecture/caching.md` left with no id.
- **DATABASE-NAMES-IN-SNAKE-CASE**: Database table and column names in `snake_case` through `@map`, against Prisma's defaults. The Product Owner decided on 2026-11-25 that the canon says Prisma's defaults with no `@map` (`docs/development/CODING_STANDARDS.md:171`), which is what the schema does for 122 of its 125 models (3 carry `@@map`: `infra/prisma/schema.prisma:2098`, `:3638`, `:3651`); the move to `snake_case` stays an idea, its size measured in the review sheet of the walk, outside the tree. Found by: the context diet, T3, the walk of `CODING_STANDARDS.md` (2026-11-25, row D09).
