/**
 * @file testContainer.ts
 * @description The route-test composition root. `apps/api/src/index.ts` is the
 *   server's root: it builds an `ApiMetrics` and hands it to `setupContainer`.
 *   A route unit suite is a second entry point into the same core and needs the
 *   same wiring — so it lives here once instead of being re-decided at every
 *   harness.
 *
 *   WHAT THIS SUPPLIES that a bare `setupContainer` call does not: one live
 *   `ApiMetrics` (50+ prom-client collectors) registered under
 *   `TOKENS.ApiMetrics`. Read that before assuming a suite built through here
 *   is inert; `createRouteTestContainer({ prisma })` is not the same statement
 *   as `setupContainer({ prisma })` was.
 *
 *   WHY THE OPTIONS TYPE IS SHAPED THIS WAY: it omits `apiMetrics` from the
 *   production options and re-adds it as optional, so a harness CANNOT express
 *   the omission that left `TOKENS.ApiMetrics` registered as `undefined` while
 *   `RedisBruteForceAdapter` dereferenced it unguarded on the login path. The
 *   type is derived from `ContainerSetupOptions` rather than restated, so a
 *   rename or a new required option propagates here instead of drifting.
 *
 *   WHY A FRESH REGISTRY PER CALL: the `ApiMetrics` constructor calls
 *   `registry.clear()` on the INJECTED registry and never touches the global
 *   `client.register`. A fresh registry therefore cannot clobber a sibling
 *   instance, and — more importantly — cannot wipe the process-wide registry
 *   that `deletionMetrics`, `sagaRecoveryMetrics` and `guardrailMetrics`
 *   register against and that `/metrics` serves.
 *
 *   Pass `apiMetrics` explicitly when a suite needs to read counters back.
 * @layer infrastructure
 */

import * as client from "prom-client";
import type { Container } from "../../../src/infrastructure/container/Container.js";
import {
  setupContainer,
  type ContainerSetupOptions,
} from "../../../src/infrastructure/container/setup.js";
import { ApiMetrics } from "../../../src/metrics/apiMetrics.js";

/**
 * `ContainerSetupOptions` with `apiMetrics` demoted to optional. Every other
 * member — including any future required one — is inherited, not copied.
 */
export type RouteTestContainerOptions = Omit<ContainerSetupOptions, "apiMetrics"> &
  Partial<Pick<ContainerSetupOptions, "apiMetrics">>;

/**
 * @function createTestApiMetrics
 * @description Builds an `ApiMetrics` over a private registry. Exported so a
 *   suite that wants to read counters back can hold the instance it passes in.
 * @returns A fully-shaped collector isolated from the global prom-client registry
 */
export function createTestApiMetrics(): ApiMetrics {
  return new ApiMetrics(new client.Registry());
}

/**
 * @function createRouteTestContainer
 * @description Composes the DI container for a route unit suite, supplying the
 *   required `apiMetrics` the harness cannot omit.
 * @param options - Everything `setupContainer` takes, with `apiMetrics` optional
 * @returns The composed container (the process-global one, as `setupContainer` composes)
 */
export function createRouteTestContainer(options: RouteTestContainerOptions): Container {
  return setupContainer({
    ...options,
    apiMetrics: options.apiMetrics ?? createTestApiMetrics(),
  });
}
