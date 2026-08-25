/**
 * @file readiness.unit.test.ts
 * @description Pins the worker readiness verdict, including the case the previous
 *              shape could not express: a critical dependency whose checker was
 *              never registered. Filtering a whole-report scan for names in a
 *              critical list yields ZERO entries for a name nobody registered, and
 *              zero unhealthy entries reads as ready — a 200 over a dependency that
 *              was never checked. That is the exact green-over-nothing this gate is
 *              meant to close, so it is asserted rather than assumed.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { evaluateReadiness, publishConsumerDependencyName } from "../../src/health/readiness.js";

type DependencyReport = { name: string; status: "healthy" | "degraded" | "unhealthy" };
type CheckResult = Result<DependencyReport, "NOT_FOUND" | "CHECK_FAILED">;

/** A health manager double that answers only for the names it was given. */
function makeManager(statuses: Record<string, DependencyReport["status"]>) {
  return {
    checkDependency: async (name: string): Promise<CheckResult> => {
      const status = statuses[name];
      if (status === undefined) return err("NOT_FOUND");
      return ok({ name, status });
    },
  };
}

const HEALTHY_CORE = { database: "healthy", redis: "healthy" } as const;
const CONSUMER = publishConsumerDependencyName("publish");

describe("worker readiness", () => {
  it("is ready when every critical dependency, including the publish consumer, is healthy", async () => {
    const manager = makeManager({ ...HEALTHY_CORE, [CONSUMER]: "healthy" });

    const verdict = await evaluateReadiness(manager, ["database", "redis", CONSUMER]);

    expect(verdict).toEqual({ ready: true, unhealthyDependencies: [] });
  });

  it("is NOT ready when nothing is consuming the publish queue", async () => {
    const manager = makeManager({ ...HEALTHY_CORE, [CONSUMER]: "unhealthy" });

    const verdict = await evaluateReadiness(manager, ["database", "redis", CONSUMER]);

    expect(verdict).toEqual({ ready: false, unhealthyDependencies: [CONSUMER] });
  });

  it("is NOT ready when a critical dependency has no registered checker", async () => {
    // Registration throwing inside a guard, registration ordered after the server
    // starts listening, or a rename between the register() literal and the
    // critical list all produce this shape. Reporting ready here hands the caller
    // a green derived from a question nobody asked.
    const manager = makeManager(HEALTHY_CORE);

    const verdict = await evaluateReadiness(manager, ["database", "redis", CONSUMER]);

    expect(verdict).toEqual({ ready: false, unhealthyDependencies: [CONSUMER] });
  });

  it("is NOT ready when a dependency check fails outright", async () => {
    const manager = {
      checkDependency: async (name: string): Promise<CheckResult> =>
        name === "redis" ? err("CHECK_FAILED") : ok({ name, status: "healthy" as const }),
    };

    const verdict = await evaluateReadiness(manager, ["database", "redis", CONSUMER]);

    expect(verdict.ready).toBe(false);
    expect(verdict.unhealthyDependencies).toContain("redis");
  });

  it("treats a degraded critical dependency as not ready", async () => {
    const manager = makeManager({ database: "degraded", redis: "healthy", [CONSUMER]: "healthy" });

    const verdict = await evaluateReadiness(manager, ["database", "redis", CONSUMER]);

    expect(verdict).toEqual({ ready: false, unhealthyDependencies: ["database"] });
  });

  it("names the consumer dependency after the queue it watches", async () => {
    // The name travels into the readiness payload, so an operator reading a 503
    // learns WHICH queue is unattended without opening the source.
    expect(publishConsumerDependencyName("publish")).toBe("consumer:publish");
  });
});
