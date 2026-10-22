// @ts-check
/**
 * @file assertions.js
 * @description Reads one call of a test file's syntax tree as an assertion and gives it a class:
 *   TAUTOLOGY (it cannot fail), EXISTENCE (it restricts presence, type or truthiness only),
 *   SNAPSHOT, or BEHAVIOURAL (anything that restricts a value). The tree is TypeScript's own,
 *   built by `ts.createSourceFile`, and the reading is syntactic: no type checker, so a name says
 *   nothing about the type behind it.
 *
 *   Forms read: an `expect(...)` chain (`expect.soft`, `expect.poll`, and the `.not`, `.resolves`
 *   and `.rejects` modifiers), `expect.fail` and `expect.unreachable`, `expectTypeOf` and
 *   `assertType`, `assert(...)` and `assert.<method>(...)` under every local name `node:assert`
 *   or vitest's `assert` is imported as, a method imported from `node:assert` by name, and
 *   `<context>.assert.<method>(...)`, node:test's `t.assert`.
 *
 *   TAUTOLOGY: a literal against a literal (an object or array literal counts when every value in
 *   it is one), and `>= 0` or `> -1` over a value named length, size or count.
 *   EXISTENCE: `toBeDefined`; `not.toBeUndefined`, `not.toBeNull` and `not.toBe(undefined|null)`;
 *   `toBeTruthy`, `not.toBeFalsy` and `assert.ok` over an identifier, a member, a call or a `new`;
 *   `toBeInstanceOf`; `toHaveProperty` with one argument; `toBeTypeOf`, `expectTypeOf`,
 *   `assertType`; a `typeof`, `Array.isArray`, `instanceof`, `in`, `!!` or `!== undefined|null`
 *   test asserted true; an `expect.any` or `expect.anything` as the whole expected value;
 *   `toBeInTheDocument()` over a `querySelector` call or a `*ByRole` query with no options.
 *   One deliberate narrowing: a value named as a boolean predicate asserts a state, not a presence,
 *   and its truthiness is BEHAVIOURAL: a call of `includes`, `startsWith`, `has`, `some`, `test`
 *   and the like, and an identifier, member or call named `is…`, `has…`, `can…`, `should…`, ...
 *   (`comment.isDeleted()`, `notification.isRead`). `result.ok` stays EXISTENCE.
 *
 *   `readFact` reads what an assertion establishes when it passes, `result.ok` truthy after
 *   `expect(result.ok).toBe(true)`, so the block reader can tell a type-narrowing
 *   `if (!result.ok) return` from a guard.
 * @layer infrastructure
 */
import ts from "typescript";

/** The classes an assertion can carry; OPAQUE is given by the block reader to a helper it cannot see. */
export const ASSERTION_CLASS = Object.freeze(
  /** @type {const} */ ({
    TAUTOLOGY: "TAUTOLOGY",
    EXISTENCE: "EXISTENCE",
    SNAPSHOT: "SNAPSHOT",
    BEHAVIOURAL: "BEHAVIOURAL",
    OPAQUE: "OPAQUE",
  })
);

/**
 * @typedef {typeof ASSERTION_CLASS[keyof typeof ASSERTION_CLASS]} AssertionClass
 * @typedef {object} AssertionReading
 * @property {"expect" | "assert" | "type"} form
 * @property {string} name The matcher with its modifiers (`not.toBeNull`), or the assert method.
 * @property {AssertionClass} assertionClass
 * @property {boolean} throwEvidence Whether it asserts that something throws or rejects.
 * @typedef {object} ExpectChain
 * @property {string} opener `expect`, `expect.soft`, `expect.poll` or `expectTypeOf`.
 * @property {ts.Expression | undefined} subject
 * @property {string[]} modifiers
 * @property {string} matcher
 * @property {boolean} negated
 * @typedef {object} Fact What an assertion establishes about an expression, if it passes.
 * @property {string} subject The expression's source with whitespace and `!` removed.
 * @property {boolean} truthy
 * @typedef {object} AssertNames The local names under which assertions are imported.
 * @property {Set<string>} roots Names called directly or through a member: `assert`, `strict`.
 * @property {Map<string, string>} methods A method imported by name: local name to method.
 */

/**
 * @param {string} list Space-separated words.
 * @returns {Set<string>}
 */
const words = (list) => new Set(list.split(" "));

const CHAIN_MODIFIERS = new Set(["not", "resolves", "rejects"]);
const EXPECT_OPENERS = new Set(["expect", "expect.soft", "expect.poll"]);
const TRUTHY_MATCHERS = new Set(["toBeTruthy", "toBeDefined"]);
const FALSY_MATCHERS = new Set(["toBeFalsy", "toBeUndefined", "toBeNull"]);
const SNAPSHOT_MATCHERS = words(
  "toMatchSnapshot toMatchInlineSnapshot toMatchFileSnapshot toThrowErrorMatchingSnapshot toThrowErrorMatchingInlineSnapshot"
);
const EQUALITY_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);
const ASSERT_EQUALITY = words("equal strictEqual deepEqual deepStrictEqual partialDeepStrictEqual");
const ASSERT_INEQUALITY = words("notEqual notStrictEqual notDeepEqual notDeepStrictEqual");
const ASSERT_THROWS = new Set(["throws", "rejects", "fail"]);
const PREDICATE_METHODS = words("includes startsWith endsWith has some every test match equals");
const PREDICATE_NAME = /^(?:is|has|can|should|was|were|did|does|contains|matches)[A-Z_]/;
const SIZE_NAME = /(?:length|size|count)$/i;
const ROLE_QUERY = /^(?:get|query|find)(?:All)?ByRole$/;
const SELECTOR_QUERY = /^(?:querySelector|querySelectorAll|getElementsByTagName|closest)$/;

/**
 * @param {ts.Expression} node
 * @returns {ts.Expression} The expression under parentheses, casts, non-null assertions and
 *   `await`.
 */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @param {ts.Expression | undefined} value
 * @returns {boolean} Whether the value is fixed in the source: a literal, `undefined`, a signed
 *   number, or an array or object literal holding only those.
 */
function isLiteral(value) {
  if (value === undefined) return false;
  const node = unwrap(value);
  if (ts.isLiteralExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  const kind = node.kind;
  if (kind === ts.SyntaxKind.TrueKeyword || kind === ts.SyntaxKind.FalseKeyword) return true;
  if (kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(node)) return node.text === "undefined";
  if (ts.isPrefixUnaryExpression(node)) return isLiteral(node.operand);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every((element) => isLiteral(element));
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) => ts.isPropertyAssignment(property) && isLiteral(property.initializer)
    );
  }
  return false;
}

/**
 * @param {ts.Expression | undefined} value
 * @param {string[]} keywords
 * @returns {boolean} Whether the value is one of the keyword literals named (`true`, `null`, ...).
 */
function isWord(value, keywords) {
  if (value === undefined) return false;
  const node = unwrap(value);
  if (ts.isIdentifier(node)) return keywords.includes(node.text);
  const text = ts.tokenToString(node.kind);
  return text !== undefined && keywords.includes(text);
}

/**
 * @param {ts.Expression} value
 * @returns {string | null} The name a value is read by: an identifier, a member's name, or the
 *   called member of a call (`prisma.post.count()` is named `count`).
 */
function nameOf(value) {
  const node = unwrap(value);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isCallExpression(node)) return nameOf(node.expression);
  return null;
}

/**
 * @param {ts.Expression} value
 * @returns {boolean} Whether the value is `>= 0` or `> -1` over something named length, size or
 *   count, in either order: a comparison no such value can fail.
 */
function isNonNegativeSize(value) {
  const node = unwrap(value);
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  const sized = (/** @type {ts.Expression} */ side) => SIZE_NAME.test(nameOf(side) ?? "");
  const constant = (/** @type {ts.Expression} */ side, /** @type {string} */ text) =>
    unwrap(side).getText() === text;
  if (operator === ts.SyntaxKind.GreaterThanEqualsToken) {
    return sized(node.left) && constant(node.right, "0");
  }
  if (operator === ts.SyntaxKind.LessThanEqualsToken) {
    return constant(node.left, "0") && sized(node.right);
  }
  if (operator === ts.SyntaxKind.GreaterThanToken)
    return sized(node.left) && constant(node.right, "-1");
  if (operator === ts.SyntaxKind.LessThanToken)
    return constant(node.left, "-1") && sized(node.right);
  return false;
}

/**
 * @param {ts.Expression} value
 * @returns {boolean} Whether the value is a presence or type test that evaluates to a boolean:
 *   `typeof x === "..."`, `Array.isArray(x)`, `x instanceof Y`, `"k" in x`, `!!x`, `Boolean(x)`,
 *   or `x !== undefined` / `x != null`.
 */
function isPresenceTest(value) {
  const node = unwrap(value);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = unwrap(node.operand);
    return ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText();
    return callee === "Array.isArray" || callee === "Boolean";
  }
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.InstanceOfKeyword || operator === ts.SyntaxKind.InKeyword)
    return true;
  const typeOfSide =
    ts.isTypeOfExpression(unwrap(node.left)) || ts.isTypeOfExpression(unwrap(node.right));
  const equal =
    operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    operator === ts.SyntaxKind.EqualsEqualsToken;
  if (equal && typeOfSide) return true;
  const notEqual =
    operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    operator === ts.SyntaxKind.ExclamationEqualsToken;
  const nothing = ["undefined", "null"];
  return notEqual && (isWord(node.left, nothing) || isWord(node.right, nothing));
}

/**
 * @param {ts.Expression | undefined} value
 * @returns {boolean} Whether truthiness is all an assertion over the value can say: an
 *   identifier, a member, a `new`, or a call, unless it is named as a boolean predicate.
 */
function isPresenceSubject(value) {
  if (value === undefined) return false;
  const node = unwrap(value);
  const presence =
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isCallExpression(node);
  const name = nameOf(node) ?? "";
  return (
    presence &&
    !PREDICATE_NAME.test(name) &&
    !(ts.isCallExpression(node) && PREDICATE_METHODS.has(name))
  );
}

/**
 * @param {ts.Expression | undefined} value
 * @returns {boolean} Whether the value is `expect.any(...)` or `expect.anything()`.
 */
function isAnyMatcher(value) {
  if (value === undefined) return false;
  const node = unwrap(value);
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression.getText();
  return callee === "expect.any" || callee === "expect.anything";
}

/**
 * @param {ts.Expression | undefined} value
 * @returns {boolean} Whether the value is a DOM element looked up by selector or by a role alone.
 */
function isElementLookup(value) {
  if (value === undefined) return false;
  let node = unwrap(value);
  if (ts.isElementAccessExpression(node)) node = unwrap(node.expression);
  if (!ts.isCallExpression(node)) return false;
  const name = nameOf(node.expression) ?? "";
  if (SELECTOR_QUERY.test(name)) return true;
  return ROLE_QUERY.test(name) && node.arguments.length === 1;
}

/**
 * @param {ts.Expression | undefined} subject
 * @param {string} matcher
 * @param {boolean} negated
 * @param {readonly ts.Expression[]} args
 * @returns {AssertionClass}
 */
function classifyExpect(subject, matcher, negated, args) {
  if (SNAPSHOT_MATCHERS.has(matcher)) return ASSERTION_CLASS.SNAPSHOT;
  const [expected] = args;
  if (isLiteral(subject) && args.every((arg) => isLiteral(arg))) return ASSERTION_CLASS.TAUTOLOGY;
  if (subject === undefined) return ASSERTION_CLASS.BEHAVIOURAL;
  const truthy =
    (!negated &&
      (matcher === "toBeTruthy" ||
        (EQUALITY_MATCHERS.has(matcher) && isWord(expected, ["true"])))) ||
    (negated &&
      (matcher === "toBeFalsy" || (EQUALITY_MATCHERS.has(matcher) && isWord(expected, ["false"]))));
  const bound = expected === undefined ? null : unwrap(expected).getText();
  if (!negated && SIZE_NAME.test(nameOf(subject) ?? "")) {
    if (matcher === "toBeGreaterThanOrEqual" && bound === "0") return ASSERTION_CLASS.TAUTOLOGY;
    if (matcher === "toBeGreaterThan" && bound === "-1") return ASSERTION_CLASS.TAUTOLOGY;
  }
  if (truthy && isNonNegativeSize(subject)) return ASSERTION_CLASS.TAUTOLOGY;
  if (truthy && isPresenceTest(subject)) return ASSERTION_CLASS.EXISTENCE;
  const plainTruthy =
    (!negated && matcher === "toBeTruthy") || (negated && matcher === "toBeFalsy");
  if (plainTruthy && isPresenceSubject(subject)) return ASSERTION_CLASS.EXISTENCE;
  if (negated) {
    const nothing = ["undefined", "null"];
    const absent = matcher === "toBeUndefined" || matcher === "toBeNull";
    const equalsNothing = EQUALITY_MATCHERS.has(matcher) && isWord(expected, nothing);
    return absent || equalsNothing ? ASSERTION_CLASS.EXISTENCE : ASSERTION_CLASS.BEHAVIOURAL;
  }
  if (matcher === "toBeDefined" || matcher === "toBeInstanceOf" || matcher === "toBeTypeOf") {
    return ASSERTION_CLASS.EXISTENCE;
  }
  if (matcher === "toHaveProperty" && args.length === 1) return ASSERTION_CLASS.EXISTENCE;
  if (matcher === "toBeInTheDocument" && isElementLookup(subject)) return ASSERTION_CLASS.EXISTENCE;
  if (EQUALITY_MATCHERS.has(matcher)) {
    if (ts.isTypeOfExpression(unwrap(subject))) return ASSERTION_CLASS.EXISTENCE;
    if (isAnyMatcher(expected)) return ASSERTION_CLASS.EXISTENCE;
  }
  return ASSERTION_CLASS.BEHAVIOURAL;
}

/**
 * @param {ts.Expression | undefined} value The argument of `assert(...)` or `assert.ok(...)`.
 * @returns {AssertionClass}
 */
function classifyTruthy(value) {
  if (value === undefined) return ASSERTION_CLASS.BEHAVIOURAL;
  if (isLiteral(value) || isNonNegativeSize(value)) return ASSERTION_CLASS.TAUTOLOGY;
  if (isPresenceTest(value) || isPresenceSubject(value)) return ASSERTION_CLASS.EXISTENCE;
  return ASSERTION_CLASS.BEHAVIOURAL;
}

/**
 * @param {string} method An `assert` method name.
 * @param {readonly ts.Expression[]} args
 * @returns {AssertionClass}
 */
function classifyAssert(method, args) {
  const [actual, expected] = args;
  if (method === "ok") return classifyTruthy(actual);
  if (method === "snapshot" || method === "fileSnapshot") return ASSERTION_CLASS.SNAPSHOT;
  const pair = ASSERT_EQUALITY.has(method) || ASSERT_INEQUALITY.has(method);
  if (!pair || actual === undefined || expected === undefined) return ASSERTION_CLASS.BEHAVIOURAL;
  if (isLiteral(actual) && isLiteral(expected)) return ASSERTION_CLASS.TAUTOLOGY;
  if (ASSERT_INEQUALITY.has(method)) {
    const nothing = ["undefined", "null"];
    return isWord(actual, nothing) || isWord(expected, nothing)
      ? ASSERTION_CLASS.EXISTENCE
      : ASSERTION_CLASS.BEHAVIOURAL;
  }
  for (const [side, other] of [
    [actual, expected],
    [expected, actual],
  ]) {
    if (side === undefined || other === undefined) continue;
    if (ts.isTypeOfExpression(unwrap(side)) && isLiteral(other)) return ASSERTION_CLASS.EXISTENCE;
    if (isWord(other, ["true"]) && isNonNegativeSize(side)) return ASSERTION_CLASS.TAUTOLOGY;
    if (isWord(other, ["true"]) && isPresenceTest(side)) return ASSERTION_CLASS.EXISTENCE;
  }
  return ASSERTION_CLASS.BEHAVIOURAL;
}

/**
 * @param {ts.CallExpression} call
 * @returns {ExpectChain | null} The call read as `<opener>(subject)[.modifier]*.matcher(args)`.
 */
function expectChain(call) {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  /** @type {string[]} */
  const modifiers = [];
  let current = callee.expression;
  while (ts.isPropertyAccessExpression(current) && CHAIN_MODIFIERS.has(current.name.text)) {
    modifiers.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isCallExpression(current)) return null;
  return {
    opener: current.expression.getText(),
    subject: current.arguments[0],
    modifiers,
    matcher: callee.name.text,
    negated: modifiers.filter((modifier) => modifier === "not").length % 2 === 1,
  };
}

/**
 * @param {ts.CallExpression} call
 * @returns {AssertionReading | null} The call read as an `expect` chain or a type assertion.
 */
function readExpect(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && callee.text === "assertType") {
    return {
      form: "type",
      name: callee.text,
      assertionClass: ASSERTION_CLASS.EXISTENCE,
      throwEvidence: false,
    };
  }
  const ender = ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
  if (ts.isPropertyAccessExpression(callee) && callee.expression.getText() === "expect") {
    if (ender === "fail" || ender === "unreachable") {
      const name = `expect.${ender}`;
      return {
        form: "expect",
        name,
        assertionClass: ASSERTION_CLASS.BEHAVIOURAL,
        throwEvidence: true,
      };
    }
  }
  const chain = expectChain(call);
  if (chain === null) return null;
  const name = [...chain.modifiers, chain.matcher].join(".");
  if (chain.opener === "expectTypeOf") {
    return { form: "type", name, assertionClass: ASSERTION_CLASS.EXISTENCE, throwEvidence: false };
  }
  if (!EXPECT_OPENERS.has(chain.opener)) return null;
  const throwEvidence = chain.matcher.startsWith("toThrow") || chain.modifiers.includes("rejects");
  const assertionClass = classifyExpect(
    chain.subject,
    chain.matcher,
    chain.negated,
    call.arguments
  );
  return { form: "expect", name, assertionClass, throwEvidence };
}

/**
 * @param {ts.CallExpression} call
 * @param {AssertNames} names
 * @returns {string | null} The assert method the call invokes, or `null` when it is not one.
 */
function assertMethodOf(call, names) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    if (names.roots.has(callee.text)) return "ok";
    return names.methods.get(callee.text) ?? null;
  }
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const owner = callee.expression;
  if (ts.isIdentifier(owner) && names.roots.has(owner.text)) return callee.name.text;
  if (ts.isPropertyAccessExpression(owner)) {
    const base = owner.expression;
    if (owner.name.text === "assert" && ts.isIdentifier(base)) return callee.name.text;
    if (owner.name.text === "strict" && ts.isIdentifier(base) && names.roots.has(base.text)) {
      return callee.name.text;
    }
  }
  return null;
}

/**
 * @description Reads a call as an assertion and classifies it.
 * @param {ts.CallExpression} call A call of a test file's syntax tree, with parent pointers.
 * @param {AssertNames} names The local names under which assertions are imported.
 * @returns {AssertionReading | null} The reading, or `null` when the call asserts nothing itself.
 */
export function readAssertion(call, names) {
  const expectReading = readExpect(call);
  if (expectReading !== null) return expectReading;
  const method = assertMethodOf(call, names);
  if (method === null) return null;
  return {
    form: "assert",
    name: method,
    assertionClass: classifyAssert(method, call.arguments),
    throwEvidence: ASSERT_THROWS.has(method),
  };
}

/**
 * @param {ts.Expression} subject
 * @param {boolean} truthy
 * @returns {Fact} The fact, with every leading `!` folded into its truthiness.
 */
function factAbout(subject, truthy) {
  let node = unwrap(subject);
  let value = truthy;
  while (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    node = unwrap(node.operand);
    value = !value;
  }
  return { subject: node.getText().replace(/\s+/g, ""), truthy: value };
}

/**
 * @description Reads what an assertion establishes about the truthiness of an expression, so a
 *   later `if (!result.ok) return` that only narrows a type can be told from a real guard.
 * @param {ts.CallExpression} call
 * @param {AssertNames} names
 * @returns {Fact | null} The fact, or `null` when the call establishes none.
 */
export function readFact(call, names) {
  const chain = expectChain(call);
  if (chain !== null && EXPECT_OPENERS.has(chain.opener) && chain.subject !== undefined) {
    const [expected] = call.arguments;
    const equality = EQUALITY_MATCHERS.has(chain.matcher);
    /** @type {boolean | null} */
    let truthy = null;
    if (TRUTHY_MATCHERS.has(chain.matcher) || (equality && isWord(expected, ["true"])))
      truthy = true;
    if (
      FALSY_MATCHERS.has(chain.matcher) ||
      (equality && isWord(expected, ["false", "undefined", "null"]))
    ) {
      truthy = false;
    }
    if (truthy === null) return null;
    return factAbout(chain.subject, chain.negated ? !truthy : truthy);
  }
  const method = assertMethodOf(call, names);
  const [actual, expected] = call.arguments;
  if (method === null || actual === undefined) return null;
  if (method === "ok") return factAbout(actual, true);
  if (ASSERT_EQUALITY.has(method) && isWord(expected, ["true"])) return factAbout(actual, true);
  if (ASSERT_EQUALITY.has(method) && isWord(expected, ["false"])) return factAbout(actual, false);
  if (ASSERT_INEQUALITY.has(method) && isWord(expected, ["undefined", "null"]))
    return factAbout(actual, true);
  return null;
}
