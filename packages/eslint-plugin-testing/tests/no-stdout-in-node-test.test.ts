/**
 * @file no-stdout-in-node-test.test.ts
 * @description RuleTester suite for `testing/no-stdout-in-node-test`. The rule exists because a
 *              node:test child process shares its stdout with the runner's message channel: on Node
 *              24.15.0 text written there right after a frame is read as the next frame's length,
 *              and a file whose tests passed is reported failed (DEF-83). The invalid cases are every
 *              console member that writes to stdout and `process.stdout.write`, with a plain, a
 *              template and a non-ASCII text, through the spellings a line search misses:
 *              `globalThis` / `global`, a string-literal key, casts and `!`, optional chains, a call
 *              split across lines, `.call` / `.apply` / `.bind`, an alias or a destructured binding,
 *              and a writer handed to another call. The valid cases are what the rule must not
 *              mistake for them: the stderr writers, the console members that print nothing to
 *              stdout, a spy or mock of a stdout member, a reference that is never called, a stream
 *              that is not the process's stdout, and a local binding named `console` or `process`.
 * @layer infrastructure
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it } from "vitest";
import rule from "../src/rules/no-stdout-in-node-test.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const lines = (...source: string[]): string => source.join("\n");
const stdout = (writer: string, line = 1) => ({ messageId: "stdout", data: { writer }, line });

ruleTester.run("no-stdout-in-node-test", rule, {
  valid: [
    'console.error("✓ connected");',
    "console.warn(`retrying ${attempt}`);",
    'console.trace("here"); console.assert(ok, "message");',
    'process.stderr.write("diagnostic\\n");',
    'console.time("load"); console.groupEnd(); console.countReset("calls");',
    'vi.spyOn(console, "log").mockImplementation(() => {});',
    't.mock.method(console, "log"); t.mock.method(process.stdout, "write");',
    "console.log = vi.fn();",
    lines("const original = console.log;", "console.log = () => {};", "console.log = original;"),
    'if (typeof process.stdout.write === "function") note("tty");',
    lines("const out = process.stderr;", 'out.write("x");'),
    lines("const { error, warn: say } = console;", 'error("x");', 'say("y");'),
    'child.stdout.write("x"); stream.write("x"); logger.log("x"); logger.info("x");',
    lines("const console = makeLogger();", 'console.log("x");'),
    'function emit(process: Child) { process.stdout.write("x"); }',
    lines("let log = makeLogger();", "log = log;", 'log("x");'),
    lines("const { a: { log } } = console;", 'log("x");'),
    'for (const name of ["log"]) note(name);',
  ],
  invalid: [
    {
      code: lines(
        'console.log("x");',
        'console.info("x");',
        'console.debug("x");',
        "console.dir(value);",
        "console.dirxml(value);",
        "console.table(rows);",
        'console.count("calls");',
        'console.group("section");',
        'console.groupCollapsed("section");',
        'console.timeLog("load");',
        'console.timeEnd("load");'
      ),
      errors: [
        stdout("console.log"),
        stdout("console.info", 2),
        stdout("console.debug", 3),
        stdout("console.dir", 4),
        stdout("console.dirxml", 5),
        stdout("console.table", 6),
        stdout("console.count", 7),
        stdout("console.group", 8),
        stdout("console.groupCollapsed", 9),
        stdout("console.timeLog", 10),
        stdout("console.timeEnd", 11),
      ],
    },
    { code: 'process.stdout.write("tap\\n");', errors: [stdout("process.stdout.write")] },
    { code: "console.log(`${status}: ${test}`);", errors: [stdout("console.log")] },
    { code: 'console.log("✓ Prisma connected");', errors: [stdout("console.log")] },
    { code: 'process.stdout.write("🧪 setup\\n");', errors: [stdout("process.stdout.write")] },
    {
      code: lines('globalThis.console.log("x");', 'global.process.stdout.write("x");'),
      errors: [stdout("globalThis.console.log"), stdout("global.process.stdout.write", 2)],
    },
    {
      code: lines('console["log"]("x");', 'process["stdout"]["write"]("x");'),
      errors: [stdout('console["log"]'), stdout('process["stdout"]["write"]', 2)],
    },
    { code: '(console as any).info("x");', errors: [stdout("(console as any).info")] },
    { code: 'process!.stdout.write("x");', errors: [stdout("process!.stdout.write")] },
    { code: '(<any>process).stdout.write("x");', errors: [stdout("(<any>process).stdout.write")] },
    {
      code: '(process.stdout satisfies NodeJS.WriteStream).write("x");',
      errors: [stdout("(process.stdout satisfies NodeJS.WriteStream).write")],
    },
    {
      code: lines('console?.log?.("x");', 'process.stdout?.write("x");'),
      errors: [stdout("console?.log"), stdout("process.stdout?.write", 2)],
    },
    { code: lines("console", "  .log(", '    "x"', "  );"), errors: [stdout("console.log")] },
    {
      code: lines(
        'console.log.call(console, "x");',
        'console.info.apply(console, ["x"]);',
        "const log = console.log.bind(console);"
      ),
      errors: [stdout("console.log"), stdout("console.info", 2), stdout("console.log", 3)],
    },
    { code: lines("const log = console.log;", 'log("x");'), errors: [stdout("log", 2)] },
    {
      code: lines("const { log, info: say } = console;", 'log("x");', 'say("y");'),
      errors: [stdout("log", 2), stdout("say", 3)],
    },
    {
      code: lines("const out = process.stdout;", 'out.write("x");'),
      errors: [stdout("out.write", 2)],
    },
    {
      code: lines("const { stdout: out } = process;", 'out.write("x");'),
      errors: [stdout("out.write", 2)],
    },
    { code: lines("const c = console;", "c.table(rows);"), errors: [stdout("c.table", 2)] },
    {
      code: lines("let log;", "log = console.debug;", 'log("x");'),
      errors: [stdout("log", 3)],
    },
    {
      code: lines("let a, b;", "a = b = console.log;", 'a("x");'),
      errors: [stdout("a", 3)],
    },
    {
      code: lines("promise.catch(console.log);", "setTimeout(console.info, 0, 'x');"),
      errors: [stdout("console.log"), stdout("console.info", 2)],
    },
  ],
});
