/**
 * @file BusinessMetricsPort.ts
 * @description Application-layer port for emitting post-lifecycle business
 *              metrics. Post use cases depend on this interface, not on the
 *              concrete Prometheus counters in infrastructure. Scoped to the
 *              counters the application emits (Interface Segregation); other
 *              business counters (cache, provider) stay infrastructure-internal.
 * @layer domain
 */

/**
 * Contract for incrementing post-lifecycle counters. The infrastructure
 * adapter backs these with Prometheus counters; tests inject a no-op or spy.
 */
export interface BusinessMetricsPort {
  incrementPostCreated(): void;
  incrementPostPublished(): void;
  incrementPostDeleted(): void;
}
