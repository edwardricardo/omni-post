// ESLint v9 flat config for the monorepo
const js = require("@eslint/js");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");
const prettierConfig = require("eslint-config-prettier");

// Restricted import patterns for hexagonal boundary enforcement (apps/api/src/domain/).
// Domain layer must not import framework/infrastructure concretions.
const domainRestrictedPatterns = [
  "@prisma/client",
  "@prisma/client/*",
  "@infra/prisma",
  "@infra/prisma/*",
  "prisma",
  "fastify",
  "@fastify/*",
  "redis",
  "ioredis",
  "bullmq",
  "@adapters/*",
];

// Paths that benefit from type-aware linting (no-floating-promises).
// Scoped narrowly to keep memory usage bounded — full-monorepo projectService OOMs.
// Backend core layers only: fire-and-forget in workers/services/webhooks is intentional,
// documented as pending review in docs/audits/POST_REMEDIATION_BACKLOG.md.
const typeAwareBackendPaths = [
  "apps/api/src/domain/**/*.ts",
  "apps/api/src/application/**/*.ts",
  "apps/api/src/infrastructure/**/*.ts",
];

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
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
      "**/.stryker-tmp/**",
      // Prisma generated files
      "infra/prisma/src/**/*.js",
      "infra/prisma/generated/**",
      // ESLint config file itself (Node CJS globals not recognized)
      "eslint.config.cjs",
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
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
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
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
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
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  // Hexagonal domain boundary: block framework/infra imports
  {
    files: ["apps/api/src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: domainRestrictedPatterns }],
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
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
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
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
];
