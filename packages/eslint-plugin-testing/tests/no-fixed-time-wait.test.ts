/**
 * @file no-fixed-time-wait.test.ts
 * @description RuleTester suite for `testing/no-fixed-time-wait`. A fixed wait assumes the work it
 *              waits for is done when the time is up: DEF-89 was twenty `settle()` calls in
 *              `sagaStepOutcome.test.ts`, each a 20 ms timer that falls short on a loaded runner.
 *              The invalid cases are the three shapes the rule reports: a `new Promise` its
 *              executor's resolver settles from `setTimeout` (bare, imported from `node:timers`,
 *              or a member of `globalThis`, `global` or `window`; passed directly, through one
 *              alias, or called by a wrapper function; from an arrow or a block body; with any
 *              delay or none; awaited or not; reported once, where the promise is built), a value
 *              import of a waiter from `timers/promises` (named, default, namespace, `require`,
 *              `import()`), and Playwright's `waitForTimeout`; plus every way a `fixed-wait:`
 *              marker can be wrong (an unknown kind, no colon, no reason, not directly above the
 *              wait, a block comment, above the function that holds the wait instead of its
 *              statement, above no wait at all). The valid cases are what the rule must not
 *              mistake for them: a bare yield (`setImmediate`, `process.nextTick`), a deadline
 *              that rejects, a timer outside a promise or in a plain function, a poll whose own
 *              probe resolves, a promise an event resolves, a local binding named `setTimeout` or
 *              `window`, a type import, a non-waiter of `timers/promises`; and a well-formed
 *              marker for each kind, above a statement, an object property, a call argument, an
 *              export, an import and a class method's statement.
 * @layer infrastructure
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it } from "vitest";
import rule from "../src/rules/no-fixed-time-wait.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const lines = (...source: string[]): string => source.join("\n");
const promiseTimeout = (line = 1, timer = "setTimeout") => ({
  messageId: "promiseTimeout",
  data: { timer },
  line,
});
const timersPromises = (name: string, line = 1) => ({
  messageId: "timersPromises",
  data: { name },
  line,
});
const waitForTimeout = (line = 1) => ({ messageId: "waitForTimeout", line });
const markerKind = (marker: string, line = 1) => ({
  messageId: "markerKind",
  data: { marker },
  line,
});
const markerReason = (marker: string, line = 1) => ({
  messageId: "markerReason",
  data: { marker },
  line,
});
const markerUnused = (marker: string, line = 1) => ({
  messageId: "markerUnused",
  data: { marker },
  line,
});

const wait = "await new Promise((resolve) => setTimeout(resolve, 5));";
const interleaving = "// fixed-wait: interleaving — the second writer commits first";

ruleTester.run("no-fixed-time-wait", rule, {
  valid: [
    "await new Promise((resolve) => setImmediate(resolve));",
    "await new Promise((resolve) => process.nextTick(resolve));",
    'await new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late")), 1000));',
    "await new Promise((resolve, reject) => setTimeout(reject, 1000));",
    "const timer = setTimeout(() => controller.abort(), 50);",
    "function later(resolve: () => void): void { setTimeout(resolve, 10); }",
    lines(
      "await new Promise<void>((resolve) => {",
      "  const tick = (): void => void (ready() ? resolve() : setTimeout(tick, 10));",
      "  tick();",
      "});"
    ),
    lines(
      "await new Promise<void>((resolve) => {",
      '  emitter.once("done", () => resolve());',
      '  setTimeout(() => emitter.emit("tick"), 5);',
      "});"
    ),
    'await new Promise<void>((r) => setTimeout(() => bus.once("done", () => r()), 5));',
    lines(
      "const setTimeout = (run: () => void): void => run();",
      "await new Promise<void>((resolve) => setTimeout(resolve, 10));"
    ),
    lines(
      "const window = { setTimeout: (run: () => void): void => run() };",
      "await new Promise<void>((resolve) => window.setTimeout(resolve, 10));"
    ),
    "await new Deferred((resolve) => setTimeout(resolve, 5));",
    "await vi.waitFor(() => expect(spy).toHaveBeenCalled());",
    'import type { setTimeout } from "node:timers/promises";',
    lines(
      'import { type setTimeout as Sleep, setImmediate } from "node:timers/promises";',
      "await setImmediate();"
    ),
    'import { setTimeout } from "node:timers";',
    'const { readFile } = await import("node:fs/promises");',
    lines('const timers = require("node:timers/promises");', "await timers.setImmediate();"),
    lines('await page.waitForSelector("#ready");', "await waitForTimeout(5);"),
    lines(
      "// fixed-wait: latency-injection — the double answers after 50 ms, the latency under test",
      "await new Promise((resolve) => setTimeout(resolve, 50));"
    ),
    lines(
      "// fixed-wait: clock-advance — fake timers hold it until vi.advanceTimersByTime fires it",
      "const pending = new Promise((resolve) => setTimeout(resolve, 100));",
      "vi.advanceTimersByTime(100);"
    ),
    lines(
      "const repo = {",
      `  ${interleaving}`,
      "  save: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(post), 20))),",
      "  find: vi.fn(),",
      "};"
    ),
    lines(
      "mock.mockImplementation(",
      "  // fixed-wait: poll-step — one step of a poll bounded by its caller",
      "  () => new Promise((resolve) => setTimeout(resolve, 10))",
      ");"
    ),
    lines(
      "// fixed-wait: ttl-expiry — the entry outlives a 1 s TTL only in real time,",
      "// because the store reads a clock fake timers do not reach",
      "export const expire = (): Promise<void> =>",
      "  new Promise((resolve) => setTimeout(resolve, 1100));"
    ),
    lines(
      "// fixed-wait: latency-injection — a slow double",
      "const repo = { find: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 5))) };"
    ),
    lines(
      "// fixed-wait: poll-step — the fixed backoff of the retry loop under test",
      'import { setTimeout as backoff } from "node:timers/promises";'
    ),
    lines(
      "class DashboardPage {",
      "  async settle(): Promise<void> {",
      "    // fixed-wait: interleaving — the chart animation has no observable end",
      "    await this.page.waitForTimeout(300);",
      "  }",
      "}"
    ),
  ],
  invalid: [
    { code: wait, errors: [promiseTimeout()] },
    { code: "await new Promise<void>((r) => setTimeout(r, 300));", errors: [promiseTimeout()] },
    { code: "await new Promise((resolve) => setTimeout(resolve));", errors: [promiseTimeout()] },
    { code: "await new Promise((resolve) => setTimeout(resolve, 0));", errors: [promiseTimeout()] },
    {
      code: "const pending = new Promise((resolve) => setTimeout(resolve, 10));",
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "async function sleep(ms: number): Promise<void> {",
        "  return new Promise((resolve) => setTimeout(resolve, ms));",
        "}",
        "await sleep(10);",
        "await sleep(20);"
      ),
      errors: [promiseTimeout(2)],
    },
    {
      code: "const settle = () => new Promise((resolve) => setTimeout(resolve, 0));",
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "async function settle(): Promise<void> {",
        "  await new Promise((resolve) => setImmediate(resolve));",
        "  await new Promise((resolve) => setTimeout(resolve, 20));",
        "}"
      ),
      errors: [promiseTimeout(3)],
    },
    {
      code: "await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));",
      errors: [promiseTimeout()],
    },
    {
      code: "mock.mockImplementation(() => new Promise((r) => setTimeout(() => r(post), 50)));",
      errors: [promiseTimeout()],
    },
    {
      code: "await new Promise((resolve) => setTimeout(function () { resolve(undefined); }, 20));",
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise<void>((resolve) =>",
        "  setTimeout(() => {",
        "    clearInterval(poll);",
        "    resolve();",
        "  }, 20)",
        ");"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise((resolve) => {",
        "  const t = setTimeout(resolve, 50);",
        "  t.unref();",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines("await new Promise(function (resolve) {", "  setTimeout(resolve, 25);", "});"),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise<void>((resolve) => {",
        "  if (fast) resolve();",
        "  else setTimeout(resolve, 25);",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise((resolve) => globalThis.setTimeout(resolve, 5));",
        "await new Promise((resolve) => global.setTimeout(resolve, 5));",
        "await new Promise((resolve) => window.setTimeout(resolve, 5));"
      ),
      errors: [
        promiseTimeout(1, "globalThis.setTimeout"),
        promiseTimeout(2, "global.setTimeout"),
        promiseTimeout(3, "window.setTimeout"),
      ],
    },
    {
      code: 'await new Promise((r) => (globalThis as any)["setTimeout"](r as () => void, 5));',
      errors: [promiseTimeout(1, '(globalThis as any)["setTimeout"]')],
    },
    {
      code: lines('import { setTimeout } from "node:timers";', wait),
      errors: [promiseTimeout(2)],
    },
    {
      code: lines(
        "await new Promise<void>((resolve) => {",
        "  const done = resolve;",
        "  setTimeout(done, 10);",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise<void>((resolve) => {",
        "  const done = resolve;",
        "  setTimeout(() => done(), 10);",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise<void>((resolve) => {",
        "  let done: () => void = noop;",
        "  done = resolve;",
        "  setTimeout(done, 10);",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise((resolve) => {",
        "  setTimeout(resolve, 5);",
        "  setTimeout(resolve, 10);",
        "});"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: 'await new Promise((resolve) => emitter.once("ready", () => setTimeout(resolve, 10)));',
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "await new Promise((resolve) =>",
        "  setTimeout(resolve, COVERAGE_MODE ? 200 : 100)",
        ");"
      ),
      errors: [promiseTimeout()],
    },
    {
      code: lines(
        "class SlowRepository {",
        "  async find(): Promise<Post> {",
        "    await new Promise((resolve) => setTimeout(resolve, this.latency));",
        "    return post;",
        "  }",
        "}"
      ),
      errors: [promiseTimeout(3)],
    },
    {
      code: 'import { setTimeout } from "node:timers/promises";',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: 'import { setTimeout as sleep, setImmediate } from "timers/promises";',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: 'import { setInterval, scheduler } from "node:timers/promises";',
      errors: [timersPromises("setInterval"), timersPromises("scheduler")],
    },
    {
      code: lines(
        'import * as timers from "node:timers/promises";',
        "await timers.setTimeout(10);"
      ),
      errors: [timersPromises("setTimeout", 2)],
    },
    {
      code: lines('import timers from "node:timers/promises";', "await timers.scheduler.wait(10);"),
      errors: [timersPromises("scheduler", 2)],
    },
    {
      code: 'const { setTimeout: sleep } = require("node:timers/promises");',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: 'await require("timers/promises").setTimeout(5);',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: lines('const timers = require("node:timers/promises");', "await timers.setTimeout(5);"),
      errors: [timersPromises("setTimeout", 2)],
    },
    {
      code: 'const { setTimeout } = await import("node:timers/promises");',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: 'await (await import("node:timers/promises")).setTimeout(5);',
      errors: [timersPromises("setTimeout")],
    },
    {
      code: lines(
        'const timers = await import("timers/promises");',
        "for await (const _ of timers.setInterval(5)) break;"
      ),
      errors: [timersPromises("setInterval", 2)],
    },
    { code: "await page.waitForTimeout(500);", errors: [waitForTimeout()] },
    {
      code: lines("await this.page?.waitForTimeout(100);", 'await frame["waitForTimeout"](0);'),
      errors: [waitForTimeout(1), waitForTimeout(2)],
    },
    {
      code: lines("// fixed-wait: sleep — the job needs time", wait),
      errors: [markerKind("// fixed-wait: sleep — the job needs time")],
    },
    {
      code: lines("// fixed-wait interleaving — the second writer commits first", wait),
      errors: [markerKind("// fixed-wait interleaving — the second writer commits first")],
    },
    {
      code: lines("// fixed-wait: interleaving - the second writer commits first", wait),
      errors: [markerKind("// fixed-wait: interleaving - the second writer commits first")],
    },
    {
      code: lines("// fixed-wait: interleaving", wait),
      errors: [markerReason("// fixed-wait: interleaving")],
    },
    {
      code: lines("// fixed-wait: interleaving —", wait),
      errors: [markerReason("// fixed-wait: interleaving —")],
    },
    {
      code: lines(interleaving, "", wait),
      errors: [markerUnused(interleaving), promiseTimeout(3)],
    },
    {
      code: lines(`tick(); ${interleaving}`, wait),
      errors: [markerUnused(interleaving), promiseTimeout(2)],
    },
    {
      code: lines("/* fixed-wait: interleaving — the second writer commits first */", wait),
      errors: [promiseTimeout(2)],
    },
    {
      code: lines("// fixed-wait: interleaving — the scheduler drains", "await flushPromises();"),
      errors: [markerUnused("// fixed-wait: interleaving — the scheduler drains")],
    },
    { code: lines(interleaving, wait, wait), errors: [promiseTimeout(3)] },
    {
      code: lines(interleaving, "async function settle(): Promise<void> {", `  ${wait}`, "}"),
      errors: [markerUnused(interleaving), promiseTimeout(3)],
    },
    {
      code: lines(
        "// fixed-wait: sleep — both doubles answer late",
        "await Promise.all([",
        "  new Promise((resolve) => setTimeout(resolve, 5)),",
        "  new Promise((resolve) => setTimeout(resolve, 10)),",
        "]);"
      ),
      errors: [markerKind("// fixed-wait: sleep — both doubles answer late")],
    },
    {
      code: lines(
        "// fixed-wait: retry — the client backs off",
        'import { setTimeout as backoff } from "node:timers/promises";'
      ),
      errors: [markerKind("// fixed-wait: retry — the client backs off")],
    },
  ],
});
