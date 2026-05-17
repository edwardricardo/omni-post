/**
 * @file audit-routes-vs-hooks.ts
 * @description Extract every Fastify route registered in apps/api and every
 *              HTTP call made from apps/admin + apps/client (hooks, lib/api,
 *              page fetchers). Cross-reference both directions to surface
 *              "UI without backend" (hook URL → no matching route) and
 *              "backend without UI" (route → no consumer).
 * @layer infrastructure
 */

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "docs/audits/_raw");
const OUT_FILE = join(OUT_DIR, "routes-vs-hooks.json");

interface RouteSite {
  file: string;
  line: number;
  method: string;
  path: string;
}

interface HookCallSite {
  file: string;
  line: number;
  surface: "admin" | "client";
  url: string;
  method?: string;
}

interface Report {
  backendRoutes: RouteSite[];
  frontendCalls: HookCallSite[];
  unmatchedFrontendCalls: { call: HookCallSite; canonicalUrl: string }[];
  unconsumedBackendRoutes: { route: RouteSite; canonicalUrl: string }[];
}

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

const FASTIFY_METHOD_RE =
  /(?:fastify|app|instance|this\.fastify|server)\.(get|post|put|patch|delete|options|head)\s*[<(]\s*[`'"]([^`'"]+)[`'"]/g;
const FASTIFY_ROUTE_RE =
  /\.route\s*\(\s*\{\s*method:\s*[`'"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)[`'"],?\s*url:\s*[`'"]([^`'"]+)[`'"]/g;

function extractBackendRoutes(files: string[]): RouteSite[] {
  const out: RouteSite[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const re of [FASTIFY_METHOD_RE, FASTIFY_ROUTE_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const method = m[1].toUpperCase();
        const path = m[2];
        if (!path.startsWith("/")) continue;
        const line = content.slice(0, m.index).split("\n").length;
        out.push({ file: relative(REPO_ROOT, file), line, method, path });
      }
    }
  }
  return out;
}

// Frontend call patterns. We capture each call's URL by locating the opener
// (`fetch(`, `apiClient.get(`, `http<T>(`, `axios.post(`, etc.), then reading
// the string literal that follows — including template strings with
// `${param}` substitutions, which the wider grep-style approach truncates.
const CALL_OPENERS = [
  { re: /\bfetch\s*\(\s*/g, method: undefined as string | undefined },
  { re: /\b(?:apiClient|api|client|http)\.(get|post|put|patch|delete)\s*[<(]/g, method: "$1" },
  { re: /\baxios\.(get|post|put|patch|delete)\s*[<(]/g, method: "$1" },
  { re: /\bhttp\s*[<(]/g, method: undefined },
];

function readStringLiteral(content: string, fromIdx: number): string | null {
  let i = fromIdx;
  while (i < content.length && /\s/.test(content[i])) i++;
  const opener = content[i];
  if (opener !== "`" && opener !== '"' && opener !== "'") return null;
  const start = i + 1;
  i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === opener && content[i - 1] !== "\\") {
      return content.slice(start, i);
    }
    if (opener === "`" && ch === "$" && content[i + 1] === "{") {
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

function extractFrontendCalls(files: string[], surface: "admin" | "client"): HookCallSite[] {
  const out: HookCallSite[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { re, method } of CALL_OPENERS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const url = readStringLiteral(content, m.index + m[0].length);
        if (url === null) continue;
        if (!/^\/?(api|http)/.test(url) && !url.startsWith("/")) continue;
        const line = content.slice(0, m.index).split("\n").length;
        const resolvedMethod = method && m[1] ? m[1].toUpperCase() : undefined;
        out.push({
          file: relative(REPO_ROOT, file),
          line,
          surface,
          url,
          ...(resolvedMethod !== undefined && { method: resolvedMethod }),
        });
      }
    }
  }
  return out;
}

// Normalise URLs to compare: strip protocol+host, strip leading /api/backend
// or /api proxy, replace :param and ${param} and [param] with :p, collapse
// trailing slashes.
function canonicalize(url: string): string {
  let u = url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/api\/backend/, "")
    .replace(/^\/api(?=\/)/, "")
    .replace(/\$\{[^}]+\}/g, ":p")
    .replace(/\[([^\]]+)\]/g, ":p")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":p")
    .replace(/\/+$/, "")
    .replace(/\?.*/, "");
  if (!u.startsWith("/")) u = "/" + u;
  return u || "/";
}

function main() {
  const apiFiles = walk(join(REPO_ROOT, "apps/api/src")).filter((f) =>
    /Routes\.ts|routes\.ts|\/routes\//i.test(f)
  );
  const adminFiles = [
    ...walk(join(REPO_ROOT, "apps/admin/hooks")),
    ...walk(join(REPO_ROOT, "apps/admin/lib")),
    ...walk(join(REPO_ROOT, "apps/admin/app")),
    ...walk(join(REPO_ROOT, "apps/admin/components")),
  ];
  const clientFiles = [
    ...walk(join(REPO_ROOT, "apps/client/hooks")),
    ...walk(join(REPO_ROOT, "apps/client/lib")),
    ...walk(join(REPO_ROOT, "apps/client/app")),
    ...walk(join(REPO_ROOT, "apps/client/components")),
  ];

  const backendRoutes = extractBackendRoutes(apiFiles);
  const frontendCalls = [
    ...extractFrontendCalls(adminFiles, "admin"),
    ...extractFrontendCalls(clientFiles, "client"),
  ];

  // Build canonical sets
  const routeCanonSet = new Set<string>();
  const routesByCanon = new Map<string, RouteSite[]>();
  for (const r of backendRoutes) {
    const c = canonicalize(r.path);
    routeCanonSet.add(c);
    const a = routesByCanon.get(c) ?? [];
    a.push(r);
    routesByCanon.set(c, a);
  }
  const callCanonSet = new Set<string>();
  const callsByCanon = new Map<string, HookCallSite[]>();
  for (const c of frontendCalls) {
    const k = canonicalize(c.url);
    callCanonSet.add(k);
    const a = callsByCanon.get(k) ?? [];
    a.push(c);
    callsByCanon.set(k, a);
  }

  const unmatchedFrontend: Report["unmatchedFrontendCalls"] = [];
  for (const c of frontendCalls) {
    const canon = canonicalize(c.url);
    // tolerance: also accept route registered with /admin or non-admin prefix
    const variants = [canon, "/admin" + canon, canon.replace(/^\/admin/, "")];
    if (!variants.some((v) => routeCanonSet.has(v))) {
      unmatchedFrontend.push({ call: c, canonicalUrl: canon });
    }
  }

  const unconsumedBackend: Report["unconsumedBackendRoutes"] = [];
  for (const r of backendRoutes) {
    const canon = canonicalize(r.path);
    const variants = [canon, canon.replace(/^\/admin/, ""), "/admin" + canon];
    if (!variants.some((v) => callCanonSet.has(v))) {
      unconsumedBackend.push({ route: r, canonicalUrl: canon });
    }
  }

  const report: Report = {
    backendRoutes,
    frontendCalls,
    unmatchedFrontendCalls: unmatchedFrontend,
    unconsumedBackendRoutes: unconsumedBackend,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Backend routes:      ${backendRoutes.length}`);
  console.log(`Frontend calls:      ${frontendCalls.length}`);
  console.log(`  admin:             ${frontendCalls.filter((c) => c.surface === "admin").length}`);
  console.log(`  client:            ${frontendCalls.filter((c) => c.surface === "client").length}`);
  console.log("");
  console.log(
    `Unmatched frontend calls (UI without matching backend): ${unmatchedFrontend.length}`
  );
  for (const u of unmatchedFrontend.slice(0, 15)) {
    console.log(`  [${u.call.surface}] ${u.call.method ?? "GET"} ${u.canonicalUrl}`);
    console.log(`    ${u.call.file}:${u.call.line}  (raw: ${u.call.url})`);
  }
  if (unmatchedFrontend.length > 15) console.log(`  ... and ${unmatchedFrontend.length - 15} more`);
  console.log("");
  console.log(`Unconsumed backend routes: ${unconsumedBackend.length}`);
  for (const u of unconsumedBackend.slice(0, 15)) {
    console.log(`  ${u.route.method} ${u.canonicalUrl}`);
    console.log(`    ${u.route.file}:${u.route.line}  (raw: ${u.route.path})`);
  }
  if (unconsumedBackend.length > 15) console.log(`  ... and ${unconsumedBackend.length - 15} more`);
  console.log("");
  console.log(`Full JSON: ${relative(REPO_ROOT, OUT_FILE)}`);
}

main();
