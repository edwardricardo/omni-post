/**
 * @file AnalyticsRepository.basic.test.ts
 * @description Tests for AnalyticsRepository - Basic Operations
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaAnalyticsReadRepository } from "../../../src/infrastructure/repositories/PrismaAnalyticsReadRepository.js";
import { prisma } from "@infra/prisma";
import {
  setupTestData,
  teardownTestData,
  testPostIds,
  testChannelIds,
} from "./AnalyticsRepository.test-helpers.js";

describe("AnalyticsRepository - Basic Operations", () => {
  it("AnalyticsRepository instantiates successfully", () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    assert.ok(repo instanceof PrismaAnalyticsReadRepository);
  });
});

describe("AnalyticsRepository - getByPostIds", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns analytics for given post IDs with relationships", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([testPostIds[0]!, testPostIds[1]!]);

    assert.ok(Array.isArray(analytics));
    assert.ok(analytics.length > 0);

    analytics.forEach((record) => {
      assert.ok(record.post !== undefined);
      assert.ok(record.channel);
    });
  });

  it("respects startDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      startDate: twoDaysAgo,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt >= twoDaysAgo);
    });
  });

  it("respects endDate filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByPostIds(testPostIds, {
      endDate: yesterday,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt <= yesterday);
    });
  });

  it("respects provider filter", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, {
      provider: "X",
    });

    assert.ok(analytics.length > 0);
    analytics.forEach((record) => {
      assert.equal(record.provider, "X");
    });
  });

  it("respects take option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds, { take: 3 });

    assert.equal(analytics.length, 3);
  });

  it("respects skip option for pagination", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const allAnalytics = await repo.getByPostIds(testPostIds);
    const skippedAnalytics = await repo.getByPostIds(testPostIds, { skip: 2 });

    assert.ok(skippedAnalytics.length < allAnalytics.length);
  });

  it("orders by capturedAt desc by default", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds(testPostIds);

    for (let i = 0; i < analytics.length - 1; i++) {
      assert.ok(analytics[i]!.capturedAt >= analytics[i + 1]!.capturedAt);
    }
  });

  it("returns empty array for empty post IDs", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByPostIds([]);

    assert.ok(Array.isArray(analytics));
    assert.equal(analytics.length, 0);
  });
});

describe("AnalyticsRepository - getByProjectId", () => {
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

    assert.ok(Array.isArray(analytics));
    assert.ok(analytics.length > 0);
    assert.equal(analytics.length, 10);
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
      assert.ok(record.capturedAt >= threeDaysAgo && record.capturedAt <= yesterday);
    });
  });

  it("respects provider filter", async () => {
    const { testProjectId: projectId } = await import("./AnalyticsRepository.test-helpers.js");
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId(projectId, {
      provider: "INSTAGRAM",
    });

    assert.ok(analytics.length > 0);
    analytics.forEach((record) => {
      assert.equal(record.provider, "INSTAGRAM");
    });
  });

  it("returns empty array for non-existent project", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByProjectId("non-existent-project");

    assert.equal(analytics.length, 0);
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

    assert.equal(analytics.length, 0);

    await prisma.project.delete({ where: { id: emptyProject.id } });
  });
});

describe("AnalyticsRepository - getByChannelId", () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await teardownTestData();
  });

  it("returns analytics for specific channel with post relationship", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId(testChannelIds[0]!);

    assert.ok(Array.isArray(analytics));
    assert.ok(analytics.length > 0);

    analytics.forEach((record) => {
      assert.equal(record.channelId, testChannelIds[0]);
      assert.ok(record.post !== undefined);
    });
  });

  it("filters analytics by date range", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const analytics = await repo.getByChannelId(testChannelIds[0]!, {
      startDate: oneDayAgo,
    });

    analytics.forEach((record) => {
      assert.ok(record.capturedAt >= oneDayAgo);
    });
  });

  it("returns empty array for non-existent channel", async () => {
    const repo = new PrismaAnalyticsReadRepository(prisma);
    const analytics = await repo.getByChannelId("non-existent-channel");

    assert.equal(analytics.length, 0);
  });
});
