/**
 * @file containerSetupOptionsContract.type-test.ts
 * @description Compile-time pin for the container wiring contract: composing the
 *   container WITHOUT a metrics collector must not type-check.
 *
 *   ## Why this is a type test and not only a runtime test
 *
 *   The claim is that the omission is INEXPRESSIBLE: the compiler refuses the
 *   call before any code runs. `registerInstance` also refuses `undefined` at
 *   run time, the layer that stops a call the compiler does not see, whether a
 *   cast hides it or no typecheck opens the file: 22 harnesses once composed a
 *   container without a collector from test files no project typecheck opened.
 *   Both layers are pinned: the runtime refusal by `Container.test.ts` and
 *   `testContainer.test.ts`, the static one here.
 *
 *   The assertion mechanism is `@ts-expect-error`, and it is self-red in both
 *   directions:
 *
 *   - While `apiMetrics` IS required, the call below is an error, the
 *     suppression is used, and this file compiles.
 *   - If `apiMetrics` is ever widened to optional, given a default, or deleted,
 *     the call becomes legal, the suppression has nothing to suppress, and
 *     TypeScript raises TS2578 ("Unused '@ts-expect-error' directive") — this
 *     file fails to compile. That is the point: the pin cannot be satisfied by
 *     weakening the thing it guards.
 *
 *   That direction is not hypothetical. The same dependency was made optional on
 *   two other collaborators for harness convenience within a fortnight of this
 *   being written, each time with the convenience stated in the comment as the
 *   reason. A grep gate cannot see a `?`; this can.
 *
 *   ## Enforcement status
 *
 *   `apps/api/tsconfig.json` includes `src` ONLY, so no project-level typecheck
 *   opens anything else under `apps/api/tests`. This file is enforced because it
 *   is named `.type-test.ts` and therefore matches `tsconfig.type-tests.json`'s
 *   `tests/**\/*.type-test.ts` include, which the package's `typecheck` script
 *   runs immediately after the source pass. The name is load-bearing twice over:
 *   it is also what keeps the vitest collector (`tests/unit/**\/*.test.ts`) and
 *   the node:test batch list from treating a file with no runtime assertions as
 *   a suite that ought to execute.
 *
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { Container } from "../../../../src/infrastructure/container/Container.js";
import { setupContainer } from "../../../../src/infrastructure/container/setup.js";
import type { ApiMetrics } from "../../../../src/metrics/apiMetrics.js";

declare const prisma: PrismaClient;
declare const apiMetrics: ApiMetrics;

/**
 * @description The call below omits the metrics collector. It MUST be rejected by the
 *   compiler; the directive above it is what proves the rejection happened.
 */
export function wiringWithoutMetricsMustNotCompile(): void {
  // @ts-expect-error apiMetrics is REQUIRED. A container composed without it has nothing
  // to register under TOKENS.ApiMetrics, and RedisBruteForceAdapter dereferences that
  // collector unguarded on the customer login path.
  setupContainer({ prisma });
}

/**
 * @description The second loosening, which the omission pin above does NOT see — measured,
 *   not assumed. Widening the property to `ApiMetrics | undefined` keeps the KEY
 *   required, so `setupContainer({ prisma })` stays an error and the directive
 *   above stays used: that pin reports green while `apiMetrics: undefined` has
 *   become a legal argument and the fail-open is back. This case is what closes
 *   that gap, and it is self-red in the same both-directions way: while the value
 *   type excludes `undefined` the call below is an error and the suppression is
 *   used; the moment `undefined` joins the type the call is legal and TS2578
 *   fires here.
 */
export function wiringWithUndefinedMetricsMustNotCompile(): void {
  // @ts-expect-error apiMetrics must be a collector, never undefined. A required key
  // whose value may be undefined reintroduces exactly the registration this contract
  // exists to forbid — only the run-time refusal in registerInstance would stop it.
  setupContainer({ prisma, apiMetrics: undefined });
}

/**
 * @description The container's own entry point refuses a statically `undefined` instance, so
 *   the same registration cannot be written against a container directly either.
 *   Self-red in both directions: while the parameter excludes `undefined` the call
 *   is an error and the suppression is used; widening it to `T` makes the call
 *   legal and TS2578 fires here.
 */
export function registeringUndefinedInstanceMustNotCompile(): void {
  // @ts-expect-error registerInstance excludes undefined from its instance type.
  new Container().registerInstance(Symbol.for("pin"), undefined);
}

/**
 * @description The refusal is of `undefined` alone. `null` is a value a caller may register on
 *   purpose, and `resolve` hands it back, so narrowing the parameter to
 *   `NonNullable<T>` would refuse a registration the container supports.
 */
export function registeringNullInstanceMustCompile(): void {
  new Container().registerInstance(Symbol.for("pin"), null);
}

/**
 * @description The positive direction. If this ever stops compiling, the contract changed
 *   shape rather than merely loosening, and the pins above are no longer measuring
 *   what their comments claim.
 */
export function wiringWithMetricsMustCompile(): void {
  setupContainer({ prisma, apiMetrics });
}
