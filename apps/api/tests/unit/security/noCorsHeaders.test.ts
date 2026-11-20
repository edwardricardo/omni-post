/**
 * @file noCorsHeaders.test.ts
 * @description Holds the API to sending no CORS header. No browser calls it cross-origin: both
 *   portals call their own `/api/backend/*` and their servers call the API, so a CORS header would
 *   only let a page on another origin read a response. The suites of the security manager and of
 *   the webhook stream pin the two sites that had one through `app.inject`; no unit test boots
 *   `createApp()`, so this suite reads every source file under `apps/api/src` instead and fails on
 *   CORS written anywhere: a CORS response header named in code (`Access-Control-Allow-*`,
 *   `Access-Control-Expose-*`, `Access-Control-Max-Age`), a string that names a CORS plugin, which
 *   catches an import, a `require`, a dynamic import and a load by path, or a CORS plugin among the
 *   API's dependencies. Each finding names its file and line.
 *
 *   Comments are blanked first, with `blankComments` of `scripts/legal/lib/source-scan.mjs`, so
 *   prose that explains the absence is no finding. It is textual, not a parser, and it cannot see:
 *   a header name built by concatenation, or read from configuration or data; CORS written by a
 *   workspace package the API loads, whose source lives outside `apps/api/src`; and a line after a
 *   regex literal that holds `//`, which the blanking treats as a comment.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

type Listing = { files: string[]; missing: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Scanner = {
  listSourceFiles: (root: string, options: { roots: string[] }) => Listing;
  blankComments: (text: string) => string;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const scan = (await import(path.join(REPO_ROOT, "scripts/legal/lib/source-scan.mjs"))) as Scanner;

const API_SOURCE = "apps/api/src";
const API_MANIFEST = "apps/api/package.json";
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const CORS_PLUGINS = new Set(["@fastify/cors", "fastify-cors", "cors"]);

/**
 * What a finding is, each with the group that holds the text it reports. A request header such as
 * `Access-Control-Request-Method` is no CORS response header and is not matched.
 */
const FINDINGS: readonly RegExp[] = [
  /(access-control-(?:allow-[a-z-]*|expose-[a-z-]*|max-age))/gi,
  /(@fastify\/cors|fastify-cors)/g,
  /(?:\bfrom\s*|\b(?:import|require)\s*\(\s*)(["'`]cors(?:\/[^"'`\n]*)?["'`])/g,
];

/**
 * The CORS findings of one source text, as `<file>:<line>: <text>`, in the order they appear.
 */
function corsFindings(file: string, text: string): string[] {
  const code = scan.blankComments(text);
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

  it("declares no CORS plugin among the API's dependencies", () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, API_MANIFEST), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;

    expect(Object.keys(manifest.dependencies ?? {})).toContain("@fastify/helmet");

    const declared = DEPENDENCY_BLOCKS.flatMap((block) =>
      Object.keys(manifest[block] ?? {})
        .filter((name) => CORS_PLUGINS.has(name))
        .map((name) => `${API_MANIFEST}: ${block}.${name}`)
    );
    expect(declared).toEqual([]);
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
    ].join("\n");

    expect(corsFindings("sample.ts", sample)).toEqual([
      "sample.ts:3: Access-Control-Allow-Origin",
      "sample.ts:4: access-control-expose-headers",
      "sample.ts:5: Access-Control-Max-Age",
      "sample.ts:6: @fastify/cors",
      "sample.ts:7: @fastify/cors",
      'sample.ts:8: "cors"',
    ]);
  });
});
