/**
 * Test Utilities
 *
 * Shared utilities for integration and unit tests
 *
 * @file testUtils.ts
 * @description Shared helpers for suites that talk to a running API, including
 *              the registration of a tenant through the customer route and the
 *              fail-loud precondition for suites that also depend on a
 *              background consumer.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { PUBLISH_PIPELINE_QUEUES, QUEUE_NAMES } from "@adapters/queue-bullmq";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/**
 * The bound on one request a helper here sends to the API. Registration answers in about 50 ms
 * on the live stack, so 3 s only expires on an API that has stopped answering.
 */
const API_REQUEST_TIMEOUT_MS = 3_000;

/**
 * @description Asks the API's `/health` endpoint, with a 3 s bound, whether a server is answering
 *   at the base URL. A 429 counts as available: the server answered and only refused the request.
 * @returns `true` when `/health` answers 2xx or 429; `false` on any other status, a transport
 *   failure or the timeout.
 */
export async function checkApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
    // 429 counts as AVAILABLE: the API answered, it just refused this request.
    // The `/health` bucket is deliberately exhausted by the rate-limiting suite
    // in the batch that runs immediately before the live saga batch, so reading
    // 429 as "API down" makes the next suite's precondition go red naming a
    // cause that is not the cause.
    return response.ok || response.status === 429;
  } catch {
    return false;
  }
}

/**
 * @description Marks the calling node:test test as skipped when `checkApiAvailable` reports no
 *   API. It does not stop the test body: the caller returns after it when the API is missing.
 *   Usage in test: `await skipIfApiUnavailable(t);`
 * @param t - The node:test test context whose `skip()` is called.
 */
export async function skipIfApiUnavailable(t: any): Promise<void> {
  const available = await checkApiAvailable();
  if (!available) {
    t.skip("API not available - skipping integration test");
  }
}

/**
 * @description Returns the base URL the live suites send their requests to.
 * @returns `BASE_URL` from the environment, or `http://localhost:3000` when it is unset or empty.
 */
export function getBaseUrl(): string {
  return BASE_URL;
}

/** What a live suite asks customer registration for. */
export interface LiveTenantRequest {
  /** The address the account and its owner sign up with. */
  readonly email: string;
  /** The account's name. */
  readonly accountName: string;
}

/** The fields of the registered account a live suite reads. */
export interface LiveTenantAccount {
  /** The account's id. */
  readonly id: string;
  /** The account's project limit; every self-registered account starts on the BASIC tier's 1. */
  readonly maxProjects: number;
}

/** A tenant created through the customer registration route. */
export interface LiveTenant {
  /** The id of the account registration created. */
  readonly accountId: string;
  /** The account fields registration returned that a suite reads. */
  readonly account: LiveTenantAccount;
  /** The `Authorization` header value: the owner's access token registration issued. */
  readonly authorization: string;
}

/** The part of a registration answer a live suite reads. */
interface RegistrationAnswer {
  readonly account: LiveTenantAccount;
  readonly accessToken: string;
}

/**
 * @description Builds the body of `POST /auth/customer/register` for a live tenant, so a suite
 *   that asserts a refused registration sends exactly what a successful one would. It names no
 *   tier, as the public body does not, and each call carries its own random password, so no
 *   two tenants share a credential and none is written in a test file.
 * @param request - The address and account name to register.
 * @returns The registration body: the account, its owner's name and a fresh password.
 */
export function liveRegistrationBody(request: LiveTenantRequest): Record<string, string> {
  return {
    accountName: request.accountName,
    firstName: "Live",
    lastName: "Tenant",
    email: request.email,
    password: `live-${randomUUID()}`,
  };
}

/**
 * @description Reads the account fields a live suite uses and the access token out of a
 *   registration answer, checking the type of every field it returns.
 * @param body - The parsed JSON body of a registration response.
 * @returns The account and token, or null when the body is not a successful registration.
 */
function readRegistrationAnswer(body: unknown): RegistrationAnswer | null {
  if (typeof body !== "object" || body === null || !("data" in body)) return null;
  const data: unknown = body.data;
  if (typeof data !== "object" || data === null) return null;
  if (!("account" in data) || !("accessToken" in data)) return null;
  const { account, accessToken } = data;
  if (typeof accessToken !== "string" || typeof account !== "object" || account === null) {
    return null;
  }
  if (!("id" in account) || typeof account.id !== "string") return null;
  if (!("maxProjects" in account) || typeof account.maxProjects !== "number") return null;
  return { account: { id: account.id, maxProjects: account.maxProjects }, accessToken };
}

/**
 * @description Registers a tenant through `POST /auth/customer/register`, the one route that
 *   creates an account for a customer, and returns the account with the owner's access token
 *   registration issued. A suite that needs a tenant gets it the way a customer does, so the
 *   token carries the seeded OWNER role's grants rather than a hand-picked list.
 * @param request - The address and account name to register.
 * @returns The created account and the `Authorization` header its owner's token fills.
 * @throws Error naming the address when registration does not answer within
 *   `API_REQUEST_TIMEOUT_MS`, and naming the status and body when it does not answer 201 with an
 *   account and an access token.
 */
export async function registerLiveTenant(request: LiveTenantRequest): Promise<LiveTenant> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${BASE_URL}/auth/customer/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(liveRegistrationBody(request)),
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    });
    body = await response.json();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Registering the live tenant ${request.email} got no answer within ` +
          `${API_REQUEST_TIMEOUT_MS} ms from ${BASE_URL}.`,
        { cause: error }
      );
    }
    throw error;
  }
  const answer = readRegistrationAnswer(body);
  if (response.status !== 201 || answer === null) {
    throw new Error(
      `Registering the live tenant ${request.email} answered ${response.status}: ` +
        JSON.stringify(body)
    );
  }
  return {
    accountId: answer.account.id,
    account: answer.account,
    authorization: `Bearer ${answer.accessToken}`,
  };
}

/**
 * @description Returns the tenant a suite's setup registered, failing with a message that names
 *   the suite when the setup never did, so a case reads a setup failure rather than a TypeError.
 * @param tenant - The tenant the setup stored, or undefined when it registered none.
 * @param suite - The suite's name, for the message.
 * @returns The registered tenant.
 * @throws Error naming the suite when no tenant was registered.
 */
export function requireLiveTenant(tenant: LiveTenant | undefined, suite: string): LiveTenant {
  if (tenant === undefined) {
    throw new Error(
      `${suite}: the suite's setup registered no tenant, so this case has no account to act on; ` +
        `read the setup's failure above.`
    );
  }
  return tenant;
}

/**
 * Per-attempt budget for one consumer probe. Two attempts 500 ms apart keeps the
 * worst case at 4.5 s, inside the 5 s a suite's setup has to reach a verdict.
 */
export const PUBLISH_CONSUMER_PROBE_TIMEOUT_MS = 2_000;

/** Delay between the two attempts of an indeterminate probe. */
const PROBE_RETRY_DELAY_MS = 500;

/** Attempts per queue. The second exists only for the indeterminate classes. */
const PROBE_ATTEMPTS = 2;

/**
 * The health dependency name each pipeline queue is registered under on the API.
 *
 * A map rather than a convention on purpose: a queue added to
 * `PUBLISH_PIPELINE_QUEUES` with no entry here fails the precondition by name,
 * which is what makes "adding a queue to the publish pipeline adds a consumer
 * requirement" true rather than aspirational. Silently probing some other
 * queue's dependency would be worse than not probing at all.
 */
const QUEUE_HEALTH_DEPENDENCY: Readonly<Record<string, string>> = {
  [QUEUE_NAMES.PUBLISH]: "queue",
};

export interface ConsumerPreconditionResult {
  ok: boolean;
  /** Empty when `ok`. Otherwise the cause, stated as the cause. */
  message: string;
}

/** What one probe attempt observed. `retryable` marks the indeterminate classes. */
type ProbeOutcome =
  { kind: "attached"; consumers: number } | { kind: "failed"; message: string; retryable: boolean };

/** Reads one queue's consumer count from the API's dependency health endpoint. */
async function probeQueue(queueName: string): Promise<ProbeOutcome> {
  const dependency = QUEUE_HEALTH_DEPENDENCY[queueName];
  if (dependency === undefined) {
    return {
      kind: "failed",
      retryable: false,
      message:
        `The '${queueName}' queue is listed in PUBLISH_PIPELINE_QUEUES but this suite does ` +
        `not know which health dependency reports its consumers. Register a health checker ` +
        `for it on the API and add it to QUEUE_HEALTH_DEPENDENCY in tests/testUtils.ts — a ` +
        `pipeline queue whose consumer nobody can observe is exactly the gap this check exists for.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/health/dependency/${dependency}`, {
      signal: AbortSignal.timeout(PUBLISH_CONSUMER_PROBE_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    return {
      kind: "failed",
      retryable: true,
      message:
        `The API is unreachable at ${BASE_URL} (${error instanceof Error ? error.message : String(error)}). ` +
        `This says nothing about the workers — start the API first.`,
    };
  }

  if (response.status === 429) {
    return {
      kind: "failed",
      retryable: true,
      message:
        `The consumer probe was rate-limited (429) at ${BASE_URL}. The '/health' bucket is ` +
        `shared with the rate-limiting suite that deliberately exhausts it in the batch before ` +
        `this one, so this is a probe problem, not a consumer problem.`,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  const details = (body as { details?: Record<string, unknown> } | null)?.details;

  if (!response.ok || details === undefined) {
    const status = (body as { status?: string } | null)?.status ?? String(response.status);
    return {
      kind: "failed",
      retryable: true,
      message:
        `The '${queueName}' queue's state could not be read (dependency '${dependency}' reported ` +
        `'${status}' with no details). The broker or the health circuit breaker is the suspect. ` +
        `This is UNKNOWN, not zero — it does not mean nothing is consuming.`,
    };
  }

  if (!("consumers" in details)) {
    return {
      kind: "failed",
      retryable: false,
      message:
        `The API at ${BASE_URL} does not report a consumer count for the '${queueName}' queue. ` +
        `It is running a build from before queue health carried 'consumers'. Rebuild and restart it.`,
    };
  }

  const consumers = details.consumers;

  if (consumers === null) {
    return {
      kind: "failed",
      retryable: false,
      message:
        `The broker cannot answer its client registry (CLIENT LIST) for the '${queueName}' queue, ` +
        `so consumer presence is UNKNOWN — which is not the same as zero. Nothing here proves the ` +
        `workers are down, and nothing proves they are up.`,
    };
  }

  if (typeof consumers !== "number" || consumers <= 0) {
    return {
      kind: "failed",
      retryable: false,
      message:
        `No process is consuming the '${queueName}' queue (queue health reports ` +
        `consumers=${String(consumers)} at ${BASE_URL}). The saga's wait step will park until the ` +
        `30-minute horizon and every publish-now case will burn its full budget without ever ` +
        `reaching a terminal state. Start the workers: 'pnpm dev' (API + workers) or ` +
        `'pnpm dev:workers'. In CI this means the worker boot step did not run, or the worker ` +
        `exited — read its log.`,
    };
  }

  return { kind: "attached", consumers };
}

/** One queue, up to `PROBE_ATTEMPTS` attempts, retrying only the undecided classes. */
async function probeQueueWithRetry(queueName: string): Promise<ProbeOutcome> {
  let outcome = await probeQueue(queueName);
  for (let attempt = 1; attempt < PROBE_ATTEMPTS; attempt++) {
    if (outcome.kind === "attached" || !outcome.retryable) return outcome;
    // fixed-wait: poll-step — the pause between two probes of a live API, bounded by attempt count
    // rather than by a deadline: a deadline-bound `until` would drop the second attempt whenever the
    // first one spends its whole 2 s timeout, and the second attempt is the point of the retry.
    await new Promise<void>((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
    outcome = await probeQueue(queueName);
  }
  return outcome;
}

/**
 * @description Verifies that every queue the publish pipeline enqueues to has a consumer
 * attached, BEFORE a suite creates a fixture or starts a saga.
 *
 * Why it exists: without it, a missing consumer surfaces as three per-test
 * timeouts waiting for a terminal state, six minutes into the batch —
 * a symptom four inference steps from the cause. The verdict here is reached in
 * seconds and names the cause.
 *
 * What it does NOT prove, stated because a precondition that overclaims is worse
 * than none: it proves REGISTRATION, not throughput. A consumer whose processor
 * is wedged or paused still holds its registration, and the broker's registry can
 * lag a vanished process. It also says nothing about whether that consumer can
 * successfully publish — only that something is listening.
 *
 * @returns `{ ok: true }` when every pipeline queue has a consumer; otherwise
 *          `{ ok: false, message }` where the message states the cause it
 *          actually observed, never a guess at the most common one.
 */
export async function assertPublishConsumers(): Promise<ConsumerPreconditionResult> {
  // Concurrent: the queues share one 5-second verdict bound, so probing them in
  // sequence would let two slow answers exceed it on their own.
  const outcomes = await Promise.all(
    PUBLISH_PIPELINE_QUEUES.map((queueName) => probeQueueWithRetry(queueName))
  );

  const failures = outcomes
    .filter((outcome): outcome is Extract<ProbeOutcome, { kind: "failed" }> => {
      return outcome.kind === "failed";
    })
    .map((outcome) => outcome.message);

  if (failures.length > 0) {
    return { ok: false, message: failures.join("\n\n") };
  }

  return { ok: true, message: "" };
}
