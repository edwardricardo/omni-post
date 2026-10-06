/**
 * @file tailwindSources.test.ts
 * @description Pins the Tailwind v4 `@source` directives of the admin portal's
 *              `app/globals.css` to paths that exist. Tailwind resolves an `@source` path
 *              against the stylesheet's own directory, and a path that resolves to nothing
 *              fails no build: the classes that only the missed files use are never
 *              generated. The directive for the shared components read
 *              `../../packages/ui/src`, which resolves to `apps/packages/ui/src`, so every
 *              class that only `packages/ui` uses was missing from the production CSS
 *              (destructive and secondary Buttons and Badges rendered as plain text). The
 *              second test pins that `packages/ui/src` stays scanned, because deleting the
 *              directive would pass the first one.
 *
 *              Scope, stated narrowly: only `@source "<path>"` directives are read. The
 *              `@source not` and `@source inline(...)` forms are skipped, a `source(...)`
 *              argument on `@import "tailwindcss"` is not read (this stylesheet has none), and
 *              the file pattern after a glob's static prefix is not checked, so a path that
 *              exists but matches the wrong files still passes.
 *
 *              The helpers are copied in the client portal's twin of this file,
 *              `apps/client/tests/unit/styles/tailwindSources.test.ts`: the two portals share
 *              no test utilities package, so a change to one copy belongs in both.
 * @layer infrastructure
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const STYLESHEET = path.join(APP_ROOT, "app", "globals.css");
const SHARED_COMPONENTS_SOURCE = path.join(REPO_ROOT, "packages", "ui", "src");

/**
 * A quoted CSS string (group 1) or a block comment. CSS opens no comment inside a string, and
 * a glob that crosses directories holds a comment opener followed by a closer, so matching the
 * strings first is what keeps those globs whole when the comments are removed.
 */
const CSS_STRING_OR_COMMENT = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\/\*[\s\S]*?\*\//g;

/**
 * An `@source` directive whose argument is a quoted path or glob. The `not` and `inline(...)`
 * forms do not start with a quote, so they never match and are skipped.
 */
const SOURCE_PATH_DIRECTIVE = /@source\s+(?<quote>["'])(?<glob>.+?)\k<quote>\s*;/g;

/** Glob syntax the scanner expands: wildcards, character classes and brace sets. */
const GLOB_SYNTAX = /[*?[{]/;

interface SourcePathDirective {
  /** The directive as written in the stylesheet, quoted back in a failure message. */
  readonly text: string;
  /** The path or glob between the quotes. */
  readonly glob: string;
}

/**
 * @method readSourcePathDirectives
 * @description Reads every `@source "<path>";` directive of a stylesheet, ignoring the ones
 *              inside a comment: a directive inside a comment is not a directive.
 * @param css - The stylesheet's source text.
 * @returns The path directives, in source order.
 */
function readSourcePathDirectives(css: string): SourcePathDirective[] {
  const withoutComments = css.replace(
    CSS_STRING_OR_COMMENT,
    (_match: string, quoted: string | undefined) => quoted ?? ""
  );
  const directives: SourcePathDirective[] = [];
  for (const match of withoutComments.matchAll(SOURCE_PATH_DIRECTIVE)) {
    const glob = match.groups?.glob;
    if (glob !== undefined) directives.push({ text: match[0], glob });
  }
  return directives;
}

/**
 * @method resolveStaticPrefix
 * @description Resolves the part of a glob that names a real path against the stylesheet's
 *              directory: the whole string when it holds no glob syntax, otherwise everything
 *              up to the last `/` before the first glob character, so `../src/*.tsx` and
 *              `../src/{a,b}.ts` both resolve `../src/`.
 * @param glob - The path or glob of one `@source` directive.
 * @returns The absolute path that must exist for the directive to scan anything.
 */
function resolveStaticPrefix(glob: string): string {
  const firstGlobCharacter = glob.search(GLOB_SYNTAX);
  const prefix =
    firstGlobCharacter === -1 ? glob : glob.slice(0, glob.lastIndexOf("/", firstGlobCharacter) + 1);
  return path.resolve(path.dirname(STYLESHEET), prefix);
}

describe("Tailwind @source directives of the admin portal's app/globals.css", () => {
  it("resolves every @source directive of globals.css to an existing path", () => {
    // Arrange
    const directives = readSourcePathDirectives(readFileSync(STYLESHEET, "utf8"));

    // Act
    const unresolved = directives
      .map((directive) => ({ directive, resolved: resolveStaticPrefix(directive.glob) }))
      .filter(({ resolved }) => !existsSync(resolved))
      .map(
        ({ directive, resolved }) =>
          `${directive.text} resolves to ${path.relative(REPO_ROOT, resolved)}, which does not exist`
      );

    // Assert
    expect(
      directives,
      "no @source path directive was read, so an empty pass would prove nothing"
    ).not.toHaveLength(0);
    expect(unresolved).toEqual([]);
  });

  it("scans packages/ui/src, where the shared components write their classes", () => {
    // Arrange
    const directives = readSourcePathDirectives(readFileSync(STYLESHEET, "utf8"));

    // Act
    const scannedPaths = directives.map((directive) => resolveStaticPrefix(directive.glob));

    // Assert
    expect(scannedPaths).toContain(SHARED_COMPONENTS_SOURCE);
  });
});
