/**
 * @file sagaContextInvariants.static.test.ts
 * @description Merge-blocking source-scan invariants over the saga engine and the
 *              API bootstrap. The engine runs detached from any request, so its
 *              tenant posture is only auditable structurally: system-context wraps
 *              must stay narrow enough that they can never span a saga dispatch,
 *              every tenant-unknown model read must sit inside one, the engine must
 *              never be handed the unguarded Prisma singleton, and every background
 *              loop must surface its failures instead of discarding them.
 *
 *              The scans balance delimiters over a sanitized copy of each source
 *              (comments and string/template literals blanked, offsets preserved),
 *              so a brace or paren inside text can never skew a result.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const sagaDir = join(apiRoot, "src", "saga");
const bootstrapPath = join(apiRoot, "src", "index.ts");
const sagaTypesPath = join(sagaDir, "sagaManagerTypes.ts");

const SYSTEM_WRAP = "withSystemContext";
const REASON_CONSTANT = "SAGA_SYSTEM_REASON";
const DISPATCHES = ["executeSagaAsync(", "compensateSagaAsync("] as const;

/**
 * Every form that declares the saga system boundary. `withSystemContext` is the
 * primitive; the two saga wrappers own the awaited-inside and GUC-binding
 * details so no engine call site has to repeat them. All three are boundaries a
 * dispatch must stay outside of, and all three satisfy a declared model read.
 */
const SYSTEM_WRAP_FORMS = [SYSTEM_WRAP, "withSagaSystemRead", "runSagaSystemTransaction"] as const;

/** The tenant rehydration whose discriminated outcome every caller must consume. */
const TENANT_WRAP = "runAsSagaTenant";

// ---------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Returns a copy of `source` in which the interior of line comments, block
 * comments and string/template literals is replaced by spaces. Length and
 * newline positions are preserved, so every index is valid in both copies.
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

/** Index of the first `{` at or after `from`, or -1. */
function nextBrace(text: string, from: number): number {
  const index = text.indexOf("{", from);
  return index;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function firstArgument(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return inner.slice(0, i).trim();
  }
  return inner.trim();
}

/** Everything after the first argument, or "" when the call takes only one. */
function argumentsAfterFirst(inner: string): string {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return inner.slice(i + 1).trim();
  }
  return "";
}

interface SagaSource {
  path: string;
  label: string;
  original: string;
  sanitized: string;
}

interface WrapCall {
  source: SagaSource;
  /** The declaring form, e.g. `withSystemContext` or `withSagaSystemRead`. */
  form: string;
  openParen: number;
  closeParen: number;
  reason: string;
  callback: string;
}

const sagaSources: SagaSource[] = getAllTsFiles(sagaDir).map((path) => {
  const original = readFileSync(path, "utf8");
  return { path, label: relative(apiRoot, path), original, sanitized: sanitize(original) };
});

/** Every call to `form` in `sources`, with its balanced argument list split. */
function collectCalls(sources: SagaSource[], form: string): WrapCall[] {
  const calls: WrapCall[] = [];
  for (const source of sources) {
    const text = source.sanitized;
    let cursor = text.indexOf(`${form}(`);
    while (cursor !== -1) {
      // Skip an identifier that merely ENDS with the form's name.
      const previous = text[cursor - 1] ?? "";
      if (/[A-Za-z0-9_$.]/.test(previous)) {
        cursor = text.indexOf(`${form}(`, cursor + 1);
        continue;
      }

      const openParen = cursor + form.length;
      const closeParen = findMatching(text, openParen, "(", ")");
      if (closeParen !== -1) {
        const inner = text.slice(openParen + 1, closeParen);
        calls.push({
          source,
          form,
          openParen,
          closeParen,
          reason: firstArgument(inner),
          callback: argumentsAfterFirst(inner),
        });
      }
      cursor = text.indexOf(`${form}(`, cursor + 1);
    }
  }
  return calls;
}

/** Only the primitive `withSystemContext(` sites — declaration is defined there. */
const wrapCalls = collectCalls(sagaSources, SYSTEM_WRAP);

/** Every declared system boundary, whichever form declares it. */
const systemBoundaries = SYSTEM_WRAP_FORMS.flatMap((form) => collectCalls(sagaSources, form));

const tenantWrapCalls = collectCalls(sagaSources, TENANT_WRAP);

/** Extracts the balanced body that follows the first `{` at or after `from`. */
function blockAfter(source: SagaSource, from: number): string {
  const open = nextBrace(source.sanitized, from);
  if (open === -1) return "";
  const close = findMatching(source.sanitized, open, "{", "}");
  if (close === -1) return "";
  return source.sanitized.slice(open, close + 1);
}

function sourceByName(name: string): SagaSource {
  const found = sagaSources.find((source) => source.path.endsWith(name));
  if (!found) throw new Error(`Saga source not found: ${name}`);
  return found;
}

/** Body of a scheduler task, located by its registered task id. */
function scheduledTaskBody(source: SagaSource, taskId: string): string {
  const marker = source.original.indexOf(`"${taskId}"`);
  if (marker === -1) return "";
  return blockAfter(source, marker);
}

/** Every `catch` block inside `body`, excluding promise `.catch(` handlers. */
function catchBlocks(body: string): string[] {
  const blocks: string[] = [];
  const pattern = /(?<![.\w])catch\s*(\()?/g;
  let match = pattern.exec(body);
  while (match !== null) {
    let cursor = match.index + match[0].length;
    if (match[1] === "(") {
      const openParen = body.indexOf("(", match.index);
      const closeParen = findMatching(body, openParen, "(", ")");
      cursor = closeParen === -1 ? cursor : closeParen + 1;
    }
    const open = nextBrace(body, cursor);
    const close = open === -1 ? -1 : findMatching(body, open, "{", "}");
    if (open !== -1 && close !== -1) {
      blocks.push(body.slice(open, close + 1));
    }
    match = pattern.exec(body);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

describe("saga engine context invariants", () => {
  it("finds the saga engine sources to scan", () => {
    expect(sagaSources.length).toBeGreaterThanOrEqual(4);
  });

  describe("system-context wraps never enclose a saga dispatch", () => {
    it("keeps every dispatch lexically outside every declared system boundary", () => {
      const violations: string[] = [];

      for (const call of systemBoundaries) {
        const body = call.source.sanitized.slice(call.openParen, call.closeParen + 1);
        for (const dispatch of DISPATCHES) {
          if (body.includes(dispatch)) {
            violations.push(
              `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
                `${dispatch} sits inside a ${call.form} callback`
            );
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe("the tenant rehydration outcome is always consumed", () => {
    it("finds the engine's rehydration call sites", () => {
      expect(tenantWrapCalls.length).toBeGreaterThan(0);
    });

    it("binds or returns every outcome instead of discarding it", () => {
      // `runAsSagaTenant` reports whether the work RAN. A call used as a bare
      // statement throws that away, which is how a skipped compensation reached
      // an operator as a success envelope.
      const violations = tenantWrapCalls
        .filter((call) => {
          let before = call.source.sanitized
            .slice(0, call.openParen - TENANT_WRAP.length)
            .trimEnd();
          if (/\bawait$/.test(before)) {
            before = before.slice(0, -"await".length).trimEnd();
          }
          const consumed = /[=(,:[]$/.test(before) || /\breturn$/.test(before);
          return !consumed;
        })
        .map(
          (call) =>
            `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
            `${TENANT_WRAP} result is discarded`
        );

      expect(violations).toEqual([]);
    });
  });

  describe("system-context reason is the single declared constant", () => {
    it("declares at least one system-context wrap in the engine", () => {
      expect(wrapCalls.length).toBeGreaterThan(0);
    });

    it("passes the declared reason constant at every call site", () => {
      const violations = wrapCalls
        .filter((call) => call.reason !== REASON_CONSTANT)
        .map(
          (call) =>
            `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
            `reason is \`${call.reason}\``
        );

      expect(violations).toEqual([]);
    });

    it("awaits the wrapped query inside an async callback at every call site", () => {
      // A Prisma call is lazy — it reaches the database only when awaited. A
      // callback that returns the unawaited promise runs its query AFTER the
      // declared context has been released, so the declaration silently becomes
      // a no-op and the guarded read fails with a missing context instead.
      const violations = wrapCalls
        .filter((call) => !/^async\b/.test(call.callback) || !call.callback.includes("await"))
        .map(
          (call) =>
            `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
            `callback must be \`async\` and await its query`
        );

      expect(violations).toEqual([]);
    });
  });

  describe("tenant-unknown model reads run inside a declared context", () => {
    const modelReadPattern = /config\.prisma\.([A-Za-z][A-Za-z0-9]*)\./g;

    const modelReads: Array<{ source: SagaSource; index: number; model: string }> = [];
    for (const source of sagaSources) {
      let match = modelReadPattern.exec(source.sanitized);
      while (match !== null) {
        modelReads.push({ source, index: match.index, model: match[1] ?? "" });
        match = modelReadPattern.exec(source.sanitized);
      }
      modelReadPattern.lastIndex = 0;
    }

    it("finds the engine's direct model reads", () => {
      expect(modelReads.length).toBeGreaterThan(0);
    });

    it("wraps every direct model read in a declared system boundary", () => {
      const violations = modelReads
        .filter(
          (read) =>
            !systemBoundaries.some(
              (call) =>
                call.source.path === read.source.path &&
                read.index > call.openParen &&
                read.index < call.closeParen
            )
        )
        .map(
          (read) =>
            `${read.source.label}:${lineOf(read.source.original, read.index)}: ` +
            `${read.model} read is not inside a declared system boundary`
        );

      expect(violations).toEqual([]);
    });
  });

  describe("bootstrap hands the engine a guarded client", () => {
    const bootstrapOriginal = readFileSync(bootstrapPath, "utf8");
    const bootstrapSanitized = sanitize(bootstrapOriginal);

    const rawBindings = new Set<string>();
    const importPattern = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@infra\/prisma["']/g;
    let importMatch = importPattern.exec(bootstrapOriginal);
    while (importMatch !== null) {
      for (const specifier of (importMatch[1] ?? "").split(",")) {
        const local =
          specifier
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? "";
        const name = local.replace(/^type\s+/, "").trim();
        if (name) rawBindings.add(name);
      }
      importMatch = importPattern.exec(bootstrapOriginal);
    }

    const constructionIndex = bootstrapSanitized.indexOf("new SagaIntegration(");
    const openParen = bootstrapSanitized.indexOf("(", constructionIndex);
    const closeParen = findMatching(bootstrapSanitized, openParen, "(", ")");
    const configText =
      constructionIndex === -1 || closeParen === -1
        ? ""
        : bootstrapSanitized.slice(openParen + 1, closeParen);

    const explicit = /(?:^|[\s,{])prisma\s*:\s*([^\n,]+)/.exec(configText);
    const shorthand = /(?:^|[\s,{])prisma\s*(?=[,\n}])/.test(configText);
    const clientExpression = explicit?.[1]?.trim() ?? (shorthand ? "prisma" : "");
    const leadingIdentifier = /^[A-Za-z_$][\w$]*/.exec(clientExpression)?.[0] ?? "";

    it("locates the saga integration construction site", () => {
      expect(clientExpression).not.toBe("");
      expect(rawBindings.size).toBeGreaterThan(0);
    });

    it("never passes a binding imported from the raw prisma module", () => {
      expect({ clientExpression, isRawBinding: rawBindings.has(leadingIdentifier) }).toEqual({
        clientExpression,
        isRawBinding: false,
      });
    });

    it("resolves the client from the container instead", () => {
      expect(clientExpression).toContain("TOKENS.PrismaClient");
    });
  });

  describe("background loop failures are observable", () => {
    const lifecycle = sourceByName("SagaManagerLifecycle.ts");
    const execution = sourceByName("SagaManagerExecution.ts");

    /**
     * Body of the method whose DECLARATION matches `pattern`. Anchoring on the
     * declaration matters: `initialize()` calls `loadActiveSagas` before
     * declaring it, so a first-textual-occurrence anchor silently scanned the
     * caller's catch block and every assertion below passed for the wrong body.
     */
    function methodBody(source: SagaSource, pattern: RegExp): string {
      const match = pattern.exec(source.sanitized);
      if (match === null) return "";
      return blockAfter(source, match.index);
    }

    const bootLoadBody = methodBody(lifecycle, /\basync\s+loadActiveSagas\s*\(/);
    const bootCatchBody = methodBody(lifecycle, /\basync\s+initialize\s*\(/);
    const retryScanBody = scheduledTaskBody(lifecycle, "saga-retry-recovery");
    const timeoutBody = scheduledTaskBody(lifecycle, "saga-timeout-checker");
    const shutdownBody = methodBody(lifecycle, /\basync\s+shutdown\s*\(/);
    const instanceLoadBody = methodBody(execution, /\basync\s+loadSagaInstance\s*\(/);

    it("extracts each scanned body from its own declaration", () => {
      expect({
        bootLoad: bootLoadBody.includes("loadActiveSagas"),
        bootLoadReads: bootLoadBody.includes("findMany"),
        retryScan: retryScanBody.includes("findMany"),
        timeout: timeoutBody.includes("activeInstances"),
        shutdown: shutdownBody.includes("persistSagaInstance"),
        instanceLoad: instanceLoadBody.includes("findUnique"),
      }).toEqual({
        bootLoad: false,
        bootLoadReads: true,
        retryScan: true,
        timeout: true,
        shutdown: true,
        instanceLoad: true,
      });
    });

    it("declares a failure counter for every loop that can fail", () => {
      const types = readFileSync(sagaTypesPath, "utf8");
      const missing = [
        "bootLoadFailures",
        "recoveryScanFailures",
        "rehydrationFailures",
        "tenantMismatches",
        "timeoutCheckFailures",
        "instanceLoadFailures",
      ].filter((counter) => !types.includes(counter));

      expect(missing).toEqual([]);
    });

    it("logs at ERROR and counts its own failure in every background loop", () => {
      // Per loop, and against ITS counter: a shared assertion would pass while
      // one loop silently reported another's failure.
      const loops: Array<{ name: string; body: string; counter: string }> = [
        { name: "boot load", body: bootCatchBody, counter: "bootLoadFailures" },
        { name: "retry recovery scan", body: retryScanBody, counter: "recoveryScanFailures" },
        { name: "timeout checker", body: timeoutBody, counter: "timeoutCheckFailures" },
        { name: "by-id instance load", body: instanceLoadBody, counter: "instanceLoadFailures" },
      ];

      const violations = loops.flatMap(({ name, body, counter }) => {
        const problems: string[] = [];
        if (catchBlocks(body).length === 0) problems.push(`${name}: no catch block at all`);
        if (!body.includes("logger.error")) problems.push(`${name}: never logs at ERROR`);
        if (!body.includes(counter)) problems.push(`${name}: never increments ${counter}`);
        return problems;
      });

      expect(violations).toEqual([]);
    });

    it("isolates the timeout checker and the shutdown drain per saga", () => {
      // One poisoned row must not end the pass: without a try/catch INSIDE the
      // loop, the first throw skipped every saga after it — forever, if the
      // same row threw again.
      const violations: string[] = [];
      for (const [name, body] of [
        ["timeout checker", timeoutBody],
        ["shutdown drain", shutdownBody],
      ] as Array<[string, string]>) {
        const loopStart = /\bfor\s*\(/.exec(body)?.index ?? -1;
        if (loopStart === -1) {
          violations.push(`${name}: no per-saga loop found`);
          continue;
        }
        const loopBody = body.slice(loopStart);
        if (catchBlocks(loopBody).length === 0) {
          violations.push(`${name}: the per-saga loop body has no catch`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("terminalizes a saga the timeout checker cannot scope to a tenant", () => {
      // Skipping it forever is an infinite non-terminal saga, which the saga
      // canon forbids; the checker owns driving it to FAILED instead.
      expect({
        rehydrates: timeoutBody.includes("checkSagaTimeout"),
        terminalizes: lifecycle.sanitized.includes("failSagaAsSystem"),
      }).toEqual({ rehydrates: true, terminalizes: true });
    });

    it("discards no error in any background loop catch block", () => {
      const silent: string[] = [];
      const loops: Array<[string, string]> = [
        ["boot load", bootCatchBody],
        ["retry recovery scan", retryScanBody],
        ["timeout checker", timeoutBody],
        ["shutdown drain", shutdownBody],
        ["by-id instance load", instanceLoadBody],
      ];

      for (const [name, body] of loops) {
        for (const block of catchBlocks(body)) {
          if (!block.includes("logger.error") && !block.includes("logger.warn")) {
            silent.push(`${name}: catch block does not log`);
          }
        }
      }

      expect(silent).toEqual([]);
    });
  });
});
