/**
 * Infrastructure Layer - Event Schema Registry
 *
 * Part of P2-5: Event Versioning Strategy
 * Maps (eventType, version) → Zod schema for payload validation.
 *
 * Enables:
 * - Validating incoming event payloads match expected shape
 * - Documenting event schemas as executable code
 * - Detecting unknown event types or unsupported versions
 *
 * All 12 production events (10 Post + 2 Project/Crisis) are pre-registered at v1.
 */

import { z } from "zod";

/**
 * Result of a schema validation attempt.
 */
export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Registry entry for a single event type — maps version number to Zod schema.
 */
type SchemaVersionMap = Map<number, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Built-in schemas for all 12 production events at version 1
// ---------------------------------------------------------------------------

/** PostCreated v1 */
const postCreatedV1 = z.object({
  postId: z.string(),
  projectId: z.string(),
  body: z.string(),
  locale: z.string(),
  title: z.string().optional(),
});

/** PostContentUpdated v1 */
const postContentUpdatedV1 = z.object({
  postId: z.string(),
  previousBody: z.string(),
  newBody: z.string(),
  contentVersionId: z.string(),
});

/** PostScheduled v1 */
const postScheduledV1 = z.object({
  postId: z.string(),
  scheduledAt: z.string(),
  timezone: z.string(),
});

/** PostUnscheduled v1 */
const postUnscheduledV1 = z.object({
  postId: z.string(),
  previousScheduledAt: z.string(),
});

/** PostPublishingStarted v1 */
const postPublishingStartedV1 = z.object({
  postId: z.string(),
  targetProviders: z.array(z.string()),
});

/** PostPublished v1 */
const postPublishedV1 = z.object({
  postId: z.string(),
  publishedAt: z.string(),
  providerResults: z.record(
    z.string(),
    z.object({
      success: z.boolean(),
      externalId: z.string().optional(),
      error: z.string().optional(),
    })
  ),
});

/** PostPublishingFailed v1 */
const postPublishingFailedV1 = z.object({
  postId: z.string(),
  error: z.string(),
  failedProviders: z.array(z.string()),
  retryable: z.boolean(),
});

/** PostCancelled v1 */
const postCancelledV1 = z.object({
  postId: z.string(),
  previousStatus: z.string(),
  reason: z.string().optional(),
});

/** PostMediaAdded v1 */
const postMediaAddedV1 = z.object({
  postId: z.string(),
  mediaId: z.string(),
  mediaType: z.string(),
  mediaUrl: z.string(),
});

/** PostMediaRemoved v1 */
const postMediaRemovedV1 = z.object({
  postId: z.string(),
  mediaId: z.string(),
});

/** CrisisModeEntered v1 */
const crisisModeEnteredV1 = z.object({
  projectId: z.string(),
  reason: z.string(),
  startedAt: z.string(),
});

/** CrisisModeExited v1 */
const crisisModeExitedV1 = z.object({
  projectId: z.string(),
  reason: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number(),
});

// ---------------------------------------------------------------------------
// EventSchemaRegistry
// ---------------------------------------------------------------------------

/**
 * EventSchemaRegistry — maps (eventType, version) pairs to Zod schemas.
 *
 * Usage:
 * ```typescript
 * const registry = new EventSchemaRegistry();
 * const result = registry.validate("PostCreated", 1, payload);
 * if (!result.ok) { ... }
 * ```
 *
 * Pre-populated with schemas for all 12 production events at v1.
 * New schemas can be registered via `register()` for future versions.
 */
export class EventSchemaRegistry {
  private readonly schemas: Map<string, SchemaVersionMap> = new Map();

  constructor() {
    // Register all 12 production event schemas at v1
    this.register("PostCreated", 1, postCreatedV1);
    this.register("PostContentUpdated", 1, postContentUpdatedV1);
    this.register("PostScheduled", 1, postScheduledV1);
    this.register("PostUnscheduled", 1, postUnscheduledV1);
    this.register("PostPublishingStarted", 1, postPublishingStartedV1);
    this.register("PostPublished", 1, postPublishedV1);
    this.register("PostPublishingFailed", 1, postPublishingFailedV1);
    this.register("PostCancelled", 1, postCancelledV1);
    this.register("PostMediaAdded", 1, postMediaAddedV1);
    this.register("PostMediaRemoved", 1, postMediaRemovedV1);
    this.register("CrisisModeEntered", 1, crisisModeEnteredV1);
    this.register("CrisisModeExited", 1, crisisModeExitedV1);
  }

  /**
   * Register a Zod schema for a given (eventType, version) pair.
   *
   * If a schema already exists for that pair it will be overwritten —
   * this allows tests to replace schemas without constructing a new registry.
   *
   * @param eventType - Event type discriminator (e.g. "PostCreated")
   * @param version   - Schema version number (e.g. 1, 2, 3)
   * @param schema    - Zod schema that validates the event payload
   */
  register(eventType: string, version: number, schema: z.ZodTypeAny): void {
    let versionMap = this.schemas.get(eventType);
    if (!versionMap) {
      versionMap = new Map<number, z.ZodTypeAny>();
      this.schemas.set(eventType, versionMap);
    }
    versionMap.set(version, schema);
  }

  /**
   * Retrieve the Zod schema for a specific (eventType, version) pair.
   *
   * @returns The schema, or `undefined` if no schema has been registered
   *          for this eventType+version combination.
   */
  getSchema(eventType: string, version: number): z.ZodTypeAny | undefined {
    return this.schemas.get(eventType)?.get(version);
  }

  /**
   * Get the highest registered version number for an event type.
   *
   * @returns The highest version number, or `undefined` if the event type
   *          is not registered at all.
   */
  getCurrentVersion(eventType: string): number | undefined {
    const versionMap = this.schemas.get(eventType);
    if (!versionMap || versionMap.size === 0) return undefined;

    let max = 0;
    for (const v of versionMap.keys()) {
      if (v > max) max = v;
    }
    return max;
  }

  /**
   * Validate a payload against the schema for the given (eventType, version) pair.
   *
   * @param eventType - Event type to look up
   * @param version   - Schema version to validate against
   * @param payload   - The event payload object to validate
   *
   * @returns `{ ok: true }` on success, or `{ ok: false, errors: string[] }` on failure.
   *          Returns a failure result if no schema is registered for the pair.
   */
  validate(eventType: string, version: number, payload: unknown): ValidationResult {
    const schema = this.getSchema(eventType, version);
    if (!schema) {
      return {
        ok: false,
        errors: [`No schema registered for eventType="${eventType}" version=${version}`],
      };
    }

    const result = schema.safeParse(payload);
    if (result.success) {
      return { ok: true };
    }

    return {
      ok: false,
      errors: result.error.issues.map(
        (e) => `${e.path.length > 0 ? e.path.join(".") + ": " : ""}${e.message}`
      ),
    };
  }

  /**
   * Check whether any schemas are registered for a given event type.
   */
  hasEventType(eventType: string): boolean {
    const versionMap = this.schemas.get(eventType);
    return versionMap !== undefined && versionMap.size > 0;
  }

  /**
   * List all registered event types.
   */
  get registeredEventTypes(): string[] {
    return Array.from(this.schemas.keys());
  }
}
