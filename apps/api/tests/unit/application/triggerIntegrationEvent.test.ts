/**
 * @file triggerIntegrationEvent.test.ts
 * @description Tests for `TriggerIntegrationEventService` after the
 *   HttpClientPort refactor. Verifies the service uses the port (not raw
 *   fetch), serialises payloads consistently, filters by platform, and
 *   stays fire-and-forget on individual delivery errors.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ok, err, type Result } from "@shared/types";
import { TriggerIntegrationEventService } from "@core/application/integrations/TriggerIntegrationEventService.js";
import type {
  HttpClientPort,
  HttpResponse,
  HttpError,
} from "@core/domain/repositories/HttpClientPort.js";

function createMockHttpClient(
  override?: () => Promise<Result<HttpResponse, HttpError>>
): HttpClientPort {
  return {
    post: vi.fn(async () => (override ? override() : ok({ status: 204, headers: {} }))),
  };
}

function createMockRepository(subs: Array<{ id: string; targetUrl: string }>) {
  return {
    findActiveByEvent: vi.fn(async () => subs),
    findActiveByEventAndPlatform: vi.fn(async () => subs),
  } as unknown as import("@core/domain/repositories/IntegrationSubscriptionRepository.js").IntegrationSubscriptionRepository;
}

describe("TriggerIntegrationEventService", () => {
  let httpClient: HttpClientPort;

  beforeEach(() => {
    httpClient = createMockHttpClient();
  });

  it("invokes httpClient.post for each active subscription", async () => {
    const repo = createMockRepository([
      { id: "s1", targetUrl: "https://hook1" },
      { id: "s2", targetUrl: "https://hook2" },
    ]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await service.fire("post.published", { postId: "p1" });

    expect((httpClient.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    const [url1] = (httpClient.post as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const [url2] = (httpClient.post as ReturnType<typeof vi.fn>).mock.calls[1] ?? [];
    expect(url1).toBe("https://hook1");
    expect(url2).toBe("https://hook2");
  });

  it("serialises payload with event, data, and firedAt", async () => {
    const repo = createMockRepository([{ id: "s1", targetUrl: "https://hook1" }]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await service.fire("post.published", { postId: "p1" });

    const [, body] = (httpClient.post as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const parsed = JSON.parse(body as string);
    expect(parsed.event).toBe("post.published");
    expect(parsed.data).toEqual({ postId: "p1" });
    expect(typeof parsed.firedAt).toBe("string");
  });

  it("does not invoke httpClient when there are no subscriptions", async () => {
    const repo = createMockRepository([]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await service.fire("post.published", { postId: "p1" });
    expect((httpClient.post as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("swallows individual delivery errors (fire-and-forget)", async () => {
    httpClient = createMockHttpClient(async () => err("NETWORK"));
    const repo = createMockRepository([{ id: "s1", targetUrl: "https://hook1" }]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await expect(service.fire("post.published", { postId: "p1" })).resolves.toBeUndefined();
  });

  it("uses platform-specific repository method when platform is provided", async () => {
    const repo = createMockRepository([{ id: "s1", targetUrl: "https://hook1" }]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await service.fire("post.published", { postId: "p1" }, "ZAPIER");

    expect((repo.findActiveByEventAndPlatform as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      1
    );
    expect((repo.findActiveByEvent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("passes timeoutMs=10000 to the httpClient", async () => {
    const repo = createMockRepository([{ id: "s1", targetUrl: "https://hook1" }]);
    const service = new TriggerIntegrationEventService(repo, httpClient);

    await service.fire("post.published", { postId: "p1" });

    const [, , options] = (httpClient.post as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect((options as { timeoutMs: number }).timeoutMs).toBe(10_000);
  });
});
