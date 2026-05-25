/**
 * Architecture Enforcement Tests
 *
 * Verifies that hexagonal architecture layer boundaries are not violated.
 *
 * Rules enforced:
 *   - domain/ files must NEVER import infrastructure concerns
 *     (Prisma, Redis, BullMQ, Fastify, prom-client, node:http, node:net)
 *   - application/ files must NEVER import infrastructure concerns
 *     (same list minus prom-client, which is allowed via application-layer metrics)
 *   - Neither layer may import from src/infrastructure/ directly
 *
 * These tests are Tier 0: pure filesystem reads, zero external dependencies.
 *
 * @module tests/unit/architecture
 *
 * @file architecture.test.ts
 * @description Tests for Architecture Enforcement
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .ts files under `dir`.
 */
function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Extract import/export lines from a TypeScript source file.
 * Handles multi-line imports by joining continuation lines that end with comma or open brace.
 * Returns lines that contain module specifiers (the `from "..."` part).
 */
function getImportLines(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const importLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // Collect lines that are import/export statements or continuation of them
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export {") ||
      trimmed.startsWith("export * from") ||
      trimmed.startsWith("import(")
    ) {
      // Gather potentially multi-line import
      let combined = trimmed;
      let j = i;
      // Keep joining lines until we see the closing quote (from "..." or require("..."))
      while (
        !combined.includes('from "') &&
        !combined.includes("from '") &&
        !combined.includes('require("') &&
        !combined.includes("require('") &&
        j < lines.length - 1
      ) {
        j++;
        combined += " " + (lines[j]?.trim() ?? "");
      }
      importLines.push(combined);
    }
  }

  return importLines;
}

/**
 * Check whether any import line in `lines` matches any of the forbidden patterns.
 * Returns the first violating line, or null if none.
 */
function findFirstViolation(lines: string[], forbiddenPatterns: RegExp[]): string | null {
  for (const line of lines) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        return line.trim();
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Known exceptions — files that temporarily violate architecture constraints
// due to in-progress migrations. Each entry must have a tracking comment.
// ---------------------------------------------------------------------------

const APPLICATION_EXCEPTIONS: Set<string> = new Set([
  // No current exceptions — every application file satisfies the layering rules.
]);

// ---------------------------------------------------------------------------
// Forbidden import patterns
// ---------------------------------------------------------------------------

/**
 * Patterns forbidden in domain/ files.
 *
 * The domain is the innermost hexagon ring — it must have zero
 * knowledge of how data is stored, transported, or observed.
 */
const DOMAIN_FORBIDDEN: RegExp[] = [
  // Persistence / ORM
  /@prisma\/client/,
  /@infra\/prisma/,
  // Caching / messaging infrastructure
  /["']ioredis["']/,
  /["']redis["']/,
  // Job queue
  /["']bullmq["']/,
  // HTTP framework
  /["']fastify["']/,
  /["']@fastify\//,
  // Observability infrastructure
  /["']prom-client["']/,
  // Low-level Node.js networking (domain should be I/O-agnostic)
  /["']node:http["']/,
  /["']node:https["']/,
  /["']node:net["']/,
  // Direct infrastructure layer imports (relative paths)
  /from ['"](?:\.\.\/)+infrastructure\//,
  /from ['"](?:\.\.\/)*src\/infrastructure\//,
];

/**
 * Patterns forbidden in application/ files.
 *
 * Application use cases orchestrate domain objects and call port interfaces.
 * They must not reference concrete infrastructure adapters.
 * Note: prom-client is intentionally NOT forbidden here — application use
 * cases may call thin increment helpers (src/metrics/businessMetrics.ts)
 * for SLO instrumentation.
 */
const APPLICATION_FORBIDDEN: RegExp[] = [
  // Persistence / ORM
  /@prisma\/client/,
  /@infra\/prisma/,
  // Caching / messaging infrastructure
  /["']ioredis["']/,
  /["']redis["']/,
  // Job queue
  /["']bullmq["']/,
  // HTTP framework
  /["']fastify["']/,
  /["']@fastify\//,
  // Low-level Node.js networking
  /["']node:http["']/,
  /["']node:https["']/,
  /["']node:net["']/,
  // Direct infrastructure layer imports (relative paths)
  /from ['"](?:\.\.\/)+infrastructure\//,
  /from ['"](?:\.\.\/)*src\/infrastructure\//,
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Architecture Enforcement", () => {
  // Resolve relative to the test file location: tests/unit/ → ../../src
  const srcRoot = join(__dirname, "..", "..", "src");
  const domainDir = join(srcRoot, "domain");
  const applicationDir = join(srcRoot, "application");

  // -------------------------------------------------------------------------
  describe("Domain layer — no infrastructure imports", () => {
    const domainFiles = getAllTsFiles(domainDir);

    it(`should find domain source files to check (found ${domainFiles.length} files)`, () => {
      expect(domainFiles.length > 0).toBeTruthy();
    });

    it("should have no @prisma/client or @infra/prisma imports", () => {
      const prismaPattern = [/@prisma\/client/, /@infra\/prisma/];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, prismaPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no ioredis or redis imports", () => {
      const redisPattern = [/["']ioredis["']/, /["']redis["']/];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, redisPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no bullmq imports", () => {
      const bullmqPattern = [/["']bullmq["']/];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, bullmqPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no fastify imports", () => {
      const fastifyPattern = [/["']fastify["']/, /["']@fastify\//];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, fastifyPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no prom-client imports", () => {
      const promPattern = [/["']prom-client["']/];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, promPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no node:http or node:net imports", () => {
      const networkPattern = [/["']node:http["']/, /["']node:https["']/, /["']node:net["']/];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, networkPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no direct imports from src/infrastructure/", () => {
      const infraPattern = [
        /from ['"](?:\.\.\/)+infrastructure\//,
        /from ['"](?:\.\.\/)*src\/infrastructure\//,
      ];
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, infraPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should pass ALL forbidden pattern checks in a single sweep", () => {
      const violations: string[] = [];

      for (const file of domainFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, DOMAIN_FORBIDDEN);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Application layer — no infrastructure imports", () => {
    const applicationFiles = getAllTsFiles(applicationDir);

    it(`should find application source files to check (found ${applicationFiles.length} files)`, () => {
      expect(applicationFiles.length > 0).toBeTruthy();
    });

    it("should have no @prisma/client or @infra/prisma imports", () => {
      const prismaPattern = [/@prisma\/client/, /@infra\/prisma/];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = file.replace(srcRoot + "/", "");
        if (APPLICATION_EXCEPTIONS.has(rel)) continue;
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, prismaPattern);
        if (hit) {
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no ioredis or redis imports", () => {
      const redisPattern = [/["']ioredis["']/, /["']redis["']/];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, redisPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no bullmq imports", () => {
      const bullmqPattern = [/["']bullmq["']/];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, bullmqPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no fastify imports", () => {
      const fastifyPattern = [/["']fastify["']/, /["']@fastify\//];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, fastifyPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no node:http or node:net imports", () => {
      const networkPattern = [/["']node:http["']/, /["']node:https["']/, /["']node:net["']/];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, networkPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should have no direct imports from src/infrastructure/", () => {
      const infraPattern = [
        /from ['"](?:\.\.\/)+infrastructure\//,
        /from ['"](?:\.\.\/)*src\/infrastructure\//,
      ];
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, infraPattern);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should pass ALL forbidden pattern checks in a single sweep", () => {
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = file.replace(srcRoot + "/", "");
        if (APPLICATION_EXCEPTIONS.has(rel)) continue;
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, APPLICATION_FORBIDDEN);
        if (hit) {
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Port interfaces — no concrete implementation references", () => {
    const repositoriesDir = join(domainDir, "repositories");
    const repositoryFiles = getAllTsFiles(repositoriesDir);

    it(`should find repository port files to check (found ${repositoryFiles.length} files)`, () => {
      expect(repositoryFiles.length > 0).toBeTruthy();
    });

    it("should have no imports from infrastructure in port interfaces", () => {
      const violations: string[] = [];

      for (const file of repositoryFiles) {
        const lines = getImportLines(file);
        const hit = findFirstViolation(lines, DOMAIN_FORBIDDEN);
        if (hit) {
          const rel = file.replace(srcRoot + "/", "");
          violations.push(`${rel}: ${hit}`);
        }
      }

      expect(violations).toEqual([]);
    });

    it("should not reference Prisma types in repository interfaces", () => {
      const prismaTypePattern = [/Prisma\.[A-Z]/, /PrismaClient/, /@prisma/, /@infra\/prisma/];
      const violations: string[] = [];

      for (const file of repositoryFiles) {
        const content = readFileSync(file, "utf8");
        for (const pattern of prismaTypePattern) {
          if (pattern.test(content)) {
            const rel = file.replace(srcRoot + "/", "");
            // Only flag if it's NOT in a comment
            const nonCommentLines = content
              .split("\n")
              .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
              .join("\n");
            if (pattern.test(nonCommentLines)) {
              violations.push(`${rel}: matches pattern ${pattern}`);
              break;
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
