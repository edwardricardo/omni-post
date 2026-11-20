/**
 * @file noCorsHeaders.test.ts
 * @description Holds the API to sending no CORS header. No browser calls it cross-origin: both
 *   portals call their own `/api/backend/*` and their servers call the API, so a CORS header would
 *   only let a page on another origin read a response. The suites of the security manager and of
 *   the webhook stream pin the two sites that had one through `app.inject`; no unit test boots
 *   `createApp()`, so this suite reads every source file under `apps/api/src` instead and fails on
 *   CORS written anywhere: a CORS response header named in code (`Access-Control-Allow-*`,
 *   `Access-Control-Expose-*`, `Access-Control-Max-Age`), a string that names `@fastify/cors` or
 *   `fastify-cors`, which catches an import, a `require`, a dynamic import and a load by path, the
 *   bare name `cors` as a module specifier (after `from` or `import`, or inside `import(`,
 *   `require(`, `require.resolve(` or `import.meta.resolve(`), or a CORS plugin in
 *   `apps/api/package.json`, by its name or by its specifier, so an npm alias
 *   (`"my-cors": "npm:@fastify/cors@11.1.0"`) fails too. Each finding names its file and line.
 *
 *   Escaped slashes are masked and comments blanked first, with `blankComments` of
 *   `scripts/legal/lib/source-scan.mjs`, so prose that explains the absence is no finding. It is
 *   textual, not a parser, and it cannot see:
 *   - a header name or a plugin name built from parts (`"Access-Control-" + "Allow-Origin"`,
 *     `require("@fastify/" + "cors")`), spelled with escape sequences, or read from configuration
 *     or data;
 *   - CORS written by a workspace package the API loads, whose source and manifest live outside
 *     `apps/api`;
 *   - code hidden by a regex character class that holds a comment opener, since the blanking does
 *     not track regex literals: `//` in one (`/[//]/`) hides the rest of that same line, and `/*`
 *     in one (`/[/*]/`) hides everything up to the next `*\/`. An escaped slash (`/^\/*$/`) is
 *     masked before the blanking, so it hides nothing.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type Listing = { files: string[]; missing: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Scanner = {
  listSourceFiles: (root: string, options: { roots: string[] }) => Listing;
  blankComments: (text: string) => string;
};
type Manifest = Record<string, Record<string, string> | undefined>;

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const scan = (await import(
  pathToFileURL(path.join(REPO_ROOT, "scripts/legal/lib/source-scan.mjs")).href
)) as Scanner;

const API_SOURCE = "apps/api/src";
const API_MANIFEST = "apps/api/package.json";
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const CORS_PLUGINS = new Set(["@fastify/cors", "fastify-cors", "cors"]);
/** A specifier that installs a CORS plugin under any name: an npm alias, a git or a path one. */
const CORS_PLUGIN_SPECIFIER = /(?:^|[:/])(?:@fastify\/cors|fastify-cors|cors)(?:[@/#.]|$)/;

/**
 * What a finding is, each with the group that holds the text it reports. A request header such as
 * `Access-Control-Request-Method` is no CORS response header and is not matched.
 */
const FINDINGS: readonly RegExp[] = [
  /(access-control-(?:allow-[a-z-]*|expose-[a-z-]*|max-age))/gi,
  /(@fastify\/cors|fastify-cors)/g,
  /(?:\b(?:from|import)\s*|\b(?:import(?:\.meta\.resolve)?|require(?:\.resolve)?)\s*\(\s*)(["'`]cors(?:\/[^"'`\n]*)?["'`])/g,
];

/**
 * Masks every escaped slash with an underscore of the same length. The blanking does not track
 * regex literals, so the `\/*` of `/^\/*$/` would open a block comment and hide every line up to
 * the next `*\/`. Masking removes slashes and never adds one, so it opens no comment.
 */
const maskEscapedSlashes = (text: string): string => text.replace(/\\\//g, "\\_");

/**
 * The CORS findings of one source text, as `<file>:<line>: <text>`, in the order they appear.
 */
function corsFindings(file: string, text: string): string[] {
  const code = scan.blankComments(maskEscapedSlashes(text));
  const hits = FINDINGS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => ({
      at: match.index,
      text: match[1] ?? match[0],
    }))
  );
  return hits
    .sort((a, b) => a.at - b.at)
    .map(({ at, text: found }) => `${file}:${code.slice(0, at).split("\n").length}: ${found}`);
}

/**
 * The dependencies of a manifest that install a CORS plugin, by name or by specifier, as
 * `<manifest>: <block>.<name> = <specifier>`.
 */
function manifestFindings(manifest: Manifest): string[] {
  return DEPENDENCY_BLOCKS.flatMap((block) =>
    Object.entries(manifest[block] ?? {})
      .filter(([name, spec]) => CORS_PLUGINS.has(name) || CORS_PLUGIN_SPECIFIER.test(spec))
      .map(([name, spec]) => `${API_MANIFEST}: ${block}.${name} = ${spec}`)
  );
}

describe("the API sends no CORS header", () => {
  it("names no CORS response header and loads no CORS plugin in any source file of the API", () => {
    const { files, missing } = scan.listSourceFiles(REPO_ROOT, { roots: [API_SOURCE] });

    expect(missing).toEqual([]);
    expect(files).toContain("apps/api/src/index.ts");
    expect(files).toContain("apps/api/src/security/securityHeaders.ts");

    const findings = files.flatMap((file) =>
      corsFindings(file, readFileSync(path.join(REPO_ROOT, file), "utf8"))
    );
    expect(findings).toEqual([]);
  });

  it("declares no CORS plugin among the API's dependencies, by name or by specifier", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, API_MANIFEST), "utf8")
    ) as Manifest;

    expect(Object.keys(manifest.dependencies ?? {})).toContain("@fastify/helmet");
    expect(manifestFindings(manifest)).toEqual([]);
  });

  it("finds a header in a string, a key or a template and a plugin by name or path, never in a comment", () => {
    const sample = [
      "// Access-Control-Allow-Origin is never sent: no browser calls the API cross-origin.",
      "/* Access-Control-Max-Age and @fastify/cors are absent too. */",
      'reply.header("Access-Control-Allow-Origin", "*");',
      'reply.raw.writeHead(200, { "access-control-expose-headers": "x-request-id" });',
      "const maxAge = `Access-Control-Max-Age: 600`;",
      'import cors from "@fastify/cors";',
      'await app.register((await import("/store/node_modules/@fastify/cors/index.js")).default);',
      'const legacy = require("cors");',
      'const method = request.headers["access-control-request-method"];',
      String.raw`const onlySlashes = /^\/*$/;`,
      'reply.header("Access-Control-Allow-Credentials", "true");',
      String.raw`const scheme = /https?:\/\//; reply.header("Access-Control-Allow-Methods", "GET");`,
      "/* a later comment */",
    ].join("\n");

    expect(corsFindings("sample.ts", sample)).toEqual([
      "sample.ts:3: Access-Control-Allow-Origin",
      "sample.ts:4: access-control-expose-headers",
      "sample.ts:5: Access-Control-Max-Age",
      "sample.ts:6: @fastify/cors",
      "sample.ts:7: @fastify/cors",
      'sample.ts:8: "cors"',
      "sample.ts:11: Access-Control-Allow-Credentials",
      "sample.ts:12: Access-Control-Allow-Methods",
    ]);
  });

  it("finds the bare name cors in a side-effect import, and not in a word that only contains it", () => {
    const sample = ['import "cors";', "import 'cors/lib/index.js';", 'import "cors-utils";'].join(
      "\n"
    );

    expect(corsFindings("sample.ts", sample)).toEqual([
      'sample.ts:1: "cors"',
      "sample.ts:2: 'cors/lib/index.js'",
    ]);
  });

  it("finds the bare name cors where a module is resolved rather than loaded", () => {
    const sample = [
      'const where = require.resolve("cors");',
      'const url = import.meta.resolve("cors");',
      'const mode = { mode: "cors" };',
    ].join("\n");

    expect(corsFindings("sample.ts", sample)).toEqual([
      'sample.ts:1: "cors"',
      'sample.ts:2: "cors"',
    ]);
  });

  it("finds a CORS plugin in a dependency's name or in its specifier, an npm alias included", () => {
    const manifest: Manifest = {
      dependencies: { "@fastify/helmet": "13.0.1", "my-cors": "npm:@fastify/cors@11.1.0" },
      devDependencies: { cors: "2.8.5", "cors-utils": "1.0.0", vendored: "github:x/fastify-cors" },
    };

    expect(manifestFindings(manifest)).toEqual([
      `${API_MANIFEST}: dependencies.my-cors = npm:@fastify/cors@11.1.0`,
      `${API_MANIFEST}: devDependencies.cors = 2.8.5`,
      `${API_MANIFEST}: devDependencies.vendored = github:x/fastify-cors`,
    ]);
  });
});
