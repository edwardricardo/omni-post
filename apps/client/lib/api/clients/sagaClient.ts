/**
 * @file sagaClient.ts
 * @description Saga domain client. Drives the customer post-publishing saga
 *              endpoint. The body's `mode` discriminator selects which saga
 *              steps actually run; the response carries a `sagaId` callers
 *              poll via `getSagaStatus` until reaching a terminal state.
 * @layer infrastructure
 */

import type { ApiResponse } from "../types";
import { request } from "./request";

export type SagaPostMode = "draft" | "schedule" | "publish-now";

export type SagaStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "COMPENSATING" | "COMPENSATED";

/**
 * Content fields used when the saga creates a NEW post. For schedule and
 * publish-now modes these are mutually exclusive with `postId` — the backend
 * Zod refinement enforces XOR (callers MUST provide one or the other).
 */
interface NewPostContent {
  locale: string;
  body: string;
  title?: string;
  tags?: string[];
  mediaIds?: string[];
}

export interface StartDraftSagaInput extends NewPostContent {
  mode: "draft";
  projectId: string;
}

/**
 * Schedule a post for future publication. `postId` selects an existing draft
 * (no content fields needed); omitting it requires content fields for a
 * brand-new post created by the saga.
 */
export interface StartScheduleSagaInput {
  mode: "schedule";
  projectId: string;
  postId?: string;
  locale?: string;
  body?: string;
  title?: string;
  tags?: string[];
  mediaIds?: string[];
  channelIds: string[];
  /** ISO 8601 datetime — backend rejects past timestamps. */
  scheduledAt: string;
}

/**
 * Publish a post immediately. Same XOR contract as `StartScheduleSagaInput`:
 * provide `postId` to publish an existing draft, or content fields for a new
 * post.
 */
export interface StartPublishNowSagaInput {
  mode: "publish-now";
  projectId: string;
  postId?: string;
  locale?: string;
  body?: string;
  title?: string;
  tags?: string[];
  mediaIds?: string[];
  channelIds: string[];
}

export type StartPostPublishingSagaInput =
  StartDraftSagaInput | StartScheduleSagaInput | StartPublishNowSagaInput;

export interface StartPostPublishingSagaResponse {
  sagaId: string;
  status: SagaStatus;
  mode: SagaPostMode;
  correlationId: string;
  startedAt: string;
}

export interface SagaStepResultView {
  stepIndex: number;
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface SagaStatusDetails {
  id: string;
  definitionId: string;
  status: SagaStatus;
  currentStep: number;
  /** Integer 0..100 reflecting completed / total steps. */
  progress: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
  stepResults: SagaStepResultView[];
}

/**
 * @class SagaClient
 * @description Client for the saga endpoints under `/sagas/post-publishing`.
 *              Stateless: each method builds a fresh request through the proxy.
 */
export class SagaClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * @method startPostPublishingSaga
   * @description Starts a post-publishing saga in one of three modes.
   * @param input - Discriminated union by `mode`
   * @returns The newly created saga descriptor (id + initial status)
   */
  async startPostPublishingSaga(
    input: StartPostPublishingSagaInput
  ): Promise<ApiResponse<StartPostPublishingSagaResponse>> {
    return request<ApiResponse<StartPostPublishingSagaResponse>>(
      this.baseUrl,
      "/sagas/post-publishing/start",
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  /**
   * @method getSagaStatus
   * @description Reads the current state of a saga the caller previously
   *              started. Backend authorises by matching the saga's
   *              `context.userId` against the requesting customer.
   * @param sagaId - Saga identifier returned by `startPostPublishingSaga`
   * @returns Current status, progress, step results
   */
  async getSagaStatus(sagaId: string): Promise<ApiResponse<SagaStatusDetails>> {
    return request<ApiResponse<SagaStatusDetails>>(this.baseUrl, `/sagas/${sagaId}`);
  }
}

export const SAGA_TERMINAL_STATUSES: ReadonlyArray<SagaStatus> = Object.freeze([
  "COMPLETED",
  "FAILED",
  "COMPENSATED",
]);

/**
 * Helper: start a saga and imperatively poll its status until a terminal
 * state. Used by mutation hooks that need to resolve with the post result
 * (auto-save flow, scheduling UI). Components that want a non-blocking
 * flow with progress UI should use the `useSagaStatus` hook instead.
 *
 * Throws when the saga ends in FAILED/COMPENSATED, or when the timeout
 * elapses. Returns the postId from the create-post step on COMPLETED so
 * callers can re-fetch the post.
 *
 * @param ops - The two saga operations from the API facade (start + status)
 * @param input - Discriminated union by `mode`
 * @param options - Polling tuning (defaults: 200ms interval, 60s timeout)
 */
export async function runSagaAndAwaitTerminal(
  ops: {
    start: (
      input: StartPostPublishingSagaInput
    ) => Promise<ApiResponse<StartPostPublishingSagaResponse>>;
    getStatus: (sagaId: string) => Promise<ApiResponse<SagaStatusDetails>>;
  },
  input: StartPostPublishingSagaInput,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<{ sagaId: string; postId: string; status: SagaStatusDetails }> {
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 60_000;

  const startResp = await ops.start(input);
  if (!startResp.ok || !startResp.data) {
    throw new Error("Failed to start saga");
  }
  const sagaId = startResp.data.sagaId;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    const statusResp = await ops.getStatus(sagaId);
    if (!statusResp.ok || !statusResp.data) continue;
    const status = statusResp.data;

    if (status.status === "COMPLETED") {
      // create-post is step index 1 (Validate=0, Create=1). The step's data
      // payload carries `postId` whether it created a new aggregate or reused
      // an existing one (skippedCreation case).
      const createStep = status.stepResults[1];
      const stepData = createStep?.data as { postId?: string } | undefined;
      const postId = stepData?.postId;
      if (typeof postId !== "string" || postId.length === 0) {
        throw new Error("Saga completed but no postId in step data");
      }
      return { sagaId, postId, status };
    }
    if (status.status === "FAILED" || status.status === "COMPENSATED") {
      throw new Error(status.error ?? `Saga ended in ${status.status}`);
    }
  }

  throw new Error(`Saga did not complete within ${timeoutMs}ms`);
}
