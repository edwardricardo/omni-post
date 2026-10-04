/**
 * @file no-unowned-handle-unref.test.ts
 * @description RuleTester suite for `testing/no-unowned-handle-unref`. The rule exists because a
 *              test that unref'd every active handle (`unrefActiveHandles`) also unref'd the IPC
 *              channel of its vitest fork, which then exited under the pool with zero failing
 *              assertions. The invalid cases are process-wide enumeration, read as a member or
 *              destructured, and `unref()` on the process's own streams through every spelling
 *              the line-based guard this rule replaces was blind to: the optional chain and the
 *              optional call, `as any`, `<any>` and `!`, `globalThis`, and a call split across
 *              lines. The valid cases are what the rule must not mistake for them: writing to a
 *              process stream, reading `unref` without calling it, an object literal that merely
 *              has an enumerator's name as a key, and a local binding named `process`.
 * @layer infrastructure
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it } from "vitest";
import rule from "../src/rules/no-unowned-handle-unref.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const lines = (...source: string[]): string => source.join("\n");
const enumeration = (name: string, line = 1) => ({
  messageId: "enumeration",
  data: { name },
  line,
});
const processHandle = (receiver: string, line = 1) => ({
  messageId: "processHandle",
  data: { receiver },
  line,
});

ruleTester.run("no-unowned-handle-unref", rule, {
  valid: [
    'process.stdout.write("tap\\n");',
    'if (typeof process.stdout.unref === "function") log("unref available");',
    "installFake({ getActiveResourcesInfo: () => [] });",
    lines("const process = fork(script);", "process.stdout.unref();"),
    lines('const unref = "write";', "process.stdout[unref]();"),
    "globalThis.handle.unref();",
  ],
  invalid: [
    { code: "process._getActiveHandles();", errors: [enumeration("_getActiveHandles")] },
    { code: "process._getActiveRequests();", errors: [enumeration("_getActiveRequests")] },
    {
      code: "console.table(process.getActiveResourcesInfo());",
      errors: [enumeration("getActiveResourcesInfo")],
    },
    {
      code: "const handles = (process as any)._getActiveHandles?.() ?? [];",
      errors: [enumeration("_getActiveHandles")],
    },
    {
      code: "const { _getActiveHandles: list } = process as any;",
      errors: [enumeration("_getActiveHandles")],
    },
    {
      code: lines("process.stdout.unref();", "process.stdin.unref();", "process.stderr.unref();"),
      errors: [
        processHandle("process.stdout"),
        processHandle("process.stdin", 2),
        processHandle("process.stderr", 3),
      ],
    },
    {
      code: "(process as any).channel?.unref();",
      errors: [processHandle("(process as any).channel")],
    },
    { code: "process!.stdout.unref();", errors: [processHandle("process!.stdout")] },
    { code: "(process?.stdout).unref();", errors: [processHandle("process?.stdout")] },
    {
      code: "(process satisfies NodeJS.Process).stdout.unref();",
      errors: [processHandle("(process satisfies NodeJS.Process).stdout")],
    },
    { code: "process.channel?.unref?.();", errors: [processHandle("process.channel")] },
    { code: "(<any>process).channel.unref();", errors: [processHandle("(<any>process).channel")] },
    { code: 'process.stdout["unref"]();', errors: [processHandle("process.stdout")] },
    {
      code: lines("globalThis.process.stdout.unref();", "global.process.channel.unref();"),
      errors: [
        processHandle("globalThis.process.stdout"),
        processHandle("global.process.channel", 2),
      ],
    },
    { code: lines("process.stdout", "  .unref();"), errors: [processHandle("process.stdout")] },
  ],
});
