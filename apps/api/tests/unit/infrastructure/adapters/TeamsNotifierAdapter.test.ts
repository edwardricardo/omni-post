/**
 * @file TeamsNotifierAdapter.test.ts
 * @description Tests for TeamsNotifierAdapter. Mocks HttpClientPort to verify
 *   payload shape (Adaptive Card), URL passthrough, header forwarding, error
 *   mapping (TIMEOUT/NETWORK/BAD_RESPONSE → InvariantViolationError) y http>=400
 *   handling.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { TeamsNotifierAdapter } from "../../../../src/infrastructure/adapters/TeamsNotifierAdapter.js";
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
  metadata: { postId: "p-456", channel: "linkedin" },
};

const WEBHOOK = "https://outlook.office.com/webhook/abc/IncomingWebhook/xyz/123";

describe("TeamsNotifierAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts Adaptive Card payload to webhook URL on success", async () => {
    const { client, spy } = makeMockHttpClient(ok({ status: 200, headers: {}, body: "1" }));
    const adapter = new TeamsNotifierAdapter(client);

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

    const parsed = JSON.parse(body) as {
      type: string;
      attachments: Array<{ contentType: string; content: { type: string; version: string } }>;
    };
    expect(parsed.type).toBe("message");
    expect(parsed.attachments[0]?.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(parsed.attachments[0]?.content.type).toBe("AdaptiveCard");
  });

  it("returns InvariantViolationError on TIMEOUT", async () => {
    const { client } = makeMockHttpClient(err("TIMEOUT"));
    const adapter = new TeamsNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvariantViolationError);
      expect(result.error.message).toContain("timed out");
    }
  });

  it("returns InvariantViolationError on NETWORK error", async () => {
    const { client } = makeMockHttpClient(err("NETWORK"));
    const adapter = new TeamsNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("network error");
    }
  });

  it("returns InvariantViolationError on BAD_RESPONSE", async () => {
    const { client } = makeMockHttpClient(err("BAD_RESPONSE"));
    const adapter = new TeamsNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("bad response");
    }
  });

  it("returns InvariantViolationError when status>=400", async () => {
    const { client } = makeMockHttpClient(ok({ status: 401, headers: {}, body: "Unauthorized" }));
    const adapter = new TeamsNotifierAdapter(client);

    const result = await adapter.send(WEBHOOK, PAYLOAD);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("HTTP 401");
      expect(result.error.message).toContain("Unauthorized");
    }
  });

  it("includes Event + Project + metadata as facts in Adaptive Card", async () => {
    const { client, spy } = makeMockHttpClient(ok({ status: 200, headers: {}, body: "" }));
    const adapter = new TeamsNotifierAdapter(client);

    await adapter.send(WEBHOOK, PAYLOAD);

    const body = (spy.mock.calls[0] as [string, string])[1];
    const parsed = JSON.parse(body) as {
      attachments: Array<{
        content: { body: Array<{ type: string; facts?: Array<{ title: string; value: string }> }> };
      }>;
    };
    const factSet = parsed.attachments[0]?.content.body.find((b) => b.type === "FactSet");
    expect(factSet?.facts).toBeDefined();
    const factTitles = factSet?.facts?.map((f) => f.title);
    expect(factTitles).toContain("Event");
    expect(factTitles).toContain("Project");
    expect(factTitles).toContain("postId");
    expect(factTitles).toContain("channel");
  });
});
