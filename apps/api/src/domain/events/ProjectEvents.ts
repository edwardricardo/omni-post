/**
 * @file ProjectEvents.ts
 * @description Domain events emitted by the Project aggregate — crisis mode entry and exit notifications.
 * @layer domain
 */

import { BaseDomainEvent } from "./DomainEvent.js";

/**
 * Event emitted when a project enters crisis mode
 */
export class CrisisModeEntered extends BaseDomainEvent {
  readonly eventType = "CrisisModeEntered";
  readonly aggregateType = "Project";

  constructor(
    readonly aggregateId: string,
    readonly reason: string,
    readonly startedAt: Date
  ) {
    super(1);
  }

  toPayload(): Record<string, unknown> {
    return {
      projectId: this.aggregateId,
      reason: this.reason,
      startedAt: this.startedAt.toISOString(),
    };
  }
}

/**
 * Event emitted when a project exits crisis mode
 */
export class CrisisModeExited extends BaseDomainEvent {
  readonly eventType = "CrisisModeExited";
  readonly aggregateType = "Project";

  constructor(
    readonly aggregateId: string,
    readonly reason: string,
    readonly startedAt: Date,
    readonly endedAt: Date,
    readonly durationMs: number
  ) {
    super(1);
  }

  toPayload(): Record<string, unknown> {
    return {
      projectId: this.aggregateId,
      reason: this.reason,
      startedAt: this.startedAt.toISOString(),
      endedAt: this.endedAt.toISOString(),
      durationMs: this.durationMs,
    };
  }
}

/**
 * Union type for all project events
 */
export type ProjectEvent = CrisisModeEntered | CrisisModeExited;
