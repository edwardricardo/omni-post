/**
 * @file no-unowned-handle-unref.test.ts
 * @description RuleTester suite for `testing/no-unowned-handle-unref`. The rule exists because a
 *              test that unref'd every active handle (`unrefActiveHandles`) also unref'd the IPC
 *              channel of its vitest fork, which then exited under the pool with zero failing
 *              assertions. The invalid cases are process-wide enumeration, read as a member or
 *              destructured; `unref()` on the process's own streams through every spelling the
 *              line-based guard this rule replaces was blind to (the optional chain and the
 *              optional call, `as any`, `<any>` and `!`, `globalThis`, a call split across lines);
 *              and `unref()` on a receiver the file did not mint — a parameter, an import, an
 *              unresolved name, a helper's return value, an alias of a process stream. The valid
 *              cases are what the rule must not mistake for them: writing to a process stream,
 *              reading `unref` without calling it, an object literal that merely has an
 *              enumerator's name as a key, and the handles a test owns — a binding or `this.x`
 *              initialised or assigned from a creator, across split lines, casts, multiple
 *              declarators and destructuring.
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
const unowned = (receiver: string, line = 1) => ({
  messageId: "unowned",
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
    lines("const t = setTimeout(resolve, 50);", "t.unref();"),
    lines(
      "const t = setTimeout(",
      '  () => reject(new Error("Health check timeout")),',
      "  timeoutMs",
      ");",
      "t.unref();"
    ),
    lines("const t =", "  setTimeout(() => done(), 10);", "t.unref();"),
    lines("const t = setInterval(tick, 10) as unknown as NodeJS.Timeout;", "t!.unref();"),
    lines("let poller: NodeJS.Timeout = setInterval(tick, 10);", "poller.unref?.();"),
    lines("let t: NodeJS.Immediate | undefined;", "t = setImmediate(run);", "t.unref();"),
    lines("let t = undefined;", "t = setTimeout(f, 1);", "t.unref();"),
    lines("const a = setTimeout(f, 1), b = setInterval(g, 2);", "a.unref();", "b.unref();"),
    lines('const { stdout } = spawn("ls");', "stdout.unref();"),
    lines('const child = spawn("ls");', "child.stdout.unref();"),
    lines("const t = fast ? setImmediate(run) : setTimeout(run, 10);", "t.unref();"),
    lines("const t = setTimeout(f, 1);", "const same = t;", "same.unref();"),
    lines("let t = setTimeout(f, 1);", "t = t;", "t.unref();"),
    lines("const server = await app.listen(0);", "server.unref();"),
    lines("setTimeout(done, 10).unref();", "createServer(handler).listen(0).unref();"),
    lines(
      "const conn = net.createConnection(port);",
      'const socket = dgram.createSocket("udp4");',
      "const input = fs.createReadStream(file);",
      "const output = fs.createWriteStream(file);",
      "const watcher = fs.watchFile(file, onChange);",
      "const child = fork(script);",
      "const proc = execFile(binary);",
      "const server = app.listen(0);",
      "conn.unref(); socket.unref(); input.unref(); output.unref();",
      "watcher.unref(); child.unref(); proc.unref(); server.unref();"
    ),
    lines(
      "class Poller {",
      "  private timer = setInterval(() => this.tick(), 10);",
      "  stop() { this.timer.unref(); }",
      "}"
    ),
    lines(
      "class Server {",
      "  start() { this.server = createServer(); }",
      "  stop() { this.server.unref(); }",
      "}"
    ),
    lines(
      "class Watchdog {",
      "  #timer: NodeJS.Timeout | null = null;",
      "  arm() { this.#timer = setTimeout(fire, 5); }",
      "  stop() { this.#timer?.unref(); }",
      "}"
    ),
    lines(
      "class Reverse {",
      "  stop() { this.timer.unref(); }",
      "  start() { this.timer = setInterval(tick, 10); }",
      "}"
    ),
    lines(
      "class Loop {",
      "  timer = setTimeout(fire, 5);",
      "  keep() { this.timer = this.timer; }",
      "  stop() { this.timer.unref(); }",
      "}"
    ),
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
      code: "const { _getActiveHandles } = somethingElse;",
      errors: [enumeration("_getActiveHandles")],
    },
    {
      code: lines(
        "const { _getActiveHandles } = process;",
        "_getActiveHandles().forEach(release);"
      ),
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
    { code: "process.stdout?.unref?.();", errors: [processHandle("process.stdout")] },
    { code: '(process)["stdout"].unref();', errors: [processHandle('(process)["stdout"]')] },
    {
      code: lines("globalThis.process.stdout.unref();", "global.process.channel.unref();"),
      errors: [
        processHandle("globalThis.process.stdout"),
        processHandle("global.process.channel", 2),
      ],
    },
    { code: lines("process.stdout", "  .unref();"), errors: [processHandle("process.stdout")] },
    {
      code: lines(
        "export function unrefActiveHandles(): void {",
        "  const handles = (process as any)._getActiveHandles?.() ?? [];",
        "  for (const h of handles) {",
        '    if (typeof h.unref === "function") h.unref();',
        "  }",
        "}"
      ),
      errors: [enumeration("_getActiveHandles", 2), unowned("h", 4)],
    },
    {
      code: lines("const out = process.stdout as NodeJS.WriteStream;", "out.unref();"),
      errors: [processHandle("out", 2)],
    },
    { code: "function quiet(h: { unref(): void }) { h.unref(); }", errors: [unowned("h")] },
    {
      code: lines('import { timer } from "./timers.js";', "timer.unref();"),
      errors: [unowned("timer", 2)],
    },
    { code: "orphan.unref();", errors: [unowned("orphan")] },
    { code: "globalThis.handle.unref();", errors: [unowned("globalThis.handle")] },
    { code: "app.server.unref();", errors: [unowned("app.server")] },
    { code: lines("const t = makeTimer();", "t.unref();"), errors: [unowned("t", 2)] },
    { code: lines("const t =", "  somethingElse();", "t.unref();"), errors: [unowned("t", 3)] },
    {
      code: lines("let t: NodeJS.Timeout | null = null;", "t?.unref();"),
      errors: [unowned("t", 2)],
    },
    {
      code: lines(
        "function swap(h: NodeJS.Timeout) {",
        "  let t = setTimeout(g, 1);",
        "  t = h;",
        "  t.unref();",
        "}"
      ),
      errors: [unowned("t", 4)],
    },
    {
      code: "function rearm(h: NodeJS.Timeout) { h = setTimeout(g, 1); h.unref(); }",
      errors: [unowned("h")],
    },
    {
      code: lines(
        "class Holder {",
        "  constructor(timer: NodeJS.Timeout) { this.timer = timer; }",
        "  stop() { this.timer.unref(); }",
        "}"
      ),
      errors: [unowned("this.timer", 3)],
    },
  ],
});
