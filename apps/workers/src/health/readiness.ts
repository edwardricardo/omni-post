/**
 * @file readiness.ts
 * @description Readiness verdict for the workers process: which critical
 *              dependencies are not healthy, asked ONE NAME AT A TIME so an
 *              unregistered checker is an answer, not an absence.
 * @layer infrastructure
 */
import type { Result } from "@shared/types";

/** The dependency name a queue's consumer-presence checker registers under. */
export function publishConsumerDependencyName(queueName: string): string {
  return `consumer:${queueName}`;
}

/** The slice of the health manager the verdict needs. */
export interface ReadinessProbe {
  checkDependency(name: string): Promise<Result<{ status: string }, "NOT_FOUND" | "CHECK_FAILED">>;
}

export interface ReadinessVerdict {
  ready: boolean;
  unhealthyDependencies: string[];
}

/**
 * Asks for each critical dependency BY NAME and treats anything other than an
 * explicit `healthy` — including a name with no registered checker — as not
 * ready.
 *
 * The distinction is the whole point. Filtering a whole-report scan by a list of
 * critical names contributes zero entries for a name nobody registered, and zero
 * unhealthy entries reads as ready: the probe answers 200 for a dependency it
 * never checked. Per-name lookup turns that silence into a `NOT_FOUND`, so the
 * gate fails closed on its own wiring mistakes rather than certifying them.
 */
export async function evaluateReadiness(
  probe: ReadinessProbe,
  criticalDependencies: readonly string[]
): Promise<ReadinessVerdict> {
  const results = await Promise.all(
    criticalDependencies.map((name) => probe.checkDependency(name))
  );

  const unhealthyDependencies = criticalDependencies.filter((_name, index) => {
    const result = results[index];
    return !result || !result.ok || result.value.status !== "healthy";
  });

  return { ready: unhealthyDependencies.length === 0, unhealthyDependencies };
}
