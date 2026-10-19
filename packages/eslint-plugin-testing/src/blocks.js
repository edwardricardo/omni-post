// @ts-check
/**
 * @file blocks.js
 * @description `discoverBlocks(text, fileName)`: the test blocks of one file and what their syntax
 *   says before any assertion is read. Syntactic only: the tree is `ts.createSourceFile`'s and no
 *   type checker runs.
 *
 *   Blocks: `describe`, `it`, `test` and `suite` under every name they are imported as (vitest
 *   globals included), with `.each`, `.for`, `.concurrent`, `.sequential`, `.fails`, `.skip`,
 *   `.only`, `.todo`, `.skipIf` and `.runIf`, node:test's `t.test` subtests, and Playwright's
 *   `test.describe` with `.serial` and `.parallel`, and Playwright's own skip modifier. A block
 *   holding other blocks is a container: it is not reported, its title prefixes its children's
 *   `describe` path and its skip markers reach them. Every block holding no other block is
 *   reported, with its kind, title, location, modifiers as written and skip markers.
 *
 *   Skip markers: a skip modifier (`.skip`, `.todo`, `.skipIf`, `.runIf`, Playwright's), a `skip`
 *   or `todo` option that is not `false` (`option:skip`), a container's marker (`parent:<marker>`),
 *   a `<context>.skip()` or `<context>.todo()` call in the body (`context.skip`), and `todo` for a
 *   vitest block with no function.
 *
 *   Hashes: a block's `bodyHash` is sha256 of its body's tokens, blind to whitespace and comments;
 *   the file's `fileContextHash` is sha256 of the source with every reported block's body removed,
 *   so it moves with imports, mocks, hooks and titles and not with a block's body.
 *
 *   The result also carries the file's import bindings and the syntax nodes of each block, for the
 *   classifier in `classify.js`; the nodes are not part of any serialized finding.
 * @layer infrastructure
 */
import { createHash } from "node:crypto";
import ts from "typescript";

/**
 * @typedef {"vitest" | "node"} Framework
 * @typedef {"describe" | "it" | "test" | "suite" | "t.test"} BlockKind
 * @typedef {ts.ArrowFunction | ts.FunctionExpression} FunctionLiteral
 *
 * @typedef {object} Binding A value binding of an import declaration.
 * @property {string} local
 * @property {string} imported `default` for a default import, `*` for a namespace import.
 * @property {string} from The module specifier.
 *
 * @typedef {object} Location 1-based.
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 *
 * @typedef {object} LeafBlock
 * @property {string} id `file:line:title`.
 * @property {Framework} framework
 * @property {BlockKind} kind
 * @property {string} title
 * @property {string[]} describe The titles of the containers around it, outermost first.
 * @property {Location} loc
 * @property {string[]} modifiers As written: `["concurrent", "each"]`.
 * @property {string[]} skips
 * @property {string} bodyHash
 * @property {ts.CallExpression} call
 * @property {FunctionLiteral | null} callback
 * @property {ts.Expression | null} external A callback passed by name.
 *
 * @typedef {object} FileBlocks
 * @property {ts.SourceFile} sourceFile
 * @property {Framework} framework
 * @property {Binding[]} bindings
 * @property {LeafBlock[]} blocks In source order.
 * @property {string} fileContextHash
 *
 * @typedef {object} TestCall
 * @property {BlockKind} kind
 * @property {string} title
 * @property {string[]} modifiers
 * @property {FunctionLiteral | null} callback
 * @property {ts.ObjectLiteralExpression | null} options
 * @property {ts.Expression | null} external
 *
 * @typedef {object} Scope
 * @property {string[]} describe
 * @property {string[]} skips Skip markers of the containers around it.
 * @property {Set<string>} contexts Callback parameters a `<name>.test(...)` subtest hangs off.
 *
 * @typedef {object} Leaf
 * @property {ts.CallExpression} call
 * @property {TestCall} test
 * @property {Scope} scope
 */

const DEFAULT_TEST_API = /** @type {const} */ (["describe", "it", "test", "suite"]);
const PROPERTY_MODIFIERS = new Set(
  "skip only todo concurrent sequential fails shuffle fixme serial parallel".split(" ")
);
const CALL_MODIFIERS = new Set(["each", "for", "skipIf", "runIf"]);
const SKIP_MODIFIERS = new Set(["skip", "todo", "skipIf", "runIf", "fixme"]);
const SKIP_OPTIONS = new Set(["skip", "todo"]);
const NODE_TEST_MODULES = new Set(["node:test", "test"]);

/**
 * @param {string} text
 * @returns {string}
 */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @param {ts.Expression} node
 * @returns {node is FunctionLiteral}
 */
const isFunctionLiteral = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/**
 * @param {string} fileName
 * @returns {ts.ScriptKind}
 */
function scriptKindOf(fileName) {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {{ framework: Framework, bindings: Binding[] }} `node` when the file imports a value
 *   clause from `node:test`, else `vitest`; and every value binding of its import declarations, in
 *   source order.
 */
function importsOf(sourceFile) {
  /** @type {Framework} */
  let framework = "vitest";
  /** @type {Binding[]} */
  const bindings = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const from = statement.moduleSpecifier.text;
    if (NODE_TEST_MODULES.has(from)) framework = "node";
    if (clause.name !== undefined)
      bindings.push({ local: clause.name.text, imported: "default", from });
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) {
      bindings.push({ local: named.name.text, imported: "*", from });
    }
    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.isTypeOnly) continue;
        const imported = (element.propertyName ?? element.name).text;
        bindings.push({ local: element.name.text, imported, from });
      }
    }
  }
  return { framework, bindings };
}

/**
 * @param {Binding[]} bindings
 * @returns {Map<string, BlockKind>} Local name to block kind: the globals, and every name a block
 *   function is imported as from `vitest` or `node:test`.
 */
function testApiOf(bindings) {
  /** @type {Map<string, BlockKind>} */
  const testApi = new Map(DEFAULT_TEST_API.map((name) => [name, name]));
  for (const { local, imported, from } of bindings) {
    if (!NODE_TEST_MODULES.has(from) && from !== "vitest") continue;
    const kind = DEFAULT_TEST_API.find((name) => name === imported);
    if (kind !== undefined) testApi.set(local, kind);
    else if (imported === "default") testApi.set(local, "test");
  }
  return testApi;
}

/**
 * @param {ts.Expression | undefined} arg
 * @returns {string}
 */
function titleOf(arg) {
  if (arg === undefined) return "";
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg)) return arg.getText().slice(1, -1);
  return arg.getText();
}

/**
 * @param {ts.CallExpression} call
 * @param {Map<string, BlockKind>} testApi
 * @param {Scope} scope
 * @returns {TestCall | null} The call read as a test block, or `null`.
 */
function readTestCall(call, testApi, scope) {
  /** @type {string[]} */
  const modifiers = [];
  let current = call.expression;
  for (;;) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      CALL_MODIFIERS.has(current.expression.name.text)
    ) {
      modifiers.unshift(current.expression.name.text);
      current = current.expression.expression;
    } else if (
      ts.isPropertyAccessExpression(current) &&
      PROPERTY_MODIFIERS.has(current.name.text)
    ) {
      modifiers.unshift(current.name.text);
      current = current.expression;
    } else break;
  }
  /** @type {BlockKind | null} */
  let kind = null;
  if (ts.isIdentifier(current)) kind = testApi.get(current.text) ?? null;
  else if (
    ts.isPropertyAccessExpression(current) &&
    current.name.text === "describe" &&
    ts.isIdentifier(current.expression) &&
    testApi.has(current.expression.text)
  ) {
    kind = "describe";
  } else if (
    ts.isPropertyAccessExpression(current) &&
    current.name.text === "test" &&
    ts.isIdentifier(current.expression) &&
    scope.contexts.has(current.expression.text)
  ) {
    kind = "t.test";
  }
  if (kind === null) return null;
  const rest = call.arguments.slice(1);
  const callback = [...rest].reverse().find(isFunctionLiteral) ?? null;
  const external =
    callback === null
      ? (rest.find((arg) => !ts.isObjectLiteralExpression(arg) && !ts.isNumericLiteral(arg)) ??
        null)
      : null;
  const options = rest.find(ts.isObjectLiteralExpression) ?? null;
  return { kind, title: titleOf(call.arguments[0]), modifiers, callback, options, external };
}

/**
 * @param {TestCall} test
 * @param {Framework} framework
 * @returns {string[]} The block's own static skip markers.
 */
function ownSkips(test, framework) {
  const skips = test.modifiers.filter((modifier) => SKIP_MODIFIERS.has(modifier));
  for (const property of test.options?.properties ?? []) {
    const name =
      property.name !== undefined && ts.isIdentifier(property.name) ? property.name.text : "";
    if (!SKIP_OPTIONS.has(name)) continue;
    const value = ts.isPropertyAssignment(property) ? property.initializer : null;
    const off =
      value !== null &&
      (value.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isIdentifier(value) && value.text === "undefined"));
    if (!off) skips.push(`option:${name}`);
  }
  const noFunction = test.callback === null && test.external === null;
  if (noFunction && framework === "vitest" && !skips.includes("todo")) skips.push("todo");
  return skips;
}

/**
 * @param {FunctionLiteral} callback
 * @returns {string[]} `context.skip` / `context.todo` when the body skips itself at run time.
 */
function runtimeSkips(callback) {
  const parameter = callback.parameters[0]?.name;
  if (parameter === undefined) return [];
  const owner = ts.isIdentifier(parameter) ? parameter.text : null;
  const destructured = new Set(
    ts.isObjectBindingPattern(parameter)
      ? parameter.elements.map((element) =>
          ts.isIdentifier(element.name) ? element.name.text : ""
        )
      : []
  );
  /** @type {Set<string>} */
  const skips = new Set();
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const member =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === owner
          ? callee.name.text
          : null;
      const local = ts.isIdentifier(callee) && destructured.has(callee.text) ? callee.text : null;
      const name = member ?? local;
      if (name !== null && SKIP_OPTIONS.has(name)) skips.add(`context.${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return [...skips].sort();
}

/**
 * @param {ts.Node} node
 * @param {Scope} scope
 * @param {{ testApi: Map<string, BlockKind>, framework: Framework }} file
 * @param {Leaf[]} out
 */
function discover(node, scope, file, out) {
  const test = ts.isCallExpression(node) ? readTestCall(node, file.testApi, scope) : null;
  if (test === null || !ts.isCallExpression(node)) {
    ts.forEachChild(node, (child) => discover(child, scope, file, out));
    return;
  }
  const parameter = test.callback?.parameters[0]?.name;
  /** @type {Scope} */
  const inner = {
    describe: [...scope.describe, test.title],
    skips: [...scope.skips, ...ownSkips(test, file.framework).map((skip) => `parent:${skip}`)],
    contexts: new Set(scope.contexts),
  };
  if (parameter !== undefined && ts.isIdentifier(parameter)) inner.contexts.add(parameter.text);
  /** @type {Leaf[]} */
  const children = [];
  if (test.callback !== null) discover(test.callback.body, inner, file, children);
  if (children.length > 0) out.push(...children);
  else out.push({ call: node, test, scope });
}

/**
 * @param {ts.Node | undefined} body
 * @param {ts.SourceFile} sourceFile
 * @returns {string} sha256 of the body's tokens joined by a space; comments and layout drop out.
 */
function hashBody(body, sourceFile) {
  /** @type {string[]} */
  const tokens = [];
  /** @param {ts.Node} node */
  const visit = (node) => {
    const children = node.getChildren(sourceFile).filter((child) => !ts.isJSDoc(child));
    if (children.length === 0) {
      const text = node.getText(sourceFile);
      if (text !== "") tokens.push(text);
    }
    children.forEach(visit);
  };
  if (body !== undefined) visit(body);
  return sha256(tokens.join(" "));
}

/**
 * @param {Leaf} leaf
 * @param {string} fileName
 * @param {ts.SourceFile} sourceFile
 * @param {Framework} framework
 * @returns {LeafBlock}
 */
function toLeafBlock(leaf, fileName, sourceFile, framework) {
  const { call, test, scope } = leaf;
  const start = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(call.getEnd());
  return {
    id: `${fileName}:${start.line + 1}:${test.title}`,
    framework,
    kind: test.kind,
    title: test.title,
    describe: scope.describe,
    loc: {
      line: start.line + 1,
      col: start.character + 1,
      endLine: end.line + 1,
      endCol: end.character + 1,
    },
    modifiers: test.modifiers,
    skips: [
      ...ownSkips(test, framework),
      ...scope.skips,
      ...(test.callback === null ? [] : runtimeSkips(test.callback)),
    ],
    bodyHash: hashBody(test.callback?.body, sourceFile),
    call,
    callback: test.callback,
    external: test.external,
  };
}

/**
 * @description Finds every test block of one file that holds no other block, syntactically.
 * @param {string} text The file's source.
 * @param {string} fileName The path its block ids carry; its extension picks the parser (`.tsx`,
 *   `.jsx`, `.js`, else TypeScript).
 * @returns {FileBlocks} The parsed file, its framework and import bindings, its reported blocks in
 *   source order, and its file-context hash.
 */
export function discoverBlocks(text, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName)
  );
  const { framework, bindings } = importsOf(sourceFile);
  /** @type {Leaf[]} */
  const leaves = [];
  /** @type {Scope} */
  const root = { describe: [], skips: [], contexts: new Set() };
  discover(sourceFile, root, { testApi: testApiOf(bindings), framework }, leaves);
  const bodies = leaves
    .map((leaf) => leaf.test.callback?.body)
    .filter((body) => body !== undefined)
    .map((body) => [body.getStart(sourceFile), body.getEnd()])
    .sort((left, right) => (right[0] ?? 0) - (left[0] ?? 0));
  let blanked = text;
  for (const [from = 0, to = 0] of bodies) blanked = blanked.slice(0, from) + blanked.slice(to);
  return {
    sourceFile,
    framework,
    bindings,
    blocks: leaves.map((leaf) => toLeafBlock(leaf, fileName, sourceFile, framework)),
    fileContextHash: sha256(blanked),
  };
}
