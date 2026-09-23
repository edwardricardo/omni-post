/**
 * @file typecheck-tests-ratchet.mjs
 * @description Third typecheck pass, as a RATCHET. Compiles `apps/api/tests`
 *   under `tsconfig.tests.json` — a scope no tsconfig opened, and which both
 *   test runners strip rather than check — and holds the result against the
 *   committed ledger (`tests-typecheck-baseline.json`). Any NEW (file, TS code)
 *   pair, or any pair whose count RISES, fails. Falls are welcome and reported.
 *   The pre-existing errors are tracked debt, not silence: the gate still stops
 *   regressions while the ledger is burned down. Same shape as the dead-code
 *   ratchet in `scripts/knip-ratchet.mjs`.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "tsconfig.tests.json";
const BASELINE = join(PKG_DIR, "tests-typecheck-baseline.json");

// The scope floor. The program opened 749 files under `tests/` when this landed.
// A config whose glob stops matching — renamed directory, changed extension,
// `exclude` widened — produces a SMALLER program and, with it, fewer errors: the
// ratchet would read that as progress and stay green over code it never opened.
// That failure has happened three times in this repo's gate history (fitness
// #2/#3/#4 all grepped relocated directories and reported a clean zero). So the
// count of test files the compiler actually PARSED is asserted, not assumed.
const TEST_FILE_FLOOR = 700;

// `tsc` over this program peaks above node's default old-space (measured: the
// default 2240 MB heap aborts with exit 134 partway through). An abort is not
// "no errors found", and the exit-code guard below is what stops it reading as
// one — but a gate that reliably aborts is a broken gate, so the heap is raised
// here unless the caller already chose a value.
const CHILD_HEAP_MB = 6144;

const DIAGNOSTIC = /^(.+?):(\d+):(\d+) - error (TS\d+): /;
const SUMMARY = /^Found (\d+) errors? in (\d+) files?\.$/m;
// ESC is assembled from its code point rather than written into a regex literal:
// a literal control byte there trips `no-control-regex`, and silencing a lint
// rule so a gate can read its own input would be the wrong trade.
const ANSI = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

function die(message) {
  console.error(`✖ typecheck-tests ratchet: ${message}`);
  if (process.env.GITHUB_ACTIONS) console.error(`::error::typecheck-tests ratchet: ${message}`);
  process.exit(1);
}

/** Locate the TypeScript CLI by walking up from this package, never via PATH. */
function resolveTsc() {
  let dir = PKG_DIR;
  for (;;) {
    const candidate = join(dir, "node_modules", "typescript", "bin", "tsc");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Run the compiler once and return its raw output plus exit status. `--listFiles`
 * rides along so the scope assertion and the diagnostics come from the SAME
 * program — a second invocation could open a different one.
 */
function runTsc(tsc) {
  const ambient = process.env.NODE_OPTIONS ?? "";
  const nodeOptions = ambient.includes("--max-old-space-size")
    ? ambient
    : `${ambient} --max-old-space-size=${CHILD_HEAP_MB}`.trim();

  const proc = spawnSync(
    process.execPath,
    [tsc, "--noEmit", "--listFiles", "--pretty", "-p", PROJECT],
    {
      cwd: PKG_DIR,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    }
  );

  if (proc.error) die(`could not run tsc: ${proc.error.message}`);
  return { output: `${proc.stdout ?? ""}${proc.stderr ?? ""}`.replace(ANSI, ""), proc };
}

/**
 * Parse one compiler run into a measurement, failing closed on every shape that
 * would otherwise be indistinguishable from "clean".
 */
function measure(tsc) {
  const { output, proc } = runTsc(tsc);

  // tsc exits 0 with no diagnostics and 2 with them. ANY other status means it
  // did not finish deciding: 1 is a bad option or an unreadable config, 134 is a
  // JS heap abort, 137 is the OOM killer, and a null status with a signal is a
  // kill. None of those are zero errors, and all of them print nothing that a
  // count-based check would notice.
  if (proc.status !== 0 && proc.status !== 2) {
    die(
      `tsc did not complete (exit ${proc.status}, signal ${proc.signal ?? "none"}). ` +
        `This is NOT a clean result — the compiler never finished deciding, so the ` +
        `ratchet refuses to compare. Exit 134/137 means it ran out of heap: raise ` +
        `CHILD_HEAP_MB or give the runner more memory.\n--- last output ---\n${output
          .split("\n")
          .slice(-15)
          .join("\n")}`
    );
  }

  const diagnostics = [];
  let testFilesInProgram = 0;
  for (const line of output.split("\n")) {
    const hit = DIAGNOSTIC.exec(line);
    if (hit) {
      diagnostics.push({ file: hit[1].replaceAll("\\", "/"), code: hit[4] });
      continue;
    }
    if (line.replaceAll("\\", "/").includes("/apps/api/tests/")) testFilesInProgram += 1;
  }

  // Scope assertion: the compiler must have PARSED the test tree.
  if (testFilesInProgram < TEST_FILE_FLOOR) {
    die(
      `the program opened ${testFilesInProgram} files under apps/api/tests, below the ` +
        `floor of ${TEST_FILE_FLOOR}. The include glob in ${PROJECT} no longer matches the ` +
        `scope this gate exists to measure, so a low error count would mean nothing. ` +
        `Fix the glob, or lower TEST_FILE_FLOOR in the same change that deliberately ` +
        `shrinks the scope and says why.`
    );
  }

  // Cross-check the parse against tsc's OWN count. If a diagnostic shape ever
  // stops matching DIAGNOSTIC, or a source-context line starts matching it, the
  // two numbers diverge and the gate stops rather than reporting a parse artefact.
  const summary = SUMMARY.exec(output);
  if (proc.status === 2) {
    if (!summary) {
      die(
        `tsc exited 2 but printed no "Found N errors" summary. The output shape ` +
          `changed; the parse can no longer be cross-checked, so it is not trusted.`
      );
    }
    if (Number(summary[1]) !== diagnostics.length) {
      die(
        `parsed ${diagnostics.length} diagnostics but tsc reported ${summary[1]}. ` +
          `The two disagree, so neither is used.`
      );
    }
  } else if (diagnostics.length > 0) {
    die(`tsc exited 0 while ${diagnostics.length} diagnostics were parsed — contradictory.`);
  }

  const byKey = {};
  const byCode = {};
  for (const { file, code } of diagnostics) {
    const key = `${file}::${code}`;
    byKey[key] = (byKey[key] ?? 0) + 1;
    byCode[code] = (byCode[code] ?? 0) + 1;
  }

  return {
    totalErrors: diagnostics.length,
    filesWithErrors: summary ? Number(summary[2]) : 0,
    testFilesInProgram,
    byCode,
    byKey,
  };
}

function sortedObject(obj, compare) {
  return Object.fromEntries(Object.entries(obj).sort(compare));
}

function printInventory(byCode) {
  const rows = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return;
  console.log("\n  Error inventory by TS code (largest first):");
  for (const [code, count] of rows) console.log(`    ${code.padEnd(9)} ${count}`);
}

const tsc = resolveTsc();
if (!tsc) die("could not find node_modules/typescript/bin/tsc from apps/api upward.");

const current = measure(tsc);

if (process.argv.includes("--write")) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        _README:
          "Tracked type-error debt for apps/api/tests, the scope no tsconfig used to " +
          "open. The gate (apps/api/scripts/typecheck-tests-ratchet.mjs) FAILS on any " +
          "NEW file+code pair and on any pair whose count RISES, so new type errors in " +
          "test code are prevented while this ledger is burned down. Never grow an entry " +
          "to absorb a new error. Regenerate after genuine fixes: " +
          "node apps/api/scripts/typecheck-tests-ratchet.mjs --write",
        _RESIDUAL:
          "Keys are file+code, not file+line+message, so an unrelated edit does not churn " +
          "the ledger. The cost of that choice: fixing one TS2339 in a file and " +
          "introducing a different TS2339 in the SAME file leaves the count unchanged and " +
          "passes. Narrow, and stated rather than discovered.",
        totalErrors: current.totalErrors,
        filesWithErrors: current.filesWithErrors,
        testFilesInProgram: current.testFilesInProgram,
        byCode: sortedObject(current.byCode, (a, b) => b[1] - a[1]),
        byKey: sortedObject(current.byKey, (a, b) => a[0].localeCompare(b[0])),
      },
      null,
      2
    )}\n`
  );
  console.log(
    `Wrote ${BASELINE} — ${current.totalErrors} errors across ` +
      `${current.filesWithErrors} files (${Object.keys(current.byKey).length} file+code keys).`
  );
  printInventory(current.byCode);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  die(
    `${BASELINE} is missing. Generate it with: node apps/api/scripts/typecheck-tests-ratchet.mjs --write`
  );
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
} catch (error) {
  die(`${BASELINE} is not readable JSON: ${error.message}`);
}
if (!baseline || typeof baseline.byKey !== "object" || baseline.byKey === null) {
  die(`${BASELINE} has no byKey ledger — it cannot be compared against, so nothing is assumed.`);
}

const regressions = [];
for (const [key, count] of Object.entries(current.byKey)) {
  const was = baseline.byKey[key] ?? 0;
  if (count > was) regressions.push({ key, was, now: count });
}
const resolved = Object.entries(baseline.byKey).filter(
  ([key, count]) => (current.byKey[key] ?? 0) < count
);

console.log(
  `typecheck-tests ratchet: ${current.totalErrors} error(s) across ${current.filesWithErrors} ` +
    `file(s); ${current.testFilesInProgram} test files in the program ` +
    `(baseline ${baseline.totalErrors}).`
);

if (resolved.length > 0) {
  console.log(
    `✓ ${resolved.length} ledger entr(ies) shrank or cleared — lower the ledger: ` +
      `node apps/api/scripts/typecheck-tests-ratchet.mjs --write`
  );
}

if (regressions.length > 0) {
  console.error(`\n✖ ${regressions.length} NEW or GROWN type error(s) in apps/api/tests:\n`);
  for (const { key, was, now } of regressions.sort((a, b) => a.key.localeCompare(b.key))) {
    const [file, code] = key.split("::");
    console.error(`  ${file}  ${code}  ${was} -> ${now}`);
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::error file=apps/api/${file}::${code} count rose from ${was} to ${now}`);
    }
  }
  console.error(
    `\nFix the type error. Do NOT regenerate the ledger to absorb it, and do not ` +
      `silence it with \`any\`, \`@ts-expect-error\`, or a looser flag — the ledger ` +
      `measures reality or it measures nothing.`
  );
  printInventory(current.byCode);
  process.exit(1);
}

printInventory(current.byCode);
process.exit(0);
