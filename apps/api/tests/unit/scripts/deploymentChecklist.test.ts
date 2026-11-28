/**
 * @file deploymentChecklist.test.ts
 * @description Pins `pnpm check:deployment` (`scripts/deployment/`): the names the tree reads, taken
 *   from the structure of the four environment schemas and from the whole text of the workflows
 *   (a spread fragment followed, a name in a schema comment ignored, a portal name declared twice
 *   counted once, a `vars.X` in a YAML comment read, every context inside an expression resolved
 *   to a name or refused, a form that reads a context with no name refused), and the four
 *   holdings: every name is named by a
 *   checklist table row, declared in the classification or pending there; the pending count equals
 *   `pendingBaseline`; every `path:line` citation of the checklist resolves; and the generated
 *   inventory page equals the committed one. Each holding is driven through the runner, so a case
 *   asserts its exit code and its message, and the command itself is run once in each mode on the
 *   real tree. Each other case runs on a scratch tree that starts green, with a directory beside
 *   it that stands for everything outside the repository.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Module = { file: string; text: string };
type Load = (specifier: string, from: string) => Module | null;
type Found = { names: string[]; problems: string[] };
type Nameless = { line: number; context: string; form: string };
type References = { vars: string[]; secrets: string[]; nameless: Nameless[] };
type Entry = Record<string, unknown>;
type Built = { pagePath: string; markdown: string; problems: string[]; scopeError?: string };
type Commands = { label: string; write: string; check: string };
type Generator = { name: string; generate: () => Promise<Built> };
/** The modules' surface; a literal import of an untyped `.mjs` would be an implicit any. */
type SchemaNames = { schemaNames: (module: Module, load: Load) => Found };
type WorkflowReferences = { workflowReferences: (text: string) => References };
type Inventory = {
  COMMANDS: Commands;
  generator: { name: string; generate: (options?: { root: string }) => Promise<Built> };
};
type Runner = {
  runGenerators: (
    generators: Generator[],
    options: { check: boolean; root: string; commands: Commands }
  ) => Promise<number>;
};
type Run = { exitCode: number; stdout: string[]; stderr: string[] };

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const LIB = path.join(REPO_ROOT, "scripts/deployment/lib");
const loadSchemaNames = async (): Promise<SchemaNames> =>
  (await import(path.join(LIB, "schema-names.mjs"))) as SchemaNames;
const loadWorkflowReferences = async (): Promise<WorkflowReferences> =>
  (await import(path.join(LIB, "workflow-references.mjs"))) as WorkflowReferences;
const loadInventory = async (): Promise<Inventory> =>
  (await import(path.join(REPO_ROOT, "scripts/deployment/inventory.mjs"))) as Inventory;
const { runGenerators } = (await import(
  path.join(REPO_ROOT, "scripts/legal/lib/inventory.mjs")
)) as Runner;

/** The names the fixture tree declares, each once. */
const NAME = {
  nodeEnv: "NODE_ENV",
  region: "REGION",
  key: "KEY",
  keyV1: "KEY_V1",
  redisUrl: "REDIS_URL",
  apiUrl: "API_URL",
  publicUrl: "NEXT_PUBLIC_URL",
  publicApiUrl: "NEXT_PUBLIC_API_URL",
  browserDsn: "BROWSER_DSN",
  deployToken: "DEPLOY_TOKEN",
} as const;
/** A name a schema writes in a comment only, which declares nothing. */
const UNREAD = { schemaComment: "COMMENT_ONLY" };
/** Names a workflow writes in a comment only, which the workflow reader still reads. */
const IN_COMMENT = { yaml: "COMMENTED_VAR", trailing: "TRAILING_VAR" };
/** Values the fixture writes and the output must never carry. */
const VALUE = {
  schemaDefault: "literal-default-value",
  workflowLiteral: "literal-workflow-value",
  envFile: "value-of-an-environment-file",
};

const FRAGMENT = "packages/shared/src/keyFields.ts";
const FRAGMENT_SPECIFIER = "@shared/types/keyFields.js";
const SCHEMA = {
  api: "apps/api/src/config/env.ts",
  workers: "apps/workers/src/config/env.ts",
  admin: "apps/admin/lib/env.ts",
  client: "apps/client/lib/env.ts",
} as const;
const WORKFLOW = ".github/workflows/build.yml";

/** A portal schema: one server key, one client key, and `runtimeEnv` repeating both. */
const portalSchema = (server: string, client: string): string =>
  [
    'import { createEnv } from "@t3-oss/env-nextjs";',
    'import { z } from "zod";',
    "export const env = createEnv({",
    `  server: { ${server}: z.string().url().default("http://localhost:3000") },`,
    `  client: { ${client}: z.string().url().default("http://localhost:3100") },`,
    `  runtimeEnv: { ${server}: process.env.${server}, ${client}: process.env.${client} },`,
    "});",
    "",
  ].join("\n");

/**
 * The fixture workflow: a block scalar whose shell comment and command read one name each, and two
 * YAML comments whose texts are `comment` and `trailing`, which name nothing by default.
 */
const makeWorkflow = ({
  comment = "a YAML comment",
  trailing = "a trailing comment",
} = {}): string =>
  [
    "name: Build",
    `# ${comment}`,
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: |",
    `          # a shell comment Actions still expands: \${{ secrets.${NAME.deployToken} }}`,
    `          echo "\${{ vars.${NAME.browserDsn} }}"`,
    "        env:",
    `          LITERAL: "${VALUE.workflowLiteral}" # ${trailing}`,
    "",
  ].join("\n");

/** The fixture tree: every file a reader takes, keyed by its repository path. */
const makeTree = (overrides: Record<string, string> = {}): Record<string, string> => ({
  "tsconfig.base.json": JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "bundler",
      paths: { "@shared/types/*": ["./packages/shared/src/*"] },
    },
  }),
  [FRAGMENT]: [
    'import { z } from "zod";',
    "export function keyFields(min: number) {",
    `  return { ${NAME.key}: z.string().min(min), ${NAME.keyV1}: z.string().min(min).optional() };`,
    "}",
    "",
  ].join("\n"),
  [SCHEMA.api]: [
    'import { createEnv } from "@t3-oss/env-core";',
    'import { z } from "zod";',
    `import { keyFields } from "${FRAGMENT_SPECIFIER}";`,
    `// ${UNREAD.schemaComment}: z.string(), a name in a comment declares nothing`,
    "const serverSchema = {",
    `  ${NAME.nodeEnv}: z.enum(["development", "production"]).default("development"),`,
    `  ${NAME.region}: z.string().default("${VALUE.schemaDefault}"),`,
    "  ...keyFields(32),",
    "} as const;",
    "export function parseApiEnv(runtimeEnv: Record<string, string | undefined>) {",
    "  return createEnv({ server: serverSchema, runtimeEnv });",
    "}",
    "",
  ].join("\n"),
  [SCHEMA.workers]: [
    'import { createEnv } from "@t3-oss/env-core";',
    'import { z } from "zod";',
    `import { keyFields } from "${FRAGMENT_SPECIFIER}";`,
    "export const env = createEnv({",
    `  server: { ${NAME.redisUrl}: z.string().url(), ...keyFields(32) },`,
    "  runtimeEnv: process.env,",
    "});",
    "",
  ].join("\n"),
  [SCHEMA.admin]: portalSchema(NAME.apiUrl, NAME.publicUrl),
  [SCHEMA.client]: portalSchema(NAME.apiUrl, NAME.publicApiUrl),
  [WORKFLOW]: makeWorkflow(),
  ...overrides,
});

const CHECKLIST = "docs/deployment/DEPLOYMENT_CHECKLIST.md";
const CLASSIFICATION = "docs/deployment/classification/names.json";
const PAGE = "docs/deployment/DEPLOYMENT_INVENTORY.md";
const LINE = "deployment-checklist inventory:";
const WRITE = "pnpm deployment:inventory";

/** The rows that name the workflow's two names, each citing the line that reads it. */
const WORKFLOW_ROWS = [
  `| \`${NAME.browserDsn}\` | \`${WORKFLOW}:10\` |`,
  `| \`${NAME.deployToken}\` (secret) | \`${WORKFLOW}:9\` |`,
];
/** The rows that name the schemas' names; `KEY_V1` only through the `_V1` shorthand. */
const RUNTIME_ROWS = [
  `| \`${NAME.nodeEnv}\`, \`${NAME.region}\` | \`${SCHEMA.api}:6-7\` |`,
  `| \`${NAME.key}\`, with \`_V1\` during a rotation | \`${FRAGMENT}:3\` |`,
  `| \`${NAME.redisUrl}\` | \`${SCHEMA.workers}:5\` |`,
  `| \`${NAME.apiUrl}\` | \`${SCHEMA.admin}:4\`, \`:6\` |`,
];
const SECTION = { workflow: "Repository variables and secrets", runtime: "Required at boot" };

/** The checklist: two tables, `extra` rows appended to the second, and prose naming a pending name. */
const makeChecklist = (extra: readonly string[] = []): string =>
  [
    "# Deployment checklist",
    "",
    `Prose names \`${NAME.publicApiUrl}\` outside every table, which names it for no row.`,
    "",
    `## ${SECTION.workflow}`,
    "",
    "| Name | Evidence |",
    "| --- | --- |",
    ...WORKFLOW_ROWS,
    "",
    `## ${SECTION.runtime}`,
    "",
    "| Variable | Evidence |",
    "| --- | --- |",
    ...RUNTIME_ROWS,
    ...extra,
    "",
  ].join("\n");

const NOTE = {
  shorthand: `The row names \`${NAME.key}\` with \`_V1\`.`,
  exempt: "The portal's own origin, which its image sets.",
};
/** The classification's entries: one shorthand, one exempt, one pending. */
const makeEntries = (
  overrides: Record<string, Entry | undefined> = {}
): Record<string, Entry | undefined> => ({
  [NAME.keyV1]: { status: "shorthand", row: NAME.key, note: NOTE.shorthand },
  [NAME.publicUrl]: { status: "exempt", note: NOTE.exempt },
  [NAME.publicApiUrl]: { status: "pending" },
  ...overrides,
});
const PENDING = 1;

/** The scratch directory: the repository under `repo/`, and `outside/` beside it, out of its reach. */
let base = "";
let root = "";
let tree: Record<string, string> = {};
/** The checklist the next run writes; `null` writes none. */
let checklist: string | null = "";
let entries: Record<string, Entry | undefined> = {};
let pendingBaseline = 0;

const put = (file: string, text: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};
/** Writes a file beside the repository, which no reader of the check may reach. */
const putOutside = (file: string, text: string): string => {
  const target = path.join(base, "outside", file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
};
/** A symbolic link at `file` of the repository that points at `target`. */
const link = (file: string, target: string): void => {
  mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  symlinkSync(target, path.join(root, file));
};
const moduleOf = (file: string): Module => ({
  file,
  text: readFileSync(path.join(root, file), "utf8"),
});
/** Resolves the fixture's one alias, as the generator's loader resolves `tsconfig.base.json`. */
const load: Load = (specifier) => (specifier === FRAGMENT_SPECIFIER ? moduleOf(FRAGMENT) : null);

/** Runs the check (`check`) or the write command over the scratch tree, as `run.mjs` runs it. */
const run = async (check: boolean): Promise<Run> => {
  const { generator, COMMANDS } = await loadInventory();
  if (checklist !== null) put(CHECKLIST, checklist);
  put(CLASSIFICATION, JSON.stringify({ pendingBaseline, entries }));
  const [stdout, stderr]: [string[], string[]] = [[], []];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => stderr.push(String(chunk)) > 0);
  const inventory = { name: generator.name, generate: () => generator.generate({ root }) };
  const exitCode = await runGenerators([inventory], { check, root, commands: COMMANDS });
  vi.restoreAllMocks();
  return { exitCode, stdout, stderr };
};
/** Writes the page of the tree as it stands, then checks it, so a case sees its own problems alone. */
const writeThenCheck = async (): Promise<Run> => {
  await run(false);
  return run(true);
};
const page = (): string => readFileSync(path.join(root, PAGE), "utf8");
/** The page's table row of one name, its cells trimmed of the padding Prettier adds. */
const rowOf = (name: string): string[] =>
  (
    page()
      .split("\n")
      .find((line) => line.startsWith(`| \`${name}\` `)) ?? ""
  )
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), "deployment-checklist-test-"));
  root = path.join(base, "repo");
  mkdirSync(root);
  tree = makeTree();
  Object.entries(tree).forEach(([file, text]) => put(file, text));
  checklist = makeChecklist();
  entries = makeEntries();
  pendingBaseline = PENDING;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe("the names a schema declares", () => {
  it("returns the keys a schema spreads from an imported fragment beside its own", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(moduleOf(SCHEMA.api), load);

    expect(found).toEqual({
      names: [NAME.key, NAME.keyV1, NAME.nodeEnv, NAME.region],
      problems: [],
    });
  });

  it("returns no name that appears only in a comment of the schema", async () => {
    const { schemaNames } = await loadSchemaNames();

    const { names } = schemaNames(moduleOf(SCHEMA.api), load);

    expect(names.filter((name) => name === UNREAD.schemaComment)).toEqual([]);
  });

  it("returns a portal's name once when runtimeEnv repeats every key of server and client", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(moduleOf(SCHEMA.admin), load);

    expect(found).toEqual({ names: [NAME.apiUrl, NAME.publicUrl], problems: [] });
  });

  it("returns a problem naming the spread when its fragment resolves to no module", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(moduleOf(SCHEMA.workers), () => null);

    expect(found).toEqual({
      names: [NAME.redisUrl],
      problems: [`${SCHEMA.workers}: the spread ...keyFields() resolves to no object literal`],
    });
  });

  it("returns a problem when the module holds no createEnv call", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames({ file: SCHEMA.client, text: "export const env = {};\n" }, load);

    expect(found).toEqual({ names: [], problems: [`${SCHEMA.client}: no createEnv call`] });
  });

  /** A module whose one `createEnv` call takes `options`, the call on its third line. */
  const envModule = (options: string): Module => ({
    file: SCHEMA.workers,
    text: [
      'import { z } from "zod";',
      "const DYNAMIC = 'X';",
      `createEnv({ ${options} });`,
      "",
    ].join("\n"),
  });

  it("returns a name once when two blocks of one schema declare it", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(
      envModule(`server: { ${NAME.apiUrl}: z.string() }, shared: { ${NAME.apiUrl}: z.string() }`),
      load
    );

    expect(found).toEqual({ names: [NAME.apiUrl], problems: [] });
  });

  it("returns a problem naming the line of a computed key, never its value", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(
      envModule(
        `server: { [DYNAMIC]: z.string().default("${VALUE.schemaDefault}"), ${NAME.region}: z.string() }`
      ),
      load
    );

    expect(found).toEqual({
      names: [NAME.region],
      problems: [`${SCHEMA.workers}:3: a key with no literal name`],
    });
  });

  it("returns a problem when a schema block resolves to no object literal", async () => {
    const { schemaNames } = await loadSchemaNames();

    const found = schemaNames(envModule("server: buildServer(), runtimeEnv: process.env"), load);

    expect(found).toEqual({
      names: [],
      problems: [`${SCHEMA.workers}: the server block resolves to no object literal`],
    });
  });
});

/** A workflow of one job whose steps are `steps`, each line already indented under `steps:`. */
const workflowOf = (steps: readonly string[]): string =>
  ["jobs:", "  build:", "    runs-on: ubuntu-latest", "    steps:", ...steps, ""].join("\n");

describe("the names a workflow reads", () => {
  /**
   * One shape per row: what it is | the step's lines, joined by `⏎`, a `·` for each space | the
   * vars | the secrets, each a `,`-separated list or `-` for none.
   */
  const SHAPES = String.raw`
an escaped double quote before a hash | -·run:·"gh·pr·comment·--body·\"PR·#1\"·${"$"}{{·secrets.PROBE_PR_HASH·}}" | - | PROBE_PR_HASH
a double-quoted scalar continued on the next line | -·run:·"echo·first⏎···#·still·the·script·${"$"}{{·secrets.CONTINUED·}}" | - | CONTINUED
an apostrophe inside a plain scalar, then a comment | -·run:·echo·it's·#·${"$"}{{·secrets.COMMENTED·}} | - | COMMENTED
a context written in capitals | -·run:·echo·${"$"}{{·SECRETS.UPPER_CONTEXT·}}·${"$"}{{·Vars.MIXED_CONTEXT·}} | MIXED_CONTEXT | UPPER_CONTEXT
a quoted key that opens a block scalar | -·"run":·|⏎····#·${"$"}{{·secrets.QUOTED_KEY_BLOCK·}} | - | QUOTED_KEY_BLOCK
the index forms, in single and double quotes | -·run:·echo·${"$"}{{·secrets['BRACKETED']·}}·${"$"}{{·vars["DOUBLE_QUOTED"]·}} | DOUBLE_QUOTED | BRACKETED
a reference inside a string of an expression, read in excess | -·run:·echo·${"$"}{{·format('secrets.IN_A_STRING·{0}',·vars.REAL)·}} | REAL | IN_A_STRING
a block scalar that is a sequence entry | -·|⏎··#·${"$"}{{·secrets.IN_ENTRY_BLOCK·}} | - | IN_ENTRY_BLOCK
an if condition in double quotes continued on the next line | -·if:·"github.event_name·==·'push'·&&⏎····vars.PB_IF_DQ_CONT·==·'on'"⏎··run:·make | PB_IF_DQ_CONT | -
a plain if condition continued on the next line | -·if:·github.event_name·==·'push'·&&⏎····vars.PB_IF_PLAIN_CONT·==·'on'⏎··run:·make | PB_IF_PLAIN_CONT | -
a quote a plain scalar opens, then a block scalar | -·name:·Notify,·'nightly⏎··run:·|⏎····echo·"it's·#·${"$"}{{·vars.PB_FALSE_OPEN·}}" | PB_FALSE_OPEN | -
a reference in a YAML comment with no expression around it | #·reads·vars.IN_A_COMMENT·and·secrets.ALSO_IN_A_COMMENT⏎-·run:·make | IN_A_COMMENT | ALSO_IN_A_COMMENT
a property named like a context, which is no context | -·run:·echo·${"$"}{{·steps.secrets.outputs.token·}}·${"$"}{{·needs.vars.result·}} | - | -
a property named like a context inside an expression, a space after its dot | -·run:·echo·${"$"}{{·steps.secrets.outputs.x·}}·${"$"}{{·inputs.secrets·}}·${"$"}{{·github.event.·secrets·}} | - | -
a property named like a context in an if condition | -·if:·inputs.secrets·&&·github.event.secrets⏎··run:·make | - | -
the context's name as a word of a step name | -·name:·gitleaks·(secrets)⏎··run:·make | - | -
a sentence of a comment that ends on the context's name, outside every expression | #·Load·the·secrets.·The·job·runs·after·the·vars.·Then·it·ends⏎-·run:·make | - | -
a trailing comment on an if line, read as part of the condition | -·if:·always()·#·the·secrets.·The·job·runs⏎··run:·make | - | The`
    .trim()
    .split("\n")
    .map((row) => row.split(" | "));
  /** A list cell: names separated by commas, or `-` for none. */
  const list = (cell = ""): string[] => (cell === "-" ? [] : cell.split(","));

  it.each(SHAPES)("returns the names of %s", async (title, lines, vars, secrets, ...extra) => {
    expect([title, lines, vars, secrets, ...extra]).toHaveLength(4);
    const { workflowReferences } = await loadWorkflowReferences();
    const steps = (lines ?? "").split("⏎").map((line) => `      ${line.replaceAll("·", " ")}`);

    const references = workflowReferences(workflowOf(steps));

    expect(references).toEqual({ vars: list(vars), secrets: list(secrets), nameless: [] });
  });

  /**
   * Residual limit (4) of the `# 58.` block of docs/development/FITNESS_FUNCTIONS.md, one row per
   * YAML device the reader does not interpret: what it is | the step's lines, a spaced reference in
   * them, written as in SHAPES | its context | its name. A change that closes a limit turns its row
   * red, and the block drops the limit in the same change.
   */
  const LIMITS = String.raw`
an if value of a flow mapping continued under its key | -·{·if:·"github.ref·==·'x'·&&⏎····vars·.·LIMIT_FLOW·==·'on'",·run:·make·} | vars | LIMIT_FLOW
an expression span in a single-quoted scalar whose string holds the closing braces | -·run:·'echo·${"$"}{{·format(''}}'',·vars·.·LIMIT_QUOTED)·}}' | vars | LIMIT_QUOTED
an if value that is an alias of an anchored scalar | -·name:·anchor⏎··env:⏎····COND:·&cond·"vars·.·LIMIT_ALIAS·==·'on'"⏎-·if:·*cond⏎··run:·make | vars | LIMIT_ALIAS
an expression opening split by an escaped line break of a double-quoted scalar | -·run:·"echo·${"$"}{\⏎····{·secrets·.·LIMIT_BREAK·}}" | secrets | LIMIT_BREAK
an expression opening written through a YAML escape | -·run:·"echo·$\x7b{·secrets·.·LIMIT_ESCAPE·}}" | secrets | LIMIT_ESCAPE`
    .trim()
    .split("\n")
    .map((row) => row.split(" | "));
  /** The workflow of a row of LIMITS, its spaced reference written tight when `tight` is set. */
  const limitWorkflow = (lines = "", tight = false): string =>
    workflowOf(
      (tight ? lines.replaceAll("·.·", ".") : lines)
        .split("⏎")
        .map((line) => `      ${line.replaceAll("·", " ")}`)
    );

  it.each(LIMITS)(
    "derives nothing and fails nothing for %s, a residual limit",
    async (title, lines, ...extra) => {
      expect([title, lines, ...extra]).toHaveLength(4);
      const { workflowReferences } = await loadWorkflowReferences();

      const references = workflowReferences(limitWorkflow(lines));

      expect(references).toEqual({ vars: [], secrets: [], nameless: [] });
    }
  );

  it.each(LIMITS)(
    "returns the name of %s once the reference is written tight",
    async (_, lines, context = "", name = "") => {
      const { workflowReferences } = await loadWorkflowReferences();

      const references = workflowReferences(limitWorkflow(lines, true));

      expect(references).toEqual({ vars: [], secrets: [], nameless: [], [context]: [name] });
    }
  );

  /**
   * Each spelling of a reference the expression language accepts, `{c}` for the context and `{n}`
   * for the name, a `⏎` where the line breaks, with the name it reads.
   */
  const SPELLINGS: ReadonlyArray<[string, string]> = [
    ["{c} . {n}", "A"],
    ["{c} .{n}", "B"],
    ["{c}. {n}", "C"],
    ["{c} ['{n}']", "D"],
    ['{c} [ "{n}" ]', "E"],
    ["{c}.⏎{n}", "F"],
    ["{c}⏎.{n}", "G"],
    ["({c}).{n}", "H"],
    ["({c})['{n}']", "I"],
    ["( {c} ) . {n}", "J"],
    ["(({c})).{n}", "K"],
  ];
  type Context = "vars" | "secrets";
  /**
   * Where GitHub evaluates an expression, the context a case reads there, and the step lines that
   * put an expression there; a `⏎` inside the expression continues it on a line indented deeper.
   */
  const REGIONS: ReadonlyArray<[string, Context, (expression: string) => string[]]> = [
    ["inside an expression span", "secrets", (expression) => [`- run: echo \${{ ${expression} }}`]],
    [
      "in a bare if condition",
      "vars",
      (expression) => [`- if: ${expression} == 'on'`, "  run: make"],
    ],
    [
      "in an if condition continued on the next line",
      "vars",
      (expression) => [
        "- if: github.event_name == 'push' &&",
        `    ${expression} == 'on'`,
        "  run: make",
      ],
    ],
  ];
  const SPELLED = REGIONS.flatMap(([where, context, place]) =>
    SPELLINGS.map(([spelling, name]) => {
      const expression = spelling.replace("{c}", context).replace("{n}", name);
      const lines = place(expression.replaceAll("⏎", "⏎    ")).flatMap((line) => line.split("⏎"));
      return { title: `${expression} ${where}`, lines, context, name };
    })
  );

  it.each(SPELLED)("returns the name of $title", async ({ lines, context, name }) => {
    const { workflowReferences } = await loadWorkflowReferences();

    const references = workflowReferences(workflowOf(lines.map((line) => `      ${line}`)));

    expect(references).toEqual({ vars: [], secrets: [], nameless: [], [context]: [name] });
  });

  it("returns the names of every expression and of every YAML comment", async () => {
    const { workflowReferences } = await loadWorkflowReferences();
    const workflow = makeWorkflow({
      comment: `\${{ vars.${IN_COMMENT.yaml} }} sits in a YAML comment, which Actions never reads`,
      trailing: `\${{ vars.${IN_COMMENT.trailing} }}`,
    });

    const references = workflowReferences(workflow);

    expect(references).toEqual({
      vars: [NAME.browserDsn, IN_COMMENT.yaml, IN_COMMENT.trailing],
      secrets: [NAME.deployToken],
      nameless: [],
    });
  });

  it("returns the names an if condition tests without an expression wrapper", async () => {
    const { workflowReferences } = await loadWorkflowReferences();
    const condition = [
      "jobs:",
      "  notify:",
      "    if: vars.NOTIFY == 'on' && secrets.HOOK != ''",
      "    runs-on: ubuntu-latest",
      "",
    ].join("\n");

    const references = workflowReferences(condition);

    expect(references).toEqual({ vars: ["NOTIFY"], secrets: ["HOOK"], nameless: [] });
  });
});

describe("the names the tree reads", () => {
  it("renders every name once with each file that reads it, a fragment's under each schema that spreads it", async () => {
    const code = (file: string): string => `\`${file}\``;

    const { exitCode, stderr } = await run(false);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(Object.fromEntries(Object.values(NAME).map((name) => [name, rowOf(name)[1]]))).toEqual({
      [NAME.apiUrl]: `${code(SCHEMA.admin)}, ${code(SCHEMA.client)}`,
      [NAME.browserDsn]: `${code(WORKFLOW)} (vars)`,
      [NAME.deployToken]: `${code(WORKFLOW)} (secrets)`,
      [NAME.key]: `${code(SCHEMA.api)}, ${code(SCHEMA.workers)}`,
      [NAME.keyV1]: `${code(SCHEMA.api)}, ${code(SCHEMA.workers)}`,
      [NAME.publicApiUrl]: code(SCHEMA.client),
      [NAME.publicUrl]: code(SCHEMA.admin),
      [NAME.nodeEnv]: code(SCHEMA.api),
      [NAME.redisUrl]: code(SCHEMA.workers),
      [NAME.region]: code(SCHEMA.api),
    });
    expect(
      page()
        .split("\n")
        .filter((line) => /^\| `[A-Z]/.test(line))
    ).toHaveLength(Object.values(NAME).length);
  });

  const WORKFLOWS = ".github/workflows";
  /** One scope the check must read whole: what is wrong, how the tree gets so, what the error says. */
  const SCOPES: ReadonlyArray<[string, () => void, string]> = [
    [
      "a schema is missing",
      () => rmSync(path.join(root, SCHEMA.client)),
      `${SCHEMA.client} does not exist`,
    ],
    ["the checklist is missing", () => (checklist = null), `${CHECKLIST} does not exist`],
    [
      "the workflow directory is missing",
      () => rmSync(path.join(root, WORKFLOWS), { recursive: true }),
      `${WORKFLOWS} does not exist`,
    ],
    [
      "a schema yields no name",
      () => put(SCHEMA.client, "createEnv({ server: {}, client: {}, runtimeEnv: {} });\n"),
      `${SCHEMA.client} yielded no name`,
    ],
    [
      "the workflow directory holds no workflow",
      () => {
        rmSync(path.join(root, WORKFLOW));
        put(`${WORKFLOWS}/README.md`, "Workflows live here.\n");
      },
      `${WORKFLOWS} holds no workflow`,
    ],
  ];

  it.each(SCOPES)("returns exit 1 and the scope error when %s", async (_, arrange, reason) => {
    arrange();

    const { exitCode, stderr } = await run(true);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} scope error: ${reason}: a scan that cannot read its whole scope is not clean\n`,
    ]);
  });

  it("returns exit 1 naming each entry of the workflow directory it cannot read as a file", async () => {
    link(`${WORKFLOWS}/broken.yml`, path.join(root, `${WORKFLOWS}/gone.yml`));
    mkdirSync(path.join(root, `${WORKFLOWS}/zz.yml`));
    mkdirSync(path.join(root, `${WORKFLOWS}/scripts`));
    put(`${WORKFLOWS}/README.md`, "Workflows live here.\n");

    const { exitCode, stderr } = await writeThenCheck();
    const unreadable = (entry: string): string =>
      `${LINE} ${WORKFLOWS}/${entry} cannot be read as a file: an entry the check cannot read is not clean\n`;

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([unreadable("broken.yml"), unreadable("scripts"), unreadable("zz.yml")]);
  });

  const CALLER = `${WORKFLOWS}/call.yml`;
  /** A job's lines whose last one is a step that runs `command`. */
  const stepRunning = (command: string): string[] => [
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - run: ${command}`,
  ];
  /**
   * One form that reads a context and names nothing of it: what it does, the lines of the job that
   * writes it on its last line, the context it reads, and the form as the check prints it.
   */
  const NAMELESS: ReadonlyArray<[string, string[], string, string]> = [
    [
      "passes every secret to a called workflow",
      [`    uses: ./${WORKFLOW}`, "    secrets: inherit"],
      "secrets",
      "secrets: inherit",
    ],
    [
      "serializes every secret",
      stepRunning("echo '${{ toJSON(secrets) }}'"),
      "secrets",
      "toJSON(secrets)",
    ],
    [
      "serializes every variable",
      stepRunning("echo '${{ toJSON(vars) }}'"),
      "vars",
      "toJSON(vars)",
    ],
    [
      "indexes the secrets with a call",
      stepRunning("echo ${{ secrets[format('{0}_TOKEN', matrix.name)] }}"),
      "secrets",
      "secrets[…]",
    ],
    [
      "indexes the secrets with a property",
      stepRunning("echo ${{ secrets[matrix.name] }}"),
      "secrets",
      "secrets[…]",
    ],
    [
      "filters every secret",
      stepRunning("echo ${{ join(secrets.*, ',') }}"),
      "secrets",
      "secrets.*",
    ],
    [
      "interpolates the whole secrets context",
      stepRunning("echo ${{ secrets }}"),
      "secrets",
      "secrets",
    ],
    [
      "adds a number to the secrets context",
      stepRunning("echo ${{ secrets + 1 }}"),
      "secrets",
      "secrets",
    ],
    [
      "formats the whole secrets context",
      stepRunning("echo ${{ format('{0}', secrets) }}"),
      "secrets",
      "secrets",
    ],
    [
      "compares the whole variables context in an if condition",
      ["    runs-on: ubuntu-latest", "    if: vars != ''"],
      "vars",
      "vars",
    ],
    [
      "writes the context's name in a trailing comment of an if condition",
      ["    runs-on: ubuntu-latest", "    if: github.event_name == 'push' # no secrets on forks"],
      "secrets",
      "secrets",
    ],
  ];

  it.each(NAMELESS)(
    "returns exit 1 naming the file, the line and the form when a workflow %s",
    async (_, job, context, form) => {
      const header = ["jobs:", "  call:"];
      put(CALLER, [...header, ...job, ""].join("\n"));
      const line = header.length + job.length;

      const { exitCode, stderr } = await writeThenCheck();

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([
        `${LINE} ${CALLER}:${line} reads ${context} through \`${form}\`, which names none: a read the check cannot name is not clean\n`,
      ]);
    }
  );

  /** Spreads `fields()` of `specifier` into the workers' schema, the module declaring `PLANTED`. */
  const spreadFrom = (specifier: string): void => {
    const workers = tree[SCHEMA.workers] ?? "";
    put(
      SCHEMA.workers,
      `import { fields } from "${specifier}";\n${workers.replace("...keyFields(32) }", "...keyFields(32), ...fields() }")}`
    );
  };
  const PLANTED = "export function fields() {\n  return { PLANTED: z.string() };\n}\n";

  it("returns exit 1 and reads no fragment that resolves to an environment file", async () => {
    put("packages/shared/src/.env.fields.ts", PLANTED);
    spreadFrom("../../../../packages/shared/src/.env.fields.js");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} ${SCHEMA.workers}: the spread ...fields() resolves to no object literal\n`,
    ]);
    expect(rowOf("PLANTED")).toEqual([]);
  });

  it("returns exit 1 and reads no fragment that resolves outside the repository", async () => {
    putOutside("fields.ts", PLANTED);
    const config = JSON.parse(tree["tsconfig.base.json"] ?? "{}") as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    config.compilerOptions.paths["@outside/*"] = ["../outside/*"];
    put("tsconfig.base.json", JSON.stringify(config));
    spreadFrom("@outside/fields.js");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} ${SCHEMA.workers}: the spread ...fields() resolves to no object literal\n`,
    ]);
    expect(rowOf("PLANTED")).toEqual([]);
  });
});

describe("the generated page (holding 4)", () => {
  it("returns exit 0 and says the page is current when the committed page is the one regenerated", async () => {
    await run(false);

    const { exitCode, stdout, stderr } = await run(true);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      `${LINE} 10 names (1 vars, 1 secrets, 8 in the schemas), 7 citations\n`,
      `${LINE} ${PAGE} is current\n`,
    ]);
  });

  it("returns exit 1 and names the page when a name the tree reads changed after it was written", async () => {
    await run(false);
    const workers = tree[SCHEMA.workers] ?? "";
    put(
      SCHEMA.workers,
      workers.replace("...keyFields(32) }", "...keyFields(32), LOG_LEVEL: z.string() }")
    );
    checklist = makeChecklist(["| `LOG_LEVEL` | the workers |"]);

    const { exitCode, stderr } = await run(true);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${LINE} ${PAGE} differs from the regenerated page: run ${WRITE}\n`]);
  });

  it("returns exit 1 and names the page when none is committed", async () => {
    const { exitCode, stderr } = await run(true);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${LINE} ${PAGE} is missing: run ${WRITE}\n`]);
  });

  it("keeps the page when a schema line and a checklist row move without moving a name", async () => {
    await run(false);
    const before = page();
    put(SCHEMA.api, (tree[SCHEMA.api] ?? "").replace("const serverSchema", "\nconst serverSchema"));
    checklist = makeChecklist().replace(`:6-7\``, `:7-8\``);

    const { exitCode } = await run(true);

    expect(exitCode).toBe(0);
    expect(page()).toBe(before);
  });

  it("renders each name with the files that read it, the section that names it and its classification", async () => {
    await run(false);

    expect(rowOf(NAME.deployToken)).toEqual([
      `\`${NAME.deployToken}\``,
      `\`${WORKFLOW}\` (secrets)`,
      SECTION.workflow,
      "named",
    ]);
    expect(rowOf(NAME.keyV1)).toEqual([
      `\`${NAME.keyV1}\``,
      `\`${SCHEMA.api}\`, \`${SCHEMA.workers}\``,
      `${SECTION.runtime}, as \`${NAME.key}\``,
      `shorthand: ${NOTE.shorthand}`,
    ]);
    expect(rowOf(NAME.publicUrl)).toEqual([
      `\`${NAME.publicUrl}\``,
      `\`${SCHEMA.admin}\``,
      "—",
      `exempt: ${NOTE.exempt}`,
    ]);
    expect(rowOf(NAME.publicApiUrl)).toEqual([
      `\`${NAME.publicApiUrl}\``,
      `\`${SCHEMA.client}\``,
      "—",
      "pending",
    ]);
  });

  it("writes no schema default and no workflow literal to the page or the output", async () => {
    const written = await run(false);
    const checked = await run(true);
    const everything = [
      page(),
      ...written.stdout,
      ...written.stderr,
      ...checked.stdout,
      ...checked.stderr,
    ];
    const literals = [VALUE.schemaDefault, VALUE.workflowLiteral];

    expect(checked.exitCode).toBe(0);
    expect(everything.filter((text) => literals.some((value) => text.includes(value)))).toEqual([]);
  });
});

describe("every name is held (holding 1)", () => {
  it("returns exit 1 naming a name that no row names and no entry classifies", async () => {
    entries = makeEntries({ [NAME.publicApiUrl]: undefined });
    pendingBaseline = 0;

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} ${NAME.publicApiUrl} has no row in the checklist and no entry in ${CLASSIFICATION}: name it in a row or classify it\n`,
    ]);
  });

  it("returns exit 0 once the name's row is written and its entry dropped", async () => {
    entries = makeEntries({ [NAME.publicApiUrl]: undefined });
    pendingBaseline = 0;
    checklist = makeChecklist([`| \`${NAME.publicApiUrl}\` | \`${SCHEMA.client}:5\` |`]);

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  /** One refusal per row: what it is | the entry changed | its new value | the problem. */
  const REFUSALS = String.raw`
an entry for a name the tree does not read | GONE | {"status":"exempt","note":"Read by nothing."} | GONE is classified but the tree reads no such name
an entry for a name a row names | ${NAME.nodeEnv} | {"status":"exempt","note":"Set by the image."} | ${NAME.nodeEnv} is classified exempt, but a checklist row names it: drop its entry
a shorthand whose row no table row names | ${NAME.keyV1} | {"status":"shorthand","row":"KEY_V9"} | ${NAME.keyV1} is shorthand for KEY_V9, which no checklist row names
a shorthand that names no row | ${NAME.keyV1} | {"status":"shorthand"} | ${NAME.keyV1} is shorthand and names no row
a row on an entry that is no shorthand | ${NAME.publicUrl} | {"status":"exempt","note":"An origin.","row":"${NAME.key}"} | ${NAME.publicUrl}: row belongs on a shorthand entry, and only there
an exemption without its reason | ${NAME.publicUrl} | {"status":"exempt"} | ${CLASSIFICATION}: ${NAME.publicUrl} has no note
an exemption whose reason is blanks only | ${NAME.publicUrl} | {"status":"exempt","note":"   "} | ${CLASSIFICATION}: ${NAME.publicUrl} has no note
a shorthand for a row of another family | ${NAME.keyV1} | {"status":"shorthand","row":"${NAME.redisUrl}"} | ${NAME.keyV1} is shorthand for ${NAME.redisUrl}, but the two names share no prefix`
    .trim()
    .split("\n")
    .map((row) => row.split(" | "));

  it.each(REFUSALS)(
    "returns exit 1 and the problem for %s",
    async (title, name, value, problem, ...extra) => {
      expect([title, name, value, problem, ...extra].filter(Boolean)).toHaveLength(4);
      entries = makeEntries({ [name ?? ""]: JSON.parse(value ?? "{}") as Entry });

      const { exitCode, stderr } = await writeThenCheck();

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([`${LINE} ${problem}\n`]);
    }
  );

  it("returns exit 1 when no row that names a shorthand's row writes the shorthand's suffix", async () => {
    checklist = makeChecklist().replace(", with `_V1` during a rotation", "");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} ${NAME.keyV1} is shorthand for ${NAME.key}, but no row that names ${NAME.key} writes _V1\n`,
    ]);
  });

  /** One way a checklist mentions the pending name without naming it: what it is | the lines added. */
  const MENTIONS: ReadonlyArray<[string, string]> = [
    ["in a row's plain words", `| ${NAME.publicApiUrl} in plain words | \`${SCHEMA.client}:5\` |`],
    [
      "only inside a longer name of a code span",
      `| \`${NAME.publicApiUrl}_V2\`, \`ADMIN_${NAME.publicApiUrl}\` | \`${SCHEMA.client}:5\` |`,
    ],
    [
      "in a row of a fenced code block, with a citation of no file",
      ["", "```markdown", `| \`${NAME.publicApiUrl}\` | \`apps/gone.ts:1\` |`, "```"].join("\n"),
    ],
  ];

  it.each(MENTIONS)(
    "returns exit 0 and keeps the name pending when the checklist mentions it %s",
    async (_, added) => {
      checklist = makeChecklist([added]);

      const { exitCode, stderr } = await writeThenCheck();

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(rowOf(NAME.publicApiUrl)[3]).toBe("pending");
    }
  );
});

describe("the pending count equals pendingBaseline (holding 2)", () => {
  it("returns exit 1 when the pending names exceed the baseline", async () => {
    pendingBaseline = PENDING - 1;

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${LINE} ${PENDING} pending exceed pendingBaseline ${PENDING - 1}\n`]);
  });

  it("returns exit 1 and asks to lower a baseline left above the pending names", async () => {
    pendingBaseline = PENDING + 1;

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([
      `${LINE} stale pendingBaseline ${PENDING + 1}: lower it to ${PENDING}\n`,
    ]);
  });

  it("counts a pending entry with a note as pending, its note on the page", async () => {
    entries = makeEntries({
      [NAME.publicApiUrl]: { status: "pending", note: "Waits for its row." },
    });
    pendingBaseline = PENDING - 1;

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${LINE} ${PENDING} pending exceed pendingBaseline ${PENDING - 1}\n`]);
    expect(rowOf(NAME.publicApiUrl)[3]).toBe("pending: Waits for its row.");
  });
});

/** A row appended to the checklist that cites `citation`, and the problem's prefix for its line. */
const citing = (citation: string): string => {
  const row = `| \`${NAME.redisUrl}\` | ${citation} |`;
  checklist = makeChecklist([row]);
  return `${LINE} ${CHECKLIST}:${checklist.split("\n").indexOf(row) + 1} cites`;
};

describe("every citation resolves (holding 3)", () => {
  /** One refusal per row: what it is | the citation as the row writes it | the problem after `cites`. */
  const REFUSALS = String.raw`
a line past the end of the file | ${"`"}${SCHEMA.workers}:99${"`"} | ${SCHEMA.workers}:99, which has 7 lines
a range past the end of the file | ${"`"}${SCHEMA.workers}:5-8${"`"} | ${SCHEMA.workers}:5-8, which has 7 lines
a continuation past the end of its path's file | ${"`"}${SCHEMA.admin}:4${"`"}, ${"`"}:60${"`"} | ${SCHEMA.admin}:60, which has 7 lines
a file named by its basename only | ${"`"}env.ts:1${"`"} | env.ts:1, which is no file of the repository
a file that does not exist | ${"`"}apps/api/src/config/gone.ts:1${"`"} | apps/api/src/config/gone.ts:1, which is no file of the repository
a range whose end comes before its start | ${"`"}${SCHEMA.api}:7-6${"`"} | ${SCHEMA.api}:7-6, which is no range of lines
a path that leaves the repository | ${"`"}../outside.ts:1${"`"} | ../outside.ts:1, a path outside the repository
an environment file under an app | ${"`"}apps/admin/.env.local.example:1${"`"} | apps/admin/.env.local.example:1, an environment file this check never reads
the root environment file | ${"`"}.env:1${"`"} | .env:1, an environment file this check never reads
a path that holds parentheses | ${"`"}apps/admin/app/[locale]/(auth)/missing.tsx:3${"`"} | apps/admin/app/[locale]/(auth)/missing.tsx:3, which is no file of the repository`
    .trim()
    .split("\n")
    .map((row) => row.split(" | "));

  it.each(REFUSALS)(
    "returns exit 1 and the problem for %s",
    async (title, citation, problem, ...extra) => {
      expect([title, citation, problem, ...extra].filter(Boolean)).toHaveLength(3);
      const prefix = citing(citation ?? "");

      const { exitCode, stderr } = await writeThenCheck();

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([`${prefix} ${problem}\n`]);
    }
  );

  it("returns exit 0 for a host and port and an image tag, which name no file", async () => {
    citing("`host.docker.internal:3000`, `redis:7`");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  it("returns exit 0 for a path that holds brackets and parentheses and has the cited line", async () => {
    put("apps/admin/app/[locale]/(auth)/login/page.tsx", "export default function Page() {}\n");
    citing("`apps/admin/app/[locale]/(auth)/login/page.tsx:1`");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  const ENV_FILE = "apps/admin/.env.local";
  /**
   * One citation that reaches an environment file holding a value: what it is | how the tree gets
   * so | the citation | the problem after `cites`. A check that opened the file would count its one
   * line and pass the citation, so the refusal is the proof that it was never read.
   */
  const ENVIRONMENT: ReadonlyArray<[string, () => void, string, string]> = [
    [
      "by its own path",
      () => put(ENV_FILE, `${NAME.apiUrl}=${VALUE.envFile}\n`),
      `${ENV_FILE}:1`,
      `${ENV_FILE}:1, an environment file this check never reads`,
    ],
    [
      "through a link of the repository",
      () => {
        put(ENV_FILE, `${NAME.apiUrl}=${VALUE.envFile}\n`);
        link("docs/notes.md", path.join(root, ENV_FILE));
      },
      "docs/notes.md:1",
      "docs/notes.md:1, an environment file this check never reads",
    ],
  ];

  it.each(ENVIRONMENT)(
    "returns exit 1, the refusal and no value for an environment file cited %s",
    async (_, arrange, citation, problem) => {
      arrange();
      const prefix = citing(`\`${citation}\``);

      const { exitCode, stdout, stderr } = await writeThenCheck();

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([`${prefix} ${problem}\n`]);
      expect([...stdout, ...stderr, page()].filter((text) => text.includes(VALUE.envFile))).toEqual(
        []
      );
    }
  );

  it("returns exit 1 for a citation whose link leads outside the repository", async () => {
    link("docs/outside.md", putOutside("notes.md", "one\ntwo\nthree\n"));
    const prefix = citing("`docs/outside.md:1`");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${prefix} docs/outside.md:1, a path outside the repository\n`]);
  });

  it("counts the lines of the file a link of the repository leads to", async () => {
    link("docs/schema.ts", path.join(root, SCHEMA.workers));
    const prefix = citing("`docs/schema.ts:7`, `:8`");

    const { exitCode, stderr } = await writeThenCheck();

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([`${prefix} docs/schema.ts:8, which has 7 lines\n`]);
  });
});

/** Runs `scripts/deployment/run.mjs` itself, on the real tree, with `args`. */
const command = (
  args: readonly string[]
): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/deployment/run.mjs"), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

describe("the command", () => {
  it("returns exit 0 with --check, says the page is current and leaves the committed page untouched", () => {
    const committed = path.join(REPO_ROOT, PAGE);
    const [before, modified] = [readFileSync(committed, "utf8"), statSync(committed).mtimeMs];

    const result = command(["--check"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.split("\n").slice(1)).toEqual([`${LINE} ${PAGE} is current`, ""]);
    expect([readFileSync(committed, "utf8"), statSync(committed).mtimeMs]).toEqual([
      before,
      modified,
    ]);
  });

  it("returns exit 1 and the usage when an argument is not --check", () => {
    const result = command(["--write"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: run.mjs [--check]; got --write");
  });
});

describe("the real tree", () => {
  it("returns no problem and a page equal to the committed one", async () => {
    const { generator } = await loadInventory();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const built = await generator.generate({ root: REPO_ROOT });

    expect(built.problems).toEqual([]);
    expect(built.pagePath).toBe(PAGE);
    expect(built.markdown).toBe(readFileSync(path.join(REPO_ROOT, PAGE), "utf8"));
  });
});
