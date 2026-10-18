// @ts-check
/**
 * @file no-child-process-in-unit.js
 * @description ESLint rule `testing/no-child-process-in-unit`: a unit test starts no process. A
 *   test that spawns pays the child's start-up cost inside the runner's time budget and depends on
 *   what the machine has installed, so it passes on one runner and times out on a loaded one.
 *   DEF-84 was this class: a unit case that ran `mkdir`, `find` and `npm ls` for real took 7.4 s
 *   in CI against Vitest's 5 s default. The fix is a seam: the code under test receives its process
 *   runner, and the test passes a double; a test of a script that must spawn lives under
 *   `tests/unit/scripts/`, which the repository's config leaves out of this rule.
 *
 *   What the rule reports, decided on the syntax tree: a load of `node:child_process` or
 *   `child_process` as a value. That is an import with a default, a namespace or a named value
 *   specifier, or with none (a bare import); a re-export; TypeScript's `import x = require()`; a
 *   call of an identifier named `require`, the global or one made by `createRequire`; and a
 *   dynamic `import()`. The specifier is a string literal or a template literal with no
 *   expression.
 *
 *   Not reported: a type-only import or re-export, an import whose every specifier is an inline
 *   type, `typeof import()` in a type, and the module's name passed to anything but `require` and
 *   `import()`, such as `vi.mock`.
 *
 *   Not seen: a unit test that imports a module which spawns on its behalf (a script under
 *   `scripts/`, or a library helper), a specifier built at run time, and `module.require` or any
 *   other member call that loads a module.
 * @layer infrastructure
 */

/** The specifiers that load the module this rule keeps out of unit tests. */
const MODULES = new Set(["node:child_process", "child_process"]);

/**
 * @typedef {{ type: string, [key: string]: unknown }} AstNode
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
 * @returns {AstNode}
 */
function asNode(value) {
  return /** @type {AstNode} */ (value);
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
 * @param {unknown} value A module specifier.
 * @returns {string | null} The module it names, when that is fixed in the source: a string
 *   literal, or a template literal with no expression.
 */
function moduleName(value) {
  if (!isNode(value)) return null;
  if (value.type === "Literal") return typeof value.value === "string" ? value.value : null;
  if (value.type !== "TemplateLiteral" || children(value, "expressions").length > 0) return null;
  const [quasi] = children(value, "quasis");
  const cooked = isNode(quasi) ? asNode(quasi.value).cooked : null;
  return typeof cooked === "string" ? cooked : null;
}

/**
 * @param {AstNode} specifier A specifier of an `ImportDeclaration`.
 * @returns {boolean} Whether it binds a value: a default, a namespace, or a named import that is
 *   not an inline type.
 */
function bindsValue(specifier) {
  if (specifier.type === "ImportDefaultSpecifier") return true;
  if (specifier.type === "ImportNamespaceSpecifier") return true;
  return specifier.type === "ImportSpecifier" && specifier.importKind !== "type";
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow loading `child_process` in a unit test" },
    schema: [],
    messages: {
      childProcess:
        "`{{source}}` is loaded in a unit test: a unit test starts no process. Give the code " +
        "under test its process runner and pass a double, or move a test that must spawn under " +
        "`tests/unit/scripts/`.",
    },
  },
  create(context) {
    /**
     * @param {AstNode} node What loads the module.
     * @param {unknown} specifier The module specifier.
     */
    function check(node, specifier) {
      const source = moduleName(specifier);
      if (source === null || !MODULES.has(source)) return;
      const estree = /** @type {import("eslint").Rule.Node} */ (/** @type {unknown} */ (node));
      context.report({ node: estree, messageId: "childProcess", data: { source } });
    }

    return {
      ImportDeclaration(node) {
        const declaration = asNode(node);
        if (declaration.importKind === "type") return;
        const specifiers = children(declaration, "specifiers");
        if (specifiers.length > 0 && !specifiers.some(bindsValue)) return;
        check(declaration, declaration.source);
      },
      ExportNamedDeclaration(node) {
        const declaration = asNode(node);
        if (declaration.exportKind === "type") return;
        check(declaration, declaration.source);
      },
      ExportAllDeclaration(node) {
        const declaration = asNode(node);
        if (declaration.exportKind === "type") return;
        check(declaration, declaration.source);
      },
      ImportExpression(node) {
        check(asNode(node), node.source);
      },
      CallExpression(node) {
        const callee = asNode(node.callee);
        if (callee.type !== "Identifier" || callee.name !== "require") return;
        check(asNode(node), node.arguments[0]);
      },
      /**
       * TypeScript's `import x = require("…")`, which the default parser does not produce.
       * @param {unknown} node
       */
      TSImportEqualsDeclaration(node) {
        const declaration = asNode(node);
        const reference = declaration.moduleReference;
        if (declaration.importKind === "type" || !isNode(reference)) return;
        if (reference.type !== "TSExternalModuleReference") return;
        check(declaration, reference.expression);
      },
    };
  },
};

export default rule;
