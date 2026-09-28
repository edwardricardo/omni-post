// ESLint v9 flat config for the monorepo (TypeScript, with defineConfig).
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import boundariesPlugin from "eslint-plugin-boundaries";
import vitestPlugin from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

// Paths that benefit from type-aware linting (no-floating-promises).
// Scoped narrowly to keep memory usage bounded — full-monorepo projectService OOMs.
// Backend core layers only: fire-and-forget in workers/services/webhooks is intentional,
// documented as pending review in docs/audits/POST_REMEDIATION_BACKLOG.md.
const typeAwareBackendPaths = [
  "apps/api/src/domain/**/*.ts",
  "apps/api/src/application/**/*.ts",
  "apps/api/src/infrastructure/**/*.ts",
];

// Hexagonal classification for the boundaries plugin, on two independent axes.
// Element patterns name folders: a file takes the type of the first element
// descriptor whose folder contains it. File descriptors match whole file paths
// and give a file a category: every `*Routes.ts` file under `apps/api/src`
// carries the `routes` category, and one inside `infrastructure/` is also the
// `infrastructure` element. A file that matches no element and no file
// descriptor is not checked by `boundaries/dependencies`, and an import that
// resolves to such a file is skipped, so this classification decides what the
// layer policies can see. `boundaries/no-unknown-files` is not configured:
// nothing reports a file that the classification leaves out.
const hexagonalElements = [
  { type: "domain", pattern: "apps/api/src/domain/**" },
  { type: "application", pattern: "apps/api/src/application/**" },
  { type: "infrastructure", pattern: "apps/api/src/infrastructure/**" },
  { type: "ports", pattern: "packages/ports/**" },
  { type: "shared", pattern: "packages/shared/**" },
  { type: "adapters", pattern: "packages/adapters/**" },
];
const hexagonalFiles = [{ category: "routes", pattern: "apps/api/src/**/*Routes.ts" }];

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/coverage/**",
      "pnpm-lock.yaml",
      "**/*.d.ts",
      "designDocs/**/*",
      "**/*.{png,jpg,jpeg,gif,svg}",
      "**/storybook-static/**",
      // Prisma generated files
      "infra/prisma/src/**/*.js",
      "infra/prisma/generated/**",
      // `.gitignore` excludes `.config/` wholesale: it holds per-developer editor
      // and agent tooling, not repository code. ESLint keeps its own ignore list
      // and does not read `.gitignore`, so without this entry it lints files the
      // repository does not own — `pnpm lint` then reports errors nobody can fix
      // by changing this repository, and CI stays green only because a fresh
      // checkout happens to have nothing there. A gate that goes red on files
      // outside its own scope is a gate people learn to ignore.
      //
      // Entries here and in `.gitignore` are two lists that can drift. Wiring
      // `includeIgnoreFile` from `@eslint/compat` would collapse them into one,
      // and it is deliberately NOT done: that package is not a dependency of this
      // repository, and adopting `.gitignore` wholesale would also silence
      // `**/__snapshots__/` and `**/reports/mutation/` — a wider behaviour change
      // than the problem being solved.
      ".config/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node globals
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        // Browser/fetch globals
        fetch: "readonly",
        RequestInit: "readonly",
        URLSearchParams: "readonly",
        // React type global used in TSX types
        React: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // Disable base rule in TS files; use TS-aware rule instead
      "no-unused-vars": "off",
      // TypeScript performs undefined checks; avoid false positives with JSX/types
      "no-undef": "off",
      // Fix case declarations by requiring block statements
      "no-case-declarations": "error",
      // Fix redeclaration issues
      "no-redeclare": "error",
      // Fix unnecessary escapes
      "no-useless-escape": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Production code must use @observability/logger (Pino) for all log levels.
      // Overrides below allow console.* in CLI tooling, Storybook, seeds, and tests.
      "no-console": "error",
      // Default off; enforced as error only in backend core layers via override below.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // React/Next.js specific configuration
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        React: "readonly",
        JSX: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
    },
    rules: {
      // TypeScript rules
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-case-declarations": "error",
      "no-redeclare": "error",
      "no-useless-escape": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // React rules
      "react/jsx-uses-react": "off", // Not needed in React 17+
      "react/react-in-jsx-scope": "off", // Not needed in React 17+
      "react/prop-types": "off", // Using TypeScript
      "react/display-name": "warn",
      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // TSX components must use logger port; CLI tooling covered by override blocks below.
      "no-console": "error",
      // Default off; no core layer files are TSX.
      "@typescript-eslint/no-explicit-any": "off",
      // a11y static AST checks (jsx-a11y strict preset rules).
      ...jsxA11yPlugin.flatConfigs.strict.rules,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  // Declaration-style packages (ports) — allow unused names in type signatures
  {
    files: ["packages/ports/**/*.ts"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  // Type-aware linting for backend: floating promises enforcement.
  // projectService is scoped to this block only to bound memory usage.
  {
    files: typeAwareBackendPaths,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  // Hexagonal layer enforcement via eslint-plugin-boundaries. Each policy names
  // the importing element (or, for routes, the importing file category) and
  // what it may (`allow`) or may not (`disallow`) import; an import no policy
  // allows is denied by `default: "disallow"`. When several policies match one
  // import, the last matching one decides, which is why the framework denials
  // come after the allowances they narrow.
  //   domain         → domain, shared
  //   application    → domain, ports, shared, application
  //   infrastructure → application, domain, ports, adapters, shared, infrastructure
  //   routes (file)  → application, ports, shared
  //   ports          → shared, ports
  //   shared         → shared
  //   adapters       → ports, shared, adapters
  // No element may import a routes file: a routes file outside every element
  // is known only by its category, and no policy allows that category as a
  // target. A routes file inside `infrastructure/` matches both the
  // infrastructure and the routes policies; every routes allowance is also an
  // infrastructure allowance and neither has a denial, so it keeps the
  // infrastructure permissions, and other infrastructure files may import it.
  {
    files: [
      "apps/api/src/**/*.ts",
      "packages/ports/**/*.ts",
      "packages/shared/**/*.ts",
      "packages/adapters/**/*.ts",
    ],
    plugins: { boundaries: boundariesPlugin },
    settings: {
      // The plugin anchors every element and file pattern at this path, and
      // without it falls back to `process.cwd()`: a lint started from a
      // package directory then matches no pattern and allows every import
      // without a word. Anchored at the config's own directory, the verdict
      // no longer depends on where the lint was started.
      "boundaries/root-path": import.meta.dirname,
      "boundaries/elements": hexagonalElements,
      "boundaries/files": hexagonalFiles,
      "boundaries/include": [
        "apps/api/src/**/*.ts",
        "packages/ports/**/*.ts",
        "packages/shared/**/*.ts",
        "packages/adapters/**/*.ts",
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          policies: [
            // Element-to-element policies (cross-package within the monorepo).
            {
              from: { element: { type: "domain" } },
              allow: [
                { to: { element: { type: "domain" } } },
                { to: { element: { type: "shared" } } },
              ],
            },
            {
              from: { element: { type: "application" } },
              allow: [
                { to: { element: { type: "domain" } } },
                { to: { element: { type: "ports" } } },
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "application" } } },
              ],
            },
            {
              from: { element: { type: "infrastructure" } },
              allow: [
                { to: { element: { type: "application" } } },
                { to: { element: { type: "domain" } } },
                { to: { element: { type: "ports" } } },
                { to: { element: { type: "adapters" } } },
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "infrastructure" } } },
              ],
            },
            {
              from: { file: { categories: "routes" } },
              allow: [
                { to: { element: { type: "application" } } },
                { to: { element: { type: "ports" } } },
                { to: { element: { type: "shared" } } },
              ],
            },
            {
              from: { element: { type: "ports" } },
              allow: [
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "ports" } } },
              ],
            },
            {
              from: { element: { type: "shared" } },
              allow: [{ to: { element: { type: "shared" } } }],
            },
            {
              from: { element: { type: "adapters" } },
              allow: [
                { to: { element: { type: "ports" } } },
                { to: { element: { type: "shared" } } },
                { to: { element: { type: "adapters" } } },
              ],
            },
            // npm packages (origin `external`) and Node.js built-ins (origin
            // `core`) are allowed for every element; the framework and
            // infrastructure packages denied below narrow that for domain and
            // ports only. A module `source` is the package name without its
            // subpath, so `@prisma/client` also covers `@prisma/client/runtime`.
            {
              from: { element: { type: "domain" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "domain" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "application" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "application" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "infrastructure" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "infrastructure" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { file: { categories: "routes" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { file: { categories: "routes" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "ports" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "ports" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "shared" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "shared" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "adapters" } },
              allow: [{ to: { module: { origin: "external" } } }],
            },
            {
              from: { element: { type: "adapters" } },
              allow: [{ to: { module: { origin: "core" } } }],
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "fastify" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "@fastify/*" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "@prisma/client" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "@prisma/client/*" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "prisma" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "redis" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "ioredis" } } },
            },
            {
              from: { element: { type: "domain" } },
              disallow: { to: { module: { origin: "external", source: "bullmq" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "fastify" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "@fastify/*" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "@prisma/client" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "@prisma/client/*" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "prisma" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "redis" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "ioredis" } } },
            },
            {
              from: { element: { type: "ports" } },
              disallow: { to: { module: { origin: "external", source: "bullmq" } } },
            },
          ],
        },
      ],
    },
  },
  // Backend core layers: zero explicit any (per project coding standards)
  {
    files: [
      "apps/api/src/domain/**/*.ts",
      "apps/api/src/application/**/*.ts",
      "apps/api/src/infrastructure/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Logger implementation — legitimate console.* wrapper
  {
    files: ["packages/observability/browser-logger/src/console-adapter.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // CLI scripts, seeds, Storybook, and tooling — console.* is the intended output
  {
    files: [
      "**/scripts/**/*.ts",
      "**/scripts/**/*.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/stories/**/*.ts",
      "**/stories/**/*.tsx",
      "infra/prisma/seed.ts",
      "infra/prisma/seed-*.ts",
      "infra/prisma/src/**/*.ts",
      "performance/**/*.ts",
      "quality/**/*.ts",
      "security/**/*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  // Test files — allow console.* (debugging), any (mocks), and fire-and-forget promises
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/tests/**/*.ts",
      "**/tests/**/*.tsx",
    ],
    // The vitest plugin is registered so its rules are RESOLVABLE on these globs,
    // and deliberately enables none of them: this glob set also covers the node:test
    // suites, where a rule such as `vitest/no-import-node-test` would be wrong. Both
    // the rule selection and the narrower glob that scopes it to the files vitest
    // actually collects are a separate change.
    plugins: { vitest: vitestPlugin },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  // Disable stylistic rules that conflict with Prettier. Must be last to override all preceding.
  prettierConfig,
  // K6 performance test files
  {
    files: ["performance/k6/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // K6 globals
        __ENV: "readonly",
        __VU: "readonly",
        __ITER: "readonly",
        open: "readonly",
        console: "readonly",
        // Node.js process for environment variables (used in K6 configs)
        process: "readonly",
        // Web APIs available in K6
        URLSearchParams: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  // Node.js scripts (SDK generators, etc.)
  {
    files: ["docs/sdk/generators/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        // Node.js globals
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  // Browser-based API portal files
  {
    files: ["docs/api-portal/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        alert: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        // Swagger UI globals
        SwaggerUIBundle: "readonly",
        SwaggerUIStandalonePreset: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
  // Node.js package source files (.js) in packages/
  {
    files: ["packages/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Node.js ES module scripts (.mjs)
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);
