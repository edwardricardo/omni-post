// @ts-check
/**
 * @file no-stdout-in-node-test.js
 * @description ESLint rule `testing/no-stdout-in-node-test`: code that runs in a node:test child
 *   process writes nothing to stdout. The child's stdout is the runner's message channel: the
 *   parent reads it as serialized frames, and on Node 24.15.0 text written right after a frame is
 *   read as the next frame's length. When the text's third byte is 0x80 or above the length is
 *   negative and the whole file is reported failed although its tests passed: a leading "✓" does
 *   it, and so does "OK✓". That byte belongs to the text at run time, interpolated values and
 *   inspected objects included, so no reading of the source can tell a safe line from a fatal one,
 *   and the rule keeps every write off stdout. Diagnostics go to stderr (`console.error`,
 *   `console.warn`), which the runner reads line by line.
 *
 *   What the rule reports, decided on the syntax tree and never on line text: a call of a console
 *   member that writes to stdout or of `process.stdout.write`, a `.call`, `.apply` or `.bind` of
 *   one, and one handed to another call as an argument (`promise.catch(console.log)`). `console`
 *   and `process` are the globals, read directly or from `globalThis` / `global`; a local binding
 *   named either is not. Casts, non-null assertions, optional chains, string-literal keys and line
 *   breaks are looked through, and so is an alias: a binding written from a writer, from `console`,
 *   `process` or `process.stdout`, or destructured from one at the top of its pattern
 *   (`const { log } = console`), followed through the scope manager.
 *
 *   Not reported: a reference that is neither called nor handed to a call. A spy or a mock
 *   (`vi.spyOn(console, "log")`, `console.log = vi.fn()`, `const original = console.log`) writes
 *   nothing.
 *
 *   Not seen: a writer stored in an object or an array and called from there, a writer reached
 *   through a computed key that is not a string literal, a nested or defaulted destructuring, an
 *   import from `node:console`, and a write to file descriptor 1 (`fs.writeSync(1, text)`).
 * @layer infrastructure
 */

/**
 * The console members that write to stdout, measured on Node 24.15.0 by running each with stdout
 * and stderr apart. `warn`, `error`, `trace` and `assert` write to stderr; `time`, `groupEnd` and
 * `countReset` print nothing to stdout.
 */
const CONSOLE_STDOUT = new Set([
  "log",
  "info",
  "debug",
  "dir",
  "dirxml",
  "table",
  "count",
  "group",
  "groupCollapsed",
  "timeLog",
  "timeEnd",
]);

/** The global objects `console` and `process` can also be read from. */
const GLOBAL_ROOTS = new Set(["globalThis", "global"]);

/** Members that call the function they are read from, or bind it for a later call. */
const INVOKERS = new Set(["call", "apply", "bind"]);

/** Wrappers that change neither the value nor where it writes, with the key of what they wrap. */
const TRANSPARENT = new Map([
  ["ChainExpression", "expression"],
  ["TSAsExpression", "expression"],
  ["TSNonNullExpression", "expression"],
  ["TSSatisfiesExpression", "expression"],
  ["TSTypeAssertion", "expression"],
]);

/**
 * @typedef {{ type: string, [key: string]: unknown }} AstNode
 * @typedef {"global" | "console" | "process" | "stdout" | "writer"} Kind What a value is, as far
 *   as writing to stdout goes: the global object, `console`, `process`, `process.stdout`, or a
 *   function that writes to stdout.
 */

/**
 * @param {unknown} value
 * @returns {value is AstNode}
 */
function isNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {{ type?: unknown }} */ (value).type) === "string"
  );
}

/**
 * @param {unknown} value
 * @returns {AstNode | null} The expression under every transparent wrapper.
 */
function unwrap(value) {
  let current = isNode(value) ? value : null;
  while (current !== null) {
    const key = TRANSPARENT.get(current.type);
    if (key === undefined) break;
    const inner = current[key];
    current = isNode(inner) ? inner : null;
  }
  return current;
}

/**
 * @param {AstNode} node A `MemberExpression` or a `Property`.
 * @returns {string | null} The static key: `a.b`, `a["b"]`, `{ b }`, `{ b: c }`.
 */
function staticName(node) {
  const key = node.type === "MemberExpression" ? node.property : node.key;
  if (!isNode(key)) return null;
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : null;
  if (node.computed === true || key.type !== "Identifier") return null;
  return typeof key.name === "string" ? key.name : null;
}

/**
 * @param {Kind | null} owner
 * @param {string} name
 * @returns {Kind | null} What member `name` of a value of kind `owner` is.
 */
function memberKind(owner, name) {
  if (owner === "global") return name === "console" || name === "process" ? name : null;
  if (owner === "console") return CONSOLE_STDOUT.has(name) ? "writer" : null;
  if (owner === "process") return name === "stdout" ? "stdout" : null;
  if (owner === "stdout") return name === "write" ? "writer" : null;
  return null;
}

/**
 * @param {AstNode} node
 * @returns {boolean} Whether a write to `node` stores the whole written value: `node` is the
 *   target of a declaration with an initialiser or of an assignment. A loop binding, a parameter
 *   and a nested or defaulted pattern store something else, which the rule does not follow.
 */
function storesWrittenValue(node) {
  const parent = node.parent;
  if (!isNode(parent)) return false;
  if (parent.type === "VariableDeclarator") return parent.id === node && isNode(parent.init);
  return parent.type === "AssignmentExpression" && parent.left === node;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow writing to stdout in code that runs inside a node:test child process",
    },
    schema: [],
    messages: {
      stdout:
        "`{{writer}}` writes to stdout, which in a node:test child process is the runner's " +
        "message channel: text written there can be read as a message frame and fail the whole " +
        "file. Write diagnostics to stderr with console.error or console.warn.",
    },
  },
  create(context) {
    const { sourceCode } = context;

    /**
     * @param {AstNode} identifier
     * @param {string} name The identifier's name.
     * @returns {import("eslint").Scope.Variable | null}
     */
    function findVariable(identifier, name) {
      const estree = /** @type {import("eslint").Rule.Node} */ (
        /** @type {unknown} */ (identifier)
      );
      /** @type {import("eslint").Scope.Scope | null} */
      let scope = sourceCode.getScope(estree);
      for (; scope !== null; scope = scope.upper) {
        const variable = scope.set.get(name);
        if (variable !== undefined) return variable;
      }
      return null;
    }

    /**
     * @param {unknown} value
     * @param {Set<unknown>} path The bindings already being followed, so an alias cycle ends.
     * @returns {Kind | null} What `value` is; `null` for anything that is not on the way to stdout.
     */
    function kindOf(value, path) {
      const node = unwrap(value);
      if (node === null) return null;
      if (node.type === "AssignmentExpression") return kindOf(node.right, path);
      if (node.type === "MemberExpression") {
        const name = staticName(node);
        return name === null ? null : memberKind(kindOf(node.object, path), name);
      }
      if (node.type !== "Identifier" || typeof node.name !== "string") return null;
      const variable = findVariable(node, node.name);
      if (variable === null || variable.defs.length === 0) {
        return GLOBAL_ROOTS.has(node.name) ? "global" : memberKind("global", node.name);
      }
      if (path.has(variable)) return null;
      const inner = new Set(path).add(variable);
      for (const reference of variable.references) {
        const kind = reference.isWrite() ? writtenKind(reference, inner) : null;
        if (kind !== null) return kind;
      }
      return null;
    }

    /**
     * @param {import("eslint").Scope.Reference} reference A write to an alias binding.
     * @param {Set<unknown>} path
     * @returns {Kind | null} What the write stores: the written value, or, for a name destructured
     *   at the top of its pattern (`const { log } = console`), the member of it the name takes.
     */
    function writtenKind(reference, path) {
      const target = /** @type {AstNode} */ (/** @type {unknown} */ (reference.identifier));
      const property = target.parent;
      if (isNode(property) && property.type === "Property" && property.value === target) {
        const pattern = property.parent;
        const name = staticName(property);
        const destructured =
          isNode(pattern) && pattern.type === "ObjectPattern" && storesWrittenValue(pattern);
        return destructured && name !== null
          ? memberKind(kindOf(reference.writeExpr, path), name)
          : null;
      }
      return storesWrittenValue(target) ? kindOf(reference.writeExpr, path) : null;
    }

    /** @param {AstNode} writer */
    function report(writer) {
      const range = /** @type {[number, number]} */ (writer.range);
      const text = sourceCode.text.slice(range[0], range[1]).replace(/\s*\n\s*/g, "");
      const node = /** @type {import("eslint").Rule.Node} */ (/** @type {unknown} */ (writer));
      context.report({ node, messageId: "stdout", data: { writer: text } });
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee === null) return;
        const name = callee.type === "MemberExpression" ? staticName(callee) : null;
        const invoked = name !== null && INVOKERS.has(name) ? unwrap(callee.object) : null;
        if (kindOf(callee, new Set()) === "writer") report(callee);
        else if (invoked !== null && kindOf(invoked, new Set()) === "writer") report(invoked);
        for (const argument of node.arguments) {
          const value = unwrap(argument);
          if (value !== null && kindOf(value, new Set()) === "writer") report(value);
        }
      },
    };
  },
};

export default rule;
