/**
 * @file index.ts
 * @description Barrel exports for the external-apis adapter — exposes ExternalApiCircuitBreaker
 *              and shared factory/accessor functions.
 * @layer infrastructure
 */
export {
  ExternalApiCircuitBreaker,
  type ExternalApiOptions,
  type CircuitBreakerStatus,
  DEFAULT_EXTERNAL_API_OPTIONS,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
} from "./circuitBreaker.js";

// Global circuit breaker instance
import client from "prom-client";
import { ExternalApiCircuitBreaker } from "./circuitBreaker.js";

let globalCircuitBreaker: ExternalApiCircuitBreaker | null = null;

export function createExternalApiCircuitBreaker(
  registry: client.Registry,
  redisUrl?: string
): ExternalApiCircuitBreaker {
  if (!globalCircuitBreaker) {
    globalCircuitBreaker = new ExternalApiCircuitBreaker(registry, redisUrl);
  }
  return globalCircuitBreaker;
}

export function getExternalApiCircuitBreaker(): ExternalApiCircuitBreaker | null {
  return globalCircuitBreaker;
}
