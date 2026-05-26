/**
 * @file SlackNotifierAdapter.test.ts
 * @description Tests for SlackNotifierAdapter. Mocks HttpClientPort to verify
 *   payload shape (Block Kit), URL passthrough, header forwarding, error
 *   mapping (TIMEOUT/NETWORK/BAD_RESPONSE → InvariantViolationError) y http>=400
 *   handling.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { SlackNotifierAdapter } from "../../../../src/infrastructure/adapters/SlackNotifierAdapter.js";
import type {
  HttpClientPort,
  HttpResponse,
  HttpError,
} from "@core/domain/repositories/HttpClientPort.js";
import { InvariantViolationError } from "@core/domain/errors/index.js";
import type { NotificationPayload } from "@core/domain/repositories/ExternalNotifierPort.js";

function makeMockHttpClient(postResult: Result<HttpResponse, HttpError>): {
  client: HttpClientPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () => postResult);
  const client: HttpClientPort = {
    post: spy as HttpClientPort["post"],
    get: vi.fn(),
    head: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return { client, spy };
}

const PAYLOAD: NotificationPayload = {
  event: "post.published",
  title: "Post published successfully",
  message: "Your scheduled post is now live.",
  projectId: "proj-123",
  metadata: { postId: "p-456", channel: "twitter" },
};

const WEBHOOK = "https://hooks.slack.com/services/T1/B2/abc";

describe("SlackNotifierAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts Block Kit payload to webhook URL on success", async () => {
    const { client, spy } = makeMockHttpClient(ok({ status: 200, headers: {}, body: "ok" }));
    const adapter = new SlackNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    const [url, body, options] = spy.mock.calls[0] as [
      string,
      string,
      { headers: Record<string, string>; timeoutMs: number },
    ];
    expect(url).toBe(WEBHOOK);
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.timeoutMs).toBe(10_000);

    const parsed = JSON.parse(body) as { blocks: unknown[] };
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("returns InvariantViolationError on TIMEOUT", async () => {
    const { client } = makeMockHttpClient(err("TIMEOUT"));
    const adapter = new SlackNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvariantViolationError);
      expect(result.error.message).toContain("timed out");
    }
  });

  it("returns InvariantViolationError on NETWORK error", async () => {
    const { client } = makeMockHttpClient(err("NETWORK"));
    const adapter = new SlackNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("network error");
    }
  });

  it("returns InvariantViolationError on BAD_RESPONSE", async () => {
    const { client } = makeMockHttpClient(err("BAD_RESPONSE"));
    const adapter = new SlackNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("bad response");
    }
  });

  it("returns InvariantViolationError when status>=400", async () => {
    const { client } = makeMockHttpClient(ok({ status: 403, headers: {}, body: "invalid_token" }));
    const adapter = new SlackNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("HTTP 403");
      expect(result.error.message).toContain("invalid_token");
    }
  });

  it("includes metadata fields when present in payload", async () => {
    const { client, spy } = makeMockHttpClient(ok({ status: 200, headers: {}, body: "" }));
    const adapter = new SlackNotifierAdapter(client);

    await adapter.send(WEBHOOK, PAYLOAD);

    const body = (spy.mock.calls[0] as [string, string])[1];
    const parsed = JSON.parse(body) as { blocks: Array<{ type: string; fields?: unknown[] }> };
    const sectionWithFields = parsed.blocks.find((b) => b.type === "section" && b.fields);
    expect(sectionWithFields).toBeDefined();
  });

  it("omits fields section when metadata is empty", async () => {
    const { client, spy } = makeMockHttpClient(ok({ status: 200, headers: {}, body: "" }));
    const adapter = new SlackNotifierAdapter(client);

    await adapter.send(WEBHOOK, { ...PAYLOAD, metadata: {} });

    const body = (spy.mock.calls[0] as [string, string])[1];
    const parsed = JSON.parse(body) as { blocks: Array<{ type: string; fields?: unknown[] }> };
    const sectionWithFields = parsed.blocks.find((b) => b.type === "section" && b.fields);
    expect(sectionWithFields).toBeUndefined();
  });
});
