/**
 * @file knip-ratchet.mjs
 * @description Dead-code gate as a ratchet. Runs knip, compares findings
 *   against the committed baseline ledger (knip-baseline.json), and FAILS
 *   CI on any finding NOT already in the baseline (i.e. newly introduced
 *   dead code / unused dep / unlisted import). Pre-existing findings are an
 *   explicit, tracked, reviewable debt ledger — not silenced: the gate
 *   still prevents regressions, and resolved baseline entries are reported
 *   so the ledger is burned down over time. See docs/development/knip-baseline.md.
 * @layer infrastructure
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const CATEGORIES = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "types",
  "nsExports",
  "nsTypes",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
];

function runKnip() {
  let out = "";
  try {
    out = execSync("npx knip --reporter json", {
      cwd: process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (e) {
    // knip exits 1 when it finds issues — expected; its stdout still holds the JSON.
    out = e.stdout ? e.stdout.toString() : "";
  }
  const lines = out.split("\n").filter((l) => !l.trimStart().startsWith("[dotenv"));
  const joined = lines.join("\n");
  const start = joined.indexOf("{");
  if (start === -1) throw new Error("knip produced no JSON output");
  return JSON.parse(joined.slice(start));
}

// Stable key: category + file + symbol name. Deliberately excludes line/col
// so unrelated edits in the same file do not churn the baseline.
function keysFromReport(report) {
  const keys = new Set();
  for (const entry of report.issues || []) {
    const file = entry.file || "";
    for (const cat of CATEGORIES) {
      for (const el of entry[cat] || []) {
        const name = typeof el === "string" ? el : el.name || el.symbol || "";
        keys.add(`${cat}::${file}::${name}`);
      }
    }
  }
  return keys;
}

const report = runKnip();
const current = keysFromReport(report);

const BASELINE = "knip-baseline.json";

if (process.argv.includes("--write")) {
  const fs = await import("node:fs");
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        _README:
          "Tracked dead-code debt ledger. The CI gate (scripts/knip-ratchet.mjs) " +
          "FAILS on any knip finding NOT listed here, so new dead code is prevented. " +
          "These pre-existing entries must be burned down — never grow this list to " +
          "silence a new finding. Regenerate after genuine removals: " +
          "node scripts/knip-ratchet.mjs --write. See docs/development/knip-baseline.md.",
        count: [...current].length,
        keys: [...current].sort(),
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Wrote ${BASELINE} with ${current.size} baseline entries.`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`✖ ${BASELINE} missing. Generate it with: node scripts/knip-ratchet.mjs --write`);
  process.exit(1);
}
const baseline = new Set(JSON.parse(readFileSync(BASELINE, "utf8")).keys);

const regressions = [...current].filter((k) => !baseline.has(k)).sort();
const resolved = [...baseline].filter((k) => !current.has(k)).sort();

if (resolved.length) {
  console.log(
    `✓ ${resolved.length} baseline finding(s) resolved — shrink the ledger: node scripts/knip-ratchet.mjs --write`
  );
}

if (regressions.length) {
  console.error(`\n✖ ${regressions.length} NEW dead-code finding(s) (not in baseline):\n`);
  for (const r of regressions) console.error(`  ${r}`);
  console.error(
    `\nFix the dead code (preferred) or, if it is a proven false positive, ` +
      `correct knip.json config. Do NOT regenerate the baseline to absorb it.`
  );
  process.exit(1);
}

console.log(
  `✓ knip ratchet: 0 regressions (${baseline.size} tracked baseline findings pending burn-down).`
);
process.exit(0);
