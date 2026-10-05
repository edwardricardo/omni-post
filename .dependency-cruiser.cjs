/**
 * @file .dependency-cruiser.cjs
 * @description The architecture gate for the omni-post monorepo: graph-level rules (layer
 *   direction, dependency cycles, orphan modules) over the resolved import graph of
 *   apps/api/src and every workspace package. `pnpm check:architecture` runs it, both in the
 *   local battery and in the dependency-cruiser job of audit.yml.
 *
 *   Layers (per CLAUDE.md):
 *     domain        ← imports nothing external (no Prisma/Fastify/Redis/BullMQ)
 *     application   ← imports domain only
 *     infrastructure← imports application + domain + external libs
 *     routes/index  ← composition root, imports use cases only
 *
 *   A rule sees only the edges the resolver produced: an import that resolves into a build
 *   output (`dist/`), or does not resolve at all, is invisible to every rule. The resolution
 *   options below therefore make each workspace-alias import reach the SOURCE file it names,
 *   whether or not the packages have been built:
 *     - the `development` export condition maps `@core/*`, `@ports/*` and the other workspace
 *       packages to their `src/`, the same condition dev, test and CI resolve with (ADR-0017);
 *     - `tsconfig.base.json` holds the path mappings (the root `tsconfig.json` has none);
 *     - an import spelled with the NodeNext `.js` extension that does not resolve is retried
 *       by dependency-cruiser itself as `.ts` / `.tsx` / `.d.ts`, which reaches the source;
 *     - `@shared/types` declares no `development` condition, so its alias to `src/` comes
 *       from `.dependency-cruiser-resolve.cjs` through `webpackConfig`: this schema accepts
 *       no `alias` under `enhancedResolveOptions`;
 *     - `tsPreCompilationDeps` keeps type-only imports: the compiler erases them, but they are
 *       dependencies between layers all the same;
 *     - only a workspace package's own `dist/` is excluded, so an npm package that ships from a
 *       `dist/` directory (bullmq) stays visible to the framework rules.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A module imports another that ultimately depends on it. Cycles are a code smell at any layer.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules nobody imports are usually dead code or candidates for cleanup.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$", // dot files
          "\\.d\\.ts$", // TS declaration
          "(^|/)tsconfig\\.json$",
          "(^|/)package\\.json$",
          "/(types|env)\\.ts$",
          "/index\\.ts$", // barrel exports often look orphan
          "/migrations/", // Prisma migrations have no importers
          "\\.test\\.(ts|tsx)$", // tests are entry points
          "\\.stories\\.(ts|tsx)$", // Storybook stories are entry points
        ],
      },
      to: {},
    },
    {
      name: "domain-no-framework",
      severity: "error",
      comment:
        "Domain layer must not depend on Prisma/Fastify/Redis/BullMQ/Next/etc. (CLAUDE.md hexagonal rule).",
      from: {
        path: "apps/api/src/domain/",
      },
      to: {
        path: "(prisma|fastify|ioredis|bullmq|next|@fastify|@prisma|@infra|@adapters)",
      },
    },
    {
      name: "application-no-infrastructure",
      severity: "error",
      comment: "Application layer must not import infrastructure adapters directly (use ports).",
      from: {
        path: "apps/api/src/application/",
      },
      to: {
        path: "apps/api/src/infrastructure/",
      },
    },
    {
      name: "domain-no-application",
      severity: "error",
      comment: "Domain layer must not depend on Application layer.",
      from: {
        path: "apps/api/src/domain/",
      },
      to: {
        path: "apps/api/src/application/",
      },
    },
    {
      name: "domain-no-infrastructure",
      severity: "error",
      comment: "Domain layer must not depend on Infrastructure layer.",
      from: {
        path: "apps/api/src/domain/",
      },
      to: {
        path: "apps/api/src/infrastructure/",
      },
    },
    {
      name: "core-no-apps",
      severity: "error",
      comment:
        "@core (shared application core) must not import from any app — it is delivery-agnostic and consumed by apps, never the reverse. Hard CI gate (core migration P8c).",
      from: {
        path: "packages/core/(domain|application)/",
      },
      to: {
        path: "apps/",
      },
    },
    {
      name: "core-domain-no-application",
      severity: "error",
      comment:
        "@core/domain must not depend on @core/application (dependencies point inward). Hard CI gate (core migration P8c).",
      from: {
        path: "packages/core/domain/",
      },
      to: {
        path: "packages/core/application/",
      },
    },
    {
      name: "core-domain-no-framework",
      severity: "error",
      comment:
        "@core/domain must not depend on frameworks/infra (Prisma/Fastify/Redis/BullMQ/adapters). Hard CI gate (core migration P8c).",
      from: {
        path: "packages/core/domain/",
      },
      to: {
        // `to.path` is matched against the RESOLVED path. A workspace adapter or the
        // infra package resolves to `packages/adapters/<name>/src/…` or `infra/<name>/src/…`,
        // which the alias names never match; the alias names still catch an import that
        // fails to resolve.
        path: [
          "(prisma|fastify|ioredis|bullmq|next|@fastify|@prisma|@infra|@adapters)",
          "^packages/adapters/",
          "^infra/",
        ],
      },
    },
    {
      name: "core-application-no-infrastructure",
      severity: "error",
      comment:
        "@core/application may use @core/domain + @ports + @shared, but must not import infrastructure adapters or frameworks directly (use ports). @packages/api-common is @layer infrastructure (shared HTTP helpers) — its pure utilities are relocated to @shared so the core consumes them there. Hard CI gate (core migration P8c).",
      from: {
        path: "packages/core/application/",
      },
      to: {
        // Matched against the RESOLVED path, as in core-domain-no-framework above.
        path: [
          "(prisma|fastify|ioredis|bullmq|next|@fastify|@prisma|@infra|@adapters|@packages/api-common)",
          "^packages/adapters/",
          "^packages/api-common/",
          "^infra/",
        ],
      },
    },
    {
      name: "shared-no-core",
      severity: "error",
      comment:
        "@shared is the primitives kernel (Result, base types, event-store/CQRS/saga contracts) — it must NEVER import from @core. Enforces the inward dependency direction (core → shared, never the reverse) so the @core → @shared → @core cycle is impossible by construction. Hard-zero: there are no violations today.",
      from: {
        path: "packages/shared/",
      },
      to: {
        path: "packages/core/",
      },
    },
    {
      name: "shared-no-apps",
      severity: "error",
      comment:
        "@shared (primitives kernel) must NEVER import from any app — it is consumed by apps and @core, never the reverse. Hard-zero.",
      from: {
        path: "packages/shared/",
      },
      to: {
        path: "apps/",
      },
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment: "Avoid Node.js core modules deprecated in current LTS.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: ["^(punycode|domain|constants|sys|_linklist|_stream_wrap)$"],
      },
    },
    {
      name: "no-cross-bounded-context",
      severity: "error",
      comment:
        "Each bounded context lives in packages/core/<context>/ and must NOT import from sibling contexts. The only allowed cross-context dependencies are: @core/domain (shared kernel), @core/embeddings (shared kernel for ML), @core/application (UseCase base), @ports/core (port interfaces), and @shared/types. Sibling-context use cases compose via ports + adapters wired in the composition root (apps/api or apps/workers).",
      from: {
        path: "^packages/core/(?!domain|embeddings|application)([^/]+)/src/",
      },
      to: {
        path: "^packages/core/(?!domain|embeddings|application)([^/]+)/src/",
        pathNot: "^packages/core/$1/src/",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        // A workspace package's own build output, at one or two directory levels
        // (`packages/shared/dist/`, `packages/core/posts/dist/`). Never a bare `dist/`
        // segment: that would also drop npm packages resolved into
        // `node_modules/.pnpm/<pkg>/dist/`, which the framework rules must see.
        "^(apps|packages|infra)/[^/]+/dist/",
        "^packages/[^/]+/[^/]+/dist/",
        "(^|/)\\.next/",
        "(^|/)reports/",
        "(^|/)coverage/",
        // Generated code (e.g. the Prisma client) is not subject to our
        // architecture rules and legitimately contains internal cycles.
        "(^|/)generated/",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    webpackConfig: {
      fileName: ".dependency-cruiser-resolve.cjs",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["development", "import", "require", "node", "default", "types"],
      mainFields: ["main", "types"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "^(packages|apps)/[^/]+/[^/]+/",
      },
      archi: {
        collapsePattern: "^(packages|apps|infra)/[^/]+",
      },
    },
  },
};
