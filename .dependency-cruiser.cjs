/**
 * @file .dependency-cruiser.cjs
 * @description The architecture gate for the omni-post monorepo: the hexagonal layer rules,
 *   dependency cycles and orphan modules, checked over the resolved import graph of
 *   apps/api/src, apps/workers/src and every workspace package. `pnpm check:architecture` runs
 *   it, both in the local battery and in the dependency-cruiser job of audit.yml.
 *
 *   Layers, by resolved path (docs/architecture/ARCHITECTURE_CANON.md: Cockburn's ports and
 *   adapters, Martin's Dependency Rule, Seemann's Composition Root):
 *     domain          packages/core/domain/src      → domain, shared
 *     application     packages/core/<context>/src   → domain, ports, shared, its own context
 *                     (every core package but         and the shared kernels (the application
 *                     domain)                         package and embeddings)
 *     ports           packages/ports/src            → domain, shared, and the Result and
 *                                                     UseCaseError vocabulary of
 *                                                     packages/core/application/src/UseCase.ts
 *     shared          packages/shared               → shared
 *     infrastructure  apps/api/src, apps/workers/src, packages/adapters, packages/providers,
 *                     packages/api-common, packages/observability, packages/monitoring, infra
 *                                                   → anything
 *   Every inner layer (domain, application, ports, shared) may also use plain npm libraries and
 *   Node built-ins; FRAMEWORKS below names the npm packages none of them imports. The shared
 *   kernel is the exception to the built-ins (shared-root-no-node-core): the portals load it in
 *   the browser, so only its Node-only credentials crypto module, served from a subpath, imports
 *   one.
 *   A route module (`*Routes.ts`, `routes.ts`) and the handler modules beside it
 *   (`*Handlers.ts`) are infrastructure with limits of their own: they never reach the Prisma
 *   client, a repository, an adapter, a provider or the DI container, and they import the
 *   domain for its types only. The composition root (apps/api/src/index.ts and
 *   apps/api/src/infrastructure/container/) resolves what a route plugin needs and passes it
 *   in, and the use case builds the value objects from the primitives the route hands it.
 *   Tests are infrastructure, so the core and ports rules read `src/` alone.
 *
 *   The known-violations baseline, `.dependency-cruiser-known-violations.json`, lists every
 *   violation the code carried when these rules became hard. The check passes with exactly
 *   those, fails on a violation the file does not list, and fails on a listed entry that no
 *   longer occurs (`staleEntriesSeverity: "error"`): the file may only shrink, and it shrinks
 *   in the change that removes the violation. Regenerate it after fixing violations, never to
 *   add one, with `pnpm check:architecture:update-baseline`, which runs in shrink-only mode:
 *   it drops the entries that no longer occur and adds nothing. A new violation is a canon
 *   violation to fix, not an entry to list. An entry is matched on its rule, both ends AND the
 *   edge's shape (its dependency types, whether it resolved): rewriting a listed import without
 *   removing it (alias ↔ relative path, value ↔ `import type`) makes the entry stale and the
 *   edge new at once, and the check stays red until the violation is gone — fail-closed, by
 *   design. `apps/api/tests/unit/scripts/architectureBaseline.test.ts` pins all of this on a
 *   fixture the tool itself baselines.
 *
 *   A rule sees only the edges the resolver produced: an import that resolves into a build
 *   output (`dist/`), or does not resolve at all, is invisible to every layer rule. The
 *   `not-to-unresolvable` rule turns the second case into an error, so a resolution regression
 *   fails the gate instead of thinning the graph it reads. The resolution options below make
 *   each workspace-alias import reach the SOURCE file it names, whether or not the packages
 *   have been built:
 *     - the `development` export condition maps `@core/*`, `@ports/*` and the other workspace
 *       packages to their `src/`, the same condition dev, test and CI resolve with (ADR-0017);
 *     - `tsconfig.base.json` holds the path mappings (the root `tsconfig.json` has none);
 *     - an import spelled with the NodeNext `.js` extension that does not resolve is retried
 *       by dependency-cruiser itself as `.ts` / `.tsx` / `.d.ts`, which reaches the source;
 *     - `@shared/types` declares no `development` condition, so its alias to `src/` comes
 *       from `.dependency-cruiser-resolve.cjs` through `webpackConfig`: this schema accepts
 *       no `alias` under `enhancedResolveOptions`;
 *     - `tsPreCompilationDeps` keeps type-only imports and marks them `type-only`: the
 *       compiler erases them, but they are dependencies between layers all the same;
 *     - only a workspace package's own `dist/` is excluded, so an npm package that ships from a
 *       `dist/` directory (bullmq) stays visible to the framework rules.
 *   An import through a barrel (`@core/domain`) resolves to the barrel's `index.ts`, so a rule
 *   keyed on a module path below it sees the barrel, not the symbol imported through it.
 */

// The frameworks and infrastructure clients an inner-layer module never imports, matched
// where an npm package resolves: inside node_modules, directly or through pnpm's virtual store.
const FRAMEWORKS =
  "(^|/)node_modules/(prisma|@prisma/[^/]+|fastify|@fastify/[^/]+|ioredis|redis|@redis/[^/]+|bullmq|next)/";

// Every workspace package and infra package, by resolved path (a `to.path` is matched against
// the path an import resolves to, so it names source directories, not alias names). The
// inner-layer rules forbid all of it and list what their layer may import as `pathNot`, so a
// workspace package added tomorrow is outside every inner layer from its first commit instead
// of passing until someone remembers to name it.
const WORKSPACE_PACKAGES = "^(packages|infra)/";

// Route modules and the handler modules that hold their request logic. The CQRS bus
// handlers (`cqrs/handlers/*Handlers.ts`) are driving adapters too, under the same limits.
const ROUTE_MODULES = {
  path: "^apps/api/src/.*([Rr]outes|Handlers)\\.ts$",
  pathNot: "\\.test\\.ts$",
};

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
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "An import the resolver cannot map to a file on disk is not a missing edge, it is this gate reading less than the code: the specifier is wrong, or the resolution regressed (a new workspace package without a `development` condition, an alias whose file moved). An error here keeps the graph the layer rules see equal to the graph the code has.",
      from: {},
      to: {
        couldNotResolve: true,
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
      name: "shared-root-no-node-core",
      severity: "error",
      comment:
        "The portals load the shared kernel in browser code, where no Node built-in exists, so only the Node-only credentials crypto (served from its own subpath, @shared/types/channelCredentialsCrypto.js, never from the root barrel) and test files, which never ship, may import one.",
      from: {
        path: "^packages/shared/src/",
        pathNot: [
          "^packages/shared/src/channelCredentialsCrypto\\.ts$",
          "\\.(test|spec)\\.[cm]?[jt]sx?$",
        ],
      },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "core-no-apps",
      severity: "error",
      comment:
        "No core package imports an application: the core is delivery-agnostic and every executable consumes it, never the reverse. This rule also holds the domain and application layers away from apps/, so their layer rules below do not repeat it.",
      from: {
        path: "^packages/core/",
      },
      to: {
        path: "^apps/",
      },
    },
    {
      name: "core-domain-no-application",
      severity: "error",
      comment:
        "The domain depends on nothing outside itself: no application-layer core package, which is every core package but domain, the application package and embeddings included (dependencies point inward).",
      from: {
        path: "^packages/core/domain/src/",
      },
      to: {
        path: "^packages/core/(?!domain/)",
      },
    },
    {
      name: "core-domain-no-framework",
      severity: "error",
      comment:
        "The domain imports itself, the shared kernel and plain npm libraries only: no framework, no infrastructure package and no other workspace package. packages/ports is outside it too: those contracts belong to the application, which adapters implement, and the domain sits inside them. core-domain-no-application reports the rest of the core, and core-no-apps the apps.",
      from: {
        path: "^packages/core/domain/src/",
      },
      to: {
        path: [FRAMEWORKS, WORKSPACE_PACKAGES],
        pathNot: ["^packages/core/", "^packages/shared/"],
      },
    },
    {
      name: "core-application-no-infrastructure",
      severity: "error",
      comment:
        "Application-layer code (every core package but domain) imports the core, the ports and the shared kernel, never infrastructure: no framework, adapter, provider, HTTP helper, logger factory, monitoring package, infra package or other workspace package. What it needs from outside arrives through a port the composition root fills, logging included. no-cross-bounded-context governs the imports inside the core, and core-no-apps the apps.",
      from: {
        path: "^packages/core/(?!domain/)[^/]+/src/",
      },
      to: {
        path: [FRAMEWORKS, WORKSPACE_PACKAGES],
        pathNot: ["^packages/core/", "^packages/ports/", "^packages/shared/"],
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
    {
      name: "ports-depend-only-on-domain-and-shared",
      severity: "error",
      comment:
        "packages/ports holds technology-free contracts the application owns (Cockburn: the application defines its ports; Martin: the boundaries live in the use-case ring). A port uses domain types, the shared kernel and the Result and UseCaseError vocabulary of packages/core/application/src/UseCase.ts; nothing else of the core, no framework, no infrastructure package and no app.",
      from: {
        path: "^packages/ports/src/",
      },
      to: {
        path: [FRAMEWORKS, WORKSPACE_PACKAGES, "^apps/"],
        pathNot: [
          "^packages/ports/",
          "^packages/shared/",
          "^packages/core/domain/",
          "^packages/core/application/src/UseCase\\.ts$",
        ],
      },
    },
    {
      name: "shared-no-core",
      severity: "error",
      comment:
        "@shared is the primitives kernel (Result, base types, event-store/CQRS/saga contracts) — it must NEVER import from @core. Enforces the inward dependency direction (core → shared, never the reverse) so the @core → @shared → @core cycle is impossible by construction. Hard-zero: there are no violations today.",
      from: {
        path: "^packages/shared/",
      },
      to: {
        path: "^packages/core/",
      },
    },
    {
      name: "shared-no-apps",
      severity: "error",
      comment:
        "@shared (primitives kernel) must NEVER import from any app — it is consumed by apps and @core, never the reverse. Hard-zero.",
      from: {
        path: "^packages/shared/",
      },
      to: {
        path: "^apps/",
      },
    },
    {
      name: "shared-depends-only-on-shared",
      severity: "error",
      comment:
        "The primitives kernel imports itself and plain npm libraries only: no framework, no infra package and no other workspace package (shared-no-core and shared-no-apps report the core and the apps). It carries over the `shared → shared` policy of the retired eslint-plugin-boundaries configuration.",
      from: {
        path: "^packages/shared/",
      },
      to: {
        path: [FRAMEWORKS, WORKSPACE_PACKAGES],
        pathNot: ["^packages/shared/", "^packages/core/"],
      },
    },
    {
      name: "routes-no-prisma",
      severity: "error",
      comment:
        "A route module reaches the Prisma client: the generated client and its transaction seam (infra/prisma), the Prisma adapter package, or an @prisma npm package. The query belongs to a use case or a read repository in packages/core, which the route receives from the composition root.",
      from: ROUTE_MODULES,
      to: {
        path: [
          "^infra/prisma/",
          "^packages/adapters/db-prisma/",
          "(^|/)node_modules/(prisma|@prisma/[^/]+)/",
        ],
      },
    },
    {
      name: "routes-no-adapters-or-providers",
      severity: "error",
      comment:
        "A route module reaches an adapter or a provider package. Only the composition root imports and constructs concretes; a route receives a port. The Prisma adapter package is reported by routes-no-prisma.",
      from: ROUTE_MODULES,
      to: {
        path: ["^packages/adapters/", "^packages/providers/"],
        pathNot: "^packages/adapters/db-prisma/",
      },
    },
    {
      name: "routes-no-repositories",
      severity: "error",
      comment:
        "A route module reaches a repository: a port of packages/core/domain/src/repositories or an implementation in apps/api/src/infrastructure/repositories. A route calls a use case, and the use case calls the repository. ReadModelDtos.ts holds read-model DTO types and only shares the folder, so routes-domain-types-only governs it.",
      from: ROUTE_MODULES,
      to: {
        path: [
          "^packages/core/domain/src/repositories/",
          "^apps/api/src/infrastructure/repositories/",
        ],
        pathNot: "^packages/core/domain/src/repositories/ReadModelDtos\\.ts$",
      },
    },
    {
      name: "routes-no-container",
      severity: "error",
      comment:
        "A route module reaches the DI container (`TOKENS` or the container itself). A container referenced outside the Composition Root is a Service Locator (Seemann): it hides a module's dependencies until run time. The composition root resolves what a route plugin needs and passes it in as the plugin's options.",
      from: ROUTE_MODULES,
      to: {
        path: "^apps/api/src/infrastructure/container/",
      },
    },
    {
      name: "routes-domain-types-only",
      severity: "error",
      comment:
        "A route module imports a domain module for its runtime value. A route passes primitives and the use case builds the value objects (Cockburn's adapter parses its input and calls the application; Vernon's application services take primitives). Type references stay allowed — `import type`, marked `type-only`, and inline `import(...)` types, marked `type-import` — as do the two vocabularies routes use as data: the Permission enumeration (authorization) and the notification types (validation). Repository modules are reported by routes-no-repositories. The other route rules exempt no type reference, so their baseline entries carry `type-only` or `type-import`: a route imports `PrismaClient`, a repository or an adapter type to resolve that instance from the container. dependency-cruiser keeps one edge per specifier and kind (`import type` or not), the first it reads, and reads import statements before nested references: an inline type never hides an `import` statement, but one written before a dynamic `import()` of the same module records the edge as `type-import`, and this rule misses that value import.",
      from: ROUTE_MODULES,
      to: {
        path: "^packages/core/domain/",
        pathNot: [
          "^packages/core/domain/src/auth/Permission\\.ts$",
          "^packages/core/domain/src/value-objects/NotificationType\\.ts$",
          "^packages/core/domain/src/repositories/(?!ReadModelDtos\\.ts$)",
        ],
        dependencyTypesNot: ["type-only", "type-import"],
      },
    },
    {
      name: "workers-no-api",
      severity: "error",
      comment:
        "Each executable has its own composition root over the shared core: the workers never import the API application. Code both need lives in packages/.",
      from: {
        path: "^apps/workers/src/",
      },
      to: {
        path: "^apps/api/",
      },
    },
    {
      name: "api-no-workers",
      severity: "error",
      comment:
        "Each executable has its own composition root over the shared core: the API application never imports the workers. Code both need lives in packages/.",
      from: {
        path: "^apps/api/",
      },
      to: {
        path: "^apps/workers/",
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
        // The mutation-testing reports, the one report output `.gitignore` names. Never a
        // bare `reports/` segment: `apps/api/src/reports/` and the `packages/core/reports`
        // bounded context are source, and every rule must see them.
        "(^|/)reports/mutation/",
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
    // The known-violations ratchet (see the header): `--baseline` rewrites the file without
    // adding an entry, and a listed entry that no longer occurs fails the check.
    baseline: {
      mode: "shrink-only",
      staleEntriesSeverity: "error",
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
