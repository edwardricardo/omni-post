import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAnalyticsReadRepository } from "../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testChannelIds,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - Basic Operations", { concurrency: 1 }, () => {
  it("AnalyticsRepository instantiates successfully", () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    assert.ok(repo instanceof PrismaAnalyticsReadRepository, "Should create repository instance");
  });
});

describe("AnalyticsRepository - getByPostIds", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns analytics for given post IDs with relationships", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!, testPostIds[1]!]);

    assert.ok(Array.isArray(analytics), "Should return an array");
    assert.ok(analytics.length > 0, "Should return analytics records");

    analytics.forEach((record) => {
      assert.ok(record.post !== undefined, "Should include post relationship");
      assert.ok(record.channel, "Should include channel relationship");
    });
  });

  it("respects startDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      startDate: twoDaysAgo,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt >= twoDaysAgo, "All records should be after start date");
    });
  });

  it("respects endDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      endDate: yesterday,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt <= yesterday, "All records should be before end date");
    });
  });

  it("respects provider filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, {
      provider: "X",
    });

    assert.ok(analytics.length > 0, "Should return X analytics");
    analytics.forEach((record) => {
      assert.strictEqual(record.provider, "X", "All records should be from X provider");
    });
  });

  it("respects take option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, { take: 3 });

    assert.strictEqual(analytics.length, 3, "Should return exactly 3 records");
  });

  it("respects skip option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const allAnalytics = await repo.getByPostIds(testPostIds);
    const skippedAnalytics = await repo.getByPostIds(testPostIds, { skip: 2 });

    assert.ok(skippedAnalytics.length < allAnalytics.length, "Skipped results should be fewer");
  });

  it("orders by capturedAt desc by default", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds);

    for (let i = 0; i < analytics.length - 1; i++) {
      assert.ok(
        analytics[i]!.capturedAt >= analytics[i + 1]!.capturedAt,
        "Should be ordered by capturedAt descending"
      );
    }
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([]);

    assert.ok(Array.isArray(analytics), "Should return an array");
    assert.strictEqual(analytics.length, 0, "Should return empty array");
  });
});

describe("AnalyticsRepository - getByProjectId", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns all analytics for a project", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(projectId);

    assert.ok(Array.isArray(analytics), "Should return an array");
    assert.ok(analytics.length > 0, "Should return analytics records");
    assert.strictEqual(analytics.length, 10, "Should return all analytics for project");
  });

  it("respects date range filters", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByProjectId(projectId, {
      startDate: threeDaysAgo,
      endDate: yesterday,
    });

    analytics.forEach((record) => {
      assert.ok(
        record.capturedAt >= threeDaysAgo && record.capturedAt <= yesterday,
        "All records should be within date range"
      );
    });
  });

  it("respects provider filter", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(projectId, {
      provider: "INSTAGRAM",
    });

    assert.ok(analytics.length > 0, "Should return Instagram analytics");
    analytics.forEach((record) => {
      assert.strictEqual(record.provider, "INSTAGRAM", "All records should be from Instagram");
    });
  });

  it("returns empty array for non-existent project", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId("non-existent-project");

    assert.strictEqual(analytics.length, 0, "Should return empty array");
  });

  it("returns empty array for project with no posts", async () => {
    const { testAccountId } = await import("./AnalyticsRepository.test-helpers.js");
    const emptyProject = await prisma.project.create({
      data: {
        name: "Empty Project",
        accountId: testAccountId,
      },
    });

    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(emptyProject.id);

    assert.strictEqual(analytics.length, 0, "Should return empty array");

    await prisma.project.delete({ where: { id: emptyProject.id } });
  });
});

describe("AnalyticsRepository - getByChannelId", { concurrency: 1 }, () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns analytics for specific channel with post relationship", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId(testChannelIds[0]!);

    assert.ok(Array.isArray(analytics), "Should return an array");
    assert.ok(analytics.length > 0, "Should return analytics for channel");

    analytics.forEach((record) => {
      assert.strictEqual(
        record.channelId,
        testChannelIds[0],
        "All records should match channel ID"
      );
      assert.ok(record.post !== undefined, "Should include post relationship");
    });
  });

  it("filters analytics by date range", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByChannelId(testChannelIds[0]!, {
      startDate: oneDayAgo,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt >= oneDayAgo, "Should respect start date filter");
    });
  });

  it("returns empty array for non-existent channel", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId("non-existent-channel");

    assert.strictEqual(analytics.length, 0, "Should return empty array");
  });
});
