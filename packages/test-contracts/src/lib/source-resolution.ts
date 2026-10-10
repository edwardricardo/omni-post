/**
 * @file source-resolution.ts
 * @description Reads what a test module imports from the workspace: the specifiers the module
 *              resolves at run time, read through the TypeScript AST rather than by searching
 *              its text, and the workspace package each specifier names. Type-only imports are
 *              erased before a run, and text in comments or strings is not an import, so neither
 *              is returned.
 * @layer infrastructure
 */
import ts from "typescript";

/** A workspace package: its manifest name and its repository-relative directory. */
export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
}

/** The `vi` calls whose first argument vitest resolves as a module specifier. */
const VI_MODULE_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

/**
 * Reads the specifiers a module resolves at run time: value imports and re-exports, `import()`,
 * `require()` and the `vi` module calls. Type-only imports are erased before a run, and text in
 * comments or strings is not an import, so neither is returned.
 *
 * @param source - The module's text.
 * @param fileName - Its name, which selects the TypeScript or TSX grammar.
 * @returns The specifiers, in source order.
 */
export function runtimeSpecifiers(source: string, fileName: string): string[] {
  const found: string[] = [];
  const firstStringArgument = (call: ts.CallExpression): void => {
    const [argument] = call.arguments;
    if (argument !== undefined && ts.isStringLiteralLike(argument)) found.push(argument.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) firstStringArgument(node);
      else if (ts.isIdentifier(callee) && callee.text === "require") firstStringArgument(node);
      else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "vi" &&
        VI_MODULE_CALLS.has(callee.name.text)
      ) {
        firstStringArgument(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKind(fileName)));
  return found;
}

/**
 * @param fileName - A module's file name.
 * @returns The grammar TypeScript parses it with.
 */
function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * @param specifier - A bare module specifier.
 * @param packages - The workspace packages.
 * @returns The package the specifier names, itself or one of its subpaths, or `undefined`.
 */
export function owningPackage(
  specifier: string,
  packages: readonly WorkspacePackage[]
): WorkspacePackage | undefined {
  return packages.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`));
}
