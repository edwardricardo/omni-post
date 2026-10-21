// @ts-check
/**
 * @file classify.js
 * @description `classifyFile(text, fileName)`: every test block `blocks.js` finds, with its
 *   assertions, its class and the criterion of the demolition plan the class falls under.
 *   Syntactic only, like the modules it builds on: a call is judged by its name.
 *
 *   Assertions are read by `assertions.js`, plus a `throw` statement written in the block's own
 *   body, outside any function nested in it: a throw in an inlined helper or in a stub's method
 *   checks nothing of the block's. A same-file helper the block calls, resolved lexically to the
 *   nearest declaration of its name in scope (a parameter of that name hides it), is inlined one
 *   level, with the call site's conditions; one level further down a helper that asserts is
 *   OPAQUE. An imported helper named
 *   `expect*`, `assert*`, `verify*` or `check*` is OPAQUE when its module is test code (a relative
 *   path outside `src/`, or a path that names `test`); so is a method named `expect…` or `assert…`
 *   on any receiver (a page object's), and a callback passed by name.
 *
 *   An assertion is CONDITIONAL inside an `if` branch, a `?:` branch, the right side of `&&`, `||`
 *   or `??`, a `switch` case, a `catch` clause or a `.catch(...)` callback, and GUARDED-RETURN
 *   after an `if` that can return early at the block's own control level (a `return` inside a
 *   nested function, method or class is not one). An `if` whose condition earlier unconditional
 *   assertions already decided is neither: after `expect(result.ok).toBe(true)`,
 *   `if (!result.ok) return` only narrows a type. A condition is decided operand by operand
 *   through `!`, `&&` and `||`, `=== null`, `== null`, `!== undefined` and the like over a value
 *   asserted present, and `typeof x === "..."` over a value whose type was asserted. A block that
 *   calls `expect.assertions(n)` or `expect.hasAssertions()` fails when its catch path does not
 *   run, so its `catch` and `.catch(...)` assertions are not CONDITIONAL.
 *
 *   Block classes, the first that applies: SELF-SKIP (any skip marker `blocks.js` reports); with no
 *   assertion, PRINTS-SUCCESS when it prints success, else EMPTY; TITLE-CONTRADICTION;
 *   BEHAVIOURAL when an unconditional assertion restricts a value or a snapshot, or any assertion
 *   is opaque; PRINTS-SUCCESS when a success print comes after the last assertion;
 *   TAUTOLOGY-ONLY; CONDITIONAL-ONLY when nothing unconditional but tautologies is left;
 *   EXISTENCE-ONLY. A success print matches /pass|success|✅|🎉|operational|fully functional|all
 *   tests/i, with `pass` read as a word (`passed`, not `password`) and `success` at a word start
 *   (`successfully`, not `unsuccessful`).
 *
 *   Output is deterministic: blocks and assertions in source order, no timestamps. A file the
 *   classifier cannot read (its syntax nests deeper than the call stack) is never a throw: it
 *   comes back with no block and its error as a string.
 * @layer infrastructure
 */
import ts from "typescript";
import { ASSERTION_CLASS, readAssertion, readFact } from "./assertions.js";
import { discoverBlocks } from "./blocks.js";

/** The class of a reported block. */
export const BLOCK_CLASS = Object.freeze(
  /** @type {const} */ ({
    EMPTY: "EMPTY",
    TAUTOLOGY_ONLY: "TAUTOLOGY-ONLY",
    EXISTENCE_ONLY: "EXISTENCE-ONLY",
    CONDITIONAL_ONLY: "CONDITIONAL-ONLY",
    SELF_SKIP: "SELF-SKIP",
    PRINTS_SUCCESS: "PRINTS-SUCCESS",
    TITLE_CONTRADICTION: "TITLE-CONTRADICTION",
    BEHAVIOURAL: "BEHAVIOURAL",
  })
);

/**
 * The demolition plan's criteria by block class: (a) restricts no behaviour, (c) skips itself,
 * (d) cannot fail by construction. A title contradiction goes to a human and names none.
 */
export const CRITERIA = Object.freeze({
  [BLOCK_CLASS.EMPTY]: Object.freeze(["a"]),
  [BLOCK_CLASS.EXISTENCE_ONLY]: Object.freeze(["a"]),
  [BLOCK_CLASS.SELF_SKIP]: Object.freeze(["c"]),
  [BLOCK_CLASS.TAUTOLOGY_ONLY]: Object.freeze(["d"]),
  [BLOCK_CLASS.CONDITIONAL_ONLY]: Object.freeze(["d"]),
  [BLOCK_CLASS.PRINTS_SUCCESS]: Object.freeze(["d"]),
  [BLOCK_CLASS.TITLE_CONTRADICTION]: Object.freeze([]),
  [BLOCK_CLASS.BEHAVIOURAL]: Object.freeze([]),
});

/**
 * @typedef {import("./assertions.js").AssertionClass} AssertionClass
 * @typedef {import("./assertions.js").AssertNames} AssertNames
 * @typedef {import("./blocks.js").Binding} Binding
 * @typedef {import("./blocks.js").BlockKind} BlockKind
 * @typedef {import("./blocks.js").Framework} Framework
 * @typedef {import("./blocks.js").LeafBlock} LeafBlock
 * @typedef {import("./blocks.js").Location} Location
 * @typedef {typeof BLOCK_CLASS[keyof typeof BLOCK_CLASS]} BlockClass
 * @typedef {"CONDITIONAL" | "GUARDED-RETURN"} Flag
 * @typedef {ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration} FunctionNode
 *
 * @typedef {object} AssertionFinding
 * @property {number} line 1-based, where the assertion is written (inside a helper when inlined).
 * @property {number} col
 * @property {"expect" | "assert" | "type" | "helper" | "throw"} form
 * @property {string} name
 * @property {AssertionClass} assertionClass
 * @property {Flag[]} flags
 * @property {string | null} via The same-file helper it was inlined from.
 *
 * @typedef {object} BlockFinding
 * @property {string} id `file:line:title`.
 * @property {Framework} framework
 * @property {BlockKind} kind
 * @property {string} title
 * @property {string[]} describe The titles of the containers around it, outermost first.
 * @property {Location} loc
 * @property {string[]} modifiers As written: `["concurrent", "each"]`.
 * @property {string[]} skips Why it skips: a modifier, `option:skip`, `parent:<marker>`, `context.skip`.
 * @property {string} bodyHash sha256 of the body's tokens, blind to whitespace and comments.
 * @property {AssertionFinding[]} assertions
 * @property {BlockClass} blockClass
 * @property {Flag[]} flags Every flag its assertions carry.
 * @property {readonly string[]} criteria
 * @property {string | null} contradiction Why a TITLE-CONTRADICTION block is one.
 * @property {boolean} opaque Whether an assertion is a helper the classifier cannot see.
 * @property {number[]} successPrints The lines of its success prints.
 *
 * @typedef {object} FileClassification
 * @property {string} path
 * @property {Framework | null} framework `null` when the file could not be read.
 * @property {BlockFinding[]} blocks
 * @property {string[]} opaqueHelpers
 * @property {string | null} fileContextHash sha256 of the file with every reported block's body
 *   removed; `null` when the file could not be read.
 * @property {string | null} error Why the file could not be read (`RangeError: Maximum call stack
 *   size exceeded`), else `null`.
 *
 * @typedef {object} FileContext
 * @property {ts.SourceFile} sourceFile
 * @property {AssertNames} assertNames
 * @property {Map<string, string>} imports Every other imported local name to its module.
 * @property {Map<string, Declaration[]>} helpers Every same-file declaration of each name.
 *
 * @typedef {object} Declaration A same-file binding a helper call may resolve to.
 * @property {ts.Node} scope The block, clause, statement or file whose code the binding is
 *   visible in.
 * @property {FunctionNode | null} fn The function it binds, or `null` for any other value.
 *
 * @typedef {object} Site Where a same-file helper is called from, and the flags it is called under.
 * @property {number} position
 * @property {Set<Flag>} flags
 * @property {boolean} inCatch
 * @property {string} text
 * @property {string} via
 *
 * @typedef {import("./assertions.js").Fact & { position: number }} PositionedFact
 *
 * @typedef {object} Collected
 * @property {AssertionFinding} finding
 * @property {number} position The source position, the call site's for an inlined assertion.
 * @property {boolean} throwEvidence
 * @property {string} text The assertion's source, and the call site's for an inlined one.
 */

const FRAMEWORK_MODULES = new Set(["node:test", "test", "vitest"]);
const ASSERT_MODULES = new Set(["assert", "node:assert", "assert/strict", "node:assert/strict"]);
const HELPER_NAME = /^(?:expect|assert|verify|check)/;
const ASSERTING_METHOD = /^(?:expect|assert)[A-Z_]/;
const SUCCESS_PRINT =
  /\bpass(?:ed|es|ing)?\b|\bsuccess|✅|🎉|\boperational\b|fully functional|all tests/i;
const RETURNS_NOTHING = /\breturns?\s+(?:an?\s+)?(?:undefined|null)\b/i;
const NEGATIVE_TITLE = /\b(?:does not|doesn't|do not|don't|never|should not|shouldn't|must not)\b/i;
const THROW_TITLE = /\bthrows?\b/gi;
const REJECT_TITLE = /\brejects?\b/gi;
const FAILURE_NAMED =
  /error|reject|throw|fail|invalid|denied|forbidden|unauthori[sz]ed|status|\b[45]\d\d\b|\bok\b|success|\bfalse\b/i;
const NEGATED_BEFORE = /\b(?:not|never|without|doesn't|don't|won't|shouldn't)\s+(?:\w+\s+)?$/i;
const HTTP_STATUSES = new Set(
  "200 201 202 204 301 302 304 400 401 402 403 404 405 409 410 412 413 415 422 429 500 501 502 503 504".split(
    " "
  )
);
const STATUS_BEFORE =
  /(?:status|code|http|returns?|returned|respond(?:s|ed)?|responds? with|response|repl(?:y|ies)|gets?|sends?|yields?|with|->|→)\s*(?:an?\s+)?$/i;
const STATUS_AFTER =
  /^\s*(?:ok|created|accepted|no content|moved|found|not modified|bad request|unauthori[sz]ed|payment required|forbidden|not found|method not allowed|conflict|gone|precondition|payload|unsupported|unprocessable|too many|internal|not implemented|bad gateway|service unavailable|gateway timeout)\b/i;
const NOT_A_STATUS =
  /^\s*(?:ms|milliseconds?|s|sec(?:ond)?s?|minutes?|items?|chars?|characters?|bytes?|kb|mb|%|times|records?|rows?|posts?|users?|entries|requests?)\b/i;
const CONDITION_BEFORE = /\b(?:when|if|on|after|whose|given|maps?|mapping|for)\b/i;
const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * @param {ts.SourceFile} sourceFile
 * @param {Binding[]} bindings
 * @returns {FileContext} The names assertions and helpers are imported under, and the file's own
 *   functions: `assert` always, every local name of `node:assert` or of vitest's `assert`, every
 *   method imported from `node:assert` by name, and every other import outside the test
 *   frameworks.
 */
function contextOf(sourceFile, bindings) {
  /** @type {FileContext} */
  const context = {
    sourceFile,
    assertNames: { roots: new Set(["assert"]), methods: new Map() },
    imports: new Map(),
    helpers: new Map(),
  };
  for (const { local, imported, from } of bindings) {
    if (FRAMEWORK_MODULES.has(from)) {
      if (from === "vitest" && imported === "assert") context.assertNames.roots.add(local);
    } else if (ASSERT_MODULES.has(from)) {
      if (imported === "default" || imported === "*" || imported === "strict") {
        context.assertNames.roots.add(local);
      } else context.assertNames.methods.set(local, imported);
    } else context.imports.set(local, from);
  }
  /**
   * @param {string} name
   * @param {Declaration} declaration
   */
  const declare = (name, declaration) => {
    const known = context.helpers.get(name) ?? [];
    context.helpers.set(name, [...known, declaration]);
  };
  /** @param {ts.Node} node */
  const findHelpers = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      declare(node.name.text, { scope: node.parent, fn: node });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = node.initializer;
      const fn =
        value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
          ? value
          : null;
      const list = node.parent;
      const scope = ts.isVariableStatement(list.parent) ? list.parent.parent : list.parent;
      declare(node.name.text, { scope, fn });
    }
    ts.forEachChild(node, findHelpers);
  };
  findHelpers(sourceFile);
  return context;
}

/**
 * @param {ts.Node} node
 * @returns {boolean} Whether the node opens a code body of its own: a function, a method, an
 *   accessor, a constructor or a class.
 */
const opensBody = (node) => ts.isFunctionLike(node) || ts.isClassLike(node);

/**
 * @param {ts.Node} node
 * @returns {boolean} Whether the node can return from the function it is written in: a `return`
 *   outside any function, method or class nested in it.
 */
function canReturn(node) {
  if (ts.isReturnStatement(node)) return true;
  if (opensBody(node)) return false;
  return ts.forEachChild(node, (child) => (canReturn(child) ? true : undefined)) === true;
}

/**
 * @param {ts.BindingName} name
 * @param {string} wanted
 * @returns {boolean} Whether the binding, destructured or not, binds `wanted`.
 */
function binds(name, wanted) {
  if (ts.isIdentifier(name)) return name.text === wanted;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && binds(element.name, wanted)
  );
}

/**
 * @param {ts.CallExpression} call
 * @param {string} name
 * @param {FileContext} context
 * @returns {FunctionNode | null} The same-file function the name resolves to where it is called:
 *   the nearest enclosing scope that declares it wins, a parameter of that name hides every outer
 *   declaration, and a declaration of anything but a function resolves to none.
 */
function resolveHelper(call, name, context) {
  const declarations = context.helpers.get(name) ?? [];
  for (let node = call.parent; node !== undefined; node = node.parent) {
    const here = declarations.find((declaration) => declaration.scope === node);
    if (here !== undefined) return here.fn;
    if (
      ts.isFunctionLike(node) &&
      node.parameters.some((parameter) => binds(parameter.name, name))
    ) {
      return null;
    }
  }
  return null;
}

/**
 * @param {ts.Expression} node
 * @returns {ts.Expression}
 */
function withoutParentheses(node) {
  return ts.isParenthesizedExpression(node) ? withoutParentheses(node.expression) : node;
}

/**
 * @param {ts.Expression} node
 * @returns {boolean} Whether the expression is `null` or `undefined`.
 */
function isNothing(node) {
  const inner = withoutParentheses(node);
  return (
    inner.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(inner) && inner.text === "undefined")
  );
}

/**
 * @param {ts.Expression} condition
 * @param {number} before Only facts established before this position count.
 * @param {PositionedFact[]} facts What earlier unconditional assertions established.
 * @returns {boolean | null} The condition's value when the facts decide it, else `null`: after
 *   `expect(result.ok).toBe(true)`, `!result.ok` is false, so `if (!result.ok) return` only
 *   narrows a type and guards nothing. Read through parentheses, `!`, `&&` and `||` operand by
 *   operand; `x === null`, `x == undefined`, `x !== null` and the like are decided when `x` was
 *   asserted present; `typeof x === "string"` when the type of `x` was asserted.
 */
function decided(condition, before, facts) {
  const known = facts.filter((fact) => fact.position < before);
  /**
   * @param {ts.Expression} node
   * @param {"truthy" | "type"} key
   * @returns {PositionedFact | undefined} The latest fact of that kind about the expression.
   */
  const factAbout = (node, key) => {
    const subject = node.getText().replace(/\s+/g, "");
    return known.filter((fact) => fact.subject === subject && fact[key] !== undefined).at(-1);
  };
  /**
   * @param {ts.Expression} node
   * @returns {boolean | null}
   */
  const value = (node) => {
    const whole = factAbout(node, "truthy")?.truthy;
    if (whole !== undefined) return whole;
    if (ts.isParenthesizedExpression(node)) return value(node.expression);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const operand = value(node.operand);
      return operand === null ? null : !operand;
    }
    if (!ts.isBinaryExpression(node)) return null;
    const operator = node.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      const and = operator === ts.SyntaxKind.AmpersandAmpersandToken;
      const left = value(node.left);
      const right = value(node.right);
      if (left === !and || right === !and) return !and;
      return left === and && right === and ? and : null;
    }
    const negated =
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken;
    const equal =
      negated ||
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken;
    if (!equal) return null;
    for (const [side, other] of [
      [node.left, node.right],
      [node.right, node.left],
    ]) {
      if (side === undefined || other === undefined) continue;
      if (isNothing(other)) return value(side) === true ? negated : null;
      const typeOf = withoutParentheses(side);
      const literal = withoutParentheses(other);
      if (ts.isTypeOfExpression(typeOf) && ts.isStringLiteralLike(literal)) {
        const type = factAbout(typeOf.expression, "type")?.type;
        return type === undefined ? null : (type === literal.text) !== negated;
      }
    }
    return null;
  };
  return value(condition);
}

/**
 * @param {ts.Statement} statement
 * @param {PositionedFact[]} facts
 * @returns {boolean} Whether the statement is an `if` that can return early on a path the facts
 *   leave open.
 */
function guards(statement, facts) {
  if (!ts.isIfStatement(statement)) return false;
  const value = decided(statement.expression, statement.getStart(), facts);
  const elseReturns = statement.elseStatement !== undefined && canReturn(statement.elseStatement);
  return (canReturn(statement.thenStatement) && value !== false) || (elseReturns && value !== true);
}

/**
 * @param {ts.Node} node An assertion, or a call of a helper.
 * @param {ts.Node} stop The function whose body the walk stays inside.
 * @param {PositionedFact[]} facts What earlier unconditional assertions in that body established.
 * @param {boolean} catchesRun Whether the block counts its assertions, so a catch path must run.
 * @returns {{ flags: Set<Flag>, inCatch: boolean }} The conditions it runs under.
 */
function conditionsOf(node, stop, facts, catchesRun) {
  /** @type {Set<Flag>} */
  const flags = new Set();
  let inCatch = false;
  for (let child = node, parent = node.parent; parent !== undefined && child !== stop;) {
    if (ts.isIfStatement(parent) && child !== parent.expression) {
      const value = decided(parent.expression, parent.getStart(), facts);
      if (value !== (child === parent.thenStatement)) flags.add("CONDITIONAL");
    } else if (ts.isConditionalExpression(parent) && child !== parent.condition)
      flags.add("CONDITIONAL");
    else if (
      ts.isBinaryExpression(parent) &&
      child === parent.right &&
      LOGICAL.has(parent.operatorToken.kind)
    ) {
      flags.add("CONDITIONAL");
    } else if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) flags.add("CONDITIONAL");
    else if (ts.isCatchClause(parent)) {
      if (!catchesRun) flags.add("CONDITIONAL");
      inCatch = true;
    } else if (
      ts.isCallExpression(parent) &&
      child !== parent.expression &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "catch"
    ) {
      if (!catchesRun) flags.add("CONDITIONAL");
      inCatch = true;
    }
    if (ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      const index = parent.statements.findIndex((statement) => statement === child);
      if (parent.statements.slice(0, Math.max(index, 0)).some((s) => guards(s, facts))) {
        flags.add("GUARDED-RETURN");
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return { flags, inCatch };
}

/**
 * @param {ts.Node} root
 * @param {AssertNames} names
 * @returns {boolean} Whether the subtree asserts anything by itself, helpers not followed; a
 *   `throw` is no assertion outside the block's own body.
 */
function assertsDirectly(root, names) {
  /** @param {ts.Node} node @returns {true | undefined} */
  const visit = (node) => {
    if (ts.isCallExpression(node) && readAssertion(node, names) !== null) return true;
    return ts.forEachChild(node, visit);
  };
  return visit(root) === true;
}

/**
 * @param {string} from A module specifier.
 * @returns {boolean} Whether the module is test code rather than the code under test.
 */
const isTestModule = (from) =>
  /test/i.test(from) || (from.startsWith(".") && !from.includes("/src/"));

/**
 * @param {ts.Expression} callee
 * @param {FileContext} context
 * @returns {string | null} The name of the imported test helper the callee is, or `null`.
 */
function importedHelper(callee, context) {
  if (ts.isIdentifier(callee)) {
    const from = context.imports.get(callee.text);
    return from !== undefined && isTestModule(from) && HELPER_NAME.test(callee.text)
      ? callee.text
      : null;
  }
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
  const from = context.imports.get(callee.expression.text);
  const named = from !== undefined && isTestModule(from) && HELPER_NAME.test(callee.name.text);
  return named ? `${callee.expression.text}.${callee.name.text}` : null;
}

/**
 * @param {ts.Expression} callee
 * @returns {string | null} `receiver.method` for a method named `expect…` or `assert…`, such as a
 *   page object's `authPage.expectLoginFormToBeVisible()`, or `null`.
 */
function assertingMethod(callee) {
  if (!ts.isPropertyAccessExpression(callee) || !ASSERTING_METHOD.test(callee.name.text))
    return null;
  return callee.getText().replace(/\s+/g, "");
}

/**
 * @param {ts.ThrowStatement} statement
 * @returns {ts.Node} The `if` a `throw` is the branch of, which is the check it asserts and must
 *   not be read as a condition on it (`if (!saved) throw new Error(...)`); else the `throw`.
 */
function checkOf(statement) {
  const parent = ts.isBlock(statement.parent) ? statement.parent.parent : statement.parent;
  return ts.isIfStatement(parent) ? parent : statement;
}

/**
 * @param {ts.Node} root The body to read.
 * @param {FunctionNode} owner The function the body belongs to.
 * @param {FileContext} context
 * @param {Site | null} site Where the owner is called from, when it is an inlined helper.
 * @param {boolean} catchesRun Whether the block counts its assertions, so a catch path must run.
 * @returns {Collected[]} Every assertion in source order.
 */
function collect(root, owner, context, site, catchesRun) {
  const { sourceFile, assertNames } = context;
  /** @type {Collected[]} */
  const found = [];
  /** @type {PositionedFact[]} */
  const facts = [];
  /**
   * @param {ts.Node} node
   * @param {Omit<AssertionFinding, "line" | "col" | "flags" | "via">} reading
   * @param {boolean} throwEvidence
   */
  const record = (node, reading, throwEvidence) => {
    const { flags, inCatch } = conditionsOf(node, owner, facts, catchesRun);
    const fact = flags.size === 0 && ts.isCallExpression(node) ? readFact(node, assertNames) : null;
    if (fact !== null) facts.push({ ...fact, position: node.getStart(sourceFile) });
    for (const flag of site?.flags ?? []) flags.add(flag);
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({
      finding: {
        line: start.line + 1,
        col: start.character + 1,
        ...reading,
        flags: [...flags].sort(),
        via: site?.via ?? null,
      },
      position: site?.position ?? node.getStart(sourceFile),
      throwEvidence: throwEvidence || inCatch || (site?.inCatch ?? false),
      text: `${node.getText(sourceFile)} ${site?.text ?? ""}`,
    });
  };
  /** @param {ts.CallExpression} call @param {string} name */
  const opaque = (call, name) =>
    record(call, { form: "helper", name, assertionClass: ASSERTION_CLASS.OPAQUE }, false);
  /** @param {ts.Node} node @param {boolean} nested */
  const visit = (node, nested) => {
    if (ts.isThrowStatement(node) && !nested && site === null) {
      record(
        checkOf(node),
        { form: "throw", name: "throw", assertionClass: ASSERTION_CLASS.BEHAVIOURAL },
        false
      );
    }
    if (ts.isCallExpression(node)) {
      const reading = readAssertion(node, assertNames);
      const callee = node.expression;
      const helper = ts.isIdentifier(callee) ? resolveHelper(node, callee.text, context) : null;
      if (reading !== null) {
        const { throwEvidence, ...rest } = reading;
        record(node, rest, throwEvidence);
      } else if (helper !== null && helper !== owner && ts.isIdentifier(callee)) {
        const named = HELPER_NAME.test(callee.text);
        if (site === null) {
          const { flags, inCatch } = conditionsOf(node, owner, facts, catchesRun);
          const position = node.getStart(sourceFile);
          const at = { position, flags, inCatch, text: node.getText(sourceFile), via: callee.text };
          const inlined =
            helper.body === undefined ? [] : collect(helper.body, helper, context, at, catchesRun);
          found.push(...inlined);
          if (inlined.length === 0 && named) opaque(node, callee.text);
        } else if (
          named ||
          (helper.body !== undefined && assertsDirectly(helper.body, assertNames))
        ) {
          opaque(node, callee.text);
        }
      } else {
        const name = importedHelper(callee, context) ?? assertingMethod(callee);
        if (name !== null) opaque(node, name);
      }
    }
    ts.forEachChild(node, (child) => visit(child, nested || opensBody(child)));
  };
  visit(root, false);
  return found;
}

/**
 * @param {ts.Expression} arg
 * @returns {string} The literal text of an argument: strings, templates and their `+` joins.
 */
function literalText(arg) {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg))
    return [arg.head.text, ...arg.templateSpans.map((span) => span.literal.text)].join(" ");
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return `${literalText(arg.left)} ${literalText(arg.right)}`;
  }
  return "";
}

/**
 * @param {ts.Node} body
 * @returns {number[]} The positions of the `console.*` calls in the body that print success.
 */
function successPrints(body) {
  /** @type {number[]} */
  const prints = [];
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText() === "console" &&
      node.arguments.some((arg) => SUCCESS_PRINT.test(literalText(arg)))
    ) {
      prints.push(node.getStart());
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return prints;
}

/**
 * @param {string} title
 * @returns {string[]} The HTTP statuses the title names as an outcome: not a count, and not the
 *   input of a condition (`maps 429 to RATE_LIMIT`, `when the API returns 401`).
 */
function titleStatuses(title) {
  /** @type {string[]} */
  const statuses = [];
  for (const match of title.matchAll(/\b([1-5]\d\d)\b/g)) {
    const code = match[1] ?? "";
    const before = title.slice(0, match.index);
    const after = title.slice(match.index + code.length);
    if (!HTTP_STATUSES.has(code) || NOT_A_STATUS.test(after) || CONDITION_BEFORE.test(before))
      continue;
    if (STATUS_BEFORE.test(before) || STATUS_AFTER.test(after)) statuses.push(code);
  }
  return statuses;
}

/**
 * @param {string} title
 * @param {RegExp} word A global pattern of the promised word.
 * @returns {boolean} Whether the title promises the word as an outcome: not negated (`does not
 *   throw`) and not the input of a condition (`when the provider throws`).
 */
function promises(title, word) {
  for (const match of title.matchAll(word)) {
    const before = title.slice(0, match.index);
    if (!CONDITION_BEFORE.test(before) && !NEGATED_BEFORE.test(before)) return true;
  }
  return false;
}

/**
 * @param {string} title
 * @param {Collected[]} collected
 * @returns {string | null} How the title contradicts the assertions, or `null`:
 *   `returns-nothing`: it promises undefined or null, an assertion requires presence, and no
 *   restricting assertion names null or undefined;
 *   `negative-existence`: it promises an absence and every assertion requires presence;
 *   `throw-unchecked`: it promises a throw or a rejection and no assertion checks one. A throw is
 *   checked by `toThrow*`, `.rejects`, `assert.throws`, `rejects` or `fail`, `expect.fail`, an
 *   assertion in a `catch`, or a restricting assertion that names a failure. A rejection is
 *   checked by any of those or by any restricting assertion: "rejects" in this repository's titles
 *   mostly names a refused input or request, not a rejected promise;
 *   `status-unnamed`: it names an HTTP status as an outcome and no assertion names it.
 */
function contradictionOf(title, collected) {
  const existence = collected.filter((c) => c.finding.assertionClass === ASSERTION_CLASS.EXISTENCE);
  const restricting = collected.filter(
    (c) =>
      c.finding.assertionClass === ASSERTION_CLASS.BEHAVIOURAL ||
      c.finding.assertionClass === ASSERTION_CLASS.SNAPSHOT
  );
  const absenceChecked = restricting.some((c) => /null|undefined/i.test(c.text));
  if (RETURNS_NOTHING.test(title) && existence.length > 0 && !absenceChecked)
    return "returns-nothing";
  if (NEGATIVE_TITLE.test(title) && existence.length === collected.length)
    return "negative-existence";
  if (collected.some((c) => c.finding.assertionClass === ASSERTION_CLASS.OPAQUE)) return null;
  const thrown = collected.some((c) => c.throwEvidence);
  const failureNamed = restricting.some((c) => FAILURE_NAMED.test(c.text));
  if (promises(title, THROW_TITLE) && !thrown && !failureNamed) return "throw-unchecked";
  if (promises(title, REJECT_TITLE) && !thrown && restricting.length === 0)
    return "throw-unchecked";
  const named = (/** @type {string} */ code) =>
    collected.some((c) => new RegExp(`\\b${code}\\b`).test(c.text));
  return titleStatuses(title).every(named) ? null : "status-unnamed";
}

/**
 * @param {string[]} skips
 * @param {Collected[]} collected
 * @param {number[]} prints
 * @param {string | null} contradiction
 * @returns {BlockClass}
 */
function classOf(skips, collected, prints, contradiction) {
  if (skips.length > 0) return BLOCK_CLASS.SELF_SKIP;
  if (collected.length === 0)
    return prints.length > 0 ? BLOCK_CLASS.PRINTS_SUCCESS : BLOCK_CLASS.EMPTY;
  if (contradiction !== null) return BLOCK_CLASS.TITLE_CONTRADICTION;
  /** @param {Collected} c */
  const conditional = (c) => c.finding.flags.length > 0;
  const restricts = collected.some((c) => {
    const kind = c.finding.assertionClass;
    if (kind === ASSERTION_CLASS.OPAQUE) return true;
    return (
      !conditional(c) && (kind === ASSERTION_CLASS.BEHAVIOURAL || kind === ASSERTION_CLASS.SNAPSHOT)
    );
  });
  if (restricts) return BLOCK_CLASS.BEHAVIOURAL;
  const last = Math.max(...collected.map((c) => c.position));
  if (prints.some((print) => print > last)) return BLOCK_CLASS.PRINTS_SUCCESS;
  const kinds = collected.map((c) => (conditional(c) ? "CONDITIONAL" : c.finding.assertionClass));
  if (kinds.every((kind) => kind === ASSERTION_CLASS.TAUTOLOGY)) return BLOCK_CLASS.TAUTOLOGY_ONLY;
  if (kinds.every((kind) => kind === ASSERTION_CLASS.TAUTOLOGY || kind === "CONDITIONAL")) {
    return BLOCK_CLASS.CONDITIONAL_ONLY;
  }
  return BLOCK_CLASS.EXISTENCE_ONLY;
}

/**
 * @param {ts.Node} body
 * @returns {boolean} Whether the body calls `expect.assertions(n)` or `expect.hasAssertions()`.
 */
function countsAssertions(body) {
  /** @param {ts.Node} node @returns {true | undefined} */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (callee === "expect.assertions" || callee === "expect.hasAssertions") return true;
    }
    return ts.forEachChild(node, visit);
  };
  return visit(body) === true;
}

/**
 * @param {LeafBlock} block
 * @param {FileContext} context
 * @returns {BlockFinding}
 */
function classifyBlock(block, context) {
  const { sourceFile } = context;
  const { callback, external } = block;
  const collected =
    callback === null
      ? []
      : collect(callback.body, callback, context, null, countsAssertions(callback.body));
  if (external !== null) {
    const start = sourceFile.getLineAndCharacterOfPosition(external.getStart(sourceFile));
    collected.push({
      finding: {
        line: start.line + 1,
        col: start.character + 1,
        form: "helper",
        name: external.getText(sourceFile),
        assertionClass: ASSERTION_CLASS.OPAQUE,
        flags: [],
        via: null,
      },
      position: external.getStart(sourceFile),
      throwEvidence: false,
      text: "",
    });
  }
  const prints = callback === null ? [] : successPrints(callback.body);
  const contradiction = collected.length === 0 ? null : contradictionOf(block.title, collected);
  const blockClass = classOf(block.skips, collected, prints, contradiction);
  const assertions = collected.map((c) => c.finding);
  return {
    id: block.id,
    framework: block.framework,
    kind: block.kind,
    title: block.title,
    describe: block.describe,
    loc: block.loc,
    modifiers: block.modifiers,
    skips: block.skips,
    bodyHash: block.bodyHash,
    assertions,
    blockClass,
    flags: [...new Set(assertions.flatMap((assertion) => assertion.flags))].sort(),
    criteria: CRITERIA[blockClass],
    contradiction: blockClass === BLOCK_CLASS.TITLE_CONTRADICTION ? contradiction : null,
    opaque: assertions.some((assertion) => assertion.assertionClass === ASSERTION_CLASS.OPAQUE),
    successPrints: prints.map((print) => sourceFile.getLineAndCharacterOfPosition(print).line + 1),
  };
}

/**
 * @param {string} text
 * @param {string} fileName
 * @returns {FileClassification}
 */
function classifyReadable(text, fileName) {
  const file = discoverBlocks(text, fileName);
  const context = contextOf(file.sourceFile, file.bindings);
  const blocks = file.blocks.map((block) => classifyBlock(block, context));
  const opaqueHelpers = [
    ...new Set(
      blocks.flatMap((block) =>
        block.assertions
          .filter((a) => a.assertionClass === ASSERTION_CLASS.OPAQUE)
          .map((a) => a.name)
      )
    ),
  ].sort();
  return {
    path: fileName,
    framework: file.framework,
    blocks,
    opaqueHelpers,
    fileContextHash: file.fileContextHash,
    error: null,
  };
}

/**
 * @description Classifies every test block of one file, syntactically. It never throws: a file it
 *   cannot read, such as one whose syntax nests deeper than the call stack, comes back with no
 *   block, `framework` and `fileContextHash` `null`, and the error as `<name>: <message>`.
 * @param {string} text The file's source.
 * @param {string} fileName The path its block ids carry; its extension picks the parser (`.tsx`,
 *   `.jsx`, `.js`, else TypeScript).
 * @returns {FileClassification} The reported blocks in source order, the opaque helpers they call,
 *   the file-context hash of `blocks.js`, and `error`, `null` unless the file could not be read.
 */
export function classifyFile(text, fileName) {
  try {
    return classifyReadable(text, fileName);
  } catch (error) {
    return {
      path: fileName,
      framework: null,
      blocks: [],
      opaqueHelpers: [],
      fileContextHash: null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
