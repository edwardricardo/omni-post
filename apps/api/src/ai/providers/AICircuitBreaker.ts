/**
 * @file AICircuitBreaker.ts
 * @description Per-provider circuit breaker for AI orchestrator. Implements
 *              the standard three-state machine (closed → open → half-open)
 *              keyed by provider name. After `failureThreshold` consecutive
 *              `recordFailure` calls the breaker opens; while open
 *              `canExecute` returns false, so the orchestrator skips that
 *              provider and falls through to the next one in the chain.
 *              After `cooldownMs` the breaker moves to half-open and admits
 *              one probe; success closes it, failure re-opens.
 *
 *              Lightweight by design — no Prometheus, no DLQ, no fallback
 *              cache (those concerns live in `@adapters/external-apis` for
 *              provider apiClients; the AI path uses observability via the
 *              orchestrator logger). Constructor-injectable, fully
 *              deterministic by clock injection for tests.
 * @layer infrastructure
 */

import type { AIProviderName } from "@core/domain/ai/AIContracts.js";

export type AICircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface AICircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. Default 3. */
  readonly failureThreshold?: number;
  /** Milliseconds the breaker stays OPEN before allowing a half-open probe.
   *  Default 30 000. */
  readonly cooldownMs?: number;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

interface CircuitState {
  state: AICircuitBreakerState;
  failureCount: number;
  openedAt: number | null;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

export class AICircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<AIProviderName, CircuitState>();

  constructor(options: AICircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * @method canExecute
   * @description Returns true when the orchestrator may call this provider.
   *   Side-effect: transitions OPEN → HALF_OPEN when the cooldown has
   *   elapsed, so callers do not have to drive the state machine
   *   themselves.
   */
  canExecute(provider: AIProviderName): boolean {
    const state = this.get(provider);
    if (state.state === "CLOSED" || state.state === "HALF_OPEN") return true;

    if (state.openedAt !== null && this.now() - state.openedAt >= this.cooldownMs) {
      state.state = "HALF_OPEN";
      return true;
    }
    return false;
  }

  /** Marks a successful call. Resets failure count; HALF_OPEN → CLOSED. */
  recordSuccess(provider: AIProviderName): void {
    const state = this.get(provider);
    state.failureCount = 0;
    state.state = "CLOSED";
    state.openedAt = null;
  }

  /** Marks a failed call. Increments failure count; opens when threshold is
   *  reached; HALF_OPEN failure re-opens immediately. */
  recordFailure(provider: AIProviderName): void {
    const state = this.get(provider);
    if (state.state === "HALF_OPEN") {
      state.state = "OPEN";
      state.openedAt = this.now();
      state.failureCount = this.failureThreshold;
      return;
    }
    state.failureCount += 1;
    if (state.failureCount >= this.failureThreshold) {
      state.state = "OPEN";
      state.openedAt = this.now();
    }
  }

  /** Read-only snapshot. Useful for observability. */
  getState(provider: AIProviderName): AICircuitBreakerState {
    return this.get(provider).state;
  }

  private get(provider: AIProviderName): CircuitState {
    let state = this.states.get(provider);
    if (!state) {
      state = { state: "CLOSED", failureCount: 0, openedAt: null };
      this.states.set(provider, state);
    }
    return state;
  }
}
