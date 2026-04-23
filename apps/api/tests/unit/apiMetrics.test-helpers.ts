/**
 * @file apiMetrics.test-helpers.ts
 * @description Test helpers for api metrics test helpers
 * @layer infrastructure
 */
import * as client from "prom-client";

export function createTestRegistry(): client.Registry {
  return new client.Registry();
}

export async function getCounterValue(
  counter: client.Counter,
  labels?: Record<string, string>
): Promise<number> {
  const metrics = await counter.get();
  if (labels) {
    const matching = metrics.values.find((v: any) =>
      Object.keys(labels).every((key) => v.labels[key] === labels[key])
    );
    return matching?.value ?? 0;
  }
  return metrics.values[0]?.value ?? 0;
}

export async function getGaugeValue(
  gauge: client.Gauge,
  labels?: Record<string, string>
): Promise<number> {
  const metrics = await gauge.get();
  if (labels) {
    const matching = metrics.values.find((v: any) =>
      Object.keys(labels).every((key) => v.labels[key] === labels[key])
    );
    return matching?.value ?? 0;
  }
  return metrics.values[0]?.value ?? 0;
}
