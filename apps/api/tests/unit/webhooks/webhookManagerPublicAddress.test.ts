/**
 * @file webhookManagerPublicAddress.test.ts
 * @description The address a webhook subscription names is built on `API_BASE_URL`: a
 *   subscription created with no URL stores `<API_BASE_URL>/webhooks/<provider>`, and the setup
 *   instructions name that address whatever URL the subscription stores. The manager is loaded
 *   under the real environment module, which refuses an environment without `API_BASE_URL`, so no
 *   subscription can be stored on an address nobody configured. Queues and workers are doubles; the
 *   database is the in-memory webhook fake.
 * @layer infrastructure
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";
import { makeWebhookPrismaFake } from "../helpers/webhookPrismaFake.js";
import { makeApiEnv, makePublicAddressEnv, withEnvironment } from "../helpers/publicAddressEnv.js";

// `env.ts` calls `process.loadEnvFile()` on import, which would add an env file's variables to the
// fixture; vi.hoisted installs the spy before any import of this file can load env.ts.
vi.hoisted(() => vi.spyOn(process, "loadEnvFile").mockImplementation(() => undefined));

vi.mock("../../../src/lib/logger.js", () => {
  const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  return { webhookLogger: { ...silent(), child: vi.fn(silent) } };
});

vi.mock("../../../src/webhooks/webhookHandler.js", () => ({
  UniversalWebhookHandler: class {
    processWebhook = vi.fn(async () => ({ success: true }));
  },
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn(async () => ({ id: "job-1" }));
    close = vi.fn(async () => undefined);
  },
  Worker: class {
    on = vi.fn();
    close = vi.fn(async () => undefined);
  },
}));

type WebhookManager = import("../../../src/webhooks/webhookManager.js").WebhookManager;
type SubscriptionRequest = Parameters<WebhookManager["createSubscription"]>[1];

const ACCOUNT_ID = "8a1f0c52-3d4e-4b6a-9c7d-0e2f1a3b4c5d";

/** A subscription request; it names no URL of its own unless an override gives one. */
function makeSubscriptionRequest(
  overrides: Partial<SubscriptionRequest> = {}
): SubscriptionRequest {
  return { provider: "YOUTUBE", eventTypes: ["VIDEO_PROCESSED"], ...overrides };
}

/** The webhook manager module, loaded under `environment`. */
function loadManagerModule(environment: Record<string, string | undefined>) {
  return withEnvironment(environment, () => import("../../../src/webhooks/webhookManager.js"));
}

let manager: WebhookManager | undefined;

/** A manager over a fresh in-memory database, loaded under an environment the schema accepts. */
async function makeManager() {
  const { WebhookManager } = await loadManagerModule(makeApiEnv());
  const database = makeWebhookPrismaFake();
  manager = new WebhookManager(database.prisma, {} as unknown as Redis);
  return { manager, stored: () => database.stores.webhookSubscription.all() };
}

describe("the address a webhook subscription names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await manager?.shutdown();
    manager = undefined;
  });

  it("is built on API_BASE_URL when the subscription names none, in the row and in the answer", async () => {
    const { manager, stored } = await makeManager();
    const expected = `${makePublicAddressEnv().API_BASE_URL}/webhooks/youtube`;

    const subscription = await manager.createSubscription(ACCOUNT_ID, makeSubscriptionRequest());

    expect(stored().map((row) => row.webhookUrl)).toEqual([expected]);
    expect(subscription.webhookUrl).toBe(expected);
    expect(subscription.setupInstructions.webhookUrl).toBe(expected);
  });

  it("stays the subscription's own URL when it names one, while the setup steps name API_BASE_URL", async () => {
    const { manager, stored } = await makeManager();
    const own = "https://receiver.example.test/hooks/facebook";
    const expected = `${makePublicAddressEnv().API_BASE_URL}/webhooks/facebook`;

    const subscription = await manager.createSubscription(
      ACCOUNT_ID,
      makeSubscriptionRequest({
        provider: "FACEBOOK",
        eventTypes: ["POST_PUBLISHED"],
        webhookUrl: own,
      })
    );

    expect(stored().map((row) => row.webhookUrl)).toEqual([own]);
    expect(subscription.setupInstructions.webhookUrl).toBe(expected);
    expect(subscription.setupInstructions.steps).toContain(`Set webhook URL: ${expected}`);
  });

  it("cannot be built at all without API_BASE_URL: the manager's module refuses to load", async () => {
    await expect(loadManagerModule(makeApiEnv({ API_BASE_URL: undefined }))).rejects.toMatchObject({
      code: "ENV_VARIABLES_REFUSED",
      params: { variables: ["API_BASE_URL"] },
    });
  });
});
