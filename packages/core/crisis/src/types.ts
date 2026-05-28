/**
 * @file types.ts
 * @description Type definitions for crisis mode use cases including EnterCrisisModeInput, ExitCrisisModeInput, CrisisStatusOutput, and the CrisisProjectRepository port.
 * @layer application
 */

import { type CrisisModeEntry } from "@core/domain/index.js";

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
      import("@core/domain/index.js").Project,
      import("@core/domain/index.js").EntityNotFoundError
    >
  >;
  save(
    project: import("@core/domain/index.js").Project
  ): Promise<import("@shared/types").Result<void, Error>>;
}
