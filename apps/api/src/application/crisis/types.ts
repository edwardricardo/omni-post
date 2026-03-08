/**
 * Application Layer - Crisis Mode Types
 *
 * Part of Sprint 19: Crisis Mode Feature
 * Defines DTOs for crisis mode use cases.
 */

import { type CrisisModeEntry } from "../../domain/index.js";

/**
 * Input for entering crisis mode
 */
export interface EnterCrisisModeInput {
  projectId: string;
  reason: string;
}

/**
 * Output after entering crisis mode
 */
export interface EnterCrisisModeOutput {
  projectId: string;
  isInCrisisMode: boolean;
  reason: string;
  startedAt: Date;
}

/**
 * Input for exiting crisis mode
 */
export interface ExitCrisisModeInput {
  projectId: string;
}

/**
 * Output after exiting crisis mode
 */
export interface ExitCrisisModeOutput {
  projectId: string;
  isInCrisisMode: boolean;
  duration: number; // Duration in milliseconds
}

/**
 * Input for getting crisis status
 */
export interface GetCrisisStatusInput {
  projectId: string;
}

/**
 * Output for crisis status
 */
export interface CrisisStatusOutput {
  projectId: string;
  isInCrisisMode: boolean;
  reason?: string;
  startedAt?: Date;
  durationMs?: number;
  history: CrisisModeEntry[];
}

/**
 * Minimal Project Repository interface for crisis operations
 */
export interface CrisisProjectRepository {
  findById(projectId: {
    value: string;
  }): Promise<
    import("@shared/types").Result<
      import("../../domain/index.js").Project,
      import("../../domain/index.js").EntityNotFoundError
    >
  >;
  save(
    project: import("../../domain/index.js").Project
  ): Promise<import("@shared/types").Result<void, Error>>;
}
