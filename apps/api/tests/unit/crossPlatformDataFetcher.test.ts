/**
 * @file crossPlatformDataFetcher.test.ts
 * @description Behavior tests for the cross-platform analytics data fetchers after
 *              the prisma→DI refactor. Verifies analytics flow through the
 *              AnalyticsReadRepository port (with provider filtering preserved),
 *              and posts/channels flow through the ProjectQueryRepository port.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAnalyticsData,
  getPostsData,
  getChannelsData,
} from "../../src/analytics/crossPlatform/dataFetcher.js";
import type { CrossPlatformAnalyticsOptions } from "../../src/analytics/crossPlatform/types.js";
import type { AnalyticsReadRepositoryPort } from "../../src/domain/repositories/AnalyticsReadRepository.js";
import type { ProjectQueryRepositoryPort } from "../../src/domain/repositories/ProjectQueryRepository.js";

const start = new Date("2026-05-01T00:00:00Z");
const end = new Date("2026-06-01T00:00:00Z");

function makeOptions(
  overrides: Partial<CrossPlatformAnalyticsOptions> = {}
): CrossPlatformAnalyticsOptions {
  return {
    accountId: "acc-1",
    projectId: "proj-1",
    timeRange: "30d",
    ...overrides,
  };
}

describe("crossPlatform dataFetcher", () => {
  let analyticsRepo: { getByPostIds: ReturnType<typeof vi.fn> } & AnalyticsReadRepositoryPort;
  let projectRepo: {
    getPostIds: ReturnType<typeof vi.fn>;
    getByAccountId: ReturnType<typeof vi.fn>;
    getPostsWithContent: ReturnType<typeof vi.fn>;
    getChannelsByProject: ReturnType<typeof vi.fn>;
  } & ProjectQueryRepositoryPort;

  beforeEach(() => {
    analyticsRepo = {
      getByPostIds: vi.fn(),
    } as unknown as { getByPostIds: ReturnType<typeof vi.fn> } & AnalyticsReadRepositoryPort;
    projectRepo = {
      getPostIds: vi.fn(),
      getByAccountId: vi.fn(),
      getPostsWithContent: vi.fn(),
      getChannelsByProject: vi.fn(),
    } as unknown as typeof projectRepo;
  });

  it("getAnalyticsData fetches by scoped post ids with the capturedAt asc order", async () => {
    projectRepo.getPostIds.mockResolvedValue(["post-1", "post-2"]);
    analyticsRepo.getByPostIds.mockResolvedValue([
      { id: "a1", postId: "post-1", provider: "X", views: 1, likes: 0, comments: 0, shares: 0 },
    ]);

    const data = await getAnalyticsData(makeOptions(), start, end, analyticsRepo, projectRepo);

    expect(projectRepo.getPostIds).toHaveBeenCalledWith("proj-1");
    expect(analyticsRepo.getByPostIds).toHaveBeenCalledWith(["post-1", "post-2"], {
      startDate: start,
      endDate: end,
      orderBy: { capturedAt: "asc" },
    });
    expect(data).toHaveLength(1);
  });

  it("getAnalyticsData filters records to the requested providers", async () => {
    projectRepo.getPostIds.mockResolvedValue(["post-1"]);
    analyticsRepo.getByPostIds.mockResolvedValue([
      { id: "a1", postId: "post-1", provider: "X", views: 1, likes: 0, comments: 0, shares: 0 },
      {
        id: "a2",
        postId: "post-1",
        provider: "INSTAGRAM",
        views: 2,
        likes: 0,
        comments: 0,
        shares: 0,
      },
    ]);

    const data = await getAnalyticsData(
      makeOptions({ providers: ["X"] as never }),
      start,
      end,
      analyticsRepo,
      projectRepo
    );

    expect(data).toHaveLength(1);
    expect(data[0]?.provider).toBe("X");
  });

  it("getAnalyticsData spans all account projects when no projectId is set", async () => {
    projectRepo.getByAccountId.mockResolvedValue([{ id: "proj-1" }, { id: "proj-2" }]);
    projectRepo.getPostIds.mockResolvedValueOnce(["post-1"]).mockResolvedValueOnce(["post-2"]);
    analyticsRepo.getByPostIds.mockResolvedValue([]);

    await getAnalyticsData(
      makeOptions({ projectId: undefined }),
      start,
      end,
      analyticsRepo,
      projectRepo
    );

    expect(projectRepo.getByAccountId).toHaveBeenCalledWith("acc-1");
    expect(analyticsRepo.getByPostIds).toHaveBeenCalledWith(
      ["post-1", "post-2"],
      expect.anything()
    );
  });

  it("getPostsData filters posts by date and projects the latest content revision", async () => {
    projectRepo.getPostsWithContent.mockResolvedValue([
      {
        id: "post-1",
        createdAt: new Date("2026-05-15T00:00:00Z"),
        contents: [
          { body: "old", title: null, tags: [], createdAt: new Date("2026-05-10T00:00:00Z") },
          {
            body: "new",
            title: "T",
            tags: ["a"],
            createdAt: new Date("2026-05-14T00:00:00Z"),
          },
        ],
        media: [{ type: "image" }],
      },
      {
        id: "post-old",
        createdAt: new Date("2026-04-01T00:00:00Z"),
        contents: [],
        media: [],
      },
    ]);

    const posts = await getPostsData(makeOptions(), start, end, projectRepo);

    expect(posts).toHaveLength(1);
    expect(posts[0]?.id).toBe("post-1");
    expect(posts[0]?.contents?.[0]?.content).toBe("new");
    expect(posts[0]?.contents?.[0]?.title).toBe("T");
    expect(posts[0]?.media?.[0]?.type).toBe("image");
  });

  it("getChannelsData maps channel handle to name through the port", async () => {
    projectRepo.getChannelsByProject.mockResolvedValue([
      { id: "ch-1", provider: "X", handle: "@one" },
    ]);

    const channels = await getChannelsData(makeOptions(), projectRepo);

    expect(projectRepo.getChannelsByProject).toHaveBeenCalledWith("proj-1");
    expect(channels[0]).toEqual({ id: "ch-1", provider: "X", name: "@one" });
  });
});
