/**
 * Infrastructure Layer - Integration Event Consumer
 *
 * Part of P2-2: Integration Events via BullMQ
 * Part of P2-5: Event Versioning Strategy (schema validation + upcasting)
 *
 * BullMQ Worker that consumes integration events from the "integration-events" queue
 * and routes them to registered handlers based on job name (= event type).
 *
 * Design decisions:
 * - Receives a pre-built `ConnectionOptions` via constructor (DI-friendly — no global singletons).
 *   Workers require their own Redis connection with `maxRetriesPerRequest: null` per BullMQ docs.
 * - `start()` / `stop()` lifecycle methods — the Worker is not created in the constructor so
 *   the consumer can be instantiated without opening connections (useful in tests).
 * - `processJob()` is exposed as a public method so unit tests can exercise routing logic
 *   without a real BullMQ Worker or Redis connection.
 * - Unknown event types are silently skipped (no handler registered → no-op).
 * - Multiple handlers may be registered for the same event type; all are run in parallel.
 * - Optional `EventSchemaRegistry` and `UpcasterChain` enable versioned payload validation.
 *   When not provided (default) the consumer behaves identically to the pre-P2-5 version.
 */

import { Worker, type ConnectionOptions } from "bullmq";
import type { IntegrationEvent } from "./IntegrationEvent.js";
import type { IntegrationEventHandler } from "./IntegrationEventHandler.js";
import { createLogger } from "../../lib/logger.js";

const eventsLogger = createLogger("events");
import type { EventSchemaRegistry } from "./EventSchemaRegistry.js";
import type { UpcasterChain } from "./EventUpcaster.js";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

/** Queue name — must match the name used by BullMQIntegrationPublisher */
const QUEUE_NAME = QUEUE_NAMES.INTEGRATION_EVENTS;

/** Default worker concurrency */
const DEFAULT_CONCURRENCY = 3;

/**
 * Options for constructing an IntegrationEventConsumer.
 */
export interface IntegrationEventConsumerOptions {
  /**
   * BullMQ-compatible Redis connection options.
   * Workers need a dedicated connection with `maxRetriesPerRequest: null`
   * (required by BullMQ for blocking BRPOP operations).
   */
  connection: ConnectionOptions;

  /** Registered event handlers — built once at startup. */
  handlers: IntegrationEventHandler[];

  /**
   * Worker concurrency: how many jobs may be processed in parallel.
   * @default 3
   */
  concurrency?: number;

  /**
   * Optional schema registry for payload validation (P2-5).
   * When provided, event payloads are validated against their registered schema
   * before being dispatched to handlers. Invalid payloads are logged and skipped.
   */
  schemaRegistry?: EventSchemaRegistry;

  /**
   * Optional upcaster chain for schema migration (P2-5).
   * When provided and an event's schemaVersion is below the current version,
   * the payload is upcasted before validation and dispatch.
   */
  upcasterChain?: UpcasterChain;
}

/**
 * BullMQ Worker consumer for integration events.
 *
 * Routes jobs from the "integration-events" queue to registered handlers.
 * Job name = event type; job data = IntegrationEvent DTO.
 *
 * With P2-5 extensions (optional):
 * - If `schemaRegistry` is provided and `upcasterChain` is provided, events at
 *   older schema versions are automatically upcasted to the current version.
 * - Payloads that fail schema validation are logged as warnings and skipped,
 *   preventing malformed events from crashing handlers.
 */
export class IntegrationEventConsumer {
  private worker: Worker | null = null;
  private readonly routingMap: Map<string, IntegrationEventHandler[]>;
  private readonly connection: ConnectionOptions;
  private readonly concurrency: number;
  private readonly schemaRegistry: EventSchemaRegistry | undefined;
  private readonly upcasterChain: UpcasterChain | undefined;

  constructor(options: IntegrationEventConsumerOptions) {
    this.connection = options.connection;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.schemaRegistry = options.schemaRegistry;
    this.upcasterChain = options.upcasterChain;

    // Build handler routing map: eventType → handlers[]
    // Supports N handlers per event type — all run in parallel on dispatch.
    this.routingMap = new Map<string, IntegrationEventHandler[]>();
    for (const handler of options.handlers) {
      for (const eventType of handler.eventTypes) {
        const existing = this.routingMap.get(eventType) ?? [];
        existing.push(handler);
        this.routingMap.set(eventType, existing);
      }
    }
  }

  /**
   * Process a single job by routing it to the registered handler(s).
   *
   * This method is the core routing logic, intentionally separated from the
   * BullMQ Worker creation so it can be exercised directly in unit tests
   * without a real Redis connection.
   *
   * With P2-5 extensions (when registry is present):
   * 1. Determine the current schema version for this event type.
   * 2. If the event's schemaVersion is older, upcast the payload to current version.
   * 3. Validate the payload against the current schema.
   * 4. If validation fails, log a warning and skip — do NOT crash.
   * 5. Dispatch the (possibly upcasted) event to handlers.
   *
   * @param jobName  - The BullMQ job name (= event type, e.g. "PostPublished")
   * @param eventData - The IntegrationEvent DTO from job.data
   */
  async processJob(jobName: string, eventData: IntegrationEvent): Promise<void> {
    const handlers = this.routingMap.get(jobName) ?? [];

    if (handlers.length === 0) {
      // No handlers registered for this event type — skip silently.
      // This is intentional: unknown event types should not cause failures.
      return;
    }

    // P2-5: versioning — only when registry is configured
    if (this.schemaRegistry) {
      const currentVersion = this.schemaRegistry.getCurrentVersion(jobName);

      // If currentVersion is undefined, the event type is not in the registry.
      // Fall through to dispatch without validation (unknown/future event types).
      if (currentVersion !== undefined) {
        let effectiveEvent = eventData;

        // Upcast payload if needed
        if (this.upcasterChain && eventData.schemaVersion < currentVersion) {
          const upcastResult = this.upcasterChain.upcast(
            jobName,
            eventData.payload,
            eventData.schemaVersion,
            currentVersion
          );

          // Rebuild event with upcasted payload and updated version
          effectiveEvent = {
            ...eventData,
            payload: upcastResult.payload as Record<string, unknown>,
            schemaVersion: upcastResult.version,
          };
        }

        // Validate payload against the current schema
        const validationResult = this.schemaRegistry.validate(
          jobName,
          currentVersion,
          effectiveEvent.payload
        );

        if (!validationResult.ok) {
          // Log warning and skip — do NOT throw, do NOT crash handlers
          // In production this would write to a structured logger (pino).
          eventsLogger.warn(
            {
              jobName,
              eventId: effectiveEvent.eventId,
              schemaVersion: effectiveEvent.schemaVersion,
              errors: validationResult.errors,
            },
            "Schema validation failed for integration event"
          );
          return;
        }

        // Dispatch the (possibly upcasted + validated) event
        await Promise.all(handlers.map((h) => h.handle(effectiveEvent)));
        return;
      }
    }

    // Run all handlers in parallel — each handler is independently responsible
    // for its own error handling. A failure in one handler does NOT block others.
    await Promise.all(handlers.map((h) => h.handle(eventData)));
  }

  /**
   * Start consuming events from the "integration-events" queue.
   *
   * Creates a BullMQ Worker if one is not already running. Safe to call
   * multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.worker !== null) return;

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        await this.processJob(job.name, job.data as IntegrationEvent);
      },
      {
        connection: this.connection,
        concurrency: this.concurrency,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      }
    );

    // Attach error listener to prevent Node.js unhandled exception on worker errors.
    // Per BullMQ docs: without an error listener the worker may stop processing jobs.
    this.worker.on("error", (_err: Error) => {
      // In production this would write to a structured logger.
      // Errors here are connection/Redis errors — job-level errors are handled
      // by BullMQ's retry logic and do not surface via this event.
    });
  }

  /**
   * Stop consuming events gracefully.
   *
   * Waits for all in-flight jobs to complete before closing the BullMQ Worker.
   * After this call `isRunning` returns false and `start()` may be called again.
   */
  async stop(): Promise<void> {
    if (this.worker === null) return;

    await this.worker.close();
    this.worker = null;
  }

  /**
   * Whether the consumer is currently active and listening for jobs.
   */
  get isRunning(): boolean {
    return this.worker !== null;
  }

  /**
   * Read-only view of the routing map for introspection / debugging.
   * Returns event types with at least one registered handler.
   */
  get registeredEventTypes(): string[] {
    return Array.from(this.routingMap.keys());
  }
}
