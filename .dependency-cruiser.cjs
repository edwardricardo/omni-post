/**
 * @file .dependency-cruiser.cjs
 * @description Hexagonal architecture layer enforcement for the omni-post
 *   monorepo. Complements ESLint flat config + 14 fitness greps with
 *   graph-level rules (arrow direction, cycles, orphan modules).
 *
 *   Layers (per CLAUDE.md):
 *     domain        ← imports nothing external (no Prisma/Fastify/Redis/BullMQ)
 *     application   ← imports domain only
 *     infrastructure← imports application + domain + external libs
 *     routes/index  ← composition root, imports use cases only
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
      name: "no-deprecated-core",
      severity: "warn",
      comment: "Avoid Node.js core modules deprecated in current LTS.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: ["^(punycode|domain|constants|sys|_linklist|_stream_wrap)$"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: [
        "(^|/)dist/",
        "(^|/)\\.next/",
        "(^|/)\\.stryker-tmp/",
        "(^|/)reports/",
        "(^|/)coverage/",
      ],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
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
