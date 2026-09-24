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
import { ok, err, type Result } from "./types.js";
import { Command, POST_COMMANDS } from "./cqrs.js";

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
 *
 * THREE states, because a step has three answers: it succeeded, it failed, or
 * it has not finished yet. A boolean models two, so a step that was still
 * waiting on external work reported it with the same value it uses for a
 * failure — and every consumer had to guess which meaning a falsy value
 * carried. The publish wait step guessed wrong on the engine's behalf: each
 * sibling channel's completion event spent one retry on a step that had not
 * failed, and a four-channel publish reached FAILED with every channel
 * published.
 *
 * The discriminator is `outcome`, so the compiler decides which fields exist:
 * a cause belongs only to `failed`, a reason only to `waiting`, and adding a
 * fourth state later is a compile-time obligation on every consumer rather
 * than a silent fall-through into the failure branch.
 *
 * **AUTHORING RULE — how a step CHOOSES between `waiting` and `failed`:**
 *
 *   `waiting` means the step BECOMES DECIDABLE BY ASKING AGAIN: nothing about
 *   it is wrong, external work simply has not finished. It costs NO retry
 *   budget, records no error on the saga and writes no audit event, so it is
 *   bounded only by the saga's timeout horizon — the engine re-asks on its poll
 *   cadence (`waitPollMs`, default 30 s) and on any event that advances the
 *   saga.
 *
 *   `failed` means the step CANNOT become decidable by asking again as things
 *   stand: a job that ended in error, data that was never recorded, a
 *   dependency that could not be read. It spends one retry, and when the budget
 *   runs out the saga compensates (pre-pivot) or fails (pivot and after).
 *
 *   "I could not observe the outside world" is therefore `failed`, never
 *   `waiting`: an unreadable dependency is not evidence that work is still in
 *   progress, and reporting it as waiting makes an outage byte-identical to
 *   healthy in-flight work.
 *
 * Compensations use the same contract, so a rollback that has not finished is
 * never recorded as one that failed. The walk treats a `waiting` compensation
 * as UNFINISHED — the row stays `COMPENSATING` for a resume, an operator
 * re-drive or the liveness horizon — never as a rollback that succeeded.
 */
export type SagaStepResult =
  | { outcome: "succeeded"; data?: unknown; compensationData?: unknown }
  | { outcome: "failed"; error: string; compensationData?: unknown }
  | { outcome: "waiting"; reason: string };

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
  /**
   * Account that owns the persisted row — the tenant column as the database
   * holds it. It is the AUTHORITATIVE source when the engine resolves which
   * tenant a detached saga belongs to: a row repaired by a data migration
   * carries the true account here and nowhere else, so an instance that drops
   * it can never be scoped again.
   */
  accountId?: string;
  context: SagaContext;
  stepResults: SagaStepResult[];
  compensationResults: SagaStepResult[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
  nextRetryAt?: Date;
  /**
   * Last write to the persisted row (`@updatedAt`), when the instance came from
   * one. OPTIONAL because an in-process instance has not been read back: a
   * freshly started saga carries no value here at all.
   *
   * It is the LIVENESS anchor of a compensating saga — the walk writes at its
   * transition and after every step — so the engine's compensation horizon is
   * measured from it. Absence therefore means "unknown", never "fresh": the
   * engine treats a missing value as SUSPICIOUS and re-reads the row rather
   * than judging the saga on a value it does not have.
   */
  updatedAt?: Date;
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
  /**
   * The channel identities the pivot actually enqueued, index-aligned with
   * `jobIds` and in the same order.
   *
   * Recorded because the wait step that runs later decides from the channels
   * that were SCHEDULED, not from a count: a count can only say how many
   * finished, never which ones, so an outcome naming fewer channels than were
   * scheduled would be indistinguishable from a complete one.
   */
  channelIds?: string[];
  channelCount?: number;
  scheduledAt?: Date;
}

/**
 * One channel's publication record, reduced to the facts the saga reads.
 *
 * A narrow view rather than the entity, for the reason the admission decision
 * uses one: a step has no business being able to reach for a field it did not
 * declare it reads. It is structural — this module is the lowest package in the
 * graph and the domain entity imports IT — so the composition root is what maps
 * a record onto this shape.
 */
export interface PublicationChannelView {
  readonly channelId: string;
  /**
   * Which settlement the record holds. THREE values, never two booleans: a
   * channel that has not settled is a different fact from one that settled
   * without publishing, and the wait step answers them with different outcomes.
   */
  readonly outcome: "unresolved" | "published" | "excluded";
  /** The provider's identifier, when it accepted the content and returned one. */
  readonly externalId?: string;
  /** The closed code an exclusion carries — the value a reader branches on. */
  readonly reasonCode?: string;
  /** The message beside the code, written for a person. */
  readonly reasonDetail?: string;
  /**
   * Whether the channel may be attempted again. Carried rather than derived
   * from `outcome`: it is the record's own predicate (a channel still holding
   * live fragments is not re-drivable even though it settled), and re-deriving
   * it here would be a second copy of a domain rule that can drift from the first.
   */
  readonly redrivable: boolean;
}

/** A post's per-channel publication record, as the saga reads it. */
export interface PublicationRecordView {
  readonly channels: readonly PublicationChannelView[];
}

/**
 * The post's publication record, as the saga is allowed to learn it.
 *
 * THREE answers, and each one is a different fact. `err` is "I could not read
 * the record" — an outage, which the wait step spends budget on rather than
 * mistaking for work still in flight. `ok(undefined)` is "this post carries no
 * record at all", which is never evidence that nothing published. `ok(view)` is
 * the record itself.
 */
export type PublicationRecordReader = (
  postId: string
) => Promise<Result<PublicationRecordView | undefined, string>>;

/**
 * What the wait step recorded once every scheduled channel settled.
 *
 * It holds the outcome in the shape the promotion command carries, so the
 * promotion is a forwarder rather than a second place that decides what a
 * record means.
 */
interface CompletionStepData {
  channels?: PublishChannelReport[];
  completedAt?: Date;
}

/** One channel's share of the publish outcome, as the record settled it. */
interface PublishChannelReport {
  channelId: string;
  success: boolean;
  externalId?: string;
  error?: string;
  reasonCode?: string;
}

/**
 * @function reportOf
 * @description Turns one settled record into the outcome entry the promotion
 *   forwards. Keys are omitted rather than assigned `undefined`, because under
 *   `exactOptionalPropertyTypes` those are different values and the command
 *   contract declares them optional.
 * @param view - A channel whose record has settled.
 * @returns The outcome entry for that channel.
 */
function reportOf(view: PublicationChannelView): PublishChannelReport {
  return {
    channelId: view.channelId,
    success: view.outcome === "published",
    ...(view.externalId !== undefined && { externalId: view.externalId }),
    ...(view.reasonDetail !== undefined && { error: view.reasonDetail }),
    ...(view.reasonCode !== undefined && { reasonCode: view.reasonCode }),
  };
}

/**
 * Reads the outcome the promotion forwards, or names the fact it could not
 * establish.
 *
 * It does NOT re-decide totality. The wait step settles only when every channel
 * the pivot scheduled carries a settled record, and re-stating that rule here
 * would be a second copy of it — free to drift from the one that runs. What is
 * checked is this step's OWN input: that an outcome was recorded at all, and
 * that it names at least one channel. A saga persisted before the wait step
 * recorded per-channel outcomes lands in the first branch.
 */
function readPublishOutcome(context: SagaContext): Result<PublishChannelReport[], string> {
  const completion = context.stepData["wait-publishing-completion"] as
    CompletionStepData | undefined;
  const channels = completion?.channels;

  if (!Array.isArray(channels)) {
    return err(
      "The wait step recorded no per-channel outcome: refusing to promote a publish nobody observed"
    );
  }

  if (channels.length === 0) {
    return err("The recorded outcome names zero channels: a vacuous outcome is not a publish");
  }

  return ok(channels);
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
        return { outcome: "failed", error: "postId is not valid for mode=draft" };
      }

      if (!operatesOnExisting && !postData?.body) {
        return { outcome: "failed", error: "Post body is required" };
      }

      if (mode === "schedule" || mode === "publish-now") {
        if (!postData?.channelIds || postData.channelIds.length === 0) {
          return { outcome: "failed", error: "At least one channel must be selected" };
        }
      }

      if (mode === "schedule" && !postData.scheduledAt) {
        return { outcome: "failed", error: "scheduledAt is required for scheduled publishing" };
      }

      context.stepData[this.id] = {
        validatedData: postData,
        validatedAt: new Date(),
      };

      return { outcome: "succeeded", data: { validated: true, mode } };
    } catch (error) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error.message : "Validation failed",
      };
    }
  }

  async compensate(): Promise<SagaStepResult> {
    // No external state mutated by validation.
    return { outcome: "succeeded" };
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
          outcome: "succeeded",
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
        // The command bus answers with its own boolean envelope; a failure with
        // no message still has to carry a cause, because the outcome's whole
        // point is that "failed" is never ambiguous.
        return {
          outcome: "failed",
          error: result.error ?? "Post creation was rejected",
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
        outcome: "succeeded",
        data: { postId: persistedPostId, initialStatus },
        compensationData: { postId: persistedPostId, initialStatus },
      };
    } catch (error) {
      return {
        outcome: "failed",
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
        return { outcome: "succeeded" };
      }

      // Idempotency: a reused-existing-draft (caller-owned) is never deleted.
      if (compData?.skippedCreation === true) {
        return { outcome: "succeeded", data: { skippedCompensation: true, postId } };
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

      return { outcome: "succeeded", data: { compensated: true, postId } };
    } catch (error) {
      return {
        outcome: "failed",
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

  constructor(
    private executeCommand: (command: Command) => Promise<unknown>,
    private queueJob: (job: Record<string, unknown>) => Promise<string>
  ) {}

  async execute(context: SagaContext, data?: StepExecuteData): Promise<SagaStepResult> {
    try {
      const mode = readMode(context);

      if (mode === "draft") {
        context.stepData[this.id] = { jobIds: [], channelIds: [], channelCount: 0 };
        return {
          outcome: "succeeded",
          data: { skipped: true, reason: "draft-mode", jobIds: [], channelCount: 0 },
        };
      }

      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const postId = createData?.postId || data?.postId;

      if (!postId) {
        return { outcome: "failed", error: "Post ID not found from previous step" };
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
      // Fail CLOSED when it is missing. The worker resolves no tenant of its own:
      // a job carrying no `accountId` is REFUSED outright and retired, so the
      // channel it names never publishes and never records why. Failing here says
      // so at the one place that still knows the tenant, instead of enqueuing work
      // that can only die unexplained.
      const rawAccountId = context.metadata.accountId;
      if (typeof rawAccountId !== "string" || rawAccountId.length === 0) {
        return {
          outcome: "failed",
          error: "Saga metadata carries no accountId: refusing to enqueue an unscoped publish job",
        };
      }
      const accountId = rawAccountId;

      // (a) The episode FIRST, and the order is the guarantee. Opening it is
      // what decides which of the named channels may be attempted at all — a
      // published one is never re-sent, one still holding live fragments is
      // refused by name — and it mints the ordinal every job id carries. An
      // enqueue that ran before it would be sending content the record had
      // already ruled out, past the point where anything can be undone.
      const opened = await this.openEpisode(context, postId, channelIds, mode);
      if (!opened.ok) {
        return { outcome: "failed", error: opened.error };
      }

      const jobIds: string[] = [];
      // The channels this step actually enqueued, appended in lockstep with
      // their job ids so index i of one names index i of the other. The wait
      // step reads THIS list rather than `channelCount`, because a count cannot
      // say which channels were scheduled and an outcome naming fewer would
      // read as complete.
      const enqueuedChannelIds: string[] = [];

      // (b) One job per OPENED channel, never per requested channel. Re-running
      // this loop after a partial enqueue re-runs (a) idempotently and BullMQ
      // dedupes the ids it already holds.
      for (const channel of opened.value) {
        const jobId = await this.queueJob({
          type: "publish-post",
          postId,
          channelId: channel.channelId,
          episode: channel.episode,
          scheduledAt,
          priority,
          accountId,
          sagaId: context.sagaId,
          correlationId: context.correlationId,
        });
        jobIds.push(jobId);
        enqueuedChannelIds.push(channel.channelId);
      }

      context.stepData[this.id] = {
        jobIds,
        channelIds: enqueuedChannelIds,
        channelCount: enqueuedChannelIds.length,
        scheduledAt,
      };

      return {
        outcome: "succeeded",
        data: { jobIds, channelCount: enqueuedChannelIds.length },
      };
    } catch (error) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error.message : "Failed to schedule publishing jobs",
      };
    }
  }

  /**
   * @method openEpisode
   * @description Issues the command that opens an attempt episode over the
   *   post's per-channel record and returns the channels it opened.
   * @param context - The saga context, for the deterministic command id.
   * @param postId - The post the episode is opened over.
   * @param channelIds - The channels this run names.
   * @param mode - Publish-now is the only mode that enters the publication family.
   * @returns The opened channels with their ordinals, or the refusal to report.
   */
  private async openEpisode(
    context: SagaContext,
    postId: string,
    channelIds: string[],
    mode: SagaPostMode
  ): Promise<Result<readonly OpenedEpisodeChannel[], string>> {
    if (channelIds.length === 0) {
      return err("The publish request names no channel: refusing to open a vacuous episode");
    }

    const command: Command = {
      id: `cmd-${context.sagaId}-${this.id}`,
      type: POST_COMMANDS.OPEN_PUBLICATION_EPISODE,
      aggregateId: postId,
      aggregateType: "Post",
      // `enterPublishing` has no default in the contract on purpose, so it is
      // stated here from the mode rather than omitted and inferred downstream.
      data: { channelIds, enterPublishing: mode === "publish-now" },
      metadata: {
        ...(context.userId && { userId: context.userId }),
        correlationId: context.correlationId,
        source: "PostPublishingSaga",
      },
      timestamp: new Date(),
    };

    const result = (await this.executeCommand(command)) as CommandResult;

    if (!result.success) {
      return err(result.error ?? "The publication episode was refused");
    }

    return readOpenedChannels(result.data);
  }
}

/** One channel an episode was opened for, and the ordinal it was opened at. */
interface OpenedEpisodeChannel {
  readonly channelId: string;
  readonly episode: number;
}

/**
 * @function readOpenedChannels
 * @description Reads the opened channels out of the command's answer, refusing
 *   any shape the pivot cannot enqueue from.
 *
 *   It parses rather than casts because the answer crosses the bus as
 *   `unknown`, and the two values it carries are exactly the two that mint the
 *   job id: a channel nothing opened and an ordinal of zero would each produce
 *   an id naming an episode that does not exist, which the worker then refuses
 *   after the pivot has already passed the point of no return.
 * @param data - The command result's payload.
 * @returns The opened channels, or the reason the answer is unusable.
 */
function readOpenedChannels(
  data: Record<string, unknown> | undefined
): Result<readonly OpenedEpisodeChannel[], string> {
  const raw = data?.opened;
  if (!Array.isArray(raw)) {
    return err("The publication episode answered with no opened channels");
  }

  const opened: OpenedEpisodeChannel[] = [];
  for (const entry of raw) {
    const candidate = entry as { channelId?: unknown; episode?: unknown };
    if (typeof candidate.channelId !== "string" || candidate.channelId.length === 0) {
      return err("The publication episode named a channel with no identity");
    }
    if (
      typeof candidate.episode !== "number" ||
      !Number.isInteger(candidate.episode) ||
      candidate.episode < 1
    ) {
      return err(
        `The publication episode opened channel ${candidate.channelId} at episode ${String(candidate.episode)}, which is not an attempt ordinal`
      );
    }
    opened.push({ channelId: candidate.channelId, episode: candidate.episode });
  }

  if (opened.length === 0) {
    return err("The publication episode opened no channel: there is nothing to enqueue");
  }

  return ok(opened);
}

/**
 * WaitForPublishingCompletionStep — class: retryable.
 *
 * Waits on the post's per-channel PUBLICATION RECORD, not on the queue. Job
 * state answers "did the job end", which is a different question from "what did
 * this channel do with this post": a worker that published and then died
 * between the send and its own bookkeeping leaves a failed job over live
 * content, and a job that ended cleanly after excluding a channel leaves a
 * completed job over nothing published. The record is the only place the second
 * question is answered, and it is the question the promotion needs.
 *
 * Idempotent by construction (re-reading the record produces the same answer).
 * While any scheduled channel is still UNRESOLVED it returns the waiting
 * outcome — "ask me again", which costs the saga no retry budget — and reserves
 * the failed outcome for a record it could not read, a post carrying none, and
 * a scheduled channel the record does not hold. A channel that settled WITHOUT
 * publishing is resolved: it is forwarded, not waited on. The worker's
 * publish.job.completed event short-circuits the wait by triggering
 * SagaIntegration.handleEvent → executeSagaAsync; the engine's own poll cadence
 * is the safety net for an event that never arrives.
 *
 * For mode="draft" / "schedule", short-circuits with success (nothing to wait
 * on). The canon class remains "retryable" structurally.
 */
export class WaitForPublishingCompletionStep implements RetryableStep {
  readonly id = "wait-publishing-completion";
  readonly name = "Wait for Publishing Completion";
  readonly class = "retryable" as const;

  constructor(private readPublicationRecord: PublicationRecordReader) {}

  async execute(context: SagaContext): Promise<SagaStepResult> {
    try {
      const mode = readMode(context);

      if (mode === "draft" || mode === "schedule") {
        context.stepData[this.id] = { channels: [], completedAt: new Date() };
        return {
          outcome: "succeeded",
          data: { skipped: true, reason: `${mode}-mode`, channelCount: 0 },
        };
      }

      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const postId = createData?.postId;
      if (!postId) {
        return { outcome: "failed", error: "Post ID not found from previous step" };
      }

      const scheduling = context.stepData["schedule-publishing-jobs"] as
        ScheduleStepData | undefined;
      const scheduled = scheduling?.channelIds;

      if (!Array.isArray(scheduled)) {
        // A real failure, not an unfinished wait: this step cannot become
        // decidable by asking again, because the data it needs was never
        // recorded. A saga persisted before the pivot recorded channel
        // identities lands here.
        return {
          outcome: "failed",
          error: "The scheduling step recorded no channel identities: nothing to wait on",
        };
      }

      if (scheduled.length === 0) {
        return { outcome: "failed", error: "The scheduling step enqueued zero channels" };
      }

      const observation = await this.readPublicationRecord(postId);

      if (!observation.ok) {
        // COULD NOT OBSERVE is not "nothing has finished yet". Reporting an
        // unreadable record as waiting would make an outage byte-identical to
        // four channels healthily publishing, and waiting spends no budget — so
        // the first external signal would be a timeout half an hour later
        // instead of a step failure the retry policy already bounds.
        return {
          outcome: "failed",
          error: `The post's publication record could not be read: ${observation.error}`,
        };
      }

      const record = observation.value;
      if (record === undefined) {
        // "No record" is not evidence of "never published". The pivot opened an
        // episode over a record before it enqueued anything, so a post that
        // carries none by the time the jobs run lost it, and the step refuses
        // rather than deciding an outcome over a set it cannot see.
        return {
          outcome: "failed",
          error: `Post ${postId} carries no publication record: refusing to decide an outcome nobody recorded`,
        };
      }

      const byChannel = new Map(record.channels.map((channel) => [channel.channelId, channel]));
      const missing: string[] = [];
      const unresolved: string[] = [];
      const channels: PublishChannelReport[] = [];

      for (const channelId of scheduled) {
        const view = byChannel.get(channelId);
        if (view === undefined) {
          missing.push(channelId);
          continue;
        }
        if (view.outcome === "unresolved") {
          unresolved.push(channelId);
          continue;
        }
        channels.push(reportOf(view));
      }

      // The missing record wins over the unfinished one: a channel the record
      // does not hold cannot become decidable by asking again, so answering
      // "waiting" for it would park the saga on its horizon over a fact nobody
      // is ever going to write.
      if (missing.length > 0) {
        return {
          outcome: "failed",
          error: `The publication record holds no entry for scheduled channel(s) ${missing.join(", ")}: refusing an outcome that does not account for every channel`,
        };
      }

      if (unresolved.length > 0) {
        // Not decided yet. Each sibling that settles re-enters this step —
        // which is why this outcome must never be an attempt against the retry
        // budget. Nothing is recorded, so a later failure cannot read a
        // half-filled outcome as the whole one.
        return {
          outcome: "waiting",
          reason: `Channel(s) ${unresolved.join(", ")} have not settled yet`,
        };
      }

      context.stepData[this.id] = { channels, completedAt: new Date() };

      return {
        outcome: "succeeded",
        data: { channelCount: channels.length },
      };
    } catch (error) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error.message : "Failed to read the publication record",
      };
    }
  }
}

/**
 * UpdatePostStatusStep — class: retryable.
 *
 * A THIN FORWARDER of the publish outcome, and nothing else. It chooses no
 * target status: it reports which channels the pivot scheduled and whether each
 * published, and the aggregate decides what that means. Choosing here is what
 * let a saga report COMPLETED over a row that never left DRAFT — the emitter
 * picked a status and sent it on a command whose handler did not honour it.
 *
 * It FORWARDS FAILURES. A channel that settled without publishing travels in
 * the same outcome as one that published, carrying the record's own code and
 * detail; deciding here that a partial publish is not worth reporting is what
 * left a half-published post parked on the saga's horizon with nobody told
 * which half went out.
 *
 * It still FAILS CLOSED over what it cannot establish: unless an outcome was
 * recorded and names at least one channel, no command is emitted at all and the
 * step reports the failed outcome naming the fact it could not establish. A
 * refusal that still emitted would hand the promotion an outcome nobody
 * vouched for.
 *
 * Post-pivot: if this step fails after retries, the saga is FAILED but cannot
 * roll back (the provider already received the post). Idempotent by
 * construction — the promotion answers an already-published post with success
 * and writes nothing — so a redelivered completion event never fails the saga.
 *
 * It forwards no `expectedVersion`. A create-time version never refreshes, so
 * seeding one made every retry of a still-editable DRAFT conflict; the
 * repository's in-transaction compare-and-swap, re-read on each attempt, is the
 * concurrency guard.
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
        return { outcome: "succeeded", data: { skipped: true, reason: `${mode}-mode` } };
      }

      const createData = context.stepData["create-post"] as CreateStepData | undefined;
      const postId = createData?.postId;

      if (!postId) {
        return { outcome: "failed", error: "Post ID not found" };
      }

      // A redundant restatement of the pivot's own guard (see the
      // `rawAccountId` check in the schedule step), and deliberately so: this
      // value does not scope the promotion — `runAsSagaTenant` establishes the
      // tenant context from the saga row before the step runs, and the command
      // below carries no account field. D1 requires every precondition of this
      // step to be checked against THIS step's inputs, so a context that
      // reached the post-pivot step without an account is refused here rather
      // than trusted because an earlier step would have caught it.
      const accountId = context.metadata.accountId;
      if (typeof accountId !== "string" || accountId.length === 0) {
        return {
          outcome: "failed",
          error: "Saga metadata carries no accountId: refusing to promote an unscoped post",
        };
      }

      const outcome = readPublishOutcome(context);
      if (!outcome.ok) {
        return { outcome: "failed", error: outcome.error };
      }

      const promoteCommand: Command = {
        id: `cmd-${context.sagaId}-${this.id}`,
        type: POST_COMMANDS.COMPLETE_PUBLISHING,
        aggregateId: postId,
        aggregateType: "Post",
        data: { outcome: { channels: outcome.value } },
        metadata: {
          ...(context.userId && { userId: context.userId }),
          correlationId: context.correlationId,
          source: "PostPublishingSaga",
        },
        timestamp: new Date(),
      };

      const result = (await this.executeCommand(promoteCommand)) as CommandResult;

      if (!result.success) {
        return {
          outcome: "failed",
          error: result.error ?? "The post publish promotion was rejected",
        };
      }

      context.stepData[this.id] = {
        promotedChannelCount: outcome.value.length,
        promotedAt: new Date(),
      };

      return {
        outcome: "succeeded",
        data: { postId, channelCount: outcome.value.length },
      };
    } catch (error) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error.message : "Failed to promote the published post",
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
 *   pivot:                    Schedule (episode opened, jobs enqueued)
 *   postCommit (retryable):   Wait → UpdateStatus
 *
 * Pivot at index 2 (Schedule) reflects the "point of no return" canon: once
 * jobs are accepted by BullMQ, workers may dispatch them to the provider
 * before any saga-side compensation could fire.
 */
export function createPostPublishingSagaDefinition(
  executeCommand: (command: Command) => Promise<unknown>,
  queueJob: (job: Record<string, unknown>) => Promise<string>,
  /**
   * Reads the post's per-channel publication record. REQUIRED, and no longer
   * optional as the status reread it replaces was: the wait step decides from
   * it, so a composition that stopped passing it would not silently lose the
   * pivot's countermeasure — it would not compile.
   */
  readPublicationRecord: PublicationRecordReader
): SagaDefinition {
  const scheduleStep = new SchedulePublishingJobsStep(executeCommand, queueJob);

  // Re-specified PER CHANNEL. The status comparison it replaces asked whether
  // the post was still DRAFT, which is the wrong question for a re-drive: a
  // FAILED post being published again is exactly the case this saga now serves,
  // and that check aborted it. What has to still hold before the pivot enqueues
  // is that every channel this run names can still be attempted — the dirty-read
  // window is a channel that published, or started holding live fragments,
  // between Create and Schedule (Azure §15-18).
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

        const observation = await readPublicationRecord(postId);
        if (!observation.ok) {
          return {
            stillValid: false,
            reason: `the publication record could not be read: ${observation.error}`,
          };
        }

        const record = observation.value;
        if (record === undefined) {
          // Nothing has been attempted on this post, so nothing can have moved
          // under the plan. The episode the pivot opens next is what declares
          // the targets.
          return { stillValid: true };
        }

        // A named channel the record does not hold is NOT blocked here: with
        // nothing live the episode replaces the recorded target set, so an
        // unrecorded channel is a channel the opener is about to declare. Only
        // a channel the record holds AND refuses to re-drive invalidates the plan.
        const byChannel = new Map(record.channels.map((channel) => [channel.channelId, channel]));
        const blocked = (readPostData(ctx)?.channelIds ?? []).filter((channelId) => {
          const view = byChannel.get(channelId);
          return view !== undefined && !view.redrivable;
        });

        if (blocked.length > 0) {
          return {
            stillValid: false,
            reason: `channel(s) ${blocked.join(", ")} can no longer be published again`,
          };
        }

        return { stillValid: true };
      },
    },
  };

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
      new WaitForPublishingCompletionStep(readPublicationRecord),
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
  // The audit record carries the same discriminator the engine branched on.
  // `waiting` is absent by construction: a step that has not finished writes
  // no step event at all, because one event per channel check is audit noise,
  // not audit history.
  result: z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("succeeded"), data: z.unknown().optional() }),
    z.object({ outcome: z.literal("failed"), error: z.string() }),
  ]),
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

/**
 * Inputs for a saga context. A parameter object rather than a positional list:
 * `accountId` (the tenant scope) and `userId` (the acting identity) are both
 * optional strings, so a positional signature let one silently take the other's
 * slot — the exact confusion that put a user id in the tenant column.
 */
export interface CreateSagaContextInput {
  sagaId: string;
  correlationId: string;
  /** Account that owns the saga — the tenant scope for every persisted row. */
  accountId?: string;
  /** Customer user that started the saga — audit identity, never a tenant. */
  userId?: string;
  metadata?: Record<string, unknown>;
}

export function createSagaContext(input: CreateSagaContextInput): SagaContext {
  return {
    sagaId: input.sagaId,
    correlationId: input.correlationId,
    ...(input.userId && { userId: input.userId }),
    ...(input.accountId && { accountId: input.accountId }),
    metadata: input.metadata ?? {},
    stepData: {},
    events: [],
  };
}

export function calculateSagaTimeout(definition: SagaDefinition, stepIndex: number): number {
  const remainingSteps = definition.steps.length - stepIndex;
  const baseTimeout = definition.timeout || 30 * 60 * 1000;
  return Math.floor(baseTimeout * (remainingSteps / definition.steps.length));
}
