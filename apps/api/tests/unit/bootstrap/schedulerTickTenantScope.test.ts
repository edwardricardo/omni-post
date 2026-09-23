/**
 * @file schedulerTickTenantScope.test.ts
 * @description Source-scan invariant over the API bootstrap's recurring ticks: every
 *   `scheduler.register(...)` callback in `src/index.ts` must DECLARE the tenant scope it
 *   runs under.
 *
 *   ## The defect this pins, and why nothing else notices it
 *
 *   Each `*-dispatch` tick calls a use case with no `accountId`, and every one of those use
 *   cases opens with a read of a tenant-guard-enrolled model (`channel`, `trackedTerm`,
 *   `accountSubscription`, `dsarRequest`). The container's client carries the tenant guard, so
 *   an unscoped read raises `TenantContextMissingError` — and the use case's own `try/catch`
 *   turns that throw into `err(...)`, which the tick then reports through `logger.warn`. The
 *   job is dead and the process is healthy: no test fails, no metric moves, no alert fires.
 *   Measured on a live application-role connection before this scan was written: the tick's
 *   own read (`findActiveChannels(undefined)`) threw `TenantContextMissingError` unbound and
 *   returned rows inside `withSystemContext`.
 *
 *   A recurring sweep across every account is exactly what `withSystemContext(reason)` exists
 *   to declare — the same shape `RecurrenceScheduler` already uses for its own tick. The scan
 *   therefore admits ONE answer per tick rather than an allowlist of exceptions: a sweep that
 *   cannot say which tenant it runs for says `system:` and names itself.
 *
 *   ## What it reads
 *
 *   The bootstrap source itself. Delimiters are balanced over a sanitized copy (comments and
 *   string/template literals blanked, offsets preserved), so a brace or paren inside text
 *   cannot skew a span; the reason string is then read from the ORIGINAL at the same offsets.
 *   Every assertion NAMES the tick it is about — a count of registered ticks would go green on
 *   a scope pasted from the neighbouring one.
 *
 *   ## Every verdict is decided on the SANITIZED copy, and that is the whole guard
 *
 *   The balancing used the sanitized copy while the assertions searched the original bytes, so
 *   a mention of the wrap was enough and an executed call was not required. Measured, not
 *   supposed: a registration reading `async () => { // …withSystemContext("system:…", run).
 *   await sweep((run) => run()); }` — cross-account discovery with NO scope at all, its only
 *   mention of the wrap inside a line comment — passed all seven cases of this file, including
 *   the one that names the sweep's scope. A gate that certifies the defect it exists to catch
 *   is worse than no gate, so the body is now carried in BOTH forms: the sanitized copy decides
 *   whether a call exists, and the original is read at the sanitized match's own offset when a
 *   verdict needs the text of a string literal (which sanitizing necessarily blanks).
 *
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RETRACTION_ACTION_WINDOW_SWEEP_INTERVAL_MS } from "../../../src/infrastructure/retention/RetractionActionWindowSweep.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const bootstrapPath = join(currentDir, "..", "..", "..", "src", "index.ts");

/** The wrap that declares a cross-account sweep. */
const SYSTEM_WRAP = "withSystemContext(";

/** The prefix every sweep reason carries, so the declaration is greppable as one class. */
const SYSTEM_REASON_PREFIX = "system:";

/**
 * Non-vacuity floor. The bootstrap registers this many recurring ticks today; a scan that
 * finds fewer has stopped seeing the call shape (a rename, an extraction, a helper) and would
 * otherwise report green over ticks it never read.
 */
const MINIMUM_TICKS = 10;

/**
 * Returns a copy of `source` whose line comments, block comments and string/template literal
 * interiors are spaces. Length and newline positions are preserved, so every index is valid in
 * both copies.
 */
function sanitize(source: string): string {
  const chars = source.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  };

  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);

    if (pair === "//") {
      let j = i + 2;
      while (j < source.length && source[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }

    if (pair === "/*") {
      let j = i + 2;
      while (j < source.length && source.slice(j, j + 2) !== "*/") j++;
      const end = Math.min(j + 2, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j++;
      }
      const end = Math.min(j + 1, source.length);
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return chars.join("");
}

/** Index of the delimiter closing the one at `openIndex`, or -1 when unbalanced. */
function findMatching(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) {
      depth++;
    } else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface RegisteredTick {
  /** The task id the tick registers under, read from the original source. */
  readonly taskId: string;
  /**
   * The registration's argument list, from the ORIGINAL source. Carries the text of every
   * string literal, so it is what a verdict reads once the sanitized copy has located the
   * call — and it is never what decides whether that call exists.
   */
  readonly body: string;
  /**
   * The same span of the SANITIZED copy: index-for-index with `body`, with comment and
   * string/template interiors blanked. Every "is this call here" verdict is decided on this,
   * because a mention in a comment is not a call.
   */
  readonly sanitizedBody: string;
  /** 1-based line of the registration, for failure messages that can be acted on. */
  readonly line: number;
}

/**
 * Collects every `scheduler.register(...)` registration in the bootstrap, with its task id and
 * its full argument list. Spans are balanced over the sanitized copy and sliced out of BOTH
 * copies at the same offsets: the sanitized span is what decides whether a call is present, the
 * original span is what carries the reason strings a verdict then reads.
 */
function collectTicks(source: string): RegisteredTick[] {
  const sanitized = sanitize(source);
  const ticks: RegisteredTick[] = [];
  const marker = "scheduler.register(";

  let from = 0;
  while (from < sanitized.length) {
    const start = sanitized.indexOf(marker, from);
    if (start === -1) break;

    const open = start + marker.length - 1;
    const close = findMatching(sanitized, open, "(", ")");
    if (close === -1) {
      throw new Error(
        `unbalanced scheduler.register( at line ${source.slice(0, start).split("\n").length} ` +
          "of src/index.ts — the scan cannot see where the registration ends, so it fails " +
          "closed rather than reporting green over a body it never read"
      );
    }

    const body = source.slice(open + 1, close);
    const idMatch = /^\s*"([^"]+)"/.exec(body);
    ticks.push({
      taskId: idMatch?.[1] ?? "",
      body,
      sanitizedBody: sanitized.slice(open + 1, close),
      line: source.slice(0, start).split("\n").length,
    });
    from = close + 1;
  }

  return ticks;
}

/**
 * The reasons this tick REALLY declares: every `withSystemContext(` the sanitized copy holds —
 * so a mention inside a comment or a string is not one — with its first argument read out of the
 * original at that same offset, because sanitizing blanks the literal the reason lives in.
 *
 * A call whose first argument is not a string literal yields nothing and is therefore reported
 * by the reason case below, which is the fail-closed answer: a reason assembled at runtime is
 * not one this scan can attribute to a tick.
 */
function declaredScopeReasons(tick: RegisteredTick): string[] {
  const reasons: string[] = [];
  let from = 0;
  for (;;) {
    const at = tick.sanitizedBody.indexOf(SYSTEM_WRAP, from);
    if (at === -1) return reasons;
    const argument = tick.body.slice(at + SYSTEM_WRAP.length);
    const literal = /^\s*"([^"]*)"/.exec(argument);
    if (literal) reasons.push(literal[1]!);
    from = at + SYSTEM_WRAP.length;
  }
}

describe("bootstrap scheduler ticks declare their tenant scope", () => {
  const source = readFileSync(bootstrapPath, "utf8");
  const ticks = collectTicks(source);

  it("still sees the recurring ticks the bootstrap registers", () => {
    expect(ticks.length).toBeGreaterThanOrEqual(MINIMUM_TICKS);
  });

  it("reads a task id for every registration it found", () => {
    const anonymous = ticks.filter((tick) => tick.taskId === "");
    expect(
      anonymous.map((tick) => `src/index.ts:${tick.line}`),
      "a registration whose first argument is not a string literal cannot be attributed to a " +
        "task, so the scope assertion below could not name what it was about"
    ).toEqual([]);
  });

  it("wraps every tick body in a declared system scope", () => {
    const unscoped = ticks
      .filter((tick) => !tick.sanitizedBody.includes(SYSTEM_WRAP))
      .map((tick) => `${tick.taskId} (src/index.ts:${tick.line})`);

    expect(
      unscoped,
      "these recurring ticks run across every account with no declared tenant scope. Under the " +
        "container's guarded client their first enrolled-model read raises " +
        "TenantContextMissingError, the use case converts it to an err(...), and the tick " +
        "reports it as a logger.warn — a dead job that never reddens anything. Wrap the body " +
        `in ${SYSTEM_WRAP}"${SYSTEM_REASON_PREFIX}<task-id>", ...) as RecurrenceScheduler does.`
    ).toEqual([]);
  });

  it("names each tick in its own scope reason instead of inheriting a neighbour's", () => {
    const mismatched = ticks
      .filter((tick) => tick.sanitizedBody.includes(SYSTEM_WRAP))
      .filter(
        (tick) => !declaredScopeReasons(tick).includes(`${SYSTEM_REASON_PREFIX}${tick.taskId}`)
      )
      .map(
        (tick) =>
          `${tick.taskId} (src/index.ts:${tick.line}) declares [` +
          `${declaredScopeReasons(tick).join(", ")}]`
      );

    expect(
      mismatched,
      "a scope reason is what an operator reads in the audit trail and in the guard's own " +
        "diagnostics. A reason copied from the neighbouring tick declares the wrong sweep and " +
        "no count would notice; a reason that is only WRITTEN ABOUT in a comment declares " +
        `nothing at all. Pass "${SYSTEM_REASON_PREFIX}<task-id>" as the first argument.`
    ).toEqual([]);
  });
});

describe("the retraction action-window sweep is a registered bootstrap tick", () => {
  const source = readFileSync(bootstrapPath, "utf8");
  const tick = collectTicks(source).find(
    (candidate) => candidate.taskId === "retraction-action-window-sweep"
  );

  it("registers the sweep under its own task id", () => {
    expect(
      tick,
      "the sweep exists but nothing ticks it, so every expired action window stays open and " +
        "the alert cycle it bounds never closes. Nothing else in the tree would notice: the " +
        "class compiles, its own suite passes, and no metric moves because none is produced."
    ).toBeDefined();
  });

  it("ticks it on the cadence the module declares, not on a literal pasted here", () => {
    expect(tick?.sanitizedBody).toContain("RETRACTION_ACTION_WINDOW_SWEEP_INTERVAL_MS");
    // The cadence itself is the module's claim; this file only pins that the
    // registration uses it, so the two cannot drift apart.
    expect(RETRACTION_ACTION_WINDOW_SWEEP_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  it("declares the cross-account scope for DISCOVERY and passes it in", () => {
    // The generic scan above proves the body names a system scope. This names the
    // shape: the scope is handed to `sweep(...)` rather than wrapped around it,
    // because the sweep re-binds each row to its own tenant and a tenant context
    // entered inside a system context binds the system sentinel instead.
    //
    // Both halves read the SANITIZED span, so the reason has to be declared by an
    // executed call and the sweep has to be actually invoked. Read on the original
    // bytes these two passed over a registration that called neither.
    expect(declaredScopeReasons(tick!)).toContain(
      `${SYSTEM_REASON_PREFIX}retraction-action-window-sweep`
    );
    expect(tick?.sanitizedBody).toMatch(/\.sweep\(/);
  });
});
