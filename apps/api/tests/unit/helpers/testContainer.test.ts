/**
 * @file testContainer.test.ts
 * @description Pins the route-test composition root and the defect it exists to
 *   close. `ContainerSetupOptions.apiMetrics` is REQUIRED, but nothing under
 *   `apps/api/tests` is opened by a compiler, so 22 harnesses omitted it and the
 *   container registered `TOKENS.ApiMetrics` as `undefined`. Resolution hands that
 *   `undefined` straight back instead of throwing, so there was no runtime signal
 *   either — until an injected consumer dereferenced it.
 *
 *   The first case below is a CHARACTERIZATION of that fail-open: it asserts the
 *   broken behaviour, not the fix, and it must keep passing after the seam lands.
 *   Deleting it would remove the only executable statement of why the seam exists.
 *   The remaining cases pin what the seam guarantees: a live collector on the exact
 *   dereference chain the brute-force adapter uses, a registry that cannot disturb
 *   the process-wide one production scrapes, and an explicit override by identity.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as client from "prom-client";
import { resetContainer } from "../../../src/infrastructure/container/Container.js";
import { setupContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { ApiMetrics } from "../../../src/metrics/apiMetrics.js";
import { createMockPrismaModule } from "./mockPrisma.js";
import { createRouteTestContainer, createTestApiMetrics } from "./testContainer.js";

/** The exact label set `RedisBruteForceAdapter` passes on the login path. */
const LOGIN_THREAT = { threat_type: "blocked_ip_attempt", endpoint: "login" } as const;

describe("createRouteTestContainer", () => {
  let prisma: ReturnType<typeof createMockPrismaModule>["prisma"];

  beforeEach(() => {
    resetContainer();
    prisma = createMockPrismaModule().prisma;
  });

  it("characterizes the fail-open: a container built without apiMetrics resolves undefined", () => {
    // canon-exception: test-fixture
    const bare = setupContainer({ prisma } as never);

    const resolved = bare.resolve<ApiMetrics | undefined>(TOKENS.ApiMetrics);

    expect(resolved).toBeUndefined();
    expect(() => {
      (resolved as ApiMetrics).metrics.securityThreats.inc(LOGIN_THREAT);
    }).toThrow(TypeError);
  });

  it("registers a live collector whose brute-force dereference chain executes", () => {
    const container = createRouteTestContainer({ prisma: prisma as never });

    const resolved = container.resolve<ApiMetrics>(TOKENS.ApiMetrics);

    expect(resolved).toBeInstanceOf(ApiMetrics);
    expect(() => {
      resolved.metrics.securityThreats.inc(LOGIN_THREAT);
    }).not.toThrow();
  });

  it("keeps its collectors off the process-wide registry production scrapes", () => {
    createRouteTestContainer({ prisma: prisma as never });
    resetContainer();
    createRouteTestContainer({ prisma: prisma as never });

    expect(client.register.getSingleMetric("api_http_requests_total")).toBeUndefined();
  });

  it("returns the caller's own collector when one is supplied", () => {
    const mine = createTestApiMetrics();

    const container = createRouteTestContainer({ prisma: prisma as never, apiMetrics: mine });

    expect(container.resolve<ApiMetrics>(TOKENS.ApiMetrics)).toBe(mine);
  });
});
