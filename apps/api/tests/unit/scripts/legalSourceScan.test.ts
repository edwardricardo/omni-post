/**
 * @file legalSourceScan.test.ts
 * @description Pins `scripts/legal/lib/source-scan.mjs`, the scanner the legal inventory
 *   generators share: the files a scan lists and skips, a root that is one file, the missing root
 *   it reports so its caller fails closed, comment blanking, argument splitting, multi-line call
 *   sites, same-file name resolution, the names a file binds to a call, and the entries of an
 *   object-literal argument. File cases run on scratch trees; the suite imports no generator.
 * @layer infrastructure
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Listing = { files: string[]; missing: string[] };
type Matcher = { name: string; pattern: RegExp };
type Site = { file: string; line: number; matcher: string; args: string[] };
/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type Scanner = {
  listSourceFiles: (root: string, options: { roots: string[] }) => Listing;
  blankComments: (text: string) => string;
  splitArguments: (code: string, start: number) => string[];
  scanFile: (file: string, text: string, matchers: Matcher[]) => Site[];
  resolveStringArgument: (text: string, arg: string) => string | null;
  bindingsOf: (text: string, callee: string) => string[];
  objectEntries: (arg: string, keys: string[]) => string[];
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const scan = (await import(path.join(REPO_ROOT, "scripts/legal/lib/source-scan.mjs"))) as Scanner;

let root = "";

const put = (file: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), "");
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "legal-source-scan-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listSourceFiles", () => {
  it("lists sources sorted, skipping tests, stories, declarations, output and env files", () => {
    const skipped = ["a.test.ts", "a.spec.tsx", "A.stories.tsx", "a.d.ts", ".env.js", "notes.md"];
    const dirs = ["", "node_modules/p/", "dist/", ".next/", ".turbo/", "coverage/", "tests/"];
    for (const dir of [...dirs, "__tests__/"]) {
      skipped.forEach((file) => put(`src/${dir}${file}`));
      put(`src/${dir}index.js`);
    }
    ["src/b/z.tsx", "src/a.mjs"].forEach(put);

    const listing = scan.listSourceFiles(root, { roots: ["src"] });

    expect(listing).toEqual({ files: ["src/a.mjs", "src/b/z.tsx", "src/index.js"], missing: [] });
  });

  it("takes a root that is one file, and reports a missing root instead of scanning less", () => {
    ["proxy.ts", "src/a.ts"].forEach(put);

    const listing = scan.listSourceFiles(root, { roots: ["src", "proxy.ts", "gone", "gone.ts"] });

    expect(listing).toEqual({ files: ["proxy.ts", "src/a.ts"], missing: ["gone", "gone.ts"] });
  });
});

describe("reading source text", () => {
  it("blanks line and block comments, keeping newlines, offsets and strings", () => {
    const text = "a(); // x\n/* y\nz */ b(\"//\", '/*');";

    expect(scan.blankComments(text)).toBe("a();     \n    \n     b(\"//\", '/*');");
  });

  it("splits arguments at top-level commas, keeping strings and brackets whole", () => {
    const code = 'f(a,\n  { b:\n [1, 2], c: "x, y" },\n  "q\\",(",\n) + rest(1, 2)';

    expect(scan.splitArguments(code, 2)).toEqual(["a", '{ b: [1, 2], c: "x, y" }', '"q\\",("']);
  });

  it("finds multi-line calls and assignments on their lines, never one inside a comment", () => {
    const text =
      'x.set(\n  "a",\n  1\n);\n// x.set("no");\ndoc = "k=v";\n/* x.set("no") */ x.set(B)';
    const matchers = [
      { name: "assign", pattern: /\bdoc\s*=/ },
      { name: "set", pattern: /\bx\.set\(/g },
    ];

    expect(scan.scanFile("f.ts", text, matchers)).toEqual([
      { file: "f.ts", line: 1, matcher: "set", args: ['"a"', "1"] },
      { file: "f.ts", line: 6, matcher: "assign", args: ['"k=v"'] },
      { file: "f.ts", line: 7, matcher: "set", args: ["B"] },
    ]);
  });

  it("resolves a literal or a same-file const, `export` and `as const` members included", () => {
    const declared = [
      "export const EXPORTED = \"e\"; const NAME = 'n'; const TYPED: string = `y`;",
      'const KEYS = { THEME: "t", "QUOTED": `q` } as const; let MUTABLE = "m";',
      'const TWICE = "a";\nconst TWICE = "b";\nconst TEMPLATE = `d_${id}`;\n// const GONE = "c";',
    ].join("\n");
    const resolve = (args: string): Array<string | null> =>
      args.split(" ").map((arg) => scan.resolveStringArgument(declared, arg));

    const found = resolve("\"a\" 'b' `c` EXPORTED NAME TYPED KEYS.THEME KEYS.QUOTED");
    const missed = resolve("`x_${y}` MUTABLE TWICE TEMPLATE GONE KEYS.NONE IMPORTED");

    expect(found).toEqual("a b c e n y t q".split(" "));
    expect(missed).toEqual(Array.from(missed, () => null));
    expect(missed).toHaveLength(7);
  });

  it("reads the names bound to a call, awaited or not, outside comments", () => {
    const text = "const store = await cookies();\nlet jar = cookies();\n// const old = cookies();";

    expect(scan.bindingsOf(`${text}\nconst x = cookiesOf();`, "cookies")).toEqual(["store", "jar"]);
  });

  it("keeps the named entries and spreads of an object literal, nothing of another argument", () => {
    const keys = ["maxAge", "path"];
    const options = '{ ...BASE, maxAge: 60, maxAgeX: 1, domain: "x",\n path: "/" }';

    expect(scan.objectEntries(options, keys)).toEqual(["...BASE", "maxAge: 60", 'path: "/"']);
    expect(scan.objectEntries("options", keys)).toEqual([]);
  });
});
