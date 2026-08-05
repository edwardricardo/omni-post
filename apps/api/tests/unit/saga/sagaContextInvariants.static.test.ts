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
  openParen: number;
  closeParen: number;
  reason: string;
  callback: string;
}

const sagaSources: SagaSource[] = getAllTsFiles(sagaDir).map((path) => {
  const original = readFileSync(path, "utf8");
  return { path, label: relative(apiRoot, path), original, sanitized: sanitize(original) };
});

function collectWrapCalls(sources: SagaSource[]): WrapCall[] {
  const calls: WrapCall[] = [];
  for (const source of sources) {
    const text = source.sanitized;
    let cursor = text.indexOf(`${SYSTEM_WRAP}(`);
    while (cursor !== -1) {
      const openParen = cursor + SYSTEM_WRAP.length;
      const closeParen = findMatching(text, openParen, "(", ")");
      if (closeParen !== -1) {
        const inner = text.slice(openParen + 1, closeParen);
        calls.push({
          source,
          openParen,
          closeParen,
          reason: firstArgument(inner),
          callback: argumentsAfterFirst(inner),
        });
      }
      cursor = text.indexOf(`${SYSTEM_WRAP}(`, cursor + 1);
    }
  }
  return calls;
}

const wrapCalls = collectWrapCalls(sagaSources);

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
    it("keeps every dispatch lexically outside every system-context callback", () => {
      const violations: string[] = [];

      for (const call of wrapCalls) {
        const body = call.source.sanitized.slice(call.openParen, call.closeParen + 1);
        for (const dispatch of DISPATCHES) {
          if (body.includes(dispatch)) {
            violations.push(
              `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
                `${dispatch} sits inside a ${SYSTEM_WRAP} callback`
            );
          }
        }
      }

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

    it("wraps every direct model read in a system-context callback", () => {
      const violations = modelReads
        .filter(
          (read) =>
            !wrapCalls.some(
              (call) =>
                call.source.path === read.source.path &&
                read.index > call.openParen &&
                read.index < call.closeParen
            )
        )
        .map(
          (read) =>
            `${read.source.label}:${lineOf(read.source.original, read.index)}: ` +
            `${read.model} read is not inside a ${SYSTEM_WRAP} callback`
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
    const bootLoadBody = blockAfter(lifecycle, lifecycle.sanitized.indexOf("loadActiveSagas("));
    const retryScanBody = scheduledTaskBody(lifecycle, "saga-retry-recovery");
    const timeoutBody = scheduledTaskBody(lifecycle, "saga-timeout-checker");

    it("extracts the three background loop bodies", () => {
      expect(bootLoadBody).not.toBe("");
      expect(retryScanBody).not.toBe("");
      expect(timeoutBody).not.toBe("");
    });

    it("declares a failure counter for each loop", () => {
      const types = readFileSync(sagaTypesPath, "utf8");
      const missing = ["bootLoadFailures", "recoveryScanFailures", "rehydrationFailures"].filter(
        (counter) => !types.includes(counter)
      );

      expect(missing).toEqual([]);
    });

    it("logs at ERROR and counts the failure on the boot load", () => {
      expect({
        logsError: bootLoadBody.includes("logger.error"),
        countsFailure: bootLoadBody.includes("bootLoadFailures"),
      }).toEqual({ logsError: true, countsFailure: true });
    });

    it("logs at ERROR and counts the failure on the retry recovery scan", () => {
      expect({
        logsError: retryScanBody.includes("logger.error"),
        countsFailure: retryScanBody.includes("recoveryScanFailures"),
      }).toEqual({ logsError: true, countsFailure: true });
    });

    it("routes the timeout checker's persistence through the fail-loud rehydration", () => {
      expect(timeoutBody).toContain("runAsSagaTenant");
    });

    it("discards no error in any background loop catch block", () => {
      const silent: string[] = [];
      const loops: Array<[string, string]> = [
        ["boot load", bootLoadBody],
        ["retry recovery scan", retryScanBody],
        ["timeout checker", timeoutBody],
      ];

      for (const [name, body] of loops) {
        for (const block of catchBlocks(body)) {
          if (!block.includes("logger.error")) {
            silent.push(`${name}: catch block does not log at ERROR`);
          }
        }
      }

      expect(silent).toEqual([]);
    });
  });
});
