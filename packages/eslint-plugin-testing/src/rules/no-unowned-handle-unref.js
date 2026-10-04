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
 *   names exist only on `process`, and the name also catches a read through an alias of
 *   `process` without resolving the alias.
 *
 *   Every other receiver must be one the file minted, resolved through ESLint's scope manager. An
 *   identifier is owned when every write to its variable (its initialiser and every assignment,
 *   followed through aliases) is a creator call, or hands over no handle (`null`, `undefined`, the
 *   variable itself), and at least one write is a creator call; `this.x` is owned on the same terms
 *   over its field initialiser and every assignment to `this.x` in its class; a member of an owned
 *   value is owned; `await` is looked through. A parameter, an import, an unresolved name, a value
 *   a helper returns, or an alias of a process stream is not owned.
 *
 *   Not seen: an `unref` taken by reference instead of called as a member (`const u = h.unref`),
 *   or behind a computed key that is not a string literal.
 * @layer infrastructure
 */

/** Process-wide enumeration: its result includes the handles the test runner itself holds. */
const ENUMERATORS = new Set(["_getActiveHandles", "_getActiveRequests", "getActiveResourcesInfo"]);

/** The global objects `process` can also be read from. */
const GLOBAL_ROOTS = new Set(["globalThis", "global"]);

/** The calls that mint a handle the calling file then owns, by callee name or member name. */
const CREATORS = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "createServer",
  "createConnection",
  "createSocket",
  "createReadStream",
  "createWriteStream",
  "watchFile",
  "spawn",
  "fork",
  "execFile",
  "listen",
]);

/** Wrappers that change neither the value nor who created it, with the key of what they wrap. */
const TRANSPARENT = new Map([
  ["ChainExpression", "expression"],
  ["TSAsExpression", "expression"],
  ["TSNonNullExpression", "expression"],
  ["TSSatisfiesExpression", "expression"],
  ["TSTypeAssertion", "expression"],
  ["AwaitExpression", "argument"],
]);

/**
 * @typedef {{ type: string, [key: string]: unknown }} AstNode
 * @typedef {"owned" | "neutral" | "process" | "unowned"} Ownership `neutral`: a write that hands
 *   over no handle — `null`, `undefined`, or the binding itself.
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
 * @param {AstNode} node A `MemberExpression`, a `Property` or a `PropertyDefinition`.
 * @returns {string | null} The static key: `a.b`, `a["b"]`, `a.#b`, `{ b }`, `b = …` in a class.
 */
function staticName(node) {
  const key = child(node, node.type === "MemberExpression" ? "property" : "key");
  if (key === null) return null;
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : null;
  if (node.computed === true || typeof key.name !== "string") return null;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  return key.type === "Identifier" ? key.name : null;
}

/**
 * @param {AstNode} node
 * @returns {boolean}
 */
function isThisMember(node) {
  return node.type === "MemberExpression" && unwrap(node.object)?.type === "ThisExpression";
}

/**
 * @param {AstNode} node
 * @returns {AstNode | null} The class whose instance `this` names at `node`; `null` at file level.
 */
function enclosingClass(node) {
  for (let current = node.parent; isNode(current); current = current.parent) {
    if (current.type === "ClassDeclaration" || current.type === "ClassExpression") return current;
  }
  return null;
}

/**
 * @param {Ownership[]} verdicts One per write.
 * @returns {Ownership} Owned only when no write is foreign and at least one mints the handle.
 */
function combine(verdicts) {
  if (verdicts.includes("process")) return "process";
  if (verdicts.includes("unowned")) return "unowned";
  return verdicts.includes("owned") ? "owned" : "unowned";
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
      unowned:
        "`{{receiver}}.unref()` releases a handle this file did not create from a known creator " +
        "(setTimeout, createServer, spawn, listen, …). Close the handle that leaks with its own API.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** @type {Map<AstNode | null, Map<string, unknown[]>>} */
    const thisWrites = new Map();
    /** @type {{ call: import("eslint").Rule.Node, receiver: AstNode }[]} */
    const unrefs = [];

    /**
     * @param {AstNode} anchor
     * @param {string | null} name
     * @param {unknown} value
     */
    function recordThisWrite(anchor, name, value) {
      if (name === null) return;
      const container = enclosingClass(anchor);
      const byName = thisWrites.get(container) ?? new Map();
      thisWrites.set(container, byName.set(name, [...(byName.get(name) ?? []), value]));
    }

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

    /**
     * @param {unknown} value An expression that produced, or holds, the receiver.
     * @param {Set<unknown>} path The variables and `this` members already being resolved.
     * @returns {Ownership}
     */
    function classify(value, path) {
      const node = unwrap(value);
      if (node === null) return "unowned";
      if (reachesProcess(node)) return "process";
      if (node.type === "CallExpression" || node.type === "NewExpression") {
        const callee = unwrap(node.callee);
        const name = callee?.type === "MemberExpression" ? staticName(callee) : callee?.name;
        return typeof name === "string" && CREATORS.has(name) ? "owned" : "unowned";
      }
      if (node.type === "Literal" && node.raw === "null") return "neutral";
      if (node.type === "ConditionalExpression") {
        return combine([classify(node.consequent, path), classify(node.alternate, path)]);
      }
      if (node.type === "Identifier" && typeof node.name === "string") {
        const variable = findVariable(node, node.name);
        if (variable === null || variable.defs.length === 0) {
          return node.name === "undefined" ? "neutral" : "unowned";
        }
        if (path.has(variable)) return "neutral";
        if (variable.defs.some((def) => def.type !== "Variable")) return "unowned";
        const writes = variable.references.filter((ref) => ref.isWrite());
        const inner = new Set(path).add(variable);
        return combine(writes.map((ref) => classify(ref.writeExpr, inner)));
      }
      if (isThisMember(node)) {
        const name = staticName(node);
        const writes = name === null ? undefined : thisWrites.get(enclosingClass(node))?.get(name);
        if (writes === undefined) return "unowned";
        if (path.has(writes)) return "neutral";
        const inner = new Set(path).add(writes);
        return combine(writes.map((write) => classify(write, inner)));
      }
      if (node.type === "MemberExpression") {
        return classify(node.object, path) === "owned" ? "owned" : "unowned";
      }
      return "unowned";
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
      AssignmentExpression(node) {
        const target = unwrap(node.left);
        if (isNode(node) && target !== null && isThisMember(target)) {
          recordThisWrite(node, staticName(target), node.right);
        }
      },
      PropertyDefinition(node) {
        if (isNode(node) && node.value !== null) {
          recordThisWrite(node, staticName(node), node.value);
        }
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const receiver = callee?.type === "MemberExpression" ? unwrap(callee.object) : null;
        if (callee === null || receiver === null || staticName(callee) !== "unref") return;
        unrefs.push({ call: node, receiver });
      },
      // Deferred to the end of the file: a class may unref `this.x` in a method written above the
      // one that assigns it.
      "Program:exit"() {
        for (const { call, receiver } of unrefs) {
          const verdict = classify(receiver, new Set());
          if (verdict === "owned") continue;
          const range = /** @type {[number, number]} */ (receiver.range);
          context.report({
            node: call,
            messageId: verdict === "process" ? "processHandle" : "unowned",
            data: { receiver: sourceCode.text.slice(range[0], range[1]) },
          });
        }
      },
    };
  },
};

export default rule;
