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
/**
 * Every way the engine hands a saga to the execution engine. The awaited form
 * belongs here as much as the detached ones: AsyncLocalStorage propagates into
 * awaited work exactly as it propagates through `setImmediate`, so a system wrap
 * enclosing it would run the whole saga guard-bypassed just the same.
 */
const DISPATCHES = ["executeSagaAsync(", "executeSaga(", "compensateSagaAsync("] as const;

/**
 * Every form that declares the saga system boundary. `withSystemContext` is the
 * primitive; the saga wrappers own the awaited-inside and GUC-binding details so
 * no engine call site has to repeat them (`runSagaSystemTransaction` is
 * module-private, so it can only appear inside the tenant module itself). All
 * three are boundaries a dispatch must stay outside of, and all three satisfy a
 * declared model READ — never a model write.
 */
const SYSTEM_WRAP_FORMS = [SYSTEM_WRAP, "withSagaSystemRead", "runSagaSystemTransaction"] as const;

/** The tenant rehydration whose discriminated outcome every caller must consume. */
const TENANT_WRAP = "runAsSagaTenant";

/** The only form that may enclose a model WRITE: one account, both layers bound. */
const TENANT_TRANSACTION = "runSagaTenantTransaction";

/** Prisma model operations that only read. */
const READ_OPERATIONS = new Set([
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/** Prisma model operations that mutate rows. */
const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

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

/** Start/end offsets of the balanced block that follows `from`, or null. */
function blockRangeAfter(source: SagaSource, from: number): { start: number; end: number } | null {
  const open = nextBrace(source.sanitized, from);
  if (open === -1) return null;
  const close = findMatching(source.sanitized, open, "{", "}");
  if (close === -1) return null;
  return { start: open, end: close };
}

/** Splits a balanced argument list on its top-level commas. */
function splitArguments(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args;
}

/** The single parameter an arrow-function argument binds, or null. */
function arrowParameterName(argument: string): string | null {
  const parenthesised = /^\s*(?:async\s+)?\(\s*([A-Za-z_$][\w$]*)/.exec(argument);
  if (parenthesised) return parenthesised[1] ?? null;
  const bare = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(argument);
  return bare?.[1] ?? null;
}

/**
 * How a transaction client was obtained, which is what fixes the operations it
 * may legally perform.
 *
 * - `system` — the callback parameter of a declared SYSTEM boundary. The tenant
 *   guard is bypassed inside it, so a WRITE here is an unconstrained cross-tenant
 *   mutation.
 * - `tenant` — the callback parameter of `runSagaTenantTransaction`. One account
 *   bound on both layers; reads and writes are both legal.
 * - `delegate` — a parameter typed `SagaTransactionClient` on a helper that
 *   RECEIVES an already-opened transaction. Its own body cannot say how that
 *   transaction was scoped, so the classification comes from what encloses its
 *   call sites.
 */
type BindingKind = "system" | "tenant" | "delegate";

/** An identifier holding a transaction client, and the region it is bound in. */
interface TxBinding {
  source: SagaSource;
  name: string;
  start: number;
  end: number;
  kind: BindingKind;
  /** Set for `delegate`: the function whose parameter binds the client. */
  delegateName: string;
}

/** Every transaction-client binding a primitive callback or a delegate creates. */
function collectTxBindings(sources: SagaSource[]): TxBinding[] {
  const bindings: TxBinding[] = [];

  const primitives: Array<{ form: string; kind: BindingKind }> = [
    ...SYSTEM_WRAP_FORMS.map((form) => ({ form, kind: "system" as BindingKind })),
    { form: TENANT_TRANSACTION, kind: "tenant" as BindingKind },
  ];

  for (const { form, kind } of primitives) {
    for (const call of collectCalls(sources, form)) {
      const inner = call.source.sanitized.slice(call.openParen + 1, call.closeParen);
      const args = splitArguments(inner);
      const name = arrowParameterName(args[args.length - 1] ?? "");
      if (name !== null) {
        bindings.push({
          source: call.source,
          name,
          start: call.openParen,
          end: call.closeParen,
          kind,
          delegateName: "",
        });
      }
    }
  }

  const delegatePattern =
    /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*SagaTransactionClient/g;
  for (const source of sources) {
    delegatePattern.lastIndex = 0;
    let match = delegatePattern.exec(source.sanitized);
    while (match !== null) {
      const body = blockRangeAfter(source, match.index);
      if (body !== null) {
        bindings.push({
          source,
          name: match[2] ?? "",
          start: body.start,
          end: body.end,
          kind: "delegate",
          delegateName: match[1] ?? "",
        });
      }
      match = delegatePattern.exec(source.sanitized);
    }
  }

  return bindings;
}

/** One model operation the engine issues, and how its client was bound. */
interface ModelOperation {
  source: SagaSource;
  index: number;
  model: string;
  operation: string;
  /** `null` for a direct `config.prisma` access. */
  binding: TxBinding | null;
}

/**
 * Every model operation in `sources`, in BOTH shapes the engine can write:
 * `config.prisma.<model>.<op>` directly on the injected client, and
 * `<txBinding>.<model>.<op>` on a transaction client. Matching only the first
 * shape is how the scan went vacuous once `(tx) => tx.model.op(…)` became the
 * house idiom: every real operation moved out of its sight, and the one write
 * that matters — through the READ primitive — moved with them.
 */
function collectModelOperations(sources: SagaSource[]): ModelOperation[] {
  const operations: ModelOperation[] = [];

  const directPattern = /config\.prisma\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)/g;
  for (const source of sources) {
    directPattern.lastIndex = 0;
    let match = directPattern.exec(source.sanitized);
    while (match !== null) {
      operations.push({
        source,
        index: match.index,
        model: match[1] ?? "",
        operation: match[2] ?? "",
        binding: null,
      });
      match = directPattern.exec(source.sanitized);
    }
  }

  for (const binding of collectTxBindings(sources)) {
    const region = binding.source.sanitized.slice(binding.start, binding.end + 1);
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_$.])${binding.name}\\.([A-Za-z][A-Za-z0-9]*)\\.([A-Za-z][A-Za-z0-9]*)`,
      "g"
    );
    let match = pattern.exec(region);
    while (match !== null) {
      operations.push({
        source: binding.source,
        index: binding.start + match.index,
        model: match[1] ?? "",
        operation: match[2] ?? "",
        binding,
      });
      match = pattern.exec(region);
    }
  }

  return operations;
}

/** True when any `this.<delegateName>(` call site sits inside a system boundary. */
function delegateReachedFromSystemBoundary(sources: SagaSource[], delegateName: string): boolean {
  const boundaries = SYSTEM_WRAP_FORMS.flatMap((form) => collectCalls(sources, form));
  for (const source of sources) {
    const pattern = new RegExp(`\\.\\s*${delegateName}\\s*\\(`, "g");
    let match = pattern.exec(source.sanitized);
    while (match !== null) {
      const at = match.index;
      const enclosed = boundaries.some(
        (call) => call.source.path === source.path && at > call.openParen && at < call.closeParen
      );
      if (enclosed) return true;
      match = pattern.exec(source.sanitized);
    }
  }
  return false;
}

/**
 * The ONE system-scoped write the engine is allowed: `failSagaAsSystem` driving
 * a saga no tenant scope can address to its terminal state. It is named here
 * rather than inferred so a SECOND system-side write cannot join it silently —
 * the suite asserts this is the only one.
 */
const SANCTIONED_SYSTEM_WRITE = {
  label: "src/saga/sagaTenant.ts",
  what: "sagaInstance.update",
} as const;

/**
 * Reports every model operation that is not enclosed by a context strong enough
 * for what the operation DOES.
 *
 * The read/write split is the whole point. A single "must sit inside a declared
 * boundary" rule makes a system wrap the cheapest way to green a new write —
 * and a system wrap on a write is an unconstrained cross-tenant mutation, which
 * is precisely what the engine must never grow. So a write is satisfied ONLY by
 * a tenant-scoped transaction; a system boundary makes it FAIL. Reads may be
 * declared either way, because a tenant-unknown read is the one thing the engine
 * legitimately performs across tenants.
 *
 * A transaction-body DELEGATE is judged by its call sites: a write inside one is
 * a violation as soon as any call site is reached from a system boundary. A call
 * site that opens a bare `$transaction` is deliberately NOT a violation — a bare
 * transaction declares no system context, so the Prisma guard stays live on it
 * and an unscoped tenant write fails loudly there rather than being waved
 * through. That is a different (fail-closed) property, not a bypass.
 */
function classifyModelOperations(sources: SagaSource[]): string[] {
  const boundaries = SYSTEM_WRAP_FORMS.flatMap((form) => collectCalls(sources, form));
  const tenantTransactions = collectCalls(sources, TENANT_TRANSACTION);
  const violations: string[] = [];

  const enclosedBy = (calls: WrapCall[], operation: ModelOperation): boolean =>
    calls.some(
      (call) =>
        call.source.path === operation.source.path &&
        operation.index > call.openParen &&
        operation.index < call.closeParen
    );

  for (const operation of collectModelOperations(sources)) {
    const where = `${operation.source.label}:${lineOf(operation.source.original, operation.index)}`;
    const what = `${operation.model}.${operation.operation}`;
    const isWrite = WRITE_OPERATIONS.has(operation.operation);

    if (!isWrite && !READ_OPERATIONS.has(operation.operation)) continue;

    if (operation.binding === null) {
      if (isWrite) {
        if (!enclosedBy(tenantTransactions, operation)) {
          violations.push(`${where}: ${what} writes outside a tenant-scoped transaction`);
        }
        continue;
      }
      if (!enclosedBy(boundaries, operation) && !enclosedBy(tenantTransactions, operation)) {
        violations.push(`${where}: ${what} reads outside any declared context`);
      }
      continue;
    }

    if (!isWrite) continue;

    if (operation.binding.kind === "tenant") continue;

    if (operation.binding.kind === "system") {
      const sanctioned =
        operation.source.label === SANCTIONED_SYSTEM_WRITE.label &&
        what === SANCTIONED_SYSTEM_WRITE.what;
      if (!sanctioned) {
        violations.push(`${where}: ${what} writes through a system boundary, bypassing the guard`);
      }
      continue;
    }

    if (delegateReachedFromSystemBoundary(sources, operation.binding.delegateName)) {
      violations.push(
        `${where}: ${what} writes in a transaction body reached from a system boundary`
      );
    }
  }

  return violations;
}

/** Every write the scan finds under a declared system boundary, as `label::op`. */
function systemScopedWrites(sources: SagaSource[]): string[] {
  return collectModelOperations(sources)
    .filter(
      (operation) =>
        operation.binding?.kind === "system" && WRITE_OPERATIONS.has(operation.operation)
    )
    .map((operation) => `${operation.source.label}::${operation.model}.${operation.operation}`)
    .sort();
}

/** Every model operation the scan finds, as a stable `label::model.op` list. */
function modelOperationInventory(sources: SagaSource[]): string[] {
  return collectModelOperations(sources)
    .filter(
      (operation) =>
        READ_OPERATIONS.has(operation.operation) || WRITE_OPERATIONS.has(operation.operation)
    )
    .map((operation) => `${operation.source.label}::${operation.model}.${operation.operation}`)
    .sort();
}

/**
 * The operations the engine really issues today. Pinned as an exact set so the
 * scan cannot quietly return to matching nothing: a pattern that stops seeing
 * the house idiom fails HERE instead of turning the violation assertions
 * vacuously green.
 */
const KNOWN_ENGINE_OPERATIONS = [
  // The by-id load, plus the two DURABLE-status reads that exist because a
  // best-effort cache must never decide a safety question: the forward-refusal
  // guard, and the walk's own refusal to write over a terminal row.
  "src/saga/SagaManagerExecution.ts::sagaInstance.findUnique",
  "src/saga/SagaManagerExecution.ts::sagaInstance.findUnique",
  "src/saga/SagaManagerExecution.ts::sagaInstance.findUnique",
  "src/saga/SagaManagerExecution.ts::sagaInstance.upsert",
  // The boot load's page AND its two counts — how many rows it had to defer, and
  // what the COMPENSATING level is. All three sit inside the ONE declared read
  // boundary, so the figures and the page describe the same snapshot. The
  // multiplicity is load-bearing: three `count` entries means three DISTINCT
  // reads, and losing any of them would silence a signal while this pin still
  // passed. The THIRD count is the gauge's scrape-time provider, which reads
  // the live COMPENSATING level whenever Prometheus asks — that is what keeps
  // the orphan gauge honest between boots now that the engine resumes walks.
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.count",
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.count",
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.count",
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.findMany",
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.findMany",
  // Two by-id re-reads, both distrusting a stale in-memory copy before a
  // TERMINAL decision: the unscopable path's, and the compensation liveness
  // horizon's.
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.findUnique",
  "src/saga/SagaManagerLifecycle.ts::sagaInstance.findUnique",
  // The compensation's BIRTH, read from the durable event written in the same
  // transaction as the transition. It is the one anchor a restart loop cannot
  // reset, which is what bounds a walk that keeps failing across restarts.
  "src/saga/SagaManagerLifecycle.ts::storedEvent.findFirst",
  "src/saga/sagaTenant.ts::sagaInstance.update",
].sort();

/** Builds a scannable source from inline code, for the classifier's own controls. */
function syntheticSource(code: string): SagaSource {
  return {
    path: "/synthetic/SagaEngineProbe.ts",
    label: "synthetic/SagaEngineProbe.ts",
    original: code,
    sanitized: sanitize(code),
  };
}

/** Names bound by a top-level `export` declaration in `source`. */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  const sanitized = sanitize(source);
  const pattern =
    /\bexport\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let match = pattern.exec(sanitized);
  while (match !== null) {
    names.push(match[1] ?? "");
    match = pattern.exec(sanitized);
  }
  return names;
}

/** Extracts the balanced body that follows the first `{` at or after `from`. */
function blockAfter(source: SagaSource, from: number): string {
  const open = nextBrace(source.sanitized, from);
  if (open === -1) return "";
  const close = findMatching(source.sanitized, open, "{", "}");
  if (close === -1) return "";
  return source.sanitized.slice(open, close + 1);
}

/**
 * The body of `declaration`, with STRING LITERALS INTACT.
 *
 * The balanced scan runs over the sanitized copy — which is what makes the
 * delimiters trustworthy — and the offsets it yields are valid in the original
 * because sanitizing preserves length. Status comparisons are string
 * comparisons, so they are only visible in the original.
 */
function bodyWithLiterals(source: SagaSource, declaration: string): string {
  const at = source.sanitized.indexOf(declaration);
  if (at === -1) return "";
  const open = nextBrace(source.sanitized, at);
  const close = findMatching(source.sanitized, open, "{", "}");
  if (close === -1) return "";
  return source.original.slice(open, close + 1);
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

  describe("model operations are classified, not merely declared", () => {
    const systemReads = collectCalls(sagaSources, "withSagaSystemRead");

    it("delegates the engine's tenant-unknown reads to the read primitive", () => {
      expect(systemReads.length).toBeGreaterThan(0);
    });

    it("hands that primitive the engine's own injected client at every call site", () => {
      // The primitive can only bind the transaction-local scope on the client it
      // is given; a call site that reaches for another one binds nothing.
      const violations = systemReads
        .filter((call) => !call.reason.includes("config.prisma"))
        .map(
          (call) =>
            `${call.source.label}:${lineOf(call.source.original, call.openParen)}: ` +
            `client argument is \`${call.reason}\``
        );

      expect(violations).toEqual([]);
    });

    it("sees every model operation the engine really issues", () => {
      // Pinned as an exact set on purpose. The violation assertions below are
      // only worth anything if the scan is actually LOOKING at the engine: a
      // pattern that stops matching the house idiom would otherwise turn them
      // vacuously green, which is exactly how this suite went blind before.
      expect(modelOperationInventory(sagaSources)).toEqual(KNOWN_ENGINE_OPERATIONS);
    });

    it("never returns to a vacuous scan", () => {
      expect(modelOperationInventory(sagaSources).length).toBeGreaterThanOrEqual(
        KNOWN_ENGINE_OPERATIONS.length
      );
    });

    it("issues no unclassified model operation on the engine client", () => {
      expect(classifyModelOperations(sagaSources)).toEqual([]);
    });

    it("allows exactly one system-scoped write, and only the sanctioned one", () => {
      // The terminal write for a saga no tenant scope can address. Naming it
      // means a SECOND system-side write fails this assertion instead of
      // inheriting the first one's justification.
      expect(systemScopedWrites(sagaSources)).toEqual([
        `${SANCTIONED_SYSTEM_WRITE.label}::${SANCTIONED_SYSTEM_WRITE.what}`,
      ]);
    });

    it("rejects a WRITE issued on the READ primitive's own transaction client", () => {
      // The hazard the house idiom created: `(tx) => tx.model.op(…)` reads as
      // ordinary, so a write slipped in this way is a cross-tenant mutation
      // through the primitive whose entire purpose is reading.
      const probe = syntheticSource(`
        async terminalize(): Promise<void> {
          await withSagaSystemRead(this.config.prisma, (tx) =>
            tx.sagaInstance.update({ where: { id: "x" }, data: {} })
          );
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([
        "synthetic/SagaEngineProbe.ts:4: sagaInstance.update writes through a system boundary, bypassing the guard",
      ]);
    });

    it("accepts a WRITE issued on a tenant transaction's own client", () => {
      const probe = syntheticSource(`
        async persist(): Promise<void> {
          await runSagaTenantTransaction(this.config.prisma, accountId, (tx) =>
            tx.sagaInstance.upsert({ where: { id: "x" } })
          );
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([]);
    });

    it("accepts a READ issued on the READ primitive's own transaction client", () => {
      const probe = syntheticSource(`
        async load(): Promise<void> {
          await withSagaSystemRead(this.config.prisma, (tx) =>
            tx.sagaInstance.findMany({})
          );
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([]);
    });

    it("rejects a WRITE in a transaction body reached from a system boundary", () => {
      // A delegate cannot see how its transaction was scoped, so routing the
      // write through one must not launder it.
      const probe = syntheticSource(`
        private async writeThing(tx: SagaTransactionClient): Promise<void> {
          await tx.sagaInstance.update({ where: { id: "x" }, data: {} });
        }
        async terminalize(): Promise<void> {
          await withSagaSystemRead(this.config.prisma, (client) =>
            this.writeThing(client)
          );
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([
        "synthetic/SagaEngineProbe.ts:3: sagaInstance.update writes in a transaction body reached from a system boundary",
      ]);
    });

    it("accepts a WRITE in a transaction body reached only from a tenant transaction", () => {
      const probe = syntheticSource(`
        private async writeThing(tx: SagaTransactionClient): Promise<void> {
          await tx.sagaInstance.upsert({ where: { id: "x" } });
        }
        async persist(): Promise<void> {
          await runSagaTenantTransaction(this.config.prisma, accountId, (client) =>
            this.writeThing(client)
          );
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([]);
    });

    it("rejects a WRITE that only a system boundary encloses", () => {
      // The control that makes the assertion above meaningful: a system wrap is
      // the cheapest way to green a new write, and it is exactly the wrong fix.
      const probe = syntheticSource(`
        async terminalize(): Promise<void> {
          await withSagaSystemRead(this.config.prisma, async () => {
            await this.config.prisma.sagaInstance.update({ where: { id: "x" }, data: {} });
          });
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([
        "synthetic/SagaEngineProbe.ts:4: sagaInstance.update writes outside a tenant-scoped transaction",
      ]);
    });

    it("accepts a WRITE inside a tenant-scoped transaction", () => {
      const probe = syntheticSource(`
        async persist(): Promise<void> {
          await runSagaTenantTransaction(this.config.prisma, accountId, async () => {
            await this.config.prisma.sagaInstance.upsert({ where: { id: "x" } });
          });
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([]);
    });

    it("accepts a READ inside a declared system boundary", () => {
      const probe = syntheticSource(`
        async load(): Promise<void> {
          await withSagaSystemRead(this.config.prisma, async () => {
            await this.config.prisma.sagaInstance.findMany({});
          });
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([]);
    });

    it("rejects a READ that no declared context encloses", () => {
      const probe = syntheticSource(`
        async load(): Promise<void> {
          await this.config.prisma.sagaInstance.findUnique({ where: { id: "x" } });
        }
      `);

      expect(classifyModelOperations([probe])).toEqual([
        "synthetic/SagaEngineProbe.ts:3: sagaInstance.findUnique reads outside any declared context",
      ]);
    });
  });

  describe("the engine opens no transaction outside the tenant primitives", () => {
    // Every transaction the engine runs must come from one of the two tenant
    // primitives, because each of them binds `app.account_id` as the FIRST
    // statement. A bare `prisma.$transaction` anywhere else is a transaction
    // that binds neither isolation layer — the shape the persistence path used
    // to fall back to when no account resolved. The classifier tolerates such a
    // site by design (an unscoped write fails loudly at the Prisma guard rather
    // than being waved through), so tolerance is not absence: this asserts the
    // absence, which is what makes "every engine write binds both layers" hold
    // without an asterisk.
    const TRANSACTION_PRIMITIVE_MODULE = "src/saga/sagaTenant.ts";

    const transactionSites = sagaSources.flatMap((source) => {
      const sites: string[] = [];
      const pattern = /\$transaction\s*\(/g;
      let match = pattern.exec(source.sanitized);
      while (match !== null) {
        sites.push(`${source.label}:${lineOf(source.original, match.index)}`);
        match = pattern.exec(source.sanitized);
      }
      return sites;
    });

    it("still sees the transactions the tenant primitives open", () => {
      // Non-vacuity: a scan that matched nothing would make the assertion below
      // pass while the engine grew any number of unscoped transactions.
      //
      // The floor is TWO because the module owns exactly two transaction
      // openers, one per direction of scope: `runSagaTenantTransaction` (the
      // saga's own account) and `runSagaSystemTransaction` (the system
      // sentinel, behind the narrow read and terminal-write surfaces). Fewer
      // than two means the pattern stopped seeing one of them.
      const TRANSACTION_OPENERS_IN_PRIMITIVE_MODULE = 2;
      const inPrimitiveModule = transactionSites.filter((site) =>
        site.startsWith(TRANSACTION_PRIMITIVE_MODULE)
      );
      expect(inPrimitiveModule.length).toBeGreaterThanOrEqual(
        TRANSACTION_OPENERS_IN_PRIMITIVE_MODULE
      );
    });

    it("opens none anywhere else in the engine", () => {
      const elsewhere = transactionSites.filter(
        (site) => !site.startsWith(TRANSACTION_PRIMITIVE_MODULE)
      );
      expect(elsewhere).toEqual([]);
    });
  });

  describe("the tenant module's export surface", () => {
    const tenantModule = sourceByName("sagaTenant.ts");
    const exports = exportedNames(tenantModule.original);

    it("does not export a general-purpose cross-tenant transaction", () => {
      // Exported, it is the cheapest way for any future engine write to opt out
      // of tenant scoping — the reuse hazard the narrow surfaces below replace.
      expect(exports).not.toContain("runSagaSystemTransaction");
    });

    it("exports only the two narrow cross-tenant surfaces instead", () => {
      expect(exports).toEqual(expect.arrayContaining(["withSagaSystemRead", "failSagaAsSystem"]));
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
      // The boot-load key states its intent positively: the extracted body must
      // be the METHOD, not `initialize()`'s call to it. A body that still
      // mentions `loadActiveSagas` is the caller, and every assertion below
      // would then pass against the wrong catch block.
      expect({
        bootLoadBodyIsNotTheCallSite: !bootLoadBody.includes("loadActiveSagas"),
        bootLoadReads: bootLoadBody.includes("findMany"),
        retryScan: retryScanBody.includes("findMany"),
        timeout: timeoutBody.includes("activeInstances"),
        shutdown: shutdownBody.includes("persistSagaInstance"),
        instanceLoad: instanceLoadBody.includes("findUnique"),
      }).toEqual({
        bootLoadBodyIsNotTheCallSite: true,
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

  describe("dedupe keys derive only from identity the durable row already carries", () => {
    // Complements the behavioural suite (`tests/unit/sagaDeterministicIds.test.ts`),
    // which proves a step re-executed IN ONE PROCESS emits the same command id.
    // That check cannot see a hidden input: a module-scoped nonce, a clock read
    // or a `randomUUID()` inside the template all survive it as long as two
    // calls land close enough together. A crash replay compares ids minted by
    // DIFFERENT processes, so the property that matters is structural — the key
    // is a pure function of the saga id and the step id, both of which the
    // persisted row carries — and structure is what this scan reads.
    const sharedSagaPath = join(apiRoot, "..", "..", "packages", "shared", "src", "saga.ts");
    const sharedSagaSource = readFileSync(sharedSagaPath, "utf8");
    const integration = sourceByName("SagaIntegration.ts");

    /** Non-deterministic sources a dedupe key must never read. */
    const NONDETERMINISM = /randomUUID|Math\.random|Date\.now|new Date\(/;

    /**
     * Every backtick template captured by `pattern`, verbatim. The ORIGINAL
     * text is read on purpose: `sanitize()` blanks literals, and here the
     * literal IS the subject.
     */
    function templateLiterals(source: string, pattern: RegExp): string[] {
      const found: string[] = [];
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match !== null) {
        found.push(match[1] ?? "");
        match = pattern.exec(source);
      }
      return found;
    }

    /** The expressions a template interpolates, in source order. */
    function interpolations(template: string): string[] {
      const found: string[] = [];
      const pattern = /\$\{([^}]*)\}/g;
      let match = pattern.exec(template);
      while (match !== null) {
        found.push((match[1] ?? "").trim());
        match = pattern.exec(template);
      }
      return found;
    }

    const commandIdTemplates = templateLiterals(sharedSagaSource, /\bid:\s*`([^`]*)`/g).sort();
    const queueDedupeTemplates = templateLiterals(
      integration.original,
      /\bconst\s+dedupeKey\s*=\s*`([^`]*)`/g
    ).sort();

    it("still sees the command ids the saga steps mint", () => {
      // Pinned as an exact set: a pattern that stops matching would turn every
      // assertion below vacuously green, which is how a source scan goes blind.
      //
      // The forward template appears TWICE and the multiplicity is load-bearing,
      // not a copy-paste slip: two different steps mint a forward command id
      // from the same expression (the create step and the post-pivot status
      // step). Collapsing this to a unique set would let one of them stop
      // deriving its id deterministically while the pin still passed.
      expect(commandIdTemplates).toEqual(
        [
          "cmd-${context.sagaId}-${this.id}",
          "cmd-${context.sagaId}-${this.id}",
          "cmd-${context.sagaId}-${this.id}-compensate",
        ].sort()
      );
    });

    it("derives every command id from the saga id and the step id alone", () => {
      const violations = commandIdTemplates
        .filter((template) =>
          interpolations(template).some(
            (expression) => expression !== "context.sagaId" && expression !== "this.id"
          )
        )
        .map((template) => `command id interpolates something else: \`${template}\``);

      expect(violations).toEqual([]);
    });

    it("distinguishes the compensating command by a literal suffix, never by a fresh value", () => {
      const compensating = commandIdTemplates.filter((template) =>
        template.endsWith("-compensate")
      );
      expect(compensating.length).toBeGreaterThan(0);

      const forward = commandIdTemplates.filter((template) => !template.endsWith("-compensate"));
      expect(forward.length).toBeGreaterThan(0);
      // The forward and the compensating key of the same step must differ, or a
      // compensation would collide with the command it undoes on the bus.
      expect(new Set(commandIdTemplates).size).toBeGreaterThan(1);
    });

    it("reads no clock and no randomness in any dedupe key", () => {
      const violations = [...commandIdTemplates, ...queueDedupeTemplates]
        .filter((template) => NONDETERMINISM.test(template))
        .map((template) => `dedupe key reads a non-deterministic source: \`${template}\``);

      expect(violations).toEqual([]);
    });

    it("keys the publish job on the post and the channel it targets", () => {
      // This key becomes the BullMQ job id, which is what makes a replayed
      // pivot a no-op instead of a second publish. Its inputs must therefore be
      // the target itself, not the attempt.
      expect(queueDedupeTemplates).toEqual(["publish-${postId}-${channelId}"]);

      const violations = queueDedupeTemplates
        .flatMap(interpolations)
        .filter((expression) => expression !== "postId" && expression !== "channelId");

      expect(violations).toEqual([]);
    });

    it("hands that key to the queue as the job's dedupe key", () => {
      // A derivation nothing passes through is decoration; the enqueue call is
      // where the key becomes the job id.
      expect(integration.sanitized).toMatch(/enqueue\(\{\s*\n?\s*dedupeKey,/);
    });
  });

  describe("the production composition wires recovery in a usable order", () => {
    const integration = sourceByName("SagaIntegration.ts");

    it("registers the saga definitions BEFORE the manager initializes", () => {
      // The boot recovery pass runs inside `sagaManager.initialize()` and asks
      // each inherited row's definition where its pivot is. Registering
      // afterwards left that map empty for the whole pass, so every inherited
      // saga was declined and recovery was inert in the deployed composition —
      // while every harness that registered first passed. The order is the
      // contract; this pins it where it cannot be re-inverted silently.
      const registerAt = integration.sanitized.indexOf("this.registerSagaDefinitions()");
      const initializeAt = integration.sanitized.indexOf("this.sagaManager.initialize()");

      expect(registerAt).toBeGreaterThanOrEqual(0);
      expect(initializeAt).toBeGreaterThanOrEqual(0);
      expect(registerAt).toBeLessThan(initializeAt);
    });

    it("wires the pivot's reread countermeasure, which is what makes a pivot re-entry safe", () => {
      // The retry checker legitimately claims a row whose last persist scheduled
      // a retry, and such a row can sit ON the pivot. What keeps that re-entry
      // from publishing twice is the pivot's RereadCheck, which aborts before
      // the enqueue when the aggregate has moved on — measured in
      // `tests/integration/sagaCrashRecovery.test.ts`, "an inherited pivot-step
      // retry claimed by the retry checker". The countermeasure only exists when
      // the composition passes the reread implementation, so a composition that
      // stopped passing it would silently remove the guarantee.
      const factoryCall = integration.sanitized.indexOf("createPostPublishingSagaDefinition(");
      expect(factoryCall).toBeGreaterThanOrEqual(0);

      expect(integration.sanitized).toMatch(/PostId\.fromString\(postIdRaw\)/);
      expect(integration.sanitized).toMatch(/postRepository\.findById/);
      expect(integration.sanitized).toMatch(/post\.value\.status\.value/);
    });
  });

  describe("forward execution and the compensation walk never both own a row", () => {
    const execution = sourceByName("SagaManagerExecution.ts");
    const lifecycle = sourceByName("SagaManagerLifecycle.ts");

    it("refuses a persisted COMPENSATING row inside executeSaga, ahead of every step", () => {
      // The invariant, verbatim: `executeSaga` SHALL REFUSE a row whose
      // persisted status is COMPENSATING — log + a counted compensation
      // failure, never a forward run. It has to be structural because the
      // consequence is silent: `runSagaSteps` sets RUNNING unconditionally and
      // re-runs the step whose failure triggered the undo, over state a partial
      // walk already reverted.
      const body = bodyWithLiterals(execution, "async executeSaga(");

      // On the DURABLE status, never on the instance in hand: `getSaga` answers
      // from the tracked set or from the Redis hot cache, which is written
      // fire-and-forget and which the engine is designed to survive losing — so
      // a pre-transition copy would let the refusal through.
      const readAt = body.indexOf("await this.readPersistedStatus(sagaId)");
      expect(readAt).toBeGreaterThanOrEqual(0);
      const refusalAt = body.indexOf('persistedStatus === "COMPENSATING"');
      expect(refusalAt).toBeGreaterThan(readAt);
      expect(body).not.toMatch(/if \(instance\.status === "COMPENSATING"\)/);

      // …and the refusal must sit BEFORE the only call that can advance it.
      const runAt = body.indexOf("this.runSagaSteps(");
      expect(runAt).toBeGreaterThan(refusalAt);

      // The refusal is counted, not merely logged: a saga nobody advances and
      // nobody counts is invisible on every dashboard.
      const refusalBlockEnd = body.indexOf("}", refusalAt);
      const refusalBlock = body.slice(refusalAt, refusalBlockEnd + 1);
      expect(refusalBlock).toContain('recordSagaRecoveryFailure("compensation")');
    });

    it("takes the status decision ahead of the retry marker in the boot disposition", () => {
      // A legacy row can carry BOTH a COMPENSATING status and a stale
      // `nextRetryAt`. Reading the marker first hands it to the retry scan,
      // which drives it FORWARD — the same defect through the other reader.
      const body = bodyWithLiterals(lifecycle, "private disposeLoadedSaga(");
      const statusAt = body.indexOf('instance.status === "COMPENSATING"');
      const retryAt = body.indexOf("instance.nextRetryAt !== undefined");

      expect(statusAt).toBeGreaterThanOrEqual(0);
      expect(retryAt).toBeGreaterThan(statusAt);
    });

    it("begins every compensation walk through the ONE durable transition", () => {
      // Every site that starts a walk is preceded by an awaited persist of
      // COMPENSATING, so no walk ever begins from a row whose persisted status
      // still says the saga is moving forward.
      expect(execution.sanitized).toMatch(/await this\.beginCompensation\(instance, errMsg\)/);
      expect(execution.sanitized).toMatch(/await this\.beginCompensation\(instance\)/);
      expect(lifecycle.sanitized).toMatch(/this\.executionEngine\.beginCompensation\(instance\)/);

      const transition = bodyWithLiterals(execution, "async beginCompensation(");
      expect(transition).toContain('instance.status = "COMPENSATING"');
      expect(transition).toContain("delete instance.nextRetryAt");
      expect(transition).toContain("await this.persistSagaInstance(");
    });
  });

  describe("the vocabulary an operator routes on says what the engine does", () => {
    const metricsPath = join(apiRoot, "src", "metrics", "sagaRecoveryMetrics.ts");
    const metrics = readFileSync(metricsPath, "utf8");
    const types = sourceByName("sagaManagerTypes.ts");
    const execution = sourceByName("SagaManagerExecution.ts");
    const lifecycle = sourceByName("SagaManagerLifecycle.ts");

    it("does not tell a scraper that nothing loads these rows", () => {
      // The HELP string renders on /metrics and in every metric browser. It
      // asserted the exact claim this engine disproves, which sends an operator
      // to the manual repair the engine already performed.
      const help = metrics.slice(
        metrics.indexOf('"saga_compensating_orphans"'),
        metrics.indexOf("collectCompensatingOrphans")
      );
      expect(help).not.toMatch(/no mechanism|does not resume|deliberately does not/i);
      expect(help).toMatch(/RESUMES|mid-rollback/i);
    });

    it("does not tell a reader of the metrics type that recovery is somebody else's", () => {
      const field = types.original.slice(
        types.original.indexOf("bootResumeRowFailures: number;"),
        types.original.indexOf("compensatingOrphans: number;")
      );
      expect(field).not.toMatch(
        /Detection only|deliberately does not resume|belongs to `saga-engine-terminal-hygiene`/i
      );
      expect(field).toMatch(/RESUMES/);
    });

    it("measures the level at scrape time rather than publishing it at boot", () => {
      // A level published only at boot cannot see the rows that appear between
      // boots — the population the automatic transition creates — and latches a
      // stale non-zero value for the life of the process.
      expect(metrics).toContain("setSagaCompensatingOrphansProvider");
      expect(lifecycle.sanitized).toContain("setSagaCompensatingOrphansProvider(");
      expect(lifecycle.sanitized).not.toContain("remeasureCompensatingOrphans");
    });

    it("gives the walk and the operator door one name each", () => {
      // `compensateSaga` meant two different operations on two collaborating
      // objects: a future dispatcher calling the wrong one gets an early return
      // where it expected a completed rollback.
      expect(execution.sanitized).toContain("async resumeCompensationWalk(");
      expect(execution.sanitized).toContain("resumeCompensationWalkAsync(");
      expect(execution.sanitized).not.toMatch(/\basync compensateSaga\(/);
      expect(execution.sanitized).not.toMatch(/\bcompensateSagaAsync\(/);
      // The operator-facing name stays where the operator's door is.
      expect(lifecycle.sanitized).toContain("async compensateSaga(");
    });

    it("keeps one walk per saga and says so to the operator", () => {
      expect(execution.sanitized).toContain("walksInFlight");
      const redrive = bodyWithLiterals(lifecycle, "async compensateSaga(");
      expect(redrive).toContain("isCompensationWalkInFlight(sagaId)");
      expect(redrive).toContain("AppError.conflict(");
    });

    it("discriminates a recorded compensation on a field the type system has", () => {
      // A cast-guarded branch on a field `SagaStepResult` does not declare was
      // dead code that tsc could not check, and a silent semantic switch the
      // day the union lands.
      expect(execution.sanitized).not.toContain("outcome?: string");
      expect(execution.sanitized).toContain("result?.success === true");
    });
  });

  describe("the orphan alert ships with the code that changed its meaning", () => {
    const alertsPath = join(apiRoot, "..", "..", "prometheus", "alerts", "saga.yml");
    const alerts = readFileSync(alertsPath, "utf8");

    /** The YAML block belonging to one alert, up to the next `- alert:`. */
    function alertBlock(name: string): string {
      const start = alerts.indexOf(`- alert: ${name}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = alerts.indexOf("- alert:", start + 1);
      return alerts.slice(start, next === -1 ? alerts.length : next);
    }

    it("no longer claims the engine cannot resume these rows", () => {
      const block = alertBlock("SagaCompensatingOrphans");
      // The premise the old rule rested on is exactly what this change
      // removed. Leaving the sentence would send an operator to a manual
      // repair the engine already performed.
      expect(block).not.toMatch(/does not resume|only DETECTS|no mechanism to finish/i);
      expect(block).toMatch(/resumes their walks|RESUMES/i);
    });

    it("distinguishes a stuck row from a walk in progress", () => {
      const block = alertBlock("SagaCompensatingOrphans");
      // `max(...) > 0` fires on any level, including the transient one a
      // correct resume produces; the FLOOR over a window is what needs the
      // level to have never drained.
      expect(block).toMatch(/min_over_time\(saga_compensating_orphans\[\d+m\]\) > 0/);
      expect(block).not.toContain("max(saga_compensating_orphans)");
    });

    it("is not satisfied by a walk that starts and finishes inside its window", () => {
      const block = alertBlock("SagaCompensatingOrphans");
      const windowMatch = /min_over_time\(saga_compensating_orphans\[(\d+)m\]\) > 0/.exec(block);
      const forMatch = /\n\s+for:\s*(\d+)m/.exec(block);
      expect(windowMatch).not.toBeNull();
      expect(forMatch).not.toBeNull();
      const windowMinutes = Number(windowMatch![1]);
      const forMinutes = Number(forMatch![1]);

      /** `min_over_time(series[window]) > 0` at the sample `endsAt`. */
      const expressionAt = (series: number[], endsAt: number): boolean =>
        Math.min(...series.slice(Math.max(0, endsAt - windowMinutes + 1), endsAt + 1)) > 0;

      /**
       * The rule as Prometheus evaluates it: the expression must hold at EVERY
       * sample of the `for` clause, not merely at the last one. Modelling the
       * window without the clause reports a firing threshold this rule does not
       * have.
       */
      const fires = (series: number[]): boolean => {
        for (let at = series.length - forMinutes; at < series.length; at++) {
          if (at < 0 || !expressionAt(series, at)) return false;
        }
        return true;
      };

      // A boot inherits three mid-undo rows and finishes all three: the scrape
      // that follows reports 0, and the floor of the window is 0 from then on.
      const transient = [0, 3, 0, ...Array<number>(windowMinutes + forMinutes).fill(0)];
      expect(fires(transient)).toBe(false);

      // A level that drains only once inside the window is still not a stuck
      // rollback, and this is the case a window-only model cannot see.
      const drainedOnce = [
        ...Array<number>(windowMinutes).fill(2),
        0,
        ...Array<number>(forMinutes).fill(2),
      ];
      expect(fires(drainedOnce)).toBe(false);

      // A rollback nobody can finish: no sample in the lookback OR the hold is
      // ever zero, which takes window + for minutes to establish.
      const stuck = Array<number>(windowMinutes + forMinutes).fill(2);
      expect(fires(stuck)).toBe(true);
    });

    it("states the threshold the rule really has, lookback included", () => {
      const block = alertBlock("SagaCompensatingOrphans");
      const windowMinutes = Number(
        /min_over_time\(saga_compensating_orphans\[(\d+)m\]\) > 0/.exec(block)![1]
      );
      const forMinutes = Number(/\n\s+for:\s*(\d+)m/.exec(block)![1]);

      // A description that quotes only the `for` clause understates the delay,
      // and one that quotes only the window overstates it. The rule pages after
      // both.
      expect(block).toContain(`${windowMinutes + forMinutes} minutes`);
    });

    it("carries the new failure stage into the loop alert", () => {
      const block = alertBlock("SagaRecoveryLoopFailing");
      expect(block).toMatch(/stage=~"[^"]*\bcompensation\b[^"]*"/);
    });

    it("alerts on a rollback that was terminalized unfinished", () => {
      // `compensation-expired` is a NEW terminal reason, and the timeout alert
      // matches `reason="timeout"` only — without its own rule the engine
      // would terminalize an unfinished rollback silently.
      const block = alertBlock("SagaCompensationExpired");
      expect(block).toContain('sagas_failed_total{reason="compensation-expired"}');
    });
  });

  describe("every saga suite is wired into the runner", () => {
    // A suite that belongs to no batch never runs under `test:all` or in CI, so
    // it protects nothing while reading as coverage. Unit suites are collected
    // by the Vitest phase from the whole `tests/unit` tree; the node:test
    // suites are named file by file, which is exactly where one gets forgotten.
    const runnerPath = join(apiRoot, "scripts", "run-tests.sh");
    const runner = readFileSync(runnerPath, "utf8");
    const testsRoot = join(apiRoot, "tests");

    const sagaSuites = getAllTsFiles(testsRoot)
      .map((path) => relative(apiRoot, path))
      .filter((path) => path.endsWith(".test.ts"))
      .filter((path) => /saga/i.test(path))
      .filter((path) => !path.startsWith(join("tests", "unit")))
      .sort();

    it("still finds the node:test saga suites on disk", () => {
      // Minimum + membership rather than an exact set: a NEW suite must fail
      // the wiring assertion below, not this one.
      expect(sagaSuites).toEqual(
        expect.arrayContaining([
          "tests/chaos/saga-step-retry-recovery.test.ts",
          "tests/integration/sagaCrashRecovery.test.ts",
          "tests/integration/sagaCustomerFlow.test.ts",
          "tests/integration/sagaTenantIsolation.test.ts",
        ])
      );
      expect(sagaSuites.length).toBeGreaterThanOrEqual(4);
    });

    it("lists every one of them explicitly in run-tests.sh", () => {
      const unwired = sagaSuites.filter((path) => !runner.includes(path));
      expect(unwired).toEqual([]);
    });
  });
});
