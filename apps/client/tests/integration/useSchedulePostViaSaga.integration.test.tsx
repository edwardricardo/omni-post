/**
 * @file useSchedulePostViaSaga.integration.test.tsx
 * @description Integration tests for the `useSchedulePostViaSaga` mutation hook
 *              (saga `mode="schedule"` with the existing postId). Verifies
 *              the wire shape (saga endpoint + ownership lookup), the
 *              optimistic cache flip, rollback on failure, and error
 *              propagation.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSchedulePostViaSaga } from "../../lib/hooks/useSchedulePostViaSaga";
import type { Post } from "../../lib/api/types";

const mockFetch = vi.fn();

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    projectId: "project-1",
    locale: "en",
    body: "hello",
    status: "DRAFT",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Sets up the three sequential responses every successful schedule mutation
 * triggers via the saga path:
 *   1. GET /posts/:id           → returns the existing draft (with projectId)
 *   2. POST /sagas/.../start    → returns sagaId
 *   3. GET /sagas/:sagaId       → returns COMPLETED status
 */
function mockSuccessfulSchedule(postId: string, projectId = "project-1", sagaId = "saga-1"): void {
  mockFetch
    .mockResolvedValueOnce(jsonResponse({ ok: true, data: makePost({ id: postId, projectId }) }))
    .mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { sagaId, status: "PENDING", mode: "schedule" } })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: sagaId,
          status: "COMPLETED",
          progress: 100,
          currentStep: 3,
          retryCount: 0,
          startedAt: new Date().toISOString(),
          stepResults: [
            { stepIndex: 0, outcome: "succeeded" },
            { stepIndex: 1, outcome: "succeeded", data: { postId } },
            { stepIndex: 2, outcome: "succeeded" },
          ],
        },
      })
    );
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("useSchedulePostViaSaga", () => {
  it("starts the post-publishing saga with mode=schedule and postId", async () => {
    mockSuccessfulSchedule("post-1");
    const client = makeClient();
    const { result } = renderHook(() => useSchedulePostViaSaga(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        postId: "post-1",
        scheduledFor: "2026-12-01T10:00:00.000Z",
        channelIds: ["chan-1", "chan-2"],
      });
    });

    // Three calls: post lookup, saga start, saga status (one COMPLETED tick).
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The saga start payload should carry mode=schedule, postId, channelIds, scheduledAt.
    const startCall = mockFetch.mock.calls.find(([url]) =>
      String(url).includes("/sagas/post-publishing/start")
    );
    expect(startCall).toBeTruthy();
    const startInit = startCall?.[1] as RequestInit;
    const startBody = JSON.parse(startInit.body as string);
    expect(startBody.mode).toBe("schedule");
    expect(startBody.postId).toBe("post-1");
    expect(startBody.channelIds).toEqual(["chan-1", "chan-2"]);
    expect(startBody.scheduledAt).toBe("2026-12-01T10:00:00.000Z");
  });

  it("optimistically flips the cached post to SCHEDULED before the request resolves", async () => {
    mockSuccessfulSchedule("post-7");
    const client = makeClient();
    const draft = makePost({ id: "post-7", status: "DRAFT" });
    client.setQueryData<Post>(["posts", "post-7"], draft);

    const { result } = renderHook(() => useSchedulePostViaSaga(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      result.current.mutate({
        postId: "post-7",
        scheduledFor: "2026-12-01T10:00:00.000Z",
        channelIds: ["chan-1"],
      });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Post>(["posts", "post-7"]);
      expect(cached?.status).toBe("SCHEDULED");
      expect(cached?.scheduledAt).toBe("2026-12-01T10:00:00.000Z");
    });
  });

  it("rolls back the cached post when the post lookup fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500));
    const client = makeClient();
    const draft = makePost({ id: "post-7", status: "DRAFT" });
    client.setQueryData<Post>(["posts", "post-7"], draft);

    const { result } = renderHook(() => useSchedulePostViaSaga(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          postId: "post-7",
          scheduledFor: "2026-12-01T10:00:00.000Z",
          channelIds: ["chan-1"],
        });
      } catch {
        // Expected — mutation rejects with the server error.
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Post>(["posts", "post-7"]);
    expect(cached?.status).toBe("DRAFT");
    expect(cached?.scheduledAt).toBeUndefined();
  });

  it("surfaces saga FAILED status as a mutation error", async () => {
    const failedStatus = jsonResponse({
      ok: true,
      data: {
        id: "saga-fail",
        status: "FAILED",
        error: "scheduledAt too soon",
        progress: 0,
        currentStep: 0,
        retryCount: 0,
        startedAt: new Date().toISOString(),
        stepResults: [],
      },
    });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: makePost({ id: "post-7" }) }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: { sagaId: "saga-fail", status: "PENDING", mode: "schedule" },
        })
      )
      // Default any further status polls to FAILED (helper polls until terminal).
      .mockResolvedValue(failedStatus);
    const client = makeClient();
    const { result } = renderHook(() => useSchedulePostViaSaga(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          postId: "post-7",
          scheduledFor: "2026-12-01T10:00:00.000Z",
          channelIds: ["chan-1"],
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("scheduledAt too soon");
  });
});
