/**
 * @file errorReferencePage.test.ts
 * @description Pins `scripts/testing/lib/error-reference-page.mjs`, the renderer of
 *   `docs/api/ERROR_CODES.md`: the paths it names, the history being the one the sites gate reads,
 *   the header that says the page is generated and by which commands,
 *   one table per domain with every code's category, status, message, parameters and portals, the
 *   summary per domain, the existing sites per context at the birth and now, and the rows of their
 *   history. Each case renders from data it builds, as the registry gate hands it over, and reads
 *   the page's tables back cell by cell, so the content is pinned without pinning Prettier's column
 *   padding; one case pins that the page is already what Prettier writes.
 * @layer infrastructure
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import prettier from "prettier";
import { describe, expect, it } from "vitest";

interface PageCode {
  readonly code: string;
  readonly category: unknown;
  readonly status: unknown;
  readonly message: unknown;
  readonly params: unknown;
  readonly fronts: unknown;
}

interface PageRow {
  readonly file: string;
  readonly born: { readonly rule: string; readonly contexts: Record<string, number> } | undefined;
  readonly fixed: Record<string, number> | undefined;
  readonly moved:
    readonly { readonly from: string; readonly to: string; readonly count: number }[] | undefined;
}

interface PageSites {
  readonly rows: readonly PageRow[];
  readonly births: ReadonlyMap<string, number>;
  readonly now: ReadonlyMap<string, number>;
}

/** The module's surface; a literal import of an untyped `.mjs` would be an implicit any. */
type PageModule = {
  PAGE: string;
  REGISTRY_GATE: string;
  SITES_GATE: string;
  HISTORY_DIRECTORY: string;
  WRITE_COMMAND: string;
  renderReferencePage: (input: {
    domains: readonly { name: string; codes: readonly PageCode[] }[];
    sites: PageSites | null;
  }) => Promise<string>;
};

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const { PAGE, REGISTRY_GATE, SITES_GATE, HISTORY_DIRECTORY, WRITE_COMMAND, renderReferencePage } =
  (await import(
    path.join(REPO_ROOT, "scripts/testing/lib/error-reference-page.mjs")
  )) as PageModule;

const code = (name: string, fields: Partial<PageCode> = {}): PageCode => ({
  code: name,
  category: "not_found",
  status: 404,
  message: "The requested resource was not found",
  params: {},
  fronts: ["admin", "client"],
  ...fields,
});

const DOMAINS = [
  {
    name: "common",
    codes: [
      code("NOT_FOUND"),
      code("CONFLICT", {
        category: "conflict",
        status: 409,
        message: "The request conflicts with the current state of the resource",
      }),
    ],
  },
  {
    name: "auth",
    codes: [
      code("ADMINISTRATOR_ALREADY_EXISTS", {
        category: "conflict",
        status: 409,
        message: "An administrator already exists: {email}",
        params: { email: "string" },
        fronts: [],
      }),
    ],
  },
  { name: "platform", codes: [] },
];

const BIRTH: PageRow = {
  file: "scripts/testing/error-sites-history/2026-11-21-birth.json",
  born: { rule: "errors/no-inline-error", contexts: { "api/admin": 131, "core/auth": 62 } },
  fixed: undefined,
  moved: undefined,
};
const FIX: PageRow = {
  file: "scripts/testing/error-sites-history/2026-11-25-sign-in.json",
  born: undefined,
  fixed: { "core/auth": 12, "api/admin": 3 },
  moved: [{ from: "apps/api/src/admin/a.ts", to: "apps/api/src/auth/b.ts", count: 6 }],
};
const SITES: PageSites = {
  rows: [FIX, BIRTH],
  births: new Map([
    ["core/auth", 62],
    ["api/admin", 131],
  ]),
  now: new Map([
    ["api/admin", 122],
    ["core/auth", 50],
    ["api/auth", 6],
  ]),
};

/** The lines of the page. */
const linesOf = (page: string): string[] => page.split("\n");

/** The cells of a table row, split on every pipe not escaped by a backslash. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/**
 * The blocks of a section, up to the next heading: a paragraph as its text, a table as its rows of
 * cells, header included and separator dropped.
 */
const sectionOf = (page: string, heading: string): (string | string[][])[] => {
  const all = linesOf(page);
  const start = all.indexOf(heading);
  const end = all.findIndex((line, index) => index > start && line.startsWith("#"));
  const body = all.slice(start + 1, end === -1 ? all.length : end);
  const blocks: (string | string[][])[] = [];
  let current: string[] = [];
  for (const line of [...body, ""]) {
    if (line !== "") {
      current.push(line);
      continue;
    }
    if (current.length > 0 && current[0]?.startsWith("|") === true) {
      blocks.push(current.filter((_, index) => index !== 1).map(cellsOf));
    } else if (current.length > 0) {
      blocks.push(current.join(" "));
    }
    current = [];
  }
  return start === -1 ? [`no heading ${heading}`] : blocks;
};

describe("the page's identity", () => {
  it("is docs/api/ERROR_CODES.md, written by the gate's --write", () => {
    expect(PAGE).toBe("docs/api/ERROR_CODES.md");
    expect(WRITE_COMMAND).toBe("node scripts/testing/error-registry-gate.mjs --write");
  });

  it("names the history the sites gate reads, and the two gates as files this repository holds", async () => {
    const sites = (await import(path.join(REPO_ROOT, SITES_GATE))) as { HISTORY: string };

    expect(HISTORY_DIRECTORY).toBe(sites.HISTORY);
    expect(existsSync(path.join(REPO_ROOT, REGISTRY_GATE))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, SITES_GATE))).toBe(true);
  });

  it("is checked by a script of the root manifest that runs the registry gate and then the sites gate, so either one's exit fails it", () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["check:errors"]).toBe(
      "node scripts/testing/error-registry-gate.mjs && node scripts/testing/error-sites-gate.mjs"
    );
  });

  it("says in its header that it is generated, by which script, and the two commands", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: null });

    expect(linesOf(page)[0]).toBe("# Error codes");
    expect(linesOf(page)).toContain(
      "> Generated by `scripts/testing/error-registry-gate.mjs` from the error registry and " +
        "scripts/testing/error-sites-history/; never edit it by hand. " +
        "`node scripts/testing/error-registry-gate.mjs --write` regenerates it and " +
        "`pnpm check:errors` fails when it is stale."
    );
  });
});

describe("the codes", () => {
  it("summarises the codes per domain, in name order, with their total", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: null });

    expect(sectionOf(page, "## Summary")).toEqual([
      [
        ["Domain", "Codes"],
        ["`auth`", "1"],
        ["`common`", "2"],
        ["`platform`", "0"],
        ["**Total**", "3"],
      ],
    ]);
  });

  it("gives each domain a table of its codes in name order, with every column", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: null });

    expect(sectionOf(page, "## Domain `common`")).toEqual([
      [
        ["Code", "Category", "Status", "Message", "Parameters", "Portals"],
        [
          "`CONFLICT`",
          "conflict",
          "409",
          "The request conflicts with the current state of the resource",
          "none",
          "admin, client",
        ],
        [
          "`NOT_FOUND`",
          "not\\_found",
          "404",
          "The requested resource was not found",
          "none",
          "admin, client",
        ],
      ],
    ]);
  });

  it("names each parameter with its kind, and a code no portal receives as for logs only", async () => {
    const page = await renderReferencePage({
      domains: [
        {
          name: "auth",
          codes: [
            code("SIGN_IN_LOCKED", {
              category: "rate_limit",
              status: 429,
              message: "Locked for {minutes} minutes as {roles}",
              params: { minutes: "number", roles: "string[]" },
              fronts: [],
            }),
          ],
        },
      ],
      sites: null,
    });

    expect(sectionOf(page, "## Domain `auth`")).toEqual([
      [
        ["Code", "Category", "Status", "Message", "Parameters", "Portals"],
        [
          "`SIGN_IN_LOCKED`",
          "rate\\_limit",
          "429",
          "Locked for {minutes} minutes as {roles}",
          "`minutes` (number), `roles` (string\\[\\])",
          "logs only",
        ],
      ],
    ]);
  });

  it("writes None. under a domain that holds no code", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: null });

    expect(sectionOf(page, "## Domain `platform`")).toEqual(["None."]);
  });

  it("escapes what Markdown would read in a message, so it shows as written", async () => {
    const page = await renderReferencePage({
      domains: [
        {
          name: "common",
          codes: [code("NOT_FOUND", { message: "A | b, *not* <b>this</b>, `code` or [link]_x" })],
        },
      ],
      sites: null,
    });

    expect(sectionOf(page, "## Domain `common`")[0]?.[1]?.[3]).toBe(
      "A \\| b, \\*not\\* \\<b\\>this\\</b\\>, \\`code\\` or \\[link\\]\\_x"
    );
  });

  it.each([
    ["an entity", "Tom &amp; Jerry", "Tom \\&amp; Jerry"],
    ["a strikethrough", "It is ~~gone~~ now", "It is \\~\\~gone\\~\\~ now"],
  ])(
    "escapes %s in a message, so it shows as written and Prettier keeps it",
    async (_what, message, escaped) => {
      const page = await renderReferencePage({
        domains: [{ name: "common", codes: [code("NOT_FOUND", { message })] }],
        sites: null,
      });
      const config = await prettier.resolveConfig(path.join(REPO_ROOT, PAGE), {
        editorconfig: true,
      });

      const formatted = await prettier.format(page, { ...config, parser: "markdown" });

      expect(sectionOf(page, "## Domain `common`")[0]?.[1]?.[3]).toBe(escaped);
      expect(formatted).toBe(page);
    }
  );

  it("is the same page whatever order the domains and their codes come in", async () => {
    const reversed = [...DOMAINS]
      .reverse()
      .map((domain) => ({ ...domain, codes: [...domain.codes].reverse() }));

    const page = await renderReferencePage({ domains: DOMAINS, sites: SITES });
    const again = await renderReferencePage({
      domains: reversed,
      sites: { ...SITES, rows: [...SITES.rows].reverse() },
    });

    expect(again).toBe(page);
  });

  it("is already what Prettier writes with the repository's configuration", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: SITES });
    const config = await prettier.resolveConfig(path.join(REPO_ROOT, PAGE), { editorconfig: true });

    const formatted = await prettier.format(page, { ...config, parser: "markdown" });

    expect(formatted).toBe(page);
    expect(page.endsWith("\n")).toBe(true);
  });
});

describe("the existing sites", () => {
  it("says that no existing site is counted while there is no history", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: null });

    expect(sectionOf(page, "## Existing sites")).toEqual([
      "None yet: no `errors/` lint rule has been turned on, so scripts/testing/error-sites-history/ does not exist and no existing site is counted.",
    ]);
  });

  it("counts the sites per context in name order, at the birth and now, with their total", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: SITES });

    expect(sectionOf(page, "## Existing sites")).toEqual([
      "The sites `errors/no-inline-error` counted when it was turned on, per context: how many there were at the birth and how many still build or answer an error outside the registry now. The list only shrinks: `scripts/testing/error-sites-gate.mjs` refuses a rise, and each row of scripts/testing/error-sites-history/ records what one change fixed or moved.",
      [
        ["Context", "At the birth", "Now"],
        ["`api/admin`", "131", "122"],
        ["`api/auth`", "0", "6"],
        ["`core/auth`", "62", "50"],
        ["**Total**", "193", "178"],
      ],
    ]);
  });

  it("lists every row of the history in name order, with what it fixed and what it moved", async () => {
    const page = await renderReferencePage({ domains: DOMAINS, sites: SITES });

    expect(sectionOf(page, "### Rows")).toEqual([
      [
        ["Row", "Fixed", "Moved"],
        ["`2026-11-21-birth.json`", "birth of `errors/no-inline-error`: 193 sites", "none"],
        [
          "`2026-11-25-sign-in.json`",
          "3 in `api/admin`, 12 in `core/auth`",
          "6 from `apps/api/src/admin/a.ts` to `apps/api/src/auth/b.ts`",
        ],
      ],
    ]);
  });
});
