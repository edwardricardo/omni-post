/**
 * @file overrideBandsGate.test.ts
 * @description Pins `scripts/testing/override-bands-gate.mjs`, the gate that refuses a
 *   range-scoped `overrides:` entry whose band no longer describes the versions its own target
 *   replaces.
 *
 *   WHY THE GATE EXISTS, and therefore what this suite has to hold: a CVE floor is written as
 *   `"pkg@<X": X` so the band and the target are the same number. When a new advisory raises the
 *   target and the band is left behind, the tree resolves to the PREVIOUS target — a version the
 *   old band no longer selects — and the override silently stops applying while still reading as a
 *   floor. That shape has eight recorded instances in this repository (`fast-uri` twice,
 *   `brace-expansion` three times, `undici`, `sharp`, and one where the advisory's vulnerable set
 *   WAS the target), and until this gate nothing detected it.
 *
 *   Every input is injected from a fixture: the gate is handed a `pnpm-workspace.yaml` written into
 *   a scratch directory, so the suite never reads the repository's own manifest. That is what makes
 *   it HERMETIC — it measures the gate's RULE rather than today's override block, and it can still
 *   prove the red path once the real file is clean.
 *
 *   The ALLOWLIST is a literal inside the gate rather than an injected input, because an injected
 *   allowlist would prove the mechanism and leave the two real exceptions unmeasured. Every
 *   fixture therefore carries both keys, which is also what drives the two cases that only the
 *   allowlist can make green, and one fixture drops one of them to drive the orphan refusal.
 *
 *   The fail-closed cases carry as much weight as the happy path. A gate that reports a clean zero
 *   over a block it could not parse, a line it could not read, or a file that is not there asserts
 *   an invariant nobody measured, so each of those refusals is driven here by name.
 *
 *   Neither the suite nor the gate needs git: the suite finds the repository by its
 *   `pnpm-workspace.yaml` marker, and one case runs a copy of the gate from a directory that is no
 *   repository at all, which is how the gate's own manifest lookup is proven.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "override-bands-gate.mjs");

const BLOCK_READER = path.join(REPO_ROOT, "scripts", "testing", "workspace-block-reader.mjs");

/**
 * The keys the gate's own allowlist names, written here exactly as the real manifest writes them.
 * Every fixture renders both unless it deliberately drops one: an allowlist entry that matches no
 * override key is itself a violation, so omitting them would make every other case red for the
 * wrong reason.
 */
const ALLOWLISTED: readonly (readonly [string, string])[] = [
  ['"find-my-way@<9.6.1"', "9.7.0"],
  ['"google-auth-library@10"', "10.7.0"],
];

interface Fixture {
  /** Override entries rendered verbatim, in order, as `  <key>: <value>` lines. */
  readonly overrides?: readonly (readonly [string, string])[];
  /** Allowlisted keys to leave OUT of the rendered block, for the orphan refusal. */
  readonly omitAllowlisted?: readonly string[];
  /**
   * Renders a COLUMN-0 comment between the allowlisted entries and the fixture's own. YAML allows an
   * unindented comment inside a mapping — yaml 2.9.0 and js-yaml 4.3.2 both parse the entries after
   * it into the same mapping — so a reader that treats column 0 as the end of the block drops every
   * entry after it, which is where new overrides are appended.
   */
  readonly separatorComment?: boolean;
  /** Replaces the whole file, for the cases whose subject is the file's own structure. */
  readonly raw?: string;
  /** Deletes the file after it is written, to drive the unreadable path. */
  readonly remove?: boolean;
  /** Extra flags, for the usage-error case. */
  readonly extraArgs?: readonly string[];
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A fixture manifest whose other blocks each carry a DECOY entry shaped like a range-scoped
 * override. `catalog:` holds a target that satisfies its own band and `patchedDependencies:` holds a
 * value that is not a version at all, so either one being read would turn a clean fixture red. Block
 * scoping is therefore proven by the happy path rather than asserted in prose. The key below the
 * block is introduced by a column-0 comment, the way the real manifest introduces most of its
 * top-level keys, so the happy path also proves that the block ends at that KEY: a reader that
 * skipped every column-0 line, the key included, would read the decoy.
 */
const renderWorkspace = (fixture: Fixture): string => {
  const omitted = new Set(fixture.omitAllowlisted ?? []);
  const render = (pairs: readonly (readonly [string, string])[]): string[] =>
    pairs.map(([key, value]) => `  ${key}: ${value}`);
  return [
    "packages:",
    '  - "apps/*"',
    "",
    "catalog:",
    '  "decoy-catalog@<1.0.0": 0.9.0',
    "",
    "overrides:",
    '  axios: "catalog:"',
    "  bn.js: 5.2.3",
    ...render(ALLOWLISTED.filter(([key]) => !omitted.has(key))),
    ...(fixture.separatorComment === true
      ? ["# a column-0 comment, which YAML allows inside a mapping"]
      : []),
    ...render(fixture.overrides ?? []),
    "",
    "# a column-0 comment introducing the next top-level key",
    "patchedDependencies:",
    '  "decoy-patched@<1.0.0": patches/decoy-patched.patch',
    "",
    "auditConfig:",
    "  ignoreGhsas:",
    "    - GHSA-0000-0000-0000",
    "",
  ].join("\n");
};

const runGate = (fixture: Fixture): GateResult => {
  const dir = mkdtempSync(path.join(tmpdir(), "override-bands-gate-"));
  scratchDirs.push(dir);

  const manifest = path.join(dir, "pnpm-workspace.yaml");
  writeFileSync(manifest, fixture.raw ?? renderWorkspace(fixture));
  if (fixture.remove === true) unlinkSync(manifest);

  const result = spawnSync(
    process.execPath,
    [GATE_SCRIPT, "--workspace", manifest, ...(fixture.extraArgs ?? [])],
    { encoding: "utf8" }
  );
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/**
 * Runs a COPY of the gate placed at `<scratch>/scripts/testing/`, with no `--workspace` flag and the
 * scratch directory — which is no git repository — as its working directory. The only manifest the
 * copy can measure is then the one written beside its `scripts/` directory, so a lookup that leaned
 * on git or on the working directory fails here instead of quietly reading another tree. The block
 * reader the gate imports is copied beside it, exactly as it sits in the repository.
 */
const runCopiedGate = (manifest: string): GateResult => {
  const dir = mkdtempSync(path.join(tmpdir(), "override-bands-gate-copy-"));
  scratchDirs.push(dir);

  const scriptDir = path.join(dir, "scripts", "testing");
  mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "override-bands-gate.mjs");
  copyFileSync(GATE_SCRIPT, script);
  copyFileSync(BLOCK_READER, path.join(scriptDir, "workspace-block-reader.mjs"));
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), manifest);

  const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

describe("override bands gate", () => {
  describe("where the manifest is found", () => {
    it("reads the manifest beside its own scripts directory, needing neither git nor the working directory", () => {
      const result = runCopiedGate(
        renderWorkspace({ overrides: [['"sentinel@<1.0.0"', "1.0.0"]] })
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("sentinel@<1.0.0\t1.0.0\tcanonical");
      expect(result.stdout).toContain("3 range-scoped overrides measured, 0 violating");
    });
  });

  describe("the canonical CVE-floor shape", () => {
    it("accepts a band whose exclusive upper bound is the target, in both written forms", () => {
      const result = runGate({
        overrides: [
          ['"widget@<2.0.0"', "2.0.0"],
          ['"gadget@>=3.0.0 <3.1.8"', "3.1.8"],
        ],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget@<2.0.0");
      expect(result.stdout).toContain("gadget@>=3.0.0 <3.1.8");
    });

    it("parses a scoped package name, whose own leading @ is not the band separator", () => {
      const result = runGate({
        overrides: [['"@scope/widget@>=0.7.0 <0.8.15"', "0.8.15"]],
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("@scope/widget@>=0.7.0 <0.8.15");
    });

    it("counts only the range-scoped keys, and prints that count on a clean run", () => {
      const result = runGate({ overrides: [['"widget@<2.0.0"', "2.0.0"]] });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("3 range-scoped overrides measured, 0 violating");
    });

    it("accepts an exclusive lower bound alongside the canonical upper one", () => {
      const result = runGate({ overrides: [['"widget@>1.0.0 <2.0.0"', "2.0.0"]] });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget@>1.0.0 <2.0.0");
    });
  });

  describe("a column-0 comment inside the block", () => {
    // YAML allows an unindented comment inside a mapping. A reader that ends the block at column 0
    // drops every entry after it — and new overrides are appended at the END, so the entry most
    // likely to be wrong is the one dropped.
    it("still reads the entries that follow it, so a violation after it is not silently skipped", () => {
      const result = runGate({
        separatorComment: true,
        overrides: [['"bad@>=3.0.0 <3.1.8"', "3.1.9"]],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("bad@>=3.0.0 <3.1.8");
      expect(result.stdout).toContain("3 range-scoped overrides measured, 1 violating");
    });

    it("does not count the comment itself as an unreadable entry", () => {
      const result = runGate({ separatorComment: true });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("2 range-scoped overrides measured, 0 violating");
    });
  });

  describe("a target the band was left behind by", () => {
    it("exits 1 naming the key, the band's upper bound and the target", () => {
      const result = runGate({ overrides: [['"fast-uri@>=3.0.0 <3.1.8"', "3.1.9"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("override-bands-gate:");
      expect(result.stderr).toContain("fast-uri@>=3.0.0 <3.1.8");
      expect(result.stderr).toContain("3.1.8");
      expect(result.stderr).toContain("3.1.9");
    });

    // The remedy keeps the band's lower bound. Dropping it would turn a floor scoped to the 3.x line
    // into one that lifts every older major onto 3.1.9 as well.
    it("names the remedy with the band's lower bound kept, so applying it cannot widen the floor", () => {
      const result = runGate({ overrides: [['"fast-uri@>=3.0.0 <3.1.8"', "3.1.9"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("`fast-uri@>=3.0.0 <3.1.9`");
    });

    it("exits 1 when the upper bound is below the target and no allowlist reason records why", () => {
      const result = runGate({ overrides: [['"widget@<9.6.1"', "9.7.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@<9.6.1");
    });
  });

  describe("a target that satisfies its own band", () => {
    it("exits 1, because such an override cannot lift anything above the band", () => {
      const result = runGate({ overrides: [['"widget@<2.0.0"', "1.5.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@<2.0.0");
      expect(result.stderr).toContain("SATISFIES its own band");
    });

    it("exits 1 on a major-scoped band that is not allowlisted", () => {
      const result = runGate({ overrides: [['"widget@8"', "8.1.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@8");
      expect(result.stderr).toContain("SATISFIES its own band");
    });
  });

  describe("a bare major or major.minor band", () => {
    // Such a band's upper bound is DERIVED, never written: `8` is the 8.x line (below 9.0.0) and
    // `7.1` the 7.1.x line (below 7.2.0). Each pair below sits on both sides of that derived bound,
    // so an off-by-one in it flips one verdict of the pair.
    it("reads the next major as outside a major band, and names the canonical rewrite", () => {
      const result = runGate({ overrides: [['"widget@8"', "9.0.0"]] });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "widget@8\t9.0.0\tviolation: the band was left behind by its target"
      );
      expect(result.stderr).toContain("`widget@>=8.0.0 <9.0.0`");
    });

    it("reads the last release of the line as inside a major band", () => {
      const result = runGate({ overrides: [['"widget@8"', "8.99.99"]] });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "widget@8\t8.99.99\tviolation: the target satisfies its own band"
      );
    });

    it("reads the next minor as outside a major.minor band", () => {
      const result = runGate({ overrides: [['"widget@7.1"', "7.2.0"]] });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "widget@7.1\t7.2.0\tviolation: the band was left behind by its target"
      );
    });

    it("reads a later patch as inside a major.minor band", () => {
      const result = runGate({ overrides: [['"widget@7.1"', "7.1.99"]] });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "widget@7.1\t7.1.99\tviolation: the target satisfies its own band"
      );
    });
  });

  describe("the allowlist", () => {
    // Each assertion names the ALLOWLISTED verdict and the recorded reason. The key alone also
    // appears on a violation line, so asserting only the key would stay green with the allowlist
    // branch gone or printing nothing of the measurement that earned the exception.
    it("accepts the unpublished-patch exception through its entry, and prints its recorded reason", () => {
      const result = runGate({});

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("find-my-way@<9.6.1\t9.7.0\tallowlisted: ");
      expect(result.stdout).toContain("npm never published it");
    });

    it("accepts the major-scoped compatibility pin through its entry, and prints its recorded reason", () => {
      const result = runGate({});

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "google-auth-library@10\t10.7.0\tallowlisted: a compatibility pin scoped to ONE major"
      );
      expect(result.stdout).toContain("seven TS2769");
    });

    it("exits 1 when an allowlist entry matches no override key, so the list can only shrink", () => {
      const result = runGate({ omitAllowlisted: ['"google-auth-library@10"'] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("google-auth-library@10");
      expect(result.stderr).toContain("allowlist");
    });
  });

  describe("an inclusive upper bound", () => {
    // The assertions name the INCLUSIVE branch's own wording, not the remedy. Both the remedy string
    // and the catch-all "band was left behind" message end in `@<1.4.2`, so asserting only that let a
    // mutant that deleted this branch entirely stay green — the catch-all caught the same fixture for
    // the wrong reason and reported the wrong repair.
    it("exits 1, because <=X cannot be the target and leaves the two free to drift", () => {
      const result = runGate({ overrides: [['"valibot@<=1.4.1"', "1.4.2"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("valibot@<=1.4.1");
      expect(result.stderr).toContain("upper bound `<=1.4.1` is INCLUSIVE");
      expect(result.stdout).toContain("REFUSED: inclusive upper bound");
      expect(result.stdout).toContain("3 range-scoped overrides measured, 1 violating");
      expect(result.stderr).toContain("`valibot@<1.4.2`");
    });
  });

  describe("quoting and YAML layouts the line reader meets", () => {
    it("reads a single-quoted key and value, the quoting pnpm writes in its own lockfile", () => {
      const result = runGate({ overrides: [["'widget@>=1.0.0 <2.0.0'", "'2.0.0'"]] });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("widget@>=1.0.0 <2.0.0\t2.0.0\tcanonical");
    });

    it("still judges a single-quoted key, so quoting cannot hide a band left behind", () => {
      const result = runGate({ overrides: [["'widget@<2.0.0'", "2.0.1"]] });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "widget@<2.0.0\t2.0.1\tviolation: the band was left behind by its target"
      );
    });

    it("refuses a flow-style overrides mapping rather than reading it as an empty block", () => {
      const result = runGate({
        raw: ['overrides: { "widget@<2.0.0": 2.0.1 }', "", "auditConfig: {}", ""].join("\n"),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("zero range-scoped overrides");
    });
  });

  describe("fail-closed refusals", () => {
    it("exits 1 on an overrides block that holds nothing but comments", () => {
      const result = runGate({
        raw: ["overrides:", "  # every entry was removed", "", "auditConfig: {}", ""].join("\n"),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("zero range-scoped overrides");
      expect(result.stdout).not.toContain("range-scoped overrides measured");
    });

    it("exits 1 on a manifest with no top-level overrides block at all", () => {
      const result = runGate({
        raw: ["packages:", '  - "apps/*"', "", "catalog:", "  zod: 4.1.13", ""].join("\n"),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no top-level `overrides:` block");
    });

    it("exits 1 when the manifest cannot be read", () => {
      const result = runGate({ remove: true });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("could not be read");
    });

    it("exits 1 on a range-scoped key whose value is not a version", () => {
      const result = runGate({ overrides: [['"widget@<2.0.0"', '"catalog:"']] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@<2.0.0");
      expect(result.stderr).toContain("three-number version");
    });

    it("exits 1 on a prerelease target, naming the suffix as what disqualifies it", () => {
      const result = runGate({ overrides: [['"widget@<2.0.0"', "2.0.0-rc.1"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@<2.0.0 → 2.0.0-rc.1");
      expect(result.stderr).toContain("prerelease");
    });

    it("exits 1 on a key whose band is empty, which selects nothing", () => {
      const result = runGate({ overrides: [['"widget@"', "1.0.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the band is empty");
    });

    it("exits 1 on a comparator the minimal parser does not recognise", () => {
      const result = runGate({ overrides: [['"widget@^1.2.0"', "1.3.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@^1.2.0");
    });

    it("exits 1 on a band declaring two exclusive upper bounds, which target should equal which", () => {
      const result = runGate({ overrides: [['"widget@>=1.0.0 <2.0.0 <3.0.0"', "2.0.0"]] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("widget@>=1.0.0 <2.0.0 <3.0.0");
    });

    it("exits 1 on an entry line inside the block that the parser cannot read", () => {
      const result = runGate({
        raw: ["overrides:", '  "widget@<2.0.0": 2.0.0', "  - not an entry", ""].join("\n"),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("- not an entry");
    });

    it("exits 1 on an unrecognised flag rather than silently reading the live manifest", () => {
      const result = runGate({ extraArgs: ["--fix"] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("usage:");
    });
  });
});
