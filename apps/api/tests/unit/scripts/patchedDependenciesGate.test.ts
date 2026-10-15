/**
 * @file patchedDependenciesGate.test.ts
 * @description Pins `scripts/testing/patched-dependencies-gate.mjs`, fitness #48 and the monitor of
 *   every patched dependency. `--check` holds the `patchedDependencies` keys of the workspace, the
 *   records of `scripts/testing/patched-dependencies.json`, the patch files and the ADRs consistent;
 *   `--resolution` exits 1 when a stable release inside a record's `resolvedBy.range` is published;
 *   `--remind` opens or updates one issue per resolvable patch through `gh`, and a second run on the
 *   same day repeats none of it. An input the gate cannot read exits 3 in every mode, and wins over a
 *   verdict, so the scheduled workflow can retry a transient failure without ever retrying a signal.
 *
 *   HERMETIC: every input is a fixture written to a temporary directory (the workspace, the records,
 *   the patch files, the ADRs, the registry documents), and `gh` and `pnpm` are replaced on `PATH` by
 *   a recording double, so the suite never reaches the npm registry or GitHub and never reads the
 *   repository's own records. It measures the gate's rule, not today's tree.
 *
 *   The fail-closed cases weigh as much as the happy path: a gate that passed an unreadable records
 *   file, or a registry document listing nothing, would report a clean verdict over inputs it never
 *   read.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "patched-dependencies-gate.mjs");

/** The instant every resolution fixture measures against unless it names its own. */
const INSTANT = "2026-10-20T00:00:00Z";

const PATCH_FILE = "patches/@widget__core@1.0.0.patch";
const ADR_FILE = "docs/technical/ADR-0001-widget-core-patch.md";

interface PatchRecord {
  readonly package: string;
  readonly version: string;
  readonly patch: string;
  readonly upstream: { readonly pr: string; readonly commit: string; readonly release: string };
  readonly resolvedBy: { readonly package: string; readonly range: string };
  readonly adr: string;
  readonly since: string;
  readonly why: string;
  readonly removeWhen: string;
}

interface Fixture {
  /** Key → value lines of the workspace's `patchedDependencies:` block; absent writes no block. */
  readonly keys?: Record<string, string>;
  readonly records?: readonly PatchRecord[];
  /** Repository-relative files to create under the fixture root. */
  readonly files?: readonly string[];
  /** Package name → the `pnpm view <name> versions time --json` document. */
  readonly registry?: Record<string, unknown>;
  /** The issues the `gh` double lists, and the comments it returns for any issue. */
  readonly issues?: readonly Record<string, unknown>[];
  readonly comments?: readonly Record<string, unknown>[] | Record<string, unknown>;
  /** The leading `gh` arguments the double fails on, for the failed-call case. */
  readonly ghFailsOn?: readonly string[];
  /** Replaces the records file's content, for the unreadable-input case. */
  readonly recordsText?: string;
  /** Replaces the workspace's content; null writes no workspace at all. */
  readonly workspaceText?: string | null;
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Every `gh` and `pnpm` call the doubles recorded: the command, then its arguments. */
  readonly calls: readonly (readonly string[])[];
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const makeRecord = (overrides: Partial<PatchRecord> = {}): PatchRecord => ({
  package: "@widget/core",
  version: "1.0.0",
  patch: PATCH_FILE,
  upstream: {
    pr: "https://example.test/widget/pull/1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    release: "https://example.test/widget/pull/2",
  },
  resolvedBy: { package: "@widget/core", range: ">=1.0.2" },
  adr: ADR_FILE,
  since: "2026-10-15",
  why: "Upstream's merged fix is unpublished.",
  removeWhen: "Move to 1.0.2 and delete the patch.",
  ...overrides,
});

/** A consistent tree: one key, its record, its patch file and its ADR. */
const CONSISTENT: Fixture = {
  keys: { '"@widget/core@1.0.0"': PATCH_FILE },
  records: [makeRecord()],
  files: [PATCH_FILE, ADR_FILE],
};

/** Writes a recording double of a command: it logs its arguments and answers from the fixture. */
const writeDouble = (bin: string, command: string): void => {
  const file = path.join(bin, command);
  const script = [
    `#!${process.execPath}`,
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    `fs.appendFileSync(path.join(__dirname, "calls.log"), JSON.stringify([${JSON.stringify(command)}, ...args]) + "\\n");`,
    `if (${JSON.stringify(command)} === "pnpm") process.exit(1);`,
    'const failsOn = JSON.parse(fs.readFileSync(path.join(__dirname, "fail.json"), "utf8"));',
    'if (failsOn.length > 0 && failsOn.every((part, index) => args[index] === part)) { process.stderr.write("HTTP 502: Bad Gateway\\n"); process.exit(1); }',
    'const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";',
    'if (args[0] === "api" && endpoint.split("?")[0].endsWith("/comments")) process.stdout.write(fs.readFileSync(path.join(__dirname, "comments.json"), "utf8"));',
    'else if (args[0] === "api") process.stdout.write(fs.readFileSync(path.join(__dirname, "issues.json"), "utf8"));',
  ].join("\n");
  writeFileSync(file, script, { mode: 0o755 });
};

/** Writes one fixture tree and runs the gate against it with the given mode flags. */
const runGate = (fixture: Fixture, flags: readonly string[]): GateResult => {
  const dir = mkdtempSync(path.join(tmpdir(), "patched-deps-gate-"));
  scratchDirs.push(dir);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeDouble(bin, "gh");
  writeDouble(bin, "pnpm");
  writeFileSync(path.join(bin, "issues.json"), JSON.stringify(fixture.issues ?? []));
  writeFileSync(path.join(bin, "comments.json"), JSON.stringify(fixture.comments ?? []));
  writeFileSync(path.join(bin, "fail.json"), JSON.stringify(fixture.ghFailsOn ?? []));

  const root = path.join(dir, "root");
  for (const file of fixture.files ?? []) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), "fixture\n");
  }
  mkdirSync(root, { recursive: true });
  const block =
    fixture.keys === undefined
      ? []
      : [
          "patchedDependencies:",
          "  # a comment inside the block is skipped, not read as an entry",
          ...Object.entries(fixture.keys).map(([key, value]) => `  ${key}: ${value}`),
        ];
  const workspace = path.join(root, "pnpm-workspace.yaml");
  if (fixture.workspaceText !== null) {
    writeFileSync(
      workspace,
      fixture.workspaceText ??
        [
          "packages:",
          '  - "apps/*"',
          "",
          "# patchedDependencies mentioned in a comment",
          ...block,
          "",
        ].join("\n")
    );
  }
  const records = path.join(dir, "records.json");
  writeFileSync(
    records,
    fixture.recordsText ??
      JSON.stringify({ description: "fixture", entries: fixture.records ?? [] })
  );
  const registry = path.join(dir, "registry");
  mkdirSync(registry);
  for (const [name, document] of Object.entries(fixture.registry ?? {})) {
    const file = `${name.replaceAll("@", "_").replaceAll("/", "_")}.json`;
    // A string is written as is, so a fixture can hold a document that is not JSON.
    writeFileSync(
      path.join(registry, file),
      typeof document === "string" ? document : JSON.stringify(document)
    );
  }

  const inputs = flags.includes("--check")
    ? ["--workspace", workspace, "--records", records, "--root", root]
    : ["--records", records, "--registry", registry, "--instant", INSTANT];
  const result = spawnSync(process.execPath, [GATE_SCRIPT, ...flags, ...inputs], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  const log = path.join(bin, "calls.log");
  const calls = existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
    : [];
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    calls,
  };
};

/** `@widget/core` published 1.0.0, 1.0.1, a 1.0.2 prerelease, then the stable 1.0.2 and 1.1.0. */
const WIDGET_RELEASED: Record<string, unknown> = {
  "@widget/core": {
    versions: ["1.0.0", "1.0.1", "1.0.2-rc.1", "1.0.2", "1.1.0"],
    time: {
      created: "2026-01-01T00:00:00Z",
      "1.0.0": "2026-01-01T00:00:00Z",
      "1.0.1": "2026-09-01T00:00:00Z",
      "1.0.2-rc.1": "2026-10-10T00:00:00Z",
      "1.0.2": "2026-10-16T12:00:00Z",
      "1.1.0": "2026-10-18T00:00:00Z",
    },
  },
};

/** `@widget/core` before the fix: only a prerelease inside `>=1.0.2`. */
const WIDGET_UNRELEASED: Record<string, unknown> = {
  "@widget/core": {
    versions: ["1.0.0", "1.0.1", "1.0.2-rc.1"],
    time: {
      "1.0.0": "2026-01-01T00:00:00Z",
      "1.0.1": "2026-09-01T00:00:00Z",
      "1.0.2-rc.1": "2026-10-10T00:00:00Z",
    },
  },
};

const RESOLVABLE_TITLE = "Patched dependency resolvable: @widget/core@1.0.0 → 1.0.2";

/** The issue the `gh` double lists as already open for the resolvable patch, opened the day before. */
const OPEN_ISSUE = {
  number: 7,
  title: RESOLVABLE_TITLE,
  state: "open",
  created_at: "2026-10-19T23:59:59Z",
};

/** A second patch whose registry document the fixture never writes. */
const UNREAD_RECORD = makeRecord({
  package: "@other/pkg",
  version: "2.0.0",
  patch: "patches/@other__pkg@2.0.0.patch",
  resolvedBy: { package: "@other/pkg", range: ">=2.0.1" },
});

/** The first recorded call whose leading elements are `prefix`. */
const findCall = (result: GateResult, prefix: readonly string[]): readonly string[] | undefined =>
  result.calls.find((call) => prefix.every((part, index) => call[index] === part));

describe("patched dependencies gate", () => {
  describe("--check, the consistency half", () => {
    it("exits 0 reporting the patch consistent when the key, the record, the patch file and the ADR agree", () => {
      const result = runGate(CONSISTENT, ["--check"]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("@widget/core@1.0.0\tpatch\tconsistent");
      expect(result.stdout).toContain("1 consistent, 0 violation(s)");
    });

    it("exits 0 with a clean pass that says so when nothing is patched and nothing is recorded", () => {
      const result = runGate({}, ["--check"]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0 patched dependencies: none in patchedDependencies");
    });

    it("exits 1 naming the key when a patchedDependencies entry has no record", () => {
      const result = runGate({ ...CONSISTENT, records: [] }, ["--check"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("@widget/core@1.0.0 is patched in");
      expect(result.stderr).toContain("has no well-formed record");
    });

    it("exits 1 naming the record when it has no patchedDependencies entry", () => {
      const result = runGate({ ...CONSISTENT, keys: {} }, ["--check"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "@widget/core@1.0.0 is recorded but has no `patchedDependencies` entry"
      );
      expect(result.stdout).toContain("@widget/core@1.0.0\tpatch\tINCONSISTENT");
    });

    it("exits 1 naming the file when a record's patch file is missing", () => {
      const result = runGate({ ...CONSISTENT, files: [ADR_FILE] }, ["--check"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`its patch file ${PATCH_FILE} does not exist`);
    });

    it("exits 1 naming the file when a record's ADR is missing", () => {
      const result = runGate({ ...CONSISTENT, files: [PATCH_FILE] }, ["--check"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`its ADR ${ADR_FILE} does not exist`);
    });

    it("exits 1 when a record's resolvedBy range does not parse", () => {
      const record = makeRecord({ resolvedBy: { package: "@widget/core", range: "^1.0.2" } });
      const result = runGate({ ...CONSISTENT, records: [record] }, ["--check"]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('declares resolvedBy.range "^1.0.2", which does not parse');
    });

    it("exits 1 naming the field when a record leaves a required field empty", () => {
      const result = runGate({ ...CONSISTENT, records: [makeRecord({ removeWhen: " " })] }, [
        "--check",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("lacks or misshapes removeWhen");
    });

    it("exits 1 when the workspace names a different patch file than the record", () => {
      const result = runGate(
        { ...CONSISTENT, keys: { '"@widget/core@1.0.0"': "patches/other.patch" } },
        ["--check"]
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`but its record names ${PATCH_FILE}`);
    });

    it("exits 1 when a key names no exact version", () => {
      const result = runGate({ ...CONSISTENT, keys: { '"@widget/core"': PATCH_FILE } }, [
        "--check",
      ]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "the `patchedDependencies` key @widget/core names no exact version"
      );
    });

    it("exits 1 when a file under patches/ is named by no record", () => {
      const result = runGate(
        { ...CONSISTENT, files: [PATCH_FILE, ADR_FILE, "patches/left.patch"] },
        ["--check"]
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("patches/left.patch is named by no record");
    });

    it.each<[string, Fixture, string]>([
      [
        "the records file is not JSON",
        { ...CONSISTENT, recordsText: "{ not json" },
        "could not be read, so no patch was measured",
      ],
      [
        "the records file holds no entries array",
        { ...CONSISTENT, recordsText: '{ "entries": {} }' },
        "holds no `entries` array, so no patch was measured",
      ],
      [
        "the workspace does not exist",
        { ...CONSISTENT, workspaceText: null },
        "pnpm-workspace.yaml could not be read, so no patch was measured",
      ],
      [
        "the workspace keys patchedDependencies as a flow mapping",
        {
          ...CONSISTENT,
          workspaceText: `patchedDependencies: { "@widget/core@1.0.0": ${PATCH_FILE} }\n`,
        },
        "is invisible to the text reader",
      ],
      [
        "a patchedDependencies line is not one flat entry",
        { ...CONSISTENT, keys: { '"@widget/core@1.0.0"': "a b" } },
        "is not one flat key: value entry",
      ],
      [
        "patches/ is a file, not a directory",
        { files: ["patches"] },
        "could not be read, so its files were not matched to records",
      ],
    ])("exits 3 rather than passing when %s", (_case, fixture, message) => {
      const result = runGate(fixture, ["--check"]);

      expect(result.status).toBe(3);
      expect(result.stderr).toContain(message);
      expect(result.stdout).not.toContain("\tconsistent");
      expect(result.stdout).not.toContain("(a clean pass)");
    });

    it("exits 3, not 1, when an inconsistency and an unreadable line occur together", () => {
      const result = runGate(
        {
          ...CONSISTENT,
          keys: { '"@widget/core@1.0.0"': PATCH_FILE, '"@other/pkg@2.0.0"': "a b" },
          records: [],
          files: [],
        },
        ["--check"]
      );

      expect(result.status).toBe(3);
      expect(result.stderr).toContain("has no well-formed record");
      expect(result.stderr).toContain("is not one flat key: value entry");
      expect(result.stdout).toContain("1 violation(s), 1 input(s) unread");
    });

    it("exits 0 when patches/ does not exist and nothing is patched", () => {
      const result = runGate({ keys: {} }, ["--check"]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("(a clean pass)");
    });

    it("reads no registry and calls no GitHub API", () => {
      const result = runGate(CONSISTENT, ["--check"]);

      expect(result.status).toBe(0);
      expect(result.calls).toEqual([]);
    });
  });

  describe("--resolution, the registry half", () => {
    it("exits 0 reporting unresolved with the latest stable when no version satisfies the range", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_UNRELEASED }, ["--resolution"]);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("@widget/core@1.0.0\tpatch\tunresolved (latest 1.0.1)");
    });

    it("exits 1 naming the lowest satisfying stable version, its publish instant and the remove-when", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED }, ["--resolution"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "@widget/core@1.0.0\tpatch\tresolvable: 1.0.2 published 2026-10-16T12:00:00Z"
      );
      expect(result.stderr).toContain(
        "patched-dependencies-gate: @widget/core@1.0.0 is resolvable by 1.0.2 (published 2026-10-16T12:00:00Z): Move to 1.0.2 and delete the patch."
      );
    });

    it("stays unresolved when only a prerelease satisfies the range", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_UNRELEASED }, ["--resolution"]);

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain("resolvable:");
    });

    it("does not count a release published after the instant", () => {
      const lateFix = {
        "@widget/core": {
          versions: ["1.0.0", "1.0.2"],
          time: { "1.0.0": "2026-01-01T00:00:00Z", "1.0.2": "2026-10-20T00:00:01Z" },
        },
      };
      const result = runGate({ ...CONSISTENT, registry: lateFix }, ["--resolution"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("unresolved (latest 1.0.0)");
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["the registry document is missing", {}, "ENOENT"],
      ["the registry document is not JSON", { "@widget/core": "{ not json" }, "JSON"],
      [
        "the registry document lists no versions",
        { "@widget/core": { versions: [], time: {} } },
        "lists no versions",
      ],
      [
        "the registry document carries no publish times",
        { "@widget/core": { versions: ["1.0.0", "1.0.2"], time: {} } },
        "carries no publish times",
      ],
    ])("exits 3 rather than passing when %s", (_case, registry, message) => {
      const result = runGate({ ...CONSISTENT, registry }, ["--resolution"]);

      expect(result.status).toBe(3);
      expect(result.stdout).toContain("@widget/core@1.0.0\tpatch\tunmeasured");
      expect(result.stderr).toContain("the registry of @widget/core could not be read");
      expect(result.stderr).toContain(message);
    });

    it("exits 3 rather than passing when the records file cannot be read", () => {
      const result = runGate(
        { ...CONSISTENT, recordsText: "{ not json", registry: WIDGET_RELEASED },
        ["--resolution"]
      );

      expect(result.status).toBe(3);
      expect(result.stderr).toContain("could not be read, so no patch was measured");
    });

    it("exits 3, not 1, for a malformed record, so 1 means only a resolvable patch", () => {
      const result = runGate(
        { ...CONSISTENT, records: [makeRecord({ removeWhen: " " })], registry: WIDGET_RELEASED },
        ["--resolution"]
      );

      expect(result.status).toBe(3);
      expect(result.stderr).toContain("lacks or misshapes removeWhen");
      expect(result.stderr).toContain("its resolution was not measured");
    });

    it("exits 3, not 1, when one patch is resolvable and another's registry cannot be read", () => {
      const result = runGate(
        { ...CONSISTENT, records: [makeRecord(), UNREAD_RECORD], registry: WIDGET_RELEASED },
        ["--resolution"]
      );

      expect(result.status).toBe(3);
      expect(result.stdout).toContain("@widget/core@1.0.0\tpatch\tresolvable: 1.0.2");
      expect(result.stdout).toContain("@other/pkg@2.0.0\tpatch\tunmeasured");
      expect(result.stderr).toContain("@widget/core@1.0.0 is resolvable by 1.0.2");
      expect(result.stderr).toContain("the registry of @other/pkg could not be read");
    });
  });

  describe("--remind, one issue per resolvable patch", () => {
    it("opens one labelled issue when none exists", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED }, [
        "--resolution",
        "--remind",
      ]);
      const created = findCall(result, ["gh", "issue", "create"]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`remind: open: ${RESOLVABLE_TITLE}`);
      expect(findCall(result, ["gh", "label", "create", "patched-dependency"])).toBeDefined();
      expect(created?.slice(3, 5)).toEqual(["--title", RESOLVABLE_TITLE]);
      expect(created?.slice(-2)).toEqual(["--label", "patched-dependency"]);
      expect(created?.[6]).toContain("Remove-when: Move to 1.0.2 and delete the patch.");
    });

    it("comments on the open issue instead of opening a second one", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED, issues: [OPEN_ISSUE] }, [
        "--resolution",
        "--remind",
      ]);

      expect(result.stdout).toContain(`remind: comment #7: ${RESOLVABLE_TITLE}`);
      expect(findCall(result, ["gh", "issue", "comment", "7"])?.[5]).toContain(
        "Still resolvable on 2026-10-20"
      );
      expect(findCall(result, ["gh", "issue", "create"])).toBeUndefined();
    });

    it("does not comment twice on the same day", () => {
      const first = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED, issues: [OPEN_ISSUE] }, [
        "--resolution",
        "--remind",
      ]);
      const posted = findCall(first, ["gh", "issue", "comment", "7"])?.[5];

      const second = runGate(
        {
          ...CONSISTENT,
          registry: WIDGET_RELEASED,
          issues: [OPEN_ISSUE],
          comments: [{ body: posted }],
        },
        ["--resolution", "--remind"]
      );

      expect(posted).toBeDefined();
      expect(second.stdout).toContain(
        `remind: skip #7: ${RESOLVABLE_TITLE} (already commented on 2026-10-20)`
      );
      expect(findCall(second, ["gh", "issue", "comment"])).toBeUndefined();
    });

    it("reopens an issue closed while the patch still stands", () => {
      const closed = { number: 9, title: RESOLVABLE_TITLE, state: "closed" };
      const result = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED, issues: [closed] }, [
        "--resolution",
        "--remind",
      ]);

      expect(result.stdout).toContain(`remind: reopen #9: ${RESOLVABLE_TITLE}`);
      expect(findCall(result, ["gh", "issue", "reopen", "9", "--comment"])?.[5]).toContain(
        "Still resolvable on 2026-10-20"
      );
    });

    it("opens no second issue and posts no comment on a re-run the day it opened the issue", () => {
      const first = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED }, [
        "--resolution",
        "--remind",
      ]);
      // The issue the first run opened, as GitHub lists it on the second: open, created that day.
      const opened = {
        number: 11,
        title: findCall(first, ["gh", "issue", "create"])?.[4],
        state: "open",
        created_at: "2026-10-20T00:00:05Z",
      };

      const second = runGate({ ...CONSISTENT, registry: WIDGET_RELEASED, issues: [opened] }, [
        "--resolution",
        "--remind",
      ]);

      expect(opened.title).toBe(RESOLVABLE_TITLE);
      expect(second.status).toBe(1);
      expect(second.stdout).toContain(
        `remind: skip #11: ${RESOLVABLE_TITLE} (opened on 2026-10-20)`
      );
      expect(findCall(second, ["gh", "issue", "create"])).toBeUndefined();
      expect(findCall(second, ["gh", "issue", "comment"])).toBeUndefined();
    });

    it("exits 3, not 1, when a GitHub call fails, naming the call's error", () => {
      const result = runGate(
        { ...CONSISTENT, registry: WIDGET_RELEASED, ghFailsOn: ["issue", "create"] },
        ["--resolution", "--remind"]
      );

      expect(result.status).toBe(3);
      expect(result.stdout).toContain("resolvable: 1.0.2");
      expect(result.stdout).not.toContain("remind: open:");
      expect(result.stderr).toContain("patched-dependencies-gate: GitHub:");
      expect(result.stderr).toContain("HTTP 502: Bad Gateway");
    });

    it("exits 3 rather than commenting again when the comments listing is not a list", () => {
      const result = runGate(
        {
          ...CONSISTENT,
          registry: WIDGET_RELEASED,
          issues: [OPEN_ISSUE],
          comments: { message: "Bad credentials" },
        },
        ["--resolution", "--remind"]
      );

      expect(result.status).toBe(3);
      expect(result.stderr).toContain("listing the comments of #7 returned no list");
      expect(findCall(result, ["gh", "issue", "comment"])).toBeUndefined();
    });

    it("calls no GitHub API when nothing is resolvable", () => {
      const result = runGate({ ...CONSISTENT, registry: WIDGET_UNRELEASED }, [
        "--resolution",
        "--remind",
      ]);

      expect(result.status).toBe(0);
      expect(result.calls).toEqual([]);
    });
  });

  describe("usage", () => {
    it("exits 2 on an unknown flag rather than ignoring it", () => {
      const result = runGate(CONSISTENT, ["--check", "--registries"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage:");
    });

    it("exits 2 when neither mode is given", () => {
      const result = runGate(CONSISTENT, ["--remind"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("give exactly one of --check and --resolution");
    });
  });
});
