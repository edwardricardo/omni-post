// @ts-check
/**
 * @file schema-names.mjs
 * @description The variable names an environment schema module declares, read from its syntax
 *   tree by the `typescript` package and never by importing it: an environment module validates
 *   the process environment when it loads. A name is a key of the object literal a `createEnv`
 *   call takes as its `server`, `client` or `shared` block, inline or held by a `const` of the
 *   same module; a spread in that object is followed to the object literal its function returns
 *   or its `const` holds, in the same module or in the one an import names. A comment declares
 *   nothing, and `runtimeEnv`, which repeats a portal's keys, is no block. What the reader cannot
 *   name (a computed key, a spread it cannot follow, a module with no `createEnv` call) is a
 *   problem, never a shorter list. Only names leave this module: no initializer is read for its
 *   value, so a default or a literal never reaches the caller.
 * @layer infrastructure
 */
import ts from "typescript";

/** The `createEnv` options that hold a schema; every other option is configuration. */
const SCHEMA_BLOCKS = Object.freeze(["server", "client", "shared"]);

/** @typedef {{ file: string, text: string }} Module */
/** @typedef {(specifier: string, from: string) => Module | null} LoadModule */
/** @typedef {{ module: Module, source: ts.SourceFile }} Parsed */

/** @type {(module: Module) => Parsed} */
const parse = (module) => ({
  module,
  source: ts.createSourceFile(module.file, module.text, ts.ScriptTarget.Latest, true),
});

/** @type {(node: ts.Expression) => ts.Expression} the expression under `as`, `satisfies`, `!` and parentheses */
function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** @type {(source: ts.SourceFile, name: string) => ts.Node | undefined} a top-level function or `const` named `name` */
function declarationOf(source, name) {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    const found = statement.declarationList.declarations.find(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

/** @type {(source: ts.SourceFile, name: string) => { specifier: string, exported: string } | undefined} */
function importOf(source, name) {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    const element = bindings.elements.find((binding) => binding.name.text === name);
    if (element === undefined) continue;
    const exported = element.propertyName?.getText(source) ?? name;
    return { specifier: statement.moduleSpecifier.text, exported };
  }
  return undefined;
}

/** @type {(node: ts.Node | undefined) => ts.Expression | undefined} what a function returns, or what a `const` holds */
function valueOf(node) {
  if (node === undefined) return undefined;
  if (ts.isVariableDeclaration(node)) {
    const init = node.initializer === undefined ? undefined : unwrap(node.initializer);
    return init !== undefined && ts.isArrowFunction(init) ? valueOf(init) : init;
  }
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return node.body;
  const body = ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ? node.body : undefined;
  if (body === undefined || !ts.isBlock(body)) return undefined;
  const returns = body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 ? returns[0]?.expression : undefined;
}

/** @typedef {{ object: ts.ObjectLiteralExpression, at: Parsed, trail: readonly string[] }} Found */

/**
 * The object literal an expression stands for, in the module it is written in: a literal, a
 * `const` of that module, a call of a function of that module, or either through an import.
 * `trail` holds what is being followed, so a spread that loops back ends instead of recursing.
 * @type {(node: ts.Expression, at: Parsed, load: LoadModule, trail: readonly string[]) => Found | undefined}
 */
function objectOf(node, at, load, trail) {
  const expression = unwrap(node);
  if (ts.isObjectLiteralExpression(expression)) return { object: expression, at, trail };
  const callee = ts.isCallExpression(expression) ? unwrap(expression.expression) : expression;
  if (!ts.isIdentifier(callee)) return undefined;
  const step = `${at.module.file}#${callee.text}`;
  if (trail.includes(step)) return undefined;
  const local = valueOf(declarationOf(at.source, callee.text));
  if (local !== undefined) return objectOf(local, at, load, [...trail, step]);
  const imported = importOf(at.source, callee.text);
  const module = imported === undefined ? null : load(imported.specifier, at.module.file);
  if (imported === undefined || module === null) return undefined;
  const there = parse(module);
  const value = valueOf(declarationOf(there.source, imported.exported));
  return value === undefined ? undefined : objectOf(value, there, load, [...trail, step]);
}

/** @type {(name: ts.PropertyName) => string | undefined} a key written literally; a computed one is not */
const keyOf = (name) =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;

/**
 * How a problem names a spread: by the identifier it reads or calls, never by its arguments,
 * which may hold a literal value.
 * @type {(node: ts.Expression) => string}
 */
function spreadLabel(node) {
  const expression = unwrap(node);
  const callee = ts.isCallExpression(expression) ? unwrap(expression.expression) : expression;
  if (!ts.isIdentifier(callee)) return "a spread of an expression";
  return `the spread ...${callee.text}${callee === expression ? "" : "()"}`;
}

/**
 * The keys of a schema object, its spreads followed.
 * @type {(found: Found, load: LoadModule, problems: string[]) => string[]}
 */
function keysOf({ object, at, trail }, load, problems) {
  return object.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) {
      const found = objectOf(property.expression, at, load, trail);
      if (found !== undefined) return keysOf(found, load, problems);
      const label = spreadLabel(property.expression);
      problems.push(`${at.module.file}: ${label} resolves to no object literal`);
      return [];
    }
    const key = property.name === undefined ? undefined : keyOf(property.name);
    if (key !== undefined) return [key];
    const line = at.source.getLineAndCharacterOfPosition(property.getStart(at.source)).line + 1;
    problems.push(`${at.module.file}:${line}: a key with no literal name`);
    return [];
  });
}

/** @type {(source: ts.SourceFile) => ts.CallExpression[]} every `createEnv(...)` call of a module */
function createEnvCalls(source) {
  /** @type {ts.CallExpression[]} */
  const calls = [];
  /** @type {(node: ts.Node) => void} */
  const visit = (node) => {
    const callee = ts.isCallExpression(node) ? unwrap(node.expression) : undefined;
    if (ts.isCallExpression(node) && callee !== undefined && ts.isIdentifier(callee)) {
      if (callee.text === "createEnv") calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/**
 * The sorted, distinct names a schema module declares, and what the reader could not name.
 * @param {Module} module - The schema module's repository path and text.
 * @param {LoadModule} load - Resolves an import of the module to the module it names, or `null`.
 * @returns {{ names: string[], problems: string[] }} the names, and one problem per unread part
 */
export function schemaNames(module, load) {
  const at = parse(module);
  /** @type {string[]} */
  const problems = [];
  const calls = createEnvCalls(at.source);
  if (calls.length === 0) return { names: [], problems: [`${module.file}: no createEnv call`] };
  const names = calls.flatMap((call) => {
    const options = call.arguments[0] === undefined ? undefined : unwrap(call.arguments[0]);
    if (options === undefined || !ts.isObjectLiteralExpression(options)) {
      problems.push(`${module.file}: createEnv takes no object literal`);
      return [];
    }
    return options.properties.flatMap((option) => {
      const block = option.name === undefined ? undefined : keyOf(option.name);
      if (block === undefined || !SCHEMA_BLOCKS.includes(block)) return [];
      const value = ts.isPropertyAssignment(option)
        ? option.initializer
        : ts.isShorthandPropertyAssignment(option)
          ? option.name
          : undefined;
      const found = value === undefined ? undefined : objectOf(value, at, load, []);
      if (found !== undefined) return keysOf(found, load, problems);
      problems.push(`${module.file}: the ${block} block resolves to no object literal`);
      return [];
    });
  });
  return { names: [...new Set(names)].sort(), problems };
}
