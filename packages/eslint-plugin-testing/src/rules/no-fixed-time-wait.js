// @ts-check
/**
 * @file no-fixed-time-wait.js
 * @description ESLint rule `testing/no-fixed-time-wait`: a test waits on the observable result of
 *   the work it started, never on a fixed amount of time. A fixed wait assumes the work is done
 *   when the time is up. On a loaded runner it is not, and the test fails, hangs, or asserts on a
 *   state the work has not reached yet; on an idle one it spends the whole delay for nothing.
 *   DEF-89 was this class: twenty `settle()` calls in `sagaStepOutcome.test.ts`, each a 20 ms
 *   timer. The fix is `until` from `@packages/vitest-shared/determinism`, which polls a probe of
 *   the result.
 *
 *   What the rule reports, decided on the syntax tree and never on line text:
 *   - A `new Promise(executor)` whose resolver, the executor's first parameter or a binding written
 *     from it, `setTimeout` receives as its callback or calls from the function it receives as its
 *     callback. `setTimeout` is the global, read bare or from `globalThis`, `global` or `window`,
 *     or the one imported from `node:timers`; a local binding of that name is not. Any delay
 *     counts, zero and none included. The promise is reported once, where it is built, so a
 *     `sleep()` or `settle()` helper is reported in its own body and its callers are not.
 *   - A value import of `setTimeout`, `setInterval` or `scheduler` from `timers/promises` or
 *     `node:timers/promises`: a named import, a destructuring of `require()` or `import()`, and a
 *     read of one of those names from the module object (a default or namespace import, a
 *     `require()` or `import()` result, or a binding of one). A type-only import is not reported.
 *   - A call of a `waitForTimeout` member, Playwright's fixed wait.
 *
 *   Not reported: a bare yield (`setImmediate`, `process.nextTick`), a timer whose callback
 *   rejects or settles nothing, a resolver called from a function nested inside the timer's
 *   callback (an event settles that promise, not the timer), and a poll whose timer callback is
 *   its own probe.
 *
 *   Allowed: a wait under a `// fixed-wait: <kind> — <why>` line comment that starts its own line
 *   directly above the statement holding the wait, or above a part of that statement that starts
 *   a line of its own (an object property, a call argument). Line comments may follow the marker
 *   down to that line. <kind> is one of KINDS. A marker with an unknown kind or no reason allows
 *   nothing and is reported; so is a marker above no reported wait.
 *
 *   Not seen: an alias of an alias of the resolver, a resolver stored in an object or bound with
 *   `.bind`, a timer read through a binding (`const later = setTimeout`), `setInterval` used for a
 *   single tick, `util.promisify(setTimeout)`, and a re-export of `timers/promises`.
 * @layer infrastructure
 */

/** The waits no observable result can replace, one per kind a `fixed-wait:` marker may name. */
const KINDS = ["latency-injection", "clock-advance", "interleaving", "poll-step", "ttl-expiry"];
const KIND_SET = new Set(KINDS);

/** A line comment that claims to be a marker, well formed or not. */
const MARKER = /^fixed-wait(?![\w-])/;

/** The global objects `setTimeout` can also be read from. */
const TIMER_ROOTS = new Set(["globalThis", "global", "window"]);

/** The modules that export the callback `setTimeout`. */
const TIMER_MODULES = new Set(["node:timers", "timers"]);

/** The modules whose exports wait a fixed time and settle a promise themselves. */
const PROMISE_TIMER_MODULES = new Set(["node:timers/promises", "timers/promises"]);

/** The exports of `timers/promises` that wait a fixed time; `setImmediate` only yields. */
const WAITERS = new Set(["setTimeout", "setInterval", "scheduler"]);

/** Nodes that start a function body: the resolver call's nearest one is the timer's callback. */
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

/** Wrappers that change neither the value nor what it waits on, with the key of what they wrap. */
const TRANSPARENT = new Map([
  ["ChainExpression", "expression"],
  ["TSAsExpression", "expression"],
  ["TSNonNullExpression", "expression"],
  ["TSSatisfiesExpression", "expression"],
  ["TSTypeAssertion", "expression"],
  ["AwaitExpression", "argument"],
]);

const FIX =
  "Wait on the observable result with `until` from `@packages/vitest-shared/determinism`, or " +
  "mark a deliberate wait with `// fixed-wait: <kind> — <why>` on the line above.";

/**
 * @typedef {{ type: string, [key: string]: unknown }} AstNode
 * @typedef {ReturnType<import("eslint").SourceCode["getAllComments"]>[number]} Comment
 * @typedef {import("eslint").AST.SourceLocation} Location
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
 * @param {unknown} value A node from ESLint or from its scope manager.
 * @returns {AstNode}
 */
function asNode(value) {
  return /** @type {AstNode} */ (value);
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
 * @param {AstNode} node
 * @param {string} key
 * @returns {AstNode[]}
 */
function children(node, key) {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
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
 * @param {AstNode} node
 * @returns {AstNode} The outermost transparent wrapper around `node`, or `node` itself.
 */
function outermost(node) {
  let current = node;
  for (let parent = current.parent; isNode(parent); parent = current.parent) {
    const key = TRANSPARENT.get(parent.type);
    if (key === undefined || parent[key] !== current) break;
    current = parent;
  }
  return current;
}

/**
 * @param {AstNode} node A `MemberExpression` or a `Property`.
 * @returns {string | null} The static key: `a.b`, `a["b"]`, `{ b }`, `{ b: c }`.
 */
function staticName(node) {
  const key = child(node, node.type === "MemberExpression" ? "property" : "key");
  if (key === null) return null;
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : null;
  if (node.computed === true || key.type !== "Identifier") return null;
  return typeof key.name === "string" ? key.name : null;
}

/**
 * @param {AstNode} specifier An `ImportSpecifier`.
 * @returns {string | null} The exported name it imports: `{ a }`, `{ a as b }`, `{ "a" as b }`.
 */
function importedName(specifier) {
  const imported = child(specifier, "imported");
  const name = imported?.type === "Literal" ? imported.value : imported?.name;
  return typeof name === "string" ? name : null;
}

/**
 * @param {unknown} value
 * @param {Set<string>} modules
 * @returns {boolean} Whether `value` is a string literal naming one of `modules`.
 */
function names(value, modules) {
  return isNode(value) && value.type === "Literal" && modules.has(`${value.value}`);
}

/**
 * @param {AstNode} node
 * @returns {AstNode | null} The function whose own body holds `node`.
 */
function enclosingFunction(node) {
  for (let current = node.parent; isNode(current); current = current.parent) {
    if (FUNCTIONS.has(current.type)) return current;
  }
  return null;
}

/**
 * @param {AstNode} node
 * @returns {boolean} Whether `node` is the unit a marker sits above: a statement, a declaration,
 *   or a class field, whose initialiser has no statement of its own.
 */
function isStatement(node) {
  return /(?:Statement|Declaration)$/.test(node.type) || node.type === "PropertyDefinition";
}

/**
 * @param {AstNode} node
 * @returns {AstNode[]} `node` and its ancestors up to the statement holding it, plus the export
 *   that wraps that statement: the nodes a marker may sit directly above.
 */
function anchorsOf(node) {
  /** @type {AstNode[]} */
  const anchors = [];
  /** @type {unknown} */
  let current = node;
  while (isNode(current) && current.type !== "Program") {
    anchors.push(current);
    const parent = current.parent;
    if (isStatement(current)) {
      if (isNode(parent) && parent.type.startsWith("Export")) anchors.push(parent);
      break;
    }
    current = parent;
  }
  return anchors;
}

/**
 * @param {Comment} comment A marker.
 * @returns {"markerKind" | "markerReason" | null} What is wrong with it, or `null` when it is
 *   `fixed-wait: <kind> — <why>` with a known kind and a reason.
 */
function markerProblem(comment) {
  const rest = comment.value.trim().slice("fixed-wait".length);
  if (!rest.startsWith(":")) return "markerKind";
  const body = rest.slice(1);
  const dash = body.indexOf("—");
  const kind = (dash === -1 ? body : body.slice(0, dash)).trim();
  if (!KIND_SET.has(kind)) return "markerKind";
  return dash === -1 || body.slice(dash + 1).trim() === "" ? "markerReason" : null;
}

/**
 * @param {Comment} comment
 * @returns {string} The marker as the messages show it.
 */
function markerText(comment) {
  return `// ${comment.value.trim()}`;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow waiting a fixed amount of time instead of on an observable result",
    },
    schema: [],
    messages: {
      promiseTimeout:
        "A promise resolved by `{{timer}}` waits a fixed time and assumes the work is done when " +
        `the time is up. ${FIX}`,
      timersPromises: `\`{{name}}\` from \`timers/promises\` waits a fixed time. ${FIX}`,
      waitForTimeout:
        "`waitForTimeout` waits a fixed time. Wait on the observable result: a web-first " +
        "assertion (`await expect(locator)…`), or `until` from " +
        "`@packages/vitest-shared/determinism`; or mark a deliberate wait with " +
        "`// fixed-wait: <kind> — <why>` on the line above.",
      markerKind:
        "`{{marker}}` is not a fixed-wait marker: the form is `// fixed-wait: <kind> — <why>`, " +
        `with <kind> one of ${KINDS.join(", ")}.`,
      markerReason:
        "`{{marker}}` gives no reason: add ` — <why>`, what the wait stands for and why no " +
        "observable result can replace it.",
      markerUnused:
        "`{{marker}}` marks no fixed wait: a marker goes on the line directly above the wait it " +
        "allows. Move it there, or delete it.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    /** The start offsets of the markers a reported wait has met. */
    const consumed = new Set();

    /**
     * @param {AstNode} node
     * @returns {import("eslint").Rule.Node}
     */
    function estree(node) {
      return /** @type {import("eslint").Rule.Node} */ (/** @type {unknown} */ (node));
    }

    /**
     * @param {AstNode} identifier
     * @param {string} name The identifier's name.
     * @returns {import("eslint").Scope.Variable | null}
     */
    function findVariable(identifier, name) {
      /** @type {import("eslint").Scope.Scope | null} */
      let scope = sourceCode.getScope(estree(identifier));
      for (; scope !== null; scope = scope.upper) {
        const variable = scope.set.get(name);
        if (variable !== undefined) return variable;
      }
      return null;
    }

    /**
     * @param {AstNode} identifier
     * @returns {import("eslint").Scope.Definition | null | undefined} The single definition of the
     *   identifier's binding; `null` for an unbound or global name, `undefined` for several.
     */
    function definitionOf(identifier) {
      const variable =
        typeof identifier.name === "string" ? findVariable(identifier, identifier.name) : null;
      if (variable === null || variable.defs.length === 0) return null;
      return variable.defs.length === 1 ? variable.defs[0] : undefined;
    }

    /**
     * @param {AstNode} identifier A bare `setTimeout`.
     * @returns {boolean} Whether it names the timer: the global, or the `node:timers` export.
     */
    function isTimerBinding(identifier) {
      const def = definitionOf(identifier);
      if (def === null) return true;
      if (def?.type !== "ImportBinding") return false;
      const specifier = asNode(def.node);
      return (
        specifier.type === "ImportSpecifier" &&
        importedName(specifier) === "setTimeout" &&
        isNode(def.parent) &&
        names(def.parent.source, TIMER_MODULES)
      );
    }

    /**
     * @param {unknown} callee
     * @returns {string | null} The callee's text when it is `setTimeout`, else `null`.
     */
    function timerName(callee) {
      const node = unwrap(callee);
      if (node === null) return null;
      if (node.type === "Identifier") {
        return node.name === "setTimeout" && isTimerBinding(node) ? "setTimeout" : null;
      }
      if (node.type !== "MemberExpression" || staticName(node) !== "setTimeout") return null;
      const root = unwrap(node.object);
      const global =
        root?.type === "Identifier" &&
        TIMER_ROOTS.has(`${root.name}`) &&
        definitionOf(root) === null;
      return global ? sourceCode.getText(estree(node)).replace(/\s*\n\s*/g, "") : null;
    }

    /**
     * @param {AstNode} identifier A read of the resolver or of its alias.
     * @returns {string | null} The timer that fires the resolver there: `setTimeout(resolve, n)`,
     *   or `setTimeout(() => resolve(), n)` with the call in the callback's own body.
     */
    function timerOf(identifier) {
      const value = outermost(identifier);
      const parent = value.parent;
      if (!isNode(parent) || parent.type !== "CallExpression") return null;
      if (children(parent, "arguments")[0] === value) return timerName(parent.callee);
      if (parent.callee !== value) return null;
      const callback = enclosingFunction(parent);
      if (callback === null) return null;
      const passed = outermost(callback);
      const call = passed.parent;
      const isCallback =
        isNode(call) && call.type === "CallExpression" && children(call, "arguments")[0] === passed;
      return isCallback ? timerName(call.callee) : null;
    }

    /**
     * @param {import("eslint").Scope.Variable} resolver
     * @returns {import("eslint").Scope.Variable[]} The bindings written from the resolver
     *   directly, one assignment deep: `const done = resolve`, `done = resolve`.
     */
    function aliasesOf(resolver) {
      /** @type {import("eslint").Scope.Variable[]} */
      const aliases = [];
      for (const reference of resolver.references) {
        const value = outermost(asNode(reference.identifier));
        const parent = value.parent;
        if (!isNode(parent)) continue;
        const declared = parent.type === "VariableDeclarator" && parent.init === value;
        const assigned =
          parent.type === "AssignmentExpression" &&
          parent.operator === "=" &&
          parent.right === value;
        const target = declared ? child(parent, "id") : assigned ? unwrap(parent.left) : null;
        if (target?.type !== "Identifier" || typeof target.name !== "string") continue;
        const alias = findVariable(target, target.name);
        if (alias !== null && alias !== resolver) aliases.push(alias);
      }
      return aliases;
    }

    /**
     * @param {unknown} value
     * @returns {boolean} Whether `value` is the `timers/promises` module object: a `require()` or
     *   `import()` of it, or a binding of one or of a default or namespace import.
     */
    function isPromiseTimers(value) {
      const node = unwrap(value);
      if (node === null) return false;
      if (node.type === "ImportExpression") return names(node.source, PROMISE_TIMER_MODULES);
      if (node.type === "CallExpression") {
        const callee = unwrap(node.callee);
        const required = callee?.type === "Identifier" && callee.name === "require";
        return required && names(children(node, "arguments")[0], PROMISE_TIMER_MODULES);
      }
      if (node.type !== "Identifier") return false;
      const def = definitionOf(node);
      if (def === null || def === undefined) return false;
      const definer = asNode(def.node);
      if (def.type === "ImportBinding") {
        const declaration = def.parent;
        const whole =
          definer.type === "ImportNamespaceSpecifier" || definer.type === "ImportDefaultSpecifier";
        return (
          whole &&
          isNode(declaration) &&
          declaration.importKind !== "type" &&
          names(declaration.source, PROMISE_TIMER_MODULES)
        );
      }
      const init = unwrap(definer.init);
      const direct = init?.type === "ImportExpression" || init?.type === "CallExpression";
      return def.type === "Variable" && definer.id === def.name && direct && isPromiseTimers(init);
    }

    /**
     * @param {AstNode} anchor
     * @returns {Comment | null} The marker in the block of own-line line comments that ends on
     *   the line directly above `anchor`, the one nearest to it.
     */
    function markerAbove(anchor) {
      const comments = sourceCode.getCommentsBefore(estree(anchor)).reverse();
      let line = /** @type {Location} */ (anchor.loc).start.line;
      for (const comment of comments) {
        const loc = /** @type {Location} */ (comment.loc);
        const before = (sourceCode.lines[loc.start.line - 1] ?? "").slice(0, loc.start.column);
        if (comment.type !== "Line" || loc.end.line !== line - 1 || before.trim() !== "") {
          return null;
        }
        if (MARKER.test(comment.value.trim())) return comment;
        line = loc.start.line;
      }
      return null;
    }

    /**
     * @param {AstNode} node What the rule found.
     * @param {string} messageId
     * @param {Record<string, string>} data
     */
    function report(node, messageId, data) {
      let marker = null;
      for (const anchor of anchorsOf(node)) {
        marker = markerAbove(anchor);
        if (marker !== null) break;
      }
      if (marker === null) {
        context.report({ node: estree(node), messageId, data });
        return;
      }
      const start = /** @type {[number, number]} */ (marker.range)[0];
      if (consumed.has(start)) return;
      consumed.add(start);
      const problem = markerProblem(marker);
      if (problem === null) return;
      const loc = /** @type {Location} */ (marker.loc);
      context.report({ loc, messageId: problem, data: { marker: markerText(marker) } });
    }

    return {
      NewExpression(node) {
        const callee = unwrap(node.callee);
        const executor = unwrap(node.arguments[0]);
        if (callee?.type !== "Identifier" || callee.name !== "Promise") return;
        if (executor === null || !FUNCTIONS.has(executor.type)) return;
        const first = children(executor, "params")[0];
        if (first?.type !== "Identifier") return;
        const declared = sourceCode.getDeclaredVariables(estree(executor));
        const resolver = declared.find((variable) => variable.name === first.name);
        if (resolver === undefined) return;
        for (const variable of [resolver, ...aliasesOf(resolver)]) {
          for (const reference of variable.references) {
            const timer = reference.isRead() ? timerOf(asNode(reference.identifier)) : null;
            if (timer === null) continue;
            report(asNode(node), "promiseTimeout", { timer });
            return;
          }
        }
      },
      ImportDeclaration(node) {
        const declaration = asNode(node);
        if (declaration.importKind === "type") return;
        if (!names(declaration.source, PROMISE_TIMER_MODULES)) return;
        for (const specifier of children(declaration, "specifiers")) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const name = importedName(specifier);
          if (name !== null && WAITERS.has(name)) report(specifier, "timersPromises", { name });
        }
      },
      VariableDeclarator(node) {
        const declarator = asNode(node);
        const pattern = child(declarator, "id");
        if (pattern?.type !== "ObjectPattern" || !isPromiseTimers(declarator.init)) return;
        for (const property of children(pattern, "properties")) {
          const name = property.type === "Property" ? staticName(property) : null;
          if (name !== null && WAITERS.has(name)) report(property, "timersPromises", { name });
        }
      },
      MemberExpression(node) {
        const member = asNode(node);
        const name = staticName(member);
        if (name === null || !WAITERS.has(name) || !isPromiseTimers(member.object)) return;
        report(member, "timersPromises", { name });
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee?.type !== "MemberExpression" || staticName(callee) !== "waitForTimeout") return;
        report(asNode(node), "waitForTimeout", {});
      },
      "Program:exit"() {
        for (const comment of sourceCode.getAllComments()) {
          const start = /** @type {[number, number]} */ (comment.range)[0];
          if (comment.type !== "Line" || consumed.has(start)) continue;
          if (!MARKER.test(comment.value.trim())) continue;
          const loc = /** @type {Location} */ (comment.loc);
          context.report({ loc, messageId: "markerUnused", data: { marker: markerText(comment) } });
        }
      },
    };
  },
};

export default rule;
