// ESLint v9 flat config for the monorepo (TypeScript, with defineConfig).
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import vitestPlugin from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import testingPlugin from "@packages/eslint-plugin-testing";

// Files a test runner collects, or loads as test code beside them.
const testFiles = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/tests/**/*.ts",
  "**/tests/**/*.tsx",
];

// run.ts, run-with-coverage.ts and setup/verifyServices.ts have no importer and no runner collects
// them. Testing Refoundation deletes them, and these three entries with them; the list may only
// shrink. The rules that read test code skip them through this one list.
const unrunTestFiles = [
  "apps/api/tests/run.ts",
  "apps/api/tests/run-with-coverage.ts",
  "apps/api/tests/setup/verifyServices.ts",
];

// Paths that benefit from type-aware linting (no-floating-promises).
// Scoped narrowly to keep memory usage bounded — full-monorepo projectService OOMs.
// Backend core layers only: fire-and-forget in workers/services/webhooks is intentional,
// documented as pending review in the post-remediation backlog, removed from the repository on
// 2026-05-10; its last version:
// https://github.com/edwardricardo/omni-post/blob/4730470a6c65ebed1b549fc31ed233a96f28e255/docs/audits/POST_REMEDIATION_BACKLOG.md
const typeAwareBackendPaths = [
  "apps/api/src/domain/**/*.ts",
  "apps/api/src/application/**/*.ts",
  "apps/api/src/infrastructure/**/*.ts",
];

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
  // The shared kernel runs in the portals' browser code, which has no Buffer. The architecture
  // gate (shared-root-no-node-core) sees imports only; this block covers the Node global, with
  // the same exceptions: the Node-only credentials crypto module and test files. It names .ts
  // and .tsx because `pnpm lint` reads no other TypeScript extension.
  {
    files: ["packages/shared/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/shared/src/channelCredentialsCrypto.ts",
      "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The portals load the shared kernel in the browser, which has no Buffer: encode with TextEncoder, or keep Node-only code in channelCredentialsCrypto.ts, served from its own subpath.",
        },
      ],
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
  // Test files allow any (mocks) and fire-and-forget promises. console.log and the other stdout
  // writers stay errors: a test reports through its assertions, and what it prints buries the
  // runner's own report. console.warn and console.error stay legal, because they write to stderr,
  // where testing/no-stdout-in-node-test sends a node:test diagnostic. The block comes after the
  // scripts block on purpose, so a test under a scripts/ directory is held too.
  {
    files: testFiles,
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  // The test runner's own command-line entry points print by design.
  {
    files: unrunTestFiles,
    rules: { "no-console": "off" },
  },
  // The files Vitest collects. The reach engine (`pnpm --filter @packages/test-contracts reach
  // --json`) is the authority on which files that is; these globs approximate it statically. They
  // leave out the node:test tiers, which the suffix table of CODING_STANDARDS.md names
  // `*.integration.test.*` and `*.live.test.*`, the node:test suites under security/tests/, which
  // carry no tier suffix and which no runner collects, and Playwright's e2e/ code. A file the
  // engine collects under neither runner belongs outside the block too. A vitest rule read over
  // another runner's suite would judge that runner's API by Vitest's.
  {
    files: testFiles,
    ignores: ["**/*.integration.test.*", "**/*.live.test.*", "security/tests/**", "**/e2e/**"],
    plugins: { vitest: vitestPlugin },
    rules: {
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expect*", "assert", "assert.*", "expectTypeOf"] },
      ],
      "vitest/no-conditional-expect": "error",
      "vitest/valid-expect": "error",
      "vitest/no-standalone-expect": "error",
      "vitest/no-identical-title": "error",
      "vitest/no-commented-out-tests": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
    },
  },
  // A test block must be able to fail. The classifier of @packages/eslint-plugin-testing names
  // three classes of block that cannot, in vitest and node:test alike: no assertion runs in it,
  // its every assertion is true by construction, or its every assertion only checks that a value
  // exists. The blocks the tree held when these rules landed are listed in
  // eslint-suppressions.json, which may only shrink: the pull request that deletes one prunes its
  // entry (`eslint . --prune-suppressions`); an entry left behind fails lint while its file is still
  // linted, and a deleted file's entries stay unreported until the prune runs.
  {
    files: testFiles,
    plugins: { testing: testingPlugin },
    rules: {
      "testing/no-empty-test": "error",
      "testing/no-existence-only-test": "error",
      "testing/no-tautological-assertion": "error",
    },
  },
  // Test code may unref only the handles it creates: a vitest fork also holds the IPC channel to
  // the pool, and a fork whose channel was unref'd exits with zero failing assertions. The glob
  // reaches past the test files because the defect this rule holds lived in a helper module.
  {
    files: [...testFiles, "**/__tests__/**", "**/test-utils/**", "packages/vitest-shared/src/**"],
    plugins: { testing: testingPlugin },
    rules: { "testing/no-unowned-handle-unref": "error" },
  },
  // Code that runs in a node:test child process writes nothing to stdout: stdout is the runner's
  // message channel, and text written right after a frame is read as the next frame's length,
  // which fails a file whose tests passed whenever the text's third byte is non-ASCII, a property
  // of the text at run time. Everything under apps/api/tests outside unit/ and eval/ is
  // node:test's: the integration and live tiers apps/api/scripts/run-tests.sh collects, and the
  // helpers they import. unit/ and eval/ are Vitest's.
  {
    files: ["apps/api/tests/**/*.ts"],
    ignores: ["apps/api/tests/unit/**", "apps/api/tests/eval/**", ...unrunTestFiles],
    plugins: { testing: testingPlugin },
    rules: { "testing/no-stdout-in-node-test": "error" },
  },
  // A test waits on the observable result of the work it started, never on a fixed time: a fixed
  // wait falls short on a loaded runner and spends its whole delay on an idle one. A wait no
  // result can replace carries a `fixed-wait: <kind> — <why>` comment on the line above. The
  // Playwright specs under e2e/ stay out until a required check runs them: no run could verify a
  // fix there.
  {
    files: [...testFiles, "**/__tests__/**"],
    ignores: ["**/e2e/**", ...unrunTestFiles],
    plugins: { testing: testingPlugin },
    rules: { "testing/no-fixed-time-wait": "error" },
  },
  // A unit test starts no process: the child's start-up cost lands inside the runner's time budget
  // and its result depends on what the machine has installed. The block reads the files Vitest
  // collects, so the other tiers' suffixes, Playwright's e2e/ and node:test's part of
  // apps/api/tests stay out. Three places may spawn: tests/unit/scripts/, where a test of a script
  // that runs git, node or pnpm lives; the reach engine's suites, whose collectors spawn by
  // design; and the runner's behaviour suite, which runs the runner itself.
  {
    files: [...testFiles, "**/__tests__/**"],
    ignores: [
      "**/*.integration.test.*",
      "**/*.live.test.*",
      "**/*.spec.*",
      "**/e2e/**",
      "apps/api/tests/**",
      "!apps/api/tests/unit/**",
      "!apps/api/tests/eval/**",
      "apps/api/tests/unit/scripts/**",
      "packages/test-contracts/tests/**",
      "apps/api/tests/unit/saga/runTestsGate.behavior.test.ts",
    ],
    plugins: { testing: testingPlugin },
    rules: { "testing/no-child-process-in-unit": "error" },
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
