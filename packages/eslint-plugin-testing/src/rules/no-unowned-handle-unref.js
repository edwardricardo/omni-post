// @ts-check
/**
 * @file no-unowned-handle-unref.js
 * @description ESLint rule `testing/no-unowned-handle-unref`: a test may unref only a handle it
 *   created. A vitest fork holds handles it does not own — one of them is the IPC channel to the
 *   pool — and a helper that unref'd every active handle let the fork exit while the pool was
 *   still writing to it: `Worker exited unexpectedly`, zero failing assertions, and the file's
 *   tests lost as `pending`.
 *
 *   What the rule reports, decided on the syntax tree and never on line text: process-wide handle
 *   enumeration (`_getActiveHandles`, `_getActiveRequests`, `getActiveResourcesInfo`, read as a
 *   member or destructured), and an `unref()` whose receiver is reached from the global `process`,
 *   directly or through `globalThis` / `global`. Casts, non-null assertions, optional chains and
 *   line breaks are looked through; a local binding named `process` is not the global. An
 *   enumerator is matched by its name alone, whatever object it is read or destructured from: the
 *   names exist only on `process`, and the name also catches an alias of `process` this check
 *   cannot resolve.
 *
 *   Not covered yet: a receiver the file did not mint by another route — a parameter, an import,
 *   an unresolved name, an alias of a process stream. Deciding that needs ownership resolved
 *   through the scope manager.
 * @layer infrastructure
 */

/** Process-wide enumeration: its result includes the handles the test runner itself holds. */
const ENUMERATORS = new Set(["_getActiveHandles", "_getActiveRequests", "getActiveResourcesInfo"]);

/** The global objects `process` can also be read from. */
const GLOBAL_ROOTS = new Set(["globalThis", "global"]);

/** Wrappers that change neither the value nor who created it, with the key of what they wrap. */
const TRANSPARENT = new Map([
  ["ChainExpression", "expression"],
  ["TSAsExpression", "expression"],
  ["TSNonNullExpression", "expression"],
  ["TSSatisfiesExpression", "expression"],
  ["TSTypeAssertion", "expression"],
]);

/** @typedef {{ type: string, [key: string]: unknown }} AstNode */

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
 * @param {AstNode} node
 * @param {string} key
 * @returns {AstNode | null}
 */
function child(node, key) {
  const value = node[key];
  return isNode(value) ? value : null;
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
    current = child(current, key);
  }
  return current;
}

/**
 * @param {AstNode} node A `MemberExpression` or a `Property`.
 * @returns {string | null} The static key: `a.b`, `a["b"]`, or `{ b }`.
 */
function staticName(node) {
  const key = child(node, node.type === "MemberExpression" ? "property" : "key");
  if (key === null) return null;
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : null;
  if (node.computed === true) return null;
  return key.type === "Identifier" && typeof key.name === "string" ? key.name : null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow process-wide handle enumeration and unref() on a handle the file did not create",
    },
    schema: [],
    messages: {
      enumeration:
        "`{{name}}` enumerates every handle of the process, the test runner's own channel " +
        "included. Close the handles this file opened, each through its own API.",
      processHandle:
        "`{{receiver}}.unref()` releases a handle the process owns, not this file; inside a " +
        "vitest fork that lets the worker exit under the pool with zero failing assertions.",
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
     * @param {AstNode} node
     * @returns {boolean} Whether `node` names the global `process`, directly or via `globalThis`.
     */
    function isProcess(node) {
      if (node.type === "MemberExpression") {
        const object = unwrap(node.object);
        const name = object?.type === "Identifier" ? object.name : null;
        return typeof name === "string" && GLOBAL_ROOTS.has(name) && staticName(node) === "process";
      }
      if (node.type !== "Identifier" || node.name !== "process") return false;
      const variable = findVariable(node, node.name);
      return variable === null || variable.defs.length === 0;
    }

    /**
     * @param {AstNode} receiver
     * @returns {boolean} Whether the receiver is `process` or a member chain rooted at it.
     */
    function reachesProcess(receiver) {
      let root = receiver;
      while (root.type === "MemberExpression" && !isProcess(root)) {
        const object = unwrap(root.object);
        if (object === null) return false;
        root = object;
      }
      return isProcess(root);
    }

    /** @param {AstNode} node */
    function checkEnumeration(node) {
      const name = staticName(node);
      if (name === null || !ENUMERATORS.has(name)) return;
      const estree = /** @type {import("eslint").Rule.Node} */ (/** @type {unknown} */ (node));
      context.report({ node: estree, messageId: "enumeration", data: { name } });
    }

    return {
      MemberExpression(node) {
        if (isNode(node)) checkEnumeration(node);
      },
      Property(node) {
        if (isNode(node) && isNode(node.parent) && node.parent.type === "ObjectPattern") {
          checkEnumeration(node);
        }
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const receiver = callee?.type === "MemberExpression" ? unwrap(callee.object) : null;
        if (callee === null || receiver === null || staticName(callee) !== "unref") return;
        if (!reachesProcess(receiver)) return;
        const range = /** @type {[number, number]} */ (receiver.range);
        context.report({
          node,
          messageId: "processHandle",
          data: { receiver: sourceCode.text.slice(range[0], range[1]) },
        });
      },
    };
  },
};

export default rule;
