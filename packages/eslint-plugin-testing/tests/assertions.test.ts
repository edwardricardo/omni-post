/**
 * @file assertions.test.ts
 * @description Table-driven suite for `src/assertions.js`, the assertion reader of the classifier.
 *              Each row is one call, parsed with `ts.createSourceFile` exactly as a test file is,
 *              and pins what `readAssertion` makes of it (form, name, class, whether it checks a
 *              throw) or what `readFact` says it establishes when it passes. The rows cover every
 *              form the reader knows, in both frameworks: vitest's `expect` chains and node:test's
 *              `assert` and `t.assert`; a positive and a near-miss for every class; and the calls
 *              that assert nothing by themselves.
 * @layer infrastructure
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ASSERTION_CLASS, readAssertion, readFact } from "../src/assertions.js";

type Names = { roots: Set<string>; methods: Map<string, string> };

const DEFAULT_NAMES: Names = { roots: new Set(["assert"]), methods: new Map() };
const IMPORTED_NAMES: Names = {
  roots: new Set(["assert", "strict"]),
  methods: new Map([
    ["equal", "equal"],
    ["ok", "ok"],
  ]),
};

const { TAUTOLOGY, EXISTENCE, SNAPSHOT, BEHAVIOURAL } = ASSERTION_CLASS;

/** The first statement of `code` read as a call; an `await` in front of it is looked through. */
const callOf = (code: string): ts.CallExpression => {
  const file = ts.createSourceFile("row.test.ts", code, ts.ScriptTarget.Latest, true);
  const [statement] = file.statements;
  if (statement === undefined || !ts.isExpressionStatement(statement)) {
    throw new Error(`not an expression statement: ${code}`);
  }
  const expression = ts.isAwaitExpression(statement.expression)
    ? statement.expression.expression
    : statement.expression;
  if (!ts.isCallExpression(expression)) throw new Error(`not a call: ${code}`);
  return expression;
};

type Row = [code: string, assertionClass: string, name: string, form?: string, thrown?: boolean];

const reading = ([code, assertionClass, name, form = "expect", thrown = false]: Row) => ({
  code,
  expected: { form, name, assertionClass, throwEvidence: thrown },
});

const TABLE: Record<string, Row[]> = {
  "TAUTOLOGY: a literal against a literal, or `>= 0` over a length, size or count": [
    ["expect(true).toBe(true)", TAUTOLOGY, "toBe"],
    ['expect({ level: "warning" }).toEqual({ level: "warning" })', TAUTOLOGY, "toEqual"],
    ["expect(1).toBeTruthy()", TAUTOLOGY, "toBeTruthy"],
    ["expect(retriedCount >= 0).toBeTruthy()", TAUTOLOGY, "toBeTruthy"],
    ["expect(handler.queue.length).toBeGreaterThanOrEqual(0)", TAUTOLOGY, "toBeGreaterThanOrEqual"],
    ["expect(cache.size).toBeGreaterThan(-1)", TAUTOLOGY, "toBeGreaterThan"],
    ["assert.ok(true)", TAUTOLOGY, "ok", "assert"],
    ["assert.equal(1, 1)", TAUTOLOGY, "equal", "assert"],
    ["assert(0 <= rows.length)", TAUTOLOGY, "ok", "assert"],
    ["t.assert.ok(count >= 0)", TAUTOLOGY, "ok", "assert"],
    ["assert.strictEqual(items.length >= 0, true)", TAUTOLOGY, "strictEqual", "assert"],
  ],
  "EXISTENCE: presence, type or truthiness only": [
    ["expect(user).toBeDefined()", EXISTENCE, "toBeDefined"],
    ["expect(user).not.toBeNull()", EXISTENCE, "not.toBeNull"],
    ["expect(user).not.toBeUndefined()", EXISTENCE, "not.toBeUndefined"],
    ["expect(user).not.toBe(undefined)", EXISTENCE, "not.toBe"],
    ["expect(user).toBeTruthy()", EXISTENCE, "toBeTruthy"],
    ["expect(user).not.toBeFalsy()", EXISTENCE, "not.toBeFalsy"],
    ['expect(await find("u1")).toBeTruthy()', EXISTENCE, "toBeTruthy"],
    ["expect(new Client()).toBeTruthy()", EXISTENCE, "toBeTruthy"],
    ["expect(user).toBeInstanceOf(User)", EXISTENCE, "toBeInstanceOf"],
    ['expect(user).toHaveProperty("email")', EXISTENCE, "toHaveProperty"],
    ['expect(user.name).toBeTypeOf("string")', EXISTENCE, "toBeTypeOf"],
    ['expect(typeof user.name).toBe("string")', EXISTENCE, "toBe"],
    ["expect(Array.isArray(user.roles)).toBe(true)", EXISTENCE, "toBe"],
    ["expect(!!user).toBe(true)", EXISTENCE, "toBe"],
    ["expect(user !== undefined).toBeTruthy()", EXISTENCE, "toBeTruthy"],
    ["expect(user.id).toEqual(expect.any(String))", EXISTENCE, "toEqual"],
    ['expect(container.querySelector("form")).toBeInTheDocument()', EXISTENCE, "toBeInTheDocument"],
    ['expect(screen.getByRole("button")).toBeInTheDocument()', EXISTENCE, "toBeInTheDocument"],
    ["expect.soft(user).toBeDefined()", EXISTENCE, "toBeDefined"],
    ["expectTypeOf(user).toEqualTypeOf<User>()", EXISTENCE, "toEqualTypeOf", "type"],
    ["assertType<User>(user)", EXISTENCE, "assertType", "type"],
    ["assert.ok(user)", EXISTENCE, "ok", "assert"],
    ["assert(result.ok)", EXISTENCE, "ok", "assert"],
    ["assert.notEqual(user, null)", EXISTENCE, "notEqual", "assert"],
    ['assert.equal(typeof user.name, "string")', EXISTENCE, "equal", "assert"],
    ['assert.ok("email" in user)', EXISTENCE, "ok", "assert"],
    ["t.assert.ok(user.roles instanceof Array)", EXISTENCE, "ok", "assert"],
  ],
  SNAPSHOT: [
    ["expect(html).toMatchSnapshot()", SNAPSHOT, "toMatchSnapshot"],
    ["expect(html).toMatchInlineSnapshot()", SNAPSHOT, "toMatchInlineSnapshot"],
    ["t.assert.snapshot(html)", SNAPSHOT, "snapshot", "assert"],
    ["t.assert.fileSnapshot(html, path)", SNAPSHOT, "fileSnapshot", "assert"],
  ],
  "BEHAVIOURAL: a value restricted, the near-miss of every class above": [
    ['expect(user.email).toBe("a@b.c")', BEHAVIOURAL, "toBe"],
    ['expect(user).toHaveProperty("email", "a@b.c")', BEHAVIOURAL, "toHaveProperty"],
    ["expect(handler.queue.length).toBeGreaterThan(0)", BEHAVIOURAL, "toBeGreaterThan"],
    ["expect(retriedCount).toBe(1)", BEHAVIOURAL, "toBe"],
    ["expect(user).toBeNull()", BEHAVIOURAL, "toBeNull"],
    ["expect(user).toBeUndefined()", BEHAVIOURAL, "toBeUndefined"],
    ["expect(user).not.toBeInTheDocument()", BEHAVIOURAL, "not.toBeInTheDocument"],
    [
      'expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument()',
      BEHAVIOURAL,
      "toBeInTheDocument",
    ],
    ['expect(screen.getByText("Saved")).toBeInTheDocument()', BEHAVIOURAL, "toBeInTheDocument"],
    ["expect(comment.isDeleted()).toBeTruthy()", BEHAVIOURAL, "toBeTruthy"],
    ["expect(notification.isRead).toBeTruthy()", BEHAVIOURAL, "toBeTruthy"],
    ['expect(text.includes("x")).toBeTruthy()', BEHAVIOURAL, "toBeTruthy"],
    ["expect(isValid(token)).toBe(true)", BEHAVIOURAL, "toBe"],
    ["expect.poll(() => queue.size()).toBe(1)", BEHAVIOURAL, "toBe"],
    ['assert.ok(roles.includes("admin"))', BEHAVIOURAL, "ok", "assert"],
    ["assert.ok(!result.ok)", BEHAVIOURAL, "ok", "assert"],
    ["assert.ok(rows.length > 0)", BEHAVIOURAL, "ok", "assert"],
    ['assert.equal(user.email, "a@b.c")', BEHAVIOURAL, "equal", "assert"],
    ["assert.deepStrictEqual(rows, [])", BEHAVIOURAL, "deepStrictEqual", "assert"],
    ["assert.match(text, /saved/)", BEHAVIOURAL, "match", "assert"],
    ['t.assert.strictEqual(result.value.kind, "image")', BEHAVIOURAL, "strictEqual", "assert"],
  ],
  "a throw or a rejection, checked": [
    ["expect(() => run()).toThrow(Error)", BEHAVIOURAL, "toThrow", "expect", true],
    ["await expect(load()).rejects.toThrow()", BEHAVIOURAL, "rejects.toThrow", "expect", true],
    [
      "await expect(load()).rejects.toBeInstanceOf(AppError)",
      EXISTENCE,
      "rejects.toBeInstanceOf",
      "expect",
      true,
    ],
    [
      "expect(() => run()).toThrowErrorMatchingSnapshot()",
      SNAPSHOT,
      "toThrowErrorMatchingSnapshot",
      "expect",
      true,
    ],
    ['expect.fail("expected a throw")', BEHAVIOURAL, "expect.fail", "expect", true],
    ["expect.unreachable()", BEHAVIOURAL, "expect.unreachable", "expect", true],
    ["assert.throws(() => run(), /secret/)", BEHAVIOURAL, "throws", "assert", true],
    ["await assert.rejects(load())", BEHAVIOURAL, "rejects", "assert", true],
    ['assert.fail("expected a throw")', BEHAVIOURAL, "fail", "assert", true],
  ],
};

describe("readAssertion", () => {
  for (const [group, rows] of Object.entries(TABLE)) {
    describe(group, () => {
      it.each(rows.map(reading))("$code", ({ code, expected }) => {
        expect(readAssertion(callOf(code), DEFAULT_NAMES)).toEqual(expected);
      });
    });
  }

  describe("names an assertion is imported under", () => {
    it.each([
      ['strict.equal(user.email, "a@b.c")', "equal", BEHAVIOURAL],
      ["assert.strict.equal(count, 1)", "equal", BEHAVIOURAL],
      ['equal(user.email, "a@b.c")', "equal", BEHAVIOURAL],
      ["ok(user)", "ok", EXISTENCE],
    ])("%s reads as assert.%s", (code, name, assertionClass) => {
      expect(readAssertion(callOf(code), IMPORTED_NAMES)).toEqual({
        form: "assert",
        name,
        assertionClass,
        throwEvidence: false,
      });
    });

    it("does not read a method imported by name unless the file imports it", () => {
      expect(readAssertion(callOf("ok(user)"), DEFAULT_NAMES)).toBeNull();
    });
  });

  describe("calls that assert nothing by themselves", () => {
    it.each([
      "expect(user)",
      "expect.any(String)",
      "expect.assertions(1)",
      "expectTypeOf(user)",
      "vi.fn()",
      "service.check(user)",
      "checkRateLimit(request)",
    ])("%s", (code) => {
      expect(readAssertion(callOf(code), DEFAULT_NAMES)).toBeNull();
    });
  });
});

describe("readFact", () => {
  it.each([
    ["expect(result.ok).toBe(true)", "result.ok", true],
    ["expect(result.ok).toBeTruthy()", "result.ok", true],
    ["expect(user).toBeDefined()", "user", true],
    ["expect(user).not.toBeNull()", "user", true],
    ["expect(result.ok).toBe(false)", "result.ok", false],
    ["expect(result.error).toBeUndefined()", "result.error", false],
    ["expect(!result.ok).toBe(true)", "result.ok", false],
    ["assert.ok(result.ok)", "result.ok", true],
    ["assert(!saved)", "saved", false],
    ["assert.equal(result.ok, false)", "result.ok", false],
    ["assert.strictEqual(result.ok, true)", "result.ok", true],
    ["assert.notEqual(user, undefined)", "user", true],
    ["expect(result\n  .ok).toBe(true)", "result.ok", true],
  ])("%s establishes %s truthy=%s", (code, subject, truthy) => {
    expect(readFact(callOf(code), DEFAULT_NAMES)).toEqual({ subject, truthy });
  });

  it.each([
    'expect(user.email).toBe("a@b.c")',
    "assert.equal(a, b)",
    "expect(html).toMatchSnapshot()",
    "service.check(user)",
  ])("%s establishes nothing about truthiness", (code) => {
    expect(readFact(callOf(code), DEFAULT_NAMES)).toBeNull();
  });
});
