/**
 * @file enginesNodeGate.test.ts
 * @description Pins `scripts/testing/engines-node-gate.mjs`, the gate that refuses a workspace
 *   manifest which does not declare `engines.node` at the runtime major, and a `@types/node` catalog
 *   pin on a different major from that runtime.
 *
 *   Every input is injected from a fixture here — the `.nvmrc` major, the runtime the gate believes
 *   it is running on, the manifest population, the catalog and the population floor. That is what
 *   makes this suite HERMETIC: it never reads the repository's own manifests, so it measures the
 *   gate's RULE rather than today's tree, and it can still prove the red path once the tree is clean.
 *
 *   The fail-closed cases carry as much weight as the happy path. This gate exists because
 *   `@types/node` was free to run a major AHEAD of the runtime unnoticed for want of any declaration
 *   to compare against; a gate that reports a clean zero when its `.nvmrc` is unreadable, when it is
 *   itself running on the wrong runtime, or over a population that a moved layout shrank to nothing,
 *   would reproduce exactly that class of silence. Each of those refusals is therefore driven here.
 *
 *   The DEFAULT population floor is driven by the one case that passes no `--floor`, because a floor
 *   that only ever runs with a fixture value is not the floor CI uses.
 *
 *   The `--write` codemod is driven as a rule too, not as a convenience: it must fill a missing
 *   declaration, leave every other byte of the manifest alone, refuse when the canonical value is
 *   absent, and NEVER overwrite a value that disagrees — an overwrite would silently erase the very
 *   disagreement the gate exists to report.
 * @layer infrastructure
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "engines-node-gate.mjs");

/** The canonical value every fixture manifest is expected to carry. */
const CANONICAL = ">=24.15.0 <25";

/** The runtime the gate is told it is running on, unless a case overrides it. */
const RUNTIME = "24.15.0";

interface Fixture {
  /** Contents of `.nvmrc`; omitted entirely when `null`, so the missing-file path can be driven. */
  readonly nvmrc?: string | null;
  /** The version the gate is told `process.versions.node` reports. */
  readonly runtime?: string;
  /**
   * Relative manifest path → its parsed body. The root `package.json` is the canonical one, so every
   * fixture declares it explicitly.
   */
  readonly manifests: Record<string, Record<string, unknown>>;
  /** Raw text for a manifest, for the cases whose subject is the file's exact bytes. */
  readonly rawManifests?: Record<string, string>;
  /** The `@types/node` catalog pin; omitted entirely when `null`. */
  readonly catalogTypesNode?: string | null;
  /**
   * An `@types/node` entry in an `overrides:` block rendered BEFORE the catalog, for the case whose
   * subject is WHICH block the pin is read from. A transitive override is a different declaration
   * with a different meaning, and it may legitimately name another major.
   */
  readonly overridesTypesNode?: string;
  /** Passed as `--floor`; omitted so the DEFAULT floor applies when this is `null`. */
  readonly floor?: number | null;
  /** Adds `--write` to the invocation. */
  readonly write?: boolean;
  /** Extra flags, for the usage cases. */
  readonly extraFlags?: readonly string[];
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The fixture directory, so a case can read back what `--write` produced. */
  readonly dir: string;
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** A manifest body that declares the canonical value, for the filler manifests of each fixture. */
const compliant = (name: string): Record<string, unknown> => ({
  name,
  version: "0.0.0",
  private: true,
  engines: { node: CANONICAL },
  scripts: { test: "true" },
});

/**
 * Writes one fixture tree and runs the complete gate against it. Every manifest is rendered with
 * two-space indentation and a trailing newline, which is what the repository's prettier produces and
 * therefore what the `--write` cases must find preserved.
 */
const runGate = (fixture: Fixture): GateResult => {
  const dir = mkdtempSync(path.join(tmpdir(), "engines-node-gate-"));
  scratchDirs.push(dir);

  const relativePaths = [
    ...Object.keys(fixture.manifests),
    ...Object.keys(fixture.rawManifests ?? {}),
  ];
  for (const [relative, body] of Object.entries(fixture.manifests)) {
    const absolute = path.join(dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(body, null, 2)}\n`);
  }
  for (const [relative, text] of Object.entries(fixture.rawManifests ?? {})) {
    const absolute = path.join(dir, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }

  if (fixture.nvmrc !== null) writeFileSync(path.join(dir, ".nvmrc"), fixture.nvmrc ?? "24\n");

  // The catalog is read as text, exactly as the gate reads pnpm-workspace.yaml, so the fixture
  // renders a plausible neighbourhood rather than a bare key.
  const pin = fixture.catalogTypesNode;
  writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    [
      "packages:",
      '  - "apps/*"',
      // Rendered BEFORE the catalog on purpose: a scan that takes the first `@types/node` line it
      // finds anywhere in the file would bind here instead of on the pin.
      ...(fixture.overridesTypesNode === undefined
        ? []
        : ["overrides:", `  "@types/node": ${fixture.overridesTypesNode}`]),
      "catalog:",
      '  "@types/react": 19.2.14',
      ...(pin === null ? [] : [`  "@types/node": ${pin ?? "24.13.6"} # runtime major`]),
      '  "vitest": 4.1.11',
      "",
    ].join("\n")
  );

  writeFileSync(path.join(dir, "manifest-list.txt"), `${relativePaths.join("\n")}\n`);

  const result = spawnSync(
    process.execPath,
    [
      GATE_SCRIPT,
      ...(fixture.write === true ? ["--write"] : []),
      "--root",
      dir,
      "--manifest-list",
      path.join(dir, "manifest-list.txt"),
      "--runtime",
      fixture.runtime ?? RUNTIME,
      ...(fixture.floor === null ? [] : ["--floor", String(fixture.floor ?? 2)]),
      ...(fixture.extraFlags ?? []),
    ],
    { encoding: "utf8" }
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    dir,
  };
};

const ROOT_COMPLIANT: Record<string, unknown> = {
  name: "fixture-root",
  version: "1.0.0",
  private: true,
  packageManager: "pnpm@12.6.0",
  engines: { node: CANONICAL },
  scripts: { lint: "true" },
};

describe("workspace engines.node gate", () => {
  describe("a compliant workspace", () => {
    it("exits 0 and reports the population, the canonical value and the runtime major", () => {
      const result = runGate({
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
          "packages/shared/package.json": compliant("@packages/shared"),
        },
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("3 manifests");
      expect(result.stdout).toContain(CANONICAL);
      expect(result.stdout).toContain("runtime 24");
    });
  });

  describe("a manifest that does not declare engines.node", () => {
    it("exits 1 naming that manifest", () => {
      const { engines: _engines, ...withoutEngines } = compliant("@apps/api");
      const result = runGate({
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": withoutEngines,
          "packages/shared/package.json": compliant("@packages/shared"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("apps/api/package.json");
      expect(result.stderr).toContain("declares no engines.node");
      expect(result.stderr).not.toContain("packages/shared/package.json");
    });
  });

  describe("a manifest whose major is BEHIND the runtime", () => {
    it("exits 1 naming the manifest, the value read and the runtime major", () => {
      const result = runGate({
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": {
            ...compliant("@apps/api"),
            engines: { node: ">=22.12.0 <23" },
          },
          "packages/shared/package.json": compliant("@packages/shared"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("apps/api/package.json");
      expect(result.stderr).toContain(">=22.12.0 <23");
      expect(result.stderr).toContain("major 22");
      expect(result.stderr).toContain("runtime major 24");
    });
  });

  describe("a manifest whose major is AHEAD of the runtime", () => {
    it("exits 1 as loudly as one behind it, because that is the drift this gate exists for", () => {
      const result = runGate({
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": {
            ...compliant("@apps/api"),
            engines: { node: ">=26.0.0 <27" },
          },
          "packages/shared/package.json": compliant("@packages/shared"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("apps/api/package.json");
      expect(result.stderr).toContain(">=26.0.0 <27");
      expect(result.stderr).toContain("major 26");
      expect(result.stderr).toContain("runtime major 24");
    });
  });

  describe("a manifest on the right major but a different value from the root's", () => {
    it("exits 1 naming both values, because one source of truth admits no variants", () => {
      const result = runGate({
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": {
            ...compliant("@apps/api"),
            engines: { node: ">=24.0.0 <25" },
          },
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("apps/api/package.json");
      expect(result.stderr).toContain(">=24.0.0 <25");
      expect(result.stderr).toContain(CANONICAL);
    });
  });

  describe("a root value whose SHAPE is not the required one", () => {
    it.each([
      ["^24", "a caret range names no floor the runtime can be held to"],
      [">=24", "a bare major names no patch floor"],
      ["24.x", "an x-range names no floor and no ceiling"],
      [">=24.15.0", "an open upper bound admits the next major silently"],
      [">=24.15.0 <26", "a ceiling two majors up admits the next major silently"],
    ])("exits 1 for %s, naming the shape rule", (value) => {
      const result = runGate({
        manifests: {
          "package.json": { ...ROOT_COMPLIANT, engines: { node: value } },
          "apps/api/package.json": { ...compliant("@apps/api"), engines: { node: value } },
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the root package.json declares engines.node");
      expect(result.stderr).toContain(value);
      expect(result.stderr).toContain(">=24.<minor>.<patch> <25");
    });

    it("exits 1 when the root declares no engines.node at all", () => {
      const { engines: _engines, ...rootWithout } = ROOT_COMPLIANT;
      const result = runGate({
        manifests: {
          "package.json": rootWithout,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the root package.json declares engines.node");
      expect(result.stderr).toContain("(absent)");
    });
  });

  describe("an unusable .nvmrc", () => {
    it("exits 1 when the file is missing, rather than assuming a major", () => {
      const result = runGate({
        nvmrc: null,
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(".nvmrc");
      expect(result.stdout).not.toContain("manifests");
    });

    it("exits 1 when the file does not hold a bare integer major", () => {
      const result = runGate({
        nvmrc: "lts/krypton\n",
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("lts/krypton");
      expect(result.stderr).toContain("integer");
    });
  });

  describe("the gate running on a runtime the repository does not declare", () => {
    it("exits 1 naming both majors, because a gate on the wrong runtime proves nothing", () => {
      const result = runGate({
        runtime: "22.14.0",
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("22.14.0");
      expect(result.stderr).toContain("24");
      expect(result.stderr).toContain(".nvmrc");
    });
  });

  describe("a population smaller than the floor", () => {
    it("exits 1 under the DEFAULT floor, so a moved layout cannot read as a clean zero", () => {
      const result = runGate({
        floor: null,
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
          "packages/shared/package.json": compliant("@packages/shared"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("3 manifests");
      expect(result.stderr).toContain("90");
    });
  });

  describe("the @types/node catalog pin", () => {
    it("exits 1 when it sits on a major above the runtime", () => {
      const result = runGate({
        catalogTypesNode: "25.9.3",
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("@types/node");
      expect(result.stderr).toContain("25.9.3");
      expect(result.stderr).toContain("runtime major 24");
    });

    it("is read from the catalog block, never from an overrides entry above it", () => {
      const result = runGate({
        overridesTypesNode: "26.0.0",
        catalogTypesNode: "24.13.6",
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      // An `overrides:` entry is a TRANSITIVE declaration: it bounds what someone else's open range
      // resolves to, which may legitimately be another major. Only the catalog pin is ours to compare
      // with the runtime, so the gate must not go red on the override — nor green on it.
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("@types/node 24.13.6");
      expect(result.stdout).not.toContain("26.0.0");
    });

    it("exits 1 when the catalog declares no pin, rather than skipping the comparison", () => {
      const result = runGate({
        catalogTypesNode: null,
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("@types/node");
      expect(result.stderr).toContain("catalog");
    });
  });

  describe("--write", () => {
    const RAW_WITHOUT_ENGINES = [
      "{",
      '  "name": "@apps/api",',
      '  "version": "0.0.0",',
      '  "private": true,',
      '  "type": "module",',
      '  "scripts": {',
      '    "test": "true"',
      "  },",
      '  "dependencies": {',
      '    "zod": "catalog:"',
      "  }",
      "}",
      "",
    ].join("\n");

    it("fills every missing declaration from the root value and leaves the check green", () => {
      const result = runGate({
        write: true,
        manifests: { "package.json": ROOT_COMPLIANT },
        rawManifests: { "apps/api/package.json": RAW_WITHOUT_ENGINES },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("apps/api/package.json");

      const written = readFileSync(path.join(result.dir, "apps/api/package.json"), "utf8");
      const parsed = JSON.parse(written) as Record<string, unknown>;
      expect(parsed.engines).toEqual({ node: CANONICAL });
      // Every other key survives, value for value: a codemod that reorders or drops a key is a
      // rewrite, not a fill.
      expect(parsed.name).toBe("@apps/api");
      expect(parsed.type).toBe("module");
      expect(parsed.scripts).toEqual({ test: "true" });
      expect(parsed.dependencies).toEqual({ zod: "catalog:" });
      // Two-space indentation and the trailing newline are what prettier checks in CI.
      expect(written.endsWith("}\n")).toBe(true);
      expect(written).toContain('\n  "engines": {\n    "node": ">=24.15.0 <25"\n  },\n');
      expect(written).not.toContain("\t");

      const recheck = runGate({
        manifests: { "package.json": ROOT_COMPLIANT },
        rawManifests: { "apps/api/package.json": written },
      });
      expect(recheck.status).toBe(0);
      expect(recheck.stderr).toBe("");
    });

    it("refuses and writes nothing when the root declares no value to copy", () => {
      const { engines: _engines, ...rootWithout } = ROOT_COMPLIANT;
      const result = runGate({
        write: true,
        manifests: { "package.json": rootWithout },
        rawManifests: { "apps/api/package.json": RAW_WITHOUT_ENGINES },
      });

      // The message is asserted, not just the exit: exit 1 with the file untouched is ALSO what
      // happens when the script is missing entirely, so without this the case would pass over a
      // gate that does not exist.
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the root package.json declares engines.node");
      expect(result.stderr).toContain("(absent)");
      expect(readFileSync(path.join(result.dir, "apps/api/package.json"), "utf8")).toBe(
        RAW_WITHOUT_ENGINES
      );
    });

    it("never overwrites a value that disagrees — the disagreement is the finding", () => {
      const raw = RAW_WITHOUT_ENGINES.replace(
        '  "type": "module",',
        '  "type": "module",\n  "engines": {\n    "node": ">=26.0.0 <27"\n  },'
      );
      const result = runGate({
        write: true,
        manifests: { "package.json": ROOT_COMPLIANT },
        rawManifests: { "apps/api/package.json": raw },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(">=26.0.0 <27");
      expect(readFileSync(path.join(result.dir, "apps/api/package.json"), "utf8")).toBe(raw);
    });
  });

  describe("an unrecognised flag", () => {
    it("exits 2 rather than being ignored, because an ignored flag reads the live tree", () => {
      const result = runGate({
        extraFlags: ["--population", "/dev/null"],
        manifests: {
          "package.json": ROOT_COMPLIANT,
          "apps/api/package.json": compliant("@apps/api"),
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage");
    });
  });
});
