/**
 * @file saga.ts
 * @description Canon-aligned Saga pattern (Richardson microservices.io + Azure
 *              Architecture Center). Steps are classified as compensable / pivot
 *              / retryable. The pivot step is the point of no return: pre-pivot
 *              steps MUST implement compensate(); post-pivot steps MUST be
 *              idempotent and rely on forward-recovery only. Definition-time
 *              shape is enforced by the SagaStep discriminated union and by the
 *              `defineSaga()` factory which requires explicit preCommit/pivot/
 *              postCommit segments — any saga that compiles is canon-by-construction.
 * @layer domain
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EventStoreEvent } from "./events.js";
import { Command } from "./cqrs.js";

// ============================================================================
// Saga state
// ============================================================================

/**
 * Saga lifecycle states. Sagas MUST eventually reach one of the three terminal
 * states (COMPLETED / FAILED / COMPENSATED) — infinite RUNNING is a canon
 * violation enforced by the timeout checker in SagaManagerLifecycle.
 */
export type SagaStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "COMPENSATING" | "COMPENSATED";

/**
 * Outcome of a single step execution or compensation.
 */
export interface SagaStepResult {
  success: boolean;
  data?: unknown;
  error?: string;
  compensationData?: unknown;
}

/**
 * Mutable saga context passed to every step. `stepData` carries cross-step
 * communication; `metadata` carries immutable saga inputs (mode, postData,
 * priority, etc.).
 */
export interface SagaContext {
  sagaId: string;
  correlationId: string;
  userId?: string;
  /**
   * Account that owns the saga. This is the tenant scope the engine persists
   * and rehydrates for detached work; `userId` stays the audit identity and is
   * never a substitute for it.
   */
  accountId?: string;
  metadata: Record<string, unknown>;
  stepData: Record<string, unknown>;
  events: EventStoreEvent[];
}

// ============================================================================
// Step classification
// ============================================================================

/**
 * Step classes:
 *
 * - "compensable" — pre-pivot step. MUST implement compensate(). Idempotent.
 *   On saga failure pre-pivot, compensable steps are walked in reverse order
 *   and their compensate() methods are invoked.
 *
 * - "pivot" — point of no return. NO compensate. If retries are exhausted,
 *   the saga transitions to FAILED but no rollback is attempted: the
 *   pivot's external side-effects (e.g., enqueued provider jobs that may
 *   already have published) cannot be canonically undone.
 *
 * - "retryable" — post-pivot step. NO compensate. Forward-recovery only.
 *   Idempotent by construction; retried until success or terminal failure.
 */
export type StepClass = "compensable" | "pivot" | "retryable";

// ============================================================================
// Countermeasures
// ============================================================================

/**
 * Semantic lock — application-level lock that prevents two concurrent sagas
 * from operating on the same aggregate. The acquireKey() defines the lock
 * scope (e.g., `post-publishing:${postId}`); the saga manager enforces that
 * no second saga may start while a lock is held. Released on saga terminal
 * state.
 */
export interface SemanticLock {
  acquireKey(ctx: SagaContext): string;
  ttlMs?: number;
}

/**
 * Reread check — confirms the aggregate state has not changed in a way that
 * invalidates the saga's plan. Returns { stillValid: false } when the pre-
 * conditions are no longer met; the saga then aborts the step (and may
 * compensate if pre-pivot).
 */
export interface RereadCheck {
  rereadBeforeUpdate(ctx: SagaContext): Promise<{ stillValid: boolean; reason?: string }>;
}

/**
 * Version check — Optimistic Concurrency Control via aggregate version.
 * Returns the version the saga step expects; the use case rejects the write
 * with a conflict error if the actual aggregate version differs (lost-update
 * prevention).
 */
export interface VersionCheck {
  expectedVersion(ctx: SagaContext): number | undefined;
}

/**
 * Optional countermeasures attached to a step. Activation order in
 * SagaManagerExecution: semanticLock → rereadCheck → versionCheck → execute.
 */
export interface StepCountermeasures {
  semanticLock?: SemanticLock;
  rereadCheck?: RereadCheck;
  versionCheck?: VersionCheck;
}

// ============================================================================
// SagaStep — discriminated union forces canon at the type level
// ============================================================================

interface BaseSagaStep<TData = unknown> {
  readonly id: string;
  readonly name: string;
  execute(ctx: SagaContext, data?: TData): Promise<SagaStepResult>;
  countermeasures?: StepCountermeasures;
}

/**
 * CompensableStep — pre-pivot step. The TS compiler requires `compensate()`;
 * any class implementing CompensableStep without compensate fails to compile.
 */
export interface CompensableStep<
  TData = unknown,
  TCompensationData = unknown,
> extends BaseSagaStep<TData> {
  readonly class: "compensable";
  compensate(ctx: SagaContext, compensationData?: TCompensationData): Promise<SagaStepResult>;
}

/**
 * PivotStep — point of no return. Has NO compensate method. After this step
 * commits, downstream failures trigger forward-recovery only (Azure §5).
 */
export interface PivotStep<TData = unknown> extends BaseSagaStep<TData> {
  readonly class: "pivot";
}

/**
 * RetryableStep — post-pivot step. Has NO compensate. Idempotent execution;
 * retried with backoff until success or terminal failure (Azure §8).
 */
export interface RetryableStep<TData = unknown> extends BaseSagaStep<TData> {
  readonly class: "retryable";
}

/**
 * Discriminated union of all valid step classes. The `class` field is the
 * discriminant; engine code switches on it instead of feature-detecting
 * compensate().
 */
export type SagaStep<TData = unknown, TCompensationData = unknown> =
  CompensableStep<TData, TCompensationData> | PivotStep<TData> | RetryableStep<TData>;

// ============================================================================
// SagaDefinition — pivotStepIndex obligatorio
// ============================================================================

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  exponential: boolean;
}

/**
 * SagaDefinition declares a complete saga workflow. `pivotStepIndex` is the
 * runtime invariant that ties step ordering to canon classification:
 *   - steps[0..pivotStepIndex-1] MUST be class "compensable"
 *   - steps[pivotStepIndex]      MUST be class "pivot"
 *   - steps[pivotStepIndex+1..n] MUST be class "retryable"
 *
 * The `defineSaga()` factory enforces this structurally — instances obtained
 * via that factory are canon-by-construction. Direct object literals
 * matching this interface bypass the structural check; prefer the factory.
 */
export interface SagaDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly steps: readonly SagaStep[];
  readonly pivotStepIndex: number;
  readonly timeout?: number;
  readonly retryPolicy?: RetryPolicy;
}

/**
 * Canonical factory for saga definitions. Forces the preCommit/pivot/
 * postCommit shape at the type system level — TS rejects passing a
 * PivotStep into preCommit (it must be CompensableStep), a RetryableStep
 * as pivot, etc. The resulting SagaDefinition has its pivotStepIndex
 * derived from preCommit.length, so the runtime invariant holds by
 * construction.
 *
 * @example
 *   const saga = defineSaga({
 *     id: "post-publishing-saga",
 *     name: "Post Publishing",
 *     version: "2.0.0",
 *     preCommit: [validateStep, createStep],
 *     pivot: scheduleStep,
 *     postCommit: [waitStep, updateStatusStep],
 *     timeout: 30 * 60 * 1000,
 *     retryPolicy: { maxRetries: 3, backoffMs: 5_000, exponential: true },
 *   });
 */
export function defineSaga(spec: {
  id: string;
  name: string;
  version: string;
  preCommit: CompensableStep[];
  pivot: PivotStep;
  postCommit: RetryableStep[];
  timeout?: number;
  retryPolicy?: RetryPolicy;
}): SagaDefinition {
  return {
    id: spec.id,
    name: spec.name,
    version: spec.version,
    steps: [...spec.preCommit, spec.pivot, ...spec.postCommit],
    pivotStepIndex: spec.preCommit.length,
    ...(spec.timeout !== undefined && { timeout: spec.timeout }),
    ...(spec.retryPolicy && { retryPolicy: spec.retryPolicy }),
  };
}

// ============================================================================
// Saga Instance & Manager
// ============================================================================

/**
 * Runtime state of a running or terminated saga. Persisted in Postgres
 * (SagaInstance table) and cached in Redis. `nextRetryAt` is the persistence
 * mechanism for retry scheduling — survives process restarts; the recovery
 * checker resumes due retries on boot.
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
  nextRetryAt?: Date;
}

export interface SagaManager {
  registerSaga(definition: SagaDefinition): void;
  startSaga(definitionId: string, context: Partial<SagaContext>): Promise<SagaInstance>;
  continueSaga(sagaId: string): Promise<SagaInstance>;
  compensateSaga(sagaId: string): Promise<SagaInstance>;
  getSaga(sagaId: string): Promise<SagaInstance | null>;
  handleEvent(event: EventStoreEvent): Promise<void>;
}

// ============================================================================
// Helpers (post-publishing-saga internals)
// ============================================================================

interface CommandResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

interface PostDataPayload {
  body?: string;
  channelIds?: string[];
  scheduledAt?: Date;
  postId?: string;
  [key: string]: unknown;
}

interface StepExecuteData {
  postData?: PostDataPayload;
  postId?: string;
  priority?: string;
  [key: string]: unknown;
}

/**
 * Saga mode discriminator. Drives which steps run end-to-end:
 *   - "draft":       Validate + Create only (skip schedule/wait/update via no-op pivot+retryable).
 *   - "schedule":    Validate + Create + Schedule jobs (worker publishes at scheduledAt).
 *   - "publish-now": All five steps run; saga waits for worker completion + finalizes status.
 */
export type SagaPostMode = "draft" | "schedule" | "publish-now";

function readMode(context: SagaContext): SagaPostMode {
  const raw = context.metadata.mode;
  if (raw === "draft" || raw === "schedule" || raw === "publish-now") {
    return raw;
  }
  return "publish-now";
}

function readPostData(context: SagaContext, data?: StepExecuteData): PostDataPayload | undefined {
  const fromMetadata = context.metadata.postData as PostDataPayload | undefined;
  return fromMetadata ?? data?.postData;
}

interface ValidateStepData {
  validatedData?: { channelIds: string[]; scheduledAt?: Date; [key: string]: unknown };
  [key: string]: unknown;
}

interface CreateStepData {
  postId?: string;
  version?: number;
  createdAt?: Date;
  initialStatus?: string;
  /** True when the saga reused an existing draft (postId provided by caller).
   * Compensation MUST NOT delete the post in that case. */
  skippedCreation?: boolean;
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

// ============================================================================
// Step implementations (canon-classified)
// ============================================================================

/**
 * ValidatePostDataStep — class: compensable.
 * Pure validation; no external state mutated, so compensate is a no-op. Kept
 * explicit so the canon classification is self-documenting and the saga
 * walker doesn't need to special-case missing compensations.
 */
export class ValidatePostDataStep implements CompensableStep<StepExecuteData> {
  readonly id = "validate-post-data";
  readonly name = "Validate Post Data";
  readonly class = "compensable" as const;

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const postData = readPostData(context, data);
      const mode = readMode(context);

      const operatesOnExisting = typeof postData?.postId === "string" && postData.postId.length > 0;

      if (operatesOnExisting && mode === "draft") {
        return { success: false, error: "postId is not valid for mode=draft" };
      }

      if (!operatesOnExisting && !postData?.body) {
        return { success: false, error: "Post body is required" };
      }

      if (mode === "schedule" || mode === "publish-now") {
        if (!postData?.channelIds || postData.channelIds.length === 0) {
          return { success: false, error: "At least one channel must be selected" };
        }
      }

      if (mode === "schedule" && !postData.scheduledAt) {
        return { success: false, error: "scheduledAt is required for scheduled publishing" };
      }

      context.stepData[this.id] = {
        validatedData: postData,
        validatedAt: new Date(),
      };

      return { success: true, data: { validated: true, mode } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Validation failed",
      };
    }
  }

  async compensate(): Promise<SagaStepResult> {
    // No external state mutated by validation.
    return { success: true };
  }
}

/**
 * CreatePostStep — class: compensable.
 * Creates a Post aggregate via post.create command. compensate() emits
 * post.delete on the created postId. Idempotency: when the saga reused
 * an existing draft (skippedCreation flag), compensate is a no-op so a
 * caller-owned post is never destroyed.
 */
export class CreatePostStep implements CompensableStep<StepExecuteData, CreateStepData> {
  readonly id = "create-post";
  readonly name = "Create Post";
  readonly class = "compensable" as const;
  /**
   * SemanticLock keyed by existing postId (when the saga operates on an
   * existing draft). New-post sagas mint a unique aggregate per saga so
   * they cannot conflict — the lock returns an empty key and the engine
   * skips acquisition for those.
   */
  readonly countermeasures: StepCountermeasures = {
    semanticLock: {
      acquireKey(ctx: SagaContext): string {
        const postData = ctx.metadata.postData as { postId?: string } | undefined;
        return postData?.postId ? `post-publishing:${postData.postId}` : "";
      },
    },
  };

  constructor(private executeCommand: (command: Command) => Promise<unknown>) {}

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const validationData = context.stepData["validate-post-data"] as ValidateStepData | undefined;
      const postData = validationData?.validatedData || readPostData(context, data);

      const existingPostId =
        typeof postData?.postId === "string" && postData.postId.length > 0 ? postData.postId : null;

      if (existingPostId !== null) {
        const initialStatus = "DRAFT";
        context.stepData[this.id] = {
          postId: existingPostId,
          createdAt: new Date(),
          initialStatus,
          skippedCreation: true,
        };
        return {
          success: true,
          data: { postId: existingPostId, initialStatus, skippedCreation: true },
        };
      }

      const aggregateId = data?.postId || `post-${Date.now()}`;

      const createCommand: Command = {
        id: `cmd-${context.sagaId}-${this.id}`,
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

      // The use case generates its own postId (PostId.generate()); the
      // aggregateId carried in the command was a placeholder. Always trust
      // the response — using createCommand.aggregateId here would carry a
      // phantom id that no other step (or repository) can resolve.
      const persistedPostId =
        typeof result.data?.postId === "string" ? result.data.postId : createCommand.aggregateId;
      const initialStatus = "DRAFT";

      context.stepData[this.id] = {
        postId: persistedPostId,
        version: typeof result.data?.version === "number" ? result.data.version : 0,
        createdAt: new Date(),
        initialStatus,
      };

      return {
        success: true,
        data: { postId: persistedPostId, initialStatus },
        compensationData: { postId: persistedPostId, initialStatus },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create post",
      };
    }
  }

  async compensate(
    context: SagaContext,
    compensationData?: CreateStepData
  ): Promise<SagaStepResult> {
    try {
      const compData =
        compensationData ?? (context.stepData[this.id] as CreateStepData | undefined);
      const postId = compData?.postId;

      if (!postId) {
        return { success: true };
      }

      // Idempotency: a reused-existing-draft (caller-owned) is never deleted.
      if (compData?.skippedCreation === true) {
        return { success: true, data: { skippedCompensation: true, postId } };
      }

      const deleteCommand: Command = {
        id: `cmd-${context.sagaId}-${this.id}-compensate`,
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

      return { success: true, data: { compensated: true, postId } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Compensation failed",
      };
    }
  }
}

/**
 * SchedulePublishingJobsStep — class: PIVOT (point of no return).
 *
 * Once publish jobs are enqueued in BullMQ, the workers may execute them
 * before any compensation could cancel them — the provider may already have
 * received the post (Azure §5: "after a pivot transaction succeeds,
 * compensable transactions are no longer relevant"). Therefore this step
 * has NO compensate(): rolling it back would create misleading semantics.
 *
 * Failure during enqueue (before any job is accepted by BullMQ) IS still
 * recoverable in practice — the engine retries the step within the saga's
 * retry policy. Once the engine moves past the retry budget, the saga
 * transitions to FAILED without compensation.
 *
 * For mode="draft", this step short-circuits with success (no jobs to
 * schedule) — the canon class remains "pivot" because the discriminant is
 * structural, not behavioral; the actual no-side-effect path makes the
 * pivot a no-op for that mode without changing the saga's classification.
 */
export class SchedulePublishingJobsStep implements PivotStep<StepExecuteData> {
  readonly id = "schedule-publishing-jobs";
  readonly name = "Schedule Publishing Jobs";
  readonly class = "pivot" as const;
  countermeasures?: StepCountermeasures;

  constructor(private queueJob: (job: Record<string, unknown>) => Promise<string>) {}

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const mode = readMode(context);

      if (mode === "draft") {
        context.stepData[this.id] = { jobIds: [], channelCount: 0 };
        return {
          success: true,
          data: { skipped: true, reason: "draft-mode", jobIds: [], channelCount: 0 },
        };
      }

      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const postId = createData?.postId || data?.postId;

      if (!postId) {
        return { success: false, error: "Post ID not found from previous step" };
      }

      const validationData = context.stepData["validate-post-data"] as ValidateStepData | undefined;
      const resolved = validationData?.validatedData || readPostData(context, data);
      const channelIds = resolved?.channelIds || [];
      const scheduledAt = mode === "publish-now" ? new Date() : resolved?.scheduledAt || new Date();
      const priority =
        (context.metadata.priority as string | undefined) || data?.priority || "NORMAL";

      // Thread the saga's tenant into each publish job so the worker scopes its
      // credential/channel lookups. `metadata.accountId` is populated at saga
      // start and this step is the ONLY producer of publish jobs, so it is the
      // last place with authoritative tenant knowledge.
      //
      // Fail CLOSED when it is missing: emitting a job without the field would
      // route a FRESH job onto the worker's deploy-compat owner fallback, which
      // exists only to drain jobs enqueued before the field existed. Omitting it
      // here would make that fallback unbounded and permanent — the opposite of
      // its stated removal condition — so the saga fails instead.
      const rawAccountId = context.metadata.accountId;
      if (typeof rawAccountId !== "string" || rawAccountId.length === 0) {
        return {
          success: false,
          error: "Saga metadata carries no accountId: refusing to enqueue an unscoped publish job",
        };
      }
      const accountId = rawAccountId;

      const jobIds: string[] = [];

      for (const channelId of channelIds) {
        const jobId = await this.queueJob({
          type: "publish-post",
          postId,
          channelId,
          scheduledAt,
          priority,
          accountId,
          sagaId: context.sagaId,
          correlationId: context.correlationId,
        });
        jobIds.push(jobId);
      }

      context.stepData[this.id] = { jobIds, channelCount: channelIds.length, scheduledAt };

      return {
        success: true,
        data: { jobIds, channelCount: channelIds.length },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to schedule publishing jobs",
      };
    }
  }
}

/**
 * WaitForPublishingCompletionStep — class: retryable.
 *
 * Polls / waits for worker job completion via Redis pub/sub event resumption.
 * Idempotent by construction (re-checking job status produces the same
 * answer). On pending state returns success:false to schedule a retry; the
 * worker's publish.job.completed event short-circuits the wait by triggering
 * SagaIntegration.handleEvent → executeSagaAsync.
 *
 * For mode="draft" / "schedule", short-circuits with success (no jobs to
 * wait on). The canon class remains "retryable" structurally.
 */
export class WaitForPublishingCompletionStep implements RetryableStep {
  readonly id = "wait-publishing-completion";
  readonly name = "Wait for Publishing Completion";
  readonly class = "retryable" as const;

  constructor(
    private checkJobsStatus: (
      jobIds: string[]
    ) => Promise<{ completed: number; failed: number; pending: number }>
  ) {}

  async execute(context: SagaContext): Promise<SagaStepResult> {
    try {
      const mode = readMode(context);

      if (mode === "draft" || mode === "schedule") {
        context.stepData[this.id] = {
          totalJobs: 0,
          completed: 0,
          failed: 0,
          completedAt: new Date(),
          publishingComplete: true,
        };
        return {
          success: true,
          data: {
            skipped: true,
            reason: `${mode}-mode`,
            publishingComplete: true,
            completedJobs: 0,
            totalJobs: 0,
          },
        };
      }

      const schedulingData = context.stepData["schedule-publishing-jobs"] as
        ScheduleStepData | undefined;
      if (!schedulingData) {
        return { success: false, error: "No scheduling data found from scheduling step" };
      }
      const { jobIds } = schedulingData;

      if (!jobIds || jobIds.length === 0) {
        return { success: false, error: "No jobs found from scheduling step" };
      }

      const status = await this.checkJobsStatus(jobIds);

      if (status.pending > 0) {
        return { success: false, error: "Publishing jobs still in progress" };
      }

      context.stepData[this.id] = {
        totalJobs: jobIds.length,
        completed: status.completed,
        failed: status.failed,
        completedAt: new Date(),
        // Surface for UpdatePostStatusStep — distinguishes the publish-now
        // success path (all jobs completed) from the partial-failure path so
        // the next step can promote to PUBLISHED vs mark FAILED.
        publishingComplete: status.failed === 0,
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

/**
 * UpdatePostStatusStep — class: retryable.
 *
 * Promotes Post.status to PUBLISHED (or FAILED) after worker completion.
 * Post-pivot: if this step fails after retries, the saga is FAILED but
 * cannot rollback (provider already received the post). Idempotent: the
 * use case accepts an `expectedVersion` for OCC and tolerates re-application
 * of the same status transition.
 *
 * For mode="draft" / "schedule", short-circuits with success (post already
 * left in DRAFT/SCHEDULED status by the create step).
 */
export class UpdatePostStatusStep implements RetryableStep {
  readonly id = "update-post-status";
  readonly name = "Update Post Status";
  readonly class = "retryable" as const;

  constructor(private executeCommand: (command: Command) => Promise<unknown>) {}

  async execute(context: SagaContext): Promise<SagaStepResult> {
    try {
      const mode = readMode(context);

      if (mode === "draft" || mode === "schedule") {
        return { success: true, data: { skipped: true, reason: `${mode}-mode` } };
      }

      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const completionData = context.stepData["wait-publishing-completion"] as
        CompletionStepData | undefined;

      const postId = createData?.postId;
      const publishingSuccess = completionData?.publishingComplete;

      if (!postId) {
        return { success: false, error: "Post ID not found" };
      }

      const newStatus = publishingSuccess ? "PUBLISHED" : "FAILED";

      // Pass createData.version as expectedVersion (Azure saga §15-20 OCC).
      // The use case rejects with CONFLICT when the persisted version has
      // advanced past this — meaning a concurrent writer mutated the post
      // between Create and UpdateStatus. This step is RetryableStep, so the
      // engine schedules a retry; the next attempt re-reads (via the
      // pivot's RereadCheck if still pre-pivot, or directly by the use case
      // load) and proceeds with the fresh version.
      const expectedVersion =
        typeof createData?.version === "number" ? createData.version : undefined;

      const updateCommand: Command = {
        id: `cmd-${context.sagaId}-${this.id}`,
        type: "post.update",
        aggregateId: postId,
        aggregateType: "Post",
        data: {
          status: newStatus,
          ...(publishingSuccess && { publishedAt: new Date() }),
          ...(expectedVersion !== undefined && { expectedVersion }),
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
        newStatus,
        updatedAt: new Date(),
      };

      return {
        success: true,
        data: { status: newStatus, postId },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update post status",
      };
    }
  }
}

// ============================================================================
// Saga factory — Post Publishing
// ============================================================================

/**
 * Post Publishing Saga — canon-aligned definition.
 *
 *   preCommit (compensable):  Validate → Create
 *   pivot:                    Schedule (jobs enqueued; provider may execute)
 *   postCommit (retryable):   Wait → UpdateStatus
 *
 * Pivot at index 2 (Schedule) reflects the "point of no return" canon: once
 * jobs are accepted by BullMQ, workers may dispatch them to the provider
 * before any saga-side compensation could fire.
 */
export function createPostPublishingSagaDefinition(
  executeCommand: (command: Command) => Promise<unknown>,
  queueJob: (job: Record<string, unknown>) => Promise<string>,
  checkJobsStatus: (
    jobIds: string[]
  ) => Promise<{ completed: number; failed: number; pending: number }>,
  /**
   * Optional reread implementation for the pivot step. Returns the current
   * Post.status (or null if missing). When provided, the pivot step gains a
   * RereadCheck countermeasure that aborts before enqueueing jobs if the
   * post is no longer DRAFT — closing the dirty-read window between Create
   * and Schedule (Azure §15-18).
   */
  getPostStatus?: (postId: string) => Promise<string | null>
): SagaDefinition {
  const scheduleStep = new SchedulePublishingJobsStep(queueJob);

  if (getPostStatus) {
    scheduleStep.countermeasures = {
      rereadCheck: {
        async rereadBeforeUpdate(
          ctx: SagaContext
        ): Promise<{ stillValid: boolean; reason?: string }> {
          const createData = ctx.stepData["create-post"] as CreateStepData | undefined;
          const postId = createData?.postId;
          if (!postId) {
            return { stillValid: false, reason: "no postId in stepData" };
          }
          const status = await getPostStatus(postId);
          if (status !== "DRAFT") {
            return {
              stillValid: false,
              reason: `Post.status is ${status ?? "missing"}, expected DRAFT`,
            };
          }
          return { stillValid: true };
        },
      },
    };
  }

  return defineSaga({
    id: "post-publishing-saga",
    name: "Post Publishing Saga",
    version: "2.0.0",
    timeout: 30 * 60 * 1000,
    retryPolicy: {
      maxRetries: 3,
      backoffMs: 5000,
      exponential: true,
    },
    preCommit: [new ValidatePostDataStep(), new CreatePostStep(executeCommand)],
    pivot: scheduleStep,
    postCommit: [
      new WaitForPublishingCompletionStep(checkJobsStatus),
      new UpdatePostStatusStep(executeCommand),
    ],
  });
}

// ============================================================================
// Saga events + utilities
// ============================================================================

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

export function createSagaId(definitionId: string): string {
  return `saga-${definitionId}-${randomUUID()}`;
}

export function createSagaContext(
  sagaId: string,
  correlationId: string,
  userId?: string,
  metadata: Record<string, unknown> = {},
  accountId?: string
): SagaContext {
  return {
    sagaId,
    correlationId,
    ...(userId && { userId }),
    ...(accountId && { accountId }),
    metadata,
    stepData: {},
    events: [],
  };
}

export function calculateSagaTimeout(definition: SagaDefinition, stepIndex: number): number {
  const remainingSteps = definition.steps.length - stepIndex;
  const baseTimeout = definition.timeout || 30 * 60 * 1000;
  return Math.floor(baseTimeout * (remainingSteps / definition.steps.length));
}
