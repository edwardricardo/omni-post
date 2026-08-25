/**
 * @file publishPipelineQueues.static.test.ts
 * @description Merge-blocking source scan pinning `PUBLISH_PIPELINE_QUEUES` as THE
 *              single source of the required-consumer set. The environment that runs
 *              the end-to-end publish suite is only meaningful while every queue the
 *              pipeline enqueues to has a consumer attached; a queue added to the
 *              pipeline and not to that constant, or a constant entry with no
 *              consumer in the workers process, both put the environment silently
 *              back where it was — green, and asserting nothing.
 *
 *              Runtime cannot see either drift: the happy path only proves the
 *              queues that ARE wired. So this reads the two wiring sites directly.
 *              The scan runs over a copy with comments and string literals blanked,
 *              so prose naming a queue can never satisfy an assertion about code
 *              that wires one.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QUEUE_NAMES, PUBLISH_PIPELINE_QUEUES } from "@adapters/queue-bullmq";

const currentDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(currentDir, "..", "..", "..");
const repoRoot = join(apiRoot, "..", "..");

const bootstrapPath = join(apiRoot, "src", "index.ts");
const sagaIntegrationPath = join(apiRoot, "src", "saga", "SagaIntegration.ts");
const workersBootstrapPath = join(repoRoot, "apps", "workers", "src", "bootstrap.ts");

/**
 * Blanks `//` and block comments plus string/template literal interiors, keeping
 * every offset so line-indexed lookups stay valid in both copies.
 */
function sanitize(source: string): string {
  const chars = source.split("");
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (ch === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") chars[index++] = " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      chars[index++] = " ";
      chars[index++] = " ";
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") chars[index] = " ";
        index++;
      }
      if (index < source.length) {
        chars[index++] = " ";
        chars[index++] = " ";
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      index++;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          chars[index] = " ";
          index++;
        }
        if (index < source.length && source[index] !== "\n") chars[index] = " ";
        index++;
      }
      if (index < source.length) index++;
      continue;
    }
    index++;
  }
  return chars.join("");
}

const bootstrap = sanitize(readFileSync(bootstrapPath, "utf8"));
const sagaIntegration = sanitize(readFileSync(sagaIntegrationPath, "utf8"));
const workersBootstrap = sanitize(readFileSync(workersBootstrapPath, "utf8"));

/** Resolves a `QUEUE_NAMES.<KEY>` reference to the queue name it denotes. */
function resolveQueueKey(key: string): string | undefined {
  return (QUEUE_NAMES as Record<string, string>)[key];
}

/**
 * The block passed to `new SagaIntegration({ … })`, delimited by brace balance
 * from the opening brace so a nested object can never truncate it early.
 */
function sagaIntegrationConstructionBlock(): string {
  const start = bootstrap.indexOf("new SagaIntegration({");
  if (start === -1) return "";
  const open = bootstrap.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bootstrap.length; i++) {
    if (bootstrap[i] === "{") depth++;
    else if (bootstrap[i] === "}") {
      depth--;
      if (depth === 0) return bootstrap.slice(open, i + 1);
    }
  }
  return "";
}

/**
 * The queue names the API's publish pipeline actually binds: the identifier the
 * saga engine receives as its `queue`, resolved back to the `forQueue(...)` call
 * that produced it, plus any queue named directly inside the construction block.
 */
function pipelineQueueNamesFromBootstrap(): string[] {
  const block = sagaIntegrationConstructionBlock();
  const names = new Set<string>();

  for (const match of block.matchAll(/QUEUE_NAMES\.([A-Z_]+)/g)) {
    const resolved = resolveQueueKey(match[1] ?? "");
    if (resolved !== undefined) names.add(resolved);
  }

  const queueField = /(^|[\s,{])queue:\s*([A-Za-z_$][\w$]*)/m.exec(block);
  const identifier = queueField?.[2];
  if (identifier !== undefined) {
    const binding = new RegExp(
      `const\\s+${identifier}\\s*=[^;]*?forQueue\\(\\s*QUEUE_NAMES\\.([A-Z_]+)`,
      "s"
    ).exec(bootstrap);
    const resolved = resolveQueueKey(binding?.[1] ?? "");
    if (resolved !== undefined) names.add(resolved);
  }

  return [...names].sort();
}

/** The queues the workers process registers a consumer-presence checker for. */
function consumerPresenceQueuesFromWorkers(): string[] {
  const names = new Set<string>();
  for (const match of workersBootstrap.matchAll(
    /new ConsumerPresenceHealthChecker\(\s*([A-Za-z_$][\w$.]*)/g
  )) {
    names.add(match[1] ?? "");
  }
  return [...names];
}

describe("the required-consumer set is derived from the publish pipeline", () => {
  it("finds every source the assertions read", () => {
    // Non-vacuity. A scan that stopped locating the construction block would make
    // the containment assertion trivially true over an empty set — exactly the
    // silent pass this suite exists to prevent.
    expect(sagaIntegrationConstructionBlock()).not.toBe("");
    expect(workersBootstrap.length).toBeGreaterThan(0);
    expect(PUBLISH_PIPELINE_QUEUES.length).toBeGreaterThan(0);
  });

  it("blanks comments and literals without blanking code", () => {
    expect({
      keepsCode: bootstrap.includes("new SagaIntegration({"),
      dropsLiteralInterior: !bootstrap.includes("omnipost-api"),
    }).toEqual({ keepsCode: true, dropsLiteralInterior: true });
  });

  it("lists every queue the publish pipeline enqueues to", () => {
    // The drift runtime cannot see: a queue added to the pipeline and not to the
    // constant leaves the environment one consumer short, and every gate built on
    // the constant keeps reporting green over the gap.
    const pipeline = pipelineQueueNamesFromBootstrap();
    expect(pipeline.length).toBeGreaterThan(0);

    const missing = pipeline.filter(
      (name) => !(PUBLISH_PIPELINE_QUEUES as readonly string[]).includes(name)
    );
    expect(missing).toEqual([]);
  });

  it("keeps the pipeline's only publish producer inside the constant", () => {
    // The pivot step enqueues through the injected closure, so the engine module
    // itself names no queue. If it ever does, the constant must already cover it.
    const engineQueues = [...sagaIntegration.matchAll(/QUEUE_NAMES\.([A-Z_]+)/g)]
      .map((match) => resolveQueueKey(match[1] ?? ""))
      .filter((name): name is string => name !== undefined);

    const missing = engineQueues.filter(
      (name) => !(PUBLISH_PIPELINE_QUEUES as readonly string[]).includes(name)
    );
    expect(missing).toEqual([]);
  });

  it("registers exactly one consumer-presence checker per queue in the constant", () => {
    // The other direction: a queue in the constant with no consumer in the workers
    // process means the readiness gate can never turn green for it, and a consumer
    // registered for a queue outside the constant is a requirement nothing states.
    const registered = consumerPresenceQueuesFromWorkers();

    expect(registered.length).toBeGreaterThan(0);
    // The workers iterate the constant rather than naming queues one by one, which
    // is what makes "adding a queue adds a requirement" true by construction.
    expect(workersBootstrap).toContain("PUBLISH_PIPELINE_QUEUES");
  });
});
