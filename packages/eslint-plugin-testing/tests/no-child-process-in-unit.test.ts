/**
 * @file no-child-process-in-unit.test.ts
 * @description RuleTester suite for `testing/no-child-process-in-unit`. A unit test that starts a
 *              real process pays the process's start-up cost inside the runner's time budget and
 *              depends on what the machine has installed: DEF-84 was a unit case that ran `mkdir`,
 *              `find` and `npm ls` for real and took 7.4 s in CI against Vitest's 5 s default.
 *              The invalid cases are every way a file can load `child_process` as a value, from
 *              `node:child_process` or `child_process`: a named, default, namespace or bare import
 *              (a named import beside an inline type one included), `require` (bare or made by
 *              `createRequire`), a dynamic `import()`, a static template literal as the
 *              specifier, a re-export, and TypeScript's `import x = require()`. The valid cases
 *              are what the rule must not mistake for them: a type-only import or re-export, an
 *              import whose every specifier is an inline type, `typeof import()` in a type, the
 *              module name passed to `vi.mock` or to any function that is not `require`, a string
 *              that names the module, a specifier built from an expression, another module, and
 *              a local module named `child_process`.
 * @layer infrastructure
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it } from "vitest";
import rule from "../src/rules/no-child-process-in-unit.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const lines = (...source: string[]): string => source.join("\n");
const childProcess = (source: string, line = 1) => ({
  messageId: "childProcess",
  data: { source },
  line,
});

const NODE = "node:child_process";
const BARE = "child_process";

ruleTester.run("no-child-process-in-unit", rule, {
  valid: [
    'import type { ChildProcess } from "node:child_process";',
    'import type { ChildProcess } from "child_process";',
    'import { type ChildProcess } from "node:child_process";',
    'import { type ChildProcess, type SpawnOptions } from "child_process";',
    'export type { ChildProcess } from "node:child_process";',
    'import type cp = require("node:child_process");',
    'type ChildProcessModule = typeof import("node:child_process");',
    'vi.mock("node:child_process", () => ({ execFile: vi.fn() }));',
    'const resolved = resolveModule("child_process");',
    'const name = "node:child_process";',
    'import { spawn } from "node:cluster";',
    'import { spawn } from "./child_process";',
    'const fs = require("node:fs");',
    'await import("./child_process.js");',
    "const cp = await import(`node:${name}`);",
    "const cp = await import(`node:child_process${suffix}`);",
  ],
  invalid: [
    {
      code: 'import { spawnSync } from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import { exec } from "child_process";',
      errors: [childProcess(BARE)],
    },
    {
      code: 'import { spawn as run } from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import childProcess from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import * as cp from "child_process";',
      errors: [childProcess(BARE)],
    },
    {
      code: 'import "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import { type SpawnSyncReturns, spawnSync } from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import cp, { spawn } from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'const { execFileSync } = require("node:child_process");',
      errors: [childProcess(NODE)],
    },
    {
      code: 'const cp = require("child_process");',
      errors: [childProcess(BARE)],
    },
    {
      code: lines(
        "const require = createRequire(import.meta.url);",
        'const cp = require("node:child_process");'
      ),
      errors: [childProcess(NODE, 2)],
    },
    {
      code: "const cp = require(`child_process`);",
      errors: [childProcess(BARE)],
    },
    {
      code: 'const { spawn } = await import("node:child_process");',
      errors: [childProcess(NODE)],
    },
    {
      code: 'await import("child_process");',
      errors: [childProcess(BARE)],
    },
    {
      code: "const cp = await import(`node:child_process`);",
      errors: [childProcess(NODE)],
    },
    {
      code: 'export { spawn } from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'export * from "child_process";',
      errors: [childProcess(BARE)],
    },
    {
      code: 'export * as cp from "node:child_process";',
      errors: [childProcess(NODE)],
    },
    {
      code: 'import cp = require("node:child_process");',
      errors: [childProcess(NODE)],
    },
    {
      code: lines(
        'import type { ChildProcess } from "node:child_process";',
        'import { spawn } from "node:child_process";',
        'const { exec } = require("child_process");'
      ),
      errors: [childProcess(NODE, 2), childProcess(BARE, 3)],
    },
  ],
});
