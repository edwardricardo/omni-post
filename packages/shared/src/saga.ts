/**
 * Phase 2: Week 3-4 - Saga Pattern Implementation
 *
 * Saga pattern for orchestrating complex business workflows:
 * - Long-running business processes across multiple aggregates
 * - Compensating actions for rollback in case of failures
 * - Stateful workflow management with persistence
 * - Event-driven saga orchestration
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainEvent } from "./events";
import { Command } from "./cqrs";

/**
 * Saga State
 */
export type SagaStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "COMPENSATING"
  | "COMPENSATED";

/**
 * Saga Step Result
 */
export interface SagaStepResult {
  success: boolean;
  data?: unknown;
  error?: string;
  compensationData?: unknown;
}

/**
 * Saga Step Interface
 */
export interface SagaStep<TData = unknown, TCompensationData = unknown> {
  id: string;
  name: string;
  execute(sagaContext: SagaContext, data?: TData): Promise<SagaStepResult>;
  compensate?(
    sagaContext: SagaContext,
    compensationData?: TCompensationData
  ): Promise<SagaStepResult>;
}

/**
 * Saga Context - passed to each step
 */
export interface SagaContext {
  sagaId: string;
  correlationId: string;
  userId?: string;
  metadata: Record<string, unknown>;
  stepData: Record<string, unknown>;
  events: DomainEvent[];
}

/** Shape returned by executeCommand callbacks used in saga steps */
interface CommandResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/** Shape of the incoming postData payload passed to saga steps */
interface PostDataPayload {
  body?: string;
  channelIds?: string[];
  scheduledAt?: Date;
  [key: string]: unknown;
}

/** Shape of the execute data argument for steps that receive postData */
interface StepExecuteData {
  postData?: PostDataPayload;
  postId?: string;
  priority?: string;
  [key: string]: unknown;
}

// Step data shapes for cross-step communication
interface ValidateStepData {
  validatedData?: { channelIds: string[]; scheduledAt?: Date; [key: string]: unknown };
  [key: string]: unknown;
}

interface CreateStepData {
  postId?: string;
  version?: number;
  createdAt?: Date;
}

interface ScheduleStepData {
  jobIds?: string[];
  channelCount?: number;
  scheduledAt?: Date;
}

interface CompletionStepData {
  publishingComplete?: boolean;
  [key: string]: unknown;
}

interface StatusCompensationData {
  postId?: string;
  previousStatus?: string;
  newStatus?: string;
}

/**
 * Saga Definition
 */
export interface SagaDefinition {
  id: string;
  name: string;
  version: string;
  steps: SagaStep[];
  timeout?: number; // milliseconds
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    exponential: boolean;
  };
}

/**
 * Saga Instance - runtime state
 */
export interface SagaInstance {
  id: string;
  definitionId: string;
  status: SagaStatus;
  currentStep: number;
  context: SagaContext;
  stepResults: SagaStepResult[];
  compensationResults: SagaStepResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

/**
 * Saga Manager Interface
 */
export interface SagaManager {
  registerSaga(definition: SagaDefinition): void;
  startSaga(definitionId: string, context: Partial<SagaContext>): Promise<SagaInstance>;
  continueSaga(sagaId: string): Promise<SagaInstance>;
  compensateSaga(sagaId: string): Promise<SagaInstance>;
  getSaga(sagaId: string): Promise<SagaInstance | null>;
  handleEvent(event: DomainEvent): Promise<void>;
}

/**
 * Common Saga Steps for Post Management
 */

// Validation Step
export class ValidatePostDataStep implements SagaStep {
  readonly id = "validate-post-data";
  readonly name = "Validate Post Data";

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const postData = data?.postData;

      if (!postData?.body) {
        return {
          success: false,
          error: "Post body is required",
        };
      }

      if (!postData?.channelIds || postData.channelIds.length === 0) {
        return {
          success: false,
          error: "At least one channel must be selected",
        };
      }

      context.stepData[this.id] = {
        validatedData: postData,
        validatedAt: new Date(),
      };

      return {
        success: true,
        data: { validated: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Validation failed",
      };
    }
  }
}

// Create Post Step
export class CreatePostStep implements SagaStep {
  readonly id = "create-post";
  readonly name = "Create Post";

  constructor(private executeCommand: (command: Command) => Promise<unknown>) {}

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const validationData = context.stepData["validate-post-data"] as ValidateStepData | undefined;
      const postData = validationData?.validatedData || data?.postData;
      const aggregateId = data?.postId || `post-${Date.now()}`;

      const createCommand: Command = {
        id: `cmd-create-post-${Date.now()}`,
        type: "post.create",
        aggregateId,
        aggregateType: "Post",
        data: postData,
        metadata: {
          ...(context.userId && { userId: context.userId }),
          correlationId: context.correlationId,
          source: "PostPublishingSaga",
        },
        timestamp: new Date(),
      };

      const result = (await this.executeCommand(createCommand)) as CommandResult;

      if (!result.success) {
        return {
          success: false,
          ...(result.error !== undefined && { error: result.error }),
        };
      }

      context.stepData[this.id] = {
        postId: createCommand.aggregateId,
        version: result.data?.version || 1,
        createdAt: new Date(),
      };

      return {
        success: true,
        data: { postId: createCommand.aggregateId },
        compensationData: { postId: createCommand.aggregateId },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create post",
      };
    }
  }

  async compensate(context: SagaContext, compensationData?: unknown): Promise<SagaStepResult> {
    try {
      const compData = (compensationData || context.stepData[this.id]) as
        | CreateStepData
        | undefined;
      const postId = compData?.postId;

      if (!postId) {
        return { success: true }; // Nothing to compensate
      }

      const deleteCommand: Command = {
        id: `cmd-delete-post-${Date.now()}`,
        type: "post.delete",
        aggregateId: postId,
        aggregateType: "Post",
        data: { reason: "saga-compensation" },
        metadata: {
          ...(context.userId && { userId: context.userId }),
          correlationId: context.correlationId,
          source: "PostPublishingSaga:Compensation",
        },
        timestamp: new Date(),
      };

      await this.executeCommand(deleteCommand);

      return {
        success: true,
        data: { compensated: true, postId },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Compensation failed",
      };
    }
  }
}

// Schedule Publishing Jobs Step
export class SchedulePublishingJobsStep implements SagaStep {
  readonly id = "schedule-publishing-jobs";
  readonly name = "Schedule Publishing Jobs";

  constructor(
    private queueJob: (job: Record<string, unknown>) => Promise<string>,
    private cancelJob?: (jobId: string) => Promise<boolean>
  ) {}

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const postId = createData?.postId || data?.postId;

      if (!postId) {
        return {
          success: false,
          error: "Post ID not found from previous step",
        };
      }

      const validationData = context.stepData["validate-post-data"] as ValidateStepData | undefined;
      const resolved = validationData?.validatedData || data?.postData;
      const channelIds = resolved?.channelIds || [];
      const scheduledAt = resolved?.scheduledAt;

      const jobIds: string[] = [];

      for (const channelId of channelIds) {
        const jobId = await this.queueJob({
          type: "publish-post",
          postId,
          channelId,
          scheduledAt: scheduledAt || new Date(),
          priority: data?.priority || "NORMAL",
          sagaId: context.sagaId,
          correlationId: context.correlationId,
        });

        jobIds.push(jobId);
      }

      context.stepData[this.id] = {
        jobIds,
        channelCount: channelIds.length,
        scheduledAt: scheduledAt || new Date(),
      };

      return {
        success: true,
        data: { jobIds, channelCount: channelIds.length },
        compensationData: { jobIds },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to schedule publishing jobs",
      };
    }
  }

  async compensate(context: SagaContext, compensationData?: unknown): Promise<SagaStepResult> {
    try {
      const compData = (compensationData || context.stepData[this.id]) as
        | ScheduleStepData
        | undefined;
      const jobIds = compData?.jobIds;

      if (!jobIds || jobIds.length === 0) {
        return { success: true }; // Nothing to compensate
      }

      // Cancel queued jobs (best-effort)
      const cancelledJobs: string[] = [];
      for (const jobId of jobIds) {
        try {
          if (this.cancelJob) {
            const cancelled = await this.cancelJob(jobId);
            if (cancelled) cancelledJobs.push(jobId);
          } else {
            // No cancel function provided — log-only mode (backward compat)
            cancelledJobs.push(jobId);
          }
        } catch {
          // Job cancellation is best-effort; ignore failures for already-completed jobs
        }
      }

      return {
        success: true,
        data: { cancelledJobs, cancelledCount: cancelledJobs.length },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Job cancellation compensation failed",
      };
    }
  }
}

// Wait for Publishing Completion Step
export class WaitForPublishingCompletionStep implements SagaStep {
  readonly id = "wait-publishing-completion";
  readonly name = "Wait for Publishing Completion";

  constructor(
    private checkJobsStatus: (
      jobIds: string[]
    ) => Promise<{ completed: number; failed: number; pending: number }>
  ) {}

  async execute(context: SagaContext): Promise<SagaStepResult> {
    try {
      const schedulingData = context.stepData["schedule-publishing-jobs"] as
        | ScheduleStepData
        | undefined;
      if (!schedulingData) {
        return {
          success: false,
          error: "No scheduling data found from scheduling step",
        };
      }
      const { jobIds } = schedulingData;

      if (!jobIds || jobIds.length === 0) {
        return {
          success: false,
          error: "No jobs found from scheduling step",
        };
      }

      const status = await this.checkJobsStatus(jobIds);

      if (status.pending > 0) {
        // Still waiting for completion
        return {
          success: false,
          error: "Publishing jobs still in progress",
        };
      }

      context.stepData[this.id] = {
        totalJobs: jobIds.length,
        completed: status.completed,
        failed: status.failed,
        completedAt: new Date(),
      };

      if (status.failed > 0) {
        return {
          success: false,
          error: `${status.failed} out of ${jobIds.length} publishing jobs failed`,
        };
      }

      return {
        success: true,
        data: {
          publishingComplete: true,
          completedJobs: status.completed,
          totalJobs: jobIds.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check publishing status",
      };
    }
  }
}

// Update Post Status Step
export class UpdatePostStatusStep implements SagaStep {
  readonly id = "update-post-status";
  readonly name = "Update Post Status";

  constructor(private executeCommand: (command: Command) => Promise<unknown>) {}

  async execute(context: SagaContext, _data?: unknown): Promise<SagaStepResult> {
    try {
      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const completionData = context.stepData["wait-publishing-completion"] as
        | CompletionStepData
        | undefined;

      const postId = createData?.postId;
      const publishingSuccess = completionData?.publishingComplete;

      if (!postId) {
        return {
          success: false,
          error: "Post ID not found",
        };
      }

      const newStatus = publishingSuccess ? "PUBLISHED" : "FAILED";

      const updateCommand: Command = {
        id: `cmd-update-post-status-${Date.now()}`,
        type: "post.update",
        aggregateId: postId,
        aggregateType: "Post",
        data: {
          status: newStatus,
          ...(publishingSuccess && { publishedAt: new Date() }),
        },
        metadata: {
          ...(context.userId && { userId: context.userId }),
          correlationId: context.correlationId,
          source: "PostPublishingSaga",
        },
        timestamp: new Date(),
      };

      const result = (await this.executeCommand(updateCommand)) as CommandResult;

      if (!result.success) {
        return {
          success: false,
          ...(result.error !== undefined && { error: result.error }),
        };
      }

      context.stepData[this.id] = {
        previousStatus: "DRAFT", // Would get from previous step
        newStatus,
        updatedAt: new Date(),
      };

      return {
        success: true,
        data: { status: newStatus, postId },
        compensationData: { postId, previousStatus: "DRAFT", newStatus },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update post status",
      };
    }
  }

  async compensate(context: SagaContext, compensationData?: unknown): Promise<SagaStepResult> {
    try {
      const compData = (compensationData || context.stepData[this.id]) as
        | StatusCompensationData
        | undefined;
      const postId = compData?.postId;
      const previousStatus = compData?.previousStatus;

      if (!postId || !previousStatus) {
        return { success: true }; // Nothing to compensate
      }

      const revertCommand: Command = {
        id: `cmd-revert-post-status-${Date.now()}`,
        type: "post.update",
        aggregateId: postId,
        aggregateType: "Post",
        data: {
          status: previousStatus,
          publishedAt: null,
        },
        metadata: {
          ...(context.userId && { userId: context.userId }),
          correlationId: context.correlationId,
          source: "PostPublishingSaga:Compensation",
        },
        timestamp: new Date(),
      };

      await this.executeCommand(revertCommand);

      return {
        success: true,
        data: { revertedTo: previousStatus, postId },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Status revert compensation failed",
      };
    }
  }
}

/**
 * Pre-defined Saga Definitions
 */

/**
 * Post Publishing Saga - Complete workflow for publishing posts
 */
export function createPostPublishingSagaDefinition(
  executeCommand: (command: Command) => Promise<unknown>,
  queueJob: (job: Record<string, unknown>) => Promise<string>,
  checkJobsStatus: (
    jobIds: string[]
  ) => Promise<{ completed: number; failed: number; pending: number }>,
  cancelJob?: (jobId: string) => Promise<boolean>
): SagaDefinition {
  return {
    id: "post-publishing-saga",
    name: "Post Publishing Saga",
    version: "1.0.0",
    timeout: 30 * 60 * 1000, // 30 minutes
    retryPolicy: {
      maxRetries: 3,
      backoffMs: 5000,
      exponential: true,
    },
    steps: [
      new ValidatePostDataStep(),
      new CreatePostStep(executeCommand),
      new SchedulePublishingJobsStep(queueJob, cancelJob),
      new WaitForPublishingCompletionStep(checkJobsStatus),
      new UpdatePostStatusStep(executeCommand),
    ],
  };
}

/**
 * Saga Events
 */
export const SAGA_EVENTS = {
  SAGA_STARTED: "saga.started",
  SAGA_STEP_COMPLETED: "saga.step.completed",
  SAGA_STEP_FAILED: "saga.step.failed",
  SAGA_COMPLETED: "saga.completed",
  SAGA_FAILED: "saga.failed",
  SAGA_COMPENSATION_STARTED: "saga.compensation.started",
  SAGA_COMPENSATION_COMPLETED: "saga.compensation.completed",
  SAGA_COMPENSATION_FAILED: "saga.compensation.failed",
} as const;

/**
 * Saga Event Types
 */
export const SagaStartedEventSchema = z.object({
  sagaId: z.string(),
  definitionId: z.string(),
  correlationId: z.string(),
  userId: z.string().optional(),
  startedAt: z.date(),
  totalSteps: z.number(),
});

export type SagaStartedEvent = z.infer<typeof SagaStartedEventSchema>;

export const SagaStepCompletedEventSchema = z.object({
  sagaId: z.string(),
  stepId: z.string(),
  stepName: z.string(),
  stepIndex: z.number(),
  result: z.object({
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  }),
  completedAt: z.date(),
});

export type SagaStepCompletedEvent = z.infer<typeof SagaStepCompletedEventSchema>;

export const SagaCompletedEventSchema = z.object({
  sagaId: z.string(),
  definitionId: z.string(),
  correlationId: z.string(),
  status: z.enum(["COMPLETED", "FAILED", "COMPENSATED"]),
  completedAt: z.date(),
  duration: z.number(),
  stepsCompleted: z.number(),
  stepsFailed: z.number(),
});

export type SagaCompletedEvent = z.infer<typeof SagaCompletedEventSchema>;

/**
 * Utility functions
 */
export function createSagaId(definitionId: string): string {
  return `saga-${definitionId}-${randomUUID()}`;
}

export function createSagaContext(
  sagaId: string,
  correlationId: string,
  userId?: string,
  metadata: Record<string, unknown> = {}
): SagaContext {
  return {
    sagaId,
    correlationId,
    ...(userId && { userId }),
    metadata,
    stepData: {},
    events: [],
  };
}

export function calculateSagaTimeout(definition: SagaDefinition, stepIndex: number): number {
  const remainingSteps = definition.steps.length - stepIndex;
  const baseTimeout = definition.timeout || 30 * 60 * 1000; // 30 minutes default
  return Math.floor(baseTimeout * (remainingSteps / definition.steps.length));
}
