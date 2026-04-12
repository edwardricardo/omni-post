/**
 * @file EventUpcaster.ts
 * @description Transforms integration event payloads from version N to N+1 via a chainable
 *              upcaster pipeline. Enables forward-compatible event schema evolution.
 * @layer infrastructure
 */

// ---------------------------------------------------------------------------
// Upcaster interface
// ---------------------------------------------------------------------------

/**
 * An upcaster transforms a payload from one schema version to the next.
 *
 * @template TFrom - Shape of the payload at `fromVersion`
 * @template TTo   - Shape of the payload at `toVersion`
 */
export interface Upcaster<TFrom = unknown, TTo = unknown> {
  /** Event type this upcaster applies to (e.g. "PostCreated") */
  readonly eventType: string;
  /** Version the input payload is at */
  readonly fromVersion: number;
  /** Version the output payload will be at (must equal fromVersion + 1) */
  readonly toVersion: number;
  /**
   * Transform the payload from `fromVersion` to `toVersion`.
   *
   * @param payload - The payload in `fromVersion` shape
   * @returns       - The payload in `toVersion` shape
   */
  upcast(payload: TFrom): TTo;
}

// ---------------------------------------------------------------------------
// UpcasterChain
// ---------------------------------------------------------------------------

/**
 * Result returned by `UpcasterChain.upcast()`.
 */
export interface UpcastResult {
  /** The (potentially transformed) payload */
  payload: unknown;
  /** The version the payload is now at */
  version: number;
}

/**
 * UpcasterChain — chains multiple upcasters to migrate payloads across versions.
 *
 * Example:
 * ```typescript
 * const chain = new UpcasterChain();
 * chain.register({ eventType: "PostCreated", fromVersion: 1, toVersion: 2, upcast: (p) => ({ ...p, newField: "default" }) });
 * chain.register({ eventType: "PostCreated", fromVersion: 2, toVersion: 3, upcast: (p) => ({ ...p, anotherField: 0 }) });
 *
 * const result = chain.upcast("PostCreated", payload, 1, 3);
 * // result.version === 3, result.payload has newField and anotherField
 * ```
 */
export class UpcasterChain {
  /**
   * Internal map: eventType → Map<fromVersion, Upcaster>
   * Only one upcaster per (eventType, fromVersion) pair is allowed.
   */
  private readonly upcasters: Map<string, Map<number, Upcaster>> = new Map();

  /**
   * Register an upcaster for a specific (eventType, fromVersion) pair.
   *
   * If an upcaster already exists for that pair it will be overwritten.
   *
   * @param upcaster - The upcaster to register
   */
  register(upcaster: Upcaster): void {
    let versionMap = this.upcasters.get(upcaster.eventType);
    if (!versionMap) {
      versionMap = new Map<number, Upcaster>();
      this.upcasters.set(upcaster.eventType, versionMap);
    }
    versionMap.set(upcaster.fromVersion, upcaster);
  }

  /**
   * Apply upcasters sequentially from `fromVersion` up to `targetVersion`.
   *
   * If `targetVersion` is omitted, upcasting continues as far as the chain
   * allows (i.e., until no upcaster is registered for the current version).
   *
   * If no upcasters are registered for the type/fromVersion, returns the
   * original payload unchanged.
   *
   * @param eventType     - The event type (e.g. "PostCreated")
   * @param payload       - The payload to transform
   * @param fromVersion   - The version the payload is currently at
   * @param targetVersion - The desired target version (optional)
   * @returns `{ payload, version }` after applying all applicable upcasters
   */
  upcast(
    eventType: string,
    payload: unknown,
    fromVersion: number,
    targetVersion?: number
  ): UpcastResult {
    const versionMap = this.upcasters.get(eventType);
    if (!versionMap) {
      // No upcasters registered for this event type — return as-is
      return { payload, version: fromVersion };
    }

    let current = payload;
    let currentVersion = fromVersion;

    // Walk the chain: v1 → v2 → v3 → ... stopping at targetVersion (or chain end)
    while (true) {
      if (targetVersion !== undefined && currentVersion >= targetVersion) {
        break;
      }

      const upcaster = versionMap.get(currentVersion);
      if (!upcaster) {
        // No upcaster from currentVersion — chain ends here
        break;
      }

      current = upcaster.upcast(current);
      currentVersion = upcaster.toVersion;
    }

    return { payload: current, version: currentVersion };
  }

  /**
   * Check whether a path exists from `fromVersion` to `targetVersion` for
   * the given event type.
   *
   * Returns `true` only if all intermediate upcasters exist in the chain
   * so the full migration can complete.
   *
   * @param eventType     - Event type to check
   * @param fromVersion   - Starting version
   * @param targetVersion - Desired final version
   */
  canUpcast(eventType: string, fromVersion: number, targetVersion: number): boolean {
    if (fromVersion >= targetVersion) return true;

    const versionMap = this.upcasters.get(eventType);
    if (!versionMap) return false;

    let current = fromVersion;
    while (current < targetVersion) {
      const upcaster = versionMap.get(current);
      if (!upcaster) return false;
      current = upcaster.toVersion;
    }

    return current === targetVersion;
  }

  /**
   * List all event types that have at least one registered upcaster.
   */
  get registeredEventTypes(): string[] {
    return Array.from(this.upcasters.keys());
  }
}
