/**
 * @file usableStatus.test.ts
 * @description Pins the one rule the API's health routes and the workers' readiness share: a
 *              healthy or a degraded status can serve, since a degraded dependency still answers,
 *              and anything else cannot.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { isUsable } from "@monitoring/health-checks";

describe("isUsable", () => {
  it("counts healthy and degraded as usable, and unhealthy or an unknown status as not", () => {
    expect(["healthy", "degraded", "unhealthy", "unknown", ""].map(isUsable)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
