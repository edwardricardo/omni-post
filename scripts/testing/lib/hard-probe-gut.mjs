// @ts-check
/**
 * @file hard-probe-gut.mjs
 * @description The gutting of the hard probe: one module's text with the body of every exported
 *   function and public method replaced by `throw new Error("__HARD_PROBE__")`, through
 *   `ts.transform`, so a test that still passes against it never needed what those bodies did.
 *
 *   EXPORTED is read from the module's own syntax: a declaration with `export` (or `export
 *   default`), and a local declaration a later `export { name }` or `export default name` names.
 *
 *   GUTTED: a function declaration; a function expression or arrow function an exported variable
 *   or `export default` holds, through `as`, `satisfies`, `!`, a type assertion and parentheses;
 *   the methods, accessors and function-valued properties of an exported object literal, nested
 *   object literals included; the function-literal arguments of an exported variable's call
 *   initializer (`memo(fn)`, `forwardRef(fn)`, a call inside one), except that an arrow whose body
 *   is an object literal, as a store's creator `create((set) => ({ … }))` is, has that object's
 *   functions gutted instead, so the store is still created when the module loads; and in an
 *   exported class every public method, accessor and function-valued property.
 *
 *   KEPT as written: every other statement, the functions the module does not export, every
 *   constructor and every private, protected or `#private` member, so the module still loads, its
 *   top-level values still compute and its classes still construct. Named as left ungutted, so a
 *   probe can say its gutting was partial: an exported instance of a class the module declares and
 *   does not export, and an exported namespace. A module with nothing to gut is returned byte for
 *   byte. For the subject's closure it also reads the specifiers a module re-exports from, the
 *   base classes its classes extend and where a module gets a class it exports. It reads no file
 *   and spawns nothing.
 * @layer infrastructure
 */
import path from "node:path";
import ts from "typescript";

/** The message every gutted body throws. */
const MARKER = "__HARD_PROBE__";

/** The script kind each source extension is parsed as; `.tsx` and `.jsx` read JSX. */
const SCRIPT_KINDS = Object.freeze({
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
});

/** The modifiers that keep a class member out of a module's public surface. */
const NON_PUBLIC = new Set([ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword]);

/**
 * @typedef {object} Gutted
 * @property {string} text The module with its exported bodies replaced, or as given when none was.
 * @property {string[]} gutted What was gutted, in source order: `name` for a function,
 *   `Owner.member` for a method or a function-valued property of a class or an object, and
 *   `Owner.get member` and `Owner.set member` for an accessor.
 * @property {string[]} ungutted The exports left as written although they hold behaviour, in source
 *   order: `name (an instance of Class)` and `Name (a namespace)`.
 */

/**
 * @description Reads the script kind a file's extension names.
 * @param {string} fileName
 * @returns {ts.ScriptKind} TS for an extension it does not list.
 */
function scriptKindOf(fileName) {
  const extension = path.extname(fileName);
  return Object.hasOwn(SCRIPT_KINDS, extension)
    ? SCRIPT_KINDS[/** @type {keyof typeof SCRIPT_KINDS} */ (extension)]
    : ts.ScriptKind.TS;
}

/**
 * @description Reads a node's modifiers.
 * @param {ts.Node} node
 * @returns {readonly ts.ModifierLike[]}
 */
function modifiersOf(node) {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}

/**
 * @description Says whether a statement carries the `export` keyword.
 * @param {ts.Node} node
 * @returns {boolean}
 */
function exportKeyword(node) {
  return modifiersOf(node).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * @description Reads the local names a module exports by name rather than at their declaration:
 *   each name of an `export { … }` that re-exports nothing from another module, and the identifier
 *   of an `export default name`.
 * @param {ts.SourceFile} source
 * @returns {Set<string>}
 */
function exportedLocals(source) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      !statement.isTypeOnly &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text);
      }
    }
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      names.add(statement.expression.text);
    }
  }
  return names;
}

/**
 * @description Reads the classes a module declares and does not export, whose instances an export
 *   may hold.
 * @param {ts.SourceFile} source
 * @param {ReadonlySet<string>} locals
 * @returns {Set<string>}
 */
function unexportedClasses(source, locals) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
    if (!exportKeyword(statement) && !locals.has(statement.name.text)) {
      names.add(statement.name.text);
    }
  }
  return names;
}

/**
 * @description Says whether an expression is a function a variable or a property can hold.
 * @param {ts.Node | undefined} node
 * @returns {node is ts.ArrowFunction | ts.FunctionExpression}
 */
function isFunctionValue(node) {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/**
 * @description Says whether a class member is outside the class's public surface.
 * @param {ts.ClassElement} member
 * @returns {boolean}
 */
function nonPublic(member) {
  if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) return true;
  return modifiersOf(member).some((modifier) => NON_PUBLIC.has(modifier.kind));
}

/**
 * @description Guts one module.
 * @param {string} text The module's text.
 * @param {string} fileName Its path; the extension decides how it is parsed.
 * @returns {Gutted}
 */
export function gutModule(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName)
  );
  const locals = exportedLocals(source);
  const hidden = unexportedClasses(source, locals);
  /** @type {string[]} */
  const gutted = [];
  /** @type {string[]} */
  const ungutted = [];
  /** @type {ts.TransformerFactory<ts.SourceFile>} */
  const transformer = (context) => (file) => {
    const { factory } = context;
    const thrower = () =>
      factory.createBlock(
        [
          factory.createThrowStatement(
            factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
              factory.createStringLiteral(MARKER),
            ])
          ),
        ],
        true
      );
    /**
     * @param {ts.ArrowFunction | ts.FunctionExpression} node
     * @param {string} name
     * @returns {ts.Expression}
     */
    const gutFunction = (node, name) => {
      gutted.push(name);
      return ts.isArrowFunction(node)
        ? factory.updateArrowFunction(
            node,
            node.modifiers,
            node.typeParameters,
            node.parameters,
            node.type,
            node.equalsGreaterThanToken,
            thrower()
          )
        : factory.updateFunctionExpression(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.typeParameters,
            node.parameters,
            node.type,
            thrower()
          );
    };
    /**
     * @param {ts.PropertyName | undefined} name
     * @returns {string}
     */
    const nameOf = (name) => (name === undefined ? "" : name.getText(source));
    /**
     * Guts the functions an expression holds, seen through its wrappers; `calls` lets it descend
     * into a call's function arguments.
     * @param {ts.Expression} node
     * @param {string} name
     * @param {boolean} calls
     * @returns {ts.Expression}
     */
    const gutValue = (node, name, calls) => {
      if (ts.isParenthesizedExpression(node)) {
        return factory.updateParenthesizedExpression(node, gutValue(node.expression, name, calls));
      }
      if (ts.isAsExpression(node)) {
        return factory.updateAsExpression(node, gutValue(node.expression, name, calls), node.type);
      }
      if (ts.isSatisfiesExpression(node)) {
        return factory.updateSatisfiesExpression(
          node,
          gutValue(node.expression, name, calls),
          node.type
        );
      }
      if (ts.isTypeAssertionExpression(node)) {
        return factory.updateTypeAssertion(node, node.type, gutValue(node.expression, name, calls));
      }
      if (ts.isNonNullExpression(node)) {
        return factory.updateNonNullExpression(node, gutValue(node.expression, name, calls));
      }
      if (isFunctionValue(node)) return gutFunction(node, name);
      if (ts.isObjectLiteralExpression(node)) return gutObject(node, name);
      if (ts.isClassExpression(node)) {
        return factory.updateClassExpression(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          gutMembers(node, node.name?.text ?? name)
        );
      }
      if (calls && ts.isCallExpression(node)) {
        return factory.updateCallExpression(
          node,
          node.expression,
          node.typeArguments,
          node.arguments.map((argument) => gutArgument(argument, name))
        );
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        if (hidden.has(node.expression.text)) {
          ungutted.push(`${name} (an instance of ${node.expression.text})`);
        }
      }
      return node;
    };
    /**
     * A call's function argument; an arrow that returns an object literal keeps running, and that
     * object's functions are gutted instead.
     * @param {ts.Expression} argument
     * @param {string} name
     * @returns {ts.Expression}
     */
    const gutArgument = (argument, name) => {
      if (ts.isArrowFunction(argument) && !ts.isBlock(argument.body)) {
        let body = argument.body;
        while (ts.isParenthesizedExpression(body)) body = body.expression;
        if (ts.isObjectLiteralExpression(body)) {
          return factory.updateArrowFunction(
            argument,
            argument.modifiers,
            argument.typeParameters,
            argument.parameters,
            argument.type,
            argument.equalsGreaterThanToken,
            factory.createParenthesizedExpression(gutObject(body, name))
          );
        }
      }
      if (isFunctionValue(argument) || ts.isCallExpression(argument)) {
        return gutValue(argument, name, true);
      }
      return argument;
    };
    /**
     * @param {ts.ObjectLiteralExpression} node
     * @param {string} owner
     * @returns {ts.ObjectLiteralExpression}
     */
    const gutObject = (node, owner) =>
      factory.updateObjectLiteralExpression(
        node,
        node.properties.map((property) => {
          const name = nameOf(property.name);
          if (ts.isMethodDeclaration(property) && property.body !== undefined) {
            gutted.push(`${owner}.${name}`);
            return factory.updateMethodDeclaration(
              property,
              property.modifiers,
              property.asteriskToken,
              property.name,
              property.questionToken,
              property.typeParameters,
              property.parameters,
              property.type,
              thrower()
            );
          }
          if (ts.isGetAccessorDeclaration(property) && property.body !== undefined) {
            gutted.push(`${owner}.get ${name}`);
            return factory.updateGetAccessorDeclaration(
              property,
              property.modifiers,
              property.name,
              property.parameters,
              property.type,
              thrower()
            );
          }
          if (ts.isSetAccessorDeclaration(property) && property.body !== undefined) {
            gutted.push(`${owner}.set ${name}`);
            return factory.updateSetAccessorDeclaration(
              property,
              property.modifiers,
              property.name,
              property.parameters,
              thrower()
            );
          }
          if (ts.isPropertyAssignment(property)) {
            return factory.updatePropertyAssignment(
              property,
              property.name,
              gutValue(property.initializer, `${owner}.${name}`, false)
            );
          }
          return property;
        })
      );
    /**
     * @param {ts.ClassElement} member
     * @param {string} owner The class's name.
     * @returns {ts.ClassElement}
     */
    const gutMember = (member, owner) => {
      if (nonPublic(member)) return member;
      const name = nameOf(member.name);
      if (ts.isMethodDeclaration(member) && member.body !== undefined) {
        gutted.push(`${owner}.${name}`);
        return factory.updateMethodDeclaration(
          member,
          member.modifiers,
          member.asteriskToken,
          member.name,
          member.questionToken,
          member.typeParameters,
          member.parameters,
          member.type,
          thrower()
        );
      }
      if (ts.isGetAccessorDeclaration(member) && member.body !== undefined) {
        gutted.push(`${owner}.get ${name}`);
        return factory.updateGetAccessorDeclaration(
          member,
          member.modifiers,
          member.name,
          member.parameters,
          member.type,
          thrower()
        );
      }
      if (ts.isSetAccessorDeclaration(member) && member.body !== undefined) {
        gutted.push(`${owner}.set ${name}`);
        return factory.updateSetAccessorDeclaration(
          member,
          member.modifiers,
          member.name,
          member.parameters,
          thrower()
        );
      }
      if (ts.isPropertyDeclaration(member) && isFunctionValue(member.initializer)) {
        return factory.updatePropertyDeclaration(
          member,
          member.modifiers,
          member.name,
          member.questionToken ?? member.exclamationToken,
          member.type,
          gutFunction(member.initializer, `${owner}.${name}`)
        );
      }
      return member;
    };
    /**
     * @param {ts.ClassDeclaration | ts.ClassExpression} node
     * @param {string} owner
     * @returns {ts.ClassElement[]}
     */
    const gutMembers = (node, owner) => node.members.map((member) => gutMember(member, owner));
    /**
     * @param {ts.Statement} statement
     * @returns {ts.Statement}
     */
    const gutStatement = (statement) => {
      const named = (/** @type {ts.Identifier | undefined} */ name) =>
        exportKeyword(statement) || (name !== undefined && locals.has(name.text));
      if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
        if (!named(statement.name)) return statement;
        gutted.push(statement.name?.text ?? "default");
        return factory.updateFunctionDeclaration(
          statement,
          statement.modifiers,
          statement.asteriskToken,
          statement.name,
          statement.typeParameters,
          statement.parameters,
          statement.type,
          thrower()
        );
      }
      if (ts.isClassDeclaration(statement)) {
        if (!named(statement.name)) return statement;
        return factory.updateClassDeclaration(
          statement,
          statement.modifiers,
          statement.name,
          statement.typeParameters,
          statement.heritageClauses,
          gutMembers(statement, statement.name?.text ?? "default")
        );
      }
      if (ts.isVariableStatement(statement)) {
        const declarations = statement.declarationList.declarations.map((declaration) => {
          const { name, initializer } = declaration;
          if (!ts.isIdentifier(name) || !named(name) || initializer === undefined) {
            return declaration;
          }
          return factory.updateVariableDeclaration(
            declaration,
            name,
            declaration.exclamationToken,
            declaration.type,
            gutValue(initializer, name.text, true)
          );
        });
        return factory.updateVariableStatement(
          statement,
          statement.modifiers,
          factory.updateVariableDeclarationList(statement.declarationList, declarations)
        );
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        return factory.updateExportAssignment(
          statement,
          statement.modifiers,
          gutValue(statement.expression, "default", true)
        );
      }
      if (ts.isModuleDeclaration(statement) && exportKeyword(statement)) {
        const declared = modifiersOf(statement).some(
          (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
        );
        if (!declared && statement.body !== undefined) {
          ungutted.push(`${statement.name.getText(source)} (a namespace)`);
        }
      }
      return statement;
    };
    return factory.updateSourceFile(file, file.statements.map(gutStatement));
  };
  const result = ts.transform(source, [transformer]);
  try {
    const [transformed] = result.transformed;
    if (gutted.length === 0 || transformed === undefined) return { text, gutted: [], ungutted };
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    return { text: printer.printFile(transformed), gutted, ungutted };
  } finally {
    result.dispose();
  }
}

/**
 * @description Reads the specifiers a module re-exports from: every `export * from` and `export {
 *   … } from` that is not type-only, which load the module they name at run time.
 * @param {string} text The module's text.
 * @param {string} fileName Its path; the extension decides how it is parsed.
 * @returns {string[]} In source order.
 */
export function reExportSpecifiers(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    scriptKindOf(fileName)
  );
  return source.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    !statement.isTypeOnly &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : []
  );
}

/**
 * @typedef {object} ImportedName A name a module takes from another module.
 * @property {string} specifier As written.
 * @property {string} name The name the other module exports it under; `default` for a default.
 */

/**
 * @description Maps each local name a module imports at run time to where it comes from; a
 *   namespace import maps its local name to `*`.
 * @param {ts.SourceFile} source
 * @returns {Map<string, ImportedName>}
 */
function importedNames(source) {
  /** @type {Map<string, ImportedName>} */
  const names = new Map();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause === undefined ||
      statement.importClause.isTypeOnly
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const { name, namedBindings } = statement.importClause;
    if (name !== undefined) names.set(name.text, { specifier, name: "default" });
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      names.set(namedBindings.name.text, { specifier, name: "*" });
    }
    if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if (element.isTypeOnly) continue;
        names.set(element.name.text, {
          specifier,
          name: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  return names;
}

/**
 * @description Reads the base classes a module takes from other modules: the `extends` clause of
 *   every class it holds, declared or written as an expression, exported or not, whose base is a
 *   name it imports (`extends Base`, or `extends ns.Base` through a namespace import). A base the
 *   module declares itself is in the module already; a base built by a call is not read.
 * @param {string} text The module's text.
 * @param {string} fileName Its path; the extension decides how it is parsed.
 * @returns {ImportedName[]} Each base once, in source order.
 */
export function classBases(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName)
  );
  const imported = importedNames(source);
  /** @type {Map<string, ImportedName>} */
  const bases = new Map();
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        const expression = clause.types[0]?.expression;
        /** @type {ImportedName | undefined} */
        let base;
        if (expression !== undefined && ts.isIdentifier(expression)) {
          base = imported.get(expression.text);
          if (base?.name === "*") base = undefined;
        }
        if (
          expression !== undefined &&
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression)
        ) {
          const namespace = imported.get(expression.expression.text);
          if (namespace?.name === "*") {
            base = { specifier: namespace.specifier, name: expression.name.text };
          }
        }
        if (base !== undefined) bases.set(`${base.specifier}\0${base.name}`, base);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...bases.values()];
}

/**
 * @description Says where a module gets a class it exports under a name: from its own declaration,
 *   or from the modules it re-exports it from (`export { a as name } from`, `export * from`, or an
 *   import it re-exports by `export { name }`), in source order.
 * @param {string} text The module's text.
 * @param {string} fileName Its path; the extension decides how it is parsed.
 * @param {string} name The exported name; `default` for a default export.
 * @returns {{ local: boolean, sources: ImportedName[] }}
 */
export function exportSources(text, fileName, name) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName)
  );
  const imported = importedNames(source);
  const declared = new Set(
    source.statements.flatMap((statement) =>
      ts.isClassDeclaration(statement) && statement.name !== undefined ? [statement.name.text] : []
    )
  );
  /** @type {ImportedName[]} */
  const sources = [];
  /** @param {string} local */
  const reExportOf = (local) => {
    if (declared.has(local)) return true;
    const from = imported.get(local);
    if (from !== undefined && from.name !== "*") sources.push(from);
    return false;
  };
  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && exportKeyword(statement)) {
      const isDefault = modifiersOf(statement).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
      );
      if ((isDefault ? "default" : statement.name?.text) === name)
        return { local: true, sources: [] };
    }
    if (
      ts.isExportAssignment(statement) &&
      name === "default" &&
      ts.isIdentifier(statement.expression)
    ) {
      if (reExportOf(statement.expression.text)) return { local: true, sources: [] };
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    const specifier =
      statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    const clause = statement.exportClause;
    if (clause === undefined) {
      if (specifier !== null && name !== "default") sources.push({ specifier, name });
      continue;
    }
    if (!ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      if (element.name.text !== name) continue;
      const original = (element.propertyName ?? element.name).text;
      if (specifier !== null) sources.push({ specifier, name: original });
      else if (reExportOf(original)) return { local: true, sources: [] };
    }
  }
  return { local: false, sources };
}
