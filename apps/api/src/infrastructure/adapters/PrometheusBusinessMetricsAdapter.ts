/**
 * @file PrometheusBusinessMetricsAdapter.ts
 * @description Infrastructure adapter implementing `BusinessMetricsPort` by
 *              delegating to the Prometheus counters in `metrics/businessMetrics`.
 *              Lets post use cases emit lifecycle metrics through the port
 *              without importing the concrete counters.
 * @layer infrastructure
 */

import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import {
  incrementPostCreated,
  incrementPostPublished,
  incrementPostDeleted,
} from "../../metrics/businessMetrics.js";

/**
 * @class PrometheusBusinessMetricsAdapter
 * @description Thin pass-through from the `BusinessMetricsPort` contract to the
 *   module-level Prometheus counter functions.
 */
export class PrometheusBusinessMetricsAdapter implements BusinessMetricsPort {
  incrementPostCreated(): void {
    incrementPostCreated();
  }

  incrementPostPublished(): void {
    incrementPostPublished();
  }

  incrementPostDeleted(): void {
    incrementPostDeleted();
  }
}
