/**
 * @file shardReporters.test.ts
 * @description Pins the pairing between the CI shard step and `apps/api/vitest.config.ts` that
 *   decides what a shard reports. The api config does not go through
 *   `defineWorkspaceVitestConfig`, so nothing else checks that its `test.reporters` agrees with
 *   `workspaceReporters()`; and the shard step in `.github/workflows/ci.yml` gets its blob ONLY
 *   through that agreement, because its command carries no `--reporter` flag. Three ways to break
 *   it are each silent or late without this suite: a `--reporter` flag put back on the command
 *   (the flag REPLACES the configured reporters, so a failing shard prints no file, no test and
 *   no diff), the `VITEST_SHARDED` variable dropped from the step's `env` (no blob, discovered
 *   only when the upload runs), and the upload's `if-no-files-found: error` relaxed (the missing
 *   blob then passes in silence).
 *
 *   The workflow is read by a small line-based reader, because a YAML parser is not a declared
 *   dependency of the root or of this package. What it understands: block mappings and block
 *   sequences nested by indentation, plain and single-line quoted scalars, plain scalars that
 *   continue on more-indented lines, and `|` / `>` block scalars, whose lines are returned with
 *   their line breaks kept (folding is not applied; the checks below only look for text). Comment
 *   and blank lines are skipped outside block scalars. What it refuses, as a failing assertion
 *   rather than an empty value: a key declared twice in one mapping, an entry that is neither
 *   `key: value` nor `- ` where one is expected, a dedent that matches no enclosing level, and —
 *   for the values this suite reads — flow collections, anchors, aliases, tags and quoted
 *   scalars that span lines. Values are parsed only when a check asks for them, so a flow
 *   sequence elsewhere in the workflow (`branches: [main]`) is never read. Escapes inside double
 *   quotes are not interpreted.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceReporters, type ReporterSignals } from "@packages/vitest-shared";

const WORKFLOW = new URL("../../../../../.github/workflows/ci.yml", import.meta.url);

/** The directory vitest writes a sharded blob to, relative to `apps/api`, and the upload reads. */
const BLOB_DIRECTORY = "apps/api/.vitest-reports/";

interface ReporterConfig {
  test?: { reporters?: unknown };
}

/** One `key: value` entry of a block mapping, its value left unparsed until a check asks. */
interface MappingEntry {
  /** Where the entry sits, for the failure message. */
  readonly where: string;
  /** The text after `key:` on the key's own line. */
  readonly inline: string;
  /** The lines after the key's line that belong to its value. */
  readonly body: readonly string[];
}

type Mapping = ReadonlyMap<string, MappingEntry>;

const KEY_LINE = /^(\s*)("[^"]*"|'[^']*'|[^\s#"'[{&*!?|>%@`-][^:#]*?)\s*:(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][1-9+-]{0,2}\s*(?:#.*)?$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === "";
const isStructural = (line: string): boolean => !isBlank(line) && !line.trimStart().startsWith("#");

/**
 * Reads the block mapping held by `lines`, at the indentation of its first structural line.
 *
 * @param lines - The mapping's lines; blank and comment lines may sit anywhere.
 * @param where - A label for failure messages.
 * @returns Every key of the mapping, each declared exactly once.
 */
function readMapping(lines: readonly string[], where: string): Mapping {
  const first = lines.find(isStructural);
  if (first === undefined) throw new Error(`${where}: the mapping is empty`);
  const level = indentOf(first);
  const entries = new Map<string, MappingEntry>();

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!isStructural(line)) {
      index += 1;
      continue;
    }
    if (indentOf(line) !== level) {
      throw new Error(`${where}: "${line.trim()}" matches no enclosing indentation level`);
    }
    const match = KEY_LINE.exec(line);
    if (match === null) throw new Error(`${where}: "${line.trim()}" is not a "key: value" entry`);
    const key = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    if (entries.has(key)) throw new Error(`${where}: "${key}" is declared twice in one mapping`);

    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end] ?? "";
      if (isStructural(next) && indentOf(next) <= level) break;
      end += 1;
    }
    entries.set(key, {
      where: `${where} > ${key}`,
      inline: match[3] ?? "",
      body: lines.slice(index + 1, end),
    });
    index = end;
  }
  return entries;
}

/**
 * Splits the block sequence held by `lines` into its entries, each rewritten as the block mapping
 * it holds (the `- ` becomes indentation), so an entry may begin with any key or with none.
 *
 * @param lines - The sequence's lines.
 * @param where - A label for failure messages.
 * @returns One array of lines per entry, in order.
 */
function readSequence(lines: readonly string[], where: string): string[][] {
  const first = lines.find(isStructural);
  if (first === undefined) return [];
  const level = indentOf(first);
  const entries: string[][] = [];

  for (const line of lines) {
    if (isStructural(line) && indentOf(line) < level) {
      throw new Error(`${where}: "${line.trim()}" matches no enclosing indentation level`);
    }
    if (isStructural(line) && indentOf(line) === level) {
      if (!/^-(\s|$)/.test(line.trimStart())) {
        throw new Error(`${where}: "${line.trim()}" is not a "- " sequence entry`);
      }
      entries.push([`${line.slice(0, level)} ${line.slice(level + 1)}`]);
      continue;
    }
    entries.at(-1)?.push(line);
  }
  return entries;
}

/**
 * The lines nested under a key whose value is a block collection.
 *
 * @param mapping - The mapping holding the key.
 * @param key - The key to read.
 * @returns The value's lines.
 */
function collectionOf(mapping: Mapping, key: string): readonly string[] {
  const entry = mapping.get(key);
  if (entry === undefined) throw new Error(`"${key}" is not declared`);
  if (entry.inline.replace(/\s*#.*$/, "") !== "" || !entry.body.some(isStructural)) {
    throw new Error(`${entry.where}: the value is not a block collection`);
  }
  return entry.body;
}

/**
 * The whole scalar value of a key: inline, continued on more-indented lines, or a block scalar.
 *
 * @param mapping - The mapping holding the key.
 * @param key - The key to read.
 * @returns The value with surrounding quotes removed; `undefined` when the key is not declared.
 */
function scalarOf(mapping: Mapping, key: string): string | undefined {
  const entry = mapping.get(key);
  if (entry === undefined) return undefined;
  const { where, inline, body } = entry;

  if (BLOCK_SCALAR.test(inline)) {
    const level = indentOf(body.find((line) => !isBlank(line)) ?? "");
    const end = body.findIndex((line) => !isBlank(line) && indentOf(line) < level);
    const content = (end === -1 ? body : body.slice(0, end)).map((line) => line.slice(level));
    return content.join("\n").trimEnd();
  }
  if (/^[[{&*!?%@`]/.test(inline)) {
    throw new Error(`${where}: flow collections, anchors, aliases and tags are not read`);
  }

  const continuation = body.filter(isStructural).map((line) => line.trim());
  if (/^["']/.test(inline)) {
    const quoted = /^("((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\s*(?:#.*)?$/.exec(inline);
    if (quoted === null || continuation.length > 0) {
      throw new Error(`${where}: a quoted scalar that spans lines is not read`);
    }
    return quoted[2] ?? (quoted[3] ?? "").replaceAll("''", "'");
  }
  if (
    inline === "" &&
    continuation.length > 0 &&
    /^(-(\s|$)|[^\s:]+:(\s|$))/.test(continuation[0] ?? "")
  ) {
    throw new Error(`${where}: the value is a collection, not a scalar`);
  }
  return [inline.replace(/\s+#.*$/, ""), ...continuation].filter((part) => part !== "").join(" ");
}

interface ShardPairing {
  /** Every step, in any job, whose command runs a vitest shard. */
  readonly shardSteps: readonly Mapping[];
  /** The upload steps of the blob directory that follow the shard step in its own job. */
  readonly blobUploads: readonly Mapping[];
}

/**
 * Locates the shard step and the uploads of its blob directory that follow it in its job.
 *
 * @param workflowText - Raw workflow text.
 * @returns The steps found, for the checks to count and read.
 */
function readShardPairing(workflowText: string): ShardPairing {
  const workflow = readMapping(workflowText.split("\n"), "ci.yml");
  const jobs = readMapping(collectionOf(workflow, "jobs"), "ci.yml > jobs");
  const shardSteps: Mapping[] = [];
  const blobUploads: Mapping[] = [];

  for (const [name, job] of jobs) {
    const jobMapping = readMapping(job.body, job.where);
    if (!jobMapping.has("steps")) continue;
    const steps = readSequence(
      collectionOf(jobMapping, "steps"),
      `ci.yml > jobs > ${name} > steps`
    );

    let shardSeen = false;
    steps.forEach((lines, position) => {
      const where = `ci.yml > jobs > ${name} > steps[${String(position)}]`;
      const code = lines.filter(isStructural).join("\n");
      if (/\bvitest run\b[\s\S]*--shard=/.test(code)) {
        shardSteps.push(readMapping(lines, where));
        shardSeen = true;
        return;
      }
      if (!shardSeen || !/upload-artifact@/.test(code)) return;
      const step = readMapping(lines, where);
      if (!(scalarOf(step, "uses") ?? "").startsWith("actions/upload-artifact@")) return;
      const inputs = readMapping(collectionOf(step, "with"), `${where} > with`);
      if (scalarOf(inputs, "path") === BLOB_DIRECTORY) blobUploads.push(step);
    });
  }
  return { shardSteps, blobUploads };
}

/**
 * Loads `apps/api/vitest.config.ts` through module evaluation under explicit signals. Both are
 * set rather than inherited: this suite runs inside the CI shard jobs, where the ambient values
 * are the very ones under test.
 *
 * @param signals - The two variables `workspaceReporters` reads; an absent key is unset.
 * @returns The `test.reporters` value the config resolves to under those signals.
 */
async function loadApiReporters(signals: ReporterSignals): Promise<unknown> {
  vi.stubEnv("GITHUB_ACTIONS", signals.GITHUB_ACTIONS);
  vi.stubEnv("VITEST_SHARDED", signals.VITEST_SHARDED);
  vi.resetModules();

  const configModule = (await import("../../../vitest.config.js")) as { default: ReporterConfig };
  return configModule.default.test?.reporters;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("apps/api/vitest.config.ts reporters", () => {
  it.each<{ signals: ReporterSignals; expected: string[] }>([
    { signals: {}, expected: ["default"] },
    { signals: { GITHUB_ACTIONS: "true" }, expected: ["default", "github-actions"] },
    { signals: { VITEST_SHARDED: "true" }, expected: ["default", "blob"] },
    {
      signals: { GITHUB_ACTIONS: "true", VITEST_SHARDED: "true" },
      expected: ["default", "github-actions", "blob"],
    },
  ])("resolves to the shared selection $expected under $signals", async ({ signals, expected }) => {
    const reporters = await loadApiReporters(signals);

    expect(reporters).toEqual(expected);
    expect(reporters).toEqual(workspaceReporters(signals));
  });
});

describe("the CI shard step", () => {
  const readPairing = (): ShardPairing => readShardPairing(readFileSync(WORKFLOW, "utf8"));

  /**
   * The one shard step, after asserting there is exactly one.
   *
   * @returns The shard step's mapping.
   */
  function onlyShardStep(): Mapping {
    const { shardSteps } = readPairing();
    expect(shardSteps).toHaveLength(1);
    return shardSteps[0] ?? new Map<string, MappingEntry>();
  }

  it("is found exactly once in the workflow", () => {
    expect(readPairing().shardSteps).toHaveLength(1);
  });

  it("names no reporter on its command, so the configured reporters are the ones installed", () => {
    const command = scalarOf(onlyShardStep(), "run") ?? "";

    expect(command).toMatch(/\bvitest run\b/);
    expect(command).not.toMatch(/--reporter\b/);
  });

  it("sets the variable that makes the api config write the blob beside the readable output", async () => {
    const env = readMapping(collectionOf(onlyShardStep(), "env"), "shard step > env");
    const sharded = scalarOf(env, "VITEST_SHARDED");

    expect(sharded).toBe("true");
    await expect(
      loadApiReporters({ GITHUB_ACTIONS: "true", VITEST_SHARDED: sharded })
    ).resolves.toEqual(["default", "github-actions", "blob"]);
  });

  it("is followed in its job by exactly one upload of the blob directory, failing when it is empty", () => {
    const { blobUploads } = readPairing();
    expect(blobUploads).toHaveLength(1);

    const inputs = readMapping(
      collectionOf(blobUploads[0] ?? new Map<string, MappingEntry>(), "with"),
      "upload > with"
    );
    expect(scalarOf(inputs, "if-no-files-found")).toBe("error");
  });
});
