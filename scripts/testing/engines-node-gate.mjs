// @ts-check
/**
 * @file engines-node-gate.mjs
 * @description Refuses a workspace manifest that does not declare `engines.node` at the runtime
 *   major, and a `@types/node` catalog pin on a different major from that runtime.
 *
 *   WHY IT EXISTS, measured: `@types/node` was pinned at 25.9.3 while every runtime in this
 *   repository — `.nvmrc`, the CI setup-node resolution, both Dockerfiles — is on the Node 24 LTS
 *   line, and nothing noticed, because no manifest declared a runtime for the pin to disagree with.
 *   Types ahead of the runtime describe APIs the runtime does not have, so the compiler accepts calls
 *   that fail in production. The declaration is what turns that drift from folklore into a gate.
 *
 *   ONE SOURCE OF TRUTH: the ROOT `package.json`'s `engines.node` value. Every other manifest must
 *   declare that exact string. The root's value must match the required SHAPE `>=<M>.<minor>.<patch>
 *   <<M+1>` with `<M>` the runtime major — an ALLOWLIST by shape, in the form fitness #28 and #40
 *   use, because the admissible shape is one sentence while the inadmissible set is open-ended:
 *   `^24`, `>=24`, `24.x` and a bare `24` name no floor, no ceiling, or neither, and each would let
 *   the next major in silently. Checking the shape rather than enumerating the wrong ones needs no
 *   semver library and cannot be outgrown by a form nobody predicted.
 *
 *   A manifest whose major is AHEAD of the runtime is refused exactly as loudly as one behind it. The
 *   move to a newer Node line therefore has to raise the declaration deliberately, in its own change,
 *   which is the only reason this gate is worth having.
 *
 *   FAIL-CLOSED in every direction a silent pass could hide the drift: an unreadable or non-integer
 *   `.nvmrc`, a process whose own major differs from it (a gate run on the wrong runtime proves
 *   nothing about the declared one), a population below the floor (a moved layout must not read as a
 *   clean zero — fitness #42's rule), an unreadable manifest, a root with no value to be canonical,
 *   and a catalog with no `@types/node` pin to compare.
 *
 *   `--write` is the codemod that fills a MISSING declaration from the root value, and only that: it
 *   refuses when the root has no value, and it NEVER overwrites a value that disagrees, because an
 *   overwrite would erase the disagreement this gate exists to report. It inserts text rather than
 *   re-serialising the document, then re-parses its own output and refuses unless every other key
 *   survived value-for-value — a codemod that reorders or drops a key is a rewrite, not a fill.
 *
 *   Every input is injectable so the suite can drive the rule with fixtures and never read the
 *   repository's own manifests: `--root` (which carries `.nvmrc` and `pnpm-workspace.yaml` with it),
 *   `--manifest-list`, `--runtime` and `--floor`. With none of them the live tree is read from git and
 *   `process.versions.node`. An unrecognised flag exits 2 rather than being ignored, because an
 *   ignored flag would silently read the live tree in a suite that must not reach it.
 *
 *   Usage: `node scripts/testing/engines-node-gate.mjs [--write]`
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MANIFEST_FLOOR = 90;
const CATALOG_PACKAGE = "@types/node";
/**
 * Keys the declaration is inserted AFTER, first one found wins: the manifest's header block. Held to
 * what the population actually reaches — measured over all 98 manifests, `private` answers for 93 and
 * `type` for the other 5, and none needs a third. A longer list would read as generality while only
 * two entries were ever exercised; a manifest with neither is refused by name below rather than
 * guessed at.
 */
const ANCHOR_KEYS = ["private", "type"];
const EXCLUDED_PATH = /(^|\/)(node_modules|dist|\.next|\.turbo)\//;

/** @type {string | null} */
let repoRootCache = null;

/**
 * The repository root, resolved LAZILY. With `--root` and `--manifest-list` injected the gate needs
 * neither git nor a repository at all, which is what lets its own suite drive the rule from fixtures.
 *
 * @returns {string}
 */
function repoRoot() {
  if (repoRootCache === null) {
    repoRootCache = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  }
  return repoRootCache;
}

/**
 * @typedef {object} Options
 * @property {boolean} write
 * @property {string | null} root
 * @property {string | null} manifestList
 * @property {string | null} runtime
 * @property {string | null} floor
 */

/**
 * @param {string[]} argv
 * @returns {Options | null} `null` on a usage error, which exits 2.
 */
function parseOptions(argv) {
  /** @type {Options} */
  const options = {
    write: false,
    root: null,
    manifestList: null,
    runtime: null,
    floor: null,
  };
  const valued = new Set(["root", "manifest-list", "runtime", "floor"]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = (argv[i] ?? "").replace(/^--/, "");
    if (flag === "write") {
      options.write = true;
      continue;
    }
    if (!valued.has(flag)) return null;
    const value = argv[i + 1];
    if (value === undefined) return null;
    i += 1;
    if (flag === "manifest-list") options.manifestList = value;
    else options[/** @type {"root" | "runtime" | "floor"} */ (flag)] = value;
  }
  return options;
}

/**
 * The declared runtime major. `.nvmrc` must hold a bare integer: an alias (`lts/krypton`) resolves
 * through a version manager's own tables, so this gate could not tell which major CI would install.
 *
 * @param {string} file
 * @returns {{ major: number } | { error: string }}
 */
function readRuntimeMajor(file) {
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(file, "utf8").trim();
  } catch (error) {
    return {
      error:
        `${file} could not be read, so the runtime major is unknown and nothing was measured: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!/^\d+$/.test(raw)) {
    return {
      error:
        `${file} holds "${raw}", which is not a bare integer major. An alias resolves through a ` +
        `version manager's own tables, so this gate cannot tell which major CI would install.`,
    };
  }
  return { major: Number(raw) };
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function majorOf(value) {
  const hit = /^(\d+)\./.exec(value);
  return hit === null ? null : Number(hit[1]);
}

/**
 * The tracked manifests, relative to the root. `git ls-files` is the population because a manifest
 * that is not tracked is not part of the workspace CI installs; `dist`, `.next` and `.turbo` copies
 * are excluded so a build artefact never counts as a manifest to declare.
 *
 * @param {Options} options
 * @param {string} root
 * @returns {{ paths: string[] } | { error: string }}
 */
function readPopulation(options, root) {
  try {
    const raw =
      options.manifestList === null
        ? execFileSync("git", ["ls-files", "--", "*package.json", ":(exclude)**/node_modules/**"], {
            encoding: "utf8",
            cwd: root,
            maxBuffer: 32 * 1024 * 1024,
          })
        : readFileSync(options.manifestList, "utf8");
    const paths = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !EXCLUDED_PATH.test(line));
    return { paths };
  } catch (error) {
    return {
      error:
        `the manifest population could not be listed, so nothing was measured: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Reads a manifest from disk, or parses text the gate itself just produced when `produced` is given.
 * One function for both because the parse is identical; only the blame differs, and it has to: a
 * failure on the disk path names the file as an INPUT, while a failure on the codemod's own output
 * names the write that did not happen.
 *
 * @param {string} file Path to read, or the path to blame when `produced` is given.
 * @param {string | null} [produced] Text already in hand, from `--write`.
 * @returns {{ text: string, body: Record<string, unknown> } | { error: string }}
 */
function readManifest(file, produced = null) {
  /** @type {string} */
  let text;
  if (produced === null) {
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      return {
        error: `${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    text = produced;
  }
  try {
    return { text, body: /** @type {Record<string, unknown>} */ (JSON.parse(text)) };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      error:
        produced === null
          ? `${file} could not be read as JSON: ${why}`
          : `--write produced invalid JSON for ${file}, so nothing was written: ${why}`,
    };
  }
}

/**
 * @param {Record<string, unknown>} body
 * @returns {string | null} The declared value, or `null` when the manifest declares none.
 */
function declaredNode(body) {
  const engines = body.engines;
  if (typeof engines !== "object" || engines === null) return null;
  const node = /** @type {{ node?: unknown }} */ (engines).node;
  return typeof node === "string" ? node : null;
}

/**
 * The required shape, as a sentence a reader can act on.
 *
 * @param {number} major
 * @returns {string}
 */
function shapeRule(major) {
  return `>=${String(major)}.<minor>.<patch> <${String(major + 1)}`;
}

/**
 * @param {string} value
 * @param {number} major
 * @returns {boolean}
 */
function matchesShape(value, major) {
  const hit = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(value);
  if (hit === null) return false;
  return Number(hit[1]) === major && Number(hit[4]) === major + 1;
}

/**
 * The `@types/node` value of the `catalog:` block. Read as TEXT rather than parsed as YAML: the file
 * is a pnpm workspace manifest whose catalog entries are one flat `"name": version` line each, and
 * adding a YAML dependency to a gate that runs before install would make the gate need the tree it
 * is measuring.
 *
 * @param {string} file
 * @returns {{ pin: string } | { error: string }}
 */
function readCatalogPin(file) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return {
      error: `${file} could not be read, so the ${CATALOG_PACKAGE} pin is unknown: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  // Scoped to the TOP-LEVEL `catalog:` block, never to the whole file. The same package name can
  // appear in `overrides:` (a bound on what someone else's open range resolves to, which may
  // legitimately be another major) and in a named `catalogs:` block; a first-hit-anywhere scan would
  // compare the runtime against whichever of those happens to be written higher up.
  /** @type {string[]} */
  const block = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      if (inside) break;
      inside = line.startsWith("catalog:");
      continue;
    }
    if (inside) block.push(line);
  }
  const hit = new RegExp(`^\\s*"?${CATALOG_PACKAGE}"?:\\s*([^\\s#]+)`, "m").exec(block.join("\n"));
  if (hit === null || hit[1] === undefined) {
    return {
      error:
        `${file} declares no ${CATALOG_PACKAGE} pin in its top-level \`catalog:\` block, so the types ` +
        `major cannot be compared with the runtime. Refusing rather than skipping the comparison: the ` +
        `skip IS the drift this gate was written for.`,
    };
  }
  return { pin: hit[1] };
}

/**
 * Inserts an `engines` block into a manifest's TEXT, after the first header key it finds, preserving
 * every other byte. The result is re-parsed by the caller and rejected unless every other key
 * survived, so a manifest this cannot place the block in safely is reported rather than rewritten.
 *
 * @param {string} text
 * @param {string} value
 * @returns {string | null}
 */
function insertEngines(text, value) {
  const lines = text.split("\n");
  for (const key of ANCHOR_KEYS) {
    const at = lines.findIndex((line) => new RegExp(`^(\\s+)"${key}":`).test(line));
    if (at === -1) continue;
    const line = lines[at] ?? "";
    const indent = /^(\s+)/.exec(line)?.[1] ?? "  ";
    const anchored = line.trimEnd().endsWith(",") ? line : `${line.trimEnd()},`;
    const block = [
      `${indent}"engines": {`,
      `${indent}${indent}"node": ${JSON.stringify(value)}`,
      `${indent}},`,
    ];
    return [...lines.slice(0, at), anchored, ...block, ...lines.slice(at + 1)].join("\n");
  }
  return null;
}

/**
 * @param {Options} options
 * @returns {{ summary: string | null, violations: string[] }}
 */
function evaluate(options) {
  /** @type {string[]} */
  const violations = [];
  const root = options.root ?? repoRoot();
  const nvmrcPath = path.join(root, ".nvmrc");
  const catalogPath = path.join(root, "pnpm-workspace.yaml");
  const floor = options.floor === null ? MANIFEST_FLOOR : Number(options.floor);
  if (!Number.isInteger(floor) || floor < 1) {
    return {
      summary: null,
      violations: [`--floor ${String(options.floor)} is not a positive integer.`],
    };
  }

  const runtime = readRuntimeMajor(nvmrcPath);
  if ("error" in runtime) return { summary: null, violations: [runtime.error] };
  const major = runtime.major;

  const processVersion = options.runtime ?? process.versions.node;
  const processMajor = majorOf(processVersion);
  if (processMajor !== major) {
    return {
      summary: null,
      violations: [
        `this gate is running on Node ${processVersion} (major ${String(processMajor)}) while ` +
          `${nvmrcPath} declares major ${String(major)}. A gate run on a runtime the repository does ` +
          `not declare proves nothing about the declared one, so it refuses instead of comparing.`,
      ],
    };
  }

  const population = readPopulation(options, root);
  if ("error" in population) return { summary: null, violations: [population.error] };
  const paths = population.paths;
  if (paths.length < floor) {
    return {
      summary: null,
      violations: [
        `${String(paths.length)} manifests found against a floor of ${String(floor)} — the workspace ` +
          `layout moved, or the population could not be listed. A gate that reports a clean zero ` +
          `over manifests it never opened asserts an invariant nobody measured.`,
      ],
    };
  }

  const rootRelative = paths.find((file) => file === "package.json") ?? "package.json";
  const rootManifest = readManifest(path.join(root, rootRelative));
  if ("error" in rootManifest) return { summary: null, violations: [rootManifest.error] };
  const canonical = declaredNode(rootManifest.body);
  if (canonical === null || !matchesShape(canonical, major)) {
    return {
      summary: null,
      violations: [
        `the root package.json declares engines.node ${canonical === null ? "(absent)" : `"${canonical}"`}, ` +
          `which is not the required shape "${shapeRule(major)}". The root value is the ONE source of ` +
          `truth every other manifest is compared against, and a range with no patch floor or no ` +
          `single-major ceiling admits the next major silently.`,
      ],
    };
  }

  const catalog = readCatalogPin(catalogPath);
  if ("error" in catalog) {
    violations.push(catalog.error);
  } else {
    const pinMajor = majorOf(catalog.pin);
    if (pinMajor !== major) {
      violations.push(
        `the ${CATALOG_PACKAGE} catalog pin is ${catalog.pin} (major ${String(pinMajor)}) against a ` +
          `runtime major ${String(major)}. Types ahead of the runtime describe APIs it does not have, ` +
          `and types behind it hide APIs it does; the pin tracks the runtime major, downward when the ` +
          `newest published major is higher.`
      );
    }
  }

  /** @type {string[]} */
  const written = [];
  for (const relative of paths) {
    if (relative === rootRelative) continue;
    const absolute = path.join(root, relative);
    const manifest = readManifest(absolute);
    if ("error" in manifest) {
      violations.push(manifest.error);
      continue;
    }
    const declared = declaredNode(manifest.body);
    if (declared === null && options.write) {
      const next = insertEngines(manifest.text, canonical);
      if (next === null) {
        violations.push(
          `${relative} declares none of ${ANCHOR_KEYS.join(", ")} at its top level, so --write has ` +
            `no header key to place the declaration after. Add it by hand rather than letting a ` +
            `codemod guess a position.`
        );
        continue;
      }
      const reparsed = readManifest(relative, next);
      if ("error" in reparsed) {
        violations.push(reparsed.error);
        continue;
      }
      const { engines: _engines, ...rest } = reparsed.body;
      if (
        JSON.stringify(rest) !== JSON.stringify(manifest.body) ||
        declaredNode(reparsed.body) !== canonical
      ) {
        violations.push(
          `--write produced a ${relative} whose other keys no longer match the original, so nothing ` +
            `was written. A fill that reorders or drops a key is a rewrite.`
        );
        continue;
      }
      writeFileSync(absolute, next);
      written.push(relative);
      continue;
    }
    if (declared === null) {
      violations.push(
        `${relative} declares no engines.node. Every workspace manifest declares the root's value, ` +
          `"${canonical}", so a runtime/type drift is a gate rather than folklore.`
      );
      continue;
    }
    if (declared !== canonical) {
      const declaredMajor = majorOf(declared.replace(/^[^\d]*/, ""));
      const relation =
        declaredMajor === null
          ? "an unreadable major"
          : declaredMajor === major
            ? `major ${String(declaredMajor)}, the runtime's own, but a different range`
            : declaredMajor > major
              ? `major ${String(declaredMajor)}, AHEAD of the runtime`
              : `major ${String(declaredMajor)}, BEHIND the runtime`;
      violations.push(
        `${relative} declares engines.node "${declared}" — ${relation} (runtime major ` +
          `${String(major)}). The root's value "${canonical}" is the one source of truth; a variant ` +
          `is refused whether it is ahead or behind, because moving the runtime line is a deliberate ` +
          `change, not a per-manifest drift.`
      );
    }
  }

  const pin = "error" in catalog ? "unreadable" : catalog.pin;
  // Every filled path is NAMED, never just counted: `--write` is the one mode that mutates the tree,
  // and a count tells a reviewer how much changed without telling them what.
  const filled = written.map((relative) => `--write filled ${relative}`);
  return {
    summary: [
      ...filled,
      `${String(paths.length)} manifests, engines.node ${canonical}, runtime ${String(major)}, ` +
        `${CATALOG_PACKAGE} ${pin}`,
    ].join("\n"),
    violations,
  };
}

/**
 * @param {string[]} argv
 * @returns {number} Process exit code: 0 clean, 1 violation or unreadable input, 2 usage.
 */
function main(argv) {
  const options = parseOptions(argv);
  if (options === null) {
    process.stderr.write(
      "usage: node scripts/testing/engines-node-gate.mjs [--write] " +
        "[--root <dir>] [--manifest-list <path>] [--runtime <version>] [--floor <count>]\n"
    );
    return 2;
  }

  /** @type {{ summary: string | null, violations: string[] }} */
  let result;
  try {
    result = evaluate(options);
  } catch (error) {
    process.stderr.write(
      `engines-node-gate: an input could not be read, so nothing was measured: ` +
        `${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  for (const violation of result.violations) {
    process.stderr.write(`engines-node-gate: ${violation}\n`);
  }
  if (result.violations.length > 0) return 1;
  if (result.summary !== null) process.stdout.write(`${result.summary}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
