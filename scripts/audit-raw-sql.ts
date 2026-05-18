/**
 * @file audit-raw-sql.ts
 * @description Extract every `$queryRaw` / `$executeRaw` usage across the
 *              monorepo, parse the SQL for referenced tables / views /
 *              functions, and cross-check against migrations + schema.prisma.
 *              Flags references to objects that do NOT exist in the DB schema.
 * @layer infrastructure
 */

import { readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "docs/audits/_raw");
const OUT_FILE = join(OUT_DIR, "raw-sql.json");

interface SqlReference {
  file: string;
  line: number;
  method: "queryRaw" | "queryRawUnsafe" | "executeRaw" | "executeRawUnsafe";
  identifiers: string[];
  snippet: string;
}

interface AuditReport {
  scannedFiles: number;
  rawSqlSites: number;
  knownObjects: {
    tables: string[];
    views: string[];
    materializedViews: string[];
    functions: string[];
    extensions: string[];
  };
  prismaModels: string[];
  references: SqlReference[];
  missingObjects: { identifier: string; sites: { file: string; line: number }[] }[];
}

const SOURCE_GLOBS = ["apps/api/src", "apps/workers/src", "apps/admin", "apps/client", "packages"];

const IGNORE_PATTERNS = [
  "node_modules",
  "dist",
  ".next",
  ".stryker-tmp",
  "graphify-out",
  "tests/e2e",
];

const TEST_FILE_RE = /\.(test|spec)\.[tj]sx?$/;

function walk(dir: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (IGNORE_PATTERNS.some((p) => entry === p)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !TEST_FILE_RE.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

// Detector: locate every $queryRaw/$executeRaw marker and extract SQL from
// the FIRST template literal (`...`) that follows. This handles both:
//   prisma.$queryRaw<T>`SELECT ...`          (direct template)
//   prisma.$queryRaw<T>(Prisma.sql`SELECT ...`)  (paren-style)
// Only content inside backticks is considered SQL — comments and type
// annotations between the marker and the template are skipped, avoiding
// false-positive identifier extraction from surrounding prose.
const MARKER_RE = /\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;
const WINDOW_CHARS = 2400;

function findTemplateLiteral(content: string, fromIdx: number, maxLen: number): string | null {
  const endIdx = Math.min(content.length, fromIdx + maxLen);
  let i = fromIdx;
  // Find the first unescaped opening backtick within the window. Skip over
  // string literals (the trivial cases: 'x', "x") and line/block comments
  // so that a `//` containing a backtick doesn't get mistaken for SQL.
  while (i < endIdx) {
    const ch = content[i];
    if (ch === "`") break;
    if (ch === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      i = nl === -1 ? endIdx : nl + 1;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const close = content.indexOf("*/", i + 2);
      i = close === -1 ? endIdx : close + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const close = content.indexOf(ch, i + 1);
      i = close === -1 ? endIdx : close + 1;
      continue;
    }
    i++;
  }
  if (i >= endIdx) return null;
  const start = i + 1;
  i = start;
  while (i < content.length) {
    if (content[i] === "`" && content[i - 1] !== "\\") return content.slice(start, i);
    if (content[i] === "$" && content[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < content.length && depth > 0) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return null;
}

function extractRawSqlSites(file: string): SqlReference[] {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const sites: SqlReference[] = [];
  let match: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((match = MARKER_RE.exec(content)) !== null) {
    const method = match[1] as SqlReference["method"];
    const start = match.index + match[0].length;
    // Skip non-call hits: type-alias declarations like `$queryRaw: (q...) => ...`
    const trailing = content.slice(start, start + 10);
    if (/^\s*[:?=]/.test(trailing)) continue;
    const sql = findTemplateLiteral(content, start, WINDOW_CHARS);
    if (sql === null) continue;
    const snippet = sql.replace(/\s+/g, " ").trim();
    const line = content.slice(0, match.index).split("\n").length;
    const identifiers = extractIdentifiers(sql);
    sites.push({
      file: relative(REPO_ROOT, file),
      line,
      method,
      identifiers,
      snippet: snippet.slice(0, 240),
    });
  }
  return sites;
}

const FROM_RE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|VIEW)\s+(?:ONLY\s+)?"?([\w.]+)"?/gi;
const CALL_RE = /\bCALL\s+([\w.]+)\s*\(/gi;
const FN_RE = /\bSELECT\s+\*\s+FROM\s+([\w.]+)\s*\(/gi;

const SQL_KEYWORDS = new Set([
  "SELECT",
  "WHERE",
  "ORDER",
  "GROUP",
  "LIMIT",
  "OFFSET",
  "AS",
  "ON",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "TRUE",
  "FALSE",
  "BY",
  "DESC",
  "ASC",
  "WITH",
  "RECURSIVE",
  "UNION",
  "ALL",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ONLY",
  "SKIP",
  "LOCKED",
  "NOWAIT",
  "EXCLUSIVE",
  "SHARE",
  "OF",
  "IF",
  "EXISTS",
  "SET",
  "VALUES",
  "DEFAULT",
  "RETURNING",
]);

function extractIdentifiers(sql: string): string[] {
  const idents = new Set<string>();
  for (const re of [FROM_RE, CALL_RE, FN_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const ident = m[1];
      if (!ident) continue;
      const bare = ident.split(".").pop()!;
      if (SQL_KEYWORDS.has(bare.toUpperCase())) continue;
      idents.add(ident);
    }
  }
  return Array.from(idents);
}

function loadMigrationObjects(): AuditReport["knownObjects"] {
  const migrationsDir = join(REPO_ROOT, "infra/prisma/migrations");
  const objects = {
    tables: new Set<string>(),
    views: new Set<string>(),
    materializedViews: new Set<string>(),
    functions: new Set<string>(),
    extensions: new Set<string>(),
  };
  function visit(d: string) {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const f = join(d, e);
      const st = statSync(f);
      if (st.isDirectory()) visit(f);
      else if (e.endsWith(".sql")) {
        const sql = readFileSync(f, "utf8");
        for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/gi)) {
          objects.tables.add(m[1].split(".").pop()!);
        }
        for (const m of sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/gi
        )) {
          objects.views.add(m[1].split(".").pop()!);
        }
        for (const m of sql.matchAll(
          /CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/gi
        )) {
          objects.materializedViews.add(m[1].split(".").pop()!);
        }
        for (const m of sql.matchAll(
          /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?([\w.]+)"?\s*\(/gi
        )) {
          objects.functions.add(m[1].split(".").pop()!);
        }
        for (const m of sql.matchAll(
          /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/gi
        )) {
          objects.extensions.add(m[1].split(".").pop()!);
        }
      }
    }
  }
  visit(migrationsDir);
  return {
    tables: Array.from(objects.tables).sort(),
    views: Array.from(objects.views).sort(),
    materializedViews: Array.from(objects.materializedViews).sort(),
    functions: Array.from(objects.functions).sort(),
    extensions: Array.from(objects.extensions).sort(),
  };
}

function loadPrismaModels(): string[] {
  try {
    const schema = readFileSync(join(REPO_ROOT, "infra/prisma/schema.prisma"), "utf8");
    const models: string[] = [];
    for (const m of schema.matchAll(/^model\s+(\w+)\s+\{/gm)) {
      models.push(m[1]);
    }
    return models.sort();
  } catch {
    return [];
  }
}

// Postgres system tables / views that are always present
const PG_SYSTEM = new Set([
  "pg_stat_statements",
  "pg_stat_user_indexes",
  "pg_stat_user_tables",
  "pg_indexes",
  "pg_tables",
  "pg_class",
  "pg_namespace",
  "pg_settings",
  "pg_stat_activity",
  "pg_database",
  "pg_locks",
  "pg_stat_database",
  "information_schema",
  "current_setting",
]);

function main() {
  const sites: SqlReference[] = [];
  let scanned = 0;
  for (const root of SOURCE_GLOBS) {
    const abs = join(REPO_ROOT, root);
    for (const file of walk(abs)) {
      scanned++;
      sites.push(...extractRawSqlSites(file));
    }
  }
  const knownObjects = loadMigrationObjects();
  const prismaModels = loadPrismaModels();

  const allKnown = new Set<string>([
    ...knownObjects.tables,
    ...knownObjects.views,
    ...knownObjects.materializedViews,
    ...knownObjects.functions,
    ...prismaModels,
    ...PG_SYSTEM,
  ]);

  const missingMap = new Map<string, { file: string; line: number }[]>();
  for (const site of sites) {
    for (const ident of site.identifiers) {
      const bare = ident.split(".").pop()!;
      if (allKnown.has(bare)) continue;
      // Also accept lowercase-ed Prisma model
      if (prismaModels.some((m) => m.toLowerCase() === bare.toLowerCase())) continue;
      // Also accept pg_* system prefix
      if (bare.startsWith("pg_") || bare === "information_schema") continue;
      const arr = missingMap.get(bare) ?? [];
      arr.push({ file: site.file, line: site.line });
      missingMap.set(bare, arr);
    }
  }

  const report: AuditReport = {
    scannedFiles: scanned,
    rawSqlSites: sites.length,
    knownObjects,
    prismaModels,
    references: sites,
    missingObjects: Array.from(missingMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([identifier, occurrences]) => ({
        identifier,
        sites: occurrences,
      })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const fs = require("node:fs");
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  // Human summary
  console.log(`Scanned files: ${scanned}`);
  console.log(`Raw SQL sites: ${sites.length}`);
  console.log(`Known tables:  ${knownObjects.tables.length}`);
  console.log(`Known views:   ${knownObjects.views.length}`);
  console.log(`Known MVs:     ${knownObjects.materializedViews.length}`);
  console.log(`Known fns:     ${knownObjects.functions.length}`);
  console.log(`Prisma models: ${prismaModels.length}`);
  console.log("");
  console.log(`Missing identifiers (${report.missingObjects.length}):`);
  for (const { identifier, sites } of report.missingObjects) {
    console.log(`  ${identifier} — ${sites.length} site(s)`);
    for (const s of sites.slice(0, 3)) console.log(`    ${s.file}:${s.line}`);
    if (sites.length > 3) console.log(`    ... and ${sites.length - 3} more`);
  }
  console.log("");
  console.log(`Full JSON: ${relative(REPO_ROOT, OUT_FILE)}`);
}

main();
